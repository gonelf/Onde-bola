/*
 * /image/portrait — public, ready-to-post PNG of the day's top games in the
 * 9:16 portrait/story format (1080×1920). See lib/digest-image-endpoint.
 */

import { digestImageHandler } from "@/lib/digest-image-endpoint";

export const runtime = "edge";

export const GET = digestImageHandler("portrait");
