/* mod-data.js (담당 D) — CSV 데이터셋, 표·그래프 만들기. 계약: CONTRACT.md
   - 프로젝트 홈 섹션 "데이터": CSV 올리기(UTF-8/CP949 감지) → 열 타입 추론 → 개인 영역 datasets/{id} 저장, 목록·미리보기·삭제
   - 에디터 패널 탭 "데이터": 표 만들기 → RN.editor.insertTable, 그래프 만들기(직접 그린 SVG) → RN.editor.insertFigure
   - 순수 함수는 RN._data 에 노출(테스트용). 추세선·R²·히스토그램·상자그림 수치는 전부 코드로 계산한다(AI가 수치를 만들지 않음). */
(function () {
  "use strict";
  const RN = window.RN;
  if (!RN) return;
  const h = RN.h;

  // =====================================================================
  // 1. CSV 읽기 (lib/csv/parse.ts 를 옮김)
  // =====================================================================
  const MISSING = new Set(["", "na", "n/a", "nan", "null", "-", "--", "결측", "없음", "#n/a"]);
  const isMissing = (v) => v == null || MISSING.has(String(v).trim().toLowerCase());

  /** 인코딩 감지: BOM → UTF-8 엄격 디코딩 → 실패하면 EUC-KR(CP949) */
  function decodeCsv(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
    }
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
    } catch {
      return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" };
    }
  }

  const NUMBER_RE = /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?|[+-]?\.\d+)\s*([^\d\s.,+-][^\d\s]*)?$/;
  /** "1,234.5", "12.5 cm", "30%" → { value, unit }. 숫자가 아니면 null */
  function parseNumber(raw) {
    const s = String(raw).trim().replace(/−/g, "-");
    const m = NUMBER_RE.exec(s);
    if (!m) return null;
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) return null;
    return { value, unit: m[2] == null ? null : m[2] };
  }

  const DATE_RES = [
    /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/,
  ];
  /** 날짜 문자열 → epoch ms(UTC). 날짜가 아니면 null */
  function parseDate(raw) {
    const s = String(raw).trim();
    for (const re of DATE_RES) {
      const m = re.exec(s);
      if (!m) continue;
      const g = m.slice(1);
      const [y, mo, d, hh, mi, se] = [0, 1, 2, 3, 4, 5].map((i) => (g[i] == null ? "0" : g[i]));
      const month = Number(mo), day = Number(d);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      const t = Date.UTC(Number(y), month - 1, day, Number(hh), Number(mi), Number(se));
      return Number.isNaN(t) ? null : t;
    }
    return null;
  }

  /** 열 타입 추론: 결측을 뺀 값이 모두 숫자면 number(단위 하나로 통일돼 있을 때), 모두 날짜면 date, 아니면 string */
  function inferColumn(name, values) {
    const present = values.filter((v) => !isMissing(v));
    const missing = values.length - present.length;
    if (present.length === 0) return { name, type: "string", unit: null, missing };
    const numbers = present.map(parseNumber);
    if (numbers.every((n) => n !== null)) {
      const units = new Set(numbers.map((n) => n.unit || ""));
      units.delete("");
      if (units.size <= 1) return { name, type: "number", unit: [...units][0] || null, missing };
      return { name, type: "string", unit: null, missing, mixedUnits: [...units] };
    }
    if (present.every((v) => parseDate(v) !== null)) return { name, type: "date", unit: null, missing };
    return { name, type: "string", unit: null, missing };
  }

  const numericValues = (values) => values.map((v) => (isMissing(v) ? null : (parseNumber(v) || { value: null }).value));

  /** Papa가 없을 때(외부 스크립트를 못 불러온 경우) 쓰는 작은 RFC 4180 파서 */
  function splitCsv(text) {
    const rows = [];
    let row = [], cell = "", i = 0, q = false;
    while (i < text.length) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
        cell += c; i++; continue;
      }
      if (c === '"' && cell === "") { q = true; i++; continue; }
      if (c === ",") { row.push(cell); cell = ""; i++; continue; }
      if (c === "\r" || c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += c === "\r" && text[i + 1] === "\n" ? 2 : 1; continue; }
      cell += c; i++;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function tokenize(text) {
    let data;
    if (window.Papa && typeof window.Papa.parse === "function") data = window.Papa.parse(text, { skipEmptyLines: "greedy" }).data;
    else data = splitCsv(text);
    return data.filter((r) => Array.isArray(r) && r.some((c) => String(c).trim() !== ""));
  }

  const MAX_CSV_ROWS = 100000, MAX_CSV_COLUMNS = 200;

  /** CSV 텍스트 → { columns, rows, rowCount, warnings }. 첫 행은 머리글. 실패하면 Error(한국어 메시지) */
  function parseCsvText(text) {
    const data = tokenize(String(text).replace(/^﻿/, ""));
    if (data.length === 0) throw new Error("빈 CSV 파일이에요.");
    const warnings = [];
    const header = data[0].map((x, i) => String(x).trim() || `열${i + 1}`);
    if (header.length > MAX_CSV_COLUMNS) throw new Error(`열이 너무 많아요 (최대 ${MAX_CSV_COLUMNS}개).`);
    const seen = new Map();
    const names = header.map((x) => { const n = (seen.get(x) || 0) + 1; seen.set(x, n); return n === 1 ? x : `${x} (${n})`; });
    let body = data.slice(1);
    if (body.length > MAX_CSV_ROWS) { warnings.push(`행이 ${MAX_CSV_ROWS.toLocaleString("ko-KR")}개를 넘어 앞부분만 사용해요.`); body = body.slice(0, MAX_CSV_ROWS); }
    let ragged = 0;
    const rows = body.map((r) => {
      if (r.length !== names.length) ragged += 1;
      return names.map((_, i) => (isMissing(r[i]) ? "" : String(r[i]).trim()));
    });
    if (ragged > 0) warnings.push(`열 개수가 머리글과 다른 행이 ${ragged}개 있어 빈 칸으로 맞췄어요.`);
    const columns = names.map((name, i) => inferColumn(name, rows.map((r) => r[i])));
    columns.forEach((c) => {
      if (c.mixedUnits) warnings.push(`"${c.name}" 열에 단위가 섞여 있어(${c.mixedUnits.join(", ")}) 문자로 처리했어요.`);
      delete c.mixedUnits;
    });
    return { columns, rows, rowCount: rows.length, warnings };
  }
  /** CSV 바이트 → parseCsvText 결과 + encoding */
  function parseCsv(bytes) {
    const { text, encoding } = decodeCsv(bytes);
    return Object.assign({ encoding }, parseCsvText(text));
  }

  /** 문서 하나 256KiB 한도: 넘으면 행을 앞에서부터 남기고 자른다. → { doc, truncated, keptRows } */
  const DOC_LIMIT = 256 * 1024 - 4096;
  const byteSize = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
  function fitDataset(doc, limit = DOC_LIMIT) {
    if (byteSize(doc) <= limit) return { doc, truncated: false, keptRows: doc.rows.length };
    let lo = 0, hi = doc.rows.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (byteSize(Object.assign({}, doc, { rows: doc.rows.slice(0, mid) })) <= limit) lo = mid; else hi = mid - 1;
    }
    return { doc: Object.assign({}, doc, { rows: doc.rows.slice(0, lo), rowCount: lo }), truncated: true, keptRows: lo };
  }

  // =====================================================================
  // 2. 통계 (lib/csv/stats.ts)
  // =====================================================================
  function pairs(xs, ys) {
    const out = [];
    for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
      const x = xs[i], y = ys[i];
      if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
    }
    return out;
  }
  /** 최소제곱 y = slope·x + intercept, 결정계수 R². 점 2개 미만이거나 x가 모두 같으면 null */
  function linearRegression(points) {
    const n = points.length;
    if (n < 2) return null;
    let sx = 0, sy = 0;
    for (const [x, y] of points) { sx += x; sy += y; }
    const mx = sx / n, my = sy / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of points) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
    if (sxx === 0) return null;
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy), n };
  }
  const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
  function stdev(v) { if (v.length < 2) return NaN; const m = mean(v); return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); }
  /** 선형 보간 분위수 (Excel PERCENTILE.INC, numpy 기본) — sorted는 오름차순 */
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function boxStats(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const q1 = quantile(s, 0.25), median = quantile(s, 0.5), q3 = quantile(s, 0.75);
    const iqr = q3 - q1, lowF = q1 - 1.5 * iqr, highF = q3 + 1.5 * iqr;
    const inside = s.filter((v) => v >= lowF && v <= highF);
    return { min: s[0], q1, median, q3, max: s[s.length - 1], whiskerLow: inside[0], whiskerHigh: inside[inside.length - 1], outliers: s.filter((v) => v < lowF || v > highF) };
  }
  /** 히스토그램 구간. binCount가 없으면 스터지스(1 + log2 n) */
  function histogram(values, binCount) {
    if (!values.length) return [];
    let min = Infinity, max = -Infinity;
    for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
    const k = Math.max(1, Math.floor(binCount || Math.ceil(1 + Math.log2(values.length))));
    if (min === max) return [{ start: min, end: max, count: values.length }];
    const width = (max - min) / k;
    const bins = Array.from({ length: k }, (_, i) => ({ start: min + i * width, end: min + (i + 1) * width, count: 0 }));
    for (const v of values) bins[Math.min(k - 1, Math.floor((v - min) / width))].count += 1;
    return bins;
  }
  const formatNumber = (v, d) => v.toFixed(Math.max(0, Math.min(10, d)));
  const formatSig = (v, digits = 4) => (v === 0 ? "0" : String(Number(v.toPrecision(digits))));

  // =====================================================================
  // 3. 표 (lib/data/table.ts)
  // =====================================================================
  const MAX_TABLE_ROWS = 500;
  const defaultTableOptions = (columns) => ({ columns: columns.map((c, index) => ({ index, header: c.name, unit: c.unit || "" })), decimals: null, headerRow: true });
  function headerText(col, info) {
    const name = (col.header || "").trim() || (info && info.name) || "";
    const unit = (col.unit || "").trim();
    return unit ? `${name} (${unit})` : name;
  }
  /** 숫자 열은 단위를 떼고(단위는 머리글로) 소수 자릿수를 맞춘다. 결측은 빈 칸 */
  function cellText(raw, info, decimals) {
    if (raw === "" || raw == null) return "";
    if (!info || info.type !== "number") return raw;
    const p = parseNumber(raw);
    if (!p) return raw;
    if (decimals != null) return formatNumber(p.value, decimals);
    if (!p.unit) return String(raw).trim();
    const s = String(raw).trim();
    return s.slice(0, s.lastIndexOf(p.unit)).trim();
  }
  function buildTableGrid(columns, rows, options, maxRows = MAX_TABLE_ROWS) {
    const header = options.columns.map((c) => headerText(c, columns[c.index]));
    const body = rows.slice(0, maxRows).map((r) => options.columns.map((c) => cellText(r[c.index] == null ? "" : r[c.index], columns[c.index], options.decimals)));
    return { header, body, truncated: rows.length > maxRows };
  }
  /** RN.editor.insertTable 인자. 머리글 행을 끄면 header는 빈 배열, 머리글 문구는 첫 행으로 */
  function tableInsertArgs(columns, rows, options, caption) {
    if (!options.columns.length) throw new Error("열을 하나 이상 고르세요.");
    const g = buildTableGrid(columns, rows, options);
    return options.headerRow ? { header: g.header, rows: g.body, caption } : { header: [], rows: [g.header, ...g.body], caption };
  }

  // =====================================================================
  // 4. 그래프 설정과 계산 (lib/data/chart.ts — Plotly 대신 직접 SVG)
  // =====================================================================
  const CHART_TYPES = ["line", "scatter", "bar", "histogram", "box"];
  const CHART_LABELS = { line: "꺾은선", scatter: "산점도", bar: "막대", histogram: "히스토그램", box: "상자그림" };
  function chartUses(type) {
    const xy = type === "line" || type === "scatter" || type === "bar";
    return { xy, error: xy, trendline: type === "line" || type === "scatter", bins: type === "histogram", logX: type === "line" || type === "scatter" || type === "histogram" };
  }
  /** 설정 검증·기본값 채우기 (zod 스키마 대신) */
  function normalizeConfig(c) {
    c = c || {};
    const str = (v) => (typeof v === "string" ? v.slice(0, 200) : "");
    const col = (v) => (typeof v === "string" && v ? v.slice(0, 200) : null);
    const bins = Number.isInteger(c.bins) && c.bins >= 1 && c.bins <= 200 ? c.bins : null;
    return {
      type: CHART_TYPES.includes(c.type) ? c.type : "scatter",
      x: col(c.x), y: col(c.y), error: col(c.error),
      xTitle: str(c.xTitle), yTitle: str(c.yTitle), xUnit: str(c.xUnit), yUnit: str(c.yUnit),
      logX: !!c.logX, logY: !!c.logY, trendline: !!c.trendline, bins,
    };
  }
  function defaultChartConfig(columns, type = "scatter") {
    const numeric = columns.filter((c) => c.type === "number");
    const x = numeric[0] || columns[0];
    const y = numeric.find((c) => c !== x) || numeric[0] || null;
    return normalizeConfig({ type, x: x && x.name, y: y && y.name, xUnit: (x && x.unit) || "", yUnit: (y && y.unit) || "" });
  }
  function axisTitle(title, unit) {
    const t = (title || "").trim(), u = (unit || "").trim();
    if (!t) return u ? `(${u})` : "";
    return u ? `${t} (${u})` : t;
  }
  const trendLabel = (r) => `y = ${formatSig(r.slope)}x ${r.intercept < 0 ? "−" : "+"} ${formatSig(Math.abs(r.intercept))}  (R² = ${r.r2.toFixed(4)})`;
  function chartCaption(config) {
    if (config.type === "histogram") return `${config.xTitle || config.x || ""}의 분포`;
    if (config.type === "box") return `${config.yTitle || config.y || ""}의 분포`;
    return `${config.xTitle || config.x || ""}에 따른 ${config.yTitle || config.y || ""}`;
  }

  /** 그래프에 쓸 값을 원본 데이터에서 결정적으로 계산한다. → { ok, kind, …, warnings, n } | { ok:false, error } */
  function prepareChart(rawConfig, columns, rows) {
    const config = normalizeConfig(rawConfig);
    const uses = chartUses(config.type);
    const warnings = [];
    const fail = (error) => ({ ok: false, error });
    const find = (name) => { if (name == null) return null; const i = columns.findIndex((c) => c.name === name); return i < 0 ? undefined : { index: i, info: columns[i] }; };
    const xCol = find(config.x), yCol = find(config.y), eCol = uses.error ? find(config.error) : null;
    for (const [c, name] of [[xCol, config.x], [yCol, config.y], [eCol, config.error]]) if (c === undefined) return fail(`"${name}" 열이 이 데이터에 없어요.`);
    const notNum = (c) => (c && c.info.type !== "number" ? fail(`"${c.info.name}" 열은 숫자 열이 아니에요.`) : null);
    const cellNum = (r, c) => { const raw = r[c.index]; if (isMissing(raw)) return null; const p = parseNumber(raw); return p ? p.value : null; };

    if (config.type === "histogram") {
      if (!xCol) return fail("값 열을 고르세요.");
      const bad = notNum(xCol); if (bad) return bad;
      const raw = rows.map((r) => cellNum(r, xCol));
      let values = raw.filter((v) => v != null);
      if (values.length < raw.length) warnings.push(`결측값 ${raw.length - values.length}개를 빼고 그렸어요.`);
      if (config.logX) { const kept = values.filter((v) => v > 0); if (kept.length < values.length) warnings.push(`로그 축이라 0 이하 값 ${values.length - kept.length}개를 뺐어요.`); values = kept; }
      if (!values.length) return fail("그릴 값이 없어요.");
      const bins = config.logX
        ? histogram(values.map(Math.log10), config.bins).map((b) => ({ start: 10 ** b.start, end: 10 ** b.end, count: b.count }))
        : histogram(values, config.bins);
      return { ok: true, kind: "hist", config, bins, n: values.length, regression: null, warnings };
    }

    if (config.type === "box") {
      if (!yCol) return fail("값 열을 고르세요.");
      const bad = notNum(yCol); if (bad) return bad;
      const byGroup = new Map();
      let dropped = 0, logDropped = 0;
      rows.forEach((r) => {
        const v = cellNum(r, yCol);
        const g = xCol ? (isMissing(r[xCol.index]) ? null : String(r[xCol.index]).trim()) : "";
        if (v == null || g == null) { dropped++; return; }
        if (config.logY && v <= 0) { logDropped++; return; }
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push(v);
      });
      if (dropped) warnings.push(`결측값 ${dropped}개를 빼고 그렸어요.`);
      if (logDropped) warnings.push(`로그 축이라 0 이하 값 ${logDropped}개를 뺐어요.`);
      if (!byGroup.size) return fail("그릴 값이 없어요.");
      const groups = [...byGroup.entries()].map(([k, vals]) => ({ label: k || config.yTitle || config.y || "", stats: boxStats(vals), n: vals.length }));
      return { ok: true, kind: "box", config, groups, n: groups.reduce((a, g) => a + g.n, 0), regression: null, warnings };
    }

    if (!xCol) return fail("X 열을 고르세요.");
    if (!yCol) return fail("Y 열을 고르세요.");
    const bad = notNum(yCol) || notNum(eCol); if (bad) return bad;
    // bar는 X를 항목(범주)으로, 꺾은선·산점도는 숫자·날짜 X면 연속 축
    const xKind = config.type === "bar" || xCol.info.type === "string" ? "category" : xCol.info.type;
    let pts = [];
    let dropped = 0;
    rows.forEach((r) => {
      const rawX = r[xCol.index];
      const y = cellNum(r, yCol);
      let x;
      if (isMissing(rawX)) x = null;
      else if (xKind === "number") { const p = parseNumber(rawX); x = p ? p.value : null; }
      else if (xKind === "date") x = parseDate(rawX);
      else x = String(rawX).trim();
      if (x == null || y == null) { dropped++; return; }
      const e = eCol ? cellNum(r, eCol) : null;
      pts.push({ x, y, e: e == null ? 0 : Math.abs(e) });
    });
    if (dropped) warnings.push(`결측값이 있는 행 ${dropped}개를 빼고 그렸어요.`);
    const logX = config.logX && uses.logX && xKind === "number";
    if (logX || config.logY) {
      const kept = pts.filter((p) => (!logX || p.x > 0) && (!config.logY || p.y > 0));
      if (kept.length < pts.length) warnings.push(`로그 축이라 0 이하 값이 있는 점 ${pts.length - kept.length}개를 뺐어요.`);
      pts = kept;
    }
    if (!pts.length) return fail("그릴 점이 없어요.");
    if (config.type === "line" && xKind !== "category") pts.sort((a, b) => a.x - b.x);
    let regression = null;
    if (config.trendline && uses.trendline) {
      if (xKind !== "number") warnings.push("추세선은 X가 숫자 열일 때만 그려요.");
      else {
        regression = linearRegression(pts.map((p) => [p.x, p.y]));
        if (!regression) warnings.push("점이 2개 미만이거나 X가 모두 같아 추세선을 그릴 수 없어요.");
        else if (logX || config.logY) warnings.push("추세선은 로그로 바꾸기 전 원래 값으로 계산했어요.");
      }
    }
    return { ok: true, kind: "xy", config, xKind, logX, points: pts, hasError: !!eCol, n: pts.length, regression, warnings };
  }

  // ---------- 눈금 ----------
  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  const clean = (v) => (Math.abs(v) < 1e-12 ? 0 : Number(v.toPrecision(12)));
  /** [min, max]를 덮는 보기 좋은 눈금 → { lo, hi, ticks, step } */
  function niceTicks(min, max, count = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
    if (min === max) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
    const step = niceStep((max - min) / count);
    const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(clean(v));
    return { lo: clean(lo), hi: clean(hi), ticks, step };
  }
  function logTicks(min, max) {
    let lo = Math.floor(Math.log10(min)), hi = Math.ceil(Math.log10(max));
    if (hi === lo) hi = lo + 1;
    const ticks = [];
    for (let k = lo; k <= hi; k++) {
      ticks.push(10 ** k);
      if (hi - lo <= 2 && k < hi) { ticks.push(2 * 10 ** k); ticks.push(5 * 10 ** k); }
    }
    return { lo: 10 ** lo, hi: 10 ** hi, ticks: ticks.map(clean).sort((a, b) => a - b) };
  }
  function fmtTick(v, step) {
    if (v === 0) return "0";
    const a = Math.abs(v);
    if (a >= 1e6 || a < 1e-4) return v.toExponential(1).replace("e+", "e");
    const d = step ? Math.max(0, Math.min(8, -Math.floor(Math.log10(step) + 1e-9))) : 0;
    return step ? v.toFixed(d) : formatSig(v, 4);
  }
  const DAY = 86400000;
  function fmtDay(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }

  // ---------- SVG ----------
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  /** 글자 폭 대략치: 한글·한자 등 넓은 글자 1em, 나머지 0.6em */
  function textWidth(s, size) { let w = 0; for (const ch of String(s)) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 1 : ch === " " ? 0.32 : 0.6; return w * size; }
  function clip(s, max) { s = String(s); return s.length > max ? s.slice(0, max - 1) + "…" : s; }
  const n2 = (v) => (Math.round(v * 100) / 100).toString();
  const COLORS = { text: "#111827", muted: "#4b5563", axis: "#374151", grid: "#e5e7eb", series: "#2563eb", seriesDark: "#1e3a8a", trend: "#dc2626", err: "#334155", outlier: "#dc2626", bg: "#ffffff", box: "#dbeafe" };
  const FONT = "'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif";

  /** 설정 + 데이터 → { ok, svg, regression, warnings, n } | { ok:false, error }. 크기는 viewBox 기준(기본 640×400) */
  function renderChartSvg(rawConfig, columns, rows, opts = {}) {
    const prep = prepareChart(rawConfig, columns, rows);
    if (!prep.ok) return prep;
    const config = prep.config;
    const W = opts.width || 640, H = opts.height || 400;
    const TICK = 12, TITLE = 13;
    const parts = [];
    const text = (x, y, s, o = {}) => parts.push(`<text x="${n2(x)}" y="${n2(y)}" fill="${o.fill || COLORS.text}" font-size="${o.size || TICK}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.weight ? ` font-weight="${o.weight}"` : ""}${o.rotate != null ? ` transform="rotate(${o.rotate} ${n2(x)} ${n2(y)})"` : ""}>${esc(s)}</text>`);
    const line = (x1, y1, x2, y2, stroke, w = 1, dash) => parts.push(`<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${stroke}" stroke-width="${w}" fill="none"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);

    // ---- Y 정의역 ----
    let yVals = [];
    if (prep.kind === "xy") prep.points.forEach((p) => { yVals.push(p.y + p.e, p.y - p.e); });
    else if (prep.kind === "hist") yVals = [0, ...prep.bins.map((b) => b.count)];
    else prep.groups.forEach((g) => { yVals.push(g.stats.min, g.stats.max); });
    if (prep.regression && prep.kind === "xy") {
      const xs = prep.points.map((p) => p.x), lo = Math.min(...xs), hi = Math.max(...xs), r = prep.regression;
      yVals.push(r.slope * lo + r.intercept, r.slope * hi + r.intercept);
    }
    const logY = config.logY && prep.kind !== "hist";
    if (logY) yVals = yVals.filter((v) => v > 0);
    let yMin = Math.min(...yVals), yMax = Math.max(...yVals);
    if (!logY && (prep.kind === "hist" || config.type === "bar")) { yMin = Math.min(0, yMin); yMax = Math.max(0, yMax); }
    const yAxis = logY ? logTicks(yMin, yMax) : niceTicks(yMin, yMax, prep.kind === "hist" ? Math.max(1, Math.min(5, yMax)) : 5);
    const yLabels = yAxis.ticks.map((t) => fmtTick(t, logY ? 0 : yAxis.step));

    // ---- X 정의역 ----
    let xAxis = null, cats = null, logXs = false;
    if (prep.kind === "hist") {
      logXs = config.logX;
      const lo = prep.bins[0].start, hi = prep.bins[prep.bins.length - 1].end;
      xAxis = logXs ? logTicks(lo, hi) : niceTicks(lo, hi === lo ? lo + 1 : hi, 6);
      if (!logXs && prep.bins.length === 1 && lo === hi) xAxis = niceTicks(lo - 0.5, hi + 0.5, 4);
    } else if (prep.kind === "box") {
      cats = prep.groups.map((g) => g.label);
    } else if (prep.xKind === "category") {
      cats = [];
      const seen = new Set();
      prep.points.forEach((p) => { if (!seen.has(p.x)) { seen.add(p.x); cats.push(p.x); } });
    } else if (prep.xKind === "date") {
      const xs = prep.points.map((p) => p.x);
      const d = niceTicks(Math.min(...xs) / DAY, Math.max(...xs) / DAY, 5);
      const step = Math.max(1, d.step);
      const lo = Math.floor(d.lo), hi = Math.ceil(d.hi);
      const ticks = []; for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v) * DAY);
      xAxis = { lo: lo * DAY, hi: Math.max(hi * DAY, lo * DAY + DAY), ticks, date: true };
    } else {
      logXs = prep.logX;
      const xs = prep.points.map((p) => p.x);
      xAxis = logXs ? logTicks(Math.min(...xs), Math.max(...xs)) : niceTicks(Math.min(...xs), Math.max(...xs), 6);
    }
    const xLabels = xAxis ? xAxis.ticks.map((t) => (xAxis.date ? fmtDay(t) : fmtTick(t, logXs ? 0 : xAxis.step))) : cats.map((c) => clip(c, 14));

    // ---- 여백 ----
    const xTitle = axisTitle(config.type === "histogram" ? config.xTitle || config.x : config.type === "box" ? config.xTitle || (config.x || "") : config.xTitle || config.x, config.type === "box" ? "" : config.xUnit);
    const yTitle = axisTitle(config.type === "histogram" ? config.yTitle || "빈도" : config.yTitle || config.y, config.type === "histogram" ? config.yUnit : config.yUnit);
    const yLabelW = Math.max(...yLabels.map((s) => textWidth(s, TICK)));
    let left = 10 + (yTitle ? TITLE + 10 : 0) + yLabelW + 8;
    let right = 18;
    const trend = prep.regression ? trendLabel(prep.regression) : "";
    const top = trend ? 36 : 16;
    let rotate = false, every = 1;
    const plotW0 = W - left - right;
    if (cats) {
      const band = plotW0 / cats.length;
      const maxW = Math.max(...xLabels.map((s) => textWidth(s, TICK)));
      if (maxW + 6 > band) {
        rotate = true;
        every = Math.max(1, Math.ceil(16 / band));
        left = Math.max(left, maxW * 0.71 - band / 2 + 6);
      }
    } else {
      const lastW = textWidth(xLabels[xLabels.length - 1], TICK);
      right = Math.max(right, lastW / 2 + 4);
      left = Math.max(left, textWidth(xLabels[0], TICK) / 2 + 4);
    }
    const xLabelH = rotate ? Math.max(...xLabels.map((s) => textWidth(s, TICK))) * 0.71 + TICK : TICK + 4;
    const bottom = 8 + xLabelH + 6 + (xTitle ? TITLE + 10 : 0);
    const px0 = left, px1 = W - right, py0 = top, py1 = H - bottom;
    const plotW = px1 - px0, plotH = py1 - py0;
    if (plotW < 60 || plotH < 60) return { ok: false, error: "그래프를 그릴 공간이 부족해요. 라벨을 줄여 보세요." };

    // ---- 스케일 ----
    const sY = logY
      ? (v) => py1 - ((Math.log10(v) - Math.log10(yAxis.lo)) / (Math.log10(yAxis.hi) - Math.log10(yAxis.lo))) * plotH
      : (v) => py1 - ((v - yAxis.lo) / (yAxis.hi - yAxis.lo)) * plotH;
    let sX = null, band = 0, catX = null;
    if (cats) {
      band = plotW / cats.length;
      const index = new Map(cats.map((c, i) => [c, i]));
      catX = (c) => px0 + band * (index.get(c) + 0.5);
    } else {
      sX = logXs
        ? (v) => px0 + ((Math.log10(v) - Math.log10(xAxis.lo)) / (Math.log10(xAxis.hi) - Math.log10(xAxis.lo))) * plotW
        : (v) => px0 + ((v - xAxis.lo) / (xAxis.hi - xAxis.lo)) * plotW;
    }

    // ---- 바탕·격자·축 ----
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${COLORS.bg}"/>`);
    yAxis.ticks.forEach((t, i) => {
      const y = sY(t);
      line(px0, y, px1, y, COLORS.grid, 1);
      line(px0 - 4, y, px0, y, COLORS.axis, 1);
      text(px0 - 7, y + 4, yLabels[i], { anchor: "end" });
    });
    if (cats) {
      cats.forEach((c, i) => {
        const x = px0 + band * (i + 0.5);
        line(x, py1, x, py1 + 4, COLORS.axis, 1);
        if (i % every !== 0) return;
        if (rotate) text(x + 3, py1 + 14, xLabels[i], { anchor: "end", rotate: -45 });
        else text(x, py1 + 8 + TICK, xLabels[i], { anchor: "middle" });
      });
    } else {
      xAxis.ticks.forEach((t, i) => {
        const x = sX(t);
        line(x, py0, x, py1, COLORS.grid, 1);
        line(x, py1, x, py1 + 4, COLORS.axis, 1);
        text(x, py1 + 8 + TICK, xLabels[i], { anchor: "middle" });
      });
    }
    line(px0, py1, px1, py1, COLORS.axis, 1.2);
    line(px0, py0, px0, py1, COLORS.axis, 1.2);
    if (xTitle) text((px0 + px1) / 2, H - 10, clip(xTitle, 60), { anchor: "middle", size: TITLE, weight: 600 });
    if (yTitle) text(10 + TITLE, (py0 + py1) / 2, clip(yTitle, 40), { anchor: "middle", size: TITLE, weight: 600, rotate: -90 });

    // ---- 자료 ----
    const base = logY ? yAxis.lo : 0;
    if (prep.kind === "hist") {
      prep.bins.forEach((b) => {
        let x0 = sX(b.start), x1 = sX(b.end);
        if (x1 - x0 < 2) { const c = (x0 + x1) / 2; x0 = c - Math.max(8, plotW * 0.1); x1 = c + Math.max(8, plotW * 0.1); }
        const y = sY(b.count);
        parts.push(`<rect x="${n2(x0)}" y="${n2(y)}" width="${n2(Math.max(0, x1 - x0))}" height="${n2(Math.max(0, py1 - y))}" fill="${COLORS.series}" fill-opacity="0.85" stroke="${COLORS.seriesDark}" stroke-width="1"/>`);
      });
    } else if (prep.kind === "box") {
      const bw = Math.min(60, band * 0.5);
      prep.groups.forEach((g) => {
        const s = g.stats, cx = catX(g.label);
        line(cx, sY(s.whiskerHigh), cx, sY(s.q3), COLORS.axis, 1.2);
        line(cx, sY(s.q1), cx, sY(s.whiskerLow), COLORS.axis, 1.2);
        line(cx - bw / 4, sY(s.whiskerHigh), cx + bw / 4, sY(s.whiskerHigh), COLORS.axis, 1.2);
        line(cx - bw / 4, sY(s.whiskerLow), cx + bw / 4, sY(s.whiskerLow), COLORS.axis, 1.2);
        const yq3 = sY(s.q3), yq1 = sY(s.q1);
        parts.push(`<rect x="${n2(cx - bw / 2)}" y="${n2(Math.min(yq1, yq3))}" width="${n2(bw)}" height="${n2(Math.max(1, Math.abs(yq1 - yq3)))}" fill="${COLORS.box}" stroke="${COLORS.series}" stroke-width="1.5"/>`);
        line(cx - bw / 2, sY(s.median), cx + bw / 2, sY(s.median), COLORS.seriesDark, 2.2);
        s.outliers.forEach((o) => parts.push(`<circle cx="${n2(cx)}" cy="${n2(sY(o))}" r="3.5" fill="${COLORS.outlier}" stroke="none"/>`));
      });
    } else {
      const X = (p) => (cats ? catX(p.x) : sX(p.x));
      if (config.type === "bar") {
        const bw = Math.max(2, Math.min(48, band * 0.7));
        prep.points.forEach((p) => {
          const y = sY(p.y);
          const top_ = Math.min(y, sY(logY ? base : 0)), hgt = Math.abs(sY(logY ? base : 0) - y);
          parts.push(`<rect x="${n2(X(p) - bw / 2)}" y="${n2(top_)}" width="${n2(bw)}" height="${n2(Math.max(0.5, hgt))}" fill="${COLORS.series}" stroke="none"/>`);
        });
      }
      if (config.type === "line" && prep.points.length > 1) {
        parts.push(`<polyline points="${prep.points.map((p) => n2(X(p)) + "," + n2(sY(p.y))).join(" ")}" fill="none" stroke="${COLORS.series}" stroke-width="2" stroke-linejoin="round"/>`);
      }
      if (prep.hasError) {
        prep.points.forEach((p) => {
          if (!p.e) return;
          const x = X(p), hiV = p.y + p.e, loV = logY ? Math.max(p.y - p.e, yAxis.lo) : p.y - p.e;
          line(x, sY(hiV), x, sY(loV), COLORS.err, 1.2);
          line(x - 4, sY(hiV), x + 4, sY(hiV), COLORS.err, 1.2);
          line(x - 4, sY(loV), x + 4, sY(loV), COLORS.err, 1.2);
        });
      }
      if (config.type !== "bar") prep.points.forEach((p) => parts.push(`<circle cx="${n2(X(p))}" cy="${n2(sY(p.y))}" r="4" fill="${COLORS.series}" stroke="${COLORS.bg}" stroke-width="1"/>`));
      if (prep.regression) {
        const r = prep.regression, xs = prep.points.map((p) => p.x), lo = Math.min(...xs), hi = Math.max(...xs);
        const pts = [];
        for (let i = 0; i <= 40; i++) {
          const x = logXs ? 10 ** (Math.log10(lo) + ((Math.log10(hi) - Math.log10(lo)) * i) / 40) : lo + ((hi - lo) * i) / 40;
          const y = r.slope * x + r.intercept;
          if (logY && y <= 0) continue;
          pts.push(n2(sX(x)) + "," + n2(Math.max(py0, Math.min(py1, sY(y)))));
        }
        if (pts.length > 1) parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${COLORS.trend}" stroke-width="2" stroke-dasharray="6 4"/>`);
        line(px0, 16, px0 + 22, 16, COLORS.trend, 2, "6 4");
        text(px0 + 28, 20, trend, { fill: "#991b1b", size: 12.5 });
      }
    }

    const label = esc(opts.title || chartCaption(config));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}" font-family="${esc(FONT)}"><title>${label}</title>${parts.join("")}</svg>`;
    return { ok: true, svg, regression: prep.regression, warnings: prep.warnings, n: prep.n, bins: prep.bins || null, groups: prep.groups || null };
  }

  // =====================================================================
  // 5. AI 추천 → 설정 (lib/data/chart-suggestion.ts). 수치는 받지 않는다.
  // =====================================================================
  function stripUnit(title, unit) {
    const t = String(title || "").trim();
    if (!unit) return t;
    const suf = `(${unit})`;
    return t.endsWith(suf) ? t.slice(0, -suf.length).trim() : t;
  }
  /** 추천 한 건 → 설정. 이 데이터에 없는 열을 가리키면 null */
  function configFromSuggestion(base, s, columns) {
    if (!s || typeof s !== "object" || !CHART_TYPES.includes(s.chartType)) return null;
    const byName = new Map(columns.map((c) => [c.name, c]));
    const known = (name) => name == null || byName.has(name);
    const ys = Array.isArray(s.y) ? s.y : s.y != null ? [s.y] : [];
    const target = ys[0] == null ? null : ys[0];
    const xName = s.x == null || s.x === "" ? null : s.x;
    const errName = s.errorBar == null || s.errorBar === "" ? null : s.errorBar;
    if (!known(xName) || !known(target) || !known(errName)) return null;
    let x = xName, y = target;
    if (s.chartType === "histogram") { x = target || xName; y = base.y; }
    if (!x && s.chartType !== "box") return null;
    if (!y && s.chartType !== "histogram") return null;
    const xUnit = s.chartType === "box" ? "" : ((byName.get(x || "") || {}).unit || "");
    const yUnit = s.chartType === "histogram" ? "" : ((byName.get(y || "") || {}).unit || "");
    const need = (name) => byName.get(name) && byName.get(name).type === "number";
    if (s.chartType === "histogram" && !need(x)) return null;
    if (s.chartType !== "histogram" && !need(y)) return null;
    return normalizeConfig(Object.assign({}, base, {
      type: s.chartType, x, y,
      error: s.chartType === "histogram" || s.chartType === "box" ? null : errName,
      logX: !!s.logX, logY: !!s.logY, trendline: !!s.trendline,
      xTitle: stripUnit(s.xTitle, xUnit), yTitle: stripUnit(s.yTitle, yUnit), xUnit, yUnit,
    }));
  }
  function suggestPrompt(columns) {
    const cols = columns.map((c) => ({ name: c.name, type: c.type, unit: c.unit || null }));
    return [
      "한국 중·고등학생의 탐구 보고서에 넣을 그래프를 고르려 한다. 아래는 CSV 데이터의 열 이름과 타입뿐이다(값은 없다).",
      "열: " + JSON.stringify(cols),
      "가장 알맞은 그래프를 1~3개 추천하라. 숫자 값은 만들지 말고 유형과 축 구성만 정한다. 열 이름은 위 목록의 이름을 글자 그대로만 쓴다.",
      'chartType은 "line"|"scatter"|"bar"|"histogram"|"box" 중 하나. histogram은 y[0]이 값 열이고 x는 null, box는 y[0]이 값 열이고 x는 묶음 열 또는 null.',
      '오직 JSON으로만 답하라: {"suggestions":[{"chartType":"scatter","x":"열 이름","y":["열 이름"],"errorBar":null,"logX":false,"logY":false,"trendline":true,"xTitle":"축 제목","yTitle":"축 제목","reason":"한 문장 이유"}]}',
    ].join("\n");
  }

  RN._data = {
    isMissing, decodeCsv, parseNumber, parseDate, inferColumn, numericValues, parseCsvText, parseCsv, splitCsv, fitDataset, byteSize,
    pairs, linearRegression, mean, stdev, quantile, boxStats, histogram, formatNumber, formatSig,
    defaultTableOptions, headerText, cellText, buildTableGrid, tableInsertArgs,
    CHART_TYPES, chartUses, normalizeConfig, defaultChartConfig, axisTitle, trendLabel, chartCaption, prepareChart, niceTicks, logTicks, renderChartSvg,
    configFromSuggestion, suggestPrompt,
  };

  // =====================================================================
  // 6. 저장소 (개인 영역 datasets/{id})
  // =====================================================================
  RN.css("data", `
    .dt-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .dt-cols { font-size: 0.82rem; color: var(--muted); overflow-wrap: anywhere; }
    .dt-preview { max-height: 320px; overflow: auto; }
    .dt-chart { background: var(--paper); color: var(--paper-fg); border: 1px solid var(--line); border-radius: var(--radius); padding: 6px; }
    .dt-chart svg { display: block; width: 100%; height: auto; }
    .dt-colopts { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,0.6fr); gap: 6px 8px; align-items: center; }
    .dt-colpick { display: flex; flex-wrap: wrap; gap: 4px 14px; }
    .dt-check { display: inline-flex; align-items: center; gap: 6px; font-size: 0.88rem; min-width: 0; overflow-wrap: anywhere; }
    .dt-tabs { display: inline-flex; }
    .dt-tabs .rn-btn { border-radius: 0; min-width: 64px; }
    .dt-tabs .rn-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
    .dt-tabs .rn-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; margin-left: -1px; }
    .dt-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .dt-dslist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .dt-ds { padding: 10px 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .dt-ds + .dt-ds { border-top: 1px solid var(--line); }
    .dt-ds-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .dt-ds-name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .dt-ds-name strong { overflow-wrap: anywhere; }
    .dt-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 8px; }
    .dt-warn { color: var(--warn); font-size: 0.85rem; }
    .dt-step { font-size: 0.85rem; font-weight: 600; }
    .dt-step-num { display: inline-flex; align-items: center; justify-content: center; width: 1.3rem; height: 1.3rem; border-radius: 50%; background: var(--surface-2); font-size: 0.75rem; margin-right: 6px; }
    .dt-upload { position: relative; display: inline-flex; }
    .dt-upload:focus-within .rn-btn { outline: 2px solid var(--accent); outline-offset: 2px; }
    .dt-upload input[type="file"] { position: absolute; inset: 0; width: 1px; height: 1px; opacity: 0; }
    .dt-upload[aria-disabled="true"] .rn-btn { opacity: 0.5; cursor: not-allowed; }
    .dt-more > summary { cursor: pointer; font-size: 0.9rem; font-weight: 500; padding: 2px 0; }
    .dt-more[open] > summary { margin-bottom: 10px; }
    /* ⋯ 메뉴 */
    .dt-menu-wrap { position: relative; display: inline-block; }
    .dt-menu-btn { min-width: 36px; font-weight: 700; letter-spacing: 1px; }
    .dt-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 6; min-width: 8rem; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 4px; display: flex; flex-direction: column; box-shadow: 0 6px 18px color-mix(in srgb, var(--fg) 16%, transparent); }
    .dt-menu[hidden] { display: none; }
    .dt-menu-item { font: inherit; font-size: 0.9rem; text-align: left; background: none; border: 0; padding: 7px 10px; border-radius: 4px; color: var(--fg); cursor: pointer; white-space: nowrap; }
    .dt-menu-item:hover, .dt-menu-item:focus { background: var(--surface-2); outline: none; }
    .dt-menu-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .dt-menu-item.dt-danger { color: var(--danger); }
  `);

  /** "⋯" 메뉴: 버튼(aria-haspopup) + role=menu. 화살표·Home·End로 이동, Esc로 닫고 버튼으로 돌아간다. */
  function moreMenu(id, items, label) {
    const btn = h("button", { type: "button", id, class: "rn-btn rn-ghost dt-menu-btn", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": id + "-menu", "aria-label": label || "더 보기", title: label || "더 보기" }, "⋯");
    const menu = h("div", { class: "dt-menu", role: "menu", id: id + "-menu", "aria-labelledby": id, hidden: true });
    const els = items.filter(Boolean).map((it) => h("button", { type: "button", role: "menuitem", id: it.id || null, tabIndex: -1,
      class: "dt-menu-item" + (it.danger ? " dt-danger" : ""), onclick: () => { close(true); it.onSelect(); } }, it.label));
    menu.append(...els);
    const wrap = h("div", { class: "dt-menu-wrap" }, btn, menu);
    function outside(e) {
      if (!wrap.isConnected) { document.removeEventListener("pointerdown", outside, true); return; }
      if (!wrap.contains(e.target)) close(false);
    }
    function open(last) {
      menu.hidden = false; btn.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", outside, true);
      if (els.length) els[last ? els.length - 1 : 0].focus();
    }
    function close(refocus) {
      if (menu.hidden) return;
      menu.hidden = true; btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", outside, true);
      if (refocus) btn.focus();
    }
    btn.addEventListener("click", () => (menu.hidden ? open() : close(true)));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); open(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); open(true); }
      else if (e.key === "Escape") close(true);
    });
    menu.addEventListener("keydown", (e) => {
      const i = els.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); els[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); els[els.length - 1].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === "Tab") close(false);
    });
    return wrap;
  }
  const stepLabel = (n, text) => h("span", { class: "dt-step" }, h("span", { class: "dt-step-num", "aria-hidden": "true" }, String(n)), text);

  const TYPE_LABEL = { number: "숫자", date: "날짜", string: "문자" };

  /** 프로젝트의 데이터셋을 구독한다. cb({ items, loading, error }) — 해제 함수를 돌려준다 */
  function watchDatasets(projectId, cb) {
    const coll = RN.userColl ? RN.userColl("datasets") : null;
    if (!coll) { cb({ items: [], loading: false, error: "signed_out" }); return () => {}; }
    let done = false;
    const timer = setTimeout(() => { if (!done) cb({ items: [], loading: false, error: "timeout" }); }, 10000);
    let off = () => {};
    try {
      off = coll.where("projectId", "==", projectId).onSnapshot(
        (snap) => {
          done = true; clearTimeout(timer);
          const items = snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          cb({ items, loading: false, error: null });
        },
        (err) => { done = true; clearTimeout(timer); cb({ items: [], loading: false, error: (err && err.code) || "error" }); },
      );
    } catch (e) { clearTimeout(timer); cb({ items: [], loading: false, error: "error" }); }
    return () => { clearTimeout(timer); try { off(); } catch { /* 무시 */ } };
  }
  const loadErrorText = (code) => code === "signed_out" ? "로그인하면 데이터를 올리고 볼 수 있어요." : code === "timeout" ? "데이터를 불러오지 못했어요(시간 초과). 새로고침해 보세요." : "데이터를 불러오지 못했어요.";

  async function saveDataset(projectId, fileName, parsed) {
    const coll = RN.userColl("datasets");
    const raw = {
      projectId, name: fileName.replace(/\.(csv|txt|tsv)$/i, "") || "데이터",
      columns: parsed.columns, rows: parsed.rows, rowCount: parsed.rows.length,
      originalRowCount: parsed.rows.length, encoding: parsed.encoding, createdAt: Date.now(),
    };
    const fit = fitDataset(raw);
    const id = RN.newId();
    await coll.doc(id).set(fit.doc);
    return { id, doc: fit.doc, truncated: fit.truncated };
  }

  /** 열 정보 한 줄: "열: 시간(s) 숫자 · 진폭 숫자(mm) · 온도 숫자, 빈 칸 1 · 비고 문자" */
  function columnLine(columns) {
    return h("p", { class: "dt-cols" }, "열: ", columns.map((c) =>
      `${c.name} ${TYPE_LABEL[c.type] || c.type}${c.unit ? `(${c.unit})` : ""}${c.missing ? `, 빈 칸 ${c.missing}` : ""}`).join(" · "));
  }
  function previewTable(ds, max = 20) {
    const cols = ds.columns || [];
    return h("div", { class: "rn-table-wrap dt-preview" },
      h("table", { class: "rn-table" },
        h("caption", { class: "rn-small rn-muted", style: { textAlign: "left", captionSide: "top" } }, `앞 ${Math.min(max, (ds.rows || []).length)}행 (전체 ${ds.rowCount}행)`),
        h("thead", {}, h("tr", {}, cols.map((c) => h("th", { scope: "col" }, c.name)))),
        h("tbody", {}, (ds.rows || []).slice(0, max).map((r) => h("tr", {}, cols.map((_, i) => h("td", {}, r[i] === "" ? "—" : r[i])))))));
  }

  // =====================================================================
  // 7. 프로젝트 홈 섹션 "데이터": CSV 올리기 버튼 하나 + 데이터셋 목록
  // =====================================================================
  function mountSection(container, project) {
    const pid = project && (project.id || project.projectId);
    const blocked = RN.writeBlockedReason();
    const status = h("div", { class: "rn-stack", id: "data-upload-status", "aria-live": "polite" });
    const list = h("ul", { class: "dt-dslist", id: "data-ds-list" });
    const listState = h("div", {});
    const fileInput = h("input", { type: "file", id: "data-csv-file", accept: ".csv,text/csv,.txt", disabled: !!blocked });
    container.append(h("div", { class: "rn-stack", role: "region", "aria-label": "데이터" },
      blocked ? RN.notice(blocked, "warn") : h("div", { class: "rn-row rn-between" },
        h("p", { class: "rn-small rn-muted" }, "CSV(UTF-8·한글 CP949) · 나만 볼 수 있어요"),
        h("span", { class: "dt-upload" }, fileInput, h("label", { for: "data-csv-file", class: "rn-btn rn-primary" }, "CSV 올리기"))),
      status, listState, list));

    const open = new Set();
    const toggles = new Map();
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      status.replaceChildren(RN.notice("CSV를 읽는 중…"));
      try {
        if (file.size > 30 * 1024 * 1024) throw new Error("파일이 너무 커요(30MB까지).");
        const parsed = parseCsv(new Uint8Array(await file.arrayBuffer()));
        if (!parsed.columns.length) throw new Error("열을 찾지 못했어요.");
        const saved = await saveDataset(pid, file.name, parsed);
        const msgs = [...parsed.warnings];
        if (saved.truncated) msgs.push(`저장 한도를 넘어 전체 ${parsed.rows.length.toLocaleString("ko-KR")}행 중 앞 ${saved.doc.rows.length.toLocaleString("ko-KR")}행만 저장했어요.`);
        // 방금 올린 데이터는 미리보기를 펼쳐 둔다(목록이 이미 그려졌으면 그 항목을 연다)
        const t = toggles.get(saved.id);
        if (t) { if (t.getAttribute("aria-expanded") !== "true") t.click(); } else open.add(saved.id);
        status.replaceChildren(
          h("p", { role: "status", class: "rn-small" }, `"${saved.doc.name}"을(를) 저장했어요 · ${parsed.encoding === "euc-kr" ? "CP949" : "UTF-8"}로 읽음`),
          ...msgs.map((m) => RN.notice(m, "warn")));
        RN.toast(saved.truncated ? "데이터가 커서 앞쪽 행만 저장했어요." : "데이터를 저장했어요.");
      } catch (e) {
        status.replaceChildren(RN.notice("CSV를 읽지 못했어요: " + ((e && e.message) || e), "error"));
      } finally { fileInput.value = ""; }
    });

    listState.append(RN.notice("데이터 목록을 불러오는 중…"));
    const off = watchDatasets(pid, ({ items, error }) => {
      listState.replaceChildren(error ? RN.notice(loadErrorText(error), error === "signed_out" ? null : "error") : !items.length ? RN.notice("아직 올린 데이터가 없어요.") : "");
      toggles.clear();
      list.replaceChildren(...items.map((ds) => {
        const body = h("div", { class: "rn-stack", id: "data-ds-body-" + ds.id, hidden: !open.has(ds.id) });
        const fill = () => { if (!body.childNodes.length) body.append(columnLine(ds.columns || []), previewTable(ds)); };
        if (open.has(ds.id)) fill();
        const toggle = h("button", { type: "button", class: "rn-btn rn-ghost rn-small", "aria-expanded": String(open.has(ds.id)), "aria-controls": body.id, onclick: () => {
          const on = !open.has(ds.id);
          if (on) open.add(ds.id); else open.delete(ds.id);
          toggle.setAttribute("aria-expanded", String(on));
          toggle.textContent = on ? "접기" : "미리보기";
          body.hidden = !on;
          if (on) fill();
        } }, open.has(ds.id) ? "접기" : "미리보기");
        toggles.set(ds.id, toggle);
        const cut = ds.originalRowCount && ds.originalRowCount > ds.rowCount;
        const menu = blocked ? null : moreMenu("data-ds-more-" + ds.id, [{ label: "삭제", danger: true, onSelect: async () => {
          if (!(await RN.confirm(`"${ds.name}" 데이터를 지울까요? 문서에 넣은 표·그래프는 남아요.`, { okLabel: "지우기", danger: true }))) return;
          try { await RN.userColl("datasets").doc(ds.id).delete(); RN.toast("데이터를 지웠어요."); }
          catch (e) { RN.toast("지우지 못했어요.", "error"); }
        } }], `${ds.name} 메뉴`);
        return h("li", { class: "dt-ds", dataset: { id: ds.id } },
          h("div", { class: "dt-ds-head" },
            h("div", { class: "dt-ds-name" }, h("strong", {}, ds.name),
              h("span", { class: "rn-small rn-muted" }, `${ds.rowCount}행 · ${(ds.columns || []).length}열 · ${RN.fmtDate(ds.createdAt)}`,
                cut ? h("span", { class: "dt-warn" }, ` · 원본 ${ds.originalRowCount}행 중 일부`) : null)),
            toggle, menu),
          body);
      }));
    });
    return off;
  }

  // =====================================================================
  // 8. 에디터 패널 "데이터": 표·그래프 만들기
  // =====================================================================
  const RECENT_KEY = (docId) => "data-recent:" + (docId || "none");
  let activePanel = null; // { editChart(meta) }

  function mountPanel(container, editorApi) {
    const api = () => editorApi || RN.editor;
    const ed = api() || {};
    const pid = ed.projectId;
    let datasets = [], current = null, mode = RN.local.get("data-panel-mode", "chart");
    if (mode !== "table" && mode !== "chart") mode = "chart";
    let chartCfg = null, editingIndex = null;
    let insertFn = null; // 지금 고른 쪽(표·그래프)의 "문서에 넣기"
    const moreOpen = { table: false, chart: false };

    // ① 데이터셋 ② 표/그래프 ③ 설정 → 미리보기(항상) → 문서에 넣기(주 버튼 하나)
    const dsSelect = h("select", { id: "data-ds-select" });
    const dsState = h("div", {});
    const tabTable = h("button", { type: "button", class: "rn-btn", id: "data-tab-table", "aria-pressed": "false", onclick: () => setMode("table") }, "표");
    const tabChart = h("button", { type: "button", class: "rn-btn", id: "data-tab-chart", "aria-pressed": "false", onclick: () => setMode("chart") }, "그래프");
    const body = h("div", { class: "rn-stack" });
    const previewBox = h("div", { class: "rn-stack", id: "data-preview" });
    const infoBox = h("div", { class: "rn-stack", "aria-live": "polite" });
    const insertBtn = h("button", { type: "button", class: "rn-btn rn-primary", id: "data-insert", onclick: () => { if (insertFn) insertFn(); } }, "문서에 넣기");
    const steps = h("div", { class: "rn-stack", hidden: true },
      h("div", { class: "rn-stack", style: { gap: "6px" } }, h("span", { id: "data-step2" }, stepLabel(2, "만들기")),
        h("div", { class: "dt-tabs", role: "group", "aria-labelledby": "data-step2" }, tabTable, tabChart)),
      h("div", { class: "rn-stack", style: { gap: "8px" } }, stepLabel(3, "설정"), body),
      previewBox, infoBox,
      h("div", { class: "rn-row rn-end" }, insertBtn));
    const recentBox = h("div", {});
    container.append(h("div", { class: "rn-stack" },
      h("div", { class: "rn-field" }, h("label", { for: "data-ds-select" }, stepLabel(1, "데이터")), dsSelect),
      dsState, steps, recentBox));

    function setMode(m) {
      mode = m; RN.local.set("data-panel-mode", m);
      editingIndex = null;
      draw();
    }
    dsSelect.addEventListener("change", () => { editingIndex = null; selectDataset(dsSelect.value); });
    function selectDataset(id, cfg) {
      current = datasets.find((d) => d.id === id) || null;
      chartCfg = current ? (cfg ? normalizeConfig(cfg) : defaultChartConfig(current.columns || [])) : null;
      if (current && dsSelect.value !== current.id) dsSelect.value = current.id;
      draw();
    }

    const off = watchDatasets(pid, ({ items, error }) => {
      datasets = items;
      dsState.replaceChildren(error ? RN.notice(loadErrorText(error), error === "signed_out" ? null : "error") : !items.length ? RN.notice("프로젝트 홈의 '데이터' 탭에서 CSV를 먼저 올려 주세요.") : "");
      dsSelect.disabled = !items.length;
      const keep = current && items.find((d) => d.id === current.id);
      dsSelect.replaceChildren(...(items.length ? items : [{ id: "", name: "데이터 없음" }]).map((d) => h("option", { value: d.id }, d.id ? `${d.name} (${d.rowCount}행)` : d.name)));
      if (keep) { current = keep; dsSelect.value = keep.id; draw(); }
      else selectDataset(items[0] ? items[0].id : "");
    });

    const moreDetails = (key, id, ...children) => {
      const d = h("details", { class: "dt-more", id, open: moreOpen[key] }, h("summary", {}, "자세히"), h("div", { class: "rn-stack" }, children));
      d.addEventListener("toggle", () => { moreOpen[key] = d.open; });
      return d;
    };

    // ---------- 표 ----------
    function drawTable() {
      const cols = current.columns || [];
      const checks = [], heads = [], units = [];
      const pick = h("div", { class: "dt-colpick", role: "group", "aria-label": "넣을 열" });
      const names = h("div", { class: "dt-colopts" }, h("span", { class: "rn-small rn-muted" }, "머리글"), h("span", { class: "rn-small rn-muted" }, "단위"));
      cols.forEach((c, i) => {
        const cb = h("input", { type: "checkbox", id: `data-tbl-c-${i}`, checked: true });
        const hd = h("input", { type: "text", id: `data-tbl-h-${i}`, value: c.name, "aria-label": `${c.name} 머리글` });
        const un = h("input", { type: "text", id: `data-tbl-u-${i}`, value: c.unit || "", "aria-label": `${c.name} 단위` });
        checks.push(cb); heads.push(hd); units.push(un);
        pick.append(h("label", { class: "dt-check", for: cb.id }, cb, clip(c.name, 16)));
        names.append(hd, un);
      });
      const dec = h("select", { id: "data-tbl-dec" }, h("option", { value: "" }, "원본 그대로"), [0, 1, 2, 3, 4].map((d) => h("option", { value: String(d) }, `${d}자리`)));
      const headerRow = h("input", { type: "checkbox", id: "data-tbl-header", checked: true });
      const caption = h("input", { type: "text", id: "data-tbl-caption", value: current.name || "" });
      const opts = () => ({
        columns: cols.map((c, i) => ({ index: i, header: heads[i].value, unit: units[i].value, on: checks[i].checked })).filter((c) => c.on),
        decimals: dec.value === "" ? null : Number(dec.value), headerRow: headerRow.checked,
      });
      const refresh = () => {
        const o = opts();
        infoBox.replaceChildren();
        if (!o.columns.length) { previewBox.replaceChildren(RN.notice("열을 하나 이상 고르세요.", "warn")); return; }
        const g = buildTableGrid(cols, current.rows || [], o, 6);
        previewBox.replaceChildren(h("div", { class: "rn-table-wrap", id: "data-tbl-preview" }, h("table", { class: "rn-table" },
          o.headerRow ? h("thead", {}, h("tr", {}, g.header.map((x) => h("th", { scope: "col" }, x)))) : null,
          h("tbody", {}, o.headerRow ? null : h("tr", {}, g.header.map((x) => h("td", {}, x))), g.body.map((r) => h("tr", {}, r.map((x) => h("td", {}, x))))))),
          h("p", { class: "rn-small rn-muted" }, `미리보기 앞 6행 · 넣을 때 최대 ${MAX_TABLE_ROWS}행`));
      };
      [...checks, ...heads, ...units, dec, headerRow].forEach((el) => el.addEventListener(el.tagName === "INPUT" && el.type === "text" ? "input" : "change", refresh));
      insertFn = () => {
        const e = api();
        if (!e || typeof e.insertTable !== "function") { RN.toast("문서를 연 뒤에 넣을 수 있어요.", "error"); return; }
        try {
          const args = tableInsertArgs(cols, current.rows || [], opts(), caption.value.trim());
          e.insertTable(args);
          RN.toast((current.rows || []).length > MAX_TABLE_ROWS ? `앞 ${MAX_TABLE_ROWS}행으로 표를 넣었어요.` : "표를 넣었어요.");
        } catch (err) { RN.toast((err && err.message) || "표를 넣지 못했어요.", "error"); }
      };
      body.replaceChildren(
        pick,
        moreDetails("table", "data-tbl-more",
          RN.field("표 캡션", caption),
          h("div", { class: "dt-two" }, RN.field("소수 자릿수", dec), h("label", { class: "dt-check", for: headerRow.id }, headerRow, "첫 행을 머리글로")),
          names));
      refresh();
    }

    // ---------- 그래프 ----------
    function drawChart() {
      const cols = current.columns || [];
      const cfg = chartCfg;
      const opt = (sel, value, label) => h("option", { value, selected: sel === value }, label);
      const type = h("select", { id: "data-ch-type" }, CHART_TYPES.map((t) => opt(cfg.type, t, CHART_LABELS[t])));
      const colOptions = (sel, allowNone, onlyNum) => [allowNone ? opt(sel || "", "", "(없음)") : null,
        ...cols.filter((c) => !onlyNum || c.type === "number").map((c) => opt(sel || "", c.name, `${c.name} · ${TYPE_LABEL[c.type]}`))];
      const uses = chartUses(cfg.type);
      const xLabel = cfg.type === "histogram" ? "값 열" : cfg.type === "box" ? "묶음 열(선택)" : "X 열";
      const x = h("select", { id: "data-ch-x" }, colOptions(cfg.x, cfg.type === "box", cfg.type === "histogram"));
      const y = h("select", { id: "data-ch-y" }, colOptions(cfg.y, false, true));
      const err = h("select", { id: "data-ch-err" }, colOptions(cfg.error, true, true));
      const xT = h("input", { type: "text", id: "data-ch-xtitle", value: cfg.xTitle, placeholder: cfg.x || "" });
      const xU = h("input", { type: "text", id: "data-ch-xunit", value: cfg.xUnit });
      const yT = h("input", { type: "text", id: "data-ch-ytitle", value: cfg.yTitle, placeholder: cfg.type === "histogram" ? "빈도" : cfg.y || "" });
      const yU = h("input", { type: "text", id: "data-ch-yunit", value: cfg.yUnit });
      const logX = h("input", { type: "checkbox", id: "data-ch-logx", checked: cfg.logX });
      const logY = h("input", { type: "checkbox", id: "data-ch-logy", checked: cfg.logY });
      const trend = h("input", { type: "checkbox", id: "data-ch-trend", checked: cfg.trendline });
      const bins = h("input", { type: "number", id: "data-ch-bins", min: 1, max: 200, value: cfg.bins || "", placeholder: "자동" });
      const caption = h("input", { type: "text", id: "data-ch-caption", value: chartCaption(cfg) });
      let captionTouched = false;
      caption.addEventListener("input", () => { captionTouched = true; });
      const preview = h("div", { class: "dt-chart", id: "data-ch-preview" });
      let lastResult = null;
      const read = () => normalizeConfig({
        type: type.value, x: x.value || null, y: y.value || null, error: uses.error ? err.value || null : null,
        xTitle: xT.value, yTitle: yT.value, xUnit: xU.value, yUnit: yU.value,
        logX: uses.logX && logX.checked, logY: cfg.type !== "histogram" && logY.checked, trendline: uses.trendline && trend.checked,
        bins: bins.value ? Math.round(Number(bins.value)) : null,
      });
      const render = () => {
        chartCfg = read();
        if (!captionTouched) caption.value = chartCaption(chartCfg);
        lastResult = renderChartSvg(chartCfg, cols, current.rows || [], { title: caption.value });
        if (!lastResult.ok) { preview.replaceChildren(RN.notice(lastResult.error, "error")); infoBox.replaceChildren(); return; }
        preview.innerHTML = lastResult.svg; // 직접 만든 SVG: 모든 글자는 esc()로 이스케이프했다
        const r = lastResult.regression;
        infoBox.replaceChildren(
          h("p", { class: "rn-small rn-muted" }, `점·값 ${lastResult.n}개`,
            r ? h("span", { id: "data-ch-reg" }, ` · 추세선 ${trendLabel(r)} (코드로 계산)`) : null),
          ...lastResult.warnings.map((w) => h("p", { class: "dt-warn" }, w)));
      };
      [x, y, err, logX, logY, trend].forEach((el) => el.addEventListener("change", () => {
        if (el === x || el === y) {
          const c = cols.find((k) => k.name === el.value);
          if (el === x && cfg.type !== "box") xU.value = (c && c.unit) || "";
          if (el === y) yU.value = (c && c.unit) || "";
        }
        render();
      }));
      [xT, xU, yT, yU, bins].forEach((el) => el.addEventListener("input", render));
      caption.addEventListener("change", render);
      type.addEventListener("change", () => {
        const t = type.value;
        const next = read(); next.type = t;
        if (t === "histogram") { const xc = cols.find((c) => c.name === next.x); if (!xc || xc.type !== "number") next.x = next.y; next.xUnit = ((cols.find((c) => c.name === next.x) || {}).unit) || ""; next.yUnit = ""; }
        if (t === "box") { next.x = null; next.xUnit = ""; }
        if (cfg.type === "box" && t !== "box") { const d = defaultChartConfig(cols, t); next.x = d.x; next.xUnit = d.xUnit; }
        chartCfg = normalizeConfig(next); drawChart();
        const again = document.getElementById("data-ch-type"); if (again) again.focus();
      });

      insertFn = () => {
        const e = api();
        if (!e || typeof e.insertFigure !== "function") { RN.toast("문서를 연 뒤에 넣을 수 있어요.", "error"); return; }
        render();
        if (!lastResult || !lastResult.ok) { RN.toast("그래프 설정을 확인하세요.", "error"); return; }
        const meta = { kind: "chart", datasetId: current.id, datasetName: current.name, chart: chartCfg };
        try {
          e.insertFigure({ svg: lastResult.svg, caption: caption.value.trim(), meta });
          remember(meta, caption.value.trim());
          RN.toast("그래프를 넣었어요.");
        } catch (er) { RN.toast("그래프를 넣지 못했어요.", "error"); }
      };

      const suggestOut = h("div", { class: "rn-stack", "aria-live": "polite" });
      const suggestBtn = RN.caps.sample ? h("button", { type: "button", class: "rn-link rn-small", id: "data-ch-suggest", onclick: () => suggest(suggestBtn, suggestOut) }, "알맞은 그래프 추천받기") : null;
      body.replaceChildren(
        editingIndex != null ? RN.notice("넣었던 그래프 설정을 불러왔어요. 넣으면 새 그림으로 들어가요.", "warn") : null,
        h("div", { class: "dt-two" },
          RN.field("그래프 유형", type),
          RN.field(xLabel, x),
          cfg.type !== "histogram" ? RN.field(cfg.type === "box" ? "값 열" : "Y 열", y) : null),
        suggestBtn ? h("div", { class: "rn-row" }, suggestBtn) : null, suggestOut,
        moreDetails("chart", "data-ch-more",
          h("div", { class: "dt-two" },
            uses.error ? RN.field("오차막대 열", err) : null,
            uses.bins ? RN.field("구간 수", bins, "비우면 자동") : null,
            RN.field("X축 제목", xT), cfg.type !== "box" ? RN.field("X축 단위", xU) : null,
            RN.field("Y축 제목", yT), RN.field("Y축 단위", yU)),
          h("div", { class: "rn-row" },
            uses.logX ? h("label", { class: "dt-check", for: logX.id }, logX, "X 로그 축") : null,
            cfg.type !== "histogram" ? h("label", { class: "dt-check", for: logY.id }, logY, "Y 로그 축") : null,
            uses.trendline ? h("label", { class: "dt-check", for: trend.id }, trend, "추세선(선형 회귀 + R²)") : null),
          RN.field("그림 캡션", caption)));
      previewBox.replaceChildren(preview);
      render();
    }

    async function suggest(btn, out) {
      const sample = RN.caps.sample;
      if (!sample || !current) return;
      btn.disabled = true;
      out.replaceChildren(RN.notice("추천을 받는 중… (열 이름과 종류만 보내요)"));
      try {
        const cols = current.columns || [];
        const res = await sample.json(suggestPrompt(cols), { modelTier: "quick" });
        const list = Array.isArray(res) ? res : res && Array.isArray(res.suggestions) ? res.suggestions : res && res.chartType ? [res] : [];
        let applied = null;
        for (const s of list) { const c = configFromSuggestion(chartCfg || defaultChartConfig(cols), s, cols); if (c) { applied = { c, s }; break; } }
        if (!applied) { out.replaceChildren(RN.notice("이 데이터에 맞는 추천을 받지 못했어요. 직접 골라 주세요.", "warn")); return; }
        chartCfg = applied.c;
        drawChart();
        const again = body.querySelector("#data-ch-suggest");
        if (again) again.parentElement.after(h("p", { class: "rn-small", id: "data-ch-reason" },
          `추천: ${CHART_LABELS[applied.c.type]}${typeof applied.s.reason === "string" && applied.s.reason ? " — " + applied.s.reason.slice(0, 200) : ""}`));
      } catch (e) {
        const code = e && e.code;
        out.replaceChildren(RN.notice(code === "rate_limited" ? "요청이 많아요. 잠시 뒤에 다시 눌러 주세요." : code === "cancelled" ? "추천을 멈췄어요." : "추천을 받지 못했어요. 직접 골라 주세요.", "warn"));
      } finally { if (btn.isConnected) btn.disabled = false; }
    }

    // ---------- 최근 넣은 그래프 (설정 다시 편집) — 작게 접어 둔다 ----------
    function remember(meta, caption) {
      const key = RECENT_KEY(ed.docId);
      const list = RN.local.get(key, []).filter((m) => m && m.chart);
      list.unshift({ datasetId: meta.datasetId, datasetName: meta.datasetName, chart: meta.chart, caption, at: Date.now() });
      RN.local.set(key, list.slice(0, 8));
      editingIndex = null;
      drawRecent();
    }
    let recentOpen = false;
    function drawRecent() {
      const list = RN.local.get(RECENT_KEY(ed.docId), []).filter((m) => m && m.chart);
      if (!list.length) { recentBox.replaceChildren(); return; }
      const d = h("details", { class: "dt-more", id: "data-recent", open: recentOpen }, h("summary", {}, `최근 넣은 그래프 (${list.length})`),
        h("ul", { class: "dt-list" }, list.map((m, i) => h("li", { class: "rn-row rn-between" },
          h("span", { class: "rn-small" }, `${m.caption || CHART_LABELS[m.chart.type]} · ${m.datasetName || ""}`),
          h("button", { type: "button", class: "rn-btn rn-ghost rn-small", onclick: () => editChart(m, i) }, "다시 편집")))));
      d.addEventListener("toggle", () => { recentOpen = d.open; });
      recentBox.replaceChildren(d);
    }
    function editChart(meta, index) {
      if (!meta || !meta.chart) return false;
      const ds = datasets.find((d) => d.id === meta.datasetId);
      if (!ds) { RN.toast("이 그래프의 원본 데이터를 찾지 못했어요(지웠거나 다른 프로젝트).", "error"); return false; }
      editingIndex = index == null ? -1 : index;
      mode = "chart";
      selectDataset(ds.id, meta.chart);
      return true;
    }

    function draw() {
      tabTable.setAttribute("aria-pressed", String(mode === "table"));
      tabChart.setAttribute("aria-pressed", String(mode === "chart"));
      steps.hidden = !current;
      insertFn = null;
      if (!current) { body.replaceChildren(); previewBox.replaceChildren(); infoBox.replaceChildren(); return; }
      if (mode === "table") drawTable(); else drawChart();
    }
    drawRecent();
    const me = { editChart: (meta) => editChart(meta) };
    activePanel = me;
    return () => { off(); if (activePanel === me) activePanel = null; };
  }

  /** 에디터가 그림(meta.kind === "chart")을 더블클릭했을 때 부를 수 있다: RN.data.editFigure(meta) → 패널이 열려 있으면 true */
  RN.data = { editFigure: (meta) => (activePanel ? activePanel.editChart(meta) : false) };

  RN.projectSections = RN.projectSections || [];
  RN.projectSections.push({ id: "data", label: "데이터", mount: mountSection });
  RN.editorPanels = RN.editorPanels || [];
  RN.editorPanels.push({ id: "data", label: "데이터", mount: mountPanel });
})();
