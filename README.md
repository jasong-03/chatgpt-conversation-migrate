# ChatGPT Conversation Migrate

Local CLI to move ChatGPT conversations **from a source account (account 1) to a target account (account 2)**:

1. Account 1 creates **share links** (via curl / session)  
2. Account 2 opens each share → claims it into history (Playwright + cookies)

> Not affiliated with OpenAI. Uses unofficial web APIs + browser automation.  
> Risk of rate limits, captchas, and account restrictions. **Use only with accounts you own.**

---

## What it does / does not do

| Does | Does not |
|------|----------|
| List conversations on account 1 | Officially merge two accounts |
| Bulk-create share links | Native full-sidebar import (official export ZIP) |
| Claim shares → new chats in account 2 history | Transfer Plus, memories, custom GPTs (non-project) |
| **List ChatGPT Projects + chats inside them** | 100% fidelity of project **files** / attachments |
| **Create matching Projects on account 2** (name + instructions) | Bypass captcha / “verify you are human” |
| **Assign claimed chats into those Projects** | Guarantee ChatGPT APIs never change |
| Resume after failures (`migrate-state/`) | |

**Official OpenAI path** (different from this tool): Export data → upload JSON as a **file reference** in a new chat — does not recreate separate sidebar threads.  
See: [Transfer exported conversations](https://help.openai.com/en/articles/9106926-transfer-exported-conversations-between-chatgpt-accounts).

---

## Flow

```text
Account 1                              Account 2
─────────                              ─────────
secrets/source.curl                    secrets/target.cookies
       │                                      │
       ▼                                      ▼
 list conversations                      open /share/...
 create public share links               claim (Continue / send msg)
       │                                      ▲
       └──── migrate-state/shares.json ───────┘
```

---

## Requirements

- Node.js 18+
- Google Chrome (script prefers Playwright `chrome` channel)
- Two ChatGPT accounts you control

## Install

```bash
git clone https://github.com/jasong-03/chatgpt-conversation-migrate.git
cd chatgpt-conversation-migrate
npm install
# postinstall installs Chromium; real Chrome is preferred when available
```

---

## Secrets (never commit)

`.gitignore` blocks `secrets/**` (except `*.example`) and `migrate-state/`.

### Account 1 → `secrets/source.curl`

1. Sign in to the **source** account on [chatgpt.com](https://chatgpt.com)  
2. DevTools → **Network** → find a `conversations` request  
3. Right-click → **Copy** → **Copy as cURL**  
4. Save:

```bash
cp secrets/source.curl.example secrets/source.curl
# paste the full curl into the file
```

Needs `Authorization: Bearer …` and/or `Cookie: …`. When the token expires → copy a fresh curl and re-run (resume skips items already OK).

### Account 2 → `secrets/target.cookies`

1. Sign in to the **target** account (prefer a separate Chrome profile)  
2. DevTools → Network → copy the full **`cookie`** request header  

```bash
cp secrets/target.cookies.example secrets/target.cookies
# paste cookie header (one line) or a Playwright JSON array
```

Must include a logged-in session cookie (e.g. `__Secure-next-auth.session-token` or equivalent).  
**Do not** paste secrets into chat, PRs, or commits.

---

## Usage

### Smoke test

```bash
npm run migrate:dry
# or
node tools/local-migrate/migrate.mjs --dry-run --max 5
```

Lists account 1 conversations only — no share, no browser.

### Share (account 1)

```bash
node tools/local-migrate/migrate.mjs --share-only --max 1   # try one
npm run migrate:share                                       # all
```

### Receive (account 2)

```bash
node tools/local-migrate/migrate.mjs --receive-only --max 1  # try one (headed)
npm run migrate:recv
```

### Full pipeline (regular chats)

```bash
# Safer (fewer rate limits)
node tools/local-migrate/migrate.mjs \
  --delay-ms 5000 \
  --batch-size 5 \
  --batch-pause-ms 300000

# Faster when not rate-limited
node tools/local-migrate/migrate.mjs \
  --delay-ms 2500 \
  --batch-size 10 \
  --batch-pause-ms 20000
```

### Projects (e.g. AIClip, EPLUS, Learn, …)

Projects are first-class in ChatGPT (`g-p-*` gizmos). Flow:

```bash
# 1) List source projects + all chats inside them
npm run migrate:list-projects
# → migrate-state/projects.json

# 2) Create empty matching projects on account 2 (name + instructions)
npm run migrate:create-projects
# → migrate-state/project-map.json  (source id → target id)

# 3) Share only project chats
node tools/local-migrate/migrate.mjs --projects-only --share-only

# 4) Receive on account 2 and auto-assign into mapped projects
node tools/local-migrate/migrate.mjs --receive-only
```

One-shot project chats (after secrets ready):

```bash
node tools/local-migrate/migrate.mjs --create-projects --projects-only
```

**Limits:** project **files** (uploads) are not copied yet; only project shell + chat threads via share/claim.

### npm scripts

| Script | Action |
|--------|--------|
| `npm run migrate:dry` | Dry-run, max 10 |
| `npm run migrate:share` | Share only |
| `npm run migrate:recv` | Receive only |
| `npm run migrate` | Share + receive (regular chats) |
| `npm run migrate:list-projects` | Catalog source projects |
| `npm run migrate:create-projects` | Create projects on target |
| `npm run migrate:projects` | Share+receive project chats only |
| `npm run check` | Syntax-check CLI modules |

---

## CLI options

| Flag | Default | Meaning |
|------|---------|---------|
| `--source <path>` | `secrets/source.curl` | Account 1 curl |
| `--target <path>` | `secrets/target.cookies` | Account 2 cookies |
| `--max <n>` | all | Cap conversations this run |
| `--offset <n>` | `0` | List offset |
| `--delay-ms <n>` | `4000` | Pause between items (+ jitter) |
| `--batch-size <n>` | `5` | Items per batch |
| `--batch-pause-ms <n>` | `300000` | Pause between batches (5 min) |
| `--message <text>` | `hi` | Claim message after opening share |
| `--headless` | off | Headless browser (more CF friction) |
| `--dry-run` | | List only |
| `--share-only` | | Create shares only |
| `--receive-only` | | Claim from `shares.json` only |
| `--list-projects` | | List source projects → `projects.json` |
| `--projects` | | Include project chats with regular chats |
| `--projects-only` | | Only project chats |
| `--create-projects` | | Create/map projects on target |
| `--help` | | Show help |

---

## State & resume

| File | Contents |
|------|----------|
| `migrate-state/shares.json` | Created share URLs |
| `migrate-state/progress.json` | Per-conversation ok/fail |
| `migrate-state/projects.json` | Source project catalog + chat ids |
| `migrate-state/project-map.json` | Source project id → target project id |
| `migrate-state/fail-*.png` | Receive failure screenshots |

- **ok** → skipped on re-run  
- **fail** → retried  
- `Ctrl+C` then re-run the same command is safe  

---

## Rate limits

You may see:

- *Too many requests* / *making requests too quickly*  
- History rate-limit modal  
- Unusual activity / Verify you are human  

**If limited:** stop → wait 10–15+ minutes → `npm run migrate:recv` (or full).  
Increase `--delay-ms` / `--batch-pause-ms`. Do not run two processes in parallel.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Curl parse fail | Paste full Copy as cURL (`#` comments above are fine) |
| `401` / session | Refresh `source.curl` |
| Login on receive | Account 2 cookies expired — copy again |
| Share `ERR_HTTP…` | Run headed; wait out rate limit; use Chrome |
| Rate-limit modal | Script tries to wait; if fatal → pause then resume |
| Network drop | Re-run (resume) |

---

## Repo layout

```text
.
├── README.md
├── package.json
├── .gitignore
├── secrets/
│   ├── source.curl.example
│   ├── target.cookies.example
│   ├── source.curl          # local, gitignored
│   └── target.cookies       # local, gitignored
├── migrate-state/           # local, gitignored
└── tools/local-migrate/
    ├── migrate.mjs          # entry
    ├── README.md
    └── lib/
        ├── cli.js           # argv / help
        ├── paths.js
        ├── util.js
        ├── curl.js          # parse source curl
        ├── cookies.js       # parse target cookies
        ├── chatgpt-api.js   # list / share APIs
        ├── state.js         # progress + shares files
        ├── share.js
        ├── receive.js       # Playwright claim
        ├── projects.js      # list / create / map projects
        └── auth.js          # target session from cookies
```

---

## Security

- Keep secrets only on your machine  
- Never commit `source.curl`, `target.cookies`, or `migrate-state/`  
- Delete/rotate sessions after you’re done if needed  

---

## License / responsibility

This tool uses unofficial ChatGPT APIs and UI automation. You are responsible for compliance with OpenAI’s terms. No guarantee the tool keeps working when OpenAI changes the backend.

Repo: https://github.com/jasong-03/chatgpt-conversation-migrate
