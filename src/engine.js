// 纯逻辑：题干归一化、题库索引、按选项文本对齐答案。
// 无 DOM 依赖，可在 Node 里直接单元测试。

export const LETTERS = 'ABCDEFGH';

export function norm(s) {
  return String(s == null ? '' : s)
    .replace(/\s+/g, '')
    .replace(/[，,。.、；;：:（）()\[\]“”"'’‘《》<>【】\-—－_～~?？!！]/g, '')
    .toLowerCase();
}

export function stripLead(s) {
  return String(s == null ? '' : s).replace(/^\s*[A-DＡ-Ｄ][\.．、，,：:)\s]*/, '').trim();
}

// 字符 6-gram 集合（带缓存），用于文本相似度：
// 题库（背题页）与卷面（考试页）的同一选项措辞可能有细微差异。
const gramCache = new Map();

function gramsOf(s) {
  let set = gramCache.get(s);
  if (set) return set;
  set = new Set();
  for (let i = 0; i + 6 <= s.length; i++) set.add(s.slice(i, i + 6));
  if (gramCache.size < 40000) gramCache.set(s, set);
  return set;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = gramsOf(a);
  const B = gramsOf(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((g) => { if (B.has(g)) inter++; });
  return inter / Math.max(A.size, B.size);
}

/**
 * 在卷面选项里找到与题库选项对应的下标。
 * 顺序：完全相同 -> 前缀包含 -> 6-gram 相似度 >= 0.6
 */
function findOption(want, pageNorm) {
  if (!want) return -1;
  let j = pageNorm.indexOf(want);
  if (j >= 0) return j;
  if (want.length >= 4) {
    j = pageNorm.findIndex((x) => x && x.length >= 4 && (x.startsWith(want) || want.startsWith(x)));
    if (j >= 0) return j;
  }
  let best = -1, bestScore = 0;
  pageNorm.forEach((x, i) => {
    const s = similarity(want, x);
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return bestScore >= 0.6 ? best : -1;
}

export function createEngine(rows) {
  const byStem = new Map();
  const grams = new Map();
  const entryNorm = new Array(rows.length);

  rows.forEach((row, i) => {
    const key = norm(row[0]);
    entryNorm[i] = row[1].map((o) => norm(stripLead(o)));
    if (!byStem.has(key)) byStem.set(key, []);
    byStem.get(key).push(i);
    for (let p = 0; p + 8 <= key.length; p += 2) {
      const g = key.slice(p, p + 8);
      let list = grams.get(g);
      if (!list) { list = []; grams.set(g, list); }
      list.push(i);
    }
  });

  /**
   * 题库条目与卷面的贴合度：
   * fit        每个卷面选项与题库最像选项的相似度均值（1=完全一致）
   * hit        题库里有几个选项能在卷面找到
   * allCovered 题库这条的选项是否都能在卷面找到（同分时用它决胜）
   */
  function scoreEntry(idx, pageNorm) {
    if (!pageNorm.length) return { fit: 0, ov: 0, hit: 0, allCovered: false };
    const opts = entryNorm[idx];

    let sum = 0;
    pageNorm.forEach((p) => {
      let best = 0;
      for (const b of opts) {
        const s = similarity(p, b);
        if (s > best) best = s;
        if (best === 1) break;
      }
      sum += best;
    });
    const fit = sum / pageNorm.length;

    let hit = 0;
    for (const b of opts) {
      let best = 0;
      for (const p of pageNorm) {
        const s = similarity(b, p);
        if (s > best) best = s;
        if (best === 1) break;
      }
      if (best >= 0.75) hit++;
    }
    return { fit, ov: fit, hit, allCovered: hit === opts.length };
  }

  function better(a, b) {
    if (!b) return true;
    if (a.fit !== b.fit) return a.fit > b.fit;
    if (a.allCovered !== b.allCovered) return a.allCovered;
    return a.hit > b.hit;
  }

  function mapPicks(entry, pageOpts) {
    const ck = entry[2] || '';
    const pn = pageOpts.map((o) => norm(stripLead(o)));
    const picks = [];
    entry[1].forEach((opt, i) => {
      if (ck[i] !== '1') return;
      const j = findOption(norm(stripLead(opt)), pn);
      if (j >= 0) picks.push(j);
    });
    return [...new Set(picks)].sort((a, b) => a - b);
  }

  function findGramCandidate(key, pageNorm) {
    const cnt = new Map();
    for (let p = 0; p + 8 <= key.length; p += 2) {
      const list = grams.get(key.slice(p, p + 8));
      if (list) list.forEach((i) => cnt.set(i, (cnt.get(i) || 0) + 1));
    }
    let best = null, bestScore = null;
    cnt.forEach((c, i) => {
      const bank = norm(rows[i][0]);
      const denom = Math.max(1, Math.min((key.length - 7 + 1) / 2, (bank.length - 7 + 1) / 2));
      if (c / denom < 0.75) return;
      const sc = scoreEntry(i, pageNorm);
      if (better(sc, bestScore)) { bestScore = sc; best = i; }
    });
    return { idx: best, score: bestScore };
  }

  /**
   * 解题：
   * 1) 按题干原样找到所有同名题，挑「选项最贴合」的那一套（解决同题多版本）；
   * 2) 找不到就退化为 8-gram 相似度匹配；
   * 3) 答案按选项文本映射到卷面下标（不依赖字母，兼容选项顺序被打乱）。
   */
  function solve(title, pageOpts) {
    const key = norm(title);
    const pageNorm = pageOpts.map((o) => norm(stripLead(o)));
    let best = null, bestScore = null;

    (byStem.get(key) || []).forEach((idx) => {
      const sc = scoreEntry(idx, pageNorm);
      if (better(sc, bestScore)) { bestScore = sc; best = idx; }
    });

    if (!best || !bestScore || bestScore.ov < 0.6) {
      const g = findGramCandidate(key, pageNorm);
      if (g.idx != null && g.score && g.score.ov >= 0.6 && better(g.score, bestScore)) {
        best = g.idx; bestScore = g.score;
      }
    }

    if (best == null) return { ok: false, reason: '题库未命中' };

    const picks = mapPicks(rows[best], pageOpts);
    if (!picks.length) return { ok: false, reason: '选项与题库版本不一致', entry: rows[best] };

    return { ok: true, picks, conf: +bestScore.ov.toFixed(2), entry: rows[best], idx: best };
  }

  return { solve, similarity, size: rows.length };
}
