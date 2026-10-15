// 诊断归类：读「导出诊断」生成的 JSON，把没答上的题分类统计，指出该往哪优化。
// 用法: node tools/analyze-diag.mjs <diag.json>

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.log('用法: node tools/analyze-diag.mjs <导出的诊断.json>');
  process.exit(0);
}

const data = JSON.parse(readFileSync(file, 'utf8'));
const items = data.items || [];

const hasRef = (x) => (x.pickedTexts || []).length > 0;
const bucket = (x) => {
  if (x.tier === 'high' && x.source === 'image') return 'clippedByImage';
  if (x.tier === 'high') return 'high';
  if (x.tier === 'mid') return 'mid';
  if (x.tier === 'none' && x.img) return 'none-image';
  if (x.tier === 'none' && hasRef(x)) return 'ref-only';
  return 'no-answer';
};

const counts = {};
for (const x of items) counts[bucket(x)] = (counts[bucket(x)] || 0) + 1;

const pct = (n) => (items.length ? ((n / items.length) * 100).toFixed(1) + '%' : '—');
console.log('诊断归类报告');
console.log('  文件: ' + file);
console.log('  版本: ' + (data.version || '?') + '　题库: ' + (data.bank || '?') + ' 题　时间: ' + (data.at || '?'));
console.log('  共 ' + items.length + ' 题：确信 ' + (counts.high || 0) +
  '（其中图片指纹命中 ' + (counts.clippedByImage || 0) + '）· 待核对 ' + (counts.mid || 0) +
  ' · 仅参考 ' + (counts['ref-only'] || 0) + ' · 无答案 ' + (counts['no-answer'] || 0) +
  ' · 图片题无答案 ' + (counts['none-image'] || 0));
console.log('  覆盖率（有答案）: ' + pct((counts.high || 0) + (counts.mid || 0) + (counts.clippedByImage || 0)));
console.log('  需人工核对: ' + pct(items.length - (counts.high || 0) - (counts.clippedByImage || 0)));

const need = items.filter((x) => bucket(x) !== 'high' && bucket(x) !== 'clippedByImage');
if (!need.length) {
  console.log('\n全部命中题库，没有需要处理的题。');
  process.exit(0);
}

console.log('\n需要处理的题（按分数升序，分数低的更麻烦）:');
const sorted = need.slice().sort((a, b) => (a.conf || 0) - (b.conf || 0));
for (const x of sorted) {
  const flags = [
    '第' + x.n + '题',
    bucket(x),
    '相似' + (x.conf != null ? x.conf : '—'),
    x.stemSim != null ? '题干' + x.stemSim : '',
    x.img ? '有图' : '',
  ].filter(Boolean).join(' | ');
  console.log('  ' + flags);
  console.log('      题干: ' + (x.title || '').slice(0, 46));
  if (x.imgFps && x.imgFps.length) {
    console.log('      图片指纹: ' + x.imgFps.join(' , '));
  }
  if (x.bankStem) {
    console.log('      库内最近: ' + String(x.bankStem).slice(0, 40) +
      '　库答案: ' + (x.bankCk || '').replace(/0/g, '').length + ' 项');
  }
}

// 汇总：图片指纹清单（用于把图片题fingerprint补进题库）
const imgFps = [];
for (const x of items) {
  if (!x.img) continue;
  (x.imgFps || []).forEach((fp) => { if (fp && !imgFps.includes(fp)) imgFps.push(fp); });
}
if (imgFps.length) {
  console.log('\n本次出现的图片指纹（' + imgFps.length + ' 个），可用于题库补录:');
  imgFps.forEach((fp) => console.log('  ' + fp));
}

// 汇总：题库完全没有的题干（建议补录）
const noAnswer = items.filter((x) => bucket(x) === 'no-answer');
if (noAnswer.length) {
  console.log('\n题库完全没有的题（' + noAnswer.length + ' 道）:');
  noAnswer.forEach((x) => console.log('  ' + x.n + '. ' + (x.title || '').slice(0, 44) +
    ' | 选项: ' + (x.opts || []).join(' / ').slice(0, 60)));
}
