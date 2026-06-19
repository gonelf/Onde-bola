/*
 * AdSlot — renders the admin-managed ad units assigned to one layout slot.
 *
 * Units hold the verbatim snippet the ad network shipped. Because scripts set
 * via dangerouslySetInnerHTML don't execute, each snippet is parsed into its
 * banner markup (dropped into a container) plus real <script> elements that the
 * browser will run. Self-placing loaders (just an IIFE) are emitted as inline
 * scripts; they insert themselves wherever the network intends.
 *
 * Placed at each layout position by the home and per-game pages. Renders nothing
 * when no enabled unit targets the slot.
 */

import { activeUnits, parseSnippet } from "@/lib/ads-store";

function AdUnit({ unit }) {
  const { html, scripts } = parseSnippet(unit.script);
  return (
    <>
      {html ? <div className="ad-unit" dangerouslySetInnerHTML={{ __html: html }} /> : null}
      {scripts.map((s, i) =>
        s.src
          ? <script key={i} src={s.src} async={s.async} />
          : <script key={i} dangerouslySetInnerHTML={{ __html: s.code }} />
      )}
    </>
  );
}

export default async function AdSlot({ name }) {
  let units = [];
  try {
    const all = await activeUnits();
    units = all.filter((u) => u.slot === name);
  } catch (e) {
    units = [];
  }
  if (!units.length) return null;
  return (
    <div className={`ad-slot ad-slot-${name}`} data-ad-slot={name}>
      {units.map((u) => <AdUnit key={u.id} unit={u} />)}
    </div>
  );
}
