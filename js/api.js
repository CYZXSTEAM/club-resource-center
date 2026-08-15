/* 社团资源库 —— API 层（配置、鉴权、缓存、Koofr 网络请求） */
"use strict";

var CONFIG = window.CLUB_CONFIG || {};
var BASE = CONFIG.koofrBase || "https://app.koofr.net";
var MOUNT = CONFIG.mountId || "primary";
var ROOT = CONFIG.rootPath || "/社团资源库";
var CACHE_TTL = 60000;   /* 列表/主页缓存时长：60 秒 */

var dataCache = {
  lists: {},             /* path -> { files, ts } */
  home: null             /* { cards, items, ts } */
};

function invalidatePath(path) {
  delete dataCache.lists[path];
  dataCache.home = null;
  searchIndex = null;
}

var memoryAuth = null;        /* 内存中的登录凭据，刷新即清 */

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
    var c = dataCache.lists[path];
    if (c && Date.now() - c.ts < CACHE_TTL) return c.files;
    var res = await koofrFetch(listUrl(path));
    if (!res.ok) {
      var err = new Error(await apiErrorText(res));
      err.status = res.status;
      throw err;
    }
    var data = await res.json();
    var items = (data.files || []).map(function (it) {
      return {
        name: it.name,
        type: it.type === "dir" ? "dir" : "file",
        size: Number(it.size) || 0,
        modified: Number(it.modified) || 0,
        contentType: it.contentType || ""
      };
    });
    dataCache.lists[path] = { files: items, ts: Date.now() };
    return items;
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

  /* listrecursive 返回 NDJSON 流，逐行解析（文件 + 文件夹） */
  async function listRecursiveAll(path) {
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
        if (item.type === "file" && item.file && item.file.name !== "") {
          out.push({
            name: item.file.name,
            relPath: item.path,
            type: item.file.type === "dir" ? "dir" : "file",
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

  /* 最近更新只需要文件 */
  async function listRecursiveFiles(path) {
    var items = await listRecursiveAll(path);
    return items.filter(function (it) { return it.type === "file"; }).map(function (it) {
      return {
        name: it.name,
        relPath: it.relPath,
        modified: it.modified,
        size: it.size,
        contentType: it.contentType
      };
    });
  }

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

  async function batchDownloadZip(folderPath, names) {
    var url = BASE + "/content/api/v2.1/mounts/" + encodeURIComponent(MOUNT) + "/files/get?path=" +
      encodePath(folderPath) + "&force=true";
    var res = await koofrFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: names.map(function (n) { return "files=" + encodeURIComponent(n); }).join("&")
    });
    if (!res.ok) throw new Error(await apiErrorText(res));
    var blob = await res.blob();
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName(folderPath) + ".zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }

  /* 下载整个文件夹：不传文件列表时，Koofr 返回整包 ZIP */
