/* mod-search.js (담당 A) — 사이트 내부 검색: RN.search, RN.similarResearch, RN.recommend
   기존 앱의 lib/search/site-search.ts + 마이그레이션 search_index(rm_search_normalize, pg_trgm word_similarity)를
   브라우저용 순수 JS로 옮겼다. 검색 대상은 RN.shared(이 사이트에 공개된 연구·고충)뿐이다. 외부 호출 없음.
   - 정규화: 소문자 → 한글 음절을 두벌식 자판 글자로 분해("음향" → "dmagid") → 글자·숫자 외는 공백
   - 제목·키워드·분야: word_similarity(오타 허용). 요약·한계·본문: 공백을 없앤 텍스트의 부분 문자열(띄어쓰기 차이 허용)
   - 결과에 작성자 정보(authorId)는 넣지 않는다(고충). 익명 고충은 연결된 연구도 내보내지 않는다. */
(function () {
  "use strict";
  const RN = window.RN;
  if (!RN) return;

  /** 검색 조정값 (lib/search/site-search.ts SEARCH_TUNING과 같다) */
  const T = {
    defaultLimit: 10, maxLimit: 50, maxQueryLength: 200, maxTokens: 6,
    tokenFloor: 0.5, shortTokenLength: 7, shortTokenFloor: 0.7,
    minBodyNeedleLength: 4, minTokenMean: 0.6, bodyWeight: 0.85,
    /** 추천(비슷한 연구, 프로젝트 키워드)의 최소 점수 */
    recommendMinScore: 0.75,
  };

  // ---------- 정규화 (rm_search_normalize) ----------
  const CHO = ["r", "rr", "s", "e", "ee", "f", "a", "q", "qq", "t", "tt", "d", "w", "ww", "c", "z", "x", "v", "g"];
  const JUNG = ["k", "o", "i", "oo", "j", "p", "u", "pp", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l"];
  const JONG = ["", "r", "rr", "rt", "s", "sw", "sg", "e", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "qt", "t", "tt", "d", "w", "c", "z", "x", "v", "g"];
  // 호환 자모(ㄱ~ㅣ, U+3131~U+3163)도 같은 글자로 바꾼다 (초성만 입력한 경우 등)
  const COMPAT = "r rr rt s sw sg e ee f fr fa fq ft fx fv fg a q qq qt t tt d w ww c z x v g k o i oo j p u pp h hk ho hl y n nj np nl b m ml l".split(" ");
  const ALNUM = /[\p{L}\p{N}]/u;

  function normalize(input) {
    const s = String(input || "").slice(0, 20000).toLowerCase();
    let out = "";
    for (const ch of s) {
      const code = ch.codePointAt(0);
      if (code >= 44032 && code <= 55203) {
        const c = code - 44032;
        out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + JONG[c % 28];
      } else if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) out += ch;
      else if (code >= 0x3131 && code <= 0x3163) out += COMPAT[code - 0x3131];
      else if (code > 127 && ALNUM.test(ch)) out += ch;
      else out += " ";
    }
    return out.replace(/ +/g, " ").trim();
  }

  /** pg_trgm 방식의 trigram 순서열: 단어마다 앞에 공백 둘, 뒤에 공백 하나를 붙여 세 글자씩 */
  function trigramSeq(norm) {
    const seq = [];
    for (const w of norm.split(" ")) {
      if (!w) continue;
      const p = "  " + w + " ";
      for (let i = 0; i + 3 <= p.length; i++) seq.push(p.slice(i, i + 3));
    }
    return seq;
  }

  /**
   * word_similarity(needle, doc): needle의 trigram 집합과 doc trigram 순서열의 연속 구간 사이의 최대 유사도.
   * 구간 유사도 = 공통 trigram 수 / (needle trigram 수 + 구간에만 있는 trigram 수).
   */
  function wordSimilarity(needle, docSeq, docSet, floor) {
    const nSet = needle.set, nSize = nSet.size;
    if (!nSize) return 0;
    // 상한(공통/needle 크기)이 하한보다 작으면 계산하지 않는다
    let common = 0;
    for (const g of nSet) if (docSet.has(g)) common++;
    if (common / nSize < floor) return 0;
    let best = 0;
    const L = docSeq.length;
    for (let i = 0; i < L; i++) {
      if (!nSet.has(docSeq[i])) continue;
      const matched = new Set(), extra = new Set();
      for (let j = i; j < L; j++) {
        const g = docSeq[j];
        if (nSet.has(g)) {
          matched.add(g);
          const sim = matched.size / (nSize + extra.size);
          if (sim > best) best = sim;
          if (best >= 1) return 1;
        } else extra.add(g);
        // 더 늘려도 나아질 수 없으면 멈춘다
        if ((matched.size + (nSize - matched.size)) / (nSize + extra.size) <= best) break;
      }
    }
    return best;
  }

  /** 목록에 보여 줄 짧은 발췌 (마크다운 기호 제거) */
  function excerpt(text, max) {
    const flat = String(text || "").replace(/[#*`>_~|\[\]]+/g, " ").replace(/\s+/g, " ").trim();
    return flat.length > max ? flat.slice(0, max).trimEnd() + "…" : flat;
  }

  /** 검색어를 단어로 (공백·쉼표 기준, 중복 제거, 최대 6개) */
  function tokenize(query) {
    const seen = new Set();
    for (const part of String(query || "").slice(0, T.maxQueryLength).split(/[\s,]+/)) {
      if (part) seen.add(part);
      if (seen.size >= T.maxTokens) break;
    }
    return [...seen];
  }

  // ---------- 색인 (RN.shared가 바뀔 때만 다시 만든다) ----------
  let cache = { research: null, pains: null, rIdx: [], pIdx: [], painCount: new Map() };
  function entry(item, titleText, bodyText) {
    const tn = normalize(titleText);
    const seq = trigramSeq(tn);
    return { item, seq, set: new Set(seq), body: normalize(bodyText).replace(/ /g, "") };
  }
  function index() {
    const s = RN.shared;
    if (cache.research !== s.research) {
      cache.research = s.research;
      cache.rIdx = (s.research || []).map((r) => entry(r, [r.title, (r.keywords || []).join(" "), r.field].join(" "), (r.summary || "") + " " + (r.limitations || "")));
    }
    if (cache.pains !== s.pains) {
      cache.pains = s.pains;
      cache.pIdx = (s.pains || []).map((p) => entry(p, [p.title, (p.tags || []).join(" "), p.field].join(" "), (p.body || "") + " " + (p.resolution || "")));
      // 연구별 고충 수: 익명 글은 연구별 목록에 나오지 않으므로 세지 않는다
      const m = new Map();
      for (const p of s.pains || []) if (p.researchId && !p.isAnonymous) m.set(p.researchId, (m.get(p.researchId) || 0) + 1);
      cache.painCount = m;
    }
    return cache;
  }

  function scoreAll(entries, needles, ntok) {
    const minMean = ntok > 1 ? T.minTokenMean : 0;
    const out = [];
    for (const e of entries) {
      let tok = 0, comp = 0;
      for (let k = 0; k < needles.length; k++) {
        const n = needles[k];
        let v = 0;
        const ws = wordSimilarity(n, e.seq, e.set, n.floor);
        if (ws >= n.floor) v = ws;
        if (n.text.length >= T.minBodyNeedleLength && v < T.bodyWeight && e.body.includes(n.text)) v = T.bodyWeight;
        if (k < ntok) tok += v; else comp = Math.max(comp, v);
      }
      const mean = tok / ntok;
      const lex = Math.max(mean >= minMean ? mean : 0, comp);
      if (lex > 0) out.push({ e, score: Math.round(Math.min(1, lex) * 1000) / 1000 });
    }
    out.sort((a, b) => b.score - a.score || String(a.e.item.id).localeCompare(String(b.e.item.id)));
    return out;
  }

  function researchHit(r, score, painCount) {
    const { report, ...rest } = r;
    return {
      ...rest, type: "research", id: r.id, title: r.title || "", field: r.field || "",
      summary: excerpt(r.summary, 200), limitations: excerpt(r.limitations, 120),
      keywords: Array.isArray(r.keywords) ? r.keywords : [],
      painCount: painCount || 0, hasReport: !!(report && report.html) || !!(r.reportAsset && r.reportAsset.id), score,
    };
  }
  function painHit(p, score) {
    // 작성자 정보는 넣지 않는다. 익명 글은 연결된 연구(작성자 공개)를 내보내지 않는다.
    return {
      type: "pain", id: p.id, title: p.title || "", excerpt: excerpt(p.body, 160), stage: p.stage || "OTHER",
      field: p.field || "", tags: Array.isArray(p.tags) ? p.tags : [], resolved: !!p.resolved,
      researchId: p.isAnonymous ? null : p.researchId || null, isAnonymous: !!p.isAnonymous, isExample: !!p.isExample,
      meTooCount: p.meTooCount || 0, commentCount: p.commentCount || 0, createdAt: p.createdAt || 0, score,
    };
  }

  /**
   * RN.search(query, {limit=10, kinds?, excludeResearchIds?}) → { query, research: [...], pains: [...] }
   * 동기 함수. 결과가 없으면 빈 배열(지어내지 않는다).
   */
  function search(query, opts) {
    opts = opts || {};
    const tokens = tokenize(query);
    const cleaned = tokens.join(" ");
    const empty = { query: cleaned, research: [], pains: [] };
    if (!tokens.length) return empty;
    const limit = Math.min(Math.max(1, Math.floor(opts.limit || T.defaultLimit)), T.maxLimit);
    const kinds = opts.kinds && opts.kinds.length ? opts.kinds : ["research", "pain"];
    const exclude = new Set(opts.excludeResearchIds || []);

    const norms = [...new Set(tokens.map((t) => normalize(t).replace(/ /g, "")).filter(Boolean))];
    if (!norms.length) return empty;
    const ntok = norms.length;
    // 띄어쓰기 차이("음향 블랙홀" ↔ "음향블랙홀")를 위해 붙여 쓴 형태도 함께 본다
    const texts = ntok > 1 ? [...norms, norms.join("")] : norms;
    const needles = texts.map((text) => ({
      text, set: new Set(trigramSeq(text)),
      floor: text.length < T.shortTokenLength ? T.shortTokenFloor : T.tokenFloor,
    }));

    const c = index();
    const research = kinds.includes("research")
      ? scoreAll(c.rIdx, needles, ntok).filter((x) => !exclude.has(x.e.item.id)).slice(0, limit)
          .map((x) => researchHit(x.e.item, x.score, c.painCount.get(x.e.item.id)))
      : [];
    const pains = kinds.includes("pain") || kinds.includes("pains")
      ? scoreAll(c.pIdx, needles, ntok).slice(0, limit).map((x) => painHit(x.e.item, x.score))
      : [];
    return { query: cleaned, research, pains };
  }

  /** 키워드 여러 개 중 하나라도 관련 있는 연구·고충 (문서별 최고 점수로 합침) */
  function recommend(keywords, limit, opts) {
    const unique = [...new Set((keywords || []).map((k) => String(k || "").trim()).filter(Boolean))].slice(0, 6);
    const n = limit || 5;
    if (!unique.length) return { query: "", research: [], pains: [] };
    // 추천은 사용자가 직접 친 검색이 아니므로 더 엄격하게: 부분적으로만 겹치는 문서(예: "가속도 센서" ↔ "반응 속도 … 압력 센서")는 뺀다
    const minScore = opts && opts.minScore != null ? opts.minScore : T.recommendMinScore;
    const results = unique.map((k) => {
      const r = search(k, { ...(opts || {}), limit: n });
      return { research: r.research.filter((x) => x.score >= minScore), pains: r.pains.filter((x) => x.score >= minScore) };
    });
    const best = (lists) => {
      const byId = new Map();
      for (const hit of lists.flat()) { const prev = byId.get(hit.id); if (!prev || hit.score > prev.score) byId.set(hit.id, hit); }
      return [...byId.values()].sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))).slice(0, n);
    };
    return { query: unique.join(", "), research: best(results.map((r) => r.research)), pains: best(results.map((r) => r.pains)) };
  }

  /** 연구 상세 하단 "비슷한 연구": 키워드(없으면 제목)로 찾고 자기 자신은 뺀다 */
  function similarResearch(id, limit) {
    const r = (RN.shared.research || []).find((x) => x.id === id);
    if (!r) return [];
    const opts = { kinds: ["research"], excludeResearchIds: [id] };
    const n = limit || 4;
    const kws = Array.isArray(r.keywords) ? r.keywords.filter(Boolean) : [];
    return (kws.length ? recommend(kws, n, opts) : search(r.title, { ...opts, limit: n })).research;
  }

  // ---------- 의미로 더 찾기 (AI가 준 "검색어"만 쓴다. 결과는 전부 이 사이트 데이터에서) ----------
  const EXPAND = { maxTerms: 8, maxTermLength: 30, termWeight: 0.85 };

  /**
   * AI 응답을 검색 표현 목록으로 정리한다. 문자열 배열만 받고 나머지는 버린다.
   * 제어 문자 제거·공백 정리·길이(30자)·개수(8개) 제한, 원래 검색어와 같은 표현·중복 제거.
   */
  function cleanTerms(raw, query) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set([normalize(query).replace(/ /g, "")]);
    const out = [];
    for (const v of raw) {
      if (typeof v !== "string") continue;
      const t = v.replace(/[\u0000-\u001f\u007f<>"`{}\[\]\\]/g, " ").replace(/\s+/g, " ").trim();
      if (!t || t.length > EXPAND.maxTermLength) continue;
      const key = normalize(t).replace(/ /g, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= EXPAND.maxTerms) break;
    }
    return out;
  }

  /**
   * RN.searchExpanded(query, terms, {limit=20, kinds?}) → { query, terms, research, pains }
   * 순수 함수: 원래 검색어와 주어진 표현들로 RN.search를 돌려 문서별 최고 점수로 합친다.
   * 원래 검색어 결과는 점수 그대로, 다른 표현으로 찾은 결과는 0.85를 곱한다.
   * 각 결과에 matchedBy(찾게 한 표현, 원래 검색어면 null)를 붙인다.
   */
  function searchExpanded(query, terms, opts) {
    opts = opts || {};
    const limit = Math.min(Math.max(1, Math.floor(opts.limit || 20)), T.maxLimit);
    const clean = cleanTerms(terms, query);
    const base = search(query, { ...opts, limit });
    const merge = (key) => {
      const byId = new Map();
      const put = (hit, score, via) => {
        const prev = byId.get(hit.id);
        if (!prev || score > prev.score) byId.set(hit.id, { ...hit, score: Math.round(score * 1000) / 1000, matchedBy: via });
      };
      for (const hit of base[key]) put(hit, hit.score, null);
      for (const t of clean) for (const hit of search(t, { ...opts, limit })[key]) put(hit, hit.score * EXPAND.termWeight, t);
      return [...byId.values()].sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))).slice(0, limit);
    };
    const research = merge("research");
    const pains = merge("pains");
    // 실제로 결과를 더한 표현만 "이런 표현으로도 찾았어요"에 보여 준다
    const used = new Set([...research, ...pains].map((x) => x.matchedBy).filter(Boolean));
    return { query: base.query, terms: clean, usedTerms: clean.filter((t) => used.has(t)), research, pains };
  }

  RN.search = search;
  RN.searchExpanded = searchExpanded;
  RN.recommend = recommend;
  RN.similarResearch = similarResearch;
  // 테스트·다른 모듈용 (정규화 확인)
  RN.searchUtil = { normalize, trigramSeq, excerpt, tokenize, cleanTerms };
})();
