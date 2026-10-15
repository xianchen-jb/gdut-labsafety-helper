// 用最新引擎重新给历史诊断打分（去掉题干里混入的徽章文字），验证修复效果。
// 用法: node tools/regrade-diag.mjs <diag.json>

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, stripLead } from '../src/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(resolve(here, '../data/bank.json'), 'utf8'));
const engine = createEngine(rows);

const file = process.argv[2];
if (!file) {
  console.log('用法: node tools/regrade-diag.mjs <diag.json>');
  process.exit(0);
}
const data = JSON.parse(readFileSync(file, 'utf8'));
const items = data.items || [];

// 去掉我自己的徽章文字：题干 + " ✓ B …" / " ≈ B …" / " ? 未命中…" / "图✓ …"
const cleanTitle = (t) => String(t || '').split(/\s[图]?[✓≈?]\s/)[0].trim();

const bucketOf = (r) => {
  if (r.ok && r.source === 'image') return 'image';
  if (r.ok && r.tier === 'high') return 'high';
  if (r.ok) return 'mid';
  if (r.reference && r.reference.picks.length) return 'ref';
  return 'none';
};

const before = {}, after = {};
const improved = [];

for (const x of items) {
  const rawTitle = x.title || '';
  const clean = cleanTitle(rawTitle);
  const b = (() => {
    if (x.tier === 'high' && x.source === 'image') return 'image';
    if (x.tier === 'high') return 'high';
    if (x.tier === 'mid') return 'mid';
    if ((x.pickedTexts || []).length) return 'ref';
    return 'none';
  })();
  before[b] = (before[b] || 0) + 1;

  const res = engine.solve(clean, x.opts || [], x.imgFps || []);
  const a = bucketOf(res);
  after[a] = (after[a] || 0) + 1;

  if (a !== b) {
    improved.push({
      n: x.n, from: b, to: a,
      picks: res.ok ? res.picks.map((i) => stripLead((x.opts || [])[i] || '')).join(' / ') : '',
      title: clean.slice(0, 30),
    });
  }
}

const pct = (n) => ((n / items.length) * 100).toFixed(1) + '%';
const line = (m) => '  确信 ' + (m.high || 0) + '（图片指纹 ' + (m.image || 0) + '）· 待核对 ' + (m.mid || 0) +
  ' · 仅参考 ' + (m.ref || 0) + ' · 无答案 ' + (m.none || 0) +
  '　=> 有答案 ' + pct((m.high || 0) + (m.image || 0) + (m.mid || 0));

console.log('重新打分（共 ' + items.length + ' 题）');
console.log('  修复前（诊断原始记录）'); console.log(line(before));
console.log('  修复后（题干去掉徽章污染，用最新引擎重算）'); console.log(line(after));

const up = improved.filter((x) => (x.from === 'none' || x.from === 'ref') && (x.to === 'high' || x.to === 'mid' || x.to === 'image'));
console.log('\n升级的题 ' + up.length + ' 道（原未命中/仅参考 → 确信/待核对）:');
up.slice(0, 20).forEach((x) => console.log('  第' + x.n + '题 ' + x.from + ' -> ' + x.to + '　' + x.title + '　答案: ' + x.picks));

const stillNeed = items.filter((x) => {
  const res = engine.solve(cleanTitle(x.title || ''), x.opts || [], x.imgFps || []);
  const a = bucketOf(res);
  return a === 'ref' || a === 'none';
});
console.log('\n修复后仍无确信答案的题 ' + stillNeed.length + ' 道:');
stillNeed.forEach((x) => {
  const res = engine.solve(cleanTitle(x.title || ''), x.opts || [], x.imgFps || []);
  console.log('  第' + x.n + '题 [' + bucketOf(res) + '] ' + cleanTitle(x.title || '').slice(0, 30) +
    (x.img ? ' [图片]' : '') + ' 相似 ' + (res.ok ? res.conf : (res.reference ? res.reference.score : '—')));
});
