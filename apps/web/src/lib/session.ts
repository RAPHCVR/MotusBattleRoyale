import { headers } from "next/headers";

import { auth } from "./auth";

export async function getSessionFromHeaders(requestHeaders: Headers) {
  return auth.api.getSession({
    headers: requestHeaders
  });
}

export async function getServerSession() {
  const requestHeaders = await headers();
  return getSessionFromHeaders(requestHeaders);
}
