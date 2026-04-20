import { createContext, useContext, useReducer } from 'react';
import { newTarget, defaultParams } from './curveEngine.js';

const RESET_VIEW = { xMin: 3, xMax: 24000, yMin: -10, yMax: 120 };

const initialState = {
  measurements: [],
  targets: [newTarget('Target 1', 0)],
  activeTarget: 0,
  presets: [],
  view: { ...RESET_VIEW },
  cursor: null,
  showGlobalControl: true,
  showCurveControls: true,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_PRESETS':
      return { ...state, presets: action.presets };
    case 'ADD_MEASUREMENT':
      return { ...state, measurements: [...state.measurements, action.measurement] };
    case 'REMOVE_MEASUREMENT':
      return { ...state, measurements: state.measurements.filter((_, i) => i !== action.index) };
    case 'TOGGLE_MEASUREMENT':
      return {
        ...state,
        measurements: state.measurements.map((m, i) =>
          i === action.index ? { ...m, visible: !m.visible } : m
        ),
      };
    case 'SOLO_MEASUREMENT': {
      const alreadySoloed = state.measurements.every((m, i) =>
        i === action.index ? m.visible : !m.visible
      );
      return {
        ...state,
        measurements: state.measurements.map((m, i) => ({
          ...m,
          visible: alreadySoloed ? true : i === action.index,
        })),
      };
    }
    case 'UPDATE_TARGET': {
      const targets = state.targets.slice();
      targets[state.activeTarget] = { ...targets[state.activeTarget], ...action.patch };
      return { ...state, targets };
    }
    case 'UPDATE_PARAMS': {
      const targets = state.targets.slice();
      const t = targets[state.activeTarget];
      targets[state.activeTarget] = { ...t, params: { ...t.params, ...action.patch } };
      return { ...state, targets };
    }
    case 'RESET_TO_TEMPLATE': {
      const targets = state.targets.slice();
      const t = targets[state.activeTarget];
      if (!t) return state;
      targets[state.activeTarget] = {
        ...t,
        params: defaultParams(),
        peqs: [],
      };
      return { ...state, targets };
    }
    case 'ADD_PEQ_AT': {
      const targets = state.targets.slice();
      const t = targets[state.activeTarget];
      const peq = action.peq || { enabled: true, f: 1000, g: 0, q: 1.4 };
      targets[state.activeTarget] = { ...t, peqs: [...t.peqs, peq] };
      return { ...state, targets };
    }
    case 'UPDATE_PEQ': {
      const targets = state.targets.slice();
      const t = targets[state.activeTarget];
      const peqs = t.peqs.slice();
      peqs[action.index] = { ...peqs[action.index], ...action.patch };
      targets[state.activeTarget] = { ...t, peqs };
      return { ...state, targets };
    }
    case 'REMOVE_PEQ': {
      const targets = state.targets.slice();
      const t = targets[state.activeTarget];
      targets[state.activeTarget] = { ...t, peqs: t.peqs.filter((_, i) => i !== action.index) };
      return { ...state, targets };
    }
    case 'SET_VIEW':
      return { ...state, view: action.view };
    case 'SET_CURSOR':
      return { ...state, cursor: action.cursor };
    case 'TOGGLE_GLOBAL_CONTROL':
      return { ...state, showGlobalControl: !state.showGlobalControl };
    case 'TOGGLE_CURVE_CONTROLS':
      return { ...state, showCurveControls: !state.showCurveControls };
    default:
      return state;
  }
}

export const TDContext = createContext(null);
export const TDDispatchContext = createContext(null);

export function TDProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <TDContext.Provider value={state}>
      <TDDispatchContext.Provider value={dispatch}>{children}</TDDispatchContext.Provider>
    </TDContext.Provider>
  );
}

export function useTD() {
  return useContext(TDContext);
}

export function useTDDispatch() {
  return useContext(TDDispatchContext);
}
