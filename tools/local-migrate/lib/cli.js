import path from "node:path";
import { DEFAULT_SOURCE_CURL, DEFAULT_TARGET_COOKIES } from "./paths.js";

export const DEFAULT_OPTIONS = {
  sourceCurl: DEFAULT_SOURCE_CURL,
  targetCookies: DEFAULT_TARGET_COOKIES,
  limit: 0,
  offset: 0,
  delayMs: 4000,
  batchSize: 5,
  batchPauseMs: 5 * 60 * 1000,
  message: "hi",
  headless: false,
  dryRun: false,
  shareOnly: false,
  receiveOnly: false,
  max: 0,
  help: false,
  // Projects
  listProjects: false,
  projects: false,
  projectsOnly: false,
  createProjects: false,
};

export function printUsage() {
  console.log(`
Usage:
  node tools/local-migrate/migrate.mjs [options]

Core options:
  --source <path>       Source account curl file (default: secrets/source.curl)
  --target <path>       Target cookies file (default: secrets/target.cookies)
  --limit <n>           Page size when listing regular chats (default API 28)
  --offset <n>          Start offset for regular chat listing (default 0)
  --max <n>             Max conversations this run (0 = all)
  --delay-ms <n>        Delay between items (default 4000)
  --batch-size <n>      Items per batch before long pause (default 5)
  --batch-pause-ms <n>  Pause between batches (default 300000 = 5 min)
  --message <text>      Message after claim (default "hi")
  --headless            Run browser headless (default: headed)
  --dry-run             List only; no share, no browser
  --share-only          Create share links only
  --receive-only        Claim links from migrate-state/shares.json only
  --help                Show help

Projects:
  --list-projects       List source projects + chat counts (writes projects.json)
  --projects            Include project chats when sharing/migrating
  --projects-only       Only project chats (skip regular /conversations list)
  --create-projects     Create matching empty projects on target (name + instructions)

Typical project flow:
  1) --list-projects
  2) --create-projects
  3) --projects-only --share-only
  4) --receive-only
     (receive assigns claimed chats into mapped target projects)

Setup:
  1) Account 1: Copy as cURL /backend-api/conversations → secrets/source.curl
  2) Account 2: Cookie header from chatgpt.com → secrets/target.cookies
  3) npm install && node tools/local-migrate/migrate.mjs --list-projects
`);
}

export function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--source":
        options.sourceCurl = path.resolve(take());
        break;
      case "--target":
        options.targetCookies = path.resolve(take());
        break;
      case "--limit":
        options.limit = Number(take());
        break;
      case "--offset":
        options.offset = Number(take());
        break;
      case "--max":
        options.max = Number(take());
        break;
      case "--delay-ms":
        options.delayMs = Number(take());
        break;
      case "--batch-size":
        options.batchSize = Number(take());
        break;
      case "--batch-pause-ms":
        options.batchPauseMs = Number(take());
        break;
      case "--message":
        options.message = String(take() || "hi");
        break;
      case "--headless":
        options.headless = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--share-only":
        options.shareOnly = true;
        break;
      case "--receive-only":
        options.receiveOnly = true;
        break;
      case "--list-projects":
        options.listProjects = true;
        break;
      case "--projects":
        options.projects = true;
        break;
      case "--projects-only":
        options.projectsOnly = true;
        options.projects = true;
        break;
      case "--create-projects":
        options.createProjects = true;
        break;
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }

  return options;
}
