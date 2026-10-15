// 回归测试：用实战卷面（题干 + 选项 + 应选项）验证匹配引擎。
// 用法: node build.mjs && node test/engine.test.mjs

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
const { createEngine, LETTERS } = await import(engineUrl);

const rows = JSON.parse(readFileSync(resolve(here, '../data/bank.json'), 'utf8'));
const engine = createEngine(rows);

const cases = [
  {
    name: '单选·触电不正确行为',
    title: '实验室人员发生触电时，下例哪种行为是不正确的？',
    opts: ['A. 应迅速切断电源，将触电者上衣解开，取出口中异物，然后进行人工呼吸', 'B. 应迅速注射强心针',
      'C. 当患者伤势严重时，应立即送医院强救', 'D. 无'],
    expect: [1],
  },
  {
    name: '单选·挂禁止合闸标示牌',
    title: '在哪些情况下，开关、刀闸的操作手柄上须挂“禁止合闸，有人工作的标示牌?（）',
    opts: ['A. 一经合闸即可送电到工作地点的开关、刀闸', 'B. 已停用的设备，一经合闸即有造成人身触电危险、设备损坏或引起总漏电保护器动作的开关、刀闸',
      'C. 一经合闸会使两个电源系统并列或引起反送电的开关、刀闸', 'D. 以上都是'],
    expect: [3],
  },
  {
    name: '单选·选项顺序被打乱（操作中途离开设备）',
    title: '操作中途离开设备（）',
    opts: ['A. 必须关掉设备电源，经老师同意方可离开', 'B. 可以随意离开', 'C. 不能离开',
      'D. 必须关掉设备电源，但不需老师同意即可离开'],
    expect: [0],
  },
  {
    name: '判断·细胞培养房气瓶（可用小推车固定）',
    title: '因实验室特殊要求，细胞培养房内用的气体钢瓶可用小推车等形式进行固定。',
    opts: ['对', '错'],
    expect: [0],
  },
  {
    name: '判断·细胞培养房气瓶（可不用固定，反措辞）',
    title: '因实验室特殊要求，细胞培养房内用的气体钢瓶可不用固定，只要平时小心就可以。',
    opts: ['对', '错'],
    expect: [1],
  },
  {
    name: '判断·可燃气体泄漏先断电（反直觉口径）',
    title: '实验室发现可燃气体泄漏，要迅速切断电源，打开门窗。',
    opts: ['对', '错'],
    expect: [1],
  },
  {
    name: '多选·爆炸物品特点（以上都是版）',
    title: '爆炸物品在发生爆炸时的特点有（）。',
    opts: ['A. 反应速度极快，通常在万分之一秒以内即可完成', 'B. 释放出大量的热', 'C. 产生大量的气体', 'D. 以上都是'],
    expect: [3],
  },
  {
    name: '多选·爆炸物品特点（发出声响版）',
    title: '爆炸物品在发生爆炸时的特点有（）。',
    opts: ['A. 反应速度极快，通常在万分之一秒以内即可完成。', 'B. 释放出大量的热。', 'C. 通常产生大量的气体。', 'D. 发出声响。'],
    expect: [0, 1, 2, 3],
  },
  {
    name: '多选·预防电气火灾（反向表述版）',
    title: '判断下列选项中哪些是预防电气火灾最重要的基本措施？（）',
    opts: ['A. 工作现场堆放易燃易爆材料', 'B. 非电工改接电气线路，乱拉临时用电线路',
      'C. 工作现场禁止吸烟，禁止带火柴、打火机等进入实验室', 'D. 建设时要全面地规划电气需求，正确地设计方案，容量留有余地'],
    expect: [3],
  },
  {
    name: '多选·预防电气火灾（正向表述版）',
    title: '判断下列选项中哪些是预防电气火灾最重要的基本措施？（）',
    opts: ['A. 实验室建设时要全面地规划电气需求，正确地设计方案，容量留有余地', 'B. 禁止非电工改接电气线路，禁止乱拉临时用电线路',
      'C. 规范使用操作，制定并严格执行用电和电气设备安全使用操作规程', 'D. 做电器实验时应该2人及以上在场'],
    expect: [0, 1, 2],
  },
  {
    name: '单选·实验室生物安全防护内容（以上都是版）',
    title: '实验室生物安全防护的内容包括（）。',
    opts: ['A. 安全设备、个体防护装置和措施', 'B. 严格的管理制度和标准化的操作程序和规程',
      'C. 实验室的特殊设计和建设要求', 'D. 以上都是'],
    expect: [3],
  },
  {
    name: '边界·题库未命中应当诚实报错',
    title: '这是一道题库里不存在的自造测试题目，用于验证未命中分支？',
    opts: ['A. 选项一', 'B. 选项二', 'C. 选项三'],
    expect: false,
  },
  {
    name: '短题干·车床开动以后',
    title: '车床开动以后（）。',
    opts: ['A. 不能同时使用纵、横向自动手柄', 'B. 不能改变进给量', 'C. 可以同时使用纵、横向自动手柄', 'D. 无'],
    expect: [0],
  },
  {
    name: '全角数字·干粉灭火器有效期',
    title: '干粉灭火器的药剂，一般有效期限为（）。',
    opts: ['A. ２年', 'B. ３年', 'C. ４年', 'D. ５年'],
    expect: [1],
  },
  {
    name: '繁体选项·可燃气体泄漏',
    title: '实验室发现可燃气体泄漏，要迅速切断电源，打开门窗。',
    opts: ['對', '錯'],
    expect: [1],
  },
  {
    name: '改写措辞·触电不正确行为',
    title: '实验室人员发生触电时，下列哪种行为是不正确的？',
    opts: ['A. 应迅速切断电源，将触电者上衣解开，取出口中异物，然后进行人工呼吸', 'B. 应迅速注射强心针',
      'C. 当患者伤势严重时，应立即送医院强救', 'D. 无'],
    expect: [1],
  },
  {
    name: '题库缺项·卷面只有三个选项',
    title: '在哪些情况下，开关、刀闸的操作手柄上须挂“禁止合闸，有人工作的标示牌?（）',
    opts: ['A. 一经合闸即可送电到工作地点的开关、刀闸。', 'B. 已停用的设备，一经合闸即有造成人身触电危险、设备损坏或引起总漏电保护器动作的开关、刀闸。',
      'C. 一经合闸会使两个电源系统并列或引起反送电的开关、刀闸。'],
    expect: [0, 1, 2],
  },
];

