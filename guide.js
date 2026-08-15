/* 交互式教学引导引擎（纯原生，无依赖）
 * 用法：GuideTour.start(steps, { ensure, onExit })
 * 步骤结构：{ id, title, text, targets:[选择器], view, waitClick, done, onComplete }
 */
(function () {
  "use strict";

  var active = false;
  var steps = [];
  var opts = {};
  var current = 0;
  var pollTimer = null;
  var viewportTimer = null;

  function startTour(list, options) {
    steps = list || [];
    opts = options || {};
    var startIndex = typeof opts.startIndex === "number" ? opts.startIndex : 0;
    current = Math.max(0, Math.min(startIndex, steps.length - 1));
    active = true;
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    goTo(current);
  }

  function endTour(completed) {
    if (!active) return;
    active = false;
    stopPoll();
    clearTimeout(viewportTimer);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
    var root = document.getElementById("guideRoot");
    if (root) root.remove();
    if (typeof opts.onExit === "function") opts.onExit(!!completed);
  }

  function goTo(i) {
    if (!active) return;
    if (i < 0 || i >= steps.length) { endTour(true); return; }
    current = i;
    if (typeof opts.onStep === "function") opts.onStep(current);
    stopPoll();
    var step = steps[current];
    var ensure = (typeof opts.ensure === "function") ? opts.ensure : function () { return Promise.resolve(); };
    Promise.resolve(ensure(step)).then(function () {
      if (!active || current !== i) return;
      build(step);
      if (step.waitClick && typeof step.done === "function") {
        pollTimer = setInterval(function () {
          if (!active || current !== i) { stopPoll(); return; }
          if (step.done()) {
            stopPoll();
            if (typeof step.onComplete === "function") step.onComplete();
            goTo(current + 1);
          }
        }, 250);
      }
    });
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function next() { goTo(current + 1); }
  function prev() { goTo(current - 1); }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      endTour(false);
    }
  }

  function onViewportChange() {
    if (!active) return;
    clearTimeout(viewportTimer);
    viewportTimer = setTimeout(function () {
      if (active) build(steps[current]);
    }, 100);
  }

  function build(step) {
    var old = document.getElementById("guideRoot");
    if (old) old.remove();

    /* 先把目标滚到可视区，再测量位置 */
    (step.targets || []).forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: "nearest" });
    });

    var rects = [];
    (step.targets || []).forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      rects.push(el.getBoundingClientRect());
    });

    var root = document.createElement("div");
    root.id = "guideRoot";

    /* 高亮框 */
    rects.forEach(function (r) {
      var h = document.createElement("div");
      h.className = "guide-highlight" + (step.waitClick ? " clickable" : "");
      h.style.left = r.left + "px";
      h.style.top = r.top + "px";
      h.style.width = r.width + "px";
      h.style.height = r.height + "px";
      root.appendChild(h);
    });

    /* 遮罩：SVG evenodd 精确挖空目标区域（支持多目标） */
    buildDimSvg(root, rects);

    /* 点击拦截：非等待步骤全部拦截；等待步骤放行目标区域内的真实点击 */
    var catcher = document.createElement("div");
    catcher.className = "guide-catcher";
    catcher.addEventListener("click", function (e) {
      if (!step.waitClick) return;
      var x = e.clientX;
      var y = e.clientY;
      var hit = rects.some(function (r) {
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      });
      if (!hit) return;
      catcher.style.pointerEvents = "none";
      var el = document.elementFromPoint(x, y);
      catcher.style.pointerEvents = "auto";
      if (el && el !== catcher) {
        var interactive = el.closest(
          "button, a, label, input, select, .mode-seg, [data-open], [data-select], [data-toggle], [data-confirm-download]"
        );
        if (interactive) interactive.click();
      }
    });
    root.appendChild(catcher);

    /* 工具条 */
    var tip = document.createElement("div");
    tip.className = "guide-tooltip";
    var isFirst = current === 0;
    var isWait = !!step.waitClick;
    var isLast = current === steps.length - 1;
    var actionsHtml;
    if (isLast) {
      /* 最后一步仅保留"完成"，不再显示上一步/退出 */
      actionsHtml = '<button class="btn primary" data-g="next">完成</button>';
    } else {
      actionsHtml =
        '<button class="btn skip" data-g="prev"' + (isFirst ? " disabled" : "") + '>上一步</button>' +
        (isWait ? "" : '<button class="btn primary" data-g="next">下一步</button>') +
        '<button class="btn ghost" data-g="end">退出</button>';
    }
    var textHtml = esc(step.text || "");
    if (isWait) {
      /* 需要真实点击的步骤：突出强调"请点击" */
      textHtml = textHtml.replace(/请点击/g, '<span class="guide-click-hint">请点击</span>');
    }
    tip.innerHTML =
      '<div class="guide-progress">第 ' + (current + 1) + ' / ' + steps.length + ' 步</div>' +
      (step.title ? '<div class="guide-title">' + esc(step.title) + '</div>' : "") +
      '<div class="guide-text">' + textHtml + '</div>' +
      '<div class="guide-actions">' + actionsHtml + '</div>';
    root.appendChild(tip);
    document.body.appendChild(root);

    positionTip(tip, rects);

    Array.prototype.forEach.call(tip.querySelectorAll("[data-g]"), function (b) {
      b.addEventListener("click", function () {
        var g = b.getAttribute("data-g");
        if (g === "prev") prev();
        else if (g === "next") next();
        else endTour(false);
      });
    });
  }

  /* 全屏 SVG 遮罩：fill-rule=evenodd，屏幕矩形 + 各目标矩形 = 精确挖空 */
  function buildDimSvg(root, rects) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var d = "M0,0 L" + vw + ",0 L" + vw + "," + vh + " L0," + vh + " Z";
    rects.forEach(function (r) {
      d += " M" + r.left + "," + r.top +
        " L" + (r.left + r.width) + "," + r.top +
        " L" + (r.left + r.width) + "," + (r.top + r.height) +
        " L" + r.left + "," + (r.top + r.height) + " Z";
    });
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "guide-svg");
    svg.setAttribute("viewBox", "0 0 " + vw + " " + vh);
    svg.setAttribute("preserveAspectRatio", "none");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("fill", "rgba(15, 28, 45, .55)");
    svg.appendChild(path);
    root.appendChild(svg);
  }

  function positionTip(tip, rects) {
    var tw = tip.offsetWidth || 300;
    var th = tip.offsetHeight || 180;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var cx, cy;
    if (rects.length) {
      var r = rects[0];
      cx = Math.min(Math.max(r.left + r.width / 2 - tw / 2, 8), vw - tw - 8);
      cy = r.bottom + 12;
      if (cy + th > vh - 8 && r.top - th - 12 > 8) cy = r.top - th - 12;
    } else {
      cx = (vw - tw) / 2;
      cy = (vh - th) / 2;
    }
    tip.style.left = Math.max(8, cx) + "px";
    tip.style.top = Math.max(8, cy) + "px";
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  window.GuideTour = {
    start: startTour,
    end: endTour,
    isActive: function () { return active; }
  };
})();
