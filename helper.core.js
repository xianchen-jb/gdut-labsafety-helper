// ==UserScript==
// @name         广工实验室安全 · 开卷助手（只读标注版）
// @namespace    local.gdut.labsafety.helper
// @version      0.2.0
// @description  读取卷面题目，在浮动面板列出答案并高亮正确选项。只标注，不自动点选、不自动交卷。
// @author       local
// @match        https://labsafety.gdut.edu.cn/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ============================ 数据（构建时注入） ============================ */

  // 每行: [题干, [选项文本...], "正确项标记(如 1010)", 来源分类]
  const BANK = /*__BANK__*/[];
  const META = /*__META__*/{ version: 'dev', built: '', count: 0 };

  /* ============================== 常量与工具 ============================== */

  const PREFIX = 'gdut-helper';
  const CFG_KEY = 'gdut-helper.cfg.v1';
  const PANEL_ID = PREFIX + '-panel';

  const cfg = Object.assign({ collapsed: false, highlight: true, pos: null }, readCfg());

  function readCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* 忽略 */ }
  }

  /* ============================== 匹配引擎（构建时内联） ============================== */

  /*__ENGINE__*/

  const engine = createEngine(BANK);

  /* ============================== 页面适配层 ============================== */

  function readPaper() {
    let nodes = [...document.querySelectorAll('[id^="question-"]')]
      .filter((el) => /^question-\d+$/.test(el.id));

    if (!nodes.length) {
      nodes = [...document.querySelectorAll('.qeustion-item-box')];
    }

    return nodes.map((el, i) => {
      const titleEl = el.querySelector('.question-title') || el;
      const labels = [...el.querySelectorAll('.question-options label')];
      return {
        n: i + 1,
        el,
        titleEl,
        title: (titleEl.innerText || '').trim(),
        labels,
        opts: labels.map((l) => (l.innerText || '').trim()),
        multi: !!el.querySelector('.el-checkbox'),
        hasImg: !!el.querySelector('img'),
      };
    }).filter((q) => q.opts.length >= 2 && q.title);
  }

  function clearMarks(q) {
    q.el.querySelectorAll('.' + PREFIX + '-badge').forEach((e) => e.remove());
    q.labels.forEach((l) => {
      l.classList.remove(PREFIX + '-opt');
      l.style.removeProperty('background');
      l.style.removeProperty('box-shadow');
    });
  }

  function decorate(q, res) {
    clearMarks(q);
    if (!res.ok) {
      const hint = res.nearest && res.nearest.score ? '，最接近 ' + res.nearest.score : '';
      badge(q, '? ' + res.reason + hint, 'none');
      return;
    }
    if (cfg.highlight) {
      res.picks.forEach((i) => {
        const l = q.labels[i];
        if (!l) return;
        l.classList.add(PREFIX + '-opt');
        l.style.setProperty('background', '#e7f6ec', 'important');
        l.style.setProperty('box-shadow', 'inset 3px 0 0 #1f9d55', 'important');
      });
    }
    const letters = res.picks.map((i) => LETTERS[i]).join('');
    const texts = res.picks.map((i) => stripLead(q.opts[i])).join(' / ');
    const tail = res.partial ? '（部分匹配）' : '';
    if (res.tier === 'mid') badge(q, '≈ ' + letters + ' ' + texts + ' · 建议核对' + tail, 'mid');
    else badge(q, '✓ ' + letters + ' ' + texts + tail, 'ok');
  }

  function badge(q, text, kind) {
    const el = document.createElement('div');
    el.className = PREFIX + '-badge ' + PREFIX + '-badge-' + kind;
    el.textContent = text;
    el.title = kind === 'ok'
      ? '题库精确命中（' + (META.version || '') + '）'
      : (kind === 'mid' ? '题库里找到相近题目，答案仅供参考，请自行核对' : '题库里没有这道题（或选项版本不同），需要人工判断');
    q.titleEl.appendChild(el);
  }

  /* ================================ 样式 ================================ */

  function injectStyle() {
    if (document.getElementById(PREFIX + '-style')) return;
    const st = document.createElement('style');
    st.id = PREFIX + '-style';
    st.textContent = [
      '.' + PREFIX + '-badge{display:inline-block;margin:6px 0 0 8px;padding:1px 8px;border-radius:6px;',
      'font-size:12px;line-height:18px;vertical-align:middle;max-width:100%;}',
      '.' + PREFIX + '-badge-ok{background:#e7f6ec;color:#116b3a;border:1px solid #94d3ae;}',
      '.' + PREFIX + '-badge-mid{background:#fff4e5;color:#8a5300;border:1px solid #f0c07a;}',
      '.' + PREFIX + '-badge-none{background:#f1f3f5;color:#5b6470;border:1px solid #d6dbe1;}',
      '.' + PREFIX + '-opt{transition:background .15s ease;}',
      '#' + PANEL_ID + '{position:fixed;right:16px;bottom:16px;width:340px;max-width:92vw;background:#fff;',
      'border:1px solid #d8dee6;border-radius:8px;box-shadow:0 8px 24px rgba(16,24,40,.16);',
      'font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2937;z-index:2147483000;}',
      '#' + PANEL_ID + ' .h{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#f4f7fa;',
      'border-bottom:1px solid #e3e8ef;border-radius:8px 8px 0 0;cursor:move;user-select:none;}',
      '#' + PANEL_ID + ' .h b{flex:1;font-weight:600;font-size:13px;}',
      '#' + PANEL_ID + ' button{border:1px solid #d3dae3;background:#fff;border-radius:6px;',
      'padding:2px 8px;font-size:12px;cursor:pointer;color:#374151;}',
      '#' + PANEL_ID + ' button:hover{background:#f0f3f7;}',
      '#' + PANEL_ID + ' .body{max-height:52vh;overflow:auto;padding:6px 4px;}',
      '#' + PANEL_ID + ' .row{display:flex;gap:6px;align-items:flex-start;padding:4px 8px;border-radius:6px;cursor:pointer;}',
      '#' + PANEL_ID + ' .row:hover{background:#f2f5f9;}',
      '#' + PANEL_ID + ' .row i{font-style:normal;color:#6b7280;min-width:22px;text-align:right;}',
      '#' + PANEL_ID + ' .row .a{font-weight:600;color:#116b3a;min-width:16px;}',
      '#' + PANEL_ID + ' .row .a.mid{color:#b45309;}',
      '#' + PANEL_ID + ' .row.bad .a.none{color:#8b95a1;}',
      '#' + PANEL_ID + ' .row span{flex:1;color:#374151;}',
      '#' + PANEL_ID + ' .foot{padding:6px 10px;border-top:1px solid #e3e8ef;color:#6b7280;font-size:11px;}',
      '.' + PREFIX + '-flash{outline:2px solid #1f9d55;outline-offset:2px;transition:outline .3s ease;}',
    ].join('');
    document.head.appendChild(st);
  }

  /* ================================ 面板 ================================ */

  let panelEl = null;

  function ensurePanel() {
    if (panelEl && document.body.contains(panelEl)) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.innerHTML =
      '<div class="h"><b>安全考试 · 开卷助手</b>' +
      '<button data-act="toggle">' + (cfg.collapsed ? '展开' : '收起') + '</button>' +
      '<button data-act="rescan">重扫</button></div>' +
      '<div class="body"></div>' +
      '<div class="foot"></div>';
    document.body.appendChild(panelEl);

    panelEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest && ev.target.closest('button');
      if (btn) {
        const act = btn.getAttribute('data-act');
        if (act === 'toggle') { cfg.collapsed = !cfg.collapsed; saveCfg(); applyCollapsed(); }
        if (act === 'rescan') { scan(true); }
        return;
      }
      const row = ev.target.closest && ev.target.closest('.row');
      if (row) {
        const n = +row.getAttribute('data-n');
        const target = document.querySelector('#question-' + n) || null;
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add(PREFIX + '-flash');
          setTimeout(() => target.classList.remove(PREFIX + '-flash'), 1600);
        }
      }
    });

    makeDraggable(panelEl, panelEl.querySelector('.h'));
    applyCollapsed();
    return panelEl;
  }

  function applyCollapsed() {
    if (!panelEl) return;
    const body = panelEl.querySelector('.body');
    const foot = panelEl.querySelector('.foot');
    const btn = panelEl.querySelector('button[data-act="toggle"]');
    body.style.display = cfg.collapsed ? 'none' : '';
    foot.style.display = cfg.collapsed ? 'none' : '';
    if (btn) btn.textContent = cfg.collapsed ? '展开' : '收起';
  }

  function renderPanel(paper, results) {
    const p = ensurePanel();
    const highCount = results.filter((r) => r.tier === 'high').length;
    const midCount = results.filter((r) => r.tier === 'mid').length;
    const noneCount = results.length - highCount - midCount;
    p.querySelector('.body').innerHTML = paper.map((q, i) => {
      const r = results[i];
      if (r.ok) {
        const letters = r.picks.map((x) => LETTERS[x]).join('');
        const text = r.picks.map((x) => stripLead(q.opts[x])).join(' / ');
        const cls = r.tier === 'mid' ? 'a mid' : 'a';
        const mark = r.tier === 'mid' ? '≈' + letters : letters;
        return '<div class="row" data-n="' + q.n + '"><i>' + q.n + '.</i><em class="' + cls + '">' + mark +
          '</em><span>' + esc(text) + (r.partial ? '（部分匹配）' : '') + '</span></div>';
      }
      const hint = r.nearest && r.nearest.stem
        ? ' · 最接近：' + esc(r.nearest.stem) + '…（' + r.nearest.score + '）'
        : '';
      return '<div class="row bad" data-n="' + q.n + '"><i>' + q.n + '.</i><em class="a none">?</em><span>' +
        esc(r.reason) + hint + '</span></div>';
    }).join('');
    p.querySelector('.foot').textContent =
      '确信 ' + highCount + ' · 待核对 ' + midCount + ' · 未命中 ' + noneCount +
      '　题库 ' + (META.count || BANK.length) + ' 题 · ' + (META.built || '');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function makeDraggable(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

    handle.addEventListener('pointerdown', (ev) => {
      dragging = true;
      sx = ev.clientX; sy = ev.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      el.style.right = 'auto'; el.style.bottom = 'auto';
      el.style.left = ox + 'px'; el.style.top = oy + 'px';
      handle.setPointerCapture(ev.pointerId);
    });
    handle.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const nx = Math.max(4, Math.min(window.innerWidth - 80, ox + ev.clientX - sx));
      const ny = Math.max(4, Math.min(window.innerHeight - 40, oy + ev.clientY - sy));
      el.style.left = nx + 'px'; el.style.top = ny + 'px';
    });
    handle.addEventListener('pointerup', (ev) => {
      dragging = false;
      cfg.pos = { left: el.style.left, top: el.style.top };
      saveCfg();
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
    });

    if (cfg.pos && cfg.pos.left) {
      el.style.right = 'auto'; el.style.bottom = 'auto';
      el.style.left = cfg.pos.left; el.style.top = cfg.pos.top;
    }
  }

  /* ============================== 主流程与监听 ============================== */

  let lastSig = '';
  let busy = false;

  function isExamPage() {
    return /#\/exam\/test\/do\//.test(location.hash);
  }

  function scan(force) {
    if (!isExamPage() || busy) return;
    const paper = readPaper();
    if (!paper.length) return;

    const sig = location.hash + '|' + paper.length + '|' + paper.map((q) => q.title.length).join(',');
    if (!force && sig === lastSig) return;
    lastSig = sig;

    busy = true;
    try {
      const results = paper.map((q) => engine.solve(q.title, q.opts));
      paper.forEach((q, i) => decorate(q, results[i]));
      renderPanel(paper, results);
    } finally {
      busy = false;
    }
  }

  let timer = null;
  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => scan(false), delay || 400);
  }

  function boot() {
    injectStyle();
    schedule(600);

    window.addEventListener('hashchange', () => schedule(700));

    const mo = new MutationObserver(() => { if (!busy) schedule(500); });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('keydown', (ev) => {
      if (ev.altKey && (ev.key === 'h' || ev.key === 'H')) {
        cfg.collapsed = !cfg.collapsed; saveCfg(); applyCollapsed();
      }
    });

    // 首次渲染可能晚于脚本注入，补几次
    [1500, 3000, 6000].forEach((d) => setTimeout(() => scan(false), d));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
