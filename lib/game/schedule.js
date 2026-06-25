/*
 * schedule.js — double round-robin fixture generator for a league season.
 *
 * Standard circle method: with N clubs (a bye is added when N is odd) each round
 * pairs everyone once; the first leg is N-1 rounds, the second leg mirrors it
 * with home/away swapped → 2(N-1) rounds, every pair meeting home and away once.
 *
 * Pure + deterministic. `buildFixtures` stamps each fixture with a stable seed
 * (so its simulated result is reproducible) and a `scheduledAt` one matchday
 * apart, starting from `startAtMs` spaced by `intervalMs` (default a day).
 */

// Rounds of [homeClubId, awayClubId] pairs — first leg only.
function firstLeg(clubIds) {
  const teams = clubIds.slice();
  const bye = "__bye__";
  if (teams.length % 2 === 1) teams.push(bye);
  const n = teams.length;
  const rounds = [];
  const arr = teams.slice();
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const home = arr[i];
      const away = arr[n - 1 - i];
      if (home !== bye && away !== bye) {
        // Alternate home/away by round so it isn't always the same side.
        if (r % 2 === 0) pairs.push([home, away]);
        else pairs.push([away, home]);
      }
    }
    rounds.push(pairs);
    // Rotate, keeping the first team fixed.
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

// Full double round-robin: first leg + mirrored second leg.
export function doubleRoundRobin(clubIds) {
  const leg1 = firstLeg(clubIds);
  const leg2 = leg1.map((round) => round.map(([h, a]) => [a, h]));
  return leg1.concat(leg2);
}

function seedFor(leagueId, round, home, away) {
  let h = 2166136261;
  const s = `${leagueId}|${round}|${home}|${away}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}

/*
 * Returns fixture rows ready to insert:
 *   { leagueId, round, homeClubId, awayClubId, scheduledAt: Date, status, seed }
 */
export function buildFixtures(leagueId, clubIds, { startAtMs, intervalMs } = {}) {
  const start = startAtMs || 0;
  const step = intervalMs || 86400000; // one day
  const rounds = doubleRoundRobin(clubIds);
  const fixtures = [];
  rounds.forEach((pairs, ri) => {
    const round = ri + 1;
    const when = new Date(start + ri * step);
    pairs.forEach(([home, away]) => {
      fixtures.push({
        leagueId,
        round,
        homeClubId: home,
        awayClubId: away,
        scheduledAt: when,
        status: "scheduled",
        seed: seedFor(leagueId, round, home, away),
      });
    });
  });
  return fixtures;
}
