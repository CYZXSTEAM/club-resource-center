/* 社团资源库 —— 预览层（图片/PDF/视频/音频/文本/Office 渲染） */
"use strict";

var IMAGE_EXT = { jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, bmp: 1, svg: 1, ico: 1, avif: 1, tif: 1, tiff: 1 };
var VIDEO_EXT = { mp4: 1, webm: 1, ogv: 1 };
var AUDIO_EXT = { mp3: 1, wav: 1, flac: 1, aac: 1, m4a: 1, oga: 1, ogg: 1 };
var TEXT_EXT = {
  txt: 1, md: 1, json: 1, js: 1, css: 1, html: 1, htm: 1, xml: 1, log: 1, csv: 1,
  py: 1, java: 1, c: 1, cpp: 1, h: 1, hpp: 1, sh: 1, bat: 1, yml: 1, yaml: 1,
  ini: 1, conf: 1, ts: 1, tsx: 1, sql: 1, go: 1, rs: 1, php: 1
};
var OFFICE_EXT = { docx: 1, xlsx: 1, pptx: 1 };
var PREVIEW_EXT = Object.assign({ pdf: 1 }, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, TEXT_EXT, OFFICE_EXT);
var previewObjectUrl = null;

  /* ================= 预览 ================= */

  /* Office 本地渲染：docx（docx-preview）、xlsx（SheetJS）、pptx（JSZip 提取文字） */
  function renderDocxPreview(container, blob) {
    if (!window.docx || !window.docx.renderAsync) {
      container.innerHTML = '<div class="preview-error">docx 预览组件未加载</div>';
      return;
    }
    docx.renderAsync(blob, container).catch(function (err) {
      container.innerHTML = '<div class="preview-error">docx 预览失败：' + esc(friendlyError(err)) + '</div>';
    });
  }

  function renderXlsxPreview(container, blob) {
    if (!window.XLSX) {
      container.innerHTML = '<div class="preview-error">xlsx 预览组件未加载</div>';
      return;
    }
    blob.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      var html = wb.SheetNames.map(function (name, i) {
        var sheetHtml = XLSX.utils.sheet_to_html(wb.Sheets[name], { id: "xlsx-sheet-" + i, header: "" });
        return '<div class="preview-xlsx-sheet"><h4>' + esc(name) + '</h4>' + sheetHtml + '</div>';
      }).join("");
      container.innerHTML = html || '<div class="preview-error">表格为空</div>';
    }).catch(function (err) {
      container.innerHTML = '<div class="preview-error">xlsx 预览失败：' + esc(friendlyError(err)) + '</div>';
    });
  }

  function renderPptxPreview(container, blob) {
    if (!window.JSZip) {
      container.innerHTML = '<div class="preview-error">pptx 预览组件未加载</div>';
      return;
    }
    JSZip.loadAsync(blob).then(function (zip) {
      var slideFiles = Object.keys(zip.files)
        .filter(function (p) { return /^ppt\/slides\/slide\d+\.xml$/.test(p); })
        .sort(function (a, b) {
          var na = parseInt(a.match(/slide(\d+)/)[1], 10);
          var nb = parseInt(b.match(/slide(\d+)/)[1], 10);
          return na - nb;
        });
      if (!slideFiles.length) {
        container.innerHTML = '<div class="preview-error">未能解析演示文稿</div>';
        return;
      }
      Promise.all(slideFiles.map(function (p) { return zip.file(p).async("string"); })).then(function (xmls) {
        var html = xmls.map(function (xml, i) {
          var texts = [];
          var doc = new DOMParser().parseFromString(xml, "application/xml");
          var tEls = doc.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "t");
          for (var j = 0; j < tEls.length; j++) {
            var t = (tEls[j].textContent || "").trim();
            if (t) texts.push(t);
          }
          var content = esc(texts.join("\n")).replace(/\n/g, "<br>");
          return '<div class="preview-pptx-slide"><div class="pptx-slide-no">第 ' + (i + 1) + ' 页</div>' +
            '<div class="pptx-slide-text">' + (content || "（本页无文字内容）") + '</div></div>';
        }).join("");
        container.innerHTML = html;
      }).catch(function (err) {
        container.innerHTML = '<div class="preview-error">pptx 预览失败：' + esc(friendlyError(err)) + '</div>';
      });
    }).catch(function (err) {
      container.innerHTML = '<div class="preview-error">pptx 预览失败：' + esc(friendlyError(err)) + '</div>';
    });
  }

  async function previewFile(path) {
    var res = await koofrFetch(getUrl(path, false));
    if (!res.ok) throw new Error(await apiErrorText(res));
    var blob = await res.blob();
    var objUrl = URL.createObjectURL(blob);
    previewObjectUrl = objUrl;
    var name = fileName(path);
    var ext = extOf(name);
    var body;
    var onRender = null;
    if (ext === "pdf") {
      body = '<iframe class="preview-frame" src="' + objUrl + '"></iframe>';
    } else if (IMAGE_EXT[ext]) {
      body = '<img class="preview-img" src="' + objUrl + '" alt="' + esc(name) + '">';
    } else if (VIDEO_EXT[ext]) {
      body = '<video class="preview-media" controls playsinline src="' + objUrl + '"></video>';
    } else if (AUDIO_EXT[ext]) {
      body = '<audio class="preview-audio" controls src="' + objUrl + '"></audio>';
    } else if (OFFICE_EXT[ext]) {
      body = '<div class="preview-office" id="officePreview"><div class="loading">正在解析…</div></div>';
      onRender = function (modalEl) {
        var container = modalEl.querySelector("#officePreview");
        if (!container) return;
        if (ext === "docx") renderDocxPreview(container, blob);
        else if (ext === "xlsx") renderXlsxPreview(container, blob);
        else renderPptxPreview(container, blob);
      };
    } else {
      /* 文本/代码：截断过大内容后以等宽字体展示（转义防注入） */
      var text = await blob.slice(0, 2097152).text();
      if (blob.size > 2097152) text += "\n\n…（文件过大，仅显示前 2MB，可下载查看完整内容）";
      body = '<pre class="preview-text">' + esc(text) + '</pre>';
    }
    var action = await showModal({
      title: fileName(path),
      body: body,
      wide: true,
      onRender: onRender,
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

