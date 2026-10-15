// 召回/鲁棒性评测。
//
// 说明：题库已按「题干+选项」去重，所以传统留一法（把题从库里拿掉再匹配它自己）没有意义——
// 等于把答案删了再要求答对。这里改用两种有真实意义的评测：
//   A. 扰动鲁棒性：把卷面做等价变形（选项乱序 / 全角繁体 / 去括号 / 删干扰项 / 插空白），
//      看引擎还能不能命中并给出同一组正确选项（按选项文本判定，不看字母）。
//   B. 同题干多版本区分：同一题干存在多套选项时，看引擎是否挑中与卷面选项吻合的那一套。
//
// 用法:
//   node test/recall.eval.mjs               # 全量
//   node test/recall.eval.mjs --limit 800   # 抽样
//   node test/recall.eval.mjs --engine ./test/_engine_v1.mjs   # 换引擎对比

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const ei = process.argv.indexOf('--engine');
let engineUrl = new URL('../src/engine.js', import.meta.url).href;
if (ei >= 0) {
  const raw = process.argv[ei + 1];
  const found = [resolve(here, raw), resolve(process.cwd(), raw)].find((p) => existsSync(p));
  if (!found) throw new Error('找不到引擎文件: ' + raw);
  engineUrl = pathToFileURL(found).href;
}
const { createEngine, norm, stripLead } = await import(engineUrl);

const rows = JSON.parse(readFileSync(resolve(here, '../data/bank.json'), 'utf8'));

const argv = process.argv.slice(2);
const li = argv.indexOf('--limit');
const limit = li >= 0 ? Number(argv[li + 1]) || rows.length : rows.length;

const engine = createEngine(rows);
const thresholds = engine.thresholds || { HIGH: 0.85, MID: 0.7 };

const correctIdx = (row) => [...row[2]].map((c, i) => (c === '1' ? i : -1)).filter((i) => i >= 0);
const keyOf = (s) => norm(stripLead(s));

/* ------------------------- 卷面等价变形 ------------------------- */

const TRAD_OUT = { 对: '對', 错: '錯', 无: '無', 电: '電', 气: '氣', 验: '驗', 标: '標', 压: '壓', 门: '門', 关: '關' };

