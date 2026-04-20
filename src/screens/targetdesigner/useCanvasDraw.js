import { useCallback } from 'react';
import {
  log10,
  clamp,
  fmtAxisHz,
  fmtHz,
  buildTargetSeries,
  getInteractiveHandles,
} from './curveEngine.js';

const MARGIN_L = 70;
const MARGIN_R = 20;
const MARGIN_T = 20;
const MARGIN_B = 40;

const BANDS = [
  { name: 'Sub bass', a: 3, b: 60, fill: 'rgba(245,158,11,0.06)' },
  { name: 'Bass', a: 60, b: 250, fill: 'rgba(34,197,94,0.06)' },
  { name: 'Low mid', a: 250, b: 500, fill: 'rgba(14,165,233,0.06)' },
  { name: 'Mid', a: 500, b: 2000, fill: 'rgba(99,102,241,0.06)' },
  { name: 'Upper mid', a: 2000, b: 4000, fill: 'rgba(168,85,247,0.06)' },
  { name: 'Presence', a: 4000, b: 6000, fill: 'rgba(236,72,153,0.06)' },
  { name: 'Brilliance', a: 6000, b: 24000, fill: 'rgba(75,85,99,0.06)' },
];

function calcDynXGrid(minF, maxF, widthPx) {
  const minTickSpacingPx = widthPx > 900 ? 32 : widthPx > 650 ? 28 : 24;
  const steps = [
    [3, 10, 100, 1000, 10000],
    [3, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 24000],
    [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500,
      600, 700, 800, 900, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000, 24000,
    ],
  ];

  for (let i = steps.length - 1; i >= 0; i--) {
    const cands = steps[i].filter((f) => f >= minF && f <= maxF);
    if (cands.length < 2) continue;
    let ok = true;
    let lastPx = -1000;
    for (const f of cands) {
      const px = ((log10(f) - log10(minF)) / (log10(maxF) - log10(minF))) * widthPx;
      if (px - lastPx < minTickSpacingPx) {
        ok = false;
        break;
      }
      lastPx = px;
    }
    if (ok) return cands;
  }
  return steps[0];
}

