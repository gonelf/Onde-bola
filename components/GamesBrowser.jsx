"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isPaidChannel } from "@/lib/broadcasters";
import { langFor, makeT, localeFor } from "@/lib/i18n";
import { DEFAULT_BRAND, brandForHost } from "@/lib/brand";
import {
  ymd, isSameDay, parseYmd, formatClock, statusOf, hasScore, shareLink, leagueSlugFor,
} from "@/lib/format";
import {
  CODE_TO_COUNTRY, countryFlag, initials, orderCountries, orderChannels,
  groupByCountry, compRank, ytIdOf, highlightLink,
  fetchFotMobFixtures, fetchTv, attachTv, fetchFotMobDay, fetchRichListings,
  mergeTv, teamMatch, fetchStandings,
  ensureEventTv, ensureDetails, loadHighlights, loadedTv, detailsCache,
} from "@/lib/app-data";
import { normName } from "@/lib/format";
import { prepEvents, maxMinute, addShotEvents, addPhaseEvents, DEFAULT_CONFIG } from "@/public/admin/replay-sim";
import MatchPitch from "@/components/MatchPitch";
import AdUnits from "@/components/AdUnits";
import SoccerBall from "@/components/SoccerBall";
import useSwipe from "@/components/useSwipe";
import useReplayClock from "@/components/useReplayClock";
import { useReplaySound } from "@/components/replaySounds";

const STORAGE_HIDDEN = "ondebola.hiddenLeagues";
const STORAGE_REMEMBER = "ondebola.rememberFilters";
const STORAGE_COUNTRY = "ondebola.primaryCountry";
const MAX_CARD_CHIPS = 3;

// Refresh cadence: poll faster while games are live (the live ticker needs
// fresh scores/minutes), and fall back to a slower idle rate otherwise.
const LIVE_REFRESH_MS = 20000;
const IDLE_REFRESH_MS = 60000;

const origin = () => (typeof window !== "undefined" ? window.location.origin : "https://hojehabola.com");

// ---- Small presentational bits -----------------------------------------

function Badge({ url, name }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  return <span className="badge-fallback">{initials(name)}</span>;
}

function LeagueLogo({ url, name }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return <img className="league-logo" src={url} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  return <span className="league-logo league-fallback">{initials(name)}</span>;
}

function ChannelChip({ name, t }) {
  const paid = isPaidChannel(name);
  return (
    <span className={"channel " + (paid ? "paid" : "free")} title={paid ? t("paidSub") : t("freeAir")}>
      {paid ? <span className="lock" aria-hidden="true">🔒</span> : null}
      {name}
    </span>
  );
}

// A single admin-managed ad unit injected inside a client island (the in-feed
// list or the detail modal), styled to sit within the card layout. Its scripts
// run via <AdUnits>; the units array is memoized so a parent re-render (e.g. a
// refresh tick) doesn't re-inject and reload the creative.
function AdCard({ unit, slot, className }) {
  const units = useMemo(() => [unit], [unit]);
  if (!unit) return null;
  return (
    <div className={"ad-slot ad-card ad-slot-" + slot + (className ? " " + className : "")} data-ad-slot={slot}>
      <span className="ad-label">Ad</span>
      <AdUnits units={units} />
    </div>
  );
}

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
  </svg>
);

// Native share sheet where available, else copy the link to the clipboard.
function shareMatch(fx, onCopied) {
  if (!fx) return;
  const url = shareLink(fx, origin());
  const title = fx.home + " vs " + fx.away;
  const text = title + (fx.competition ? " — " + fx.competition : "");
  if (navigator.share) {
    navigator.share({ title, text, url }).catch(() => {});
    return;
  }
  const confirm = () => onCopied && onCopied();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(confirm, () => {
      if (legacyCopy(url)) confirm();
    });
  } else if (legacyCopy(url)) {
    confirm();
  }
}

function legacyCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch (e) {
    return false;
  }
}

// ---- Competition classification (league table) -------------------------

// FotMob team-logo URLs embed the team id (…/teamlogo/<id>.png); pull it out so
// we can highlight the two clubs of the opened match in the table.
function teamIdFromBadge(url) {
  const m = String(url || "").match(/teamlogo\/(\d+)/);
  return m ? m[1] : "";
}

// Does a FotMob group name ("Group A", "Grupo B") refer to the match's group
// letter (fx.group, e.g. "A")? Tolerates language + spacing differences.
function groupMatches(groupName, letter) {
  if (!letter) return false;
  const n = String(groupName || "").toUpperCase().replace(/\s+/g, " ").trim();
  const L = String(letter).toUpperCase().trim();
  return n === L || n.endsWith(" " + L);
}

