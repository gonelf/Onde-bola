/*
 * remotion/DailyReel — the animated "games of the day" reel (1080×1920, 9:16).
 * Visual language mirrors the /og/today story card (same palette, brand row,
 * panel rows with crests, free/paid channel chips) so the reel and the still
 * cards read as one family. Timeline: accent bar wipes in with the brand and
 * title, game rows spring in staggered from the right, then the footer CTA
 * fades in and the last seconds hold the full list.
 *
 * Props (display-ready, built by scripts/reel-cron.mjs):
 *   brand    { head, tail, domain }   wordmark split + public domain
 *   title    e.g. "Jogos de hoje!"
 *   dateLabel e.g. "qua., 01 jul. 2026"
 *   footer   CTA line above the domain
 *   games[]  { home, away, homeBadge, awayBadge (data URIs or ""), competition,
 *              state: "scheduled"|"live"|"finished", time, homeScore, awayScore,
 *              channel, channelPaid }
 */

import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const FPS = 30;
export const INTRO_FRAMES = 40; // brand + title in before the first row
export const ROW_STAGGER = 10; // frames between one row starting and the next
export const TAIL_FRAMES = 150; // footer in + hold on the complete list

// Same palette as the OG cards (app/og/[[...seg]]/route.js).
const COLOR = {
  bg: "#0f1722",
  panel: "#16202e",
  border: "#26384c",
  text: "#e8eef5",
  muted: "#93a4b8",
  accent: "#16d27a",
  live: "#ff5470",
  time: "#dce6ef",
  paid: "#f5b041",
};

