/**
 * 그래프에 쓰는 수치 계산. AI가 아니라 코드로 결정적으로 계산한다 (SPEC 7.3 (e)).
 */

export type Regression = { slope: number; intercept: number; r2: number; n: number };

/** (x, y) 쌍 중 둘 다 유효한 숫자인 것만 남긴다. */
export function pairs(xs: (number | null)[], ys: (number | null)[]): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

/**
 * 최소제곱 선형 회귀 y = slope·x + intercept 와 결정계수 R².
 * 점이 2개 미만이거나 x가 모두 같으면 null.
 */
export function linearRegression(points: [number, number][]): Regression | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  // y가 모두 같으면 직선이 완벽히 맞으므로 R² = 1로 둔다.
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}

export function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

/** 표본 표준편차 (n-1) */
export function stdev(values: number[]) {
  if (values.length < 2) return NaN;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

/** 선형 보간 분위수 (Excel PERCENTILE.INC, numpy 기본과 같은 방식) */
export function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export type BoxStats = {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** 수염 끝 (1.5 IQR 안쪽의 최솟값·최댓값) */
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
};

export function boxStats(values: number[]): BoxStats | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25);
  const median = quantile(s, 0.5);
  const q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const inside = s.filter((v) => v >= lowFence && v <= highFence);
  return {
    min: s[0],
    q1,
    median,
    q3,
    max: s[s.length - 1],
    whiskerLow: inside[0],
    whiskerHigh: inside[inside.length - 1],
    outliers: s.filter((v) => v < lowFence || v > highFence),
  };
}

export type HistogramBin = { start: number; end: number; count: number };

/** 히스토그램 구간. binCount를 주지 않으면 스터지스 공식(1 + log2 n)을 쓴다. */
export function histogram(values: number[], binCount?: number): HistogramBin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const k = Math.max(1, Math.floor(binCount ?? Math.ceil(1 + Math.log2(values.length))));
  if (min === max) return [{ start: min, end: max, count: values.length }];
  const width = (max - min) / k;
  const bins = Array.from({ length: k }, (_, i) => ({ start: min + i * width, end: min + (i + 1) * width, count: 0 }));
  for (const v of values) bins[Math.min(k - 1, Math.floor((v - min) / width))].count += 1;
  return bins;
}

/** 소수 자릿수를 고정해 표시한다 (천 단위 구분 없음). */
export function formatNumber(value: number, decimals: number) {
  return value.toFixed(Math.max(0, Math.min(10, decimals)));
}