function toFullWidth(s) {
  return s.replace(/[\x21-\x7e]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
}

function toTrad(s) {
  return s.split('').map((c) => TRAD_OUT[c] || c).join('');
}

// 返回 { title, opts, expect:Set<normalizedOptionText> }；不适用的变形返回 null
function perturb(original, kind) {
  const title = original[0];
  const opts = original[1];
  const want = correctIdx(original).map((i) => keyOf(opts[i]));

  if (kind === 'shuffle') {
    return { title, opts: [...opts].reverse(), want };
  }
  if (kind === 'width') {
    return { title: toFullWidth(title), opts: opts.map(toFullWidth), want };
  }
  if (kind === 'trad') {
    return { title: toTrad(toFullWidth(title)), opts: opts.map((o) => toTrad(toFullWidth(o))), want };
  }
  if (kind === 'core') {
    if (!/[（(【\[]/.test(title)) return null;
    return { title: title.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ''), opts, want };
  }
  if (kind === 'drop') {
    const dropAt = opts.findIndex((_, i) => !correctIdx(original).includes(i));
    if (dropAt < 0 || opts.length <= 2) return null;
    return { title, opts: opts.filter((_, i) => i !== dropAt), want };
  }
  if (kind === 'space') {
    return {
      title: title.split('').join('\u2005'),
      opts: opts.map((o) => o.replace(/([，,。.；;])/g, '$1\n')),
      want,
    };
  }
  return null;
}

const KINDS = ['shuffle', 'width', 'trad', 'core', 'drop', 'space'];

const stats = new Map(KINDS.map((k) => [k, { total: 0, correct: 0, wrong: 0, miss: 0, mid: 0, samples: [] }]));
const thresholdPool = [];

for (let i = 0; i < Math.min(limit, rows.length); i++) {
  const row = rows[i];
  for (const kind of KINDS) {
    const p = perturb(row, kind);
    if (!p) continue;
    const res = engine.solve(p.title, p.opts);
    const st = stats.get(kind);
    st.total++;

    const got = res.ok ? res.picks.map((k2) => keyOf(p.opts[k2])).sort() : null;
    const want = [...p.want].sort();
    const isSame = got && got.length === want.length && got.every((x, k2) => x === want[k2]);

    thresholdPool.push({ conf: res.ok ? res.conf : 0, correct: !!isSame });

    if (!res.ok) { st.miss++; if (st.samples.length < 3) st.samples.push(`${kind} miss :: ${row[0].slice(0, 26)}`); }
    else if (isSame) { st.correct++; if (res.tier === 'mid') st.mid++; }
    else {
      st.wrong++;
      if (st.samples.length < 3) st.samples.push(`${kind} wrong 期望[${want}] 实际[${got}] 分数${res.conf} :: ${row[0].slice(0, 24)}`);
    }
  }
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');

console.log(`扰动鲁棒性评测（样本 ${Math.min(limit, rows.length)} 题）`);
console.log('  变形       用例数   答对     答错     未命中   准确率');
for (const kind of KINDS) {
  const s = stats.get(kind);
  if (!s.total) continue;
  console.log(
    '  ' + kind.padEnd(9) +
    String(s.total).padStart(6) +
    String(s.correct).padStart(8) +
    String(s.wrong).padStart(8) +
    String(s.miss).padStart(9) +
    ('   ' + pct(s.correct, s.total)).padStart(10),
  );
}

const totalAll = [...stats.values()].reduce((a, b) => a + b.total, 0);
const correctAll = [...stats.values()].reduce((a, b) => a + b.correct, 0);
const wrongAll = [...stats.values()].reduce((a, b) => a + b.wrong, 0);
const missAll = [...stats.values()].reduce((a, b) => a + b.miss, 0);
console.log(
  '  ' + '合计'.padEnd(9) + String(totalAll).padStart(6) + String(correctAll).padStart(8) +
  String(wrongAll).padStart(8) + String(missAll).padStart(9) + ('   ' + pct(correctAll, totalAll)).padStart(10),
);

console.log('');
console.log('失败抽样:');
const shown = [];
for (const kind of KINDS) {
  const s = stats.get(kind);
  s.samples.forEach((x) => { if (shown.length < 8) shown.push('  ' + x); });
}
shown.forEach((x) => console.log(x));

/* ---------------------- 阈值扫描（给答案的准确率） ---------------------- */

console.log('');
console.log('阈值扫描（只有 conf ≥ 阈值 才给答案）');
console.log('  阈值   给答案   正确    错误    准确率   未命中率');
const sorted = thresholdPool.slice().sort((a, b) => b.conf - a.conf);
for (const t of [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]) {
  const given = sorted.filter((r) => r.conf >= t);
  const ok = given.filter((r) => r.correct).length;
  const bad = given.length - ok;
  console.log(
    '  ' + t.toFixed(2) + String(given.length).padStart(8) + String(ok).padStart(8) +
    String(bad).padStart(8) + ('   ' + pct(ok, given.length)).padStart(10) +
    ('   ' + pct(thresholdPool.length - given.length, thresholdPool.length)).padStart(11),
  );
}

/* ------------------- 同题干多版本区分（真实数据） ------------------- */

const groups = new Map();
rows.forEach((r, i) => {
  const key = norm(r[0]);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(i);
});
const multi = [...groups.values()].filter((g) => g.length > 1);

let multiTotal = 0, multiCorrect = 0;
for (const g of multi) {
  for (const i of g) {
    const row = rows[i];
    const res = engine.solve(row[0], row[1]);
    multiTotal++;
    if (!res.ok) continue;
    const got = res.picks.map((k) => keyOf(row[1][k])).sort();
    const want = correctIdx(row).map((k) => keyOf(row[1][k])).sort();
    if (got.length === want.length && got.every((x, k) => x === want[k])) multiCorrect++;
  }
}

console.log('');
console.log(`同题干多版本区分：${multi.length} 组、${multiTotal} 次作答，选对且答案正确 ${multiCorrect} 次（${pct(multiCorrect, multiTotal)}）`);
