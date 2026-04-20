import React, { useState, useEffect, useRef } from 'react';
import './InfoTip.css';

// Module-level singleton — only one InfoTip open at a time.
let closeCurrentTip = null;

export default function InfoTip({ title, children, wide }) {
  const [open, setOpen] = useState(false);
  const [popStyle, setPopStyle] = useState(null);
  const popRef = useRef(null);
  const iconRef = useRef(null);

  function openTip() {
    if (closeCurrentTip && closeCurrentTip !== closeSelf) {
      closeCurrentTip();
    }
    closeCurrentTip = closeSelf;
    setPopStyle(null);
    setOpen(true);
  }

  function closeSelf() {
    setOpen(false);
    if (closeCurrentTip === closeSelf) closeCurrentTip = null;
  }

  function toggle() {
    if (open) closeSelf();
    else openTip();
  }

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      if (
        popRef.current && !popRef.current.contains(e.target) &&
        iconRef.current && !iconRef.current.contains(e.target)
      ) {
        closeSelf();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const GAP = 6;
    const EDGE = 8;

    const updatePosition = () => {
      if (!popRef.current || !iconRef.current) return;

      const iconRect = iconRef.current.getBoundingClientRect();
      const popRect = popRef.current.getBoundingClientRect();

      const spaceBelow = window.innerHeight - iconRect.bottom - GAP - EDGE;
      const spaceAbove = iconRect.top - GAP - EDGE;
      const placeAbove = popRect.height > spaceBelow && spaceAbove > spaceBelow;

      let top = placeAbove
        ? iconRect.top - popRect.height - GAP
        : iconRect.bottom + GAP;
      let left = iconRect.left;

      if (left + popRect.width + EDGE > window.innerWidth) {
        left = iconRect.right - popRect.width;
      }

      left = Math.max(EDGE, Math.min(left, window.innerWidth - popRect.width - EDGE));
      top = Math.max(EDGE, Math.min(top, window.innerHeight - popRect.height - EDGE));

      const maxHeight = placeAbove
        ? Math.max(120, iconRect.top - GAP - EDGE)
        : Math.max(120, window.innerHeight - iconRect.bottom - GAP - EDGE);

      setPopStyle({
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        maxHeight: `${Math.round(maxHeight)}px`,
        overflowY: 'auto',
      });
    };

    const rafId = requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, wide, title, children]);

  // Clean up singleton ref on unmount
  useEffect(() => {
    return () => {
      if (closeCurrentTip === closeSelf) closeCurrentTip = null;
    };
  }, []);

  return (
    <span className="infotip-wrap">
      <span
        ref={iconRef}
        className={`infotip-icon${open ? ' open' : ''}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
        title={title || 'Info'}
      >
        i
      </span>
      {open && (
        <span ref={popRef} className={`infotip-pop${wide ? ' wide' : ''}`} style={popStyle || { visibility: 'hidden' }}>
          {title && (
            <div className="infotip-pop-header">
              <span className="infotip-pop-title">{title}</span>
              <span className="infotip-pop-close" onClick={closeSelf}>✕</span>
            </div>
          )}
          {children}
        </span>
      )}
    </span>
  );
}
