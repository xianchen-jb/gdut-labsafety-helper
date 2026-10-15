// 纯逻辑：归一化流水线 / 多级索引 / 联合评分 / 选项一一对齐 / 诊断输出。
// 无 DOM 依赖，可在 Node 里直接单元测试与留一法评测。

export const LETTERS = 'ABCDEFGH';

/* ============================== 归一化 ============================== */

// 繁简对照（只列本领域常见字，便于后续扩充）
const TRAD = {
  試: '试', 驗: '验', 氣: '气', 溫: '温', 熱: '热', 電: '电', 與: '与', 體: '体', 鋼: '钢',
  滅: '灭', 爐: '炉', 壓: '压', 機: '机', 設: '设', 備: '备', 檢: '检', 測: '测', 標: '标',
  規: '规', 範: '范', 訂: '订', 製: '制', 廠: '厂', 務: '务', 員: '员', 學: '学', 習: '习',
  實: '实', 際: '际', 產: '产', 業: '业', 專: '专', 門: '门', 關: '关', 開: '开', 閉: '闭',
  護: '护', 裝: '装', 質: '质', 報: '报', 險: '险', 環: '环', 節: '节', 約: '约', 廢: '废',
  棄: '弃', 處: '处', 劑: '剂', 藥: '药', 傷: '伤', 閥: '阀', 軟: '软', 線: '线', 絕: '绝',
  觸: '触', 風: '风', 鍋: '锅', 濾: '滤', 統: '统', 類: '类', 導: '导', 燒: '烧', 斷: '断',
  對: '对', 錯: '错', 無: '无', 個: '个', 們: '们', 於: '于', 為: '为', 後: '后', 麵: '面',
};

// 同义等价类（只放"互换不改变答案"的，谨慎扩充）
const SYNONYMS = [
  ['钢瓶', '气瓶'],
  ['触电', '电击'],
];

const CN_NUM = { 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };

const PUNCT = /[，,。.、；;：:（）()\[\]【】“”"'’‘《》<>「」\-—－_～~?？!！\/\\|+*#@$%^&=]/g;

const WIDTH_MAP = (() => {
  const m = new Map();
  for (let i = 0xff01; i <= 0xff5e; i++) m.set(String.fromCharCode(i), String.fromCharCode(i - 0xfee0));
  m.set('　', ' ');
  return m;
})();

/** 完整归一化：全角→半角、繁→简、同义词、数字单位统一、去空白标点 */
export function norm(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/[\uff01-\uff5e\u3000]/g, (c) => WIDTH_MAP.get(c) || c);
  s = s.split('').map((c) => TRAD[c] || c).join('');
  s = s.replace(/(\d+)\s*(度|摄氏度)/g, '$1℃');
  s = s.replace(/[一二两三四五六七八九十]/g, (c) => CN_NUM[c] || c);
  for (const group of SYNONYMS) {
    for (let i = 1; i < group.length; i++) s = s.split(group[i]).join(group[0]);
  }
  return s.replace(/\s+/g, '').replace(PUNCT, '').toLowerCase();
}

/** 去掉括号注记后的"核心题干"（很多改写题只差在括号部分） */
export function coreOf(raw) {
  return norm(String(raw == null ? '' : raw).replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ''));
}

export function stripLead(s) {
  return String(s == null ? '' : s).replace(/^\s*[A-DＡ-Ｄ][\.．、，,：:)\s]*/, '').trim();
}

/**
 * 图片指纹：去掉域名与缓存参数后的路径 + 关键查询参数。
 * 同一张图在不同页面/不同域名下通常路径一致，可用来直接锁定题目。
 */