let pass = 0;
const fails = [];
const tierOf = [];

for (const c of cases) {
  const res = engine.solve(c.title, c.opts);
  tierOf.push(`${c.name.split('·')[0]}=${res.tier}${res.ok ? '(' + res.conf + ')' : ''}`);
  if (c.expect === false) {
    if (res.ok) fails.push(`${c.name}: 期望未命中，实际命中 ${JSON.stringify(res.picks)}`);
    else pass++;
    continue;
  }
  const got = res.ok ? res.picks : null;
  if (JSON.stringify(got) === JSON.stringify(c.expect)) pass++;
  else {
    fails.push(`${c.name}: 期望 ${JSON.stringify(c.expect)}，实际 ${JSON.stringify(got)}${res.ok ? '' : ' (' + res.reason + ')'}`);
    const e = rows[res.idx];
    if (e) fails.push('        选中条目 ck=' + e[2] + ' 题干=' + e[0].slice(0, 26) + ' 选项=' + JSON.stringify(e[1]).slice(0, 130));
  }
}

// 全库自检：每条题库记录用自己的题干+选项求解，结果必须等于自身答案
let selfFail = 0;
const selfSamples = [];
rows.forEach((row, i) => {
  const res = engine.solve(row[0], row[1]);
  const want = [...row[2]].map((c, k) => (c === '1' ? k : -1)).filter((k) => k >= 0);
  const got = res.ok ? res.picks : null;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    selfFail++;
    if (selfSamples.length < 3) selfSamples.push(`#${i} ${row[0].slice(0, 22)} 期望${JSON.stringify(want)} 实际${JSON.stringify(got)}`);
  }
});

console.log(`用例：${pass}/${cases.length} 通过`);
fails.forEach((f) => console.log('  FAIL ' + f));
console.log('分档：' + tierOf.join('  '));
console.log(`全库自检：${rows.length - selfFail}/${rows.length} 一致`);
selfSamples.forEach((s) => console.log('  SELF ' + s));

if (fails.length || selfFail) process.exitCode = 1;
