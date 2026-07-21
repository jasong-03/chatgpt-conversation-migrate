import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "./util.js";
import { PROGRESS_PATH, SECRETS_DIR, SHARES_PATH, STATE_DIR } from "./paths.js";

export async function loadJson(filePath, fallback) {
  if (!(await fileExists(filePath))) return fallback;
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function saveJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function loadProgress() {
  return loadJson(PROGRESS_PATH, { shared: {}, received: {} });
}

export async function saveProgress(progress) {
  await saveJson(PROGRESS_PATH, progress);
}

export async function loadShares() {
  return loadJson(SHARES_PATH, {
    createdAt: new Date().toISOString(),
    items: [],
  });
}

export async function saveShares(sharesFile) {
  await saveJson(SHARES_PATH, {
    ...sharesFile,
    updatedAt: new Date().toISOString(),
  });
}

export async function ensureSecrets(options) {
  await mkdir(SECRETS_DIR, { recursive: true });
  await mkdir(STATE_DIR, { recursive: true });

  if (!options.receiveOnly) {
    if (!(await fileExists(options.sourceCurl))) {
      throw new Error(
        `Missing ${options.sourceCurl}\nCopy as cURL from account 1 → save to secrets/source.curl`,
      );
    }
  }

  if (!options.shareOnly && !options.dryRun) {
    if (!(await fileExists(options.targetCookies))) {
      throw new Error(
        `Missing ${options.targetCookies}\nPut account 2 cookies into secrets/target.cookies`,
      );
    }
  }
}

export { SHARES_PATH, PROGRESS_PATH, STATE_DIR };
