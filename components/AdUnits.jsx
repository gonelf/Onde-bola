"use client";

/*
 * Renders the ad units assigned to a slot. Two kinds of unit, handled
 * differently on purpose:
 *
 * - Banner units (a "key + size" iframe network such as highperformanceformat)
 *   each get their OWN sandboxed <iframe srcDoc>. These networks read a single
 *   global `window.atOptions`, so two banners injected into the same document
 *   clobber each other's config and one (or both) fails to fill. A per-banner
 *   iframe gives each its own window — the isolation the original Adsterra
 *   component had, which was lost when ads moved to in-page injection. The
 *   iframe also lets us scale a fixed-size creative (e.g. 468x60) down to fit a
 *   narrow phone column instead of clipping it.
 *
 * - Everything else (self-placing popunder/social-bar loaders, AdSense, raw
 *   snippets) is injected imperatively after mount. Those loaders insert their
 *   own sibling <script> as a side effect of running; rendering them as JSX
 *   would execute them during the initial HTML parse and break hydration, so
 *   React only ever owns an empty container and we build the scripts by hand.
 *   We inject exactly once and never tear the subtree down on a re-render — a
 *   wipe-on-cleanup would kill a loader mid-load every time React re-ran.
 */
import { useEffect, useMemo, useRef, useState } from "react";

function bannerSrcDoc({ key, width, height, format }) {
  const opts = JSON.stringify({ key, format: format || "iframe", height, width, params: {} });
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    "<style>html,body{margin:0;padding:0;overflow:hidden}</style></head><body>" +
    "<script>atOptions = " + opts + ";<\/script>" +
    '<script src="https://www.highperformanceformat.com/' +
    encodeURIComponent(key) +
    '/invoke.js"><\/script>' +
    "</body></html>"
  );
}

// One banner in its own iframe, scaled to fit the available column width.
function BannerFrame({ banner, label = "Advertisement" }) {
  const hostRef = useRef(null);
  const [scale, setScale] = useState(1);
  const { width, height } = banner;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const avail = el.clientWidth; // the host fills the column; scale to it
      setScale(avail > 0 && avail < width ? avail / width : 1);
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    } else {
      window.addEventListener("resize", measure);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", measure);
    };
  }, [width]);

  const srcDoc = useMemo(
    () => bannerSrcDoc(banner),
    [banner.key, banner.width, banner.height, banner.format]
  );
  const fitW = Math.round(width * scale);
  const fitH = Math.round(height * scale);

  return (
    <div className="ad-unit ad-banner-frame" ref={hostRef}>
      {/* Reserves the scaled footprint; the iframe renders full-size and is
          scaled into it. */}
      <div style={{ width: fitW, height: fitH, overflow: "hidden", margin: "0 auto" }}>
        <iframe
          title={label}
          aria-label={label}
          width={width}
          height={height}
          scrolling="no"
          frameBorder="0"
          style={{
            border: 0,
            display: "block",
            width,
            height,
            transform: "scale(" + scale + ")",
            transformOrigin: "top left",
          }}
          srcDoc={srcDoc}
        />
      </div>
    </div>
  );
}

export default function AdUnits({ units }) {
  const containerRef = useRef(null);
  const injected = useRef(false);

  const banners = (units || []).filter((u) => u.banner);
  const rest = (units || []).filter((u) => !u.banner);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || injected.current || !rest.length) return;
    injected.current = true; // inject once per mount; never tear down (see top)
    rest.forEach((u) => {
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
          // Dynamically-created scripts default to async; honour the snippet's
          // declared ordering so a loader that must run after an inline setup
          // block (e.g. atOptions before invoke.js) isn't reordered ahead of it.
          el.async = !!s.async;
        } else {
          el.text = s.code || "";
        }
        root.appendChild(el);
      });
    });
  }, [rest]);

  return (
    <div className="ad-units" style={{ width: "100%" }}>
      {banners.map((u) => (
        <BannerFrame key={u.id} banner={u.banner} label={u.label || "Advertisement"} />
      ))}
      <div ref={containerRef} />
    </div>
  );
}
