/*
 * remotion/index — Remotion entry point (registerRoot). This tree is bundled by
 * the Remotion CLI (see scripts/reel-cron.mjs and .github/workflows/reel-cron.yml),
 * NOT by Next.js — nothing under remotion/ is imported by app code.
 */

import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root.jsx";

registerRoot(RemotionRoot);
