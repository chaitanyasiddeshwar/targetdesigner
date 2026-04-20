import React, { useState, useCallback } from 'react';
import { useTD } from './TargetDesignerContext.jsx';
import { generateExportText } from './curveEngine.js';
import * as tdApi from '../../services/tdApi.js';

export default function ExportDialog({ onClose }) {
  const state = useTD();
  const [resolution, setResolution] = useState('1/24');

  const target = state.targets[state.activeTarget];

  const handleExport = useCallback(async () => {
    if (!target) return;
    const text = generateExportText(target, resolution);
    const safeName = (target.name || 'target').replace(/[^a-zA-Z0-9\-_]/g, '_');
    await tdApi.exportTargetCurve(text, `${safeName}.txt`);
    onClose();
  }, [target, resolution, onClose]);

  return (
    <div className="td-dialog-backdrop" onClick={onClose}>
      <div className="td-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="td-dialog-title">EXPORT TARGET CURVE</div>
        <div className="td-dialog-row">
          <span className="td-dialog-label">Resolution</span>
          <select className="td-dialog-select" value={resolution} onChange={(e) => setResolution(e.target.value)}>
            <option value="1hz">1 Hz (No Smoothing)</option>
            <option value="1/6">1/6 Oct (High)</option>
            <option value="1/12">1/12 Oct (Medium)</option>
            <option value="1/24">1/24 Oct (Low)</option>
          </select>
        </div>
        <div className="td-dialog-actions">
          <button className="td-btn" onClick={onClose}>CANCEL</button>
          <button className="td-btn td-btn-amber" onClick={handleExport}>EXPORT</button>
        </div>
      </div>
    </div>
  );
}
