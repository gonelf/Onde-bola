"use client";

/*
 * Injects parsed ad-unit markup/scripts into the DOM after mount.
 *
 * This runs outside React's render/hydration cycle on purpose: self-placing
 * loaders (e.g. the default popunder units) mutate the DOM as a side effect
 * of executing — they insert their own sibling <script> next to themselves.
 * When that markup was rendered directly as JSX, the browser ran it during
 * the initial HTML parse, and by the time React hydrated, the live DOM no
 * longer matched what was server-rendered. React then discarded and
 * re-rendered the whole ad subtree on every load, which is a likely reason
 * ads were unreliable. Building the elements imperatively here means React
 * only ever owns an empty container, so there's nothing for it to mismatch.
 */
import { useEffect, useRef } from "react";

export default function AdUnits({ units }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || !units || !units.length) return;
    units.forEach((u) => {
      if (u.html) {
        const box = document.createElement("div");
        box.className = "ad-unit";
        box.innerHTML = u.html;
        root.appendChild(box);
      }
      (u.scripts || []).forEach((s) => {
        const el = document.createElement("script");
        if (s.src) {
          el.src = s.src;
          if (s.async) el.async = true;
        } else {
          el.text = s.code || "";
        }
        root.appendChild(el);
      });
    });
    return () => {
      root.innerHTML = "";
    };
  }, [units]);

  return <div ref={ref} />;
}
