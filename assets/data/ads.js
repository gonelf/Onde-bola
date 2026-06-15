/*
 * Display-ad configuration for Hoje Há Bola.
 *
 * Fill in your Google AdSense IDs to serve real ads. While they're blank the
 * app shows a labelled placeholder where ads would appear (so you can see the
 * placement), and never loads any ad script. Ads only render after the visitor
 * accepts the consent banner.
 */
window.ADS_CONFIG = {
  client: "",            // AdSense publisher id, e.g. "ca-pub-1234567890123456"
  slot: "",              // a display ad-unit id, e.g. "1234567890"
  everyN: 6,             // insert an ad after every N match cards
  showPlaceholder: true, // show a labelled placeholder when not configured
  test: false,           // true -> request AdSense test ads (data-adtest="on")
};
