#!/usr/bin/env node
/**
 * Local ChatGPT conversation migrator (share + continue).
 *
 * 1) Source curl → list conversations → public share links
 * 2) Target cookies → open each share → claim into history
 *
 * Secrets: secrets/ (gitignored). State: migrate-state/ (gitignored).
 * Unofficial APIs + Playwright — rate-limit risk. Own accounts only.
 */

import { parseArgs, printUsage } from "./lib/cli.js";
import { runReceivePhase } from "./lib/receive.js";
import { runSharePhase } from "./lib/share.js";
import { ensureSecrets } from "./lib/state.js";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ChatGPT local migrate (share → continue on account 2)   ║
║  Unofficial API · rate-limit risk · own accounts only    ║
╚══════════════════════════════════════════════════════════╝
`);

  await ensureSecrets(options);

  let shares = [];
  if (!options.receiveOnly) {
    const result = await runSharePhase(options);
    shares = result.shares || [];
  }

  if (options.dryRun || options.shareOnly) {
    console.log("[done] dry-run/share-only complete");
    return;
  }

  await runReceivePhase(options, shares);
  console.log("[done] migrate finished — check migrate-state/progress.json");
}

main().catch((error) => {
  console.error(`\nFATAL: ${error.message}`);
  process.exit(1);
});
