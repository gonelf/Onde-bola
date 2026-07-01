/*
 * remotion/Root — registers the DailyReel composition: a 1080×1920 (9:16)
 * animated version of the /og/today story card, rendered to mp4 for Instagram/
 * Facebook Reels. Props are display-ready (built by scripts/reel-cron.mjs from
 * the same feeds + selection the image cards use); the composition is pure
 * presentation. Duration scales with the number of games via calculateMetadata.
 */

import React from "react";
import { Composition } from "remotion";
import { DailyReel, FPS, INTRO_FRAMES, ROW_STAGGER, TAIL_FRAMES } from "./DailyReel.jsx";

// Sample props so `remotion studio` shows something meaningful without a feed.
const SAMPLE = {
  brand: { head: "Hoje Há", tail: "Bola", domain: "hojehabola.com" },
  title: "Jogos de hoje!",
  dateLabel: "qua., 01 jul. 2026",
  footer: "Vê todos os jogos e onde ver na TV",
  games: [
    { home: "Benfica", away: "FC Porto", homeBadge: "", awayBadge: "", competition: "Liga Portugal", state: "scheduled", time: "20:45", homeScore: "", awayScore: "", channel: "SIC", channelPaid: false },
    { home: "Sporting CP", away: "SC Braga", homeBadge: "", awayBadge: "", competition: "Liga Portugal", state: "live", time: "63'", homeScore: "2", awayScore: "1", channel: "Sport TV 1", channelPaid: true },
    { home: "Real Madrid", away: "Barcelona", homeBadge: "", awayBadge: "", competition: "La Liga", state: "finished", time: "", homeScore: "1", awayScore: "3", channel: "", channelPaid: false },
  ],
};

export function reelDuration(games) {
  const n = Math.max(1, (games || []).length);
  return INTRO_FRAMES + n * ROW_STAGGER + TAIL_FRAMES;
}

export const RemotionRoot = () => {
  return (
    <Composition
      id="DailyReel"
      component={DailyReel}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={reelDuration(SAMPLE.games)}
      defaultProps={SAMPLE}
      calculateMetadata={({ props }) => ({
        durationInFrames: reelDuration(props.games),
      })}
    />
  );
};
