/*
 * /image/landscape — public, ready-to-post PNG of the day's top games in the
 * 1200×630 landscape format. See lib/digest-image-endpoint.
 */

import { digestImageHandler } from "@/lib/digest-image-endpoint";

export const runtime = "edge";

export const GET = digestImageHandler("landscape");
