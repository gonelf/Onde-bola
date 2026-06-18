"use client";

import { useMemo } from "react";

// Renders an Adsterra "highperformanceformat" banner unit.
//
// Adsterra's invoke.js reads a global `atOptions` object to know which zone to
// serve, which means two banners on the same page would clobber each other's
// config. To keep each unit independent we run it inside its own sandboxed
// iframe (via srcDoc): every banner gets a fresh window with its own atOptions.
export default function AdsterraBanner({ zoneKey, width, height, label = "Advertisement" }) {
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

  return (
    <div className="ad-banner">
      <div className="ad-slot ad-banner-unit">
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
        <iframe
          title={label}
          aria-label={label}
          width={width}
          height={height}
          scrolling="no"
          frameBorder="0"
          style={{
            position: "relative",
            zIndex: 1,
            border: 0,
            display: "block",
            width,
            height,
            maxWidth: "100%",
          }}
          srcDoc={srcDoc}
        />
      </div>
    </div>
  );
}
