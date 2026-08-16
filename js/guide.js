/* 交互式教学引导引擎（纯原生，无依赖）
 * 用法：GuideTour.start(steps, { ensure, onExit })
 * 步骤结构：{ id, title, text, targets:[选择器], view, waitClick, done, onNext, onComplete }
 * onNext：点击「下一步」后执行，若返回 Promise，则等其 resolve 后再进入下一步
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

  function next() {
    if (!active) return;
    var i = current;
    var step = steps[i];
    /* 点击「下一步」后允许先执行异步动作（如展开目录展示 0.5s 再收起） */
    if (typeof step.onNext === "function") {
      var r = step.onNext();
      if (r && typeof r.then === "function") {
        r.then(function () {
          if (active && current === i) goTo(i + 1);
        });
        return;
      }
    }
    goTo(i + 1);
  }
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

    /* 高亮框：统一使用页面标准圆角 */
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
    /* "第 N 步"右侧的操作提示：蓝色=下一步按钮，橙色=点击高亮目标 */
    var progressHint = isWait
      ? '<span class="guide-hint orange">橙色点击对应按钮</span>'
      : (isLast
          ? '<span class="guide-hint blue">蓝色点击完成</span>'
          : '<span class="guide-hint blue">蓝色点击下一步</span>');
    tip.innerHTML =
      '<div class="guide-progress"><span>第 ' + (current + 1) + ' / ' + steps.length + ' 步</span>' + progressHint + '</div>' +
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
    var margin = 8;
    var cx, cy;
    if (rects.length) {
      var r = rects[0];
      cx = r.left + r.width / 2 - tw / 2;
      cy = r.bottom + 12;
      /* 下方放不下时优先放到目标上方 */
      if (cy + th > vh - margin) cy = r.top - th - 12;
    } else {
      cx = (vw - tw) / 2;
      cy = (vh - th) / 2;
    }
    /* 最终兜底：目标过大（如全屏抽屉）或视口过小时，强制回到屏幕内 */
    var maxLeft = vw - tw - margin;
    var maxTop = vh - th - margin;
    if (maxLeft < margin) maxLeft = margin;
    if (maxTop < margin) maxTop = margin;
    tip.style.left = Math.round(Math.max(margin, Math.min(maxLeft, cx))) + "px";
    tip.style.top = Math.round(Math.max(margin, Math.min(maxTop, cy))) + "px";
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
