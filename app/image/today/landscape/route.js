/*
 * /image/today/landscape — alias of /image/landscape. The day's top games in
 * the 1200×630 landscape format, ready to post. See lib/digest-image-endpoint.
 */

import { digestImageHandler } from "@/lib/digest-image-endpoint";

export const runtime = "edge";

export const GET = digestImageHandler("landscape");
