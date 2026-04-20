import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useTD, useTDDispatch } from './TargetDesignerContext.jsx';
import useCanvasDraw from './useCanvasDraw.js';
import {
  log10,
  pow10,
  clamp,
  fmtHz,
  getInteractiveHandles,
  parseREWText,
  computeTargetAt,
  generateExportText,
  defaultParams,
} from './curveEngine.js';
import ExportDialog from './ExportDialog.jsx';
import InfoTip from '../../components/InfoTip.jsx';
import * as tdApi from '../../services/tdApi.js';

const HANDLE_HIT_PX = 12;
const X_LIMITS = { min: 3, max: 24000 };
const Y_LIMITS = { min: -50, max: 170 };
const MIN_X_SPAN = 10;
const MAX_X_SPAN = X_LIMITS.max - X_LIMITS.min;
const MIN_Y_SPAN = 6;
const MAX_Y_SPAN = Y_LIMITS.max - Y_LIMITS.min;
const UNDO_WARNING_MESSAGE = 'This will undo any changes you might have made - are you sure you want to do it?';

function clampNum(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function roundTo(v, digits = 2) {
  const m = Math.pow(10, digits);
  return Math.round(v * m) / m;
}

function snapHz(v) {
  return Math.round(v);
}

function snapDb(v) {
  return roundTo(v, 1);
}

function InspectorNumberRange({ label, min, max, step, value, unit, onChange, scale = 'linear' }) {
  const safeVal = Number.isFinite(value) ? value : min;
  const sliderMin = scale === 'log' ? 0 : min;
  const sliderMax = scale === 'log' ? 1000 : max;
  const sliderStep = scale === 'log' ? 1 : step;

  const toSliderValue = (rawValue) => {
    if (scale !== 'log') return rawValue;
    const lv = log10(clampNum(rawValue, min, max));
    const lmin = log10(min);
    const lmax = log10(max);
    return ((lv - lmin) / (lmax - lmin)) * 1000;
  };

  const fromSliderValue = (sliderValue) => {
    if (scale !== 'log') return sliderValue;
    const lmin = log10(min);
    const lmax = log10(max);
    const t = clampNum(sliderValue / 1000, 0, 1);
    return pow10(lmin + t * (lmax - lmin));
  };

  const handleRaw = (raw) => {
    const next = parseFloat(raw);
    if (!Number.isFinite(next)) return;
    onChange(roundTo(clampNum(next, min, max), 2));
  };

  const handleSlider = (raw) => {
    const next = parseFloat(raw);
    if (!Number.isFinite(next)) return;
    const actual = fromSliderValue(next);
    onChange(roundTo(clampNum(actual, min, max), 2));
  };

  return (
    <div className="td-handle-field">
      <div className="td-handle-field-head">
        <span>{label}</span>
        <span className="td-handle-field-value">{safeVal.toFixed(2)} {unit}</span>
      </div>
      <div className="td-handle-field-inputs">
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={sliderStep}
          value={toSliderValue(safeVal)}
          onChange={(e) => handleSlider(e.target.value)}
        />
        <input type="number" min={min} max={max} step={step} value={safeVal} onChange={(e) => handleRaw(e.target.value)} />
        <span className="td-handle-unit">{unit}</span>
      </div>
    </div>
  );
}

function ToolbarPillToggle({ on, label, onClick }) {
  return (
    <div className="td-pill-wrap" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}>
      <span className="td-pill-label">{label}</span>
      <div className={`td-pill-toggle${on ? ' on' : ''}`}>
        <div className="td-pill-thumb" />
      </div>
    </div>
  );
}

