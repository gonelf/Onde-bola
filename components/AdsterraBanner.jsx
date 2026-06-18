"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Renders an Adsterra "highperformanceformat" banner unit.
//
// Adsterra's invoke.js reads a global `atOptions` object to know which zone to
// serve, which means two banners on the same page would clobber each other's
// config. To keep each unit independent we run it inside its own sandboxed
// iframe (via srcDoc): every banner gets a fresh window with its own atOptions.
//
// Fixed-size creatives (e.g. 468x60) are wider than a phone column, so we scale
// the unit down to fit the available width instead of letting it overflow/clip.
// For a crisper result, point a narrow viewport at a dedicated 320x50 zone.
export default function AdsterraBanner({ zoneKey, width, height, label = "Advertisement" }) {
  const slotRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = slotRef.current;
    if (!zoneKey || !el) return;
    const measure = () => {
      const avail = el.clientWidth; // banner slots have no horizontal padding
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
  }, [zoneKey, width]);

  const srcDoc = useMemo(() => {
    if (!zoneKey) return "";
    const opts = JSON.stringify({ key: zoneKey, format: "iframe", height, width, params: {} });
    return (
      '<!doctype html><html><head><meta charset="utf-8">' +
      "<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}" +
      "body{display:flex;align-items:center;justify-content:center}</style></head><body>" +
      '<script type="text/javascript">atOptions=' + opts + ";<\/script>" +
      '<script type="text/javascript" src="https://www.highperformanceformat.com/' +
      zoneKey + '/invoke.js"><\/script>' +
      "</body></html>"
    );
  }, [zoneKey, width, height]);

  if (!zoneKey) return null;

  const fitW = Math.round(width * scale);
  const fitH = Math.round(height * scale);

  return (
    <div className="ad-banner">
      <div className="ad-slot ad-banner-unit" ref={slotRef}>
        <span className="ad-label">Ad</span>
        {/* Sits behind the iframe; the ad covers it once Adsterra fills the
            zone. If it stays visible, the slot renders but the network served
            nothing (usually a domain-approval or activation issue). */}
        <span
          className="ad-ph-text"
          aria-hidden="true"
          style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        >
          {width}×{height}
        </span>
        {/* Outer box takes the scaled footprint so the page reserves the right
            space; the iframe renders at full size and is scaled into it. */}
        <div style={{ position: "relative", zIndex: 1, width: fitW, height: fitH, overflow: "hidden" }}>
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
    </div>
  );
}
