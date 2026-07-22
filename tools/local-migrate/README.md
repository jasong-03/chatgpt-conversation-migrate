# Local migrate CLI

## Entry point

```bash
node tools/local-migrate/migrate.mjs [options]
# or from the repo root:
npm run migrate
npm run migrate:dry
npm run migrate:share
npm run migrate:recv
npm run migrate:list-projects
npm run migrate:create-projects
npm run migrate:projects
```

Full documentation: [../../README.md](../../README.md)

## Modules

```text
migrate.mjs          CLI entry
lib/
  cli.js             argv + help
  paths.js           repo paths + constants
  util.js            sleep, jitter, batch waits
  curl.js            parse source Copy-as-cURL
  cookies.js         parse target cookies
  auth.js            target session from cookies
  chatgpt-api.js     list / conversation / share / projects APIs
  state.js           shares.json + progress.json
  projects.js        discover / create / map projects
  share.js           share phase
  receive.js         Playwright receive + assign to project
```

## Projects quick path

```bash
npm run migrate:list-projects      # catalog source projects
npm run migrate:create-projects    # create empty projects on target
node tools/local-migrate/migrate.mjs --projects-only --share-only
node tools/local-migrate/migrate.mjs --receive-only
```
