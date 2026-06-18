// Adsterra banner configuration.
//
// Each placement points at an Adsterra banner zone created in the publisher
// dashboard (beta.publishers.adsterra.com). From a zone's invoke snippet —
//   <script src="https://www.highperformanceformat.com/<KEY>/invoke.js"></script>
// copy the <KEY> and its width/height here. A blank key disables that placement
// (nothing renders), so you can add the remaining zones as you create them.
//
// This runs while the Google AdSense account (see lib/ads.js) is in approval;
// set `enabled` to false — or clear the keys — once AdSense takes over.

export const ADSTERRA_CONFIG = {
  enabled: true,

  // Leaderboard banner shown above the games feed.
  // 468x60 fits the desktop column; add a 320x50 zone for a better mobile fit.
  top: { key: "510c25dac484729e03847e74399926d9", width: 468, height: 60 },

  // Banner shown below the games feed. Reuses the 468x60 zone for now; create a
  // dedicated zone here for cleaner per-placement reporting.
  bottom: { key: "510c25dac484729e03847e74399926d9", width: 468, height: 60 },

  // Rectangle inserted between competition groups. Add a 300x250 zone to enable.
  inFeed: { key: "", width: 300, height: 250 },

  // Insert the in-feed unit after every N competition groups (when enabled).
  everyN: 3,
};
