# Conversation Move GPT

Local CLI chuyển hội thoại ChatGPT **từ account nguồn (nick 1) sang account đích (nick 2)**:

1. Nick 1 tạo **share link** (curl / session)  
2. Nick 2 mở share → claim vào history (Playwright + cookies)

> Không liên kết với OpenAI. Dùng API web không chính thức + browser automation.  
> Rủi ro rate-limit / captcha / giới hạn account. **Chỉ dùng account bạn sở hữu.**

---

## Làm được / không làm được

| Làm được | Không làm được |
|----------|----------------|
| List hội thoại nick 1 | Merge official 2 account |
| Tạo share hàng loạt | Import native full sidebar (export ZIP official) |
| Claim share → chat mới trong history nick 2 | Chuyển Plus, memories, GPTs, custom instructions |
| Resume sau lỗi (`migrate-state/`) | Bypass captcha / “verify human” |
| Chạy theo lô + nghỉ giữa lô | Đảm bảo API ChatGPT không đổi |

**Official OpenAI** (khác tool này): Export data → upload JSON làm **file reference** trong 1 chat mới — không tạo từng thread sidebar.  
Docs: [Transfer exported conversations](https://help.openai.com/en/articles/9106926-transfer-exported-conversations-between-chatgpt-accounts).

---

## Luồng

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

## Yêu cầu

- Node.js 18+
- Google Chrome (script ưu tiên Playwright channel `chrome`)
- Hai account ChatGPT bạn kiểm soát

## Cài đặt

```bash
git clone https://github.com/jasong-03/conversation-move-gpt.git
cd conversation-move-gpt
npm install
# postinstall cài Chromium; Chrome thật sẽ được ưu tiên nếu có
```

---

## Secrets (không commit)

`.gitignore` chặn `secrets/**` (trừ `*.example`) và `migrate-state/`.

### Account 1 → `secrets/source.curl`

1. Login nick nguồn trên [chatgpt.com](https://chatgpt.com)  
2. DevTools → **Network** → request `conversations`  
3. Right-click → **Copy as cURL**  
4. Lưu:

```bash
cp secrets/source.curl.example secrets/source.curl
# dán full curl vào file
```

Cần `Authorization: Bearer …` và/hoặc `Cookie: …`. Token hết hạn → copy curl mới, chạy lại (resume skip item đã ok).

### Account 2 → `secrets/target.cookies`

1. Login nick đích (nên profile Chrome riêng)  
2. DevTools → Network → copy header **`cookie`** (cả dòng)  

```bash
cp secrets/target.cookies.example secrets/target.cookies
# dán cookie header (1 dòng) hoặc JSON array Playwright
```

Cần session login (ví dụ cookie `__Secure-next-auth.session-token` / tương đương).  
**Không** dán secret vào chat / PR / commit.

---

## Chạy

### Smoke test

```bash
npm run migrate:dry
# hoặc
node tools/local-migrate/migrate.mjs --dry-run --max 5
```

Chỉ list hội thoại nick 1 — không share, không browser.

### Share (nick 1)

```bash
node tools/local-migrate/migrate.mjs --share-only --max 1   # thử 1
npm run migrate:share                                         # tất cả
```

### Receive (nick 2)

```bash
node tools/local-migrate/migrate.mjs --receive-only --max 1  # thử 1 (headed)
npm run migrate:recv
```

### Full pipeline

```bash
# An toàn (ít rate-limit)
node tools/local-migrate/migrate.mjs \
  --delay-ms 5000 \
  --batch-size 5 \
  --batch-pause-ms 300000

# Nhanh hơn khi không bị limit
node tools/local-migrate/migrate.mjs \
  --delay-ms 2500 \
  --batch-size 10 \
  --batch-pause-ms 20000
```

### npm scripts

| Script | Việc |
|--------|------|
| `npm run migrate:dry` | Dry-run max 10 |
| `npm run migrate:share` | Chỉ share |
| `npm run migrate:recv` | Chỉ receive |
| `npm run migrate` | Share + receive |
| `npm run check` | Syntax check CLI |

---

## Tham số CLI

| Flag | Mặc định | Ý nghĩa |
|------|----------|---------|
| `--source <path>` | `secrets/source.curl` | Curl nick 1 |
| `--target <path>` | `secrets/target.cookies` | Cookies nick 2 |
| `--max <n>` | all | Giới hạn số chat / run |
| `--offset <n>` | `0` | Offset list |
| `--delay-ms <n>` | `4000` | Nghỉ giữa item (+ jitter) |
| `--batch-size <n>` | `5` | Item mỗi lô |
| `--batch-pause-ms <n>` | `300000` | Nghỉ giữa lô (5 phút) |
| `--message <text>` | `hi` | Tin claim sau mở share |
| `--headless` | off | Browser ẩn (dễ dính CF) |
| `--dry-run` | | Chỉ list |
| `--share-only` | | Chỉ tạo share |
| `--receive-only` | | Chỉ claim từ `shares.json` |
| `--help` | | Help |

---

## State & resume

| File | Nội dung |
|------|----------|
| `migrate-state/shares.json` | Share URL đã tạo |
| `migrate-state/progress.json` | ok/fail từng conversation |
| `migrate-state/fail-*.png` | Screenshot lỗi receive |

- **ok** → skip khi chạy lại  
- **fail** → thử lại  
- `Ctrl+C` rồi chạy lại cùng lệnh là được  

---

## Rate-limit

Có thể gặp:

- *Too many requests* / *making requests too quickly*  
- Modal history rate-limit  
- Unusual activity / Verify human  

**Khi bị limit:** dừng → chờ 10–15+ phút → `npm run migrate:recv` (hoặc full).  
Tăng `--delay-ms` / `--batch-pause-ms`. Không chạy 2 process song song.

---

## Troubleshooting

| Lỗi | Xử lý |
|-----|--------|
| Curl parse fail | Dán full Copy as cURL (comment `#` phía trên được) |
| `401` / session | Copy lại `source.curl` |
| Login trên receive | Cookie nick 2 hết hạn — copy lại |
| Share `ERR_HTTP…` | Chạy headed; nghỉ rate-limit; dùng Chrome |
| Rate-limit modal | Script cố đợi; fatal → nghỉ rồi resume |
| Mất mạng | Re-run (resume) |

---

## Cấu trúc repo

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
        └── receive.js       # Playwright claim
```

---

## Bảo mật

- Secrets chỉ trên máy bạn  
- Không commit `source.curl` / `target.cookies` / `migrate-state/`  
- Xoá/rotate session sau khi xong nếu cần  

---

## License / trách nhiệm

Tool dùng API/UI ChatGPT không chính thức. Người dùng tự chịu trách nhiệm theo điều khoản OpenAI. Không đảm bảo hoạt động khi OpenAI đổi backend.

Repo: https://github.com/jasong-03/conversation-move-gpt