function clamp(s, n) {
  s = (s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// A team crest (inlined data URI) or, when unavailable, a monogram disc — the
// same fallback the still cards use.
function Crest({ uri, name, size }) {
  if (uri) {
    return <Img src={uri} style={{ width: size, height: size, objectFit: "contain" }} />;
  }
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: COLOR.bg,
        border: `2px solid ${COLOR.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.42),
        fontWeight: 800,
        color: COLOR.muted,
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
}

// One team line inside a row: crest + name, and the score digit when played.
function TeamLine({ uri, name, score, showScore, bold }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <Crest uri={uri} name={name} size={64} />
      <div
        style={{
          flex: 1,
          fontSize: 40,
          fontWeight: bold ? 800 : 700,
          color: COLOR.text,
          lineHeight: 1.15,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {clamp(name, 20)}
      </div>
      {showScore ? (
        <div style={{ fontSize: 44, fontWeight: 800, color: COLOR.text, minWidth: 54, textAlign: "right" }}>
          {score === "" || score == null ? "–" : String(score)}
        </div>
      ) : null}
    </div>
  );
}

// The right rail of a row: LIVE dot + minute, kickoff time, or FT — plus the
// channel chip (green = free-to-air, amber = paid), matching the card chips.
function Rail({ g }) {
  const chip = g.channel ? (
    <div
      style={{
        fontSize: 26,
        fontWeight: 700,
        color: g.channelPaid ? COLOR.paid : COLOR.accent,
        backgroundColor: g.channelPaid ? "rgba(245,176,65,0.14)" : "rgba(22,210,122,0.14)",
        border: `1px solid ${g.channelPaid ? "rgba(245,176,65,0.3)" : "rgba(22,210,122,0.25)"}`,
        borderRadius: 999,
        padding: "6px 18px",
        maxWidth: 200,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      {clamp(g.channel, 14)}
    </div>
  ) : null;

  if (g.state === "live") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: 210 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: COLOR.live }} />
          <div style={{ fontSize: 30, fontWeight: 800, color: COLOR.live, letterSpacing: 2 }}>LIVE</div>
        </div>
        {g.time ? <div style={{ fontSize: 34, fontWeight: 700, color: COLOR.time }}>{g.time}</div> : null}
        {chip}
      </div>
    );
  }
  if (g.state === "finished") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: 210 }}>
        <div style={{ fontSize: 30, fontWeight: 800, color: COLOR.muted, letterSpacing: 2 }}>FIM</div>
        {chip}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: 210 }}>
      <div style={{ fontSize: 48, fontWeight: 800, color: COLOR.time }}>{g.time || ""}</div>
      {chip}
    </div>
  );
}

// One game row: competition eyebrow, the two team lines, and the rail — inside
// a panel card that springs in from the right.
function GameRow({ g, index, frame, fps }) {
  const start = INTRO_FRAMES + index * ROW_STAGGER;
  const drive = spring({ frame: frame - start, fps, config: { damping: 16, mass: 0.9 } });
  const x = interpolate(drive, [0, 1], [220, 0]);
  const opacity = interpolate(drive, [0, 0.6], [0, 1], { extrapolateRight: "clamp" });
  const played = g.state === "live" || g.state === "finished";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 26,
        backgroundColor: COLOR.panel,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 26,
        padding: "24px 34px",
        transform: `translateX(${x}px)`,
        opacity,
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {g.competition ? (
          <div style={{ fontSize: 24, fontWeight: 700, color: COLOR.muted, letterSpacing: 1 }}>
            {clamp(g.competition, 34)}
          </div>
        ) : null}
        <TeamLine uri={g.homeBadge} name={g.home} score={g.homeScore} showScore={played} />
        <TeamLine uri={g.awayBadge} name={g.away} score={g.awayScore} showScore={played} />
      </div>
      <Rail g={g} />
    </div>
  );
}

export const DailyReel = ({ brand, title, dateLabel, footer, games }) => {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames } = useVideoConfig();
  const list = Array.isArray(games) ? games : [];

  // Header: accent bar wipes across, brand + title fade/slide up.
  const barW = interpolate(frame, [0, 18], [0, width], { extrapolateRight: "clamp" });
  const headIn = spring({ frame, fps, config: { damping: 18 } });
  const headY = interpolate(headIn, [0, 1], [40, 0]);

  // Footer: in once the last row has landed; the domain gently pulses on hold.
  const footerStart = INTRO_FRAMES + list.length * ROW_STAGGER + 30;
  const footerIn = interpolate(frame, [footerStart, footerStart + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulse = 1 + 0.02 * Math.sin(((frame - footerStart) / fps) * Math.PI * 1.5);

  // Fade the whole reel out over the last half-second so the loop point is soft.
  const fadeOut = interpolate(frame, [durationInFrames - 15, durationInFrames - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bg, fontFamily: "sans-serif", opacity: fadeOut }}>
      <div style={{ width: barW, height: 16, backgroundColor: COLOR.accent }} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "64px 64px 56px" }}>
        <div style={{ transform: `translateY(${headY}px)`, opacity: headIn }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: COLOR.accent }} />
            <div style={{ fontSize: 42, fontWeight: 800, color: COLOR.text }}>
              {brand?.head ? brand.head + " " : ""}
              <span style={{ color: COLOR.accent }}>{brand?.tail || ""}</span>
            </div>
          </div>
          <div style={{ fontSize: 66, fontWeight: 800, color: COLOR.text, marginTop: 26 }}>{title}</div>
          <div style={{ fontSize: 38, fontWeight: 600, color: COLOR.muted, marginTop: 8 }}>{dateLabel}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 18, marginTop: 40, flex: 1 }}>
          {list.map((g, i) => (
            <GameRow key={i} g={g} index={i} frame={frame} fps={fps} />
          ))}
        </div>

        <div style={{ opacity: footerIn, textAlign: "center", marginTop: 36 }}>
          <div style={{ fontSize: 32, fontWeight: 600, color: COLOR.muted }}>{footer}</div>
          <div
            style={{
              fontSize: 46,
              fontWeight: 800,
              color: COLOR.accent,
              marginTop: 10,
              transform: `scale(${footerIn ? pulse : 1})`,
            }}
          >
            {brand?.domain || ""}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