export default function CurveCanvas() {
  const state = useTD();
  const dispatch = useTDDispatch();
  const { draw, MARGIN_L, MARGIN_R } = useCanvasDraw();
  const [selectedHandleId, setSelectedHandleId] = useState(null);
  const [hoverHandleId, setHoverHandleId] = useState(null);
  const [dragGuide, setDragGuide] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveOverwrite, setSaveOverwrite] = useState(false);
  const [saveResolution, setSaveResolution] = useState('1/24');
  const [selectedPresetPath, setSelectedPresetPath] = useState('');
  const [showUndoConfirm, setShowUndoConfirm] = useState(false);
  const undoActionRef = useRef(null);
  const canvasRef = useRef(null);
  const pointerRef = useRef({
    down: false,
    x0: 0,
    y0: 0,
    xMin0: 0,
    xMax0: 0,
    yMin0: 0,
    yMax0: 0,
    mode: 'pan',
    handleId: null,
    startParams: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeTarget = state.targets[state.activeTarget];
  const baselineParams = useMemo(() => defaultParams(), []);
  const isCurveDirty = useMemo(() => {
    if (!activeTarget) return false;

    const params = activeTarget.params || {};
    for (const [key, baseValue] of Object.entries(baselineParams)) {
      const currentValue = params[key];
      if (typeof baseValue === 'number') {
        if (!Number.isFinite(currentValue)) return true;
        if (Math.abs(currentValue - baseValue) > 1e-6) return true;
      } else if (currentValue !== baseValue) {
        return true;
      }
    }

    return Array.isArray(activeTarget.peqs) && activeTarget.peqs.length > 0;
  }, [activeTarget, baselineParams]);

  const selectedHandle = useMemo(() => {
    if (!activeTarget || !selectedHandleId) return null;
    return getInteractiveHandles(activeTarget).find((h) => h.id === selectedHandleId) || null;
  }, [activeTarget, selectedHandleId]);

  const yToPx = useCallback((db) => {
    const { view } = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const t = (db - view.yMin) / (view.yMax - view.yMin);
    return canvas.height * (1 - t);
  }, []);

  const pxToX = useCallback(
    (px) => {
      const { view } = stateRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return 20;
      const dpr = window.devicePixelRatio || 1;
      const a = log10(view.xMin);
      const b = log10(view.xMax);
      const w = canvas.width - (MARGIN_L + MARGIN_R) * dpr;
      const t = (px - MARGIN_L * dpr) / w;
      return pow10(a + t * (b - a));
    },
    [MARGIN_L, MARGIN_R]
  );

  const pxToY = useCallback((py) => {
    const { view } = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const t = 1 - py / canvas.height;
    return view.yMin + t * (view.yMax - view.yMin);
  }, []);

  const findHandleAt = useCallback((px, py) => {
    const dpr = window.devicePixelRatio || 1;
    const target = stateRef.current.targets[stateRef.current.activeTarget];
    if (!target) return null;
    const handles = getInteractiveHandles(target).filter((h) => {
      if (h.type === 'global' || h.type === 'tilt-global') return !!stateRef.current.showGlobalControl;
      return !!stateRef.current.showCurveControls;
    });
    let best = null;
    let bestD2 = (HANDLE_HIT_PX * dpr) * (HANDLE_HIT_PX * dpr);
    for (const hnd of handles) {
      const fx = (() => {
        const { view } = stateRef.current;
        const canvas = canvasRef.current;
        if (!canvas) return 0;
        const a = log10(view.xMin);
        const b = log10(view.xMax);
        const w = canvas.width - (MARGIN_L + MARGIN_R) * dpr;
        return MARGIN_L * dpr + ((log10(hnd.f) - a) / (b - a)) * w;
      })();
      const fy = yToPx(hnd.y);
      const dx = px - fx;
      const dy = py - fy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        best = hnd;
        bestD2 = d2;
      }
    }
    return best;
  }, [MARGIN_L, MARGIN_R, pxToX, yToPx]);

  const clampView = useCallback((view) => {
    let xMin = Number(view.xMin);
    let xMax = Number(view.xMax);
    let yMin = Number(view.yMin);
    let yMax = Number(view.yMax);

    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) {
      xMin = X_LIMITS.min;
      xMax = X_LIMITS.max;
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax <= yMin) {
      yMin = -10;
      yMax = 120;
    }

    let xSpan = xMax - xMin;
    if (xSpan < MIN_X_SPAN) xSpan = MIN_X_SPAN;
    if (xSpan > MAX_X_SPAN) xSpan = MAX_X_SPAN;

    const xMid = (xMin + xMax) / 2;
    xMin = xMid - xSpan / 2;
    xMax = xMid + xSpan / 2;

    if (xMin < X_LIMITS.min) {
      xMax += X_LIMITS.min - xMin;
      xMin = X_LIMITS.min;
    }
    if (xMax > X_LIMITS.max) {
      xMin -= xMax - X_LIMITS.max;
      xMax = X_LIMITS.max;
    }
    xMin = clampNum(xMin, X_LIMITS.min, X_LIMITS.max - MIN_X_SPAN);
    xMax = clampNum(xMax, X_LIMITS.min + MIN_X_SPAN, X_LIMITS.max);

    let ySpan = yMax - yMin;
    if (ySpan < MIN_Y_SPAN) ySpan = MIN_Y_SPAN;
    if (ySpan > MAX_Y_SPAN) ySpan = MAX_Y_SPAN;

    const yMid = (yMin + yMax) / 2;
    yMin = yMid - ySpan / 2;
    yMax = yMid + ySpan / 2;

    if (yMin < Y_LIMITS.min) {
      yMax += Y_LIMITS.min - yMin;
      yMin = Y_LIMITS.min;
    }
    if (yMax > Y_LIMITS.max) {
      yMin -= yMax - Y_LIMITS.max;
      yMax = Y_LIMITS.max;
    }

    yMin = clampNum(yMin, Y_LIMITS.min, Y_LIMITS.max - MIN_Y_SPAN);
    yMax = clampNum(yMax, Y_LIMITS.min + MIN_Y_SPAN, Y_LIMITS.max);

    return { xMin, xMax, yMin, yMax };
  }, []);

  const applyHandleDrag = useCallback((hnd, dxPx, dyPx, px, py, modifiers) => {
    const canvas = canvasRef.current;
    if (!canvas || !hnd) return;
    const s = pointerRef.current.startParams;
    const { view } = stateRef.current;
    const fine = modifiers?.shiftKey ? 0.2 : 1;
    const lockX = !!modifiers?.altKey;
    const lockY = !!(modifiers?.ctrlKey || modifiers?.metaKey);
    const deltaDbRaw = lockY ? 0 : ((-dyPx / canvas.height) * (view.yMax - view.yMin) * fine);
    const deltaDb = snapDb(deltaDbRaw);
    const xHz = lockX
      ? snapHz(pointerRef.current.startParams?.handleStartF ?? pxToX(px))
      : snapHz(pxToX(px));

    const emitGuide = (f, y) => setDragGuide({ f, y });

    if (hnd.type === 'global') {
      const pivot = snapHz(clampNum(xHz, 50, 8000));
      if (modifiers?.shiftKey) {
        const tilt = roundTo(clampNum((s?.tilt ?? 0) + deltaDb * 0.5, -12, 12), 2);
        dispatch({ type: 'UPDATE_PARAMS', patch: { pivot, tilt } });
        emitGuide(pivot, s?.level ?? hnd.y);
      } else {
        const level = roundTo(clampNum((s?.level ?? hnd.y) + deltaDb, -50, 170), 1);
        dispatch({ type: 'UPDATE_PARAMS', patch: { pivot, level } });
        emitGuide(pivot, level);
      }
      return;
    }

    if (hnd.type === 'tilt-global') {
      const tilt = roundTo(clampNum((s?.tilt ?? 0) + deltaDb * 0.55, -12, 12), 2);
      dispatch({ type: 'UPDATE_PARAMS', patch: { tilt } });
      emitGuide(s?.pivot ?? pointerRef.current.startParams?.handleStartF ?? hnd.f, hnd.y + deltaDb);
      return;
    }

    if (hnd.type === 'bass') {
      const lfStart = snapHz(clampNum(xHz, 5, 120));
      const lfGain = roundTo(clampNum((s?.lfGain ?? 0) + deltaDb, -24, 24), 1);
      dispatch({ type: 'UPDATE_PARAMS', patch: { lfStart, lfGain, lfEnd: Math.max(lfStart + 1, s?.lfEnd ?? 200) } });
      emitGuide(lfStart, stateRef.current.targets[stateRef.current.activeTarget]?.params?.level + lfGain || 0);
      return;
    }
    if (hnd.type === 'bass-end') {
      const lfEnd = snapHz(clampNum(xHz, 20, 300));
      dispatch({ type: 'UPDATE_PARAMS', patch: { lfEnd: Math.max((s?.lfStart ?? 5) + 1, lfEnd) } });
      emitGuide(lfEnd, hnd.y);
      return;
    }
    if (hnd.type === 'tilt-bass') {
      const tiltLow = roundTo(clampNum((s?.tiltLow ?? 0) + deltaDb * 0.55, -12, 12), 2);
      dispatch({ type: 'UPDATE_PARAMS', patch: { tiltLow } });
      emitGuide(s?.lfEnd ?? hnd.f, hnd.y + deltaDb);
      return;
    }
    if (hnd.type === 'mid') {
      const warmthFreq = snapHz(clampNum(xHz, 100, 2000));
      const warmthGain = roundTo(clampNum((s?.warmthGain ?? 0) + deltaDb, -12, 12), 1);
      dispatch({
        type: 'UPDATE_PARAMS',
        patch: {
          warmthFreq,
          warmthGain,
        },
      });
      emitGuide(warmthFreq, stateRef.current.targets[stateRef.current.activeTarget]?.params?.level + warmthGain || 0);
      return;
    }
    if (hnd.type === 'high') {
      const hfShelfStart = snapHz(clampNum(xHz, 4000, 14000));
      const hfShelfGain = roundTo(clampNum((s?.hfShelfGain ?? 0) + deltaDb, -12, 12), 1);
      dispatch({
        type: 'UPDATE_PARAMS',
        patch: {
          hfShelfStart,
          hfShelfGain,
        },
      });
      emitGuide(hfShelfStart, stateRef.current.targets[stateRef.current.activeTarget]?.params?.level + hfShelfGain || 0);
      return;
    }
    if (hnd.type === 'tilt-high') {
      const tiltHigh = roundTo(clampNum((s?.tiltHigh ?? 0) + deltaDb * 0.55, -12, 12), 2);
      dispatch({ type: 'UPDATE_PARAMS', patch: { tiltHigh } });
      emitGuide(s?.hfShelfStart ?? hnd.f, hnd.y + deltaDb);
      return;
    }
    if (hnd.type === 'hp') {
      const hpFreq = snapHz(clampNum(xHz, 3, 100));
      const hpSlope = roundTo(clampNum((s?.hpSlope ?? 0) + deltaDb * 2, 0, 48), 1);
      dispatch({
        type: 'UPDATE_PARAMS',
        patch: {
          hpFreq,
          hpSlope,
        },
      });
      emitGuide(hpFreq, hnd.y);
      return;
    }
    if (hnd.type === 'lp') {
      const lpFreq = snapHz(clampNum(xHz, 40, 24000));
      const lpSlope = roundTo(clampNum((s?.lpSlope ?? 0) + deltaDb * 2, 0, 48), 1);
      dispatch({
        type: 'UPDATE_PARAMS',
        patch: {
          lpFreq,
          lpSlope,
        },
      });
      emitGuide(lpFreq, hnd.y);
      return;
    }
    if (hnd.type === 'peq' && Number.isInteger(hnd.index)) {
      const f = snapHz(clampNum(xHz, 10, 24000));
      const g = roundTo(clampNum((s?.peqG ?? 0) + deltaDb, -24, 24), 1);
      dispatch({
        type: 'UPDATE_PEQ',
        index: hnd.index,
        patch: {
          f,
          g,
        },
      });
      emitGuide(f, hnd.y + (g - (s?.peqG ?? 0)));
    }
  }, [dispatch, pxToX]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(10, Math.floor(rect.width * dpr));
      canvas.height = Math.max(10, Math.floor(rect.height * dpr));
      draw(canvas, { ...stateRef.current, selectedHandleId, hoverHandle: hoverHandleId ? { id: hoverHandleId } : null, dragGuide });
    });
    observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, [draw, selectedHandleId, hoverHandleId, dragGuide]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      draw(canvas, { ...state, selectedHandleId, hoverHandle: hoverHandleId ? { id: hoverHandleId } : null, dragGuide });
    }
  }, [state, draw, selectedHandleId, hoverHandleId, dragGuide]);

  const handlePointerDown = useCallback((e) => {
    const dpr = window.devicePixelRatio || 1;
    const { view, targets, activeTarget } = stateRef.current;
    const px = e.nativeEvent.offsetX * dpr;
    const py = e.nativeEvent.offsetY * dpr;
    const hit = findHandleAt(px, py);
    const activeTargetObj = targets[activeTarget];
    const p = activeTargetObj?.params || {};

    if (hit) setSelectedHandleId(hit.id);

    pointerRef.current = {
      down: true,
      x0: px,
      y0: py,
      xMin0: view.xMin,
      xMax0: view.xMax,
      yMin0: view.yMin,
      yMax0: view.yMax,
      mode: hit ? 'handle' : 'pan',
      handleId: hit?.id || null,
      startParams: {
        lfGain: p.lfGain,
        lfStart: p.lfStart,
        lfEnd: p.lfEnd,
        level: p.level,
        pivot: p.pivot,
        tilt: p.tilt,
        tiltLow: p.tiltLow,
        tiltHigh: p.tiltHigh,
        hfShelfStart: p.hfShelfStart,
        warmthGain: p.warmthGain,
        hfShelfGain: p.hfShelfGain,
        hpSlope: p.hpSlope,
        lpSlope: p.lpSlope,
        handleStartF: hit?.f,
        peqG: hit?.type === 'peq' && Number.isInteger(hit.index) ? activeTargetObj?.peqs?.[hit.index]?.g : 0,
      },
    };
  }, [findHandleAt]);

  const handlePointerMove = useCallback(
    (e) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const px = e.nativeEvent.offsetX * dpr;
      const py = e.nativeEvent.offsetY * dpr;
      const { view } = stateRef.current;
      const f = clamp(pxToX(px), view.xMin, view.xMax);
      const db = pxToY(py);
      dispatch({ type: 'SET_CURSOR', cursor: { f, db, px, py } });
      const hover = findHandleAt(px, py);
      setHoverHandleId(hover?.id || null);

      if (e.buttons === 1 && pointerRef.current.down) {
        const p = pointerRef.current;
        if (p.mode === 'handle' && p.handleId) {
          const target = stateRef.current.targets[stateRef.current.activeTarget];
          const hnd = getInteractiveHandles(target).find((h) => h.id === p.handleId);
          applyHandleDrag(hnd, px - p.x0, py - p.y0, px, py, e);
          return;
        }

        const dx = px - p.x0;
        const dy = py - p.y0;
        const lmin0 = log10(p.xMin0);
        const lmax0 = log10(p.xMax0);
        const w = canvas.width;
        const dl = (dx / w) * (lmax0 - lmin0);
        const dydb = (dy / canvas.height) * (p.yMax0 - p.yMin0);
        dispatch({
          type: 'SET_VIEW',
          view: clampView({
            xMin: pow10(lmin0 - dl),
            xMax: pow10(lmax0 - dl),
            yMin: p.yMin0 + dydb,
            yMax: p.yMax0 + dydb,
          }),
        });
      }
    },
    [dispatch, pxToX, pxToY, applyHandleDrag, clampView, findHandleAt]
  );

  const handlePointerUp = useCallback(() => {
    pointerRef.current.down = false;
    setDragGuide(null);
  }, []);

  const handleWheel = useCallback(
    (e) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const fA = pxToX(e.nativeEvent.offsetX * dpr);
      const yA = pxToY(e.nativeEvent.offsetY * dpr);
      const fine = e.shiftKey ? 0.35 : 1.0;
      const base = Math.exp(-e.deltaY * 0.0012 * fine);
      let zx = base;
      let zy = base;
      if (e.altKey) zx = 1.0;
      if (e.ctrlKey || e.metaKey) zy = 1.0;

      const { view } = stateRef.current;
      const la = log10(fA);
      const lmin = log10(view.xMin);
      const lmax = log10(view.xMax);
      const nlmin = la - (la - lmin) / zx;
      const nlmax = nlmin + (lmax - lmin) / zx;
      dispatch({
        type: 'SET_VIEW',
        view: clampView({
          xMin: pow10(nlmin),
          xMax: pow10(nlmax),
          yMin: yA - (yA - view.yMin) / zy,
          yMax: yA + (view.yMax - yA) / zy,
        }),
      });
    },
    [dispatch, pxToX, pxToY, clampView]
  );

  const handlePointerLeave = useCallback(() => {
    dispatch({ type: 'SET_CURSOR', cursor: null });
    setHoverHandleId(null);
    setDragGuide(null);
  }, [dispatch]);

  const handleContextMenu = useCallback(
    (e) => {
      e.preventDefault();
      const target = stateRef.current.targets[stateRef.current.activeTarget];
      if (!target || !stateRef.current.showCurveControls) return;
      const dpr = window.devicePixelRatio || 1;
      const px = e.nativeEvent.offsetX * dpr;
      const py = e.nativeEvent.offsetY * dpr;
      const f = snapHz(clampNum(pxToX(px), 10, 24000));
      const y = pxToY(py);
      const baseline = computeTargetAt(f, target);
      const g = roundTo(clampNum(y - baseline, -24, 24), 1);
      const nextIndex = target.peqs.length;
      dispatch({ type: 'ADD_PEQ_AT', peq: { enabled: true, f, g, q: 1.4 } });
      setSelectedHandleId(`peq-${nextIndex}`);
    },
    [dispatch, pxToX, pxToY]
  );

  const zoom = useCallback(
    (axis, dir) => {
      const { view } = stateRef.current;
      const factor = dir > 0 ? 0.8 : 1.25;
      if (axis === 'x') {
        const mid = (log10(view.xMin) + log10(view.xMax)) / 2;
        const half = ((log10(view.xMax) - log10(view.xMin)) / 2) * factor;
        dispatch({ type: 'SET_VIEW', view: clampView({ ...view, xMin: pow10(mid - half), xMax: pow10(mid + half) }) });
      } else {
        const mid = (view.yMin + view.yMax) / 2;
        const half = ((view.yMax - view.yMin) / 2) * factor;
        dispatch({ type: 'SET_VIEW', view: clampView({ ...view, yMin: mid - half, yMax: mid + half }) });
      }
    },
    [dispatch, clampView]
  );

  const handlePresetChange = useCallback(
    async (filePath) => {
      if (!filePath) return;
      setSelectedPresetPath(filePath);
      const points = await tdApi.readTargetCurve(filePath);
      const preset = state.presets.find((p) => p.filePath === filePath);
      dispatch({
        type: 'UPDATE_TARGET',
        patch: {
          templateName: preset?.name || 'Custom',
          templatePts: points.map((pt) => ({ f: pt.freq, val: pt.db })),
          name: preset?.name || activeTarget?.name || 'Target 1',
        },
      });
      dispatch({ type: 'RESET_TO_TEMPLATE' });
      setSelectedHandleId(null);
    },
    [state.presets, activeTarget, dispatch]
  );

  const requestUndoConfirmation = useCallback((action) => {
    if (!isCurveDirty) {
      if (typeof action === 'function') action();
      return;
    }
    undoActionRef.current = action;
    setShowUndoConfirm(true);
  }, [isCurveDirty]);

  const handleConfirmUndo = useCallback(() => {
    const action = undoActionRef.current;
    undoActionRef.current = null;
    setShowUndoConfirm(false);
    if (typeof action === 'function') {
      action();
    }
  }, []);

  const handleCancelUndo = useCallback(() => {
    undoActionRef.current = null;
    setShowUndoConfirm(false);
  }, []);

  const handleLoadTargetFile = useCallback(async () => {
    const result = await tdApi.importTargetCurveFile();
    if (!result) return;
    const pts = parseREWText(result.text);
    if (pts.length === 0) return;
    dispatch({
      type: 'UPDATE_TARGET',
      patch: {
        templateName: result.name,
        templatePts: pts.map((p) => ({ f: p.f, val: p.spl })),
        name: result.name,
      },
    });
    dispatch({ type: 'RESET_TO_TEMPLATE' });
    setSelectedHandleId(null);
  }, [dispatch]);

  const handleSave = useCallback(async () => {
    if (!activeTarget) return;
    const text = generateExportText(activeTarget, saveResolution);
    const points = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const nums = line.match(/[-+]?\d+(?:\.\d+)?/g);
        if (!nums || nums.length < 2) return null;
        const freq = parseFloat(nums[0]);
        const db = parseFloat(nums[1]);
        if (!Number.isFinite(freq) || !Number.isFinite(db)) return null;
        return { freq, db };
      })
      .filter(Boolean);
    try {
      const saved = await tdApi.saveTargetCurve(saveName || activeTarget.name, points, saveOverwrite);
      setShowSave(false);
      const templates = await tdApi.listTargetCurves();
      dispatch({ type: 'SET_PRESETS', presets: templates });
      if (saved?.filePath) {
        setSelectedPresetPath(saved.filePath);
        const savedPreset = templates.find((preset) => preset.filePath === saved.filePath);
        const savedNameResolved = savedPreset?.name || saveName || activeTarget.name;
        dispatch({
          type: 'UPDATE_TARGET',
          patch: {
            templateName: savedNameResolved,
            templatePts: points.map((point) => ({ f: point.freq, val: point.db })),
            name: savedNameResolved,
          },
        });
        dispatch({ type: 'RESET_TO_TEMPLATE' });
        setSelectedHandleId(null);
      }
    } catch (err) {
      alert(err.message);
    }
  }, [activeTarget, saveName, saveOverwrite, saveResolution, dispatch]);

  return (
    <div className="td-canvas-area">
      <div className="td-canvas-toolbar">
        <div className="td-toolbar-row">
          <span className="td-tb-label">
            CURVE TEMPLATES
            <InfoTip title="Curve Templates" wide>
              <div>Select a template baseline, then adjust with handles and PEQ.</div>
              <div>Loading a target curve file replaces the current template baseline.</div>
            </InfoTip>
          </span>
          <select
            className="td-tb-select"
            onChange={(e) => {
              const filePath = e.target.value;
              if (!filePath || filePath === selectedPresetPath) return;
              requestUndoConfirmation(() => {
                void handlePresetChange(filePath);
              });
            }}
            value={selectedPresetPath}
          >
            <option value="" disabled>Select template...</option>
            {state.presets.map((p) => (
              <option key={p.filePath} value={p.filePath}>{p.name}</option>
            ))}
          </select>
          <button className="td-tb-btn" onClick={handleLoadTargetFile}>Load Target Curve File</button>
          <InfoTip title="Load Target Curve File">
            <div>Imports text/FRD/CSV style target curves as the template baseline.</div>
          </InfoTip>
          <button
            className="td-tb-btn"
            onClick={() => {
              setSaveName(activeTarget?.name || 'Target 1');
              setSaveOverwrite(false);
              setSaveResolution('1/24');
              setShowSave(true);
            }}
          >
            Save as Template
          </button>
          <InfoTip title="Save as Template">
            <div>Saves the current designed curve into the template list and makes it available to Optimize workflow.</div>
          </InfoTip>
          <button className="td-tb-btn" onClick={() => setShowExport(true)}>Export Curve File</button>
          <InfoTip title="Export Curve File">
            <div>Exports the rget curve</div>
          </InfoTip>
        </div>

        <div className="td-toolbar-row">
          <span className="td-tb-label">
            VIEW
            <InfoTip title="View Controls">
              <div>Use X/Y zoom controls for detailed editing ranges.</div>
            </InfoTip>
          </span>
          <button className="td-tb-btn td-tb-btn-round" onClick={() => zoom('x', 1)}>+X</button>
          <button className="td-tb-btn td-tb-btn-round" onClick={() => zoom('x', -1)}>-X</button>
          <button className="td-tb-btn td-tb-btn-round" onClick={() => zoom('y', 1)}>+Y</button>
          <button className="td-tb-btn td-tb-btn-round" onClick={() => zoom('y', -1)}>-Y</button>
          <button
            className="td-tb-btn"
            onClick={() => dispatch({ type: 'SET_VIEW', view: { xMin: 3, xMax: 24000, yMin: -10, yMax: 120 } })}
          >
            Reset View
          </button>
          <InfoTip title="Reset view">
              <div>Restores graph bounds</div>
          </InfoTip>
          <button
            className="td-tb-btn"
            onClick={() => requestUndoConfirmation(() => {
              dispatch({ type: 'RESET_TO_TEMPLATE' });
              setSelectedHandleId(null);
            })}
          >
            Reset Curve
          </button>
           <InfoTip title="Reset Curve">
              <div>Restores curve to oritinal template/loaded curve</div>
          </InfoTip>
          <ToolbarPillToggle on={state.showGlobalControl} label="SHOW GLOBAL HANDLE" onClick={() => dispatch({ type: 'TOGGLE_GLOBAL_CONTROL' })} />
          <InfoTip title="Show Global Handle" wide={true}>
              <div>Toggles the visibility of the global handle (diamond shaped control)</div>
              <div>Global handle allows simultaneous adjustment of pivot frequency, overall level, and tilt.</div>
              <div>The tilt control appears when the global handle is selected</div>
          </InfoTip>
          <ToolbarPillToggle on={state.showCurveControls} label="SHOW CURVE HANDLES" onClick={() => dispatch({ type: 'TOGGLE_CURVE_CONTROLS' })} />
          <InfoTip title="Show Curve Handles" wide={true}>
              <div>Toggles the visibility of the curve handles (circular controls)</div>
              <div>Curve handles can be dragged to manipulate the curve. </div>
              <div>Hold Shift for fine adjustments, hold Alt to lock X-axis movement, Ctrl/Cmd to lock Y-axis movement</div>
              <div>Tilt control appears for some curve handles that support tilt</div>
              <div>Right-clicking a curve handle adds/removes a PEQ point at that frequency.</div>
              <div>Activating each handle also shows a contextual control panel that allows fine tuning</div>
          </InfoTip>
        </div>

      </div>
      
      <div className="td-canvas-wrap">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
          style={{ cursor: pointerRef.current.mode === 'handle' ? 'grabbing' : hoverHandleId ? 'grab' : 'crosshair' }}
        />
        {state.cursor && (
          <div className="td-hud">
            <div className="td-hud-label">CURSOR</div>
            <div className="td-hud-value">
              {fmtHz(state.cursor.f)} - {state.cursor.db.toFixed(1)} dB
            </div>
          </div>
        )}
        {state.targets.length > 0 && (
          <div className="td-legend">
            {state.targets.map((tgt, i) => (
              <div key={`t${i}`} className="td-legend-line">
                <span className="td-legend-swatch" style={{ background: i === state.activeTarget ? tgt.color : tgt.color + '40' }} />
                <span className="td-legend-label">{tgt.name}</span>
              </div>
            ))}
          </div>
        )}

        {selectedHandle && (
          <div className="td-handle-inspector">
            <div className="td-handle-title">{selectedHandle.label} Handle</div>
            {(() => {
              const h = selectedHandle;
              const p = state.targets[state.activeTarget]?.params;
              const peq = h.type === 'peq' ? state.targets[state.activeTarget]?.peqs?.[h.index] : null;
              if (!p) return null;

              if (h.type === 'bass' || h.type === 'bass-end' || h.type === 'tilt-bass') {
                return (
                  <>
                    <InspectorNumberRange label="Gain" min={-24} max={24} step={0.1} value={p.lfGain} unit="dB" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { lfGain: v } })} />
                    <InspectorNumberRange label="Start" min={5} max={120} step={1} value={p.lfStart} unit="Hz" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { lfStart: snapHz(v) } })} />
                    <InspectorNumberRange label="End" min={20} max={300} step={1} value={p.lfEnd} unit="Hz" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { lfEnd: snapHz(v) } })} />
                    <InspectorNumberRange label="Bass Tilt" min={-12} max={12} step={0.05} value={p.tiltLow} unit="dB/oct" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { tiltLow: v } })} />
                  </>
                );
              }

              if (h.type === 'global' || h.type === 'tilt-global') {
                return (
                  <>
                    <div className="td-handle-hint">Drag: X = pivot, Y = level, Shift+Y = tilt. Mini tilt handle adjusts tilt directly.</div>
                    <InspectorNumberRange label="Overall Level" min={-50} max={170} step={0.1} value={p.level} unit="dB" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { level: v } })} />
                    <InspectorNumberRange label="Pivot Frequency" min={50} max={8000} step={1} value={p.pivot} unit="Hz" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { pivot: snapHz(v) } })} />
                    <InspectorNumberRange label="Tilt" min={-12} max={12} step={0.05} value={p.tilt} unit="dB/oct" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { tilt: v } })} />
                  </>
                );
              }

              if (h.type === 'mid') {
                return (
                  <>
                    <InspectorNumberRange label="Mid Gain" min={-12} max={12} step={0.1} value={p.warmthGain} unit="dB" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { warmthGain: v } })} />
                    <InspectorNumberRange label="Mid Frequency" min={100} max={2000} step={1} value={p.warmthFreq} unit="Hz" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { warmthFreq: snapHz(v) } })} />
                    <InspectorNumberRange label="Mid Q" min={0.2} max={6} step={0.01} value={p.warmthQ} unit="Q" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { warmthQ: v } })} />
                  </>
                );
              }

              if (h.type === 'high' || h.type === 'tilt-high') {
                return (
                  <>
                    <InspectorNumberRange label="Shelf Gain" min={-12} max={12} step={0.1} value={p.hfShelfGain} unit="dB" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { hfShelfGain: v } })} />
                    <InspectorNumberRange label="Shelf Start" min={4000} max={14000} step={1} value={p.hfShelfStart} unit="Hz" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { hfShelfStart: snapHz(v) } })} />
                    <InspectorNumberRange label="High Tilt" min={-12} max={12} step={0.05} value={p.tiltHigh} unit="dB/oct" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { tiltHigh: v } })} />
                  </>
                );
              }

              if (h.type === 'hp') {
                return (
                  <>
                    <InspectorNumberRange label="HP Frequency" min={3} max={100} step={1} value={p.hpFreq} unit="Hz" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { hpFreq: snapHz(v) } })} />
                    <InspectorNumberRange label="HP Slope" min={0} max={48} step={0.1} value={p.hpSlope} unit="dB/oct" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { hpSlope: v } })} />
                    <InspectorNumberRange label="HP Knee Width" min={0.1} max={2.5} step={0.05} value={p.hpKneeOct ?? 2.5} unit="oct" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { hpKneeOct: v } })} />
                  </>
                );
              }

              if (h.type === 'lp') {
                return (
                  <>
                    <InspectorNumberRange label="LP Frequency" min={40} max={24000} step={1} value={p.lpFreq} unit="Hz" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { lpFreq: snapHz(v) } })} />
                    <InspectorNumberRange label="LP Slope" min={0} max={48} step={0.1} value={p.lpSlope} unit="dB/oct" onChange={(v) => dispatch({ type: 'UPDATE_PARAMS', patch: { lpSlope: v } })} />
                  </>
                );
              }

              if (h.type === 'peq' && peq) {
                return (
                  <>
                    <InspectorNumberRange label="Frequency" min={10} max={24000} step={1} value={peq.f} unit="Hz" scale="log" onChange={(v) => dispatch({ type: 'UPDATE_PEQ', index: h.index, patch: { f: snapHz(v), enabled: true } })} />
                    <InspectorNumberRange label="Gain" min={-24} max={24} step={0.1} value={peq.g} unit="dB" onChange={(v) => dispatch({ type: 'UPDATE_PEQ', index: h.index, patch: { g: v } })} />
                    <InspectorNumberRange label="Q" min={0.1} max={20} step={0.01} value={peq.q} unit="Q" onChange={(v) => dispatch({ type: 'UPDATE_PEQ', index: h.index, patch: { q: v } })} />
                    <button className="td-tb-btn danger" onClick={() => { dispatch({ type: 'REMOVE_PEQ', index: h.index }); setSelectedHandleId(null); }}>
                      REMOVE PEQ
                    </button>
                  </>
                );
              }

              return null;
            })()}
            <button className="td-tb-btn" onClick={() => setSelectedHandleId(null)}>Close</button>
          </div>
        )}
      </div>
      <span className="td-tb-hint">
        Right-click on the curve to add PEQ handles
      </span>
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}

      {showSave && (
        <div className="td-dialog-backdrop" onClick={() => setShowSave(false)}>
          <div className="td-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="td-dialog-title">SAVE TEMPLATE</div>
            <div className="td-dialog-row">
              <span className="td-dialog-label">Name</span>
              <input className="td-dialog-input" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
            </div>
            <div className="td-dialog-row">
              <span className="td-dialog-label">Resolution</span>
              <select className="td-dialog-select" value={saveResolution} onChange={(e) => setSaveResolution(e.target.value)}>
                <option value="1hz">1 Hz (No Smoothing)</option>
                <option value="1/6">1/6 Oct (High)</option>
                <option value="1/12">1/12 Oct (Medium)</option>
                <option value="1/24">1/24 Oct (Low)</option>
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: '0.52rem', color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={saveOverwrite} onChange={(e) => setSaveOverwrite(e.target.checked)} />
              Overwrite if exists
            </label>
            <div className="td-dialog-actions">
              <button className="td-btn" onClick={() => setShowSave(false)}>CANCEL</button>
              <button className="td-btn td-btn-green" onClick={handleSave}>SAVE TEMPLATE</button>
            </div>
          </div>
        </div>
      )}

      {showUndoConfirm && (
        <div className="td-dialog-backdrop" onClick={handleCancelUndo}>
          <div className="td-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="td-dialog-title">CONFIRM ACTION</div>
            <div className="td-dialog-row" style={{ display: 'block' }}>
              <span className="td-dialog-label" style={{ textTransform: 'none', lineHeight: 1.5 }}>
                {UNDO_WARNING_MESSAGE}
              </span>
            </div>
            <div className="td-dialog-actions">
              <button className="td-btn" onClick={handleCancelUndo}>CANCEL</button>
              <button className="td-btn td-btn-amber" onClick={handleConfirmUndo}>YES</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
