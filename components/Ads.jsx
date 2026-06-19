/*
 * Ads — third-party ad-network loader snippets.
 *
 * These are the self-inserting IIFE loaders provided by the ad network: each
 * creates its own <script> and inserts it next to the currently-last script on
 * the page. They're rendered verbatim as inline scripts (the same
 * dangerouslySetInnerHTML pattern this codebase already uses for JSON-LD and
 * the SEO page scripts) so the network's loader behaves exactly as shipped.
 *
 * Mounted on the fixtures list (home) and the per-game detail pages.
 */

const AD_LOADERS = [
  `(function(jdbll){
var d = document,
    s = d.createElement('script'),
    l = d.scripts[d.scripts.length - 1];
s.settings = jdbll || {};
s.src = "//massivesalad.com/b.X/VZs/d/GClx0jY_W_ch/gebml9Yu-ZtUIlLk/PDTwcbxfNvDIkQ5xNwjpE/tFNvziEi0tO/TVkd2jNiQh";
s.async = true;
s.referrerPolicy = 'no-referrer-when-downgrade';
l.parentNode.insertBefore(s, l);
})({})`,
  `(function(jdbll){
var d = document,
    s = d.createElement('script'),
    l = d.scripts[d.scripts.length - 1];
s.settings = jdbll || {};
s.src = "//massivesalad.com/bGXBVas/d.G/lL0zYdWgcx/UeVm_9_uKZiULlPkhPET/cexRNGDukV5eN/Dpk/tzNSzgEZ0cO/TqkU1vMAwy";
s.async = true;
s.referrerPolicy = 'no-referrer-when-downgrade';
l.parentNode.insertBefore(s, l);
})({})`,
];

export default function Ads() {
  return (
    <>
      {AD_LOADERS.map((js, i) => (
        <script key={i} dangerouslySetInnerHTML={{ __html: js }} />
      ))}
    </>
  );
}
