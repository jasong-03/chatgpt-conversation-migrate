/**
 * Project discovery (source) + recreate on target + collect chats for migrate.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { sessionFromCookies, targetFetch } from "./auth.js";
import {
  assignConversationToProject,
  createProject,
  listProjectConversations,
  listProjects,
} from "./chatgpt-api.js";
import { parseTargetCookies } from "./cookies.js";
import { parseCurl } from "./curl.js";
import { STATE_DIR } from "./paths.js";
import { loadJson, saveJson } from "./state.js";
import { jitter, sleep } from "./util.js";

export const PROJECTS_CATALOG_PATH = path.join(STATE_DIR, "projects.json");
export const PROJECT_MAP_PATH = path.join(STATE_DIR, "project-map.json");

/**
 * Fetch all projects and their conversations from source account.
 * Writes migrate-state/projects.json
 */
export async function discoverSourceProjects(options) {
  const curlText = await readFile(options.sourceCurl, "utf8");
  const parsedCurl = parseCurl(curlText);

  console.log("[projects] listing projects on source…");
  const projects = await listProjects(parsedCurl, { conversationsPerGizmo: 0 });
  console.log(`[projects] found ${projects.length} project(s)`);

  const catalog = {
    createdAt: new Date().toISOString(),
    source: "source.curl",
    projects: [],
  };

  let totalChats = 0;
  for (let i = 0; i < projects.length; i += 1) {
    const project = projects[i];
    console.log(`[projects] ${i + 1}/${projects.length}: ${project.name} (${project.id})`);
    const conversations = await listProjectConversations(parsedCurl, project.id, {
      max: options.max > 0 ? options.max : 0,
    });
    console.log(`  → ${conversations.length} conversation(s)`);
    totalChats += conversations.length;
    catalog.projects.push({
      ...project,
      conversations,
    });
    await sleep(jitter(500));
  }

  catalog.updatedAt = new Date().toISOString();
  catalog.totalConversations = totalChats;
  await saveJson(PROJECTS_CATALOG_PATH, catalog);
  console.log(`[projects] catalog saved → ${PROJECTS_CATALOG_PATH} (${totalChats} chats)`);
  return catalog;
}

/**
 * Create matching projects on target account. Maps source project id → target id.
 */
export async function createProjectsOnTarget(options, catalog) {
  const cookieRaw = await readFile(options.targetCookies, "utf8");
  const cookies = parseTargetCookies(cookieRaw);
  const session = await sessionFromCookies(cookies);
  console.log(`[projects] target session ok as ${session.email}`);

  const client = {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      cookie: session.cookieHeader,
    },
  };

  const existingMap = await loadJson(PROJECT_MAP_PATH, {
    createdAt: new Date().toISOString(),
    map: {},
  });
  const map = { ...existingMap.map };

  // Existing target projects by name (avoid duplicates when re-running)
  let targetProjects = [];
  try {
    targetProjects = await listProjects(client, { conversationsPerGizmo: 0 });
  } catch (error) {
    console.warn(`[projects] could not list target projects: ${error.message}`);
  }
  const byName = new Map(targetProjects.map((p) => [p.name.toLowerCase(), p]));

  for (const project of catalog.projects || []) {
    const key = project.id;
    if (map[key]?.targetProjectId) {
      console.log(`[projects] skip create (mapped): ${project.name}`);
      continue;
    }

    const existing = byName.get(String(project.name).toLowerCase());
    if (existing) {
      map[key] = {
        sourceProjectId: project.id,
        sourceName: project.name,
        targetProjectId: existing.id,
        targetName: existing.name,
        reused: true,
        at: new Date().toISOString(),
      };
      console.log(`[projects] reuse existing target project: ${project.name} → ${existing.id}`);
      continue;
    }

    try {
      console.log(`[projects] create on target: ${project.name}`);
      const created = await createProject(client, {
        name: project.name,
        instructions: project.instructions || "",
      });
      map[key] = {
        sourceProjectId: project.id,
        sourceName: project.name,
        targetProjectId: created.id,
        targetName: created.name,
        reused: false,
        at: new Date().toISOString(),
      };
      console.log(`  → ${created.id}`);
      byName.set(String(project.name).toLowerCase(), {
        id: created.id,
        name: project.name,
      });
      await sleep(jitter(1200));
    } catch (error) {
      console.error(`  ✗ create failed: ${error.message}`);
      map[key] = {
        sourceProjectId: project.id,
        sourceName: project.name,
        targetProjectId: null,
        error: String(error.message).slice(0, 400),
        at: new Date().toISOString(),
      };
    }
  }

  const out = {
    createdAt: existingMap.createdAt,
    updatedAt: new Date().toISOString(),
    map,
  };
  await saveJson(PROJECT_MAP_PATH, out);
  console.log(`[projects] map saved → ${PROJECT_MAP_PATH}`);
  return out;
}

/**
 * Flatten project catalog into shareable conversation items (with project metadata).
 */
export function projectConversationsAsShareItems(catalog, projectMap = {}) {
  const items = [];
  for (const project of catalog.projects || []) {
    const mapping = projectMap[project.id] || {};
    for (const conv of project.conversations || []) {
      items.push({
        id: conv.id,
        title: conv.title,
        projectId: project.id,
        projectName: project.name,
        targetProjectId: mapping.targetProjectId || null,
      });
    }
  }
  return items;
}

/**
 * After receive claim, assign conversation on target to the mapped project.
 */
export async function assignClaimedChatToProject(options, {
  conversationId,
  targetProjectId,
}) {
  if (!conversationId || !targetProjectId) return false;
  const cookieRaw = await readFile(options.targetCookies, "utf8");
  const cookies = parseTargetCookies(cookieRaw);
  const session = await sessionFromCookies(cookies);
  const client = {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      cookie: session.cookieHeader,
    },
  };
  await assignConversationToProject(client, conversationId, targetProjectId);
  return true;
}

export async function loadProjectCatalog() {
  return loadJson(PROJECTS_CATALOG_PATH, null);
}

export async function loadProjectMap() {
  return loadJson(PROJECT_MAP_PATH, { map: {} });
}
