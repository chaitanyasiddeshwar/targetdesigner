import React, { useState, useEffect, useCallback } from 'react';
import { useTD, useTDDispatch } from './TargetDesignerContext.jsx';
import { COLOR_PALETTE } from './curveEngine.js';
import * as tdApi from '../../services/tdApi.js';

export default function ImportDialog({ onClose }) {
  const state = useTD();
  const dispatch = useTDDispatch();
  const [rewMeasurements, setRewMeasurements] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    tdApi
      .importFromREW()
      .then((data) => {
        const ids = Object.keys(data || {});
        if (ids.length === 0) {
          setError('No measurements found in REW.');
        } else {
          setRewMeasurements(ids.map((id) => ({ id, title: data[id].title || `Measurement ${id}` })));
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(`REW API unavailable. Ensure REW is running with API enabled on port 4735.\n${e.message}`);
        setLoading(false);
      });
  }, []);

  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = !!rewMeasurements && rewMeasurements.length > 0 && selected.size === rewMeasurements.length;

  const toggleSelectAll = useCallback(() => {
    if (!rewMeasurements || rewMeasurements.length === 0) return;
    setSelected((prev) => {
      if (prev.size === rewMeasurements.length) return new Set();
      return new Set(rewMeasurements.map((m) => m.id));
    });
  }, [rewMeasurements]);

  const handleImport = useCallback(async () => {
    if (selected.size === 0) return;
    setLoading(true);
    const REQUESTED_PPO = 48;
    let count = 0;

    for (const id of selected) {
      try {
        const url = `http://localhost:4735/measurements/${id}/frequency-response?ppo=${REQUESTED_PPO}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        const startFreq = json.startFreq;
        const actualPPO = json.ppo || REQUESTED_PPO;
        let mags = json.magnitude || json.magnitudes;

        if (typeof mags === 'string') {
          const b64 = mags.trim().replace(/-/g, '+').replace(/_/g, '/');
          const binary = atob(b64);
          const usableLen = binary.length - (binary.length % 4);
          const bytes = new Uint8Array(usableLen);
          for (let i = 0; i < usableLen; i++) bytes[i] = binary.charCodeAt(i);
          const view = new DataView(bytes.buffer);
          mags = new Float32Array(usableLen / 4);
          for (let i = 0; i < mags.length; i++) mags[i] = view.getFloat32(i * 4, false);
        }

        if (!mags || mags.length === 0) continue;

        const pts = [];
        for (let i = 0; i < mags.length; i++) {
          const spl = mags[i];
          const f = startFreq * Math.pow(2, i / actualPPO);
          if (Number.isFinite(spl) && spl > -200 && spl < 200) {
            pts.push({ f, spl });
          }
        }

        if (pts.length > 0) {
          const meas = rewMeasurements.find((m) => m.id === id);
          dispatch({
            type: 'ADD_MEASUREMENT',
            measurement: {
              name: meas?.title || `REW ${id}`,
              visible: true,
              color: COLOR_PALETTE[(state.measurements.length + count) % COLOR_PALETTE.length],
              pts,
              smoothing: '1/6',
            },
          });
          count++;
        }
      } catch (_e) {
        // Ignore individual measurement import errors and continue.
      }
    }

    setLoading(false);
    onClose();
  }, [selected, rewMeasurements, state.measurements.length, dispatch, onClose]);

  return (
    <div className="td-dialog-backdrop" onClick={onClose}>
      <div className="td-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 400 }}>
        <div className="td-dialog-title">IMPORT FROM REW</div>
        {loading && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.56rem', color: 'var(--text-dim)', padding: '16px 0', textAlign: 'center' }}>
            Connecting to REW API (localhost:4735)...
          </div>
        )}
        {error && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.52rem', color: 'var(--red)', padding: '12px 0', whiteSpace: 'pre-line' }}>
            {error}
          </div>
        )}
        {rewMeasurements && (
          <>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '2px 0 8px 0',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.56rem',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              Select All
            </label>

            <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 12 }}>
              {rewMeasurements.map((m) => (
                <label
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.56rem',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                  }}
                >
                  <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSelect(m.id)} />
                  {m.title}
                </label>
              ))}
            </div>
          </>
        )}
        <div className="td-dialog-actions">
          <button className="td-btn" onClick={onClose}>CANCEL</button>
          <button className="td-btn td-btn-cyan" disabled={selected.size === 0 || loading} onClick={handleImport}>
            IMPORT ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
