/**
 * Build authenticated ChatGPT API client from cookies (target account)
 * or reuse parsed curl (source account).
 */

import { CHATGPT_ORIGIN, DEFAULT_USER_AGENT } from "./paths.js";
import { buildRequestHeaders, chatgptFetch } from "./chatgpt-api.js";

export function cookieHeaderFromPlaywrightCookies(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Resolve access token + cookie header for the target account.
 */
export async function sessionFromCookies(playwrightCookies) {
  const cookieHeader = cookieHeaderFromPlaywrightCookies(playwrightCookies);
  const response = await fetch(`${CHATGPT_ORIGIN}/api/auth/session`, {
    headers: {
      accept: "application/json",
      cookie: cookieHeader,
      "user-agent": DEFAULT_USER_AGENT,
    },
  });
  const text = await response.text();
  let session = null;
  try {
    session = text ? JSON.parse(text) : null;
  } catch {
    session = null;
  }
  if (!response.ok || !session?.accessToken) {
    throw new Error(
      `Could not resolve target session from cookies (HTTP ${response.status}). Re-export target.cookies while logged in.`,
    );
  }
  return {
    email: session.user?.email || session.user?.name || "unknown",
    accessToken: session.accessToken,
    cookieHeader,
  };
}

/** Parsed-curl-compatible client for cookie sessions (target). */
export function clientFromSession(session) {
  return {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      cookie: session.cookieHeader,
      "user-agent": DEFAULT_USER_AGENT,
    },
  };
}

export async function targetFetch(session, pathnameOrUrl, options = {}) {
  return chatgptFetch(clientFromSession(session), pathnameOrUrl, options);
}

export { chatgptFetch, buildRequestHeaders };
