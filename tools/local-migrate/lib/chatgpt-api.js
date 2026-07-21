import { CHATGPT_ORIGIN, DEFAULT_USER_AGENT } from "./paths.js";
import { jitter, sleep } from "./util.js";

const PASSTHROUGH_HEADERS = [
  "authorization",
  "cookie",
  "oai-language",
  "oai-device-id",
  "oai-client-version",
  "chatgpt-account-id",
  "openai-sentinel-chat-requirements-token",
];

export function buildRequestHeaders(parsedCurl, extra = {}) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": parsedCurl.headers["user-agent"] || DEFAULT_USER_AGENT,
    origin: CHATGPT_ORIGIN,
    referer: `${CHATGPT_ORIGIN}/`,
    ...extra,
  };

  for (const key of PASSTHROUGH_HEADERS) {
    if (parsedCurl.headers[key]) headers[key] = parsedCurl.headers[key];
  }
  return headers;
}

export async function chatgptFetch(parsedCurl, pathnameOrUrl, { method = "GET", body, query } = {}) {
  const url = /^https?:\/\//i.test(pathnameOrUrl)
    ? new URL(pathnameOrUrl)
    : new URL(pathnameOrUrl, CHATGPT_ORIGIN);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers: buildRequestHeaders(parsedCurl),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const detail = json?.detail || json?.message || text.slice(0, 300);
    const error = new Error(`ChatGPT ${method} ${url.pathname} → ${response.status}: ${detail}`);
    error.status = response.status;
    error.payload = json;
    throw error;
  }

  return json;
}

export async function listAllConversations(parsedCurl, { offset = 0, pageLimit = 28, max = 0 } = {}) {
  const items = [];
  let cursor = offset;
  let total = null;
  const limit = pageLimit > 0 ? pageLimit : 28;

  while (true) {
    const data = await chatgptFetch(parsedCurl, "/backend-api/conversations", {
      query: { offset: cursor, limit, order: "updated" },
    });
    const page = Array.isArray(data?.items) ? data.items : [];
    total = Number.isFinite(data?.total) ? data.total : total;

    for (const item of page) {
      if (item?.id) items.push({ id: item.id, title: item.title || "(untitled)" });
      if (max > 0 && items.length >= max) {
        return { items, total: total ?? items.length };
      }
    }

    if (page.length === 0) break;
    cursor += page.length;
    if (total !== null && cursor >= total) break;
    if (page.length < limit) break;
    await sleep(jitter(1500));
  }

  return { items, total: total ?? items.length };
}

export async function getConversation(parsedCurl, conversationId) {
  return chatgptFetch(parsedCurl, `/backend-api/conversation/${conversationId}`);
}

export async function createPublicShare(parsedCurl, conversationId, currentNodeId) {
  const created = await chatgptFetch(parsedCurl, "/backend-api/share/create", {
    method: "POST",
    body: {
      conversation_id: conversationId,
      current_node_id: currentNodeId,
      is_anonymous: false,
    },
  });

  const shareId = created?.share_id || created?.shareId;
  if (!shareId) {
    throw new Error(`share/create missing share_id for ${conversationId}`);
  }

  try {
    await chatgptFetch(parsedCurl, `/backend-api/share/${shareId}`, {
      method: "PATCH",
      body: {
        share_id: shareId,
        highlighted_message_id: null,
        is_anonymous: false,
        is_public: true,
        is_visible: true,
        title: created?.title || null,
      },
    });
  } catch (error) {
    if (!created?.share_url) throw error;
  }

  return {
    shareId,
    shareUrl: created.share_url || `${CHATGPT_ORIGIN}/share/${shareId}`,
    title: created.title || null,
    alreadyExists: Boolean(created.already_exists),
  };
}

export async function checkSession(parsedCurl) {
  const session = await chatgptFetch(parsedCurl, "/api/auth/session");
  return session?.user?.email || session?.user?.name || "unknown";
}
