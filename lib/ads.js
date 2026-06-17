/*
 * Display-ad configuration for Hoje Há Bola.
 *
 * The publisher id below ties the page to its Google AdSense account. Fill in
 * the per-unit slot ids to serve real banners; while a slot is blank the app
 * shows a labelled placeholder where that ad would appear (so you can see the
 * placement) and never loads a real unit for it. Ads only render after the
 * visitor accepts the consent banner.
 *
 * (Ported from assets/data/ads.js, which assigned window.ADS_CONFIG.)
 */
export const ADS_CONFIG = {
  client: "ca-pub-2180847694344203", // AdSense publisher id (matches the page meta tag)
  topSlot: "",           // leaderboard banner shown above the games feed
  slot: "",              // in-feed banner inserted between match cards
  bottomSlot: "",        // banner shown below the games feed
  everyN: 6,             // insert an in-feed ad after every N match cards
  showPlaceholder: true, // show a labelled placeholder when a slot is not configured
  test: false,           // true -> request AdSense test ads (data-adtest="on")
};
