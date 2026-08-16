/* 社团资源库 v1.5 —— 双栏浏览模式（目录树 + 内容区），基于 Koofr REST API */
  "use strict";

  var AUTH_KEY = "club_koofr_auth";
  var MOBILE_MQ = "(max-width: 768px)";   /* 与 CSS 断点保持一致 */
  var RECENT_LIMIT = 4;    /* 主页"最新资料更新"展示条数 */



  var state = {
    selectedPath: null,   /* null 表示根节点（右侧显示主页） */
    currentFiles: [],
    treeCache: {},        /* path -> 子文件夹数组；undefined 表示未加载 */
    expanded: {},         /* path -> false | "open" | "loading" */
    mode: "download",     /* "upload" 或 "download" */
    selected: {},         /* 下载模式勾选的文件路径集合 */
    batchArmed: false,    /* 批量下载二次确认状态 */
    folderArmed: false    /* 下载整个文件夹的二次确认状态 */
  };

  var queueRows = {};
  var queueUid = 0;
  var searchTimer = null;
  var confirmPath = null;   /* 二次确认下载：当前处于确认态的文件路径 */
  var confirmTimer = null;
  var batchTimer = null;
  var folderConfirmTimer = null;

  var $ = function (id) { return document.getElementById(id); };
  var loginView = $("loginView");
  var mainView = $("mainView");
  var logoutBtn = $("logoutBtn");
  var statusBar = $("statusBar");
  var statusText = $("statusText");
  var statusProgress = $("statusProgress");
  var statusProgressBar = $("statusProgressBar");
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
  var searchScope = $("searchScope");
  var searchPanel = $("searchPanel");
  var modalRoot = $("modalRoot");
  var batchBar = $("batchBar");
  var batchCount = $("batchCount");
  var batchDownloadBtn = $("batchDownloadBtn");
  var batchClearBtn = $("batchClearBtn");
  var guideBtn = $("guideBtn");
  var topbar = document.querySelector(".topbar");
  var searchIcon = document.querySelector(".search-icon");
  var searchClose = document.querySelector(".search-close");

  /* ================= 内联 SVG 图标（Linear 风格，统一 1.6 描边） ================= */
  function svgIcon(inner, cls) {
    return '<svg class="ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }
  var ICONS = {
    logo: svgIcon('<rect x="3.5" y="4" width="17" height="5" rx="1.5"></rect><rect x="3.5" y="9.5" width="17" height="5" rx="1.5"></rect><rect x="3.5" y="15" width="17" height="5" rx="1.5"></rect>'),
    folder: svgIcon('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-10z"></path>'),
    file: svgIcon('<path d="M6.5 3.5h7l4 4v12a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"></path><path d="M13.5 3.5v4h4"></path>'),
    pdf: svgIcon('<path d="M6.5 3.5h7l4 4v12a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"></path><path d="M13.5 3.5v4h4"></path><path d="M9 13.5h6M9 16.5h3.5"></path>'),
    doc: svgIcon('<path d="M6.5 3.5h7l4 4v12a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"></path><path d="M13.5 3.5v4h4"></path><path d="M9 13.5h6M9 16.5h6"></path>'),
    sheet: svgIcon('<rect x="4" y="3.5" width="16" height="17" rx="2"></rect><path d="M4 9h16M4 14.5h16M9.5 3.5v17M14.5 3.5v17"></path>'),
    slide: svgIcon('<rect x="3.5" y="4.5" width="17" height="12" rx="2"></rect><path d="M9 20h6M12 16.5V20"></path>'),
    archive: svgIcon('<path d="M4 8.5h16v10a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-10z"></path><path d="M3.5 8.5L5 4.5h14l1.5 4"></path><path d="M10 12.5h4"></path>'),
    video: svgIcon('<rect x="3" y="5" width="13.5" height="14" rx="2"></rect><path d="M16.5 10l4.5-2.5v9L16.5 14"></path>'),
    audio: svgIcon('<path d="M9 17.5V6l8-2v11.5"></path><circle cx="6.5" cy="17.5" r="2.5"></circle><circle cx="14.5" cy="15.5" r="2.5"></circle>'),
    image: svgIcon('<rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="10" r="1.6"></circle><path d="M3.5 16.5l5-4.5 4 3.5 3-2.5 5 4"></path>'),
    book: svgIcon('<path d="M12 6.2C10.4 4.9 8.3 4 6 4H3.5v13.5H6c2.3 0 4.4.9 6 2.3 1.6-1.4 3.7-2.3 6-2.3h2.5V4H18c-2.3 0-4.4.9-6 2.2z"></path><path d="M12 6.2v13.6"></path>'),
    trophy: svgIcon('<path d="M8 3.5h8v6.5a4 4 0 0 1-8 0V3.5z"></path><path d="M8 5H4.5v1.5A3 3 0 0 0 7.5 9.5M16 5h3.5v1.5a3 3 0 0 1-3 3"></path><path d="M12 14v3M8.5 20.5h7"></path>'),
    camera: svgIcon('<path d="M4 8.5h3l1.8-2.5h6.4L17 8.5h3a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"></path><circle cx="12" cy="13" r="3.2"></circle>'),
    note: svgIcon('<path d="M6 3.5h12a1 1 0 0 1 1 1v13l-4.5 4.5H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z"></path><path d="M14.5 18.5V22M8 8.5h8M8 12h8"></path>'),
    home: svgIcon('<path d="M3.5 10.5L12 3.5l8.5 7"></path><path d="M5.5 9v11h13V9"></path>'),
    search: svgIcon('<circle cx="11" cy="11" r="6"></circle><path d="M20.5 20.5L15.5 15.5"></path>'),
    download: svgIcon('<path d="M12 4v10M8 10l4 4 4-4"></path><path d="M4.5 20h15"></path>'),
    upload: svgIcon('<path d="M12 14V4M8 8l4-4 4 4"></path><path d="M4.5 20h15"></path>'),
    preview: svgIcon('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"></path><circle cx="12" cy="12" r="2.8"></circle>'),
    plus: svgIcon('<path d="M12 5v14M5 12h14"></path>'),
    check: svgIcon('<path d="M5 12.5l4.5 4.5L19 7"></path>'),
    chevronRight: svgIcon('<path d="M9 5.5l6.5 6.5L9 18.5"></path>'),
    chevronDown: svgIcon('<path d="M5.5 9L12 15.5 18.5 9"></path>'),
    menu: svgIcon('<path d="M4 6.5h16M4 12h16M4 17.5h16"></path>'),
    logout: svgIcon('<path d="M14 4H6.5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1H14"></path><path d="M17 8.5l3.5 3.5-3.5 3.5"></path><path d="M20.5 12H10"></path>'),
    guide: svgIcon('<path d="M12 4.5L2.5 9.5 12 14.5l9.5-5L12 4.5z"></path><path d="M6 12v4c0 1.5 2.7 2.8 6 2.8s6-1.3 6-2.8v-4"></path><path d="M21.5 9.5v5"></path>')
  };
  /* config.js 里的分类 emoji 图标 → SVG 映射（config.js 保持零改动） */
  var EMOJI_ICON_MAP = {
    "\u{1F4DA}": ICONS.book,
    "\u{1F3C6}": ICONS.trophy,
    "\u{1F4F7}": ICONS.camera,
    "\u{1F4DD}": ICONS.note,
    "\u{1F4C1}": ICONS.folder,
    "\u{1F4C2}": ICONS.folder
  };

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
    if (ext === "pdf") return ICONS.pdf;
    if (["doc", "docx"].indexOf(ext) >= 0) return ICONS.doc;
    if (["xls", "xlsx", "csv"].indexOf(ext) >= 0) return ICONS.sheet;
    if (["ppt", "pptx"].indexOf(ext) >= 0) return ICONS.slide;
    if (["zip", "rar", "7z", "tar", "gz"].indexOf(ext) >= 0) return ICONS.archive;
    if (["mp4", "mov", "avi", "mkv"].indexOf(ext) >= 0) return ICONS.video;
    if (["mp3", "wav", "flac", "aac"].indexOf(ext) >= 0) return ICONS.audio;
    if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "avif", "tif", "tiff"].indexOf(ext) >= 0) return ICONS.image;
    return ICONS.file;
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

  /* ================= 视图切换 ================= */

  function resetState() {
    state = {
      selectedPath: null,
      currentFiles: [],
      treeCache: {},
      expanded: {},
      mode: "download",
      selected: {},
      batchArmed: false,
      folderArmed: false
    };
  }

  /* 退出登录/会话失效时：清空内存缓存与确认定时器，做到无残留 */
  function clearAllCaches() {
    dataCache = { lists: {}, home: null };
    searchIndex = null;
    if (confirmPath) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
      confirmPath = null;
    }
    clearTimeout(folderConfirmTimer);
    clearTimeout(batchTimer);
  }

  function closeDrawer() {
    sidebar.classList.remove("open");
    sidebarMask.hidden = true;
  }

  function closeSearchPanel() {
    searchPanel.hidden = true;
    searchPanel.innerHTML = "";
  }

  function openMobileSearch() {
    if (!topbar) return;
    topbar.classList.add("search-open");
    searchInput.focus();
  }

  function closeMobileSearch() {
    if (!topbar) return;
    topbar.classList.remove("search-open");
    searchInput.blur();
    closeSearchPanel();
  }

  function showLogin(message) {
    resetState();
    clearAllCaches();
    loginView.hidden = false;
    mainView.hidden = true;
    logoutBtn.hidden = true;
    treeToggle.hidden = true;
    if (topbar) topbar.classList.remove("search-open");
    if (searchIcon) searchIcon.hidden = true;
    searchWrap.hidden = true;
    $("modeToggle").hidden = true;
    guideBtn.hidden = true;
    breadcrumb.innerHTML = "";
    content.innerHTML = "";
    tree.innerHTML = "";
    uploadArea.hidden = true;
    uploadQueue.hidden = true;
    uploadQueue.innerHTML = "";
    closeDrawer();
    closeSearchPanel();
    batchBar.hidden = true;
    document.body.classList.remove("batch-active");
    hideBanner();
    setLoginError(message || "");
  }

  function showMain() {
    loginView.hidden = true;
    mainView.hidden = false;
    logoutBtn.hidden = false;
    if (searchIcon) searchIcon.hidden = false;
    searchWrap.hidden = false;
    $("modeToggle").hidden = false;
    guideBtn.hidden = false;
    updateTreeToggle();
    hideBanner();
  }

  function updateTreeToggle() {
    treeToggle.hidden = !window.matchMedia(MOBILE_MQ).matches;
    if (state.selectedPath !== null && state.mode === "download") {
      breadcrumb.hidden = !window.matchMedia(MOBILE_MQ).matches;
      if (!breadcrumb.hidden && !breadcrumb.innerHTML) renderBreadcrumb();
    } else {
      breadcrumb.hidden = true;
    }
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
    statusBar.className = "status-bar" + (isError ? " error" : "");
    statusText.textContent = msg;
    statusProgress.hidden = true;
  }

  function hideBanner() {
    statusText.textContent = "状态栏：当前为空";
    statusProgress.hidden = true;
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
    content.innerHTML = '<div class="loading">正在加载…</div>';
    /* 登录后后台预加载整库缓存，进入子文件夹秒开 */
    preloadCache().then(function () {
      if (getAuth()) selectRoot();
    });
    maybeAutoGuide();
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
    updateBatchBar();
  }

  function switchMode(mode, keepPosition) {
    if (state.mode === mode) return;
    state.mode = mode;
    applyModeLayout(mode);
    if (mode === "upload") {
      fillFolderSelect(state.selectedPath || ROOT);
      if (keepPosition && state.selectedPath) {
        syncTreeToSelection(state.selectedPath);
      } else {
        renderTree();
      }
    } else {
      /* 两种模式共享当前选中位置：上传模式里打开的文件夹切回下载也应保持 */
      if (keepPosition && state.selectedPath && state.selectedPath !== ROOT) {
        selectFolder(state.selectedPath);
      } else {
        selectRoot();
      }
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
    return c && EMOJI_ICON_MAP[c.icon] ? EMOJI_ICON_MAP[c.icon] : ICONS.folder;
  }

  async function ensureTreeChildren(path) {
    if (state.treeCache[path] !== undefined) return state.treeCache[path];
    var dirs = await listDirs(path);
    state.treeCache[path] = dirs;
    return dirs;
  }

  /* 展开路径上所有祖先节点，让指定文件夹在树中可见并高亮 */
  async function revealPath(path) {
    await ensureTreeChildren(ROOT);
    state.expanded[ROOT] = "open";
    var rel = path.slice(ROOT.length).split("/").filter(Boolean);
    var acc = ROOT;
    for (var i = 0; i < rel.length; i++) {
      acc = joinPath(acc, rel[i]);
      await ensureTreeChildren(acc);
      state.expanded[acc] = "open";
    }
  }

  /* 打开文件夹时，自动在左侧目录树展开该文件夹及其所有父级 */
  function syncTreeToSelection(path) {
    revealPath(path).then(function () {
      renderTree();
    }).catch(function (err) {
      if (!err.auth) renderTree();
    });
  }

  function buildNodeHtml(path, depth, isRoot) {
    var name = fileName(path);
    var isOpen = state.expanded[path] === "open";
    var isLoading = state.expanded[path] === "loading";
    var children = state.treeCache[path];
    var hasChildren = isOpen && Array.isArray(children) && children.length > 0;
    var icon = isRoot ? ICONS.logo : treeIcon(name);
    var indent = depth * 14;
    var active = isRoot ? (state.selectedPath === null || state.selectedPath === path) : (state.selectedPath === path);
    var html = '<div class="tree-node" style="padding-left:' + indent + 'px">';
    if (isLoading) {
      html += '<span class="tree-toggle"><span class="tree-spinner"></span></span><span class="tree-label muted">加载中…</span>';
    } else {
      html += '<button class="tree-toggle" data-toggle="' + esc(path) + '">' + (isOpen ? ICONS.chevronDown : ICONS.chevronRight) + '</button>';
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
    clearSelection();
    state.selectedPath = null;
    breadcrumb.hidden = true;
    renderTree();
    closeSearchPanel();
    closeMobileSearch();
    closeDrawer();
    fillFolderSelect(ROOT);
    if (state.mode === "download") {
      loadHome();
    }
  }

  async function selectFolder(path) {
    clearSelection();
    state.selectedPath = path;
    renderTree();
    closeSearchPanel();
    closeMobileSearch();
    closeDrawer();
    fillFolderSelect(path);
    syncTreeToSelection(path);
    if (state.mode === "upload") return;
    /* 移动端显示面包屑路径（桌面端保持现状：不显示） */
    if (window.matchMedia(MOBILE_MQ).matches) {
      renderBreadcrumb();
      breadcrumb.hidden = false;
    } else {
      breadcrumb.hidden = true;
    }
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
      breadcrumb.innerHTML = '<span class="crumb current">' + ICONS.home + '<span>主页</span></span>';
      return;
    }
    var rel = state.selectedPath.slice(ROOT.length).split("/").filter(Boolean);
    var acc = ROOT;
    var html = '<button class="crumb-link" data-root="1">' + ICONS.home + '<span>主页</span></button>' +
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
    /* 移动端深层路径较长时，自动滚到末尾保证当前路径可见 */
    if (window.matchMedia(MOBILE_MQ).matches) {
      breadcrumb.scrollLeft = breadcrumb.scrollWidth;
    }
  }

  /* ================= 右侧内容 ================= */

  /* 登录后后台预加载：一次递归读取整库，填充文件列表/目录树/主页缓存（60 秒） */
  async function preloadCache() {
    try {
      var items = await listRecursiveAll(ROOT);
      var ts = Date.now();
      var filesByDir = {};
      var dirsByDir = {};
      var homeFiles = [];
      items.forEach(function (it) {
        if (it.relPath === "/") return;
        var abs = normalizeAbs(ROOT, it.relPath);
        var parent = dirOf(abs);
        if (it.type === "dir") {
          (dirsByDir[parent] = dirsByDir[parent] || []).push({ name: it.name, path: abs });
        } else {
          (filesByDir[parent] = filesByDir[parent] || []).push({
            name: it.name,
            type: "file",
            size: it.size,
            modified: it.modified,
            contentType: it.contentType
          });
          homeFiles.push({
            name: it.name,
            relPath: it.relPath,
            modified: it.modified,
            size: it.size,
            contentType: it.contentType
          });
        }
      });
      Object.keys(filesByDir).forEach(function (p) {
        dataCache.lists[p] = { files: filesByDir[p], ts: ts };
      });
      Object.keys(dirsByDir).forEach(function (p) {
        if (state.treeCache[p] === undefined) state.treeCache[p] = dirsByDir[p];
      });
      var dirs = dirsByDir[ROOT] || [];
      var cards = dirs.map(function (d) {
        var prefix = d.path + "/";
        var count = 0;
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (it.type === "file" && normalizeAbs(ROOT, it.relPath).indexOf(prefix) === 0) count++;
        }
        return {
          name: d.name,
          path: d.path,
          icon: treeIcon(d.name),
          count: count,
          dirCount: (dirsByDir[d.path] || []).length
        };
      });
      dataCache.home = { cards: cards, items: homeFiles, ts: ts };
    } catch (e) { /* 预加载失败则按需加载 */ }
  }

  function loadHome() {
    var c = dataCache.home;
    if (c && Date.now() - c.ts < CACHE_TTL) {
      renderHome(c.cards, c.items);
      return Promise.resolve();
    }
    content.innerHTML = '<div class="loading">正在加载主页…</div>';
    return listRecursiveAll(ROOT).then(function (all) {
      var rootDirs = [];
      var dirsByParent = {};
      var homeFiles = [];
      all.forEach(function (it) {
        if (it.relPath === "/") return;
        var abs = normalizeAbs(ROOT, it.relPath);
        var parent = dirOf(abs);
        if (it.type === "dir") {
          (dirsByParent[parent] = dirsByParent[parent] || []).push({ name: it.name, path: abs });
          if (parent === ROOT) rootDirs.push({ name: it.name, path: abs });
        } else {
          homeFiles.push({
            name: it.name,
            relPath: it.relPath,
            modified: it.modified,
            size: it.size,
            contentType: it.contentType
          });
        }
      });
      if (state.treeCache[ROOT] === undefined) state.treeCache[ROOT] = rootDirs;
      var cards = rootDirs.map(function (d) {
        var prefix = d.path + "/";
        var count = 0;
        for (var i = 0; i < all.length; i++) {
          var it = all[i];
          if (it.type === "file" && normalizeAbs(ROOT, it.relPath).indexOf(prefix) === 0) count++;
        }
        return {
          name: d.name,
          path: d.path,
          icon: treeIcon(d.name),
          count: count,
          dirCount: (dirsByParent[d.path] || []).length
        };
      });
      dataCache.home = { cards: cards, items: homeFiles, ts: Date.now() };
      renderHome(cards, homeFiles);
    }).catch(function (err) {
      if (err.auth) return;
      content.innerHTML = '<div class="error-box">加载主页失败：' + esc(friendlyError(err)) +
        '<br><button class="btn" data-reload="1">重试</button></div>';
      wireReload();
    });
  }

  function renderHome(cards, items) {
    var updates = items.slice().sort(function (a, b) { return b.modified - a.modified; }).slice(0, RECENT_LIMIT);
    var cardHtml = cards.length
      ? cards.map(function (c) {
          return '<div class="subject-card" data-open="' + esc(c.path) + '" title="进入「' + esc(c.name) + '」">' +
            '<div class="sc-icon">' + c.icon + '</div>' +
            '<div class="sc-name">' + esc(c.name) + '</div>' +
            '<div class="sc-meta">' + (c.count === null ? "份数未知" : c.count + " 份资料") +
            ' ' + (c.dirCount === null ? "文件夹数未知" : c.dirCount + " 个文件夹") + '</div>' +
            '<div class="subject-right">' +
            '<span class="count">' + (c.count === null ? "?" : c.count) + '</span>' +
            '<span class="count folder-count">' + ICONS.folder + (c.dirCount === null ? "?" : c.dirCount) + '</span>' +
            '</div>' +
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
            '<div class="update-meta">' + ICONS.file + '<span>文件 · ' + fmtSize(u.size) + ' · ' + fmtTime(u.modified) + '</span></div>' +
            '</div>' +
            '<span class="go">' + ICONS.chevronRight + '</span></button>';
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

    var cards = fileItems.map(function (f) {
      var full = joinPath(state.selectedPath, f.name);
      var previewable = isPreviewable(f.name);
      var ext = (extOf(f.name) || "文件").toUpperCase();
      var isSel = !!state.selected[full];
      return '<div class="res-card' + (isSel ? " selected" : "") + '" data-path="' + esc(full) +
        '" data-card-preview="' + esc(full) + '" data-card-download="' + esc(full) +
        '" data-card-previewable="' + (previewable ? 1 : 0) + '" title="点击两次下载（先确认后下载）">' +
        '<label class="res-check" title="选择以批量下载">' +
        '<input type="checkbox" class="res-select" data-select-path="' + esc(full) + '"' + (isSel ? " checked" : "") + '>' +
        '</label>' +
        '<div class="res-info">' +
        '<div class="res-title">' + esc(f.name) + '</div>' +
        '<div class="res-meta">' + ICONS.file + '<span>' + esc(ext) + ' · 文件 · ' + fmtSize(f.size) + ' · ' + fmtTime(f.modified) + '</span></div>' +
        '</div>' +
        '<div class="res-actions">' +
        (previewable ? '<button class="btn edit" data-preview="' + esc(full) + '">' + ICONS.preview + '<span>预览</span></button>' : "") +
        '<button class="btn download" data-confirm-download="' + esc(full) + '">' + ICONS.download + '<span>下载</span></button>' +
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
      '<button class="folder-chip folder-dl" data-download-folder="1">' + ICONS.download + '<span>下载整个文件夹</span></button>' +
      '</div>' +
      '<div class="res-list">' + (cards || '<div class="empty">暂无资料<br>切到「上传」模式添加文件</div>') + '</div>';

    var homeBtn = content.querySelector("[data-home]");
    if (homeBtn) homeBtn.addEventListener("click", selectRoot);
    var dfBtn = content.querySelector("[data-download-folder]");
    if (dfBtn) {
      dfBtn.addEventListener("click", function () {
        if (!state.folderArmed) {
          state.folderArmed = true;
          dfBtn.innerHTML = "✔ 再次点击确认下载";
          clearTimeout(folderConfirmTimer);
          folderConfirmTimer = setTimeout(function () {
            resetFolderDlBtn(dfBtn);
          }, 3000);
          return;
        }
        clearTimeout(folderConfirmTimer);
        resetFolderDlBtn(dfBtn);
        showBanner("正在打包下载…", false);
        downloadFolderZip(state.selectedPath, function (loaded, total) {
          showTransferProgress("正在打包下载整个文件夹", loaded, total);
        }).then(function () {
          showBanner("已下载完成整个文件夹", false);
        }).catch(function (err) {
          if (err.auth) return;
          showBanner(friendlyError(err), true);
        });
      });
    }
    var cardEls = content.querySelectorAll(".res-card[data-card-previewable]");
    Array.prototype.forEach.call(cardEls, function (card) {
      card.addEventListener("click", function (e) {
        /* 按钮点击会替换 innerHTML，目标节点可能已脱离文档，此时直接忽略 */
        if (!card.contains(e.target)) return;
        if (e.target.closest && (e.target.closest(".res-check") || e.target.closest(".res-actions"))) return;
        armConfirm(card.getAttribute("data-path"));
      });
    });
    var checkEls = content.querySelectorAll(".res-select");
    Array.prototype.forEach.call(checkEls, function (cb) {
      cb.addEventListener("change", function () {
        toggleSelect(cb.getAttribute("data-select-path"), cb.checked);
      });
    });
    var confirmEls = content.querySelectorAll("[data-confirm-download]");
    Array.prototype.forEach.call(confirmEls, function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        armConfirm(b.getAttribute("data-confirm-download"));
      });
    });
    wireFileActions();
    updateBatchBar();
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
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        previewFile(b.getAttribute("data-preview")).catch(function (err) {
          if (!err.auth) showBanner(friendlyError(err), true);
        });
      });
    });
    var dlBtns = content.querySelectorAll("[data-download]");
    Array.prototype.forEach.call(dlBtns, function (b) {
      b.addEventListener("click", function () {
        downloadWithProgress(b.getAttribute("data-download")).catch(function (err) {
          if (!err.auth) showBanner(friendlyError(err), true);
        });
      });
    });
  }

  /* ================= 二次确认下载与批量选择 ================= */

  function clearSelection() {
    state.selected = {};
    state.batchArmed = false;
    state.folderArmed = false;
    clearTimeout(folderConfirmTimer);
    if (confirmPath) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
      confirmPath = null;
    }
    updateBatchBar();
  }

  function updateBatchBar() {
    var n = Object.keys(state.selected).length;
    var show = state.mode === "download" && state.selectedPath !== null && n > 0;
    batchBar.hidden = !show;
    document.body.classList.toggle("batch-active", show);
    batchCount.textContent = String(n);
    batchDownloadBtn.textContent = state.batchArmed ? "再次点击确认下载" : "批量下载";
  }

  function updateCardSelection() {
    Array.prototype.forEach.call(content.querySelectorAll(".res-card[data-path]"), function (card) {
      card.classList.toggle("selected", !!state.selected[card.getAttribute("data-path")]);
    });
    Array.prototype.forEach.call(content.querySelectorAll(".res-select"), function (cb) {
      cb.checked = !!state.selected[cb.getAttribute("data-select-path")];
    });
  }

  function toggleSelect(path, on) {
    if (on) state.selected[path] = true;
    else delete state.selected[path];
    state.batchArmed = false;
    clearTimeout(batchTimer);
    updateCardSelection();
    updateBatchBar();
  }

  function armConfirm(path) {
    if (confirmPath === path) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
      confirmPath = null;
      refreshConfirmUI();
      downloadWithProgress(path).catch(function (err) {
        if (!err.auth) showBanner(friendlyError(err), true);
      });
      return;
    }
    if (confirmPath) clearTimeout(confirmTimer);
    confirmPath = path;
    confirmTimer = setTimeout(function () {
      confirmPath = null;
      refreshConfirmUI();
    }, 3000);
    refreshConfirmUI();
  }

  function refreshConfirmUI() {
    Array.prototype.forEach.call(content.querySelectorAll(".res-card[data-path]"), function (card) {
      var path = card.getAttribute("data-path");
      var armed = confirmPath === path;
      card.classList.toggle("armed", armed);
      var btn = card.querySelector(".btn.download");
      if (btn) btn.innerHTML = (armed ? ICONS.check : ICONS.download) + '<span>' + (armed ? "再次点击下载" : "下载") + '</span>';
    });
  }

  /* 下载进度提示（节流显示，避免频繁刷新） */
  var lastProgressTick = 0;
  function showTransferProgress(label, loaded, total) {
    var now = Date.now();
    if (now - lastProgressTick < 300 && loaded < total) return;
    lastProgressTick = now;
    var pct = total ? Math.round((loaded / total) * 100) : 0;
    statusBar.className = "status-bar";
    statusText.textContent = label + "：" + fmtSize(loaded) + (total ? " / " + fmtSize(total) + "（" + pct + "%）" : "");
    statusProgress.hidden = false;
    statusProgressBar.style.width = pct + "%";
  }

  /* 单文件下载：显示进度，完成后提示 */
  function downloadWithProgress(path) {
    var name = fileName(path);
    return downloadFile(path, function (loaded, total) {
      showTransferProgress("正在下载「" + name + "」", loaded, total);
    }).then(function () {
      showBanner("已下载完成「" + name + "」", false);
    });
  }

  /* Koofr 支持把文件夹内选中的文件打包下载 */
  function downloadFolderZip(folderPath, onProgress) {
    return batchDownloadZip(folderPath, [], onProgress);
  }

  /* 复位"下载整个文件夹"按钮的确认态与文案 */
  function resetFolderDlBtn(btn) {
    state.folderArmed = false;
    if (btn && btn.isConnected) {
      btn.innerHTML = ICONS.download + '<span>下载整个文件夹</span>';
    }
  }

  async function onBatchDownload() {
    var paths = Object.keys(state.selected);
    if (!paths.length) { showBanner("请先选择资料", true); return; }
    if (!state.batchArmed) {
      state.batchArmed = true;
      clearTimeout(batchTimer);
      updateBatchBar();
      batchTimer = setTimeout(function () { state.batchArmed = false; updateBatchBar(); }, 3000);
      return;
    }
    state.batchArmed = false;
    updateBatchBar();
    var folderPath = state.selectedPath;
    showBanner("正在打包下载…", false);
    try {
      if (paths.length === 1) {
        await downloadWithProgress(paths[0]);
        showBanner("已下载完成「" + fileName(paths[0]) + "」", false);
      } else {
        await batchDownloadZip(folderPath, paths.map(fileName), function (loaded, total) {
          showTransferProgress("正在打包下载", loaded, total);
        });
        showBanner("已打包下载 " + paths.length + " 个文件", false);
      }
    } catch (err) {
      if (err.auth) return;
      showBanner("打包失败，改为逐个下载", true);
      var ok = 0;
      for (var i = 0; i < paths.length; i++) {
        try { await downloadWithProgress(paths[i]); ok++; } catch (e2) { if (e2.auth) return; }
        await new Promise(function (r) { setTimeout(r, 250); });
      }
      showBanner("已下载 " + ok + " 个文件", ok < paths.length);
    }
  }

  function onBatchClear() {
    state.selected = {};
    state.batchArmed = false;
    clearTimeout(batchTimer);
    updateCardSelection();
    updateBatchBar();
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
    /* 文件夹选择（webkitdirectory）带相对路径：自动新建同名文件夹结构后上传 */
    var hasFolderPath = files.some(function (f) {
      return f && f.webkitRelativePath && f.webkitRelativePath.indexOf("/") >= 0;
    });
    if (hasFolderPath) {
      await handleFolderFiles(files, targetPath);
      return;
    }
    var items = files.map(function (f) { return { file: f, path: targetPath }; });
    await uploadFileList(items, targetPath);
  }

  /* 按 webkitRelativePath 重建同名文件夹结构：目标/选中文件夹/子目录/文件 */
  async function handleFolderFiles(files, targetPath) {
    var items = [];
    var dirSet = {};
    files.forEach(function (f) {
      var rel = (f.webkitRelativePath || f.name).split("/").filter(Boolean);
      rel.pop();
      var dirPath = targetPath;
      rel.forEach(function (seg) {
        dirPath = joinPath(dirPath, seg);
        dirSet[dirPath] = true;
      });
      items.push({ file: f, path: dirPath });
    });
    await ensureDirs(dirSet, targetPath);
    await uploadFileList(items, targetPath);
  }

  /* 依次确保目录存在：缺失则新建（含空目录），并同步目录树 */
  async function ensureDirs(dirSet, targetPath) {
    var dirs = Object.keys(dirSet).sort(function (a, b) {
      return a.split("/").length - b.split("/").length;
    });
    var treeDirty = false;
    for (var i = 0; i < dirs.length; i++) {
      var d = dirs[i];
      if (d === targetPath) continue;
      try {
        await listFolder(d);
      } catch (e) {
        try {
          await createFolder(dirOf(d), fileName(d));
          delete state.treeCache[dirOf(d)];
          invalidatePath(dirOf(d));
          treeDirty = true;
        } catch (e2) { /* 已存在或创建失败则继续尝试上传 */ }
      }
    }
    if (treeDirty) renderTree();
  }

  /* 通用上传队列：items = [{ file, path }]，支持多目标文件夹 */
  async function uploadFileList(items, defaultPath) {
    if (!items.length) return;
    var paths = {};
    items.forEach(function (it) { paths[it.path] = true; });

    /* 各目标文件夹的现有文件名，用于重名检查 */
    var existingByPath = {};
    await Promise.all(Object.keys(paths).map(function (p) {
      return listFolder(p).then(function (files) {
        var names = {};
        files.forEach(function (f) { if (f.type === "file") names[f.name] = true; });
        existingByPath[p] = names;
      }).catch(function () { existingByPath[p] = {}; });
    }));

    uploadQueue.hidden = false;
    var uids = items.map(function (it) { return addQueueRow(it.file.name); });
    var failed = 0;

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var f = it.file;
      var uid = uids[i];
      var uploadNames = existingByPath[it.path] || {};
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
        await uploadFile(it.path, target, overwrite, uid);
      } catch (err) {
        if (err.auth) return;
        failed++;
        setQueue(uid, "失败：" + friendlyError(err), 0);
      }
    }

    var okCount = items.length - failed;
    Object.keys(paths).forEach(function (p) { invalidatePath(p); });
    showBanner("上传完成：成功 " + okCount + " 个" + (failed ? "，失败 " + failed + " 个" : ""), failed > 0);
    if (state.mode === "download") {
      if (state.selectedPath && paths[state.selectedPath]) {
        await selectFolder(state.selectedPath);
      } else if (paths[ROOT] && state.selectedPath === null) {
        loadHome();
      }
    }
  }

  /* 递归读取拖入的文件夹（webkitGetAsEntry），返回 [{ file, relPath }] */
  function collectDroppedFiles(dataItems, callback) {
    var results = [];
    var pending = 0;
    var finished = false;
    function maybeDone() {
      if (finished) return;
      if (pending === 0) { finished = true; callback(results); }
    }
    function walkEntry(entry, basePath) {
      if (!entry) { maybeDone(); return; }
      if (entry.isFile) {
        pending++;
        if (typeof entry.file !== "function") { pending--; maybeDone(); return; }
        entry.file(function (file) {
          results.push({ file: file, relPath: basePath ? basePath + "/" + file.name : file.name });
          pending--;
          maybeDone();
        }, function () { pending--; maybeDone(); });
      } else if (entry.isDirectory) {
        pending++;
        /* 记录目录本身（含空目录），保证"自动新建同名文件夹" */
        results.push({ dir: true, relPath: basePath ? basePath + "/" + entry.name : entry.name });
        var reader = typeof entry.createReader === "function" ? entry.createReader() : null;
        if (!reader || typeof reader.readEntries !== "function") {
          pending--;
          maybeDone();
          return;
        }
        (function readNext() {
          reader.readEntries(function (entries) {
            if (!entries || !entries.length) { pending--; maybeDone(); return; }
            entries.forEach(function (sub) {
              walkEntry(sub, basePath ? basePath + "/" + entry.name : entry.name);
            });
            readNext();
          }, function () { pending--; maybeDone(); });
        })();
      } else {
        maybeDone();
      }
    }
    for (var i = 0; i < dataItems.length; i++) {
      var it = dataItems[i];
      var entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      if (entry) walkEntry(entry, "");
      else maybeDone();
    }
    maybeDone();
  }

  /* 拖入文件夹：按相对路径创建缺失的子文件夹，再逐个上传 */
  async function handleDroppedFolders(dataItems, fileList) {
    showBanner("正在处理文件夹…", false);
    collectDroppedFiles(dataItems, function (results) {
      /* 兜底：部分浏览器 entries API 读不到目录内文件（如 Safari/iPadOS Files 拖拽），
         用 dataTransfer.files 补齐，避免"上传文件夹却提示空文件夹" */
      if (fileList && fileList.length) {
        var byRel = {};
        var names = {};
        var dirNames = {};
        results.forEach(function (r) {
          if (r.dir) {
            dirNames[fileName(r.relPath)] = true;
            return;
          }
          if (r.file) {
            names[r.file.name] = true;
            byRel[r.file.name + "|" + r.relPath] = true;
          }
        });
        Array.prototype.forEach.call(fileList, function (f) {
          var rel = (f.webkitRelativePath || f.name).split("/").filter(Boolean).join("/");
          if (byRel[f.name + "|" + rel]) return;
          /* 文件夹本身会以伪文件出现在 dataTransfer.files（名为文件夹名、大小 0），跳过 */
          if (!f.webkitRelativePath && dirNames[f.name]) return;
          /* 平铺的同名文件（无相对路径）与已收集文件去重，避免重复上传 */
          if (!f.webkitRelativePath && names[f.name]) return;
          byRel[f.name + "|" + rel] = true;
          results.push({ file: f, relPath: rel });
        });
      }
      handleDroppedFileList(results);
    });
  }

  async function handleDroppedFileList(results) {
    var targetPath = folderSelect.value || ROOT;
    var items = [];
    var dirSet = {};
    var fileCount = 0;
    results.forEach(function (r) {
      if (r.dir) {
        dirSet[joinPath(targetPath, r.relPath)] = true;
        return;
      }
      var parts = r.relPath.split("/");
      parts.pop();
      var dirPath = targetPath;
      parts.forEach(function (seg) {
        dirPath = joinPath(dirPath, seg);
        dirSet[dirPath] = true;
      });
      items.push({ file: r.file, path: dirPath });
      fileCount++;
    });
    if (fileCount === 0 && !Object.keys(dirSet).length) {
      showBanner("未读取到可上传的内容，请重试", true);
      return;
    }
    await ensureDirs(dirSet, targetPath);
    if (!items.length) {
      showBanner("已创建空文件夹（文件夹内没有可上传的文件）", false);
      try {
        state.treeCache[targetPath] = await ensureTreeChildren(targetPath);
      } catch (e) { /* 目录刷新失败则保持现状 */ }
      renderTree();
      fillFolderSelect(targetPath);
      return;
    }
    await uploadFileList(items, targetPath);
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
      invalidatePath(parent);
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
      if (!e.dataTransfer) return;
      var items = e.dataTransfer.items;
      var hasDir = false;
      if (items && items.length) {
        for (var i = 0; i < items.length; i++) {
          var entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
          if (entry && entry.isDirectory) { hasDir = true; break; }
        }
      }
      if (hasDir) {
        handleDroppedFolders(items, e.dataTransfer.files);
        return;
      }
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

  /* ================= 教学引导 ================= */

  var GUIDE_SEEN_KEY = "club_tour_seen";
  var GUIDE_PROGRESS_KEY = "club_tour_progress";
  var tourFolder = null;    /* 第 4 步进入的文件夹，供第 5-9 步返回使用 */
  var tourRestore = null;   /* 进入教学前的状态快照 */

  var tourSteps = [
    {
      id: 1, title: "目录",
      text: "左侧是「目录」，点击箭头展开子目录，由此进入/切换文件夹",
      targets: [".sidebar"], view: "home"
    },
    {
      id: 2, title: "资料板块",
      text: "中间是「文件夹」，单击进入资料页",
      targets: [".subject-grid"], view: "home"
    },
    {
      id: 3, title: "状态栏",
      text: "顶部是「状态栏」，显示提示或下载进度",
      targets: ["#statusBar"], view: "home"
    },
    {
      id: 4, title: "最新资料更新",
      text: "右侧是「最新资料更新」，点击资料进入资料页并定位该资料",
      targets: [".update-list"], view: "home", waitClick: true,
      done: function () {
        return state.mode === "download" && state.selectedPath !== null &&
          content.querySelector(".res-card") !== null;
      },
      onComplete: function () { tourFolder = state.selectedPath; }
    },
    {
      id: 5, title: "下载",
      text: "「下载」需两次点击：第一次确认，第二次下载",
      targets: ["[data-confirm-download]"], view: "folder"
    },
    {
      id: 6, title: "批量勾选",
      text: "勾选方框，可随后点击底部「批量下载」",
      targets: [".res-select"], view: "folder"
    },
    {
      id: 7, title: "返回主页",
      text: "「返回主页」按钮或左上角「社团资源库」，都可回到主页",
      targets: ["[data-home]", "#brandTitle"], view: "folder"
    },
    {
      id: 8, title: "切换目录",
      text: "点击左侧「目录」，切换查看其他文件夹",
      targets: [".sidebar"], view: "folder"
    },
    {
      id: 9, title: "上传 / 下载切换",
      text: "顶栏切换「上传/下载」模式",
      targets: ["#modeToggle"], view: "folder", waitClick: true,
      done: function () {
        return state.mode === "upload" && !uploadArea.hidden;
      }
    },
    {
      id: 10, title: "选择目录",
      text: "上传前选择目标文件夹：左侧「目录」或「上传到」下拉框",
      targets: [".sidebar", "#folderSelect"], view: "upload"
    },
    {
      id: 11, title: "新建文件夹",
      text: "或者点击「新建文件夹」，先创建目录",
      targets: ["#newFolderBtn"], view: "upload"
    },
    {
      id: 12, title: "上传文件",
      text: "拖入或点击选择文件上传（无法选择文件夹）",
      targets: ["#uploadZone"], view: "upload"
    }
  ];

  /* 移动端（≤768px）：按手机特性生成引导步骤
   * - 第 1 步高亮顶栏「目录」图标，点击「下一步」后自动展开抽屉 0.5s
   * - 第 8 步与第 1 步聚焦位置一致（高亮顶栏「目录」图标）
   * - 第 10 步只指向「上传到」下拉框（抽屉会遮住它） */
  function isMobileTour() {
    return window.matchMedia(MOBILE_MQ).matches;
  }

  function tourStepsForViewport() {
    var mobile = isMobileTour();
    return tourSteps.map(function (s) {
      var step = Object.assign({}, s);
      step.targets = (s.targets || []).slice();
      if (mobile && step.id === 1) {
        step.targets = ["#treeToggle"];
        step.text = "点击打开左侧「目录」，现为自动展示";
        step.onNext = function () {
          sidebar.classList.add("open");
          sidebarMask.hidden = false;
          return new Promise(function (resolve) {
            /* 等抽屉滑出动画（0.2s）完成后展示 0.5s，再收起并进入下一步 */
            setTimeout(function () {
              closeDrawer();
              resolve();
            }, 240 + 500);
          });
        };
      } else if (mobile && step.id === 2) {
        step.text = "中间是「文件夹卡片」，单击进入资料页";
      } else if (mobile && step.id === 4) {
        step.text = "底部为「最新资料更新」，点击进入资料页并定位该资料";
      } else if (mobile && step.id === 5) {
        step.text = "「下载」需点击两次：第一次确认，第二次下载，防误触";
      } else if (mobile && step.id === 7) {
        step.text = "「返回主页」按钮或「左上角图标」都可返回主页";
      } else if (mobile && step.id === 8) {
        step.targets = ["#treeToggle"];
        step.text = "资料页也要点击切换「目录」";
      } else if (mobile && step.id === 9) {
        step.text = "切换「上传/下载」模式";
      } else if (mobile && step.id === 10) {
        step.targets = ["#folderSelect"];
        step.text = "上传前先选择目标文件夹";
      }
      return step;
    });
  }

  /* 引导步骤进入前：移动端按需开/关目录抽屉，保证高亮目标在屏幕内 */
  function syncTourDrawer(step) {
    if (!isMobileTour()) return Promise.resolve();
    var needsSidebar = (step.targets || []).indexOf(".sidebar") !== -1;
    if (needsSidebar) {
      sidebar.classList.add("open");
      sidebarMask.hidden = false;
      /* 等抽屉滑出动画（0.2s）完成后再定位高亮与提示框，避免测到半开位置 */
      return new Promise(function (resolve) {
        setTimeout(resolve, 240);
      });
    }
    closeDrawer();
    return Promise.resolve();
  }

  function isHomeShown() {
    return state.mode === "download" && state.selectedPath === null &&
      content.querySelector(".subject-grid") !== null;
  }

  function isFolderShown(p) {
    return state.mode === "download" && state.selectedPath === p &&
      content.querySelector(".page-head") !== null;
  }

  /* 递归加载并展开整棵目录树 */
  async function expandAllTree() {
    async function walk(path) {
      try {
        var dirs = await ensureTreeChildren(path);
        state.expanded[path] = "open";
        for (var i = 0; i < dirs.length; i++) {
          await walk(dirs[i].path);
        }
      } catch (e) {
        state.expanded[path] = "open";
      }
    }
    await walk(ROOT);
    renderTree();
  }

  /* 进入任一步骤前，恢复该步骤所需视图；第 1/7/9 步自动展开全部目录 */
  function ensureTourView(step) {
    var needExpand = step.id === 1 || step.id === 8 || step.id === 10;
    var done = Promise.resolve();
    if (step.view === "upload") {
      if (state.mode !== "upload") switchMode("upload");
    } else if (step.view === "folder") {
      if (state.mode !== "download") switchMode("download");
      var p = tourFolder || state.selectedPath || ROOT;
      if (!isFolderShown(p)) {
        done = selectFolder(p).then(function () {}, function () {});
      }
    } else {
      if (state.mode !== "download") switchMode("download");
      if (!isHomeShown()) {
        state.selectedPath = null;
        renderTree();
        fillFolderSelect(ROOT);
        done = loadHome().then(function () {}, function () {});
      }
    }
    return done.then(function () {
      if (needExpand) return expandAllTree();
    }).then(function () {
      return syncTourDrawer(step);
    });
  }

  function saveTourProgress(i) {
    try { localStorage.setItem(GUIDE_PROGRESS_KEY, String(i)); } catch (e) { /* 忽略 */ }
  }

  function clearTourProgress() {
    try { localStorage.removeItem(GUIDE_PROGRESS_KEY); } catch (e) { /* 忽略 */ }
  }

  function onTourExit(completed) {
    restoreTourState();
    /* 完整走完最后一步才清零，下次从头开始；中途退出保留进度，下次续上 */
    if (completed) clearTourProgress();
  }

  function startGuideTour() {
    if (!window.GuideTour || window.GuideTour.isActive()) return;
    tourFolder = null;
    tourRestore = {
      mode: state.mode,
      selectedPath: state.selectedPath,
      selected: Object.assign({}, state.selected),
      expanded: Object.assign({}, state.expanded)
    };
    var saved = null;
    try { saved = parseInt(localStorage.getItem(GUIDE_PROGRESS_KEY), 10); } catch (e) { /* 忽略 */ }
    if (isNaN(saved) || saved < 0 || saved >= tourSteps.length) saved = 0;
    var steps = tourStepsForViewport();
    window.GuideTour.start(steps, {
      startIndex: saved,
      ensure: ensureTourView,
      onStep: saveTourProgress,
      onExit: onTourExit
    });
  }

  function restoreTourState() {
    if (confirmPath) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
      confirmPath = null;
    }
    closeDrawer();
    if (!tourRestore) return;
    var r = tourRestore;
    tourRestore = null;
    state.selected = r.selected || {};
    state.batchArmed = false;
    state.expanded = r.expanded || {};
    if (r.mode === "upload") {
      switchMode("upload");
    } else {
      switchMode("download");
      if (r.selectedPath) selectFolder(r.selectedPath);
      else selectRoot();
    }
    updateBatchBar();
  }

  function maybeAutoGuide() {
    if (CONFIG.autoGuide === false) return;
    if (!window.GuideTour) return;
    var seen = null;
    try { seen = localStorage.getItem(GUIDE_SEEN_KEY); } catch (e) { return; }
    if (seen) return;
    try { localStorage.setItem(GUIDE_SEEN_KEY, "1"); } catch (e) { return; }
    showModal({
      title: "开始教学？",
      message: "是否开始一次简短的界面教学（约 10 步）？随时可按 Esc 退出。",
      buttons: [
        { text: "开始教学", value: "start", primary: true },
        { text: "暂不", value: "later" }
      ]
    }).then(function (v) {
      if (v === "start") startGuideTour();
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

      /* 弹窗渲染完成后回调（用于 docx/xlsx/pptx 等异步渲染） */
      if (typeof opts.onRender === "function") {
        try { opts.onRender(modalRoot.querySelector(".modal")); } catch (e) { /* 忽略 */ }
      }

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
    var brandTextEl = $("brandText");
    if (brandTextEl) brandTextEl.textContent = CONFIG.siteTitle || "社团资源库";
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
    $("modeUpload").addEventListener("click", function () { switchMode("upload", true); });
    $("modeDownload").addEventListener("click", function () { switchMode("download", true); });
    batchDownloadBtn.addEventListener("click", onBatchDownload);
    batchClearBtn.addEventListener("click", onBatchClear);
    guideBtn.addEventListener("click", startGuideTour);
    initUpload();
    initSearch();
    initScopePicker();
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
