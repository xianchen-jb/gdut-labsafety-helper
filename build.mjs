// 构建：把题库与引擎注入 userscript 核心，产出可直接安装的单文件脚本。
// 用法: node build.mjs
//
// 数据来源二选一：
//   1. 本地有抓取源（../labsafety-bank/question_bank.jsonl）时，重新生成 data/bank.json；
//   2. 没有源数据时，直接用仓库里的 data/bank.json（保证在仓库内可独立构建）。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SRC_BANK = resolve(root, 'labsafety-bank/question_bank.jsonl');
const SRC_VERIFIED = resolve(root, 'labsafety-bank/exam_verified.jsonl');
const CORE = resolve(here, 'src/helper.core.js');
const ENGINE = resolve(here, 'src/engine.js');
const DATA = resolve(here, 'data/bank.json');
const OUT = resolve(here, 'gdut-labsafety-helper.user.js');

const norm = (s) => String(s == null ? '' : s)
  .replace(/\s+/g, '')
  .replace(/[，,。.、；;：:（）()\[\]“”"'’‘《》<>【】\-—－_～~?？!！]/g, '')
  .toLowerCase();

function readJsonl(path) {
  if (!existsSync(path)) throw new Error('缺少文件: ' + path);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// 答案字母 / 对错 -> ck 位串
function toCk(answer, opts) {
  const a = String(answer == null ? '' : answer).trim();
  const m = a.match(/^[A-Ha-h](?:\s*[,，]\s*[A-Ha-h])*$/);
  if (m) {
    const ck = new Array(opts.length).fill('0');
    a.split(/[,，]/).forEach((ch) => {
      const i = 'ABCDEFGH'.indexOf(ch.trim().toUpperCase());
      if (i >= 0 && i < ck.length) ck[i] = '1';
    });
    return ck.join('');
  }
  const i = opts.findIndex((o) => norm(o) === norm(a));
  if (i >= 0) {
    const ck = new Array(opts.length).fill('0');
    ck[i] = '1';
    return ck.join('');
  }
  return null;
}

function buildRows() {
  const rows = [];
  const seen = new Set();

  // 图片来源：imgFp 优先；img 是字符串时也按指纹处理（布尔 img 表示"这题有图"但没存地址）
  const imgOf = (e) => {
    const v = e.imgFp != null ? e.imgFp : (typeof e.img === 'string' ? e.img : '');
    if (Array.isArray(v)) return v.filter(Boolean);
    return v ? [v] : [];
  };

  for (const e of readJsonl(SRC_BANK)) {
    if (!e || !e.t || !Array.isArray(e.ops) || e.ops.length < 2) continue;
    const ck = (e.ck && e.ck.length === e.ops.length) ? e.ck : toCk(e.a, e.ops);
    if (!ck || !ck.includes('1')) continue;
    const key = norm(e.t) + '|' + e.ops.map(norm).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const imgs = imgOf(e);
    rows.push(imgs.length ? [e.t, e.ops, ck, imgs] : [e.t, e.ops, ck]);
  }
  const bankCount = rows.length;

  // 实战补充：题库没有、但考试出现过的题
  if (existsSync(SRC_VERIFIED)) {
    for (const e of readJsonl(SRC_VERIFIED)) {
      if (!e.t || !Array.isArray(e.opts)) continue;

      // img-map：题库里已有这道题，只是补录图片指纹 —— 把指纹并到已有条目上
      if (e.tag === 'img-map') {
        const key = norm(e.t) + '|' + e.opts.map(norm).join('|');
        const idx = rows.findIndex((r) => norm(r[0]) + '|' + r[1].map(norm).join('|') === key);
        const imgs = imgOf(e);
        if (idx >= 0 && imgs.length) {
          const cur = Array.isArray(rows[idx][3]) ? rows[idx][3] : (rows[idx][3] ? [rows[idx][3]] : []);
          const merged = [...new Set([...cur, ...imgs])];
          rows[idx] = [rows[idx][0], rows[idx][1], rows[idx][2], merged];
        } else if (idx < 0) {
          const ck = e.ck && e.ck.length === e.opts.length ? e.ck : toCk(e.a, e.opts);
          if (ck && imgs.length) {
            seen.add(key);
            rows.push([e.t, e.opts, ck, imgs]);
          }
        }
        continue;
      }

      if (e.tag !== 'exam-only') continue;
      const ck = toCk(e.a, e.opts);
      if (!ck) continue;
      const key = norm(e.t) + '|' + e.opts.map(norm).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const imgs = imgOf(e);
      rows.push(imgs.length ? [e.t, e.opts, ck, imgs] : [e.t, e.opts, ck]);
    }
  }
  return { rows, bankCount };
}

let rows;
let bankCount;
let source;

if (existsSync(SRC_BANK)) {
  ({ rows, bankCount } = buildRows());
  source = '本地抓取源';
  mkdirSync(dirname(DATA), { recursive: true });
  writeFileSync(DATA, JSON.stringify(rows), 'utf8');
} else {
  rows = JSON.parse(readFileSync(DATA, 'utf8'));
  bankCount = rows.length;
  source = 'data/bank.json';
}

const coreSrc = readFileSync(CORE, 'utf8');
const scriptVersion = (coreSrc.match(/@version\s+(\S+)/) || [])[1] || '0.0.0';

const meta = {
  version: '2026-10-15',
  built: new Date().toISOString().slice(0, 10),
  scriptVersion,
  count: rows.length,
  bankCount,
  extraCount: rows.length - bankCount,
};

const bankJson = JSON.stringify(rows);
const metaJson = JSON.stringify(meta);

// 引擎源码内联进 userscript（去掉 ESM 的 export 关键字）
let engineSrc = readFileSync(ENGINE, 'utf8')
  .replace(/^export\s+/gm, '')
  .replace(/^\/\/[^\n]*\n/gm, '')
  .trim();

let core = coreSrc;
core = core.replace('/*__BANK__*/[]', bankJson);
core = core.replace('/*__META__*/{ version: \'dev\', built: \'\', count: 0 }', metaJson);
core = core.replace('/*__ENGINE__*/', engineSrc);

if (core.includes('/*__BANK__*/')) throw new Error('题库占位符未被替换');
if (core.includes('__META__')) throw new Error('META 占位符未被替换');
if (core.includes('/*__ENGINE__*/')) throw new Error('引擎占位符未被替换');

writeFileSync(OUT, core, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log('数据来源: ' + source);
console.log('题库条目: ' + meta.count + '（原始 ' + bankCount + ' + 实战补充 ' + meta.extraCount + '）');
console.log('输出: ' + OUT);
console.log('大小: ' + kb(Buffer.byteLength(core, 'utf8')) + '（题库部分 ' + kb(Buffer.byteLength(bankJson, 'utf8')) + '）');
