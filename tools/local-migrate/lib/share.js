import { readFile } from "node:fs/promises";
import { parseCurl } from "./curl.js";
import {
  checkSession,
  createPublicShare,
  getConversation,
  listAllConversations,
} from "./chatgpt-api.js";
import {
  loadProjectCatalog,
  loadProjectMap,
  projectConversationsAsShareItems,
} from "./projects.js";
import { loadProgress, loadShares, saveProgress, saveShares } from "./state.js";
import { isRateLimitError, waitBetweenItems } from "./util.js";

async function collectItems(options, parsedCurl) {
  const items = [];

  if (!options.projectsOnly) {
    console.log("[source] listing regular conversations…");
    const { items: regular, total } = await listAllConversations(parsedCurl, {
      offset: options.offset,
      pageLimit: options.limit > 0 ? options.limit : 28,
      max: options.max > 0 ? options.max : 0,
    });
    console.log(`[source] loaded ${regular.length} regular chats (total reported: ${total})`);
    for (const item of regular) {
      items.push({ ...item, projectId: null, projectName: null, targetProjectId: null });
    }
  }

  if (options.projects || options.projectsOnly) {
    let catalog = await loadProjectCatalog();
    if (!catalog?.projects?.length) {
      const { discoverSourceProjects } = await import("./projects.js");
      catalog = await discoverSourceProjects(options);
    } else {
      console.log(
        `[projects] using catalog ${catalog.projects.length} project(s), ${catalog.totalConversations || "?"} chats`,
      );
    }
    const mapFile = await loadProjectMap();
    const projectItems = projectConversationsAsShareItems(catalog, mapFile.map || {});
    console.log(`[projects] ${projectItems.length} project conversation(s) to consider`);

    const seen = new Set(items.map((i) => i.id));
    for (const item of projectItems) {
      if (seen.has(item.id)) {
        // Prefer project metadata when chat appears in both lists
        const existing = items.find((i) => i.id === item.id);
        if (existing && !existing.projectId) {
          existing.projectId = item.projectId;
          existing.projectName = item.projectName;
          existing.targetProjectId = item.targetProjectId;
        }
        continue;
      }
      seen.add(item.id);
      items.push(item);
    }
  }

  if (options.max > 0 && items.length > options.max) {
    return items.slice(0, options.max);
  }
  return items;
}

export async function runSharePhase(options) {
  const curlText = await readFile(options.sourceCurl, "utf8");
  const parsedCurl = parseCurl(curlText);
  console.log("[source] curl parsed (auth headers present, values not logged)");

  try {
    const email = await checkSession(parsedCurl);
    console.log(`[source] session ok as ${email}`);
  } catch (error) {
    console.warn(`[source] /api/auth/session check failed: ${error.message}`);
    console.warn("[source] continuing with Authorization/Cookie from curl…");
  }

  const items = await collectItems(options, parsedCurl);
  console.log(`[source] total conversations selected: ${items.length}`);

  if (options.dryRun) {
    console.log("[dry-run] sample:");
    for (const item of items.slice(0, 15)) {
      const proj = item.projectName ? ` [project: ${item.projectName}]` : "";
      console.log(`  - ${item.id}  ${item.title}${proj}`);
    }
    return { shares: [], items };
  }

  const existingShares = await loadShares();
  const byConversationId = new Map(
    (existingShares.items || []).map((item) => [item.conversationId, item]),
  );
  const progress = await loadProgress();

  let createdThisRun = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const alreadyOk = progress.shared[item.id]?.ok && byConversationId.get(item.id)?.shareUrl;

    if (alreadyOk) {
      // Refresh project mapping on existing share records when available
      const prev = byConversationId.get(item.id);
      if (prev && item.projectId && !prev.projectId) {
        prev.projectId = item.projectId;
        prev.projectName = item.projectName;
        prev.targetProjectId = item.targetProjectId;
        byConversationId.set(item.id, prev);
        await saveShares({
          createdAt: existingShares.createdAt,
          items: [...byConversationId.values()],
        });
      }
      console.log(`[share] skip already shared ${index + 1}/${items.length}: ${item.title}`);
      continue;
    }

    try {
      const proj = item.projectName ? ` [project: ${item.projectName}]` : "";
      console.log(`[share] ${index + 1}/${items.length}: ${item.title}${proj}`);
      const conversation = await getConversation(parsedCurl, item.id);
      const currentNode = conversation?.current_node || conversation?.currentNode;
      if (!currentNode) throw new Error("conversation missing current_node");

      const share = await createPublicShare(parsedCurl, item.id, currentNode);
      const record = {
        conversationId: item.id,
        title: item.title,
        shareId: share.shareId,
        shareUrl: share.shareUrl,
        projectId: item.projectId || null,
        projectName: item.projectName || null,
        targetProjectId: item.targetProjectId || null,
        createdAt: new Date().toISOString(),
      };
      byConversationId.set(item.id, record);
      progress.shared[item.id] = {
        ok: true,
        at: record.createdAt,
        shareUrl: share.shareUrl,
        projectId: record.projectId,
      };

      await saveShares({
        createdAt: existingShares.createdAt,
        items: [...byConversationId.values()],
      });
      await saveProgress(progress);

      console.log(`  → ${share.shareUrl}`);
      createdThisRun += 1;
    } catch (error) {
      console.error(`  ✗ ${error.message}`);
      progress.shared[item.id] = {
        ok: false,
        at: new Date().toISOString(),
        error: String(error.message).slice(0, 400),
      };
      await saveProgress(progress);

      if (isRateLimitError(error)) {
        console.error("[share] rate limited — stop and re-run later with larger --batch-pause-ms");
        break;
      }
    }

    await waitBetweenItems({
      index,
      total: items.length,
      batchSize: options.batchSize,
      delayMs: options.delayMs,
      batchPauseMs: options.batchPauseMs,
    });
  }

  const shares = [...byConversationId.values()];
  console.log(`[share] done this run: ${createdThisRun}; total share records: ${shares.length}`);
  return { shares, items };
}
