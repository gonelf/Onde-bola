/*
 * /image/<date>/portrait — the day's top games for a specific date in the
 * 1080×1920 portrait (story) format, ready to post. <date> is YYYY-MM-DD; an
 * invalid value falls back to today. The literal /image/today/portrait has its
 * own static route. See lib/digest-image-endpoint.
 */

import { digestImageHandler } from "@/lib/digest-image-endpoint";

export const runtime = "edge";

export const GET = digestImageHandler("portrait");
