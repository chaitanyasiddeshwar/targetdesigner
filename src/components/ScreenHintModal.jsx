import React, { useEffect, useRef, useState } from 'react';
import './ScreenHintModal.css';

// Module-level registry: screenId → open()
// Lets HintTrigger call open() without prop-drilling or wrapping context.
const registry = {};

// ── Sub-components ──────────────────────────────────────────

export function HintSection({ label, children }) {
  return (
    <div className="shm-section">
      {label && <div className="shm-section-label">{label}</div>}
      {children}
    </div>
  );
}

export function HintItem({ children }) {
  return (
    <div className="shm-item">
      <span className="shm-item-bullet">•</span>
      <span>{children}</span>
    </div>
  );
}

export function HintBadge({ text, color = 'cyan', children }) {
  return (
    <div className="shm-badge-row">
      <span className={`shm-badge ${color}`}>{text}</span>
      <span>{children}</span>
    </div>
  );
}

/**
 * Standalone ⓘ icon that re-opens the modal for the given screen.
 * Place as a sibling to the right of the Start button — never inside a <button>.
 *
 * @param {string} screenId  Must match the screenId passed to <ScreenHintModal>.
 */
export function HintTrigger({ screenId }) {
  function handleClick(e) {
    e.stopPropagation();
    registry[screenId]?.();
  }
  return (
    <button
      className="shm-trigger"
      onClick={handleClick}
      title="Show guide"
      aria-label="Open setup guide"
    >
      i
    </button>
  );
}

// ── Main modal ──────────────────────────────────────────────

/**
 * Screen-level hint modal.
 *
 * Auto-shows on mount unless the user has previously dismissed with
 * "Don't show again". Preference stored in localStorage per screenId.
 *
 * To edit what is shown: find <ScreenHintModal> in the screen file and
 * modify the <HintSection> / <HintItem> / <HintBadge> children.
 *
 * To reset a dismissed preference: localStorage.removeItem('hint_dismissed_<screenId>')
 */
export default function ScreenHintModal({ screenId, title, children }) {
  const storageKey = `hint_dismissed_${screenId}`;
  const [visible, setVisible] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const overlayRef = useRef(null);

  // Register open() in module registry so HintTrigger can reach it
  useEffect(() => {
    registry[screenId] = open;
    return () => { delete registry[screenId]; };
  }, [screenId]);

  // Auto-show on mount unless dismissed
  useEffect(() => {
    if (localStorage.getItem(storageKey) !== 'true') {
      setVisible(true);
    }
  }, [storageKey]);

  // Escape to close (without persisting)
  useEffect(() => {
    if (!visible) return;
    function onKey(e) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible]);

  function open() {
    // Reflect actual stored preference so user can see and change it
    setDontShowAgain(localStorage.getItem(storageKey) === 'true');
    setVisible(true);
  }

  function handleClose(saveState) {
    setVisible(false);
    if (saveState === undefined) return; // bare close (✕ / Escape) — don't touch storage
    if (saveState) {
      localStorage.setItem(storageKey, 'true');
    } else {
      localStorage.removeItem(storageKey);
    }
  }

  function handleOk() {
    handleClose(dontShowAgain);
  }

  if (!visible) return null;

  return (
    <div
      className="shm-overlay"
      ref={overlayRef}
      onMouseDown={(e) => { if (e.target === overlayRef.current) handleClose(); }}
    >
      <div className="shm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="shm-header">
          <span className="shm-header-icon">⬡</span>
          <span className="shm-title">{title}</span>
          <button className="shm-close" onClick={() => handleClose()} aria-label="Close">✕</button>
        </div>
        <div className="shm-body">
          {children}
        </div>
        <div className="shm-footer">
          <div className="shm-dsa-row" onClick={() => setDontShowAgain(v => !v)}>
            <div className={`shm-pill-toggle${dontShowAgain ? ' on' : ''}`}>
              <div className="shm-pill-thumb" />
            </div>
            <span className="shm-dsa-label">Don't show again</span>
          </div>
          <button className="shm-ok" onClick={handleOk}>OK</button>
        </div>
      </div>
    </div>
  );
}
