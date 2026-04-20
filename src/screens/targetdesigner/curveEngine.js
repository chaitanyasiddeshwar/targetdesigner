'use strict';

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const log10 = (x) => Math.log(x) / Math.LN10;
export const pow10 = (x) => Math.pow(10, x);

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function getTransitionFactor(type, val, start, end) {
  const t = clamp((val - start) / (end - start), 0, 1);
  if (type === 'linear') return t;
  if (type === 'steep') return t * t * t * (t * (t * 6 - 15) + 10);
  return t * t * (3 - 2 * t);
}

export function fmtAxisHz(f) {
  if (f >= 10000) return Math.round(f / 1000) + 'k';
  if (f >= 1000) return (Math.round(f / 100) / 10) + 'k';
  return Math.round(f).toString();
}

export function fmtHz(f) {
  if (f >= 1000) return (f / 1000).toFixed(f < 10000 ? 2 : 1) + ' kHz';
  return f.toFixed(f < 10 ? 2 : (f < 100 ? 1 : 0)) + ' Hz';
}

export function fmtDb(x) {
  return (x >= 0 ? '+' : '') + x.toFixed(1) + ' dB';
}

export const COLOR_PALETTE = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export function defaultParams() {
  return {
    level: 75,
    pivot: 1000,
    tilt: 0,
    tiltLow: 0,
    tiltHigh: 0,
    hpFreq: 10,
    hpSlope: 0,
    hpType: 'soft',
    hpKneeOct: 2.5,
    lpFreq: 24000,
    lpSlope: 0,
    lpType: 'soft',
    lpRoundness: 0.6,
    lfGain: 0,
    lfStart: 100,
    lfEnd: 200,
    lfType: 'soft',
    warmthGain: 0,
    warmthFreq: 500,
    warmthQ: 1,
    hfShelfGain: 0,
    hfShelfStart: 6000,
    hfType: 'soft',
  };
}

export function newTarget(name = 'Target 1', index = 0) {
  return {
    name,
    color: COLOR_PALETTE[index % COLOR_PALETTE.length],
    templateName: 'Flat',
    templatePts: null,
    params: defaultParams(),
    peqs: [],
  };
}

export function interpLog(pts, f) {
  const n = pts.length;
  if (n === 0) return NaN;
  if (f <= pts[0].f) return pts[0].val;
  if (f >= pts[n - 1].f) return pts[n - 1].val;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].f <= f) lo = mid;
    else hi = mid;
  }
  const f1 = pts[lo].f;
  const f2 = pts[hi].f;
  const t = (log10(f) - log10(f1)) / (log10(f2) - log10(f1));
  return lerp(pts[lo].val, pts[hi].val, t);
}

export function makeGrid(resKind) {
  const fMin = 3;
  const fMax = 24000;
  const out = [];
  if (resKind === '1hz') {
    for (let f = fMin; f <= fMax; f++) out.push(f);
    return out;
  }
  const perOct = resKind === '1/24' ? 24 : resKind === '1/12' ? 12 : 6;
  const start = log10(fMin);
  const end = log10(fMax);
  const step = (1 / perOct) * log10(2);
  for (let x = start; x <= end + 1e-12; x += step) out.push(pow10(x));
  return out;
}

export function parseREWText(text) {
  const lines = text.split(/\r?\n/);
  const pts = [];
  for (const line0 of lines) {
    const line = line0.trim();
    if (!line) continue;
    const nums = line.match(/[-+]?\d+(?:[.,]\d+)?/g);
    if (!nums || nums.length < 2) continue;
    const f = parseFloat(nums[0].replace(',', '.'));
    const spl = parseFloat(nums[1].replace(',', '.'));
    if (Number.isFinite(f) && Number.isFinite(spl)) pts.push({ f, spl });
  }
  pts.sort((a, b) => a.f - b.f);
  const out = [];
  let last = -Infinity;
  for (const p of pts) {
    if (p.f > last) {
      out.push(p);
      last = p.f;
    }
  }
  return out;
}

export function bellGain(f, f0, gain, Q) {
  const x = Math.log2(f / f0);
  const bw = 1 / (Q || 1e-6);
  const sigma = (bw / 2.355) || 1e-6;
  return gain * Math.exp(-0.5 * (x / sigma) * (x / sigma));
}

