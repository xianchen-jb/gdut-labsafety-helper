// 冒烟测试：用极简假 DOM 跑一遍构建产物，确认脚本能在卷面上加载、标注、出面板。
// 用法: node build.mjs && node test/core.smoke.mjs

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../gdut-labsafety-helper.user.js');

/* ------------------------------ 极简假 DOM ------------------------------ */

function makeEl(tag) {
  const classes = new Set();
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentElement: null,
    textContent: '',
    title: '',
    _html: '',
    _q: {},
    _listeners: {},
    _classes: classes,
    style: { setProperty() {}, removeProperty() {} },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    get classList() {
      return {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        contains: (c) => classes.has(c),
      };
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); indexHtml(this, this._html); },
    appendChild(c) {
      this.children.push(c);
      c.parentElement = this;
      const reg = (key) => { (this._q[key] = this._q[key] || []).push(c); };
      reg(c.tagName);
      [...c._classes].forEach((cls) => reg('.' + cls));
      return c;
    },
    remove() {
      const p = this.parentElement;
      if (p) p.children = p.children.filter((x) => x !== this);
    },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    setAttribute() {},
    getAttribute(name) {
      const m = /data-act="([^"]+)"/.exec(this._attrs || '');
      return name === 'data-act' && m ? m[1] : null;
    },
    closest(sel) {
      let n = this;
      while (n) {
        if (sel.startsWith('.') ? n._classes.has(sel.slice(1)) : n.tagName === sel.toUpperCase()) return n;
        n = n.parentElement;
      }
      return null;
    },
    contains(n) { return this.children.includes(n); },
    querySelector(sel) { return (this._q[sel] || [])[0] || null; },
    querySelectorAll(sel) { return this._q[sel] || []; },
    scrollIntoView() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false; },
  };
  return el;
}

// 把 innerHTML 里的标签按 class / data-act 注册成可查询的子元素
function indexHtml(host, html) {
  const re = /<(\w+)([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1];
    const attrs = m[2];
    const cls = /class="([^"]*)"/.exec(attrs);
    const el = makeEl(tag);
    el._attrs = attrs;
    el.parentElement = host;
    (host._q[tag] = host._q[tag] || []).push(el);
    if (cls) {
      cls[1].split(/\s+/).filter(Boolean).forEach((c) => {
        (host._q['.' + c] = host._q['.' + c] || []).push(el);
      });
    }
    const act = /data-act="([^"]+)"/.exec(attrs);
    if (act) (host._q[`${tag}[data-act="${act[1]}"]`] = host._q[`${tag}[data-act="${act[1]}"]`] || []).push(el);
    host.children.push(el);
  }
}

const byId = {};
const selMap = {};

const document = {
  readyState: 'complete',
  documentElement: makeEl('html'),
  head: makeEl('head'),
  body: makeEl('body'),
  getElementById: (id) => byId[id] || null,
  createElement: (tag) => makeEl(tag),
  addEventListener() {},
  querySelector: (sel) => (selMap[sel] || [])[0] || null,
  querySelectorAll: (sel) => selMap[sel] || [],
};

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

/* ---------------------------- 造两道假题目 ---------------------------- */

function fakeQuestion(id, title, opts) {
  const q = makeEl('div');
  q.id = id;
  byId[id] = q;
  const titleEl = makeEl('div');
  titleEl.innerText = title;
  q._titleEl = titleEl;
  q._q['.question-title'] = [titleEl];
  const labels = opts.map((text) => {
    const l = makeEl('label');
    l.innerText = text;
    return l;
  });
  q._q['.question-options label'] = labels;
  q._q['.el-checkbox'] = [];
  q._q['img'] = [];
  q._q['.' + 'gdut-helper-badge'] = [];
  return q;
}

const q1 = fakeQuestion('question-1', '实验室人员发生触电时，下例哪种行为是不正确的？', [
  'A. 应迅速切断电源，将触电者上衣解开，取出口中异物，然后进行人工呼吸',
  'B. 应迅速注射强心针',
  'C. 当患者伤势严重时，应立即送医院强救',
  'D. 无',
]);
const q2 = fakeQuestion('question-2', '实验室发现可燃气体泄漏，要迅速切断电源，打开门窗。', ['对', '错']);
selMap['[id^="question-"]'] = [q1, q2];

globalThis.document = document;
globalThis.window = {
  addEventListener() {},
  innerWidth: 1280,
  innerHeight: 800,
  location: { hash: '#/exam/test/do/2110402894292291586' },
};
globalThis.location = globalThis.window.location;
globalThis.localStorage = localStorage;
globalThis.MutationObserver = class { observe() {} disconnect() {} };

/* ------------------------------- 执行 ------------------------------- */

const code = readFileSync(dist, 'utf8');
let error = null;
try {
  new Function(code)();
} catch (e) {
  error = e;
}

await new Promise((r) => setTimeout(r, 900));

const panel = byId['gdut-helper-panel'] || document.body.children.find((c) => c.id === 'gdut-helper-panel');
const panelHtml = panel && panel.querySelector('.body') ? panel.querySelector('.body').innerHTML : '';
const badgeOf = (q) => (q._titleEl.children || []).find((c) => c.className.includes('gdut-helper-badge'));
const badge1 = badgeOf(q1);
const badge2 = badgeOf(q2);

const checks = [
  ['加载无异常', !error, error && error.message],
  ['注入了样式', document.head.children.length > 0, ''],
  ['创建了面板', !!panel, ''],
  ['面板列出第1题答案', /应迅速注射强心针/.test(panelHtml), panelHtml.slice(0, 120)],
  ['第1题标注了 B', !!badge1 && /^✓ B /.test(badge1.textContent), badge1 && badge1.textContent],
  ['第2题标注了"错"', !!badge2 && badge2.textContent.includes('错'), badge2 && badge2.textContent],
];

// 点击「导出诊断」：先修过"拖拽指针捕获吞掉按钮点击"的 bug，这里做回归保护
const exportBtn = (panel && panel._q['button[data-act="export"]'] || [])[0];
let diagText = '';
if (exportBtn) {
  let node = exportBtn;
  while (node) {
    (node._listeners.click || []).forEach((fn) => fn({ target: exportBtn }));
    node = node.parentElement;
  }
  const diagBox = panel.querySelector('.diag');
  const ta = diagBox && diagBox.querySelector('textarea');
  diagText = (ta && ta.value) || '';
}
checks.push(['导出按钮存在', !!exportBtn, '']);
checks.push(['点击导出后弹出诊断面板', !!diagText, '']);
checks.push(['诊断内容包含题目数据', /"items"/.test(diagText) && /应迅速注射强心针/.test(diagText), diagText.slice(0, 80)]);

let ok = true;
for (const [name, pass, detail] of checks) {
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass || !detail ? '' : ' -> ' + detail));
  if (!pass) ok = false;
}

// 面板文案抽样，便于人工确认
console.log('面板内容片段: ' + panelHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160));

if (!ok) process.exitCode = 1;
