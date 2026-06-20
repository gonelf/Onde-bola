/*
 * /image/today/square — alias of /image/square. The day's top games in the
 * 1080×1080 square format, ready to post. Assumes a highlight: the day's top
 * game is featured in a hero card above the list by default (?highlight=<fmid>
 * pins another, ?highlight=none opts out). See lib/digest-image-endpoint.
 */

import { digestImageHandler } from "@/lib/digest-image-endpoint";

export const runtime = "edge";

export const GET = digestImageHandler("square");