export function computeTargetAt(f, t) {
  const p = t.params;
  let y = p.level;

  const oct = Math.log2(f / p.pivot);
  const w = smoothstep(-1.5, 1.5, oct);
  const tiltLH = lerp(p.tiltLow, p.tiltHigh, w);
  y += (p.tilt + tiltLH) * oct;

  if (f < p.hpFreq) {
    const octDiff = Math.log2(p.hpFreq / f);
    if (p.hpType === 'soft') {
      // Smooth knee with configurable width and C1 continuity at the knee end.
      // For x=octDiff/knee in [0,1]: A = slope*knee*x^2*(2-x), then linear beyond.
      const knee = Math.max(0.1, Number(p.hpKneeOct ?? 2.5));
      if (octDiff < knee) {
        const x = clamp(octDiff / knee, 0, 1);
        y -= p.hpSlope * knee * x * x * (2 - x);
      } else {
        y -= p.hpSlope * octDiff;
      }
    } else {
      y -= p.hpSlope * octDiff;
    }
  }

  if (f > p.lpFreq) {
    const octDiff = Math.log2(f / p.lpFreq);
    if (p.lpType === 'soft') {
      const blendOct = lerp(0.2, 2.0, clamp(p.lpRoundness ?? 0.6, 0, 1));
      const x = Math.min(octDiff, blendOct);
      const t2 = x / blendOct;
      const y1 = p.lpSlope * blendOct;
      const h01 = -2 * t2 * t2 * t2 + 3 * t2 * t2;
      const h11 = t2 * t2 * t2 - t2 * t2;
      const attBlend = h01 * y1 + h11 * (p.lpSlope * blendOct);
      const attTotal = attBlend + (octDiff - x) * p.lpSlope;
      y -= attTotal;
    } else {
      y -= p.lpSlope * octDiff;
    }
  }

  const lfW = getTransitionFactor(p.lfType || 'soft', log10(f), log10(p.lfStart), log10(p.lfEnd));
  y += p.lfGain * (1 - lfW);

  y += bellGain(f, p.warmthFreq, p.warmthGain, p.warmthQ);

  if (f > p.hfShelfStart) {
    const startOct = Math.log2(p.hfShelfStart);
    const currentOct = Math.log2(f);
    const endOct = startOct + 1.5;
    const hfW = getTransitionFactor(p.hfType || 'soft', currentOct, startOct, endOct);
    y += p.hfShelfGain * hfW;
  }

  if (t.templatePts) y += interpLog(t.templatePts, f);
  for (const q of t.peqs) if (q.enabled) y += bellGain(f, q.f, q.g, q.q);

  return y;
}

export function buildTargetSeries(target) {
  const grid = makeGrid('1/24');
  return grid.map((f) => ({ f, y: computeTargetAt(f, target) }));
}

export function getInteractiveHandles(target) {
  if (!target) return [];
  const p = target.params;
  const bassAnchorY = computeTargetAt(Math.max(3, p.lfEnd), target);
  const highAnchorY = computeTargetAt(Math.max(3, p.hfShelfStart), target);
  const TILT_HANDLE_BASE_OFFSET_DB = 5.6;
  const TILT_HANDLE_SENSITIVITY_DB = 1.25;
  const VIEW_MAX_HANDLE_FREQ = 24000;
  const handles = [
    { id: 'global-pivot', type: 'global', label: 'Global Pivot', f: p.pivot, y: p.level },
    {
      id: 'global-tilt',
      type: 'tilt-global',
      label: 'Global Tilt',
      f: Math.min(8000, p.pivot * 1.22),
      y: p.level - TILT_HANDLE_BASE_OFFSET_DB + p.tilt * TILT_HANDLE_SENSITIVITY_DB,
    },
    { id: 'bass-main', type: 'bass', label: 'Bass', f: p.lfStart },
    { id: 'bass-end', type: 'bass-end', label: 'Bass End', f: p.lfEnd },
    {
      id: 'bass-tilt',
      type: 'tilt-bass',
      label: 'Bass Tilt',
      f: p.lfEnd,
      y: bassAnchorY - TILT_HANDLE_BASE_OFFSET_DB + p.tiltLow * TILT_HANDLE_SENSITIVITY_DB,
    },
    { id: 'mid-main', type: 'mid', label: 'Mid', f: p.warmthFreq },
    { id: 'high-main', type: 'high', label: 'High', f: p.hfShelfStart },
    {
      id: 'high-tilt',
      type: 'tilt-high',
      label: 'High Tilt',
      f: p.hfShelfStart,
      y: highAnchorY - TILT_HANDLE_BASE_OFFSET_DB + p.tiltHigh * TILT_HANDLE_SENSITIVITY_DB,
    },
    { id: 'hp-limit', type: 'hp', label: 'HP', f: p.hpFreq },
    { id: 'lp-limit', type: 'lp', label: 'LP', f: Math.min(p.lpFreq, VIEW_MAX_HANDLE_FREQ) },
  ];

  target.peqs.forEach((peq, index) => {
    handles.push({
      id: `peq-${index}`,
      type: 'peq',
      label: `PEQ ${index + 1}`,
      index,
      f: peq.f,
    });
  });

  return handles.map((h) => ({
    ...h,
    y: Number.isFinite(h.y) ? h.y : computeTargetAt(Math.max(3, h.f), target),
  }));
}

export function generateExportText(target, resolution = '1/24') {
  const grid = makeGrid(resolution);
  let out = '';
  const ref = computeTargetAt(target.params.pivot, target);
  for (const f of grid) out += `${f.toFixed(3)}\t${(computeTargetAt(f, target) - ref).toFixed(3)}\n`;
  return out;
}
