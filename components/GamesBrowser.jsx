"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdsterraBanner from "@/components/AdsterraBanner";
import { ADSTERRA_CONFIG } from "@/lib/adsterra";
import { isPaidChannel } from "@/lib/broadcasters";
import { langFor, makeT, localeFor } from "@/lib/i18n";
import {
  ymd, isSameDay, parseYmd, formatClock, statusOf, hasScore, shareLink,
} from "@/lib/format";
import {
  CODE_TO_COUNTRY, countryFlag, initials, orderCountries, orderChannels,
  groupByCountry, compRank, ytIdOf, highlightLink,
  fetchFotMobFixtures, fetchTv, attachTv, fetchFotMobDay, mergeTv, teamMatch,
  ensureEventTv, ensureDetails, loadHighlights, loadedTv, detailsCache,
} from "@/lib/app-data";
import { normName } from "@/lib/format";

const STORAGE_HIDDEN = "ondebola.hiddenLeagues";
const STORAGE_REMEMBER = "ondebola.rememberFilters";
const STORAGE_COUNTRY = "ondebola.primaryCountry";
const MAX_CARD_CHIPS = 3;

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
        <div className="match-time"><TimeCell fx={fx} t={t} locale={locale} /></div>
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

function EventRow({ ev, scoreStr }) {
  const kindCls = (ev.kind === "yellow" || ev.kind === "red") ? "card "
    : ev.kind === "sub" ? "sub " : "goal ";
  const side = ev.side === "away" ? "away" : "home";
  return (
    <div className={"event-row " + side}>
      <span className="event-min">{ev.min || ""}</span>
      <span className={"event-icon " + kindCls + ev.kind}>
        {EVENT_ICON[ev.kind] || "•"}
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

  // Running scoreline for the timeline.
  let hs = 0, as = 0;
  const eventRows = (d.events || []).map((ev, i) => {
    let scoreStr = "";
    if (ev.kind === "goal" || ev.kind === "pengoal" || ev.kind === "owngoal") {
      const scoresHome = ev.kind === "owngoal" ? (ev.side === "away") : (ev.side === "home");
      if (scoresHome) hs++; else as++;
      scoreStr = hs + "–" + as;
    }
    return <EventRow key={i} ev={ev} scoreStr={scoreStr} />;
  });

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

      {d.events && d.events.length ? (
        <>
          <h3 className="detail-h">{t("mdTimeline")}</h3>
          <div className="detail-timeline">
            <div className="timeline-legend"><span>{fx.home}</span><span>{fx.away}</span></div>
            {eventRows}
          </div>
        </>
      ) : null}

      {d.stats && d.stats.length ? (
        <>
          <h3 className="detail-h">{t("mdStats")}</h3>
          <div className="detail-stats">
            {d.stats.map((s) => (
              <div className="stat-row" key={s.key}>
                <span className="stat-h">{s.home}</span>
                <span className="stat-label">{STAT_LABEL[s.key] ? t(STAT_LABEL[s.key]) : s.key}</span>
                <span className="stat-a">{s.away}</span>
              </div>
            ))}
          </div>
        </>
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

function DetailModal({ fx, checking, t, locale, primaryCountry, onClose, onShare }) {
  const closeRef = useRef(null);
  useEffect(() => { if (closeRef.current) closeRef.current.focus(); }, []);

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
      <div className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
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
        </div>
      </div>
    </div>
  );
}

// ---- Main browser -------------------------------------------------------

export default function GamesBrowser() {
  const [date, setDate] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [fixtures, setFixtures] = useState([]);
  const [hidden, setHidden] = useState({});
  const [remember, setRemember] = useState(false);
  const [primaryCountry, setPrimaryCountry] = useState("Portugal");
  const [highlightsById, setHighlightsById] = useState({});
  const [status, setStatus] = useState(null); // { kind, badge, text, tvCount, updated }
  const [detailId, setDetailId] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [skeleton, setSkeleton] = useState(true);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((x) => x + 1), []);

  const loadToken = useRef(0);
  const fixturesRef = useRef([]);
  const dateRef = useRef(date);
  const detailIdRef = useRef(null);
  fixturesRef.current = fixtures;
  dateRef.current = date;
  detailIdRef.current = detailId;

  const lang = langFor(primaryCountry);
  const t = useMemo(() => makeT(lang), [lang]);
  const locale = localeFor(lang);

  const fixtureById = useCallback(
    (id) => fixturesRef.current.filter((f) => String(f.id) === String(id))[0],
    []
  );

  const isHidden = useCallback((comp) => !!hidden[comp || "Football"], [hidden]);

  // Keep document title + lang in sync with the chosen language.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t("title");
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

  // ---- Load fixtures ----
  const loadFixtures = useCallback((silent) => {
    if (!silent) setSkeleton(true);
    loadToken.current += 1;
    const token = loadToken.current;
    const day = ymd(dateRef.current);

    let feedReachable = true;
    const fixturesReq = fetchFotMobFixtures(day).catch(() => { feedReachable = false; return []; });

    return Promise.all([fixturesReq, fetchTv(day), fetchFotMobDay(day)]).then((res) => {
      if (token !== loadToken.current) return;
      let fx = res[0] || [];
      const tv = res[1];
      const dayMaps = res[2] || [];
      attachTv(fx, tv);

      if (dayMaps.length) {
        fx.forEach((f) => {
          const h = normName(f.home), a = normName(f.away);
          for (let i = 0; i < dayMaps.length; i++) {
            const e = dayMaps[i];
            if (e.rows && e.rows.length && teamMatch(h, e.h) && teamMatch(a, e.a)) {
              f.tv = mergeTv(f.tv, e.rows);
            }
          }
        });
      }

      fx.forEach((f) => {
        if (loadedTv[f.id]) { f.tv = mergeTv(f.tv, loadedTv[f.id]); f._tvLoaded = true; }
        if (f.fmid && Object.prototype.hasOwnProperty.call(detailsCache, f.fmid)) {
          f._details = detailsCache[f.fmid];
          f._detailsLoaded = true;
        }
      });

      setSkeleton(false);

      if (!fx.length) {
        if (silent) return;
        setFixtures([]);
        setStatus({ kind: "error", badge: "NONE", text: feedReachable ? t("noFixtures") : t("feedDown") });
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
      prefetchListings(token, fx, day);
    });
  }, [t, locale, prefetchListings]);

  // ---- Highlights ----
  const refreshHighlights = useCallback(() => {
    loadHighlights().then((map) => setHighlightsById(map));
  }, []);

  // ---- Init: deep link + first load + 60s refresh ----
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
    const iv = setInterval(() => {
      if (isSameDay(dateRef.current, new Date())) {
        loadFixtures(true);
        refreshHighlights();
      } else {
        bump();
      }
    }, 60000);
    return () => clearInterval(iv);
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
  const shiftDay = (delta) => {
    const d = new Date(dateRef.current);
    d.setDate(d.getDate() + delta);
    setDate(d); dateRef.current = d;
    loadFixtures();
  };
  const goToday = () => { const d = new Date(); setDate(d); dateRef.current = d; loadFixtures(); };

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

  // ---- Grouped, filtered fixtures for render ----
  const grouped = useMemo(() => {
    const shown = fixtures.filter((fx) => !isHidden(fx.competition));
    const hiddenSome = shown.length !== fixtures.length;
    const q = search.trim().toLowerCase();
    const list = q
      ? shown.filter((fx) => (fx.home + " " + fx.away + " " + fx.competition).toLowerCase().indexOf(q) > -1)
      : shown;
    if (!list.length) return { empty: true, hiddenSome };

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
    return { empty: false, groups, order };
  }, [fixtures, isHidden, search, primaryCountry]);

  const detailFx = detailId ? fixtureById(detailId) : null;

  return (
    <>
      <section className="toolbar">
        <div className="date-nav">
          <button className="date-btn" aria-label="Previous day" onClick={() => shiftDay(-1)}>‹</button>
          <button className="date-today" onClick={goToday}>{t("today")}</button>
          <button className="date-btn" aria-label="Next day" onClick={() => shiftDay(1)}>›</button>
          <span className="current-date">{dateLabel}</span>
        </div>
        <div className="toolbar-right">
          <div className="country-pick">
            <label htmlFor="country-select" className="country-label">{t("yourCountry")}</label>
            <select id="country-select" aria-label="Primary country for TV listings"
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
                {t("leagues")}{hiddenCount ? <span className="count-badge"> {hiddenCount} hidden</span> : null}
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
                )) : <p className="n" style={{ padding: "6px 4px" }}>No leagues to filter.</p>}
              </div>
              <label className="remember-row">
                <input type="checkbox" checked={remember}
                  onChange={(e) => { setRemember(e.target.checked); saveFilters(e.target.checked, hidden); }} />
                <span>{t("remember")}</span>
              </label>
            </div>
          </div>
          <div className="search-wrap">
            <input type="search" placeholder={t("search")} aria-label="Search games"
              value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
        </div>
      </section>

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

      {ADSTERRA_CONFIG.enabled && ADSTERRA_CONFIG.top.key ? (
        <AdsterraBanner
          zoneKey={ADSTERRA_CONFIG.top.key}
          width={ADSTERRA_CONFIG.top.width}
          height={ADSTERRA_CONFIG.top.height}
        />
      ) : null}

      <section className="games" aria-live="polite">
        {skeleton ? (
          Array.from({ length: 5 }).map((_, i) => <div className="skeleton" key={i} />)
        ) : grouped.empty ? (
          <div className="empty">
            <div className="big">⚽</div>
            <p dangerouslySetInnerHTML={{
              __html: fixtures.length && grouped.hiddenSome && !search ? t("allFiltered") : t("noSearch"),
            }} />
          </div>
        ) : (
          grouped.order.map((comp, idx) => {
            const games = grouped.groups[comp].slice().sort((a, b) =>
              (a.group || "").localeCompare(b.group || "") || new Date(a.kickoff) - new Date(b.kickoff));
            const badged = games.filter((g) => g.leagueBadgeUrl)[0];
            const badgeUrl = badged ? badged.leagueBadgeUrl : "";
            const buckets = {}, groupOrder = [];
            games.forEach((g) => {
              const k = g.group || "";
              if (!buckets[k]) { buckets[k] = []; groupOrder.push(k); }
              buckets[k].push(g);
            });
            const multiGroup = groupOrder.length > 1 || (groupOrder.length === 1 && groupOrder[0]);
            const showInFeedAd =
              ADSTERRA_CONFIG.enabled && ADSTERRA_CONFIG.inFeed.key &&
              (idx + 1) % ADSTERRA_CONFIG.everyN === 0 && idx < grouped.order.length - 1;
            return (
              <Fragment key={comp}>
                <section className="competition">
                  <h2 className="competition-head">
                    <LeagueLogo url={badgeUrl} name={comp} />
                    <span className="competition-name">{comp}</span>
                    <span className="count">{games.length}</span>
                  </h2>
                  {groupOrder.map((k) => (
                    <div key={k || "_"}>
                      {multiGroup && k ? <h3 className="group-head">{t("group") + " " + k}</h3> : null}
                      {buckets[k].map((g) => (
                        <GameCard key={g.id} fx={g} t={t} locale={locale} primaryCountry={primaryCountry}
                          highlightsById={highlightsById} onOpen={openDetails} onShare={onShare} />
                      ))}
                    </div>
                  ))}
                </section>
                {showInFeedAd ? (
                  <AdsterraBanner
                    zoneKey={ADSTERRA_CONFIG.inFeed.key}
                    width={ADSTERRA_CONFIG.inFeed.width}
                    height={ADSTERRA_CONFIG.inFeed.height}
                  />
                ) : null}
              </Fragment>
            );
          })
        )}
      </section>

      {ADSTERRA_CONFIG.enabled && ADSTERRA_CONFIG.bottom.key ? (
        <AdsterraBanner
          zoneKey={ADSTERRA_CONFIG.bottom.key}
          width={ADSTERRA_CONFIG.bottom.width}
          height={ADSTERRA_CONFIG.bottom.height}
        />
      ) : null}

      {detailFx ? (
        <DetailModal fx={detailFx} checking={!detailFx._tvLoaded} t={t} locale={locale}
          primaryCountry={primaryCountry} onClose={closeDetails} onShare={onShare} />
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
