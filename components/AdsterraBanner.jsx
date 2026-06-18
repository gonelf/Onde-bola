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
        <iframe
          title={label}
          aria-label={label}
          width={width}
          height={height}
          loading="lazy"
          scrolling="no"
          frameBorder="0"
          style={{ border: 0, display: "block", width, height, maxWidth: "100%" }}
          srcDoc={srcDoc}
        />
      </div>
    </div>
  );
}
