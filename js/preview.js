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
/* 各扩展名对应的 MIME 类型：确保 blob URL 能被浏览器正确识别渲染 */
var PREVIEW_MIME = {
  pdf: "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon",
  avif: "image/avif", tif: "image/tiff", tiff: "image/tiff",
  mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", aac: "audio/aac",
  m4a: "audio/mp4", oga: "audio/ogg", ogg: "audio/ogg"
};

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
    var name = fileName(path);
    var ext = extOf(name);
    var action = await showModal({
      title: name,
      body: '<div class="preview-loading" id="previewLoading">' +
        '<span class="preview-loading-text">正在加载预览…</span>' +
        '<div class="progress"><div class="progress-bar"></div></div>' +
        '<span class="preview-loading-pct"></span></div>',
      wide: true,
      onRender: function (modalEl) {
        var holder = modalEl.querySelector("#previewLoading");
        var bar = holder ? holder.querySelector(".progress-bar") : null;
        var pctEl = holder ? holder.querySelector(".preview-loading-pct") : null;
        fetchDownload(getUrl(path, false), {}, function (loaded, total) {
          if (!holder || !holder.isConnected) return;
          var pct = total ? Math.round((loaded / total) * 100) : 0;
          if (bar) bar.style.width = pct + "%";
          if (pctEl) pctEl.textContent = fmtSize(loaded) + (total ? " / " + fmtSize(total) + "（" + pct + "%）" : "");
        }).then(async function (blob) {
          if (!holder || !holder.isConnected) return;
          /* 兜底：按扩展名强制正确 MIME，避免 PDF/媒体因类型缺失显示乱码 */
          var wantType = PREVIEW_MIME[ext];
          if (wantType && blob.type !== wantType) {
            blob = new Blob([blob], { type: wantType });
          }
          var objUrl = URL.createObjectURL(blob);
          previewObjectUrl = objUrl;
          var openFallback = '<div class="preview-fallback">' +
            '<a class="btn small" href="#" id="previewOpen">' +
            '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 4h6v6"></path><path d="M20 4l-9 9"></path><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"></path></svg>' +
            '<span>若预览显示异常，请点击在新窗口打开</span>' +
            '</a></div>';
          var bodyHtml;
          if (ext === "pdf") {
            /* PDF 用 DOM API 创建 iframe 并延迟设置 src，规避 Chrome 查看器黑屏 */
            bodyHtml = '<div id="pdfHolder"></div>' + openFallback;
          } else if (IMAGE_EXT[ext]) {
            bodyHtml = '<img class="preview-img" src="' + objUrl + '" alt="' + esc(name) + '">' + openFallback;
          } else if (VIDEO_EXT[ext]) {
            bodyHtml = '<video class="preview-media" controls playsinline src="' + objUrl + '"></video>' + openFallback;
          } else if (AUDIO_EXT[ext]) {
            bodyHtml = '<audio class="preview-audio" controls src="' + objUrl + '"></audio>' + openFallback;
          } else if (OFFICE_EXT[ext]) {
            bodyHtml = '<div class="preview-office" id="officePreview"><div class="loading">正在解析…</div></div>' + openFallback;
          } else {
            /* 文本/代码：截断过大内容后以等宽字体展示（转义防注入） */
            var text = await blob.slice(0, 2097152).text();
            if (blob.size > 2097152) text += "\n\n…（文件过大，仅显示前 2MB，可下载查看完整内容）";
            bodyHtml = '<pre class="preview-text">' + esc(text) + '</pre>' + openFallback;
          }
          holder.outerHTML = bodyHtml;
          if (ext === "pdf") {
            var pdfHolder = modalEl.querySelector("#pdfHolder");
            if (pdfHolder) {
              var frame = document.createElement("iframe");
              frame.className = "preview-frame";
              pdfHolder.appendChild(frame);
              requestAnimationFrame(function () {
                frame.src = objUrl;
              });
            }
          }
          var openLink = modalEl.querySelector("#previewOpen");
          if (openLink) {
            openLink.addEventListener("click", function (e) {
              e.preventDefault();
              /* 独立 blob URL：不随预览弹窗关闭而回收，避免新窗口加载中断 */
              var mediaUrl = URL.createObjectURL(blob);
              /* about:blank 子窗口继承当前页面的（含 file:// 等无标准 origin 的）origin，
                 在其内部引用 blob URL 可绕过"顶层导航到 blob"被浏览器拦截的问题 */
              var win = window.open("", "_blank");
              if (!win) return;
              var isVideo = !!VIDEO_EXT[ext];
              var isAudio = !!AUDIO_EXT[ext];
              var content;
              if (isVideo || isAudio) {
                var tag = isVideo ? "video controls autoplay playsinline" : "audio controls autoplay";
                content = '<' + tag + ' src="' + mediaUrl + '"></' + tag.split(" ")[0] + '>';
              } else {
                content = '<iframe src="' + mediaUrl + '" style="border:0;width:100%;height:100%;display:block"></iframe>';
              }
              win.document.write(
                '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(name) + '</title>' +
                '<style>html,body{margin:0;height:100%;background:#0d0d0f;display:flex;align-items:center;justify-content:center}video,audio{max-width:100%;max-height:100vh;outline:none}iframe{width:100%;height:100%;border:0}</style>' +
                '</head><body>' + content + '</body></html>'
              );
              win.document.close();
            });
          }
          if (OFFICE_EXT[ext]) {
            var container = modalEl.querySelector("#officePreview");
            if (!container) return;
            if (ext === "docx") renderDocxPreview(container, blob);
            else if (ext === "xlsx") renderXlsxPreview(container, blob);
            else renderPptxPreview(container, blob);
          }
        }).catch(function (err) {
          if (err && err.auth) return;
          if (holder && holder.isConnected) {
            holder.innerHTML = '<div class="preview-error">' + esc(friendlyError(err)) + '</div>';
          }
        });
      },
      buttons: [
        { text: "下载", value: "download" },
        { text: "关闭", value: "close", primary: true }
      ]
    });
    if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
    if (action === "download") {
      try {
        await downloadWithProgress(path);
      } catch (err) {
        if (!err.auth) showBanner(friendlyError(err), true);
      }
    }
  }