// The standings for one competition. A normal league is one table; group/multi-
// stage tournaments come back as several named groups. FotMob tags promotion/
// relegation rows with a colour (row.qual), rendered as a coloured edge on the
// rank cell. The two clubs of the opened match (highlightIds) are emphasised.
function StandingsTable({ loading, data, t, highlightIds = [] }) {
  if (loading) return <p className="standings-note">{t("tableLoading")}</p>;
  if (!data || !data.ok || !data.groups || !data.groups.length) {
    return <p className="standings-note">{t("tableNone")}</p>;
  }
  const hi = new Set(highlightIds.filter(Boolean).map(String));
  const multi = data.groups.length > 1;
  return (
    <div className="standings">
      {data.groups.map((g, gi) => (
        <div className="standings-group" key={gi}>
          {multi && g.name ? <div className="standings-gname">{g.name}</div> : null}
          <div className="standings-scroll">
            <table className="standings-table">
              <thead>
                <tr>
                  <th className="st-pos">{t("tblPos")}</th>
                  <th className="st-club">{t("tblClub")}</th>
                  <th title={t("tblPlayedFull")}>{t("tblP")}</th>
                  <th title={t("tblWonFull")}>{t("tblW")}</th>
                  <th title={t("tblDrawnFull")}>{t("tblD")}</th>
                  <th title={t("tblLostFull")}>{t("tblL")}</th>
                  <th title={t("tblGFFull")}>{t("tblGF")}</th>
                  <th title={t("tblGAFull")}>{t("tblGA")}</th>
                  <th title={t("tblGDFull")}>{t("tblGD")}</th>
                  <th className="st-pts" title={t("tblPtsFull")}>{t("tblPts")}</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={r.id || r.name || i} className={r.id && hi.has(String(r.id)) ? "is-team" : undefined}>
                    <td className="st-pos" style={r.qual ? { boxShadow: "inset 3px 0 0 " + r.qual } : undefined}>{r.rank || i + 1}</td>
                    <td className="st-club">{r.name}</td>
                    <td>{r.played}</td>
                    <td>{r.won}</td>
                    <td>{r.drawn}</td>
                    <td>{r.lost}</td>
                    <td>{r.gf}</td>
                    <td>{r.ga}</td>
                    <td>{r.gd > 0 ? "+" + r.gd : r.gd}</td>
                    <td className="st-pts"><b>{r.points}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// The next round of fixtures in a competition (home – kickoff/score – away).
function NextGames({ matches, locale, t }) {
  if (!matches || !matches.length) return null;
  return (
    <ul className="next-games">
      {matches.map((m, i) => {
        const played = m.finished || (m.homeScore != null && m.awayScore != null && m.started);
        const mid = played
          ? <span className="ng-score">{m.homeScore}–{m.awayScore}</span>
          : <span className="ng-time">{m.kickoff ? formatClock(new Date(m.kickoff), locale) : t("vs")}</span>;
        return (
          <li className="next-game" key={m.id || i}>
            <span className="ng-home">{m.home}</span>
            {mid}
            <span className="ng-away">{m.away}</span>
          </li>
        );
      })}
    </ul>
  );
}

// Competition-level extras for the match modal: the classification (the match's
// group only, when it's a group tournament) with both clubs highlighted, and the
// competition's next round of fixtures. Fetched once per league on open.
function CompetitionExtras({ fx, t, locale }) {
  const [state, setState] = useState({ loading: true, data: null });
  useEffect(() => {
    if (fx.leagueId == null) { setState({ loading: false, data: null }); return undefined; }
    let on = true;
    setState({ loading: true, data: null });
    fetchStandings(fx.leagueId).then((d) => { if (on) setState({ loading: false, data: d }); });
    return () => { on = false; };
  }, [fx.leagueId]);

  if (fx.leagueId == null) return null;
  const { loading, data } = state;

  // Narrow a grouped tournament's table to the match's own group.
  let tableData = data;
  if (data && data.groups && data.groups.length > 1 && fx.group) {
    const g = data.groups.find((gr) => groupMatches(gr.name, fx.group));
    if (g) tableData = { ...data, groups: [g] };
  }
  const hasTable = data && data.ok && data.groups && data.groups.length;
  const next = (data && data.next && data.next.matches) || [];
  const highlightIds = [teamIdFromBadge(fx.homeBadge), teamIdFromBadge(fx.awayBadge)];

  return (
    <>
      {loading || hasTable ? (
        <>
          <h3 className="detail-h">{t("tableShow")}</h3>
          <StandingsTable loading={loading} data={tableData} t={t} highlightIds={highlightIds} />
          {hasTable ? (
            <div className="champ-link-row">
              <a className="champ-link" href={"/g/" + leagueSlugFor(fx.competition, fx.kickoff)}>
                {t("championshipPage")}
              </a>
            </div>
          ) : null}
        </>
      ) : null}
      {next.length ? (
        <>
          <h3 className="detail-h">{t("nextGames")}</h3>
          <NextGames matches={next} locale={locale} t={t} />
        </>
      ) : null}
    </>
  );
}

// ---- Card channel summary ----------------------------------------------

function CardChannels({ fx, t, primaryCountry }) {
  if (!(fx.tv && fx.tv.length)) {
    return <span className="channel none">{t("noListing")}</span>;
  }
  const byCountry = groupByCountry(fx.tv);
  const ordered = orderCountries(Object.keys(byCountry), primaryCountry);
  const lead = byCountry[primaryCountry] ? primaryCountry : ordered[0];
  const leadChannels = orderChannels(byCountry[lead]);
  const chips = leadChannels.slice(0, MAX_CARD_CHIPS);
  const hiddenChips = leadChannels.length - MAX_CARD_CHIPS;
  const others = ordered.filter((c) => c !== lead).length;
  return (
    <>
      <span className="src-tag real" title={t("realListings")}>{t("listings")}</span>
      <span className="country-group" title={lead}>
        <span className="flag">{countryFlag(lead)}</span>
        {chips.map((c) => <ChannelChip key={c} name={c} t={t} />)}
        {hiddenChips > 0 ? <span className="channel more-inline">+{hiddenChips}</span> : null}
      </span>
      {others ? (
        <span className="more-countries">+{others} {others === 1 ? t("moreOne") : t("moreMany")}</span>
      ) : null}
    </>
  );
}

// ---- Game card ----------------------------------------------------------

function TimeCell({ fx, t, locale }) {
  const st = statusOf(fx, t);
  const clock = formatClock(new Date(fx.kickoff), locale);
  return (
    <>
      <div className="clock">{clock}</div>
      {st.state === "live" ? <span className="live">{st.label || "LIVE"}</span> : null}
      {st.state === "finished" ? <span className="ft">{st.label || "FT"}</span> : null}
    </>
  );
}

function Score({ fx, side, t }) {
  if (!hasScore(fx)) return null;
  if (statusOf(fx, t).state === "upcoming") return null;
  return <span className="score">{side === "home" ? fx.homeScore : fx.awayScore}</span>;
}

function GameCard({ fx, t, locale, primaryCountry, highlightsById, onOpen, onShare }) {
  const st = statusOf(fx, t);
  const hl = highlightLink(fx, highlightsById);
  const href = shareLink(fx, origin());
  const onClick = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    e.preventDefault();
    onOpen(fx.id);
  };
  return (
    <article className={"match" + (st.state === "live" ? " is-live" : "")} data-id={fx.id}>
      <button className="share-btn" type="button" aria-label={t("shareGame")} title={t("shareGame")}
        onClick={(e) => { e.stopPropagation(); onShare(fx, e.currentTarget); }}>
        <ShareIcon />
      </button>
      <a className="match-link" href={href} aria-label={fx.home + " vs " + fx.away} onClick={onClick}>
        <div className="match-time">
          <TimeCell fx={fx} t={t} locale={locale} />
          {fx.group ? <span className="match-group">{t("group") + " " + fx.group}</span> : null}
        </div>
        <div className="teams">
          <div className="team">
            <Badge url={fx.homeBadge} name={fx.home} />
            <span className="team-name">{fx.home}</span>
            <Score fx={fx} side="home" t={t} />
          </div>
          <div className="team">
            <Badge url={fx.awayBadge} name={fx.away} />
            <span className="team-name">{fx.away}</span>
            <Score fx={fx} side="away" t={t} />
          </div>
        </div>
      </a>
      <div className="channels">
        {hl ? (
          <a className="hl-card-btn" href={hl} target="_blank" rel="noopener"
            aria-label={t("hlCardAria")} onClick={(e) => e.stopPropagation()}>▶ {t("hlCard")}</a>
        ) : null}
        <CardChannels fx={fx} t={t} primaryCountry={primaryCountry} />
      </div>
      <span className="details-hint">{t("clickDetails")}</span>
    </article>
  );
}

// ---- Detail modal -------------------------------------------------------

const STAT_LABEL = { possession: "stPossession", shots: "stShots", sot: "stSot",
  xg: "stXg", corners: "stCorners", fouls: "stFouls" };
const EVENT_ICON = { goal: "⚽", owngoal: "⚽", pengoal: "⚽", yellow: "🟨", red: "🟥", sub: "🔁" };

function FormPills({ arr, t }) {
  if (!arr || !arr.length) return <span className="muted">—</span>;
  return arr.map((r, i) => {
    const cls = r === "W" ? "w" : r === "L" ? "l" : "d";
    const label = r === "W" ? t("mdW") : r === "L" ? t("mdL") : t("mdD");
    return <span key={i} className={"form-pill " + cls}>{label}</span>;
  });
}

function EventRow({ ev, scoreStr, active }) {
  const kindCls = (ev.kind === "yellow" || ev.kind === "red") ? "card "
    : ev.kind === "sub" ? "sub " : "goal ";
  const side = ev.side === "away" ? "away" : "home";
  return (
    <div className={"event-row " + side + (active ? " active" : "")}>
      <span className="event-min">{ev.min || ""}</span>
      <span className={"event-icon " + kindCls + ev.kind}>
        {EVENT_ICON[ev.kind] === "⚽" ? <SoccerBall className="event-ball" /> : (EVENT_ICON[ev.kind] || "•")}
        {scoreStr ? <b>{scoreStr}</b> : null}
      </span>
      <span className="event-text">
        <span className="event-player">{ev.player || ""}</span>
        {ev.kind === "owngoal" ? <span className="event-note"> (OG)</span> : null}
        {ev.kind === "pengoal" ? <span className="event-note"> (pen.)</span> : null}
        {ev.kind === "sub" && ev.note ? <span className="event-note"> ↔ {ev.note}</span> : null}
        {ev.kind !== "owngoal" && ev.kind !== "pengoal" && !(ev.kind === "sub") && ev.note
          ? <span className="event-note"> ({ev.note})</span> : null}
      </span>
    </div>
  );
}

// Split a FotMob stat value ("60%", "1.85", "12") into a number, its decimal
// precision and any suffix, so we can count it up while keeping the unit.
function parseStat(v) {
  const raw = String(v == null ? "" : v).trim();
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { ok: false, raw, num: 0, dec: 0, suffix: "" };
  const dec = m[1].includes(".") ? m[1].split(".")[1].length : 0;
  return { ok: true, raw, num: parseFloat(m[1]), dec, suffix: m[2] || "" };
}

// An interactive "replay" of a finished match built entirely from the data we
// already fetch: the event timeline (chronology) and the aggregate stats. A
// classic top-down pitch shows each event in its (inferred) spot as the virtual
// match clock reaches it — the ball glides from event to event, goals flash —
// while the chronology scrolls below and the stat bars fill toward full time.
// It's a stylised visual: we have no per-minute or positional data, so spots
// are inferred from kind/side and stat bars grow proportionally to elapsed time.
const BASE_DURATION_MS = 14000; // full match at game speed 1×

// Production replay settings, tuned in the admin Animation Lab and exported here.
// gameSpeed scales how fast the match clock advances (durationMs = base / gameSpeed);
// eventSpeed scales the on-pitch scene durations; trailLength is the ball trail.
const REPLAY_CONFIG = Object.assign({ gameSpeed: 0.5, eventSpeed: 1, trailLength: 2, eventFont: 1 }, DEFAULT_CONFIG);
const REPLAY_DISPLAY = { showNumbers: true, showMarkers: true, showTrail: true, showBallShadow: true };

// App-wide replay defaults saved by the owner in the admin lab (/api/replay-config).
// Fetched once and shared by every replay; falls back to REPLAY_CONFIG when unset.
let savedReplay; // undefined = not loaded yet, null = none, object = loaded
let savedReplayPromise = null;
function loadSavedReplay() {
  if (savedReplayPromise) return savedReplayPromise;
  savedReplayPromise = fetch("/api/replay-config")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { savedReplay = (j && j.config) || null; return savedReplay; })
    .catch(() => { savedReplay = null; return null; });
  return savedReplayPromise;
}

function MatchReplay({ fx, d, t }) {
  const stats = d.stats || [];
  const events = useMemo(() => {
    const base = prepEvents(d.events);
    const mm = maxMinute(base);
    const withShots = addShotEvents(base, d.stats || [], mm, base.length * 131 + Math.round(mm) * 7);
    return addPhaseEvents(withShots, mm);
  }, [d]);
  const maxMin = useMemo(() => maxMinute(events), [events]);

  // Team descriptors for the shared pitch (formation + kit colour from FotMob).
  const pitchHome = { name: fx.home, formation: d.lineups && d.lineups.home,
    color: d.lineups && d.lineups.home && d.lineups.home.kit && d.lineups.home.kit.shirt };
  const pitchAway = { name: fx.away, formation: d.lineups && d.lineups.away,
    color: d.lineups && d.lineups.away && d.lineups.away.kit && d.lineups.away.kit.shirt };

  // App-wide saved defaults (owner-tuned in the admin lab), merged over the
  // built-in config; falls back to the built-ins until/if the fetch resolves.
  const [saved, setSaved] = useState(savedReplay);
  useEffect(() => {
    if (savedReplay !== undefined) { setSaved(savedReplay); return undefined; }
    let on = true;
    loadSavedReplay().then((c) => { if (on) setSaved(c); });
    return () => { on = false; };
  }, []);
  const cfg = saved && saved.cfg ? Object.assign({}, REPLAY_CONFIG, saved.cfg) : REPLAY_CONFIG;
  const disp = (saved && saved.display) || REPLAY_DISPLAY;

  // Playback clock — defaults to full time; pauses on each event for its scene.
  // Game speed scales playback; event speed scales the on-pitch scene durations.
  const feedRef = useRef(null);
  const sceneScale = 1 / (cfg.eventSpeed || 1);
  const durationMs = BASE_DURATION_MS / (cfg.gameSpeed || 1);
  const { clock, playing, celebrating, toggle, restart, scrub } = useReplayClock(events, maxMin, durationMs, sceneScale);
  const onScrub = (e) => scrub(Number(e.target.value));

  // Event SFX + background music (off by default; the toggle/▶ are user gestures
  // that unlock audio). Goal roar / whistle / chime per scene, music bed while
  // playing.
  const [soundOn, setSoundOn] = useState(false);
  const { ensureAudio } = useReplaySound(celebrating, { enabled: soundOn, music: soundOn, playing, progress: maxMin > 0 ? Math.min(1, clock / maxMin) : 1, eventSounds: saved && saved.eventSounds });
  const onToggle = () => { if (soundOn) ensureAudio(); toggle(); };
  const onSound = () => { const next = !soundOn; setSoundOn(next); if (next) ensureAudio(); };

  const progress = maxMin > 0 ? Math.min(1, clock / maxMin) : 1;

  // Running scoreline + revealed events for the scoreboard and chronology feed.
  let hs = 0, as = 0;
  const shown = [];
  events.forEach((ev, i) => {
    // shots (save/miss) and match phases are pitch/scene-only, not chronology rows
    if (ev._m > clock + 1e-9 || ev.synthetic || ev.phase) return;
    let scoreStr = "";
    if (ev.kind === "goal" || ev.kind === "pengoal" || ev.kind === "owngoal") {
      const scoresHome = ev.kind === "owngoal" ? (ev.side === "away") : (ev.side === "home");
      if (scoresHome) hs++; else as++;
      scoreStr = hs + "–" + as;
    }
    shown.push({ ev, scoreStr, i });
  });

  // Keep the chronology feed scrolled to the latest revealed event.
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [shown.length]);

  const last = shown.length ? shown[shown.length - 1] : null;

  const atEnd = clock >= maxMin;
  const minNum = Math.floor(clock);
  const clockLabel = atEnd ? t("ft") : (minNum > 90 ? "90+" + (minNum - 90) : minNum) + "'";
  const scrubPct = (progress * 100).toFixed(2);

  return (
    <div className="match-replay">
      <h3 className="detail-h">{t("mdReplay")}</h3>

      <div className="replay-board">
        <span className="rb-team home" style={{ color: pitchHome.color || "#4a90d9" }}>{fx.home}</span>
        <span className="rb-score" key={hs + "-" + as}>{hs}<i>–</i>{as}</span>
        <span className="rb-team away" style={{ color: pitchAway.color || "#e8554e" }}>{fx.away}</span>
      </div>
      <div className="rb-clock">{clockLabel}</div>

      {events.length ? (
        <MatchPitch home={pitchHome} away={pitchAway} events={events} stats={stats}
          config={cfg} clock={clock} celebrate={celebrating} goalLabel={t("mdGoal")}
          sceneScale={sceneScale} trailLength={cfg.trailLength} gameSpeed={cfg.gameSpeed} eventFont={cfg.eventFont}
          phaseLabels={{ kickoff: t("mdKickoff"), halftime: t("mdHalftime"), fulltime: t("mdFulltime") }} missLabel={t("mdMiss")} savedLabel={t("mdSaved")}
          showTrail={disp.showTrail} showNumbers={disp.showNumbers}
          showMarkers={disp.showMarkers} ballShadow={disp.showBallShadow} />
      ) : null}

      <div className="replay-controls">
        <button className="replay-btn" type="button" onClick={onToggle}
          aria-label={playing ? t("mdPause") : t("mdPlay")} title={playing ? t("mdPause") : t("mdPlay")}>
          {playing ? "⏸" : "▶"}
        </button>
        <input className="replay-scrub" type="range" min="0" max={maxMin} step="0.1"
          value={clock} onChange={onScrub} aria-label={t("mdReplay")}
          style={{ background: `linear-gradient(90deg, var(--accent) ${scrubPct}%, var(--line) ${scrubPct}%)` }} />
        <button className="replay-btn" type="button" onClick={onSound}
          aria-label={soundOn ? t("mdSoundOff") : t("mdSoundOn")} title={soundOn ? t("mdSoundOff") : t("mdSoundOn")}>
          {soundOn ? "🔊" : "🔇"}
        </button>
        <button className="replay-btn" type="button" onClick={restart}
          aria-label={t("mdRestart")} title={t("mdRestart")}>↺</button>
      </div>

      {events.length ? (
        <div className="detail-timeline replay" ref={feedRef}>
          <div className="timeline-legend"><span>{fx.home}</span><span>{fx.away}</span></div>
          {shown.map((r) => (
            <EventRow key={r.i} ev={r.ev} scoreStr={r.scoreStr} active={r === last} />
          ))}
        </div>
      ) : null}

      {stats.length ? (
        <div className="detail-stats replay-stats">
          {stats.map((s) => {
            const h = parseStat(s.home), a = parseStat(s.away);
            const tot = h.num + a.num;
            const frac = tot > 0 ? h.num / tot : 0.5;
            const hVal = h.ok ? (h.num * progress).toFixed(h.dec) + h.suffix : h.raw;
            const aVal = a.ok ? (a.num * progress).toFixed(a.dec) + a.suffix : a.raw;
            const hw = (frac * progress * 100).toFixed(2);
            const aw = ((1 - frac) * progress * 100).toFixed(2);
            return (
              <div className="rstat" key={s.key}>
                <div className="rstat-top">
                  <span className="rstat-h">{hVal}</span>
                  <span className="rstat-label">{STAT_LABEL[s.key] ? t(STAT_LABEL[s.key]) : s.key}</span>
                  <span className="rstat-a">{aVal}</span>
                </div>
                <div className="rstat-bar">
                  <span className="rstat-fill h" style={{ width: hw + "%" }} />
                  <span className="rstat-fill a" style={{ width: aw + "%" }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function HlEmbed({ id, t }) {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return (
      <iframe src={"https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0"}
        title={t("mdHighlights")} frameBorder="0"
        allow="autoplay; encrypted-media; picture-in-picture; web-share" allowFullScreen />
    );
  }
  return (
    <button className="hl-embed" type="button" aria-label={t("mdWatch")} onClick={() => setPlaying(true)}>
      <img className="hl-thumb" loading="lazy" alt=""
        src={"https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/hqdefault.jpg"} />
      <span className="hl-play" aria-hidden="true">▶</span>
    </button>
  );
}

function DetailExtras({ fx, t }) {
  if (!fx._detailsLoaded) return <p className="src-note checking">{t("mdLoading")}</p>;
  const d = fx._details;
  if (!d) return null;
  const finished = statusOf(fx, t).state === "finished";
  const embedId = d.highlights ? ytIdOf(d.highlights) : "";
  const ytUrl = "https://www.youtube.com/results?search_query=" +
    encodeURIComponent(fx.home + " vs " + fx.away + " " + (fx.competition || "") + " highlights");

  return (
    <>
      {(d.highlights && (d.highlights.url || d.highlights.youtubeId)) || finished ? (
        <>
          <h3 className="detail-h">{t("mdHighlights")}</h3>
          {embedId ? <div className="detail-embed"><HlEmbed id={embedId} t={t} /></div> : null}
          <div className="detail-highlights">
            {d.highlights && d.highlights.url ? (
              <a className="hl-btn" href={d.highlights.url} target="_blank" rel="noopener">{t("mdWatch")}</a>
            ) : null}
            <a className="hl-btn yt" href={ytUrl} target="_blank" rel="noopener">{t("mdYouTube")}</a>
          </div>
        </>
      ) : null}

      {(d.events && d.events.length) || (d.stats && d.stats.length) ? (
        <MatchReplay fx={fx} d={d} t={t} />
      ) : null}

      {d.form && (d.form.home.length || d.form.away.length) ? (
        <>
          <h3 className="detail-h">{t("mdForm")}</h3>
          <div className="detail-form">
            <div className="form-side"><span>{fx.home}</span><FormPills arr={d.form.home} t={t} /></div>
            <div className="form-side"><span>{fx.away}</span><FormPills arr={d.form.away} t={t} /></div>
          </div>
        </>
      ) : null}

      {d.h2h ? (
        <>
          <h3 className="detail-h">{t("mdH2h")}</h3>
          <div className="detail-h2h">
            <span><strong>{d.h2h.home}</strong> {fx.home}</span>
            <span><strong>{d.h2h.draw}</strong> {t("mdD")}</span>
            <span><strong>{d.h2h.away}</strong> {fx.away}</span>
          </div>
        </>
      ) : null}
    </>
  );
}

function DetailChannels({ fx, checking, t, primaryCountry }) {
  if (fx.tv && fx.tv.length) {
    const byCountry = groupByCountry(fx.tv);
    return (
      <>
        <p className="src-note real">{t("realListings")}</p>
        {orderCountries(Object.keys(byCountry), primaryCountry).map((c) => (
          <div className="detail-channel-row" key={c}>
            <span className="detail-country"><span className="flag">{countryFlag(c)}</span>{c}</span>
            <span className="detail-chips">
              {orderChannels(byCountry[c]).map((ch) => <ChannelChip key={ch} name={ch} t={t} />)}
            </span>
          </div>
        ))}
      </>
    );
  }
  return checking
    ? <p className="src-note checking">{t("checking")}</p>
    : <p className="src-note guide">{t("noListingDetail")}</p>;
}

function DetailModal({ fx, checking, t, locale, primaryCountry, onClose, onShare, topAds = [], bottomAds = [] }) {
  const closeRef = useRef(null);
  useEffect(() => { if (closeRef.current) closeRef.current.focus(); }, []);

  // Swipe right to dismiss the modal (a "back" gesture). Horizontal-only, so it
  // never fights the vertical scrolling of the detail body.
  const swipe = useSwipe({ onRight: onClose });

  const st = statusOf(fx, t);
  const kickoff = new Date(fx.kickoff);
  const dateStr = kickoff.toLocaleDateString(locale || [], {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const timeStr = kickoff.toLocaleTimeString(locale || [], { hour: "2-digit", minute: "2-digit" });
  const d = fx._details || null;
  const round = d && d.round ? " · " + d.round : "";
  const compLabel = fx.competition + (fx.group ? " · " + t("group") + " " + fx.group : "") + round;
  const venue = fx.venue || (d && d.venue) || "";
  const showScore = hasScore(fx) && st.state !== "upcoming";

  return (
    <div className="detail-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" {...swipe}>
        <div className="detail-actions">
          <button className="detail-share" type="button" aria-label={t("shareGame")} title={t("shareGame")}
            onClick={(e) => onShare(fx, e.currentTarget)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
            </svg>
          </button>
          <button className="detail-close" aria-label={t("close")} ref={closeRef} onClick={onClose}>×</button>
        </div>
        <div className="detail-body">
          {topAds.map((u) => <AdCard key={u.id} unit={u} slot="detail-top" />)}
          <div className="detail-comp">
            <LeagueLogo url={fx.leagueBadgeUrl} name={fx.competition} />
            <span id="detail-title">{compLabel}</span>
          </div>
          <div className="detail-teams">
            <div className="detail-team"><Badge url={fx.homeBadge} name={fx.home} /><span>{fx.home}</span></div>
            {showScore
              ? <div className="detail-score">{fx.homeScore} – {fx.awayScore}</div>
              : <div className="detail-vs">{t("vs")}</div>}
            <div className="detail-team"><Badge url={fx.awayBadge} name={fx.away} /><span>{fx.away}</span></div>
          </div>
          <div className="detail-meta">
            {st.state === "live" ? <span className="detail-status live">{st.label || "LIVE"}</span>
              : st.state === "finished" ? <span className="detail-status ft">{st.label || "FT"}</span>
              : <span className="detail-status">{timeStr}</span>}
            {fx.note ? <span className="detail-note">⚠ {fx.note}</span> : null}
            <span>📅 {dateStr} · {timeStr}</span>
            {venue ? <span>📍 {venue}</span> : null}
            {d && d.referee ? <span>🧑‍⚖️ {d.referee}</span> : null}
            {d && d.attendance ? <span>👥 {d.attendance}</span> : null}
            {d && d.motm ? (
              <span className="detail-motm">⭐ {t("mdMotm")}: {d.motm.name}
                {d.motm.rating ? " (" + d.motm.rating + ")" : ""}</span>
            ) : null}
          </div>
          <h3 className="detail-h">{t("whereToWatch")}</h3>
          <div className="detail-legend">
            <span className="channel free">{t("freeAir")}</span>
            <span className="channel paid"><span className="lock">🔒</span>{t("paidSub")}</span>
          </div>
          <DetailChannels fx={fx} checking={checking} t={t} primaryCountry={primaryCountry} />
          <DetailExtras fx={fx} t={t} />
          <CompetitionExtras fx={fx} t={t} locale={locale} />
          {bottomAds.map((u) => <AdCard key={u.id} unit={u} slot="detail-bottom" />)}
        </div>
      </div>
    </div>
  );
}

// useLayoutEffect on the client, useEffect during SSR (this is a client island,
// but Next still server-renders it for the initial HTML).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Group + rank a day's fixtures for rendering. Pure, so it can be run for the
// current day and the prefetched neighbours alike. Returns the same shape the
// card list expects, plus `hadFixtures`/`hiddenSome` for the empty-state copy.
function groupFixtures(fixtures, isHidden, search, primaryCountry) {
  const shown = fixtures.filter((fx) => !isHidden(fx.competition));
  const hiddenSome = shown.length !== fixtures.length;
  const q = search.trim().toLowerCase();
  const list = q
    ? shown.filter((fx) => (fx.home + " " + fx.away + " " + fx.competition).toLowerCase().indexOf(q) > -1)
    : shown;
  if (!list.length) return { empty: true, hiddenSome, hadFixtures: fixtures.length > 0 };

  const groups = {}, meta = {}, order = [];
  list.forEach((fx) => {
    const key = fx.competition || "Football";
    if (!groups[key]) {
      groups[key] = [];
      meta[key] = { name: key, leagueId: fx.leagueId, ccode: fx.ccode };
      order.push(key);
    }
    groups[key].push(fx);
  });
  order.sort((a, b) => {
    const ra = compRank(meta[a], primaryCountry), rb = compRank(meta[b], primaryCountry);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
  });

  // Split into "major" competitions (the big tournaments + the user's own
  // country, compRank tiers 0–1) and the long tail (tier 2), which is hidden
  // behind a "Show all games" link. A search shows everything, ungrouped by
  // priority, so the tail is never hidden mid-search.
  let major = order, rest = [];
  if (!q) {
    major = []; rest = [];
    order.forEach((key) => {
      (compRank(meta[key], primaryCountry)[0] < 2 ? major : rest).push(key);
    });
    if (!major.length) { major = order; rest = []; }
  }
  const restGames = rest.reduce((n, k) => n + groups[k].length, 0);
  return { empty: false, groups, order, major, rest, restGames };
}

// One day's fixtures column — the unit the carousel lays out side by side. Its
// own `showAll` state resets naturally because each panel is keyed by its day.
function DayPanel({ data, skeleton, search, t, locale, primaryCountry, highlightsById, feedAds, openDetails, onShare }) {
  const [showAll, setShowAll] = useState(false);

  if (skeleton || !data) {
    return Array.from({ length: 5 }).map((_, i) => <div className="skeleton" key={i} />);
  }
  if (data.empty) {
    return (
      <div className="empty">
        <div className="big"><SoccerBall /></div>
        <p dangerouslySetInnerHTML={{
          __html: data.hadFixtures && data.hiddenSome && !search ? t("allFiltered") : t("noSearch"),
        }} />
      </div>
    );
  }

  const visibleOrder = showAll ? data.order : data.major;
  const hasMore = !showAll && data.rest.length > 0;
  const everyN = feedAds.length ? (feedAds[0].everyN || 5) : 0;
  let cardCount = 0, adIdx = 0;

  return (
    <>
      {visibleOrder.map((comp) => {
        const games = data.groups[comp].slice().sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
        const badged = games.filter((g) => g.leagueBadgeUrl)[0];
        const badgeUrl = badged ? badged.leagueBadgeUrl : "";
        const items = [];
        games.forEach((g) => {
          items.push(
            <GameCard key={g.id} fx={g} t={t} locale={locale} primaryCountry={primaryCountry}
              highlightsById={highlightsById} onOpen={openDetails} onShare={onShare} />
          );
          cardCount += 1;
          if (everyN && cardCount % everyN === 0) {
            const unit = feedAds[adIdx % feedAds.length];
            adIdx += 1;
            items.push(<AdCard key={"feedad-" + g.id} unit={unit} slot="fixtures-feed" />);
          }
        });
        return (
          <section className="competition" key={comp}>
            <h2 className="competition-head">
              <LeagueLogo url={badgeUrl} name={comp} />
              <span className="competition-name">{comp}</span>
              <span className="count">{games.length}</span>
            </h2>
            {items}
          </section>
        );
      })}
      {hasMore ? (
        <button type="button" className="show-all-btn" onClick={() => setShowAll(true)}>
          {t("showAllGames")} <span className="n">+{data.restGames}</span>
        </button>
      ) : null}
      {showAll && data.rest.length ? (
        <button type="button" className="show-all-btn" onClick={() => setShowAll(false)}>
          {t("showFewer")}
        </button>
      ) : null}
    </>
  );
}

// ---- Main browser -------------------------------------------------------

export default function GamesBrowser({ feedAds = [], detailTopAds = [], detailBottomAds = [] }) {
  const [date, setDate] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [fixtures, setFixtures] = useState([]);
  const [hidden, setHidden] = useState({});
  const [remember, setRemember] = useState(false);
  const [primaryCountry, setPrimaryCountry] = useState("Portugal");
  const [highlightsById, setHighlightsById] = useState({});
  const [status, setStatus] = useState(null); // { kind, badge, text, tvCount, updated }
  const [refreshingTv, setRefreshingTv] = useState(false); // background listings build in flight
  const tvFollowup = useRef(false); // guards the one-shot re-fetch after a build
  const [detailId, setDetailId] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [skeleton, setSkeleton] = useState(true);
  const [cacheVer, setCacheVer] = useState(0); // bumped when dayCache changes, so neighbour panels re-derive
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((x) => x + 1), []);

  const loadToken = useRef(0);
  const fixturesRef = useRef([]);
  const dateRef = useRef(date);
  const detailIdRef = useRef(null);
  const dayCache = useRef({});        // ymd -> processed fixtures, so adjacent days render instantly
  const neighborInflight = useRef({}); // ymd -> true while a neighbour prefetch is running
  const viewportRef = useRef(null);   // carousel clip box (owns the touch listeners)
  const trackRef = useRef(null);      // the prev|current|next strip we translate
  const drag = useRef({});            // live drag state (start coords, locked axis, delta)
  const animating = useRef(false);    // true during a snap so nav input is ignored mid-animation
  fixturesRef.current = fixtures;
  dateRef.current = date;
  detailIdRef.current = detailId;

  // Brand is resolved from the request host after mount (window is only available
  // client-side), mirroring how primaryCountry settles post-hydration — so the
  // initial render still matches the server. An English-only domain
  // (footietoday.com / footytoday.co) pins English; otherwise the language
  // follows the chosen country.
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  useEffect(() => {
    setBrand(brandForHost(window.location.host));
  }, []);

  const lang = brand.lang || langFor(primaryCountry);
  const t = useMemo(() => makeT(lang, brand.name), [lang, brand.name]);
  const locale = localeFor(lang);

  const fixtureById = useCallback(
    (id) => fixturesRef.current.filter((f) => String(f.id) === String(id))[0],
    []
  );

  const isHidden = useCallback((comp) => !!hidden[comp || "Football"], [hidden]);

  // Keep document title + lang in sync with the chosen language, and localize
  // the server-rendered page chrome (header tagline + footer). That chrome is
  // static HTML outside this client island, so we address it by its stable ids
  // and drive it from the same i18n table once the language is known.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t("title");
    const setText = (sel, text) => {
      const el = document.querySelector(sel);
      if (el) el.textContent = text;
    };
    const setHtml = (sel, html) => {
      const el = document.querySelector(sel);
      if (el) el.innerHTML = html;
    };
    setText(".tagline", t("tagline"));
    setText("#footer-data", t("footerData"));
    setText("#footer-site-title", t("footerSite"));
    setText("#ad-prefs", t("adPrefs"));
    setText("#footer-copy", t("footerCopy").replace("{year}", new Date().getFullYear()));
    setHtml("#footer-credits", t("footerCredits"));
    // SEO intro block (server-rendered English by default for crawlers).
    setText("#seo-h1", t("seoH1"));
    setText("#seo-intro-title", t("seoIntroTitle"));
    setHtml("#seo-p1", t("seoP1"));
    setHtml("#seo-p2", t("seoP2"));
    setText("#seo-leagues-title", t("seoLeaguesTitle"));
    setText("#seo-today-link", t("seoTodayLink"));
    document.querySelectorAll(".seo-on-tv").forEach((el) => { el.textContent = t("seoOnTv"); });
  }, [lang, t]);

  // ---- Filters persistence ----
  useEffect(() => {
    let rem = false;
    try { rem = localStorage.getItem(STORAGE_REMEMBER) === "1"; } catch (e) {}
    const h = {};
    if (rem) {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_HIDDEN) || "[]");
        if (Array.isArray(saved)) saved.forEach((name) => { h[name] = true; });
      } catch (e) {}
    }
    setRemember(rem);
    setHidden(h);
  }, []);

  const saveFilters = useCallback((rem, h) => {
    try {
      localStorage.setItem(STORAGE_REMEMBER, rem ? "1" : "0");
      if (rem) localStorage.setItem(STORAGE_HIDDEN, JSON.stringify(Object.keys(h)));
      else localStorage.removeItem(STORAGE_HIDDEN);
    } catch (e) {}
  }, []);

  // ---- Country (IP default unless stored) ----
  useEffect(() => {
    let stored = null;
    try { stored = localStorage.getItem(STORAGE_COUNTRY); } catch (e) {}
    if (stored) { setPrimaryCountry(stored); return; }
    fetch("/api/geo", { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((d) => {
        const name = d && d.country && CODE_TO_COUNTRY[d.country];
        if (name) setPrimaryCountry(name);
      })
      .catch(() => {});
  }, []);

  const changeCountry = useCallback((name) => {
    if (!name) return;
    setPrimaryCountry(name);
    try { localStorage.setItem(STORAGE_COUNTRY, name); } catch (e) {}
  }, []);

  // ---- Prefetch listings for visible fixtures (bounded concurrency) ----
  const prefetchListings = useCallback((token, list, day) => {
    const queue = list.filter((f) => !f._tvLoaded && !isHidden(f.competition));
    let i = 0, active = 0;
    const CONCURRENCY = 4;
    const pump = () => {
      if (token !== loadToken.current) return;
      while (active < CONCURRENCY && i < queue.length) {
        const fx = queue[i++];
        active++;
        ensureEventTv(fx, day).catch(() => {}).then(() => {
          active--;
          if (token === loadToken.current) bump();
          pump();
        });
      }
    };
    pump();
  }, [isHidden, bump]);

  // ---- Build one day (fetch + merge), no UI state ----
  // Fetches a day's fixtures and folds in every TV source, returning the same
  // shape the cards render. Pure data: callers decide whether to display it,
  // cache it, or both — which is what lets adjacent days be prefetched.
  const buildDay = useCallback((day) => {
    let feedReachable = true;
    const fixturesReq = fetchFotMobFixtures(day).catch(() => { feedReachable = false; return []; });
    return Promise.all([fixturesReq, fetchTv(day), fetchFotMobDay(day), fetchRichListings(day)])
      .then((res) => {
        let fx = res[0] || [];
        const tv = res[1];
        const dayMaps = res[2] || [];
        const rich = res[3] || {};            // { matches, refreshing } from /api/listings
        const richMatches = rich.matches || {}; // accumulated store, keyed by FotMob match id
        attachTv(fx, tv);

        if (dayMaps.length) {
          fx.forEach((f) => {
            const h = normName(f.home), a = normName(f.away);
            for (let i = 0; i < dayMaps.length; i++) {
              const e = dayMaps[i];
              // Join by FotMob match id when both sides carry it — robust against
              // per-country localized team names (e.g. "Suíça"/"Bósnia"); fall back
              // to name matching only when an id isn't available.
              const idJoin = e.id && f.fmid && String(e.id) === String(f.fmid);
              const matched = idJoin ||
                (e.rows && e.rows.length && teamMatch(h, e.h) && teamMatch(a, e.a));
              if (matched && e.rows && e.rows.length) f.tv = mergeTv(f.tv, e.rows);
            }
          });
        }

        // Accumulated daily store (cron-listings): exact id join, richest source.
        fx.forEach((f) => {
          const r = f.fmid && richMatches[String(f.fmid)];
          if (r && r.rows && r.rows.length) f.tv = mergeTv(f.tv, r.rows);
        });

        fx.forEach((f) => {
          if (loadedTv[f.id]) { f.tv = mergeTv(f.tv, loadedTv[f.id]); f._tvLoaded = true; }
          if (f.fmid && Object.prototype.hasOwnProperty.call(detailsCache, f.fmid)) {
            f._details = detailsCache[f.fmid];
            f._detailsLoaded = true;
          }
        });

        return { fx, feedReachable, refreshing: !!rich.refreshing };
      });
  }, []);

  // Push a built day into the UI (fixtures + status). `token` gates the per-event
  // listings prefetch; pass null to skip it (e.g. when showing a cached day that a
  // background refresh will follow up).
  const applyDay = useCallback((fx, day, opts) => {
    opts = opts || {};
    setSkeleton(false);
    if (!fx.length) {
      if (opts.silent) return;
      setFixtures([]);
      setStatus({ kind: "error", badge: "NONE", text: opts.feedReachable === false ? t("feedDown") : t("noFixtures") });
      return;
    }
    const comps = {};
    fx.forEach((f) => { comps[f.competition] = true; });
    const live = fx.filter((f) => statusOf(f, t).state === "live").length;
    const withTv = fx.filter((f) => f.tv && f.tv.length).length;
    const nGames = fx.length, nComps = Object.keys(comps).length;
    const base = nGames + " " + t(nGames === 1 ? "game" : "games") + " · " +
      nComps + " " + t(nComps === 1 ? "competition" : "competitions") +
      (live ? " · " + live + " " + t("liveNow") : "");
    setFixtures(fx);
    setStatus({
      kind: "ok", badge: live ? t("live") : "OK", text: base,
      tvCount: withTv, updated: formatClock(new Date(), locale),
    });
    if (opts.token != null) prefetchListings(opts.token, fx, day);
  }, [t, locale, prefetchListings]);

  // Warm the cache for the days on either side of `centerDate`, so the next swipe
  // lands on real fixtures instead of the loading skeleton. Bounded: at most one
  // in-flight fetch per day, and the cache is pruned to a window around the
  // current day so long paging sessions don't grow it without bound.
  const prefetchNeighbors = useCallback((centerDate) => {
    const center = ymd(centerDate);
    Object.keys(dayCache.current).forEach((k) => {
      const diff = Math.abs((parseYmd(k) - parseYmd(center)) / 86400000);
      if (diff > 3) delete dayCache.current[k];
    });
    [-1, 1].forEach((delta) => {
      const d = new Date(centerDate);
      d.setDate(d.getDate() + delta);
      const key = ymd(d);
      if (dayCache.current[key] || neighborInflight.current[key]) return;
      neighborInflight.current[key] = true;
      buildDay(key)
        .then(({ fx }) => { if (fx && fx.length) { dayCache.current[key] = fx; setCacheVer((v) => v + 1); } })
        .catch(() => {})
        .then(() => { delete neighborInflight.current[key]; });
    });
  }, [buildDay]);

  // ---- Load fixtures (current day) ----
  const loadFixtures = useCallback((silent) => {
    const day = ymd(dateRef.current);
    if (!silent && !dayCache.current[day]) setSkeleton(true);
    loadToken.current += 1;
    const token = loadToken.current;
    return buildDay(day).then(({ fx, feedReachable, refreshing }) => {
      if (token !== loadToken.current) return;
      if (fx.length) { dayCache.current[day] = fx; setCacheVer((v) => v + 1); }

      // When the store is being rebuilt in the background, show a banner and
      // re-fetch once shortly after so the freshly merged channels appear without
      // a manual reload. The server's per-window lock makes the follow-up return
      // refreshing=false, so this fires at most once (no loop).
      if (refreshing) {
        setRefreshingTv(true);
        if (!tvFollowup.current) {
          tvFollowup.current = true;
          setTimeout(() => { tvFollowup.current = false; loadRef.current && loadRef.current(true); }, 9000);
        }
      } else {
        setRefreshingTv(false);
      }

      applyDay(fx, day, { silent, feedReachable, token });
      prefetchNeighbors(dateRef.current);
    });
  }, [buildDay, applyDay, prefetchNeighbors]);

  // Stable handle to the latest loader, so the post-build follow-up timer can
  // re-fetch without being a dependency of the callback that schedules it.
  const loadRef = useRef(loadFixtures);
  useEffect(() => { loadRef.current = loadFixtures; }, [loadFixtures]);

  // ---- Highlights ----
  const refreshHighlights = useCallback(() => {
    loadHighlights().then((map) => setHighlightsById(map));
  }, []);

  // ---- Init: deep link + first load + adaptive refresh ----
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      const d = parseYmd(params.get("date"));
      if (d) { setDate(d); dateRef.current = d; }
      const m = params.get("match");
      if (m) pendingMatch.current = m;
    } catch (e) {}
    loadFixtures();
    refreshHighlights();

    let timer = null;
    const tick = () => {
      let live = false;
      if (isSameDay(dateRef.current, new Date())) {
        loadFixtures(true);
        refreshHighlights();
        live = fixturesRef.current.some((f) => statusOf(f, t).state === "live");
      } else {
        bump();
      }
      // Speed up the cadence while a live ticker is running.
      timer = setTimeout(tick, live ? LIVE_REFRESH_MS : IDLE_REFRESH_MS);
    };
    timer = setTimeout(tick, IDLE_REFRESH_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingMatch = useRef(null);

  // Open a shared/deep-linked match once its fixtures land.
  useEffect(() => {
    if (!pendingMatch.current || !fixtures.length) return;
    const id = pendingMatch.current;
    pendingMatch.current = null;
    const fx = fixtureById(id);
    if (!fx) return;
    try { history.replaceState({ hhbMatch: String(fx.id) }, "", shareLink(fx, origin())); } catch (e) {}
    openDetails(fx.id, { push: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtures]);

  // ---- Detail open/close + history ----
  const openDetails = useCallback((id, opts) => {
    opts = opts || {};
    const fx = fixtureById(id);
    if (!fx) return;
    setDetailId(String(id));
    if (opts.push !== false) {
      try { history.pushState({ hhbMatch: String(id) }, "", shareLink(fx, origin())); } catch (e) {}
    }
    const day = ymd(dateRef.current);
    if (!fx._tvLoaded) {
      ensureEventTv(fx, day).then(() => { bump(); });
    }
    if (!fx._detailsLoaded) {
      ensureDetails(fx).then(() => { bump(); });
    }
  }, [fixtureById, bump]);

  const closeDetails = useCallback((opts) => {
    opts = opts || {};
    if (!detailIdRef.current) return;
    setDetailId(null);
    document.body.style.overflow = "";
    if (opts.pop !== false && history.state && history.state.hhbMatch) {
      try { history.back(); } catch (e) {}
    }
  }, []);

  useEffect(() => {
    document.body.style.overflow = detailId ? "hidden" : "";
  }, [detailId]);

  useEffect(() => {
    const onPop = (e) => {
      const s = e.state;
      if (s && s.hhbMatch && fixtureById(s.hhbMatch)) openDetails(s.hhbMatch, { push: false });
      else closeDetails({ pop: false });
    };
    const onKey = (e) => { if (e.key === "Escape") { setPanelOpen(false); closeDetails(); } };
    window.addEventListener("popstate", onPop);
    document.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("popstate", onPop); document.removeEventListener("keydown", onKey); };
  }, [fixtureById, openDetails, closeDetails]);

  // Close the league panel on outside click.
  useEffect(() => {
    if (!panelOpen) return;
    const onDoc = () => setPanelOpen(false);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [panelOpen]);

  // ---- Search debounce ----
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 120);
    return () => clearTimeout(id);
  }, [searchInput]);

  // ---- Date controls ----
  // Switch to a day: if its fixtures are already cached (prefetched neighbour),
  // show them instantly so the transition lands on real content, then refresh in
  // the background. Otherwise fall back to skeleton + fetch.
  const showDay = useCallback((d) => {
    setDate(d); dateRef.current = d;
    const cached = dayCache.current[ymd(d)];
    if (cached) {
      applyDay(cached, ymd(d), {}); // token omitted → the background refresh fills per-event listings
      loadFixtures(true);
      prefetchNeighbors(d);
    } else {
      loadFixtures();
    }
  }, [applyDay, loadFixtures, prefetchNeighbors]);

  // Carousel re-center: after the day commits, drop the strip back to the middle
  // panel instantly (no transition) — the just-revealed neighbour and the new
  // current panel hold identical content, so there's no flash.
  const CAROUSEL_MS = 320;
  const recenter = useCallback(() => {
    const tr = trackRef.current;
    if (!tr) return;
    tr.style.transition = "none";
    tr.style.transform = "translateX(0)";
  }, []);
  useIsoLayoutEffect(() => { recenter(); }, [date, recenter]);

  // Animate the strip one panel over, then commit the day. Shared by the ‹ ›
  // buttons and the swipe release.
  const commitNav = useCallback((delta) => {
    if (animating.current) return;
    animating.current = true;
    const tr = trackRef.current;
    if (tr) {
      tr.style.transition = `transform ${CAROUSEL_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      requestAnimationFrame(() => {
        if (trackRef.current) trackRef.current.style.transform = `translateX(${delta > 0 ? "-100%" : "100%"})`;
      });
    }
    setTimeout(() => {
      const target = new Date(dateRef.current);
      target.setDate(target.getDate() + delta);
      showDay(target);          // setDate → the layout effect recenters the strip with new content
      animating.current = false;
    }, CAROUSEL_MS + 20);
  }, [showDay]);

  // Spring the strip back to center when a drag didn't pass the threshold.
  const snapBack = useCallback(() => {
    const tr = trackRef.current;
    if (!tr) return;
    tr.style.transition = "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)";
    requestAnimationFrame(() => {
      if (trackRef.current) trackRef.current.style.transform = "translateX(0)";
    });
  }, []);

  const shiftDay = (delta) => commitNav(delta);
  const goToday = () => { if (!isSameDay(dateRef.current, new Date())) showDay(new Date()); };

  // Finger-following drag. Native (non-passive) listeners so we can preventDefault
  // the page scroll once the gesture locks horizontal; vertical gestures are left
  // to the browser. The strip is translated imperatively for a smooth follow.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return undefined;
    const d = drag.current;
    const onStart = (e) => {
      if (animating.current || e.touches.length !== 1) return;
      const tch = e.touches[0];
      d.x0 = tch.clientX; d.y0 = tch.clientY; d.axis = null; d.active = true; d.dx = 0;
      d.w = vp.clientWidth || 1;
      if (trackRef.current) trackRef.current.style.transition = "none";
    };
    const onMove = (e) => {
      if (!d.active) return;
      const tch = e.touches[0];
      const dx = tch.clientX - d.x0, dy = tch.clientY - d.y0;
      if (d.axis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (d.axis !== "x") return; // vertical intent → let the page scroll
      e.preventDefault();
      d.dx = dx;
      if (trackRef.current) trackRef.current.style.transform = `translateX(${dx}px)`;
    };
    const onEnd = () => {
      if (!d.active) return;
      d.active = false;
      if (d.axis !== "x") return;
      const threshold = Math.min(90, d.w * 0.22);
      if (d.dx <= -threshold) commitNav(1);        // dragged left → next day
      else if (d.dx >= threshold) commitNav(-1);   // dragged right → previous day
      else snapBack();
    };
    vp.addEventListener("touchstart", onStart, { passive: true });
    vp.addEventListener("touchmove", onMove, { passive: false });
    vp.addEventListener("touchend", onEnd, { passive: true });
    vp.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      vp.removeEventListener("touchstart", onStart);
      vp.removeEventListener("touchmove", onMove);
      vp.removeEventListener("touchend", onEnd);
      vp.removeEventListener("touchcancel", onEnd);
    };
  }, [commitNav, snapBack]);

  const dateLabel = isSameDay(date, new Date())
    ? t("today")
    : date.toLocaleDateString(locale || [], { weekday: "long", day: "numeric", month: "long" });

  // ---- Toast for copied share link ----
  const [copiedAt, setCopiedAt] = useState(0);
  const onShare = useCallback((fx) => shareMatch(fx, () => setCopiedAt(Date.now())), []);
  useEffect(() => {
    if (!copiedAt) return;
    const id = setTimeout(() => setCopiedAt(0), 1800);
    return () => clearTimeout(id);
  }, [copiedAt]);

  // ---- League filter helpers ----
  const leagueCounts = useMemo(() => {
    const c = {};
    fixtures.forEach((f) => { const k = f.competition || "Football"; c[k] = (c[k] || 0) + 1; });
    return c;
  }, [fixtures]);
  const leagueNames = useMemo(
    () => Object.keys(leagueCounts).sort((a, b) => a.localeCompare(b)), [leagueCounts]
  );
  const hiddenCount = Object.keys(hidden).filter((k) => hidden[k]).length;

  const toggleLeague = (name, show) => {
    setHidden((prev) => {
      const next = { ...prev };
      if (show) delete next[name]; else next[name] = true;
      saveFilters(remember, next);
      return next;
    });
  };
  const resetFilters = () => { setHidden({}); saveFilters(remember, {}); };

  // ---- Country options ----
  const countryOptions = useMemo(() => {
    const set = {};
    Object.keys(CODE_TO_COUNTRY).forEach((k) => { set[CODE_TO_COUNTRY[k]] = true; });
    fixtures.forEach((fx) => (fx.tv || []).forEach((t2) => { if (t2.country) set[t2.country] = true; }));
    set[primaryCountry] = true;
    return Object.keys(set).sort((a, b) => a.localeCompare(b));
  }, [fixtures, primaryCountry]);

  // ---- Grouped, filtered fixtures for the carousel's three panels ----
  // The current day comes from the live `fixtures` state; the neighbours come
  // from the prefetch cache (re-derived when the cache or filters change) so the
  // strip shows real content the instant a drag begins.
  const dShift = (base, n) => { const x = new Date(base); x.setDate(x.getDate() + n); return x; };
  const prevKey = ymd(dShift(date, -1));
  const nextKey = ymd(dShift(date, 1));

  const curData = useMemo(
    () => groupFixtures(fixtures, isHidden, search, primaryCountry),
    [fixtures, isHidden, search, primaryCountry]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prevFx = useMemo(() => dayCache.current[prevKey] || null, [prevKey, cacheVer]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nextFx = useMemo(() => dayCache.current[nextKey] || null, [nextKey, cacheVer]);
  const prevData = useMemo(
    () => (prevFx ? groupFixtures(prevFx, isHidden, search, primaryCountry) : null),
    [prevFx, isHidden, search, primaryCountry]
  );
  const nextData = useMemo(
    () => (nextFx ? groupFixtures(nextFx, isHidden, search, primaryCountry) : null),
    [nextFx, isHidden, search, primaryCountry]
  );

  const detailFx = detailId ? fixtureById(detailId) : null;
  const panelCtx = { search, t, locale, primaryCountry, highlightsById, feedAds, openDetails, onShare };

  return (
    <>
      <section className="toolbar">
        <div className="date-nav">
          <button className="date-btn" aria-label={t("prevDay")} onClick={() => shiftDay(-1)}>‹</button>
          <button className="date-today" onClick={goToday}>{t("today")}</button>
          <button className="date-btn" aria-label={t("nextDay")} onClick={() => shiftDay(1)}>›</button>
          <span className="current-date">{dateLabel}</span>
        </div>
        <div className="toolbar-right">
          <div className="country-pick">
            <label htmlFor="country-select" className="country-label">{t("yourCountry")}</label>
            <select id="country-select" aria-label={t("countryAria")}
              value={primaryCountry} onChange={(e) => changeCountry(e.target.value)}>
              {countryOptions.map((c) => (
                <option key={c} value={c}>{countryFlag(c)} {c}</option>
              ))}
            </select>
          </div>
          <div className="league-filter">
            <button className="filter-btn" aria-expanded={panelOpen} aria-controls="filter-panel"
              onClick={(e) => { e.stopPropagation(); setPanelOpen((o) => !o); }}>
              <span id="league-toggle-label">
                {t("leagues")}{hiddenCount ? <span className="count-badge"> {hiddenCount} {t("hidden")}</span> : null}
              </span> ▾
            </button>
            <div id="filter-panel" className="filter-panel" hidden={!panelOpen}
              onClick={(e) => e.stopPropagation()}>
              <div className="filter-panel-head">
                <strong>{t("showLeagues")}</strong>
                <button type="button" className="reset-btn" onClick={resetFilters}>{t("reset")}</button>
              </div>
              <div className="league-list">
                {leagueNames.length ? leagueNames.map((c) => (
                  <label className="league-row" key={c}>
                    <input type="checkbox" value={c} checked={!isHidden(c)}
                      onChange={(e) => toggleLeague(c, e.target.checked)} />
                    <span className="name">{c}</span>
                    <span className="n">{leagueCounts[c]}</span>
                  </label>
                )) : <p className="n" style={{ padding: "6px 4px" }}>{t("noLeagues")}</p>}
              </div>
              <label className="remember-row">
                <input type="checkbox" checked={remember}
                  onChange={(e) => { setRemember(e.target.checked); saveFilters(e.target.checked, hidden); }} />
                <span>{t("remember")}</span>
              </label>
            </div>
          </div>
          <div className="search-wrap">
            <input type="search" placeholder={t("search")} aria-label={t("searchAria")}
              value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
        </div>
      </section>

      <p className="swipe-hint" aria-hidden="true">{t("swipeHint")}</p>

      {refreshingTv ? (
        <div className="status refreshing" role="status" aria-live="polite">
          <span className="badge">⏳</span>
          {t("refreshingTv")}
        </div>
      ) : null}

      {status ? (
        <div className={"status" + (status.kind === "error" ? " error" : "")}>
          <span className="badge">{status.badge}</span>
          {status.text}
          {status.kind !== "error" ? (
            <>
              <span className="tv-count">
                {status.tvCount ? " · 📡 " + status.tvCount + " " + t("withTv") : ""}
              </span>
              {" · " + t("updated") + " " + status.updated}
            </>
          ) : null}
        </div>
      ) : null}

      <section className="games" aria-live="polite">
        <div className="page-viewport" ref={viewportRef}>
          <div className="page-track" ref={trackRef}>
            <div className="page-side prev" key={"p" + prevKey} aria-hidden="true">
              <DayPanel data={prevData} skeleton={!prevData} {...panelCtx} />
            </div>
            <div className="page-cur" key={"c" + ymd(date)}>
              <DayPanel data={curData} skeleton={skeleton} {...panelCtx} />
            </div>
            <div className="page-side next" key={"n" + nextKey} aria-hidden="true">
              <DayPanel data={nextData} skeleton={!nextData} {...panelCtx} />
            </div>
          </div>
        </div>
      </section>

      {detailFx ? (
        <DetailModal fx={detailFx} checking={!detailFx._tvLoaded} t={t} locale={locale}
          primaryCountry={primaryCountry} onClose={closeDetails} onShare={onShare}
          topAds={detailTopAds} bottomAds={detailBottomAds} />
      ) : null}

      {copiedAt ? (
        <div className="copied-toast" role="status" style={{
          position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)",
          background: "#16d27a", color: "#0f1722", fontWeight: 700, padding: "10px 18px",
          borderRadius: "999px", zIndex: 1000, boxShadow: "0 6px 20px rgba(0,0,0,.35)",
        }}>{t("copied")}</div>
      ) : null}
    </>
  );
}
