# Project notes for Claude

## Manager game (`/fantasygame`)

**Before making any change to the manager game, read the build documentation
first:** `docs/fantasy-manager-game-BUILD.md` (what was built + the decisions and
their rationale) and `docs/fantasy-manager-game-plan.md` (the plan + phasing).

Why: the game has load-bearing design decisions (deterministic seeded simulator
that outputs the existing animation's exact shape; frozen results; multi-source
ingestion with FotMob as source of truth; Auth.js gated at route level — not the
edge middleware; the whole mode behind the `game` feature flag). Check those docs
so a change stays consistent with them, and update the BUILD doc when a decision
changes.
