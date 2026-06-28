import { useRef } from "react";

// Lightweight touch-swipe detection. Returns handler props to spread onto an
// element; the matching callback fires when a quick, dominant directional swipe
// is released. A swipe only counts when it clearly out-runs the other axis, so
// normal vertical scrolling (and horizontal content) is left untouched.
//
// Touch only — these are finger swipes. Desktop keeps the existing buttons, and
// binding mouse drag here would hijack text selection and clicks.
export default function useSwipe({ onLeft, onRight, onUp, onDown, threshold = 56 } = {}) {
  const start = useRef(null);

  const onTouchStart = (e) => {
    // Ignore multi-touch (pinch/zoom) — only single-finger swipes navigate.
    if (e.touches.length !== 1) { start.current = null; return; }
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };

  const onTouchEnd = (e) => {
    const s = start.current;
    start.current = null;
    const t = e.changedTouches && e.changedTouches[0];
    if (!s || !t) return;
    if (Date.now() - s.t > 700) return; // too slow to read as a swipe
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx > ady && adx > threshold) {
      const fn = dx < 0 ? onLeft : onRight;
      if (fn) fn();
    } else if (ady > adx && ady > threshold) {
      const fn = dy < 0 ? onUp : onDown;
      if (fn) fn();
    }
  };

  return { onTouchStart, onTouchEnd };
}
