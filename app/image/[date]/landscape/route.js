/*
 * /image/<date>/landscape — the day's top games for a specific date in the
 * 1200×630 landscape format, ready to post. <date> is YYYY-MM-DD; an invalid
 * value falls back to today. The literal /image/today/landscape has its own
 * static route. See lib/digest-image-endpoint.
 */

import { digestImageHandler } from "@/lib/digest-image-endpoint";

export const runtime = "edge";

export const GET = digestImageHandler("landscape");