export function imgFp(src) {
  const s = String(src == null ? '' : src).trim();
  if (!s) return '';
  if (s.startsWith('data:')) return 'data:' + s.slice(5, 45);
  try {
    const u = new URL(s, 'https://placeholder.local');
    const drop = new Set(['t', 'ts', 'timestamp', '_', 'v', 'ver', 'time', 'random', 'r', 'sign', 'expires']);
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !drop.has(k.toLowerCase()))
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const q = params.map(([k, v]) => k + '=' + v).join('&');
    return u.pathname.toLowerCase() + (q ? '?' + q : '');
  } catch (e) {
    return s.replace(/[?#].*$/, '').toLowerCase();
  }
}

/* ============================== 相似度 ============================== */

const setCache = new Map();

function ngramSet(s, n) {
  const key = n + ':' + s;
  let set = setCache.get(key);
  if (set) return set;
  set = new Set();
  for (let i = 0; i + n <= s.length; i++) set.add(s.slice(i, i + n));
  if (setCache.size < 120000) setCache.set(key, set);
  return set;
}

/** n-gram Jaccard 相似度（短串天然退化：完全相等为 1，否则 0） */
export function jaccard(a, b, n = 2) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = ngramSet(a, n);
  const B = ngramSet(b, n);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  small.forEach((g) => { if (big.has(g)) inter++; });
  return inter / (A.size + B.size - inter);
}

/** 最长公共子序列占比（对中文短句比 n-gram 更稳） */
export function lcsRatio(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const n = a.length, m = b.length;
  if (n * m > 40000) return jaccard(a, b, 2);
  let prev = new Array(m + 1).fill(0);
  let cur = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    const t = prev; prev = cur; cur = t;
    cur.fill(0);
  }
  return prev[m] / Math.max(n, m);
}

const simCache = new Map();

/** 两段文本的综合相似度（带缓存；2-gram 明显不像时跳过 LCS，控制耗时） */
export function textSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const key = a.length <= b.length ? a + '\u0000' + b : b + '\u0000' + a;
  const hit = simCache.get(key);
  if (hit !== undefined) return hit;

  const j = jaccard(a, b, 2);
  const v = j < 0.2 ? j : 0.5 * j + 0.5 * lcsRatio(a, b);
  if (simCache.size < 300000) simCache.set(key, v);
  return v;
}

/* ============================== 引擎 ============================== */

export const TIERS = { HIGH: 0.85, MID: 0.70 };

