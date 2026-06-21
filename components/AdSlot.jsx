/*
 * AdSlot — renders the admin-managed ad units assigned to one layout slot.
 *
 * Units hold the verbatim snippet the ad network shipped; parseSnippet splits
 * each into banner markup plus the scripts that make it run. The actual DOM
 * injection happens client-side in <AdUnits> (after hydration) rather than as
 * JSX here — see that file for why.
 *
 * Placed at each layout position by the home and per-game pages. Renders nothing
 * when no enabled unit targets the slot.
 */

import { activeUnits, parseSnippet } from "@/lib/ads-store";
import AdUnits from "@/components/AdUnits";

export default async function AdSlot({ name }) {
  let units = [];
  try {
    const all = await activeUnits();
    units = all.filter((u) => u.slot === name);
  } catch (e) {
    units = [];
  }
  if (!units.length) return null;
  const parsed = units.map((u) => ({ id: u.id, ...parseSnippet(u.script) }));
  return (
    <div className={`ad-slot ad-slot-${name}`} data-ad-slot={name}>
      <span className="ad-label">Ad</span>
      <AdUnits units={parsed} />
    </div>
  );
}
