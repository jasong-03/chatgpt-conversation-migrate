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
    const detailRaw = json?.detail ?? json?.message ?? text.slice(0, 300);
    const detail =
      typeof detailRaw === "string"
        ? detailRaw
        : (detailRaw?.message || detailRaw?.code || JSON.stringify(detailRaw));
    const error = new Error(`ChatGPT ${method} ${url.pathname} → ${response.status}: ${detail}`);
    error.status = response.status;
    error.payload = json;
    error.code = detailRaw?.code || json?.code || null;
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

/**
 * List ChatGPT Projects (snorlax gizmos with g-p-* ids).
 * Paginates via cursor when present.
 */
export async function listProjects(parsedCurl, { conversationsPerGizmo = 0 } = {}) {
  const projects = [];
  let cursor = null;

  for (let page = 0; page < 50; page += 1) {
    const query = { conversations_per_gizmo: conversationsPerGizmo };
    if (cursor) query.cursor = cursor;

    const data = await chatgptFetch(parsedCurl, "/backend-api/gizmos/snorlax/sidebar", {
      query,
    });
    const items = Array.isArray(data?.items) ? data.items : [];

    for (const item of items) {
      const gizmo = item.gizmo?.gizmo || item.gizmo;
      if (!gizmo?.id) continue;
      // Projects use g-p- prefix; skip custom GPTs
      if (!String(gizmo.id).startsWith("g-p-")) continue;

      const display = gizmo.display || {};
      projects.push({
        id: gizmo.id,
        name: display.name || gizmo.name || "(unnamed project)",
        instructions: gizmo.instructions || "",
        emoji: display.emoji || null,
        theme: display.theme || null,
        description: display.description || "",
        shortUrl: gizmo.short_url || null,
        updatedAt: gizmo.updated_at || null,
      });
    }

    cursor = data?.cursor || null;
    if (!cursor || items.length === 0) break;
    await sleep(jitter(800));
  }

  return projects;
}

/**
 * List all conversations inside a project (cursor pagination).
 */
export async function listProjectConversations(parsedCurl, projectId, { max = 0 } = {}) {
  const items = [];
  let cursor = null;

  for (let page = 0; page < 200; page += 1) {
    const query = { limit: 28 };
    if (cursor) query.cursor = cursor;

    const data = await chatgptFetch(
      parsedCurl,
      `/backend-api/gizmos/${projectId}/conversations`,
      { query },
    );
    const pageItems = Array.isArray(data?.items) ? data.items : [];
    for (const item of pageItems) {
      if (!item?.id) continue;
      items.push({
        id: item.id,
        title: item.title || "(untitled)",
        projectId,
        updateTime: item.update_time || null,
      });
      if (max > 0 && items.length >= max) return items;
    }

    cursor = data?.cursor || null;
    if (!cursor || pageItems.length === 0) break;
    await sleep(jitter(600));
  }

  return items;
}

/**
 * Create a Project on the authenticated account.
 * Body shape: POST /backend-api/projects { name, instructions }
 */
export async function createProject(parsedCurl, { name, instructions = "" }) {
  const data = await chatgptFetch(parsedCurl, "/backend-api/projects", {
    method: "POST",
    body: {
      name: String(name || "Untitled").slice(0, 120),
      instructions: String(instructions || ""),
    },
  });
  const id = data?.resource?.gizmo?.id || data?.gizmo?.id || data?.id;
  if (!id) throw new Error(`create project failed: missing id in response`);
  return {
    id,
    name: data?.resource?.gizmo?.display?.name || name,
    raw: data,
  };
}

/**
 * Assign an existing conversation into a project (target account).
 */
export async function assignConversationToProject(parsedCurl, conversationId, projectId) {
  return chatgptFetch(parsedCurl, `/backend-api/conversation/${conversationId}`, {
    method: "PATCH",
    body: {
      gizmo_id: projectId,
      conversation_template_id: projectId,
    },
  });
}
