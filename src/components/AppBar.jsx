import React from 'react';
import './AppBar.css';

function brandColor(config) {
  const text = (
    (config?.manufacturer    || '') + ' ' +
    (config?.targetModelName || '') + ' ' +
    (config?.modelName       || '')
  ).toLowerCase();
  if (text.includes('denon'))   return '#cc2200';
  if (text.includes('marantz')) return '#c5a028';
  return 'var(--cyan)';
}

function brandLogo(config) {
  const text = ((config?.manufacturer || '') + ' ' + (config?.targetModelName || '')).toLowerCase();
  if (text.includes('denon'))   return './logos/Denon.svg';
  if (text.includes('marantz')) return './logos/Marantz.svg';
  return null;
}

function brandLabel(config) {
  if (config?.manufacturer) return config.manufacturer.toUpperCase();
  return (config?.targetModelName || 'AVR').split(/[\s-]/)[0].toUpperCase();
}

export default function AppBar({ config, onBack, children, disableBack = false }) {
  const api      = window.electronAPI;
  const hasNativeWindowControls = !!(api?.windowMinimize || api?.windowClose);
  const canOpenGeneratedDirectory = !!api?.openGeneratedDirectory;
  const bc       = brandColor(config);
  const logoSrc  = brandLogo(config);
  const model    = config?.targetModelName || config?.modelName || '';
  const ip       = config?.ipAddress || '';

  const handleOpenGeneratedDirectory = async () => {
    await api?.openGeneratedDirectory?.();
  };

  return (
    <div className="app-bar">
      {/* Back arrow — extreme left, styled like chart-back-btn */}
      {onBack && (
        <button
          className={`app-bar-back${disableBack ? ' disabled' : ''}`}
          onClick={onBack}
          title="Back"
          aria-label="Go back"
          disabled={disableBack}
        >
          ‹
        </button>
      )}

      {/* AVR identity — only when connected */}
      {config && (
        <>
          {logoSrc
            ? <img src={logoSrc} alt={brandLabel(config)} className="app-bar-logo" />
            : <span className="app-bar-brand" style={{ color: bc }}>{brandLabel(config)}</span>
          }
          {model && <span className="app-bar-model">{model}</span>}
          {ip    && <span className="app-bar-ip">{ip}</span>}
          <div className="app-bar-dot" />
          <span className="app-bar-connected">CONNECTED</span>
        </>
      )}

      {/* Screen-specific controls */}
      {children && <div className="app-bar-divider" />}
      {children}

      {canOpenGeneratedDirectory && (
        <button
          className="app-bar-toolbtn"
          onClick={handleOpenGeneratedDirectory}
          title="Open working folder"
          aria-label="Open working folder"
        >
          <svg viewBox="0 0 24 24" className="app-bar-toolbtn-icon" aria-hidden="true">
            <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1H3V6zm0 4h20l-2 8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8z" />
          </svg>
        </button>
      )}

      {/* Window controls — always, pinned to right */}
      {hasNativeWindowControls && (
        <div className="app-bar-winctrls">
          <button
            className="app-bar-winbtn app-bar-minimize"
            onClick={() => api?.windowMinimize()}
            title="Minimize"
          >
            <span className="app-bar-winbtn-icon">&#8722;</span>
          </button>
          <button
            className="app-bar-winbtn app-bar-close"
            onClick={() => api?.windowClose()}
            title="Close"
          >
            <span className="app-bar-winbtn-icon">&#215;</span>
          </button>
        </div>
      )}
    </div>
  );
}
