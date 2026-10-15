// 汇总 benchmarks/runs/*.json：每份诊断的"原始记录" vs "用当前引擎+当前题库重算"。
// 用法: node tools/benchmark-summary.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, stripLead } from '../src/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const rows = JSON.parse(readFileSync(resolve(root, 'data/bank.json'), 'utf8'));
const engine = createEngine(rows);

const runsDir = resolve(root, 'benchmarks/runs');
const files = readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort();

const cleanTitle = (t) => String(t || '').split(/\s[图]?[✓≈?]\s/)[0].trim();
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '—');

const bucketOf = (r) => {
  if (r.ok && r.source === 'image') return 'image';
  if (r.ok && r.tier === 'high') return 'high';
  if (r.ok) return 'mid';
  if (r.reference && r.reference.picks.length) return 'ref';
  return 'none';
};

console.log('诊断文件对比（当前题库 ' + rows.length + ' 题）\n');
console.log('  文件                                        脚本     原始记录(确信/待核对/仅参考/无答案)   重算后(确信+图/待核对/仅参考/无答案)  覆盖');

for (const f of files) {
  const data = JSON.parse(readFileSync(resolve(runsDir, f), 'utf8'));
  const items = data.items || [];
  if (!items.length) continue;

  const before = { high: 0, image: 0, mid: 0, ref: 0, none: 0 };
  const after = { high: 0, image: 0, mid: 0, ref: 0, none: 0 };
  let fixed = 0;

  for (const x of items) {
    const b = (x.tier === 'high' && x.source === 'image') ? 'image'
      : (x.tier === 'high' ? 'high' : (x.tier === 'mid' ? 'mid' : ((x.pickedTexts || []).length ? 'ref' : 'none')));
    before[b]++;
    const res = engine.solve(cleanTitle(x.title || ''), x.opts || [], x.imgFps || []);
    const a = bucketOf(res);
    after[a]++;
    if (a !== b && (a === 'high' || a === 'image' || a === 'mid') && (b === 'none' || b === 'ref')) fixed++;
  }

  const covered = after.high + after.image + after.mid;
  const bs = [before.high + before.image, before.mid, before.ref, before.none].join('/');
  const as = [(after.high + after.image), after.mid, after.ref, after.none].join('/');
  console.log('  ' + basename(f).padEnd(44) + String(data.script || '未上报').padEnd(8) +
    bs.padEnd(34) + as.padEnd(38) + pct(covered, items.length) + '（升级 ' + fixed + ' 题）');
}

console.log('\n说明：原始记录 = 当次诊断导出的判定；重算 = 用当前引擎 + 当前题库重新匹配；');
console.log('      两者差值说明"引擎修复 + 题库补录"带来的提升。');
