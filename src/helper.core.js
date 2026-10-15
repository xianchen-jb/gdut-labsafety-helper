// ==UserScript==
// @name         广工实验室安全 · 开卷助手（只读标注版）
// @namespace    local.gdut.labsafety.helper
// @version      0.5.0
// @description  广工实验室安全考试开卷助手：读卷比对内置题库（3066 题），面板列答案并高亮正确选项，支持图片指纹匹配与三级可信度标注。只标注，不自动点选、不自动交卷。
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

  const cfg = Object.assign({ collapsed: false, highlight: true, pos: null, scope: 'high' }, readCfg());

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
      const imgs = [...el.querySelectorAll('img')]
        .map((im) => im.currentSrc || im.src || '')
        .filter(Boolean);
      return {
        n: i + 1,
        el,
        titleEl,
        title: cleanTitle(titleEl),
        labels,
        opts: labels.map((l) => (l.innerText || '').trim()),
        multi: !!el.querySelector('.el-checkbox'),
        imgs,
        hasImg: imgs.length > 0,
      };
    }).filter((q) => q.opts.length >= 2 && q.title);
  }

  /**
   * 取题干原文：一定要排除脚本自己插进去的徽章。
   * （v0.4.0 之前徽章挂在 .question-title 里，导致重新扫描时"题干 = 题干+徽章"，
   *   相似度被拉低，实测把 11 道本该命中的题误判成未命中。）
   */
  function cleanTitle(titleEl) {
    let text = '';
    try {
      const clone = titleEl.cloneNode(true);
      clone.querySelectorAll('.' + PREFIX + '-badge').forEach((n) => n.remove());
      text = clone.innerText || clone.textContent || '';
    } catch (e) {
      text = titleEl.innerText || '';
    }
    return text.replace(/\s+$/, '').replace(/^\s+/, '');
  }

  function clearMarks(q) {
    q.el.querySelectorAll('.' + PREFIX + '-badge').forEach((e) => e.remove());
    if (q.badgeEl && q.badgeEl.parentNode) q.badgeEl.remove();
    q.badgeEl = null;
    q.labels.forEach((l) => {
      l.classList.remove(PREFIX + '-opt');
      l.style.removeProperty('background');
      l.style.removeProperty('box-shadow');
    });
  }

  function decorate(q, res) {
    clearMarks(q);
    if (!res.ok) {
      const ref = res.reference;
      if (ref && ref.picks.length) {
        const letters = ref.picks.map((i) => LETTERS[i]).join('');
        const texts = ref.picks.map((i) => stripLead(q.opts[i])).join(' / ');
        badge(q, '? 未命中 · 参考 ' + letters + ' ' + texts + '（相似 ' + ref.score + '）', 'ref');
      } else if (q.hasImg) {
        badge(q, '? 图片题，需人工判断' + (res.nearest ? '（最接近 ' + res.nearest.score + '）' : ''), 'none');
      } else {
        const hint = res.nearest && res.nearest.score ? '，最接近 ' + res.nearest.score : '';
        badge(q, '? ' + res.reason + hint, 'none');
      }
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
    if (res.source === 'image') badge(q, '图✓ ' + letters + ' ' + texts + ' · 图片指纹命中' + tail, 'ok');
    else if (res.tier === 'mid') badge(q, '≈ ' + letters + ' ' + texts + ' · 建议核对' + tail, 'mid');
    else badge(q, '✓ ' + letters + ' ' + texts + tail, 'ok');
  }

  function badge(q, text, kind) {
    const el = document.createElement('div');
    el.className = PREFIX + '-badge ' + PREFIX + '-badge-' + kind;
    el.textContent = text;
    el.title = kind === 'ok'
      ? '题库精确命中（' + (META.version || '') + '）'
      : (kind === 'mid'
        ? '题库里找到相近题目，答案仅供参考，请自行核对'
        : (kind === 'ref'
          ? '题库未命中；下方是"最接近题目"的答案，仅供参考，请自行核对'
          : '题库里没有这道题（或选项版本不同），需要人工判断'));
    q.badgeEl = el;
    if (q.titleEl.parentNode) q.titleEl.parentNode.insertBefore(el, q.titleEl.nextSibling);
    else q.titleEl.appendChild(el);
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
      '.' + PREFIX + '-badge-ref{background:#fffdf5;color:#8a5300;border:1px dashed #e0b06a;}',
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
      '#' + PANEL_ID + ' select{border:1px solid #d3dae3;border-radius:6px;padding:1px 3px;',
      'font-size:12px;color:#374151;background:#fff;max-width:86px;}',
      '#' + PANEL_ID + ' .body{max-height:52vh;overflow:auto;padding:6px 4px;}',
      '#' + PANEL_ID + ' .row{display:flex;gap:6px;align-items:flex-start;padding:4px 8px;border-radius:6px;cursor:pointer;}',
      '#' + PANEL_ID + ' .row:hover{background:#f2f5f9;}',
      '#' + PANEL_ID + ' .row i{font-style:normal;color:#6b7280;min-width:22px;text-align:right;}',
      '#' + PANEL_ID + ' .row .a{font-weight:600;color:#116b3a;min-width:16px;}',
      '#' + PANEL_ID + ' .row .a.mid{color:#b45309;}',
      '#' + PANEL_ID + ' .row .a.ref{color:#b45309;font-weight:600;}',
      '#' + PANEL_ID + ' .row.bad .a.none{color:#8b95a1;}',
      '#' + PANEL_ID + ' .row span{flex:1;color:#374151;}',
      '#' + PANEL_ID + ' .todo{margin:2px 6px 6px;padding:5px 8px;border-radius:6px;background:#fff7e6;',
      'border:1px solid #f0d9a8;color:#8a5300;font-size:12px;line-height:1.5;}',
      '#' + PANEL_ID + ' .todo.allok{background:#eefaf1;border-color:#b7e0c6;color:#116b3a;}',
      '#' + PANEL_ID + ' .diag{position:absolute;left:8px;right:8px;top:38px;bottom:8px;background:#fff;',
      'border:1px solid #cfd6de;border-radius:6px;display:flex;flex-direction:column;box-shadow:0 4px 14px rgba(16,24,40,.12);}',
      '#' + PANEL_ID + ' .diag .dh{padding:6px 8px;font-size:12px;color:#374151;border-bottom:1px solid #e3e8ef;}',
      '#' + PANEL_ID + ' .diag textarea{flex:1;margin:6px;border:1px solid #d3dae3;border-radius:4px;',
      'font:11px/1.4 Consolas,Monaco,monospace;padding:6px;resize:none;color:#1f2937;}',
      '#' + PANEL_ID + ' .diag .db{display:flex;gap:6px;padding:6px 8px;border-top:1px solid #e3e8ef;}',
      '#' + PANEL_ID + '{position:fixed;}',
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
      '<select data-act="scope" title="一键作答的范围"><option value="high">只填确信</option>' +
      '<option value="mid">确信+待核对</option><option value="all">全部（含参考）</option></select>' +
      '<button data-act="auto">一键作答</button>' +
      '<button data-act="toggle">' + (cfg.collapsed ? '展开' : '收起') + '</button>' +
      '<button data-act="export">导出诊断</button>' +
      '<button data-act="rescan">重扫</button></div>' +
      '<div class="body"></div>' +
      '<div class="foot"></div>';
    document.body.appendChild(panelEl);

    const scopeSel = panelEl.querySelector('select[data-act="scope"]');
    if (scopeSel) {
      scopeSel.value = cfg.scope;
      scopeSel.addEventListener('change', () => { cfg.scope = scopeSel.value; saveCfg(); });
    }

    panelEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest && ev.target.closest('button');
      if (btn) {
        const act = btn.getAttribute('data-act');
        if (act === 'toggle') { cfg.collapsed = !cfg.collapsed; saveCfg(); applyCollapsed(); }
        if (act === 'rescan') { scan(true); }
        if (act === 'export') { exportDiag(); }
        if (act === 'auto') { runAuto(); }
        if (act === 'diag-copy') {
          const ok = copyText(lastDiagText);
          btn.textContent = ok ? '已复制' : '请手动全选复制';
          setTimeout(() => { btn.textContent = '复制'; }, 2000);
        }
        if (act === 'diag-dl') { btn.textContent = downloadDiag() ? '已下载' : '下载被拦截'; }
        if (act === 'diag-close') {
          const box = panelEl.querySelector('.diag');
          if (box) box.remove();
        }
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
    let highCount = 0, midCount = 0, refCount = 0, noneCount = 0;
    const todo = [];
    results.forEach((r, i) => {
      if (r.ok && r.tier === 'high' && !r.partial) highCount++;
      else if (r.ok) { midCount++; todo.push(paper[i].n); }
      else if (r.reference && r.reference.picks.length) { refCount++; todo.push(paper[i].n); }
      else { noneCount++; todo.push(paper[i].n); }
    });

    const strip = todo.length
      ? '<div class="todo">需人工核对 ' + todo.length + ' 题：' + todo.join('、') + '</div>'
      : '<div class="todo allok">全部命中题库，可直接交卷</div>';

    const rows = paper.map((q, i) => {
      const r = results[i];
      if (r.ok) {
        const letters = r.picks.map((x) => LETTERS[x]).join('');
        const text = r.picks.map((x) => stripLead(q.opts[x])).join(' / ');
        const cls = r.tier === 'mid' ? 'a mid' : 'a';
        const mark = r.tier === 'mid' ? '≈' + letters : letters;
        return '<div class="row" data-n="' + q.n + '"><i>' + q.n + '.</i><em class="' + cls + '">' + mark +
          '</em><span>' + esc(text) + (r.partial ? '（部分匹配）' : '') +
          (autoFilled.has(q.n) ? ' · 已填' : '') + '</span></div>';
      }
      const ref = r.reference;
      if (ref && ref.picks.length) {
        const letters = ref.picks.map((x) => LETTERS[x]).join('');
        const text = ref.picks.map((x) => stripLead(q.opts[x])).join(' / ');
        return '<div class="row bad" data-n="' + q.n + '"><i>' + q.n + '.</i><em class="a ref">参考' + letters +
          '</em><span>' + esc(text) + '（相似 ' + ref.score + '，非题库答案）</span></div>';
      }
      const hint = r.nearest && r.nearest.stem
        ? ' · 最接近：' + esc(r.nearest.stem) + '…（' + r.nearest.score + '）'
        : '';
      return '<div class="row bad" data-n="' + q.n + '"><i>' + q.n + '.</i><em class="a none">?</em><span>' +
        (q.hasImg ? '图片题' : esc(r.reason)) + hint + '</span></div>';
    }).join('');

    p.querySelector('.body').innerHTML = strip + rows;
    p.querySelector('.foot').textContent =
      '确信 ' + highCount + ' · 待核对 ' + midCount + ' · 参考 ' + refCount + ' · 无答案 ' + noneCount +
      '　题库 ' + (META.count || BANK.length) + ' 题 · ' + (META.built || '');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function makeDraggable(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

    handle.addEventListener('pointerdown', (ev) => {
      // 点在按钮上时不要开始拖拽，否则指针捕获会吞掉按钮的 click
      if (ev.target && ev.target.closest && ev.target.closest('button')) return;
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
  let lastPaper = null;
  let lastResults = null;
  const autoFilled = new Set();

  /* ------------------------- 一键作答（只点选，不提交） ------------------------- */

  function isChecked(label) {
    if (!label) return false;
    if (label.classList.contains('is-checked')) return true;
    const input = label.querySelector && label.querySelector('input');
    return !!(input && input.checked);
  }

  // 用真实点击事件选中某个选项；点不动时逐级重试更内层的元素
  function clickOption(label) {
    if (!label) return false;
    const targets = [
      label,
      label.querySelector && label.querySelector('.el-radio__inner, .el-checkbox__inner'),
      label.querySelector && label.querySelector('.option, .el-radio__label, .el-checkbox__label'),
      label.querySelector && label.querySelector('input'),
    ];
    for (const t of targets) {
      if (!t) continue;
      if (t.click) {
        try { t.click(); } catch (e) { /* 继续尝试 */ }
      }
      if (isChecked(label)) return true;
    }
    return isChecked(label);
  }

  /**
   * 一键作答：按当前范围把引擎给出的答案点选上去。
   * 三条硬约束：不自动交卷、不联网、不动"已经有选择"的题（避免覆盖你自己的作答）。
   */
  function runAuto() {
    const paper = readPaper();
    if (!paper.length) return;
    const results = paper.map((q) => engine.solve(q.title, q.opts, (q.imgs || []).map(imgFp)));

    let filled = 0, skipped = [], keptMine = 0;
    paper.forEach((q, i) => {
      const r = results[i];
      // 未命中时带的是"参考"答案，只有把范围切到"全部"才会用它
      const picks = r.ok ? r.picks : ((r.reference && r.reference.picks) || []);
      if (!picks.length) { skipped.push(q.n); return; }
      if (cfg.scope === 'high' && r.tier !== 'high') { skipped.push(q.n); return; }
      if (cfg.scope === 'mid' && (r.tier !== 'high' && r.tier !== 'mid')) { skipped.push(q.n); return; }
      if (q.labels.some(isChecked)) { keptMine++; return; }   // 已有选择，不覆盖

      const doneAll = picks.every((k) => isChecked(q.labels[k]) || clickOption(q.labels[k]));
      if (doneAll) { filled++; autoFilled.add(q.n); } else skipped.push(q.n);
    });

    lastPaper = paper;
    lastResults = results;
    paper.forEach((q, i) => decorate(q, results[i]));
    renderPanel(paper, results);

    const scopeName = cfg.scope === 'high' ? '只填确信' : (cfg.scope === 'mid' ? '确信+待核对' : '全部（含参考）');
    const foot = panelEl && panelEl.querySelector('.foot');
    if (foot) {
      foot.textContent = '一键作答（' + scopeName + '）：已填 ' + filled + ' 题' +
        (keptMine ? '，保留你自己的选择 ' + keptMine + ' 题' : '') +
        (skipped.length ? '，跳过 ' + skipped.length + ' 题（' + skipped.slice(0, 12).join('、') +
          (skipped.length > 12 ? '…' : '') + '）' : '') + '　—— 未提交，请你自行核对后交卷';
      setTimeout(() => { if (lastPaper && lastResults) renderPanel(lastPaper, lastResults); }, 8000);
    }
  }

  /** 导出诊断：把每题的原文与判定细节存成本地 JSON（不上传任何数据） */
  function exportDiag() {
    if (!lastPaper || !lastResults) { return; }
    const pickTexts = (q, picks) => (picks || []).map((k) => (q.opts[k] || '').replace(/\s+/g, ' '));
    const items = lastPaper.map((q, i) => {
      const r = lastResults[i] || {};
      const picks = r.ok ? r.picks : ((r.reference && r.reference.picks) || []);
      const bank = r.entry || (r.reference && r.reference.entry) || null;
      return {
        n: q.n,
        title: q.title.replace(/\s+/g, ' '),
        opts: q.opts.map((o) => o.replace(/\s+/g, ' ')),
        img: q.hasImg,
        imgSrcs: (q.imgs || []).map((s) => String(s).slice(0, 300)),
        imgFps: (q.imgs || []).map(imgFp),
        multi: q.multi,
        tier: r.ok ? r.tier : 'none',
        source: r.ok ? (r.source || 'text') : 'none',
        conf: r.conf != null ? r.conf : (r.reference ? r.reference.score : null),
        stemSim: r.stemSim != null ? r.stemSim : (r.reference ? r.reference.stemSim : null),
        optSim: r.optSim != null ? r.optSim : null,
        picks,
        pickedTexts: pickTexts(q, picks),
        reason: r.ok ? '' : (r.reference && r.reference.picks.length ? 'low-similarity' : (r.reason || 'no-answer')),
        bankStem: bank ? bank[0] : '',
        bankOpts: bank ? bank[1] : [],
        bankCk: bank ? bank[2] : '',
        nearest: r.nearest || null,
      };
    });

    const summary = {
      total: items.length,
      high: items.filter((x) => x.tier === 'high' && x.source === 'text').length,
      byImage: items.filter((x) => x.source === 'image').length,
      mid: items.filter((x) => x.tier === 'mid').length,
      refOnly: items.filter((x) => x.tier === 'none' && x.pickedTexts.length).length,
      noAnswer: items.filter((x) => x.tier === 'none' && !x.pickedTexts.length).length,
      withImage: items.filter((x) => x.img).length,
      missingList: items.filter((x) => x.tier !== 'high' || x.source === 'image').map((x) => x.n),
    };

    const payload = {
      helper: 'gdut-labsafety-helper',
      script: META.scriptVersion || '',
      version: META.version || '',
      bank: META.count || BANK.length,
      url: location.hash,
      at: new Date().toISOString(),
      summary,
      items,
    };
    const text = JSON.stringify(payload, null, 1);

    // 不管能不能自动复制/下载，都弹出一个可手动复制的面板，保证一定拿得到
    showDiag(text);
  }

  let lastDiagText = '';

  function showDiag(text) {
    lastDiagText = text;
    const p = ensurePanel();
    let box = p.querySelector('.diag');
    if (!box) {
      box = document.createElement('div');
      box.className = 'diag';
      p.appendChild(box);
    }
    box.innerHTML =
      '<div class="dh">诊断数据（' + (lastResults ? lastResults.length : 0) + ' 题）</div>' +
      '<textarea readonly spellcheck="false"></textarea>' +
      '<div class="db">' +
      '<button data-act="diag-copy">复制</button>' +
      '<button data-act="diag-dl">下载文件</button>' +
      '<button data-act="diag-close">关闭</button>' +
      '</div>';
    const ta = box.querySelector('textarea');
    if (ta) {
      ta.value = text;
      try { ta.focus(); ta.select(); } catch (e) { /* 忽略 */ }
    }
    copyText(text);
  }

  function copyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.setProperty('position', 'fixed');
    ta.style.setProperty('left', '-9999px');
    document.body.appendChild(ta);
    let ok = false;
    try {
      ta.select();
      ok = document.execCommand && document.execCommand('copy');
    } catch (e) { ok = false; }
    ta.remove();
    if (!ok) {
      try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text); } catch (e) { /* 忽略 */ }
    }
    return ok;
  }

  function downloadDiag() {
    if (!lastDiagText) return false;
    try {
      const blob = new Blob([lastDiagText], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gdut-helper-diag-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (e) { return false; }
  }

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
      const results = paper.map((q) => engine.solve(q.title, q.opts, (q.imgs || []).map(imgFp)));
      lastPaper = paper;
      lastResults = results;
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
