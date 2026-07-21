import { readFile } from "node:fs/promises";
import { parseCurl } from "./curl.js";
import {
  checkSession,
  createPublicShare,
  getConversation,
  listAllConversations,
} from "./chatgpt-api.js";
import { loadProgress, loadShares, saveProgress, saveShares } from "./state.js";
import { isRateLimitError, waitBetweenItems } from "./util.js";

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

  console.log("[source] listing conversations…");
  const { items, total } = await listAllConversations(parsedCurl, {
    offset: options.offset,
    pageLimit: options.limit > 0 ? options.limit : 28,
    max: options.max > 0 ? options.max : 0,
  });
  console.log(`[source] loaded ${items.length} conversations (total reported: ${total})`);

  if (options.dryRun) {
    console.log("[dry-run] first 10:");
    for (const item of items.slice(0, 10)) {
      console.log(`  - ${item.id}  ${item.title}`);
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
      console.log(`[share] skip already shared ${index + 1}/${items.length}: ${item.title}`);
      continue;
    }

    try {
      console.log(`[share] ${index + 1}/${items.length}: ${item.title}`);
      const conversation = await getConversation(parsedCurl, item.id);
      const currentNode = conversation?.current_node || conversation?.currentNode;
      if (!currentNode) throw new Error("conversation missing current_node");

      const share = await createPublicShare(parsedCurl, item.id, currentNode);
      const record = {
        conversationId: item.id,
        title: item.title,
        shareId: share.shareId,
        shareUrl: share.shareUrl,
        createdAt: new Date().toISOString(),
      };
      byConversationId.set(item.id, record);
      progress.shared[item.id] = {
        ok: true,
        at: record.createdAt,
        shareUrl: share.shareUrl,
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
