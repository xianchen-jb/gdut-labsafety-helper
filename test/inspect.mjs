// 排查工具: node test/inspect.mjs "题干关键词"
// 打印该关键词命中的题库条目、以及引擎为某组选项选中的条目。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, norm } from '../src/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(resolve(here, '../data/bank.json'), 'utf8'));
const engine = createEngine(rows);

const kw = process.argv[2] || '';
if (!kw) {
  console.log('用法: node test/inspect.mjs "<题干关键词>"');
  process.exit(0);
}

const hit = rows
  .map((r, i) => [i, r])
  .filter(([, r]) => r[0].includes(kw));

console.log('命中 ' + hit.length + ' 条:');
for (const [i, r] of hit) {
  console.log('#' + i + ' ck=' + r[2]);
  console.log('    题干: ' + r[0]);
  r[1].forEach((o, k) => console.log('    [' + k + '] ' + (r[2][k] === '1' ? '*' : ' ') + ' ' + JSON.stringify(o)));
}

if (hit.length >= 2 && process.argv[3] === 'solve') {
  const [i, r] = hit[0];
  const res = engine.solve(r[0], r[1]);
  console.log('\n用第一条的选项求解 -> ' + JSON.stringify(res.ok ? res.picks : res.reason) + ' (选中 #' + res.idx + ')');
}
