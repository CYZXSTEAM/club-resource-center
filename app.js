/* 社团资源库 v1.5 —— 双栏浏览模式（目录树 + 内容区），基于 Koofr REST API */
(function () {
  "use strict";

  var CONFIG = window.CLUB_CONFIG || {};
  var BASE = CONFIG.koofrBase || "https://app.koofr.net";
  var MOUNT = CONFIG.mountId || "primary";
  var ROOT = CONFIG.rootPath || "/社团资源库";
  var AUTH_KEY = "club_koofr_auth";
  var PREVIEW_EXT = { pdf: 1, jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, bmp: 1, svg: 1 };
  var RECENT_LIMIT = 20;
  var SEARCH_LIMIT = 50;

  var state = {
    selectedPath: null,   /* null 表示根节点（右侧显示主页） */
    currentFiles: [],
    treeCache: {},        /* path -> 子文件夹数组；undefined 表示未加载 */
    expanded: {},         /* path -> false | "open" | "loading" */
    mode: "download"      /* "upload" 或 "download" */
  };

  var memoryAuth = null;        /* 内存中的登录凭据，刷新即清 */
  var queueRows = {};
  var queueUid = 0;
  var bannerTimer = null;
  var searchTimer = null;
  var previewObjectUrl = null;

  var $ = function (id) { return document.getElementById(id); };
  var loginView = $("loginView");
  var mainView = $("mainView");
  var logoutBtn = $("logoutBtn");
  var banner = $("banner");
  var bannerText = $("bannerText");
  var sidebar = $("sidebar");
  var sidebarMask = $("sidebarMask");
  var treeToggle = $("treeToggle");
  var tree = $("tree");
  var uploadArea = $("uploadArea");
  var uploadZone = $("uploadZone");
  var fileInput = $("fileInput");
  var uploadQueue = $("uploadQueue");
  var folderSelect = $("folderSelect");
  var newFolderBtn = $("newFolderBtn");
  var breadcrumb = $("breadcrumb");
  var content = $("content");
  var searchWrap = $("searchWrap");
  var searchInput = $("globalSearch");
  var searchPanel = $("searchPanel");
  var modalRoot = $("modalRoot");

  /* ================= 登录凭据（仅存内存，刷新即清） ================= */

  function authError() {
    var e = new Error("AUTH");
    e.auth = true;
    return e;
  }

  function getAuth() {
    return memoryAuth;
  }

  function saveAuth(email, password) {
    var b64 = btoa(unescape(encodeURIComponent(email + ":" + password)));
    memoryAuth = { email: email, b64: b64 };
  }

  function clearAuth() {
    memoryAuth = null;
  }

  /* ================= 工具函数 ================= */

  function esc(s) {
    return String(s)
      .replace(/\r?\n/g, " ")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function encodePath(p) {
    return String(p).split("/").map(encodeURIComponent).join("/");
  }

  function joinPath(base, name) {
    return base === "/" ? "/" + name : base + "/" + name;
  }

  function fileName(p) {
    var parts = String(p).split("/");
    return parts[parts.length - 1];
  }

  function dirOf(p) {
    var s = String(p);
    var i = s.lastIndexOf("/");
    return i > 0 ? s.slice(0, i) : ROOT;
  }

  function relPath(p) {
    var s = String(p);
    if (s.indexOf(ROOT) === 0) s = s.slice(ROOT.length);
    return s.replace(/^\//, "");
  }

  function extOf(name) {
    var m = /\.([^.]+)$/.exec(String(name));
    return m ? m[1].toLowerCase() : "";
  }

  function isPreviewable(name) {
    return !!PREVIEW_EXT[extOf(name)];
  }

  function fileIcon(name) {
    var ext = extOf(name);
    if (ext === "pdf") return "📕";
    if (["doc", "docx"].indexOf(ext) >= 0) return "📘";
    if (["xls", "xlsx", "csv"].indexOf(ext) >= 0) return "📊";
    if (["ppt", "pptx"].indexOf(ext) >= 0) return "📽️";
    if (["zip", "rar", "7z", "tar", "gz"].indexOf(ext) >= 0) return "📦";
    if (["mp4", "mov", "avi", "mkv"].indexOf(ext) >= 0) return "🎬";
    if (["mp3", "wav", "flac", "aac"].indexOf(ext) >= 0) return "🎵";
    if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].indexOf(ext) >= 0) return "🖼️";
    return "📄";
  }

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    var units = ["KB", "MB", "GB", "TB"];
    var v = n / 1024;
    var i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 ? 0 : 1) + " " + units[i];
  }

  function fmtTime(ms) {
    if (!ms) return "—";
    var d = new Date(Number(ms));
    return d.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });
  }

  function friendlyError(err) {
    if (err instanceof TypeError) return "网络错误，请检查网络连接后重试";
    return (err && err.message) || "未知错误";
  }

  async function apiErrorText(res) {
    try {
      var j = await res.json();
      if (j && j.error && j.error.message) return j.error.message;
    } catch (e) { /* 忽略 */ }
    return "请求失败（" + res.status + "）";
  }

  /* ================= Koofr API ================= */

  async function koofrFetch(url, options) {
    var auth = getAuth();
    if (!auth) {
      showLogin("请先登录");
      throw authError();
    }
    options = options || {};
    var headers = Object.assign({ Authorization: "Basic " + auth.b64 }, options.headers || {});
    var res = await fetch(url, Object.assign({}, options, { headers: headers }));
    if (res.status === 401) {
      clearAuth();
      showLogin("邮箱或应用密码错误，或登录已过期，请重新登录");
      throw authError();
    }
    return res;
  }

  function listUrl(path) {
    return BASE + "/api/v2.1/mounts/" + encodeURIComponent(MOUNT) + "/files/list?path=" + encodePath(path);
  }

  function getUrl(path, force) {
    return BASE + "/content/api/v2.1/mounts/" + encodeURIComponent(MOUNT) + "/files/get?path=" + encodePath(path) +
      (force ? "&force=true" : "");
  }

  function putUrl(path, filename, overwrite) {
    return BASE + "/content/api/v2.1/mounts/" + encodeURIComponent(MOUNT) + "/files/put?path=" + encodePath(path) +
      "&filename=" + encodeURIComponent(filename) + "&overwrite=" + (overwrite ? "true" : "false");
  }

  async function listFolder(path) {
    var res = await koofrFetch(listUrl(path));
    if (!res.ok) {
      var err = new Error(await apiErrorText(res));
      err.status = res.status;
      throw err;
    }
    var data = await res.json();
    return (data.files || []).map(function (it) {
      return {
        name: it.name,
        type: it.type === "dir" ? "dir" : "file",
        size: Number(it.size) || 0,
        modified: Number(it.modified) || 0,
        contentType: it.contentType || ""
      };
    });
  }

  async function listDirs(path) {
    var items = await listFolder(path);
    return items.filter(function (it) { return it.type === "dir"; }).map(function (it) {
      return { name: it.name, path: joinPath(path, it.name) };
    });
  }

  async function createFolder(parentPath, name) {
    var url = BASE + "/api/v2.1/mounts/" + encodeURIComponent(MOUNT) + "/files/folder?path=" + encodePath(parentPath);
    var res = await koofrFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name })
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
  }

  async function searchFiles(query) {
    var url = BASE + "/api/v2.1/search?query=" + encodeURIComponent(query) +
      "&mountId=" + encodeURIComponent(MOUNT) +
      "&path=" + encodePath(ROOT) +
      "&limit=" + SEARCH_LIMIT;
    var res = await koofrFetch(url);
    if (!res.ok) throw new Error(await apiErrorText(res));
    var data = await res.json();
    return (data.hits || []).filter(function (h) {
      var p = normalizePath(h.path);
      return h.type === "file" && p.indexOf(ROOT) === 0;
    }).map(function (h) {
      return {
        name: h.name,
        path: normalizePath(h.path),
        modified: Number(h.modified) || 0,
        size: Number(h.size) || 0,
        contentType: h.contentType || ""
      };
    });
  }

  function normalizePath(p) {
    var s = String(p || "");
    if (s.charAt(0) !== "/") s = "/" + s;
    return s;
  }

  /* listrecursive 返回 NDJSON 流，逐行解析 */
  async function listRecursiveFiles(path) {
    var url = BASE + "/content/api/v2.1/mounts/" + encodeURIComponent(MOUNT) + "/files/listrecursive?path=" + encodePath(path);
    var res = await koofrFetch(url);
    if (!res.ok) throw new Error(await apiErrorText(res));
    var text = await res.text();
    var out = [];
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      try {
        var item = JSON.parse(line);
        if (item.type === "file" && item.file && item.file.type === "file") {
          out.push({
            name: item.file.name,
            relPath: item.path,
            modified: Number(item.file.modified) || 0,
            size: Number(item.file.size) || 0,
            contentType: item.file.contentType || ""
          });
        }
      } catch (e) { /* 忽略坏行 */ }
      if (out.length > 5000) break;
    }
    return out;
  }

  /* XHR 上传（为了拿到进度） */
  function uploadFile(path, file, overwrite, uid) {
    return new Promise(function (resolve, reject) {
      var auth = getAuth();
      if (!auth) {
        showLogin("请先登录");
        reject(authError());
        return;
      }
      var xhr = new XMLHttpRequest();
      xhr.open("POST", putUrl(path, file.name, overwrite));
      xhr.setRequestHeader("Authorization", "Basic " + auth.b64);
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable && e.total > 0) {
          setQueue(uid, "上传中", Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          setQueue(uid, "完成", 100);
          resolve();
        } else if (xhr.status === 401) {
          clearAuth();
          showLogin("邮箱或应用密码错误，或登录已过期，请重新登录");
          reject(authError());
        } else {
          var msg = "上传失败（" + xhr.status + "）";
          try {
            var j = JSON.parse(xhr.responseText);
            if (j && j.error && j.error.message) msg = j.error.message;
          } catch (e) { /* 忽略 */ }
          reject(new Error(msg));
        }
      };
      xhr.onerror = function () { reject(new TypeError("网络错误，上传中断")); };
      xhr.onabort = function () { reject(new Error("上传被取消")); };
      var fd = new FormData();
      fd.append("file", file);
      xhr.send(fd);
    });
  }

  async function downloadFile(path) {
    var res = await koofrFetch(getUrl(path, true));
    if (!res.ok) throw new Error(await apiErrorText(res));
    var blob = await res.blob();
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName(path);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }

  /* ================= 视图切换 ================= */

  function resetState() {
    state = {
      selectedPath: null,
      currentFiles: [],
      treeCache: {},
      expanded: {},
      mode: "download"
    };
  }

  function closeDrawer() {
    sidebar.classList.remove("open");
    sidebarMask.hidden = true;
  }

  function closeSearchPanel() {
    searchPanel.hidden = true;
    searchPanel.innerHTML = "";
  }

  function showLogin(message) {
    resetState();
    loginView.hidden = false;
    mainView.hidden = true;
    logoutBtn.hidden = true;
    treeToggle.hidden = true;
    searchWrap.hidden = true;
    $("modeToggle").hidden = true;
    breadcrumb.innerHTML = "";
    content.innerHTML = "";
    tree.innerHTML = "";
    uploadArea.hidden = true;
    uploadQueue.hidden = true;
    uploadQueue.innerHTML = "";
    closeDrawer();
    closeSearchPanel();
    hideBanner();
    setLoginError(message || "");
  }

  function showMain() {
    loginView.hidden = true;
    mainView.hidden = false;
    logoutBtn.hidden = false;
    searchWrap.hidden = false;
    $("modeToggle").hidden = false;
    updateTreeToggle();
    hideBanner();
  }

  function updateTreeToggle() {
    treeToggle.hidden = !window.matchMedia("(max-width: 768px)").matches;
  }

  function setLoginError(msg) {
    var el = $("loginError");
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }

  function setLoginBusy(busy) {
    var btn = $("loginBtn");
    btn.disabled = busy;
    btn.textContent = busy ? "验证中…" : "进入资源库";
  }

  function showBanner(msg, isError) {
    if (!msg) { hideBanner(); return; }
    banner.hidden = false;
    banner.className = "banner" + (isError ? " error" : "");
    bannerText.textContent = msg;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { banner.hidden = true; }, isError ? 8000 : 5000);
  }

  function hideBanner() {
    banner.hidden = true;
    clearTimeout(bannerTimer);
  }

  /* ================= 登录 ================= */

  async function doLogin(e) {
    e.preventDefault();
    var email = $("loginEmail").value.trim();
    var password = $("loginPassword").value;
    if (!email || !password) {
      setLoginError("请输入邮箱和应用密码");
      return;
    }
    setLoginBusy(true);
    saveAuth(email, password);
    try {
      var res = await koofrFetch(BASE + "/api/v2.1/user/authenticated");
      if (!res.ok) throw new Error(await apiErrorText(res));
      $("loginPassword").value = "";
      enterMain();
    } catch (err) {
      if (!err.auth) {
        clearAuth();
        setLoginError(err instanceof TypeError
          ? "网络错误，无法连接 Koofr，请检查网络后重试"
          : "登录验证失败，请检查邮箱和应用密码");
      }
    } finally {
      setLoginBusy(false);
    }
  }

  /* ================= 进入主界面 ================= */

  function enterMain() {
    resetState();
    showMain();
    state.mode = "download";
    applyModeLayout("download");
    renderTree();
    selectRoot();
  }

  function applyModeLayout(mode) {
    var up = mode === "upload";
    $("modeUpload").classList.toggle("active", up);
    $("modeDownload").classList.toggle("active", !up);
    uploadArea.hidden = !up;
    breadcrumb.hidden = true;
    content.hidden = up;
    if (up) closeSearchPanel();
    updateTreeToggle();
  }

  function switchMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    applyModeLayout(mode);
    if (mode === "upload") {
      fillFolderSelect(state.selectedPath || ROOT);
      renderTree();
    } else {
      selectRoot();
    }
  }

  /* ================= 目录树 ================= */

  function categoryMeta(name) {
    var cats = CONFIG.categories || [];
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].folder === name) return cats[i];
    }
    return null;
  }

  function treeIcon(name) {
    var c = categoryMeta(name);
    return c && c.icon ? c.icon : "📁";
  }

  async function ensureTreeChildren(path) {
    if (state.treeCache[path] !== undefined) return state.treeCache[path];
    var dirs = await listDirs(path);
    state.treeCache[path] = dirs;
    return dirs;
  }

  /* 展开路径上所有祖先节点，让指定文件夹在树中可见并高亮 */
  async function revealPath(path) {
    var rel = path.slice(ROOT.length).split("/").filter(Boolean);
    var acc = ROOT;
    for (var i = 0; i < rel.length; i++) {
      acc = joinPath(acc, rel[i]);
      await ensureTreeChildren(acc);
      state.expanded[acc] = "open";
    }
  }

  function buildNodeHtml(path, depth, isRoot) {
    var name = fileName(path);
    var isOpen = state.expanded[path] === "open";
    var isLoading = state.expanded[path] === "loading";
    var children = state.treeCache[path];
    var hasChildren = isOpen && Array.isArray(children) && children.length > 0;
    var icon = isRoot ? "📚" : treeIcon(name);
    var indent = depth * 14;
    var active = isRoot ? (state.selectedPath === null || state.selectedPath === path) : (state.selectedPath === path);
    var html = '<div class="tree-node" style="padding-left:' + indent + 'px">';
    if (isLoading) {
      html += '<span class="tree-toggle">…</span><span class="tree-label muted">加载中…</span>';
    } else {
      html += '<button class="tree-toggle" data-toggle="' + esc(path) + '">' + (isOpen ? "▾" : "▸") + '</button>';
      html += '<button class="tree-label' + (active ? " active" : "") + '" data-select="' + esc(path) +
        '" data-root="' + (isRoot ? 1 : 0) + '">' +
        '<span class="tree-icon">' + icon + '</span>' +
        '<span class="tree-name">' + esc(name) + '</span></button>';
    }
    html += '</div>';
    if (hasChildren) {
      for (var i = 0; i < children.length; i++) {
        html += buildNodeHtml(children[i].path, depth + 1, false);
      }
    }
    return html;
  }

  function renderTree() {
    tree.innerHTML = buildNodeHtml(ROOT, 0, true);
    var toggles = tree.querySelectorAll("[data-toggle]");
    Array.prototype.forEach.call(toggles, function (b) {
      b.addEventListener("click", function () {
        toggleNode(b.getAttribute("data-toggle"));
      });
    });
    var labels = tree.querySelectorAll("[data-select]");
    Array.prototype.forEach.call(labels, function (b) {
      b.addEventListener("click", function () {
        var path = b.getAttribute("data-select");
        if (b.getAttribute("data-root") === "1") selectRoot();
        else selectFolder(path);
      });
    });
  }

  function toggleNode(path) {
    if (state.expanded[path] === "loading") return;
    if (state.expanded[path] === "open") {
      state.expanded[path] = false;
      renderTree();
      return;
    }
    state.expanded[path] = "loading";
    renderTree();
    ensureTreeChildren(path).then(function () {
      state.expanded[path] = "open";
      renderTree();
    }).catch(function (err) {
      if (err.auth) return;
      state.expanded[path] = false;
      renderTree();
      showBanner("加载目录失败：" + friendlyError(err), true);
    });
  }

  function selectRoot() {
    state.selectedPath = null;
    renderTree();
    closeSearchPanel();
    closeDrawer();
    fillFolderSelect(ROOT);
    if (state.mode === "download") {
      loadHome();
    }
  }

  async function selectFolder(path) {
    state.selectedPath = path;
    renderTree();
    closeSearchPanel();
    closeDrawer();
    fillFolderSelect(path);
    if (state.mode === "upload") return;
    content.innerHTML = '<div class="loading">加载中…</div>';
    try {
      state.currentFiles = await listFolder(path);
      await renderFolderFiles(state.currentFiles);
    } catch (err) {
      if (err.auth) return;
      state.currentFiles = [];
      var msg = friendlyError(err);
      if (err.status === 404) msg = "文件夹不存在，可能已被移动或删除。";
      content.innerHTML = '<div class="error-box">加载失败：' + esc(msg) +
        '<br><button class="btn" data-reload="1">刷新</button></div>';
      wireReload();
    }
  }

  function wireReload() {
    var btn = content.querySelector("[data-reload]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (state.selectedPath === null) loadHome();
      else selectFolder(state.selectedPath);
    });
  }

  /* ================= 面包屑 ================= */

  function renderBreadcrumb() {
    if (state.selectedPath === null) {
      breadcrumb.innerHTML = '<span class="crumb current">🏠 主页</span>';
      return;
    }
    var rel = state.selectedPath.slice(ROOT.length).split("/").filter(Boolean);
    var acc = ROOT;
    var html = '<button class="crumb-link" data-root="1">🏠 主页</button>' +
      '<span class="crumb-sep">/</span>' +
      '<span class="crumb current">' + esc(fileName(ROOT)) + '</span>';
    rel.forEach(function (seg, i) {
      acc = joinPath(acc, seg);
      if (i === rel.length - 1) {
        html += '<span class="crumb-sep">/</span><span class="crumb current">' + esc(seg) + '</span>';
      } else {
        html += '<span class="crumb-sep">/</span><button class="crumb-link" data-path="' + esc(acc) + '">' + esc(seg) + '</button>';
      }
    });
    breadcrumb.innerHTML = html;
    var rootBtn = breadcrumb.querySelector("[data-root]");
    if (rootBtn) rootBtn.addEventListener("click", selectRoot);
    var pathBtns = breadcrumb.querySelectorAll("[data-path]");
    Array.prototype.forEach.call(pathBtns, function (b) {
      b.addEventListener("click", function () { selectFolder(b.getAttribute("data-path")); });
    });
  }

  /* ================= 右侧内容 ================= */

  function loadHome() {
    content.innerHTML = '<div class="loading">正在加载主页…</div>';
    Promise.all([
      ensureTreeChildren(ROOT),
      listRecursiveFiles(ROOT)
    ]).then(function (results) {
      var dirs = results[0];
      var items = results[1].filter(function (it) { return it.relPath !== "/"; });
      return loadFolderCounts(dirs).then(function (cards) {
        renderHome(cards, items);
      });
    }).catch(function (err) {
      if (err.auth) return;
      content.innerHTML = '<div class="error-box">加载主页失败：' + esc(friendlyError(err)) +
        '<br><button class="btn" data-reload="1">重试</button></div>';
      wireReload();
    });
  }

  function loadFolderCounts(dirs) {
    return Promise.all(dirs.map(function (d) {
      return listFolder(d.path).then(function (files) {
        return {
          name: d.name,
          path: d.path,
          icon: treeIcon(d.name),
          count: files.filter(function (f) { return f.type === "file"; }).length
        };
      }).catch(function () {
        return { name: d.name, path: d.path, icon: treeIcon(d.name), count: null };
      });
    }));
  }

  function renderHome(cards, items) {
    var updates = items.slice().sort(function (a, b) { return b.modified - a.modified; }).slice(0, RECENT_LIMIT);
    var cardHtml = cards.length
      ? cards.map(function (c) {
          return '<div class="subject-card" data-open="' + esc(c.path) + '" title="进入「' + esc(c.name) + '」">' +
            '<div class="sc-icon">' + c.icon + '</div>' +
            '<div class="sc-name">' + esc(c.name) + '</div>' +
            '<div class="sc-meta">' + (c.count === null ? "份数未知" : c.count + " 份资料") + '</div>' +
            '<div class="subject-right"><span class="count">' + (c.count === null ? "?" : c.count) + '</span></div>' +
            '</div>';
        }).join("")
      : '<div class="empty">根目录下还没有文件夹，先切到「上传」模式新建一个。</div>';
    var updateHtml = updates.length
      ? updates.map(function (u) {
          var absPath = ROOT + u.relPath;
          var dirPath = dirOf(absPath);
          var chip = relPath(dirPath) || "根目录";
          return '<button class="update-card" data-open="' + esc(dirPath) + '">' +
            '<span class="chip">' + esc(chip) + '</span>' +
            '<div class="update-info">' +
            '<div class="update-title">' + esc(u.name) + '</div>' +
            '<div class="update-meta">📄 文件 · ' + fmtSize(u.size) + ' · ' + fmtTime(u.modified) + '</div>' +
            '</div>' +
            '<span class="go">→</span></button>';
        }).join("")
      : '<div class="empty">暂无资料更新</div>';
    content.innerHTML =
      '<div class="home-layout">' +
      '<div class="home-left"><div class="subject-grid">' + cardHtml + '</div></div>' +
      '<div class="home-right">' +
      '<div class="page-head"><h2>最新资料更新</h2><p class="page-sub">点击任意一条可直接进入对应文件夹并定位到该资料</p></div>' +
      '<div class="update-list">' + updateHtml + '</div>' +
      '</div></div>';

    var cardBtns = content.querySelectorAll(".subject-card[data-open]");
    Array.prototype.forEach.call(cardBtns, function (b) {
      b.addEventListener("click", function () { selectFolder(b.getAttribute("data-open")); });
    });
    var updateBtns = content.querySelectorAll(".update-card[data-open]");
    Array.prototype.forEach.call(updateBtns, function (b) {
      b.addEventListener("click", function () { selectFolder(b.getAttribute("data-open")); });
    });
  }

  async function renderFolderFiles(files) {
    var sorted = files.slice().sort(function (a, b) {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-CN");
    });
    var dirs = sorted.filter(function (f) { return f.type === "dir"; });
    var fileItems = sorted.filter(function (f) { return f.type === "file"; });

    var chips = await Promise.all(dirs.map(function (d) {
      return listFolder(d.path).then(function (fs) {
        return fs.filter(function (f) { return f.type === "file"; }).length;
      }).catch(function () { return null; });
    }));

    var folderChips = dirs.map(function (d, i) {
      return '<div class="folder-chip" data-open="' + esc(d.path) + '" title="进入「' + esc(d.name) + '」">' +
        '<span>📁</span>' +
        '<span class="folder-name">' + esc(d.name) + '</span>' +
        '<span class="count">' + (chips[i] === null ? "?" : chips[i]) + '</span></div>';
    }).join("");

    var cards = fileItems.map(function (f) {
      var full = joinPath(state.selectedPath, f.name);
      var previewable = isPreviewable(f.name);
      var ext = (extOf(f.name) || "文件").toUpperCase();
      return '<div class="res-card" data-card-preview="' + esc(full) + '" data-card-download="' + esc(full) +
        '" data-card-previewable="' + (previewable ? 1 : 0) + '" title="' + (previewable ? "点击预览，或使用下方按钮" : "点击下载") + '">' +
        '<div class="res-info">' +
        '<div class="res-title">' + esc(f.name) + '</div>' +
        '<div class="res-meta">📄 ' + esc(ext) + ' · 文件 · ' + fmtSize(f.size) + ' · ' + fmtTime(f.modified) + '</div>' +
        '</div>' +
        '<div class="res-actions">' +
        (previewable ? '<button class="btn edit" data-preview="' + esc(full) + '">预览</button>' : "") +
        '<button class="btn download" data-download="' + esc(full) + '">⭳ 下载</button>' +
        '</div></div>';
    }).join("");

    content.innerHTML =
      '<div class="page-head">' +
      '<button class="btn ghost" data-home="1">← 返回主页</button>' +
      '<h2>' + esc(fileName(state.selectedPath)) + '</h2>' +
      '<p class="page-sub">共 ' + fileItems.length + ' 份资料 · ' + dirs.length + ' 个文件夹 · 点击资料卡片即可下载或打开</p>' +
      '</div>' +
      '<div class="folder-bar">' +
      '<div class="folder-chip active">全部 <span class="count">' + fileItems.length + '</span></div>' +
      folderChips +
      '</div>' +
      '<div class="res-list">' + (cards || '<div class="empty">暂无资料<br>切到「上传」模式添加文件</div>') + '</div>';

    var homeBtn = content.querySelector("[data-home]");
    if (homeBtn) homeBtn.addEventListener("click", selectRoot);
    var cardEls = content.querySelectorAll(".res-card[data-card-previewable]");
    Array.prototype.forEach.call(cardEls, function (card) {
      card.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest(".res-actions")) return;
        var p = card.getAttribute("data-card-preview");
        var dl = card.getAttribute("data-card-download");
        if (card.getAttribute("data-card-previewable") === "1") {
          previewFile(p).catch(function (err) { if (!err.auth) showBanner(friendlyError(err), true); });
        } else {
          downloadFile(dl).catch(function (err) { if (!err.auth) showBanner(friendlyError(err), true); });
        }
      });
    });
    wireFileActions();
  }

  function wireFileActions() {
    var openBtns = content.querySelectorAll("[data-open]");
    Array.prototype.forEach.call(openBtns, function (b) {
      b.addEventListener("click", function () {
        selectFolder(b.getAttribute("data-open"));
      });
    });
    var previewBtns = content.querySelectorAll("[data-preview]");
    Array.prototype.forEach.call(previewBtns, function (b) {
      b.addEventListener("click", function () {
        previewFile(b.getAttribute("data-preview")).catch(function (err) {
          if (!err.auth) showBanner(friendlyError(err), true);
        });
      });
    });
    var dlBtns = content.querySelectorAll("[data-download]");
    Array.prototype.forEach.call(dlBtns, function (b) {
      b.addEventListener("click", function () {
        downloadFile(b.getAttribute("data-download")).catch(function (err) {
          if (!err.auth) showBanner(friendlyError(err), true);
        });
      });
    });
  }

  /* ================= 预览 ================= */

  async function previewFile(path) {
    var res = await koofrFetch(getUrl(path, false));
    if (!res.ok) throw new Error(await apiErrorText(res));
    var blob = await res.blob();
    var objUrl = URL.createObjectURL(blob);
    previewObjectUrl = objUrl;
    var isPdf = extOf(fileName(path)) === "pdf";
    var body = isPdf
      ? '<iframe class="preview-frame" src="' + objUrl + '"></iframe>'
      : '<img class="preview-img" src="' + objUrl + '" alt="' + esc(fileName(path)) + '">';
    var action = await showModal({
      title: fileName(path),
      body: body,
      wide: true,
      buttons: [
        { text: "下载", value: "download" },
        { text: "关闭", value: "close", primary: true }
      ]
    });
    if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
    if (action === "download") {
      try {
        await downloadFile(path);
      } catch (err) {
        if (!err.auth) showBanner(friendlyError(err), true);
      }
    }
  }

  /* ================= 上传 ================= */

  function fillFolderSelect(selected) {
    var opts = [{ path: ROOT, label: fileName(ROOT) + "（根）" }];
    var seen = {};
    seen[ROOT] = true;
    (function walk(path, depth) {
      var kids = state.treeCache[path];
      if (!Array.isArray(kids)) return;
      for (var i = 0; i < kids.length; i++) {
        var p = kids[i].path;
        if (seen[p]) continue;
        seen[p] = true;
        opts.push({ path: p, label: new Array(depth + 1).join("　　") + "└ " + kids[i].name });
        walk(p, depth + 1);
      }
    })(ROOT, 1);
    folderSelect.innerHTML = opts.map(function (o) {
      return '<option value="' + esc(o.path) + '">' + esc(o.label) + '</option>';
    }).join("");
    /* 优先选中传入的路径；若未加载到选项中，也直接选中该路径 */
    if (selected && !seen[selected]) {
      var opt = document.createElement("option");
      opt.value = selected;
      opt.textContent = "… " + relPath(selected);
      folderSelect.appendChild(opt);
    }
    folderSelect.value = selected || ROOT;
  }

  function addQueueRow(name) {
    var uid = ++queueUid;
    var row = document.createElement("div");
    row.className = "queue-row";
    row.innerHTML = '<span class="queue-name"></span>' +
      '<div class="progress"><div class="progress-bar"></div></div>' +
      '<span class="queue-status">排队中</span>';
    uploadQueue.appendChild(row);
    queueRows[uid] = {
      nameEl: row.querySelector(".queue-name"),
      bar: row.querySelector(".progress-bar"),
      statusEl: row.querySelector(".queue-status")
    };
    queueRows[uid].nameEl.textContent = name;
    return uid;
  }

  function setQueue(uid, status, pct) {
    var q = queueRows[uid];
    if (!q) return;
    q.statusEl.textContent = status + (typeof pct === "number" && pct >= 0 ? " " + pct + "%" : "");
    if (typeof pct === "number" && pct >= 0) q.bar.style.width = pct + "%";
  }

  async function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    if (!files.length) return;
    var targetPath = folderSelect.value || ROOT;
    var uploadNames = {};
    try {
      var existing = await listFolder(targetPath);
      existing.forEach(function (f) { if (f.type === "file") uploadNames[f.name] = true; });
    } catch (e) { /* 目标文件夹读取失败则跳过重名检查 */ }

    uploadQueue.hidden = false;
    var uids = files.map(function (f) { return addQueueRow(f.name); });
    var failed = 0;

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var uid = uids[i];
      try {
        var isDup = !!uploadNames[f.name];
        var overwrite = false;
        var target = f;
        if (isDup) {
          var choice = await showModal({
            title: "文件已存在",
            message: "目标文件夹中已有同名文件“" + f.name + "”，要如何处理？",
            buttons: [
              { text: "覆盖", value: "overwrite", primary: true },
              { text: "重命名", value: "rename" },
              { text: "取消", value: "cancel" }
            ]
          });
          if (!choice || choice === "cancel") { setQueue(uid, "已取消", 0); continue; }
          if (choice === "overwrite") {
            overwrite = true;
          } else if (choice === "rename") {
            var newName = await showModal({
              title: "重命名",
              message: "请输入新文件名：",
              input: f.name,
              buttons: [
                { text: "确定", value: "ok", primary: true },
                { text: "取消", value: "cancel" }
              ]
            });
            if (!newName) { setQueue(uid, "已取消", 0); continue; }
            target = new File([f], newName, { type: f.type || "" });
            uploadNames[f.name] = false;
            uploadNames[newName] = true;
          }
        } else {
          uploadNames[f.name] = true;
        }
        setQueue(uid, "上传中", 0);
        await uploadFile(targetPath, target, overwrite, uid);
      } catch (err) {
        if (err.auth) return;
        failed++;
        setQueue(uid, "失败：" + friendlyError(err), 0);
      }
    }

    var okCount = files.length - failed;
    showBanner("上传完成：成功 " + okCount + " 个" + (failed ? "，失败 " + failed + " 个" : ""), failed > 0);
    if (state.mode === "download") {
      if (state.selectedPath === targetPath) {
        await selectFolder(targetPath);
      } else if (targetPath === ROOT && state.selectedPath === null) {
        loadHome();
      }
    }
  }

  async function onNewFolder() {
    var parent = folderSelect.value || ROOT;
    var name = await showModal({
      title: "新建子文件夹",
      message: "在“" + relPath(parent) + "”下新建文件夹，请输入名称：",
      input: "",
      buttons: [
        { text: "创建", value: "ok", primary: true },
        { text: "取消", value: "cancel" }
      ]
    });
    if (!name) return;
    name = String(name).trim();
    if (!name) { showBanner("文件夹名称不能为空", true); return; }
    if (name.indexOf("/") >= 0 || name.indexOf("\\") >= 0) {
      showBanner("文件夹名称不能包含 / 或 \\", true);
      return;
    }
    try {
      await createFolder(parent, name);
      var newPath = joinPath(parent, name);
      delete state.treeCache[parent];
      var dirs = await ensureTreeChildren(parent);
      state.treeCache[parent] = dirs;
      state.expanded[newPath] = false;
      if (state.expanded[parent] === "open" || state.expanded[parent] === "loading") {
        state.expanded[parent] = "open";
      }
      renderTree();
      await selectFolder(newPath);
      showBanner("已创建文件夹并选中", false);
    } catch (err) {
      if (err.auth) return;
      showBanner("创建失败：" + friendlyError(err), true);
    }
  }

  function initUpload() {
    ["dragenter", "dragover"].forEach(function (ev) {
      uploadZone.addEventListener(ev, function (e) {
        e.preventDefault();
        uploadZone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      uploadZone.addEventListener(ev, function (e) {
        e.preventDefault();
        uploadZone.classList.remove("dragover");
      });
    });
    uploadZone.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
    uploadZone.addEventListener("click", function () { fileInput.click(); });
    uploadZone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener("change", function () {
      if (fileInput.files.length) handleFiles(fileInput.files);
      fileInput.value = "";
    });
    newFolderBtn.addEventListener("click", onNewFolder);
    /* 右侧下拉选择变化时，同步左侧目录树：展开祖先节点并高亮 */
    folderSelect.addEventListener("change", function () {
      var p = folderSelect.value || ROOT;
      state.selectedPath = p;
      if (state.mode === "upload") {
        revealPath(p).then(function () { renderTree(); }).catch(function (err) {
          if (err.auth) return;
          renderTree();
        });
      } else {
        renderTree();
      }
    });
  }

  /* ================= 搜索 ================= */

  function initSearch() {
    searchInput.addEventListener("input", function () {
      var q = searchInput.value.trim();
      clearTimeout(searchTimer);
      if (!q) { closeSearchPanel(); return; }
      searchTimer = setTimeout(function () { runSearch(q); }, 400);
    });
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(searchTimer);
        runSearch(searchInput.value.trim());
      }
    });
    document.addEventListener("click", function (e) {
      if (!searchWrap.contains(e.target)) closeSearchPanel();
    });
  }

  async function runSearch(q) {
    if (!q) { closeSearchPanel(); return; }
    searchPanel.innerHTML = '<div class="search-item muted">搜索中…</div>';
    searchPanel.hidden = false;
    try {
      var hits = await searchFiles(q);
      if (searchInput.value.trim() !== q) return;
      if (!hits.length) {
        searchPanel.innerHTML = '<div class="search-item muted">没有找到匹配的文件</div>';
        return;
      }
      searchPanel.innerHTML = hits.map(function (h) {
        return '<button class="search-item" data-open="' + esc(dirOf(h.path)) + '">' +
          '<span class="search-name">' + esc(h.name) + '</span>' +
          '<span class="search-path">' + esc(relPath(dirOf(h.path))) + '</span>' +
          '<span class="search-time">' + fmtTime(h.modified) + '</span></button>';
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

  /* ================= 弹窗 ================= */

  function showModal(opts) {
    return new Promise(function (resolve) {
      var title = opts.title || "";
      var message = opts.message || "";
      var inputValue = opts.input;
      var hasInput = inputValue !== undefined;
      var buttons = opts.buttons || [];
      var body = opts.body || "";
      var finished = false;

      function finish(value) {
        if (finished) return;
        finished = true;
        document.removeEventListener("keydown", onKey);
        modalRoot.innerHTML = "";
        resolve(value);
      }

      function onKey(e) {
        if (e.key === "Escape") finish(null);
      }

      modalRoot.innerHTML =
        '<div class="modal-backdrop">' +
        '<div class="modal' + (opts.wide ? " wide" : "") + '">' +
        (title ? '<h3 class="modal-title">' + esc(title) + '</h3>' : "") +
        (message ? '<p class="modal-message">' + esc(message) + '</p>' : "") +
        (hasInput ? '<input class="modal-input" id="modalInput" value="' + esc(inputValue) + '" placeholder="请输入名称">' : "") +
        body +
        (buttons.length ? '<div class="modal-actions">' + buttons.map(function (b, i) {
          return '<button class="btn' + (b.primary ? " primary" : "") + '" data-v="' + i + '">' + esc(b.text) + '</button>';
        }).join("") + '</div>' : "") +
        '</div></div>';

      document.addEventListener("keydown", onKey);
      var backdrop = modalRoot.querySelector(".modal-backdrop");
      backdrop.addEventListener("mousedown", function (e) {
        if (e.target === backdrop) finish(null);
      });

      var btnEls = modalRoot.querySelectorAll("[data-v]");
      Array.prototype.forEach.call(btnEls, function (btn) {
        btn.addEventListener("click", function () {
          var i = Number(btn.getAttribute("data-v"));
          var b = buttons[i];
          var inp = modalRoot.querySelector("#modalInput");
          if (inp) {
            if (b.value === "cancel") finish(null);
            else if (b.value === "ok") finish(inp.value.trim() || null);
            else finish(b.value);
          } else {
            finish(b.value);
          }
        });
      });

      var inp = modalRoot.querySelector("#modalInput");
      if (inp) {
        inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(inp.value.trim() || null);
          }
        });
        setTimeout(function () { inp.focus(); inp.select(); }, 30);
      }
    });
  }

  /* ================= 初始化 ================= */

  function init() {
    /* 每次进入页面都要求重新登录：清掉旧版本可能残留的会话凭据 */
    try { sessionStorage.removeItem(AUTH_KEY); } catch (e) { /* 忽略 */ }
    clearAuth();
    $("brandTitle").textContent = CONFIG.siteTitle || "社团资源库";
    document.title = CONFIG.siteTitle || "社团资源库";
    searchInput.placeholder = CONFIG.searchPlaceholder || "搜索文件名…";
    $("loginForm").addEventListener("submit", doLogin);
    logoutBtn.addEventListener("click", function () {
      clearAuth();
      showLogin("已退出登录");
    });
    $("brandTitle").addEventListener("click", function () {
      if (!getAuth()) return;
      if (state.mode === "upload") switchMode("download");
      else selectRoot();
    });
    treeToggle.addEventListener("click", function () {
      sidebar.classList.add("open");
      sidebarMask.hidden = false;
    });
    sidebarMask.addEventListener("click", closeDrawer);
    window.addEventListener("resize", updateTreeToggle);
    $("modeUpload").addEventListener("click", function () { switchMode("upload"); });
    $("modeDownload").addEventListener("click", function () { switchMode("download"); });
    initUpload();
    initSearch();
    showLogin();
  }

  document.addEventListener("DOMContentLoaded", init);

  /* 浏览器后退/前进恢复页面时也强制重新登录 */
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) {
      clearAuth();
      showLogin();
    }
  });
})();
