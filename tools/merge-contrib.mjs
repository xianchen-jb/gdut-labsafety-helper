// 题库补录：把"考试里出现、题库没有"的题并入题库（含图片指纹）。
// 输入 JSONL，每行一个对象：
//   {"t":"题干","opts":["A.…","B.…"],"a":"B","img":"/chem/api/file/xxx.png","note":"来源说明"}
//   a 支持字母（多选写 "A,C"）或判断题原文（"对"/"错"）
// 用法: node tools/merge-contrib.mjs <contrib.jsonl> [--dry]

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const BANK = resolve(root, '../labsafety-bank/question_bank.jsonl');
const VERIFIED = resolve(root, '../labsafety-bank/exam_verified.jsonl');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.log('用法: node tools/merge-contrib.mjs <contrib.jsonl> [--dry]');
  process.exit(0);
}

const norm = (s) => String(s == null ? '' : s)
  .replace(/\s+/g, '')
  .replace(/[，,。.、；;：:（）()\[\]【】“”"'’‘《》<>「」\-—－_～~?？!！\/\\|+*#@$%^&=]/g, '')
  .toLowerCase();

const toCk = (a, opts) => {
  const s = String(a == null ? '' : a).trim();
  const m = s.match(/^[A-Ha-h](?:\s*[,，]\s*[A-Ha-h])*$/);
  if (m) {
    const ck = new Array(opts.length).fill('0');
    s.split(/[,，]/).forEach((ch) => {
      const i = 'ABCDEFGH'.indexOf(ch.trim().toUpperCase());
      if (i >= 0 && i < ck.length) ck[i] = '1';
    });
    return ck.join('');
  }
  const i = opts.findIndex((o) => norm(o) === norm(s));
  if (i >= 0) {
    const ck = new Array(opts.length).fill('0');
    ck[i] = '1';
    return ck.join('');
  }
  return null;
};

const existing = new Set();      // 库里已有的 (题干+选项)
const existingImgMap = new Set(); // 已经补录过的 (题干+选项+指纹)
for (const f of [BANK, VERIFIED]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      const opts = e.ops || e.opts || [];
      if (!e.t || !opts.length) continue;
      const key = norm(e.t) + '|' + opts.map(norm).join('|');
      existing.add(key);
      const fps = Array.isArray(e.imgFp) ? e.imgFp : (e.imgFp ? [e.imgFp] : []);
      fps.forEach((fp) => existingImgMap.add(key + '|' + fp));
    } catch (err) { /* 跳过坏行 */ }
  }
}

let added = 0, dup = 0, bad = 0;
const out = [];

for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let e;
  try { e = JSON.parse(line); } catch (err) { bad++; console.log('  JSON 解析失败: ' + line.slice(0, 60)); continue; }
  if (!e.t || !Array.isArray(e.opts) || e.opts.length < 2) { bad++; console.log('  字段不全: ' + line.slice(0, 60)); continue; }
  const ck = toCk(e.a, e.opts);
  if (!ck) { bad++; console.log('  答案无法识别: ' + e.t.slice(0, 30) + ' a=' + e.a); continue; }
  const key = norm(e.t) + '|' + e.opts.map(norm).join('|');

  const fps = e.img ? (Array.isArray(e.img) ? e.img : [e.img]).filter(Boolean) : [];
  if (existing.has(key)) {
    // 题干+选项已在库里：只有当带图片指纹、且该指纹还没补录过时，才写成 img-map 补录
    const fresh = fps.filter((fp) => !existingImgMap.has(key + '|' + fp));
    if (!fresh.length) { dup++; console.log('  已存在（且无新指纹），跳过: ' + e.t.slice(0, 30)); continue; }
    fps.forEach((fp) => existingImgMap.add(key + '|' + fp));
    const row = { tag: 'img-map', t: e.t, opts: e.opts, a: String(e.a), imgFp: fresh, src: e.src || '贡献' };
    if (e.note) row.note = e.note;
    out.push(JSON.stringify(row));
    added++;
    console.log('  补录图片指纹 ' + fresh.join(',') + ' -> ' + e.t.slice(0, 24));
    continue;
  }

  existing.add(key);
  const row = { tag: 'exam-only', t: e.t, opts: e.opts, a: String(e.a), src: e.src || '贡献' };
  if (e.img) row.imgFp = Array.isArray(e.img) ? e.img : [e.img];
  if (e.note) row.note = e.note;
  out.push(JSON.stringify(row));
  added++;
}

console.log(`新增 ${added} 条，重复 ${dup} 条，异常 ${bad} 条`);
if (!added) process.exit(0);

if (dry) {
  console.log('（--dry 模式，未写入）');
  out.forEach((l) => console.log('  ' + l.slice(0, 120)));
  process.exit(0);
}

appendFileSync(VERIFIED, out.join('\n') + '\n', 'utf8');
console.log('已写入 ' + VERIFIED);
console.log('接着跑: node build.mjs   然后 node test/engine.test.mjs');
