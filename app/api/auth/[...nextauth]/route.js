/*
 * Auth.js route handler — exposes the NextAuth GET/POST endpoints under
 * /api/auth/* (sign-in, callback, session, sign-out). All config lives in
 * lib/game/auth.js; this file just wires its handlers into the App Router.
 */

import { handlers } from "@/lib/game/auth";

export const { GET, POST } = handlers;
