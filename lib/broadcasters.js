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
  // Portugal
  "RTP", "RTP1", "RTP2", "RTP3", "TVI", "SIC", "CMTV",
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

export function isPaidChannel(name) {
  return !FREE_TO_AIR[name];
}
