/*
 * Free-to-air channel classifier.
 *
 * The app shows real per-match broadcast listings. Those listings are just
 * channel names + country, so we tag each channel as free-to-air (shown in
 * green) or otherwise treat it as paid cable / subscription (amber, with a
 * lock). This set lists common over-the-air broadcasters across major markets;
 * anything not listed is assumed paid.
 *
 * ESM module shared by the client UI and the server-rendered /g pSEO pages.
 * (Ported from assets/data/broadcasters.js, which was a dual <script>/require
 * IIFE; the standalone modules now use plain imports.)
 */

const FREE_LIST = [
  // United Kingdom & Ireland
  "BBC", "BBC One", "BBC Two", "BBC Three", "BBC iPlayer", "ITV", "ITV1", "ITV4",
  "ITVX", "STV", "Channel 4", "Channel 5", "S4C", "RTE", "RTÉ", "RTÉ2", "TG4", "Virgin Media",
  // Portugal (free over-the-air / DTT)
  "RTP", "RTP1", "RTP2", "RTP3", "RTP Madeira", "RTP Açores", "RTP Internacional",
  "TVI", "SIC", "CMTV", "Canal 11",
  // Spain
  "La 1", "La 2", "RTVE", "TVE", "Telecinco", "Cuatro", "Antena 3", "GOL", "Teledeporte",
  // United States
  "ABC", "CBS", "NBC", "FOX", "Telemundo", "Universo", "Univision", "TUDN Free",
  // Brazil & Latin America
  "Globo", "TV Globo", "SBT", "Record", "Band", "RedeTV", "CazéTV", "TV Azteca", "Canal 5",
  // France
  "TF1", "France 2", "France 3", "M6", "France.tv",
  // Germany
  "ARD", "Das Erste", "ZDF", "RTL", "Sat.1", "ProSieben",
  // Italy
  "Rai 1", "Rai 2", "Rai 3", "RAI 1", "Mediaset", "Canale 5", "Italia 1",
  // Netherlands / Belgium
  "NPO", "NPO 1", "NPO 3", "RTL 7", "VTM", "Eén", "RTBF", "La Une",
  // Nordics
  "SVT", "SVT1", "TV4", "NRK", "DR", "DR1", "Yle", "TV2",
  // Others
  "SBS", "ABC TV", "Optus Sport Free", "Star Sports First", "DD Sports", "DD National",
];

export const FREE_TO_AIR = FREE_LIST.reduce((acc, name) => {
  acc[name] = true;
  return acc;
}, {});

// Normalised channel-name key: lowercased, accent-stripped, with quality tags
// (HD/UHD/SD/4K) and all non-alphanumerics removed. Lets us recognise an
// open-signal channel even when the feed spells it differently — "RTP 1",
// "RTP1 HD" and "RTP1" all collapse to "rtp1".
export function normChannelName(name) {
  return String(name == null ? "" : name)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(?:hd|uhd|fhd|sd|4k)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export const FREE_TO_AIR_NORM = FREE_LIST.reduce((acc, name) => {
  acc[normChannelName(name)] = true;
  return acc;
}, {});

// Free-to-air if it matches by exact name OR by normalised key (so spacing /
// quality-tag variants of an open channel still count as free, never paid).
export function isPaidChannel(name) {
  if (FREE_TO_AIR[name]) return false;
  return !FREE_TO_AIR_NORM[normChannelName(name)];
}
