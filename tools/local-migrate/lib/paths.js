import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (tools/local-migrate/lib → ../../..) */
export const ROOT = path.resolve(__dirname, "../../..");
export const SECRETS_DIR = path.join(ROOT, "secrets");
export const STATE_DIR = path.join(ROOT, "migrate-state");

export const DEFAULT_SOURCE_CURL = path.join(SECRETS_DIR, "source.curl");
export const DEFAULT_TARGET_COOKIES = path.join(SECRETS_DIR, "target.cookies");
export const SHARES_PATH = path.join(STATE_DIR, "shares.json");
export const PROGRESS_PATH = path.join(STATE_DIR, "progress.json");

export const CHATGPT_ORIGIN = "https://chatgpt.com";
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
