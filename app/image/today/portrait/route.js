/*
 * /image/today/portrait — alias of /image/portrait. The day's top games in the
 * 1080×1920 portrait (story) format, ready to post. See lib/digest-image-endpoint.
 */

import { digestImageHandler } from "@/lib/digest-image-endpoint";

export const runtime = "edge";

export const GET = digestImageHandler("portrait");
