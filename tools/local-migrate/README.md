# Local migrate CLI

## Entry point

```bash
node tools/local-migrate/migrate.mjs [options]
# or from the repo root:
npm run migrate
npm run migrate:dry
npm run migrate:share
npm run migrate:recv
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
  chatgpt-api.js     list / conversation / share APIs
  state.js           shares.json + progress.json
  share.js           share phase
  receive.js         Playwright receive phase
```
