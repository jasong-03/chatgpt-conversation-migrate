import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Randomize delay slightly to look less robotic. */
export function jitter(ms) {
  const base = Math.max(500, Number(ms) || 0);
  return base + Math.floor(Math.random() * Math.min(3000, base));
}

export async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Wait between items; longer pause on batch boundaries. */
export async function waitBetweenItems({ index, total, batchSize, delayMs, batchPauseMs, label = "" }) {
  const next = index + 1;
  if (next >= total) return;
  const isBatchBoundary = batchSize > 0 && next % batchSize === 0;
  const waitMs = isBatchBoundary ? batchPauseMs : jitter(delayMs);
  const suffix = isBatchBoundary ? " (batch pause)" : "";
  const prefix = label ? `${label} ` : "";
  console.log(`  … ${prefix}waiting ${Math.round(waitMs / 1000)}s${suffix}`);
  await sleep(waitMs);
}

export function isRateLimitError(error) {
  const status = error?.status;
  const message = String(error?.message || "");
  return status === 429 || /too many|rate limit|unusual activity/i.test(message);
}
