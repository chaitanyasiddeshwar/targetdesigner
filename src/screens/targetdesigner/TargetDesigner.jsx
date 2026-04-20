import React, { useEffect } from 'react';
import AppBar from '../../components/AppBar.jsx';
import ScreenHintModal, { HintSection, HintItem, HintBadge, HintTrigger } from '../../components/ScreenHintModal.jsx';
import { TDProvider, useTDDispatch } from './TargetDesignerContext.jsx';
import CurveCanvas from './CurveCanvas.jsx';
import * as tdApi from '../../services/tdApi.js';
import './TargetDesigner.css';

function TargetDesignerInner({ config, onBack }) {
  const dispatch = useTDDispatch();

  useEffect(() => {
    tdApi
      .listTargetCurves()
      .then((presets) => {
        dispatch({ type: 'SET_PRESETS', presets });
      })
      .catch(() => {});
  }, [dispatch]);

  return (
    <div className="td-screen">
      <ScreenHintModal screenId="targetdesigner" title="Target Designer Workflow Guide">
        <HintSection label="Import Curve">
          <HintItem>Choose a Template from pre-defined template dropdown or load a target curve file.</HintItem>
          <HintItem>Loading a template or target curve replaces the current baseline.</HintItem>
          <HintBadge text="Tip" color="cyan">Use Save as Template after tuning so you can quickly reload your custom baseline.</HintBadge>
        </HintSection>

        <HintSection label="Tweak The Curve">
          <HintItem>Drag curve handles directly on the graph: global, bass, mid, high, HP/LP, and PEQ handles are all movable.</HintItem>
          <HintItem>On clicking a curve handle, a contextual control panel appears - this can also be used to fine tune the curve.</HintItem>
          <HintItem>Right-click on the graph to add a PEQ point at the clicked frequency and level.</HintItem>
          <HintItem>Use "Reset Curve" to return to the currently selected template baseline.</HintItem>
          <HintBadge text="TIP" color="cyan">Use +X/-X and +Y/-Y zoom controls to zoom in/out</HintBadge>
        </HintSection>

        <HintSection label="Output">
          <HintItem>Save as Template to persist your design for quick reuse and also to be used in Optimize workflow</HintItem>
          <HintItem>Export Curve File when you need a file for downstream tools or sharing.</HintItem>
          <HintItem>Select an export resolution based on how smooth or detailed you want the output.</HintItem>
          <HintBadge text="TIP" color="cyan">Do not overwrite pre-set template files - save it with a different name</HintBadge>
        </HintSection>
      </ScreenHintModal>

      <AppBar config={config} onBack={onBack}>
        <div className="td-screen-title-wrap">
          <span className="td-screen-title">TARGET DESIGNER</span>
          <HintTrigger screenId="targetdesigner" />
        </div>
      </AppBar>
      <div className="td-main">
        <CurveCanvas />
      </div>
    </div>
  );
}

export default function TargetDesigner({ config, onBack }) {
  return (
    <TDProvider>
      <TargetDesignerInner config={config} onBack={onBack} />
    </TDProvider>
  );
}
