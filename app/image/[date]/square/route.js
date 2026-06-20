/*
 * /image/<date>/square — the day's top games for a specific date in the
 * 1080×1080 square format, ready to post. <date> is YYYY-MM-DD; an invalid
 * value falls back to today. Assumes a highlight: the day's top game is featured
 * in a hero card above the list by default (?highlight=<fmid> pins another,
 * ?highlight=none opts out). The literal /image/today/square has its own static
 * route. See lib/digest-image-endpoint.
 */

import { digestImageHandler } from "@/lib/digest-image-endpoint";

export const runtime = "edge";

export const GET = digestImageHandler("square");
