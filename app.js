/* 社团资源库 v1 —— 基于 Koofr REST API 的纯静态前端 */
(function () {
  "use strict";

  var CONFIG = window.CLUB_CONFIG || {};
  var BASE = CONFIG.koofrBase || "https://app.koofr.net";
  var MOUNT = CONFIG.mountId || "Koofr";
  var ROOT = CONFIG.rootPath || "/社团资源库";
  var AUTH_KEY = "club_koofr_auth";
  var PREVIEW_EXT = { pdf: 1, jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, bmp: 1, svg: 1 };

  var currentPath = null;       /* 当前浏览的 Koofr 文件夹路径；null 表示首页 */
  var currentFiles = [];        /* 当前文件夹的文件列表 */
  var previewObjectUrl = null;  /* 预览中的 blob URL */
  var memoryAuth = null;        /* sessionStorage 不可用时的兜底 */
  var queueRows = {};           /* uid -> { name, bar, status } */
  var queueUid = 0;
  var bannerTimer = null;

  function authError() {
    var e = new Error("AUTH");
    e.auth = true;
    return e;
  }

  var $ = function (id) { return document.getElementById(id); };
  var loginView = $("loginView");
  var mainView = $("mainView");
  var breadcrumb = $("breadcrumb");
  var content = $("content");
  var banner = $("banner");
  var bannerText = $("bannerText");
  var uploadArea = $("uploadArea");
  var uploadZone = $("uploadZone");
  var fileInput = $("fileInput");
  var uploadQueue = $("uploadQueue");
  var modalRoot = $("modalRoot");

  /* ================= 登录凭据（仅存当前会话） ================= */

  function getAuth() {
    try {
      var raw = sessionStorage.getItem(AUTH_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 隐私模式等场景忽略 */ }
    return memoryAuth;
  }

  function saveAuth(email, password) {
    var b64 = btoa(unescape(encodeURIComponent(email + ":" + password)));
    var data = { email: email, b64: b64 };
    try { sessionStorage.setItem(AUTH_KEY, JSON.stringify(data)); } catch (e) { /* 忽略 */ }
    memoryAuth = data;
  }

  function clearAuth() {
    try { sessionStorage.removeItem(AUTH_KEY); } catch (e) { /* 忽略 */ }
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

  function fileName(p) {
    var parts = String(p).split("/");
    return parts[parts.length - 1];
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

  function showLogin(message) {
    loginView.hidden = false;
    mainView.hidden = true;
    $("logoutBtn").hidden = true;
    hideBanner();
    setLoginError(message || "");
  }

  function showMain() {
    loginView.hidden = true;
    mainView.hidden = false;
    $("logoutBtn").hidden = false;
    hideBanner();
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
      enterHome();
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

  /* ================= 首页（分类卡片） ================= */

  function enterHome() {
    currentPath = null;
    currentFiles = [];
    showMain();
    uploadArea.hidden = true;
    uploadQueue.hidden = true;
    uploadQueue.innerHTML = "";

    var cats = CONFIG.categories || [];
    var cards = cats.map(function (c, i) {
      return '<button class="category-card" data-i="' + i + '">' +
        '<span class="category-icon">' + esc(c.icon || "📁") + '</span>' +
        '<span class="category-name">' + esc(c.name) + '</span></button>';
    }).join("");

    content.innerHTML =
      '<div class="home-head"><h1>' + esc(CONFIG.siteTitle || "社团资源库") + '</h1>' +
      '<p>选择分类进入文件夹</p></div>' +
      '<div class="category-grid">' + (cards || '<div class="empty">尚未配置分类，请修改 config.js</div>') + '</div>';

    breadcrumb.innerHTML = '<span class="crumb current">首页</span>';

    var btns = content.querySelectorAll(".category-card");
    Array.prototype.forEach.call(btns, function (btn) {
      btn.addEventListener("click", function () {
        var c = cats[Number(btn.getAttribute("data-i"))];
        if (c && c.folder) enterFolder(ROOT + "/" + c.folder);
      });
    });
  }

  /* ================= 文件夹视图 ================= */

  function renderBreadcrumb() {
    var rel = currentPath.slice(ROOT.length).split("/").filter(Boolean);
    var acc = ROOT;
    var html = '<button class="crumb-link" data-home="1">🏠 首页</button>' +
      '<span class="crumb-sep">/</span>' +
      '<span class="crumb current">' + esc(fileName(ROOT)) + '</span>';
    rel.forEach(function (seg, i) {
      acc += "/" + seg;
      if (i === rel.length - 1) {
        html += '<span class="crumb-sep">/</span><span class="crumb current">' + esc(seg) + '</span>';
      } else {
        html += '<span class="crumb-sep">/</span><button class="crumb-link" data-path="' + esc(acc) + '">' + esc(seg) + '</button>';
      }
    });
    breadcrumb.innerHTML = html;

    var homeBtns = breadcrumb.querySelectorAll("[data-home]");
    Array.prototype.forEach.call(homeBtns, function (b) {
      b.addEventListener("click", enterHome);
    });
    var pathBtns = breadcrumb.querySelectorAll("[data-path]");
    Array.prototype.forEach.call(pathBtns, function (b) {
      b.addEventListener("click", function () { enterFolder(b.getAttribute("data-path")); });
    });
  }

  async function enterFolder(path) {
    currentPath = path;
    showMain();
    uploadArea.hidden = false;
    uploadQueue.hidden = true;
    uploadQueue.innerHTML = "";
    renderBreadcrumb();
    content.innerHTML = '<div class="loading">加载中…</div>';
    try {
      currentFiles = await listFolder(path);
      renderFileList(currentFiles);
    } catch (err) {
      if (err.auth) return;
      currentFiles = [];
      var msg = friendlyError(err);
      if (err.status === 404) msg = "文件夹不存在，请先在 Koofr 网页端创建后再试（见 README）。";
      content.innerHTML = '<div class="error-box">加载失败：' + esc(msg) +
        '<br><button class="btn" id="reloadBtn">刷新</button></div>';
      var rb = $("reloadBtn");
      if (rb) rb.addEventListener("click", function () { enterFolder(path); });
    }
  }

  function renderFileList(files) {
    var sorted = files.slice().sort(function (a, b) {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-CN");
    });

    if (!sorted.length) {
      content.innerHTML = '<div class="empty">📂 此文件夹还没有文件，把文件拖到上方上传区。</div>';
      return;
    }

    var rows = sorted.map(function (f) {
      if (f.type === "dir") {
        return '<div class="file-row dir">' +
          '<span class="file-icon">📁</span>' +
          '<button class="file-name" data-dir="' + esc(f.name) + '">' + esc(f.name) + '</button>' +
          '<span class="file-meta">文件夹</span></div>';
      }
      var previewable = isPreviewable(f.name);
      return '<div class="file-row">' +
        '<span class="file-icon">' + fileIcon(f.name) + '</span>' +
        '<button class="file-name" data-download="' + esc(f.name) + '">' + esc(f.name) + '</button>' +
        '<span class="file-meta">' + fmtSize(f.size) + ' · ' + fmtTime(f.modified) + '</span>' +
        '<span class="file-actions">' +
        (previewable ? '<button class="btn small" data-preview="' + esc(f.name) + '">预览</button>' : "") +
        '<button class="btn small" data-download2="' + esc(f.name) + '">下载</button>' +
        '</span></div>';
    }).join("");
    content.innerHTML = '<div class="file-list">' + rows + '</div>';

    var dirBtns = content.querySelectorAll("[data-dir]");
    Array.prototype.forEach.call(dirBtns, function (b) {
      b.addEventListener("click", function () {
        enterFolder(currentPath + "/" + b.getAttribute("data-dir"));
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-download], [data-download2]"), function (b) {
      b.addEventListener("click", function () {
        var name = b.getAttribute("data-download") || b.getAttribute("data-download2");
        downloadFile(currentPath + "/" + name).catch(function (err) {
          if (!err.auth) showBanner(friendlyError(err), true);
        });
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-preview]"), function (b) {
      b.addEventListener("click", function () {
        previewFile(b.getAttribute("data-preview")).catch(function (err) {
          if (!err.auth) showBanner(friendlyError(err), true);
        });
      });
    });
  }

  /* ================= 预览 ================= */

  async function previewFile(name) {
    var path = currentPath + "/" + name;
    var res = await koofrFetch(getUrl(path, false));
    if (!res.ok) throw new Error(await apiErrorText(res));
    var blob = await res.blob();
    var objUrl = URL.createObjectURL(blob);
    previewObjectUrl = objUrl;
    var isPdf = extOf(name) === "pdf";
    var body = isPdf
      ? '<iframe class="preview-frame" src="' + objUrl + '"></iframe>'
      : '<img class="preview-img" src="' + objUrl + '" alt="' + esc(name) + '">';
    var action = await showModal({
      title: name,
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
    var targetPath = currentPath;
    var uploadNames = {};
    currentFiles.forEach(function (f) { if (f.type === "file") uploadNames[f.name] = true; });

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
            message: "文件夹中已有同名文件“" + f.name + "”，要如何处理？",
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
    if (currentPath === targetPath) await enterFolder(targetPath);
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
        (hasInput ? '<input class="modal-input" id="modalInput" value="' + esc(inputValue) + '" placeholder="请输入文件名">' : "") +
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
    $("brandTitle").textContent = CONFIG.siteTitle || "社团资源库";
    document.title = CONFIG.siteTitle || "社团资源库";
    $("loginForm").addEventListener("submit", doLogin);
    $("logoutBtn").addEventListener("click", function () {
      clearAuth();
      currentPath = null;
      currentFiles = [];
      showLogin("已退出登录");
    });
    initUpload();
    if (getAuth()) enterHome();
    else showLogin();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