export function createEngine(rows, options = {}) {
  const HIGH = options.high != null ? options.high : TIERS.HIGH;
  const MID = options.mid != null ? options.mid : TIERS.MID;

  const stemExact = new Map();     // 归一化题干 -> idx[]
  const stemExactCore = new Map(); // 去括号题干 -> idx[]
  const stemPrefix = new Map();    // 前 6 字 -> idx[]
  const grams2 = new Map();        // 2-gram -> idx[]
  const imgIndex = new Map();      // 图片指纹 -> idx[]

  const stemN = new Array(rows.length);
  const stemC = new Array(rows.length);
  const optsN = new Array(rows.length);

  rows.forEach((row, i) => {
    const full = norm(row[0]);
    const core = coreOf(row[0]);
    stemN[i] = full;
    stemC[i] = core;
    optsN[i] = row[1].map((o) => norm(stripLead(o)));
    row.__i = i;

    const fps = row[3];
    if (fps) {
      (Array.isArray(fps) ? fps : [fps]).forEach((fp) => {
        if (!fp) return;
        if (!imgIndex.has(fp)) imgIndex.set(fp, []);
        imgIndex.get(fp).push(i);
      });
    }

    for (const [map, key] of [[stemExact, full], [stemExactCore, core]]) {
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    }

    const pfx = (core || full).slice(0, 6);
    if (pfx.length >= 3) {
      if (!stemPrefix.has(pfx)) stemPrefix.set(pfx, []);
      stemPrefix.get(pfx).push(i);
    }

    const seen = new Set();
    for (let p = 0; p + 2 <= full.length; p++) {
      const g = full.slice(p, p + 2);
      if (seen.has(g)) continue;
      seen.add(g);
      if (!grams2.has(g)) grams2.set(g, []);
      grams2.get(g).push(i);
    }
  });

  function optionSim(pageNorm, bankNorm) {
    if (!pageNorm.length || !bankNorm.length) return 0;
    const oneWay = (from, to) => {
      let sum = 0;
      for (const a of from) {
        let best = 0;
        for (const b of to) {
          const s = textSim(a, b);
          if (s > best) best = s;
          if (best === 1) break;
        }
        sum += best;
      }
      return sum / from.length;
    };
    return 0.6 * oneWay(pageNorm, bankNorm) + 0.4 * oneWay(bankNorm, pageNorm);
  }

  // 候选召回：精确 → 去括号精确 → 前缀桶 → 2-gram 倒排 top-N
  function candidates(titleFull, titleCore, exclude) {
    const out = new Set();
    const push = (arr) => { if (arr) arr.forEach((i) => { if (i !== exclude) out.add(i); }); };
    push(stemExact.get(titleFull));
    push(stemExactCore.get(titleCore));
    push(stemPrefix.get((titleCore || titleFull).slice(0, 6)));

    if (out.size < 24) {
      const cnt = new Map();
      const seen = new Set();
      for (let p = 0; p + 2 <= titleFull.length; p++) {
        const g = titleFull.slice(p, p + 2);
        if (seen.has(g)) continue;
        seen.add(g);
        const list = grams2.get(g);
        if (list) list.forEach((i) => { if (i !== exclude) cnt.set(i, (cnt.get(i) || 0) + 1); });
      }
      [...cnt.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, options.candidateCap || 40)
        .forEach(([i]) => out.add(i));
    }
    return [...out];
  }

  function scoreCandidate(i, titleFull, titleCore, pageNorm) {
    const stemSim = Math.max(
      textSim(titleFull, stemN[i]),
      titleCore ? textSim(titleCore, stemC[i]) : 0,
    );
    const optSim = optionSim(pageNorm, optsN[i]);
    return { idx: i, stemSim, optSim, score: 0.6 * stemSim + 0.4 * optSim };
  }

  /**
   * 选项一一对齐：正确项与卷面项做贪心二分匹配，避免两个正确项撞到同一项；
   * 允许题库选项在卷面缺失（返回已匹配部分并标记 partial）。
   *
   * 两轮匹配：第一轮严格（相似度 ≥0.6）；对没匹配上的正确项，
   * 第二轮放宽到"独特片段互相包含"或"长文本降阈值"，专治卷面把选项改写/扩写的情况。
   */
  function mapPicks(entry, pageOpts) {
    const ck = entry[2] || '';
    const pn = pageOpts.map((o) => norm(stripLead(o)));
    const bn = optsN[entry.__i] || entry[1].map((o) => norm(stripLead(o)));
    const correctBank = [...ck].map((c, i) => (c === '1' ? i : -1)).filter((i) => i >= 0);

    const pairs = [];
    for (const bi of correctBank) {
      for (let pi = 0; pi < pn.length; pi++) pairs.push([textSim(bn[bi], pn[pi]), bi, pi]);
    }
    pairs.sort((a, b) => b[0] - a[0]);

    const usedBank = new Set();
    const usedPage = new Set();
    const picks = [];
    for (const [s, bi, pi] of pairs) {
      if (usedBank.has(bi)) continue;
      if (s < 0.6) continue;
      if (usedPage.has(pi)) continue;
      usedBank.add(bi);
      usedPage.add(pi);
      picks.push(pi);
    }

    const missing = [];
    for (const bi of correctBank) {
      if (usedBank.has(bi)) continue;
      const want = bn[bi];
      let found = -1;
      for (let pi = 0; pi < pn.length; pi++) {
        if (usedPage.has(pi)) continue;
        const p = pn[pi];
        if (!p || !want) continue;
        if (want.length >= 3 && (p.includes(want) || want.includes(p))) { found = pi; break; }
        const th = want.length >= 20 ? 0.45 : (want.length >= 8 ? 0.5 : 0.6);
        if (textSim(want, p) >= th) { found = pi; break; }
      }
      if (found >= 0) { usedBank.add(bi); usedPage.add(found); picks.push(found); }
      else missing.push(entry[1][bi]);
    }

    return {
      picks: picks.sort((a, b) => a - b),
      partial: missing.length > 0,
      expect: correctBank.length,
      missing,
    };
  }

  /** 排序候选（用于诊断、相似题参考与留一法评测） */
  function rank(title, pageOpts, opts2 = {}) {
    const titleFull = norm(title);
    const titleCore = coreOf(title);
    const pageNorm = pageOpts.map((o) => norm(stripLead(o)));
    const top = opts2.top || 3;

    return candidates(titleFull, titleCore, opts2.exclude)
      .map((i) => scoreCandidate(i, titleFull, titleCore, pageNorm))
      .sort((a, b) => (b.score - a.score) || (b.stemSim - a.stemSim))
      .slice(0, top)
      .map((c) => {
        const m = mapPicks(rows[c.idx], pageOpts);
        return {
          idx: c.idx, stemSim: c.stemSim, optSim: c.optSim, score: c.score,
          picks: m.picks, partial: m.partial, missing: m.missing, entry: rows[c.idx],
        };
      });
  }

  // 题干一致就认这道题：不让"选项被改写"把同题误杀
  const STEM_GATE_HIGH = options.stemHigh != null ? options.stemHigh : 0.97;
  const STEM_GATE_MID = options.stemMid != null ? options.stemMid : 0.85;

  /** 解题主入口：tier = high（题库确信）/ mid（建议核对）/ none（未命中，给参考） */
  function solve(title, pageOpts, pageImgFps) {
    const ranked = rank(title, pageOpts, { top: 3 });
    const best = ranked.find((c) => c.picks.length > 0);

    // 图片指纹优先：同一张图 = 同一道题，直接给答案
    const refs = (pageImgFps || []).filter(Boolean);
    let imgHit = null;
    for (const fp of refs) {
      const list = imgIndex.get(fp);
      if (!list || !list.length) continue;
      const m = mapPicks(rows[list[0]], pageOpts);
      if (m.picks.length) { imgHit = { idx: list[0], picks: m.picks, partial: m.partial, missing: m.missing, fp }; break; }
    }
    if (imgHit) {
      return {
        ok: true,
        tier: 'high',
        source: 'image',
        picks: imgHit.picks,
        conf: 1,
        stemSim: 1,
        optSim: 1,
        entry: rows[imgHit.idx],
        nearest: null,
        partial: imgHit.partial,
        missing: imgHit.missing,
        imgFp: imgHit.fp,
      };
    }

    const imgFps = refs;

    if (!best) {
      const top = ranked[0];
      return {
        ok: false,
        tier: 'none',
        reason: top ? '选项与题库版本不一致' : '题库未命中',
        nearest: top ? { score: +top.score.toFixed(2), stem: top.entry[0].slice(0, 24) } : null,
        entry: top ? top.entry : null,
        imgFps,
      };
    }

    const near = ranked.find((c) => c !== best);
    const nearest = near ? { score: +near.score.toFixed(2), stem: near.entry[0].slice(0, 24) } : null;
    const base = {
      picks: best.picks,
      conf: +best.score.toFixed(2),
      stemSim: +best.stemSim.toFixed(2),
      optSim: +best.optSim.toFixed(2),
      entry: best.entry,
      nearest,
      partial: best.partial,
      missing: best.missing,
    };

    if (best.score >= HIGH || best.stemSim >= STEM_GATE_HIGH) {
      return { ok: true, tier: 'high', source: 'text', ...base, imgFps };
    }
    if (best.score >= MID || best.stemSim >= STEM_GATE_MID) {
      return { ok: true, tier: 'mid', source: 'text', ...base, imgFps };
    }

    // 未命中，但把最接近题目的答案作为"参考"一起返回（明确标注，不冒充题库答案）
    return {
      ok: false,
      tier: 'none',
      reason: '相似度不足',
      reference: { ...base, score: base.conf },
      nearest: { score: base.conf, stem: best.entry[0].slice(0, 24) },
      imgFps,
    };
  }

  return { solve, rank, size: rows.length, imgIndex, thresholds: { HIGH, MID, STEM_GATE_HIGH, STEM_GATE_MID } };
}
