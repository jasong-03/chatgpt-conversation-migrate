#!/usr/bin/env node
/**
 * Local ChatGPT conversation migrator (share + continue).
 *
 * Regular chats + optional Projects (list / create on target / migrate chats into projects).
 *
 * Secrets: secrets/ (gitignored). State: migrate-state/ (gitignored).
 * Unofficial APIs + Playwright — rate-limit risk. Own accounts only.
 */

import { parseArgs, printUsage } from "./lib/cli.js";
import {
  createProjectsOnTarget,
  discoverSourceProjects,
  loadProjectCatalog,
} from "./lib/projects.js";
import { runReceivePhase } from "./lib/receive.js";
import { runSharePhase } from "./lib/share.js";
import { ensureSecrets } from "./lib/state.js";

function wantsShareOrReceive(options) {
  return (
    options.shareOnly
    || options.receiveOnly
    || options.dryRun
    || options.projects
    || options.projectsOnly
    || (!options.listProjects && !options.createProjects)
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ChatGPT local migrate (chats + optional projects)       ║
║  Unofficial API · rate-limit risk · own accounts only    ║
╚══════════════════════════════════════════════════════════╝
`);

  // Discover source projects → migrate-state/projects.json
  if (options.listProjects) {
    await ensureSecrets(options, { needSource: true, needTarget: false });
    await discoverSourceProjects(options);
    console.log("[done] project catalog → migrate-state/projects.json");
    if (!options.createProjects && !options.projects && !options.projectsOnly && !options.shareOnly) {
      return;
    }
  }

  // Create empty projects on target (name + instructions) → project-map.json
  if (options.createProjects) {
    let catalog = await loadProjectCatalog();
    if (!catalog?.projects?.length) {
      await ensureSecrets(options, { needSource: true, needTarget: true });
      catalog = await discoverSourceProjects(options);
    } else {
      await ensureSecrets(options, { needSource: false, needTarget: true });
    }
    await createProjectsOnTarget(options, catalog);
    console.log("[done] project map → migrate-state/project-map.json");
    if (!wantsShareOrReceive(options) || (options.createProjects && !options.shareOnly && !options.receiveOnly && !options.projects && !options.projectsOnly && !options.dryRun && !options.listProjects)) {
      // If only --create-projects, stop here.
      if (!options.shareOnly && !options.receiveOnly && !options.projects && !options.projectsOnly && !options.dryRun) {
        return;
      }
    }
  }

  // Default path or explicit share/receive/projects migrate
  if (
    options.shareOnly
    || options.receiveOnly
    || options.dryRun
    || options.projects
    || options.projectsOnly
    || (!options.listProjects && !options.createProjects)
  ) {
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
}

main().catch((error) => {
  console.error(`\nFATAL: ${error.message}`);
  process.exit(1);
});