export default function useCanvasDraw() {
  const draw = useCallback((canvas, state) => {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const { view, targets, activeTarget, cursor, selectedHandleId, dragGuide, hoverHandle, showGlobalControl, showCurveControls } = state;

    const xToPx = (f) => {
      const a = log10(view.xMin);
      const b = log10(view.xMax);
      const w = canvas.width - (MARGIN_L + MARGIN_R) * dpr;
      return MARGIN_L * dpr + ((log10(f) - a) / (b - a)) * w;
    };

    const yToPx = (db) => {
      const t = (db - view.yMin) / (view.yMax - view.yMin);
      return canvas.height * (1 - t);
    };

    const l = MARGIN_L * dpr;
    const r = canvas.width - MARGIN_R * dpr;
    const t = MARGIN_T * dpr;
    const b = canvas.height - MARGIN_B * dpr;
    const w = r - l;
    const h = b - t;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(l, t, w, h);
    ctx.clip();
    for (const band of BANDS) {
      const x0 = xToPx(clamp(band.a, view.xMin, view.xMax));
      const x1 = xToPx(clamp(band.b, view.xMin, view.xMax));
      if (x1 <= l || x0 >= r) continue;
      ctx.fillStyle = band.fill;
      ctx.fillRect(x0, t, x1 - x0, h);
      if (x1 - x0 > 40 * dpr) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = `600 ${11 * dpr}px system-ui`;
        ctx.fillText(band.name, x0 + 6 * dpr, t + 16 * dpr);
      }
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(l, t, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1 * dpr;
    const span = view.yMax - view.yMin;
    let step = 10;
    if (span < 10) step = 1;
    else if (span < 30) step = 2;
    else if (span < 60) step = 5;
    const y0 = Math.floor(view.yMin / step) * step;
    for (let y = y0; y <= view.yMax + 1e-9; y += step) {
      const py = yToPx(y);
      ctx.beginPath();
      ctx.moveTo(l, py);
      ctx.lineTo(r, py);
      ctx.stroke();
    }
    const xGrid = calcDynXGrid(view.xMin, view.xMax, w);
    for (const f of xGrid) {
      const px = xToPx(f);
      ctx.beginPath();
      ctx.moveTo(px, t);
      ctx.lineTo(px, b);
      ctx.stroke();
    }
    ctx.restore();

    const drawTrace = (points, color, lineWidth = 2) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(l, t, w, h);
      ctx.clip();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth * dpr;
      ctx.beginPath();
      let started = false;
      for (const p of points) {
        if (p.f < view.xMin || p.f > view.xMax) continue;
        const px = xToPx(p.f);
        const py = yToPx(p.y);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    targets.forEach((tgt, i) => {
      if (i !== activeTarget) {
        drawTrace(buildTargetSeries(tgt), tgt.color + '40', 1.5);
      }
    });

    if (targets[activeTarget]) {
      drawTrace(buildTargetSeries(targets[activeTarget]), targets[activeTarget].color, 3.0);
    }

    if (targets[activeTarget]) {
      const isTiltHandle = (type) => type === 'tilt-global' || type === 'tilt-bass' || type === 'tilt-high';
      const parentByTilt = {
        'tilt-global': 'global-pivot',
        'tilt-bass': 'bass-end',
        'tilt-high': 'high-main',
      };

      const handles = getInteractiveHandles(targets[activeTarget]).filter((h) => {
        if (h.type === 'global' || h.type === 'tilt-global') return !!showGlobalControl;
        return !!showCurveControls;
      }).filter((h) => {
        if (!isTiltHandle(h.type)) return true;
        const parentId = parentByTilt[h.type];
        return selectedHandleId === parentId || selectedHandleId === h.id;
      });

      const byId = new Map(handles.map((h) => [h.id, h]));
      const tiltLinks = [
        ['global-pivot', 'global-tilt'],
        ['bass-end', 'bass-tilt'],
        ['high-main', 'high-tilt'],
      ];

      ctx.strokeStyle = 'rgba(0, 212, 255, 0.28)';
      ctx.lineWidth = 1 * dpr;
      tiltLinks.forEach(([a, b]) => {
        const ha = byId.get(a);
        const hb = byId.get(b);
        if (!ha || !hb) return;
        if (ha.f < view.xMin || ha.f > view.xMax || hb.f < view.xMin || hb.f > view.xMax) return;
        const ax = xToPx(ha.f);
        const ay = yToPx(ha.y);
        const bx = xToPx(hb.f);
        const by = yToPx(hb.y);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      });

      ctx.save();
      ctx.beginPath();
      ctx.rect(l, t, w, h);
      ctx.clip();
      for (const hnd of handles) {
        if (hnd.f < view.xMin || hnd.f > view.xMax) continue;
        const px = xToPx(hnd.f);
        const py = yToPx(hnd.y);
        const selected = hnd.id === selectedHandleId;
        const radius = selected ? 6.5 * dpr : 5 * dpr;

        if (hnd.type === 'global') {
          const size = (selected ? 7.5 : 6) * dpr;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = selected ? '#00d4ff' : '#4cc9f0';
          ctx.strokeStyle = selected ? 'rgba(0,212,255,0.95)' : 'rgba(216, 244, 255, 0.8)';
          ctx.lineWidth = 1.6 * dpr;
          ctx.fillRect(-size, -size, size * 2, size * 2);
          ctx.strokeRect(-size, -size, size * 2, size * 2);
          ctx.restore();

          ctx.strokeStyle = selected ? 'rgba(0,212,255,0.8)' : 'rgba(76,201,240,0.5)';
          ctx.lineWidth = 1.2 * dpr;
          ctx.beginPath();
          ctx.arc(px, py, (selected ? 12 : 10) * dpr, 0, Math.PI * 2);
          ctx.stroke();
        } else if (hnd.type === 'tilt-global' || hnd.type === 'tilt-bass' || hnd.type === 'tilt-high') {
          const stroke = selected ? 'rgba(0,212,255,0.95)' : 'rgba(180,240,255,0.9)';
          const glow = selected ? 'rgba(0,212,255,0.35)' : 'rgba(110,231,255,0.2)';
          const half = (selected ? 8 : 7) * dpr;
          const wing = (selected ? 4.5 : 4) * dpr;

          ctx.save();
          ctx.strokeStyle = stroke;
          ctx.fillStyle = stroke;
          ctx.lineWidth = 1.4 * dpr;
          ctx.shadowColor = glow;
          ctx.shadowBlur = selected ? 8 * dpr : 4 * dpr;

          // Center line between arrows.
          ctx.beginPath();
          ctx.moveTo(px, py - half);
          ctx.lineTo(px, py + half);
          ctx.stroke();

          // Up arrow head.
          ctx.beginPath();
          ctx.moveTo(px, py - half - wing);
          ctx.lineTo(px - wing, py - half + wing * 0.6);
          ctx.lineTo(px + wing, py - half + wing * 0.6);
          ctx.closePath();
          ctx.fill();

          // Down arrow head.
          ctx.beginPath();
          ctx.moveTo(px, py + half + wing);
          ctx.lineTo(px - wing, py + half - wing * 0.6);
          ctx.lineTo(px + wing, py + half - wing * 0.6);
          ctx.closePath();
          ctx.fill();

          ctx.restore();
        } else {
          ctx.fillStyle = selected ? '#ffb800' : '#b388ff';
          ctx.strokeStyle = selected ? 'rgba(255,184,0,0.95)' : 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        if (selected) {
          ctx.font = `${11 * dpr}px system-ui`;
          ctx.fillStyle = 'rgba(255, 214, 102, 0.95)';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(hnd.label, px + 8 * dpr, py - 8 * dpr);
        }
      }
      ctx.restore();

      if (hoverHandle && hoverHandle.id) {
        const hh = handles.find((h) => h.id === hoverHandle.id);
        if (hh && hh.f >= view.xMin && hh.f <= view.xMax) {
          const px = xToPx(hh.f);
          const py = yToPx(hh.y);
          const txt = `${hh.label}: ${fmtHz(hh.f)} | ${hh.y.toFixed(1)} dB`;
          ctx.save();
          ctx.font = `${11 * dpr}px system-ui`;
          const pad = 5 * dpr;
          const tw = ctx.measureText(txt).width + 2 * pad;
          const th = 17 * dpr;
          let tx = px + 10 * dpr;
          let ty = py + 8 * dpr;
          if (tx + tw > r) tx = px - tw - 10 * dpr;
          if (ty + th > b) ty = py - th - 10 * dpr;

          // Keep the handle tooltip above the cursor tooltip when both are visible.
          if (cursor) {
            const { px: cpx, py: cpy, f: cf, db: cdb } = cursor;
            if (cpx >= l && cpx <= r && cpy >= t && cpy <= b) {
              const cursorTxt = `${fmtHz(cf)} | ${cdb.toFixed(1)} dB`;
              ctx.font = `${12 * dpr}px system-ui`;
              const cursorPad = 6 * dpr;
              const cursorTw = ctx.measureText(cursorTxt).width + 2 * cursorPad;
              const cursorTh = 18 * dpr;
              let cursorLx = cpx + 10 * dpr;
              let cursorLy = cpy - 10 * dpr - cursorTh;
              if (cursorLx + cursorTw > canvas.width) cursorLx = cpx - 10 * dpr - cursorTw;
              if (cursorLy < t) cursorLy = cpy + 10 * dpr;

              tx = clamp(cursorLx + (cursorTw - tw) / 2, l + 2 * dpr, r - tw - 2 * dpr);
              ty = cursorLy - th - 6 * dpr;
              if (ty < t + 2 * dpr) {
                ty = Math.min(b - th - 2 * dpr, cursorLy + cursorTh + 6 * dpr);
              }

              // Restore handle tooltip font after cursor tooltip measurement.
              ctx.font = `${11 * dpr}px system-ui`;
            }
          }

          ctx.fillStyle = 'rgba(4, 9, 20, 0.92)';
          ctx.strokeStyle = 'rgba(179, 136, 255, 0.5)';
          ctx.lineWidth = 1 * dpr;
          ctx.fillRect(tx, ty, tw, th);
          ctx.strokeRect(tx, ty, tw, th);
          ctx.fillStyle = 'rgba(235, 228, 255, 0.95)';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt, tx + pad, ty + th / 2);
          ctx.restore();
        }
      }
    }

    if (dragGuide && Number.isFinite(dragGuide.f) && Number.isFinite(dragGuide.y)) {
      const gx = xToPx(clamp(dragGuide.f, view.xMin, view.xMax));
      const gy = yToPx(dragGuide.y);
      ctx.save();
      ctx.beginPath();
      ctx.rect(l, t, w, h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,184,0,0.45)';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(gx, t);
      ctx.lineTo(gx, b);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(l, gy);
      ctx.lineTo(r, gy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${11 * dpr}px system-ui`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = y0; y <= view.yMax + 1e-9; y += step) {
      const py = yToPx(y);
      if (py > b - 10 || py < t + 10) continue;
      ctx.fillText(String(y), l - 8 * dpr, py);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const f of xGrid) {
      const px = xToPx(f);
      if (px < l + 5) continue;
      ctx.fillText(fmtAxisHz(f), px, b + 8 * dpr);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(l, t, w, h);
    ctx.restore();

    if (cursor) {
      const { px: cpx, py: cpy, f: cf, db: cdb } = cursor;
      if (cpx >= l && cpx <= r && cpy >= t && cpy <= b) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(l, t, w, h);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1 * dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(l, cpy);
        ctx.lineTo(r, cpy);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cpx, t);
        ctx.lineTo(cpx, b);
        ctx.stroke();
        ctx.setLineDash([]);

        const txt = `${fmtHz(cf)} | ${cdb.toFixed(1)} dB`;
        ctx.font = `${12 * dpr}px system-ui`;
        const pad = 6 * dpr;
        const tw = ctx.measureText(txt).width + 2 * pad;
        const th = 18 * dpr;
        let lx = cpx + 10 * dpr;
        let ly = cpy - 10 * dpr - th;
        if (lx + tw > canvas.width) lx = cpx - 10 * dpr - tw;
        if (ly < t) ly = cpy + 10 * dpr;
        ctx.fillStyle = 'rgba(4,9,20,0.9)';
        ctx.strokeStyle = 'rgba(0,212,255,0.2)';
        ctx.lineWidth = 1 * dpr;
        ctx.fillRect(lx, ly, tw, th);
        ctx.strokeRect(lx, ly, tw, th);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(txt, lx + pad, ly + 13 * dpr);
        ctx.restore();
      }
    }
  }, []);

  return { draw, MARGIN_L, MARGIN_R, MARGIN_T, MARGIN_B };
}
