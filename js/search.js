/* 社团资源库 —— 搜索层（索引、拼音/模糊匹配、搜索 UI） */
"use strict";

var SEARCH_LIMIT = 50;
var SEARCH_INDEX_TTL = 60000; /* 搜索索引缓存时长：60 秒 */
var searchIndex = null;  /* { entries, ts } 本地搜索索引 */

  /* ================= 本地搜索（文件名/文件夹名/类型 + 拼音 + 模糊） ================= */

  var TYPE_GROUPS = [
    { label: "文档", exts: ["doc", "docx", "txt", "md", "rtf", "wps", "odt", "pdf"] },
    { label: "表格", exts: ["xls", "xlsx", "csv", "ods"] },
    { label: "演示", exts: ["ppt", "pptx", "odp"] },
    { label: "PDF", exts: ["pdf"] },
    { label: "图片", exts: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico"] },
    { label: "视频", exts: ["mp4", "mov", "avi", "mkv", "flv", "wmv", "webm"] },
    { label: "音频", exts: ["mp3", "wav", "flac", "aac", "ogg", "m4a"] },
    { label: "压缩包", exts: ["zip", "rar", "7z", "tar", "gz", "bz2"] },
    { label: "代码", exts: ["js", "html", "css", "py", "java", "c", "cpp", "json", "xml", "sh"] }
  ];

  function fileTypeLabel(name) {
    var ext = extOf(name);
    for (var i = 0; i < TYPE_GROUPS.length; i++) {
      if (TYPE_GROUPS[i].exts.indexOf(ext) >= 0) return TYPE_GROUPS[i].label;
    }
    return "其他";
  }

  /* 中文转拼音：全拼 + 首字母；库不可用时返回空，中文子串匹配仍可用 */
  function pinyinOf(text) {
    try {
      var py = window.pinyinPro;
      if (!py || typeof py.pinyin !== "function") return { pinyin: "", initials: "" };
      var opts = { toneType: "none", type: "array", nonZh: "removed" };
      var full = py.pinyin(String(text), opts).join("").toLowerCase().replace(/\s+/g, "");
      var first = py.pinyin(String(text), Object.assign({ pattern: "first" }, opts)).join("").toLowerCase().replace(/\s+/g, "");
      return { pinyin: full, initials: first };
    } catch (e) {
      return { pinyin: "", initials: "" };
    }
  }

  function normalizeAbs(root, rel) {
    if (rel === "/") return root;
    if (rel.charAt(0) === "/") return root + rel;
    return root + "/" + rel;
  }

  async function ensureSearchIndex() {
    var now = Date.now();
    if (searchIndex && now - searchIndex.ts < SEARCH_INDEX_TTL) return searchIndex;
    var items = await listRecursiveAll(ROOT);
    var entries = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.relPath === "/") continue;
      var py = pinyinOf(it.name);
      entries.push({
        name: it.name,
        path: normalizeAbs(ROOT, it.relPath),
        kind: it.type,
        size: it.size || 0,
        modified: it.modified || 0,
        pinyin: py.pinyin,
        initials: py.initials,
        ext: extOf(it.name),
        typeLabel: fileTypeLabel(it.name)
      });
    }
    searchIndex = { entries: entries, ts: now };
    return searchIndex;
  }

  /* 子串匹配 + 字符顺序模糊匹配 */
  function fuzzyMatch(hay, q) {
    hay = String(hay || "").toLowerCase();
    q = String(q || "").toLowerCase();
    if (!q) return false;
    if (hay.indexOf(q) >= 0) return true;
    var i = 0;
    for (var j = 0; j < hay.length && i < q.length; j++) {
      if (hay.charAt(j) === q.charAt(i)) i++;
    }
    return i === q.length;
  }

  function entryMatches(entry, q, scope) {
    var qc = q.replace(/\s+/g, "");
    if (scope === "file" && entry.kind !== "file") return false;
    if (scope === "folder" && entry.kind !== "dir") return false;
    if (scope === "type" && entry.kind !== "file") return false;
    if (scope === "all" || scope === "file" || scope === "folder") {
      if (fuzzyMatch(entry.name, q)) return true;
      if (entry.pinyin && fuzzyMatch(entry.pinyin, qc)) return true;
      if (entry.initials && fuzzyMatch(entry.initials, qc)) return true;
      if (scope !== "all") return false;
    }
    if (scope === "all" || scope === "type") {
      if (entry.kind === "file") {
        if (fuzzyMatch(entry.ext, qc)) return true;
        if (fuzzyMatch(entry.typeLabel, q)) return true;
      }
    }
    return false;
  }

  /* XHR 上传（为了拿到进度） */
  /* ================= 搜索 ================= */

  /* 搜索范围自定义下拉（纯视觉层；原生 select 仅作值载体，change 逻辑不变） */
  function initScopePicker() {
    var picker = $("scopePicker");
    var trigger = $("scopeTrigger");
    var menu = $("scopeMenu");
    var native = $("searchScope");
    var label = $("scopeLabel");
    if (!picker || !trigger || !menu || !native || !label) return;

    function close() {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }

    function sync() {
      var opt = native.options[native.selectedIndex];
      label.textContent = opt ? opt.textContent : "全部";
      var opts = menu.querySelectorAll("[data-scope]");
      Array.prototype.forEach.call(opts, function (o) {
        var on = o.getAttribute("data-scope") === native.value;
        o.classList.toggle("active", on);
        o.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    trigger.addEventListener("click", function () {
      if (menu.hidden) {
        sync();
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
      } else {
        close();
      }
    });

    Array.prototype.forEach.call(menu.querySelectorAll("[data-scope]"), function (o) {
      o.addEventListener("click", function () {
        native.value = o.getAttribute("data-scope");
        native.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
        close();
      });
    });

    trigger.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });

    document.addEventListener("click", function (e) {
      if (!picker.contains(e.target)) close();
    });

    sync();
  }

  function initSearch() {
    searchInput.addEventListener("input", function () {
      var q = searchInput.value.trim();
      clearTimeout(searchTimer);
      if (!q) { closeSearchPanel(); return; }
      searchTimer = setTimeout(function () { runSearch(q); }, 350);
    });
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(searchTimer);
        runSearch(searchInput.value.trim());
      }
      if (e.key === "Escape") {
        closeMobileSearch();
      }
    });
    searchScope.addEventListener("change", function () {
      updateSearchPlaceholder();
      var q = searchInput.value.trim();
      if (q) runSearch(q);
      else searchInput.focus();
    });
    if (searchIcon) searchIcon.addEventListener("click", openMobileSearch);
    if (searchClose) searchClose.addEventListener("click", closeMobileSearch);
    document.addEventListener("click", function (e) {
      if (!searchWrap.contains(e.target)) closeSearchPanel();
    });
    updateSearchPlaceholder();
  }

  function updateSearchPlaceholder() {
    var map = {
      all: "搜索文件名 / 文件夹名 / 类型",
      file: "搜索文件名，支持拼音",
      folder: "搜索文件夹名，支持拼音",
      type: "搜索文件类型，如 pdf / 文档"
    };
    searchInput.placeholder = map[searchScope.value] || CONFIG.searchPlaceholder || "搜索…";
  }

  async function runSearch(q) {
    if (!q) { closeSearchPanel(); return; }
    var scope = searchScope.value || "all";
    searchPanel.innerHTML = '<div class="search-item muted">搜索中…</div>';
    searchPanel.hidden = false;
    try {
      var idx = await ensureSearchIndex();
      if (searchInput.value.trim() !== q) return;
      var ql = q.toLowerCase().trim();
      var hits = [];
      for (var i = 0; i < idx.entries.length && hits.length < SEARCH_LIMIT; i++) {
        if (entryMatches(idx.entries[i], ql, scope)) hits.push(idx.entries[i]);
      }
      if (!hits.length) {
        searchPanel.innerHTML = '<div class="search-item muted">没有找到匹配的结果</div>';
        return;
      }
      searchPanel.innerHTML = hits.map(function (h) {
        var dir = h.kind === "dir" ? h.path : dirOf(h.path);
        var icon = h.kind === "dir" ? ICONS.folder : ICONS.file;
        var meta = h.kind === "dir"
          ? "文件夹"
          : esc(h.typeLabel) + " · " + fmtSize(h.size);
        return '<button class="search-item" data-open="' + esc(dir) + '">' +
          '<span class="search-name">' + icon + esc(h.name) + '</span>' +
          '<span class="search-path">' + esc(relPath(dir)) + '</span>' +
          '<span class="search-time">' + meta + '</span></button>';
      }).join("");
      searchPanel.hidden = false;
      Array.prototype.forEach.call(searchPanel.querySelectorAll("[data-open]"), function (b) {
        b.addEventListener("click", function () {
          selectFolder(b.getAttribute("data-open"));
        });
      });
    } catch (err) {
      if (err.auth) return;
      searchPanel.innerHTML = '<div class="search-item muted">搜索失败，请稍后重试</div>';
    }
  }

