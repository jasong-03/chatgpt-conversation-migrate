import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { filterCookiesForPlaywright, parseTargetCookies } from "./cookies.js";
import { CHATGPT_ORIGIN, DEFAULT_USER_AGENT, STATE_DIR } from "./paths.js";
import { loadProgress, loadShares, saveProgress } from "./state.js";
import { jitter, sleep, waitBetweenItems } from "./util.js";

const RISK_RE =
  /\bunusual activity\b|\bverify you are human\b|\btoo many requests\b|\bmaking requests too quickly\b|\btemporarily limited access\b|\bsuspicious activity\b|\bcaptcha\b/i;
const CONTINUE_RE =
  /continue this conversation|continue conversation|tiếp tục cuộc trò chuyện|continue chat|keep chatting/i;
const LOGIN_RE = /^(log in|sign in|đăng nhập)$/i;
const COMPOSER_SELECTORS = [
  "#prompt-textarea",
  "[data-testid='prompt-textarea']",
  "div[contenteditable='true']#prompt-textarea",
  "div[contenteditable='true'][data-placeholder]",
  "textarea#prompt-textarea",
  "form div[contenteditable='true']",
];

function isRiskPage(text) {
  if (!text) return false;
  const head = String(text).slice(0, 1200);
  if (!RISK_RE.test(head)) return false;
  if (/this is a copy of a shared chatgpt conversation/i.test(text)) return false;
  return true;
}

function receiveKey(item) {
  return item.conversationId || item.shareId || item.shareUrl;
}

async function launchBrowser(headless) {
  try {
    const browser = await chromium.launch({
      channel: "chrome",
      headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    console.log("[target] launched Google Chrome channel");
    return browser;
  } catch {
    const browser = await chromium.launch({
      headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    console.log("[target] launched bundled Chromium (chrome channel unavailable)");
    return browser;
  }
}

async function addCookiesSafely(context, cookies) {
  try {
    await context.addCookies(cookies);
    return cookies.length;
  } catch (error) {
    console.warn(`[target] bulk addCookies failed (${error.message}); adding one-by-one…`);
    let ok = 0;
    for (const cookie of cookies) {
      try {
        await context.addCookies([cookie]);
        ok += 1;
      } catch {
        // skip invalid cookie
      }
    }
    if (ok === 0) {
      throw new Error("Could not add any target cookies to Playwright context");
    }
    return ok;
  }
}

async function gotoShareWithRetries(page, shareUrl, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await page.goto(shareUrl, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      const status = response?.status?.() ?? 0;
      if (status >= 400) throw new Error(`HTTP ${status} opening share`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`  nav attempt ${attempt}/${attempts} failed: ${error.message.slice(0, 120)}`);
      await sleep(2000 * attempt);
    }
  }
  throw lastError;
}

async function waitForComposer(page, timeoutMs = 50000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const selector of COMPOSER_SELECTORS) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    const continueButton = page.locator("button, a").filter({ hasText: CONTINUE_RE }).first();
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click().catch(() => undefined);
      await sleep(2500);
    }
    await sleep(500);
  }
  return null;
}

async function clickContinueIfPresent(page) {
  const continueBtn = page.getByRole("button", { name: CONTINUE_RE }).first();
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click();
    await sleep(3500);
    return true;
  }
  const alt = page.locator("button, a").filter({ hasText: CONTINUE_RE }).first();
  if (await alt.isVisible().catch(() => false)) {
    await alt.click();
    await sleep(3500);
    return true;
  }
  return false;
}

async function dismissRateLimitModal(page) {
  const rateModal = page.locator(
    "#modal-conversation-history-rate-limit, [data-testid='modal-conversation-history-rate-limit']",
  ).first();
  if (!(await rateModal.isVisible().catch(() => false))) return;

  console.warn("  rate-limit modal open — waiting up to 3 minutes…");
  const dismiss = page.locator(
    "#modal-conversation-history-rate-limit button, [data-testid='modal-conversation-history-rate-limit'] button",
  ).first();
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click().catch(() => undefined);
  }
  await rateModal.waitFor({ state: "hidden", timeout: 180000 }).catch(() => undefined);
  if (await rateModal.isVisible().catch(() => false)) {
    throw Object.assign(new Error("Conversation history rate-limit modal still open"), {
      fatal: true,
      rateLimit: true,
    });
  }
}

async function sendClaimMessage(page, composer, message) {
  await composer.click({ timeout: 20000, force: true }).catch(async () => {
    await composer.focus();
  });
  await page.keyboard.type(message, { delay: 12 });
  const send = page.locator(
    "[data-testid='send-button'], button[aria-label*='Send'], button[aria-label*='Gửi'], button[aria-label*='Send prompt']",
  ).first();
  if (await send.isVisible().catch(() => false)) {
    await send.click({ timeout: 15000 }).catch(async () => {
      await page.keyboard.press("Enter");
    });
  } else {
    await page.keyboard.press("Enter");
  }
  await sleep(4500);
}

async function dumpFail(page, label) {
  try {
    const shot = path.join(STATE_DIR, `fail-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    const snippet = (await page.locator("body").innerText().catch(() => ""))
      .slice(0, 280)
      .replace(/\s+/g, " ");
    console.warn(`  debug screenshot: ${shot}`);
    console.warn(`  page text: ${snippet}`);
    console.warn(`  url: ${page.url()} (${label})`);
  } catch {
    // ignore debug failures
  }
}

async function claimOneShare(page, item, options) {
  await gotoShareWithRetries(page, item.shareUrl);
  await sleep(2500);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  await sleep(2000);

  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (isRiskPage(bodyText)) {
    throw Object.assign(new Error(`Risk block: ${bodyText.slice(0, 160)}`), { fatal: true });
  }

  const loginBtn = page.getByRole("button", { name: LOGIN_RE }).first();
  if (await loginBtn.isVisible().catch(() => false)) {
    throw Object.assign(new Error("Target cookies not logged in (login button visible)"), {
      fatal: true,
    });
  }
  if (/log in to continue|sign in to continue|đăng nhập để/i.test(bodyText)) {
    throw Object.assign(new Error("Target session not authenticated on share page"), {
      fatal: true,
    });
  }

  const continued = await clickContinueIfPresent(page);
  const composer = await waitForComposer(page, 50000);
  if (!composer) {
    await dumpFail(page, "no-composer");
    throw new Error("No Continue button and no message composer — share claim failed");
  }

  await dismissRateLimitModal(page);
  await sendClaimMessage(page, composer, options.message);

  const finalUrl = page.url();
  const bodyAfter = await page.locator("body").innerText().catch(() => bodyText);
  const claimed =
    /\/c\/[0-9a-f-]{10,}/i.test(finalUrl)
    || /copy of a shared|shared conversation/i.test(bodyAfter)
    || continued
    || Boolean(composer);

  if (!claimed) {
    await dumpFail(page, "unclear-claim");
    throw new Error(`Unclear claim state at ${finalUrl}`);
  }

  return {
    finalUrl,
    mode: continued ? "continue-button" : "composer-claim",
  };
}

export async function runReceivePhase(options, sharesInput) {
  const fileData = await loadShares();
  let shares = sharesInput?.length ? sharesInput : fileData.items || [];
  shares = shares.filter((item) => item?.shareUrl);

  if (options.max > 0) shares = shares.slice(0, options.max);
  if (shares.length === 0) {
    throw new Error("No share links to receive. Run share phase first.");
  }

  const progress = await loadProgress();
  const cookieRaw = await readFile(options.targetCookies, "utf8");
  const cookies = parseTargetCookies(cookieRaw);
  const { filtered, dropped } = filterCookiesForPlaywright(cookies);

  console.log(
    `[target] cookies: ${filtered.length}/${cookies.length}`
    + (dropped ? ` (dropped ${dropped} cf fingerprint cookies)` : ""),
  );

  const browser = await launchBrowser(options.headless);
  const context = await browser.newContext({
    userAgent: DEFAULT_USER_AGENT,
    viewport: { width: 1400, height: 960 },
    locale: "en-US",
  });

  try {
    const added = await addCookiesSafely(context, filtered);
    if (added < filtered.length) {
      console.log(`[target] added ${added}/${filtered.length} cookies`);
    }

    const page = await context.newPage();
    await page.goto(`${CHATGPT_ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await sleep(4000);

    let okCount = 0;
    let consecutiveFails = 0;

    for (let index = 0; index < shares.length; index += 1) {
      const item = shares[index];
      const key = receiveKey(item);

      if (progress.received[key]?.ok) {
        console.log(`[recv] skip ${index + 1}/${shares.length}: ${item.title || key}`);
        continue;
      }

      console.log(`[recv] ${index + 1}/${shares.length}: ${item.title || item.shareUrl}`);
      try {
        const result = await claimOneShare(page, item, options);
        progress.received[key] = {
          ok: true,
          at: new Date().toISOString(),
          shareUrl: item.shareUrl,
          title: item.title || null,
          finalUrl: result.finalUrl,
          mode: result.mode,
        };
        await saveProgress(progress);
        okCount += 1;
        consecutiveFails = 0;
        console.log(`  → ok (${result.mode === "continue-button" ? "continue" : "composer"}) ${result.finalUrl}`);
      } catch (error) {
        consecutiveFails += 1;
        console.error(`  ✗ ${error.message}`);
        progress.received[key] = {
          ok: false,
          at: new Date().toISOString(),
          error: String(error.message).slice(0, 400),
          shareUrl: item.shareUrl,
        };
        await saveProgress(progress);

        if (error.fatal) {
          console.error("[recv] fatal — stopping. Fix login/risk then re-run --receive-only");
          break;
        }
        if (consecutiveFails >= 15) {
          console.error("[recv] 15 consecutive failures — stopping to avoid burn. Re-run later.");
          break;
        }
        await sleep(jitter(8000));
      }

      await waitBetweenItems({
        index,
        total: shares.length,
        batchSize: options.batchSize,
        delayMs: options.delayMs,
        batchPauseMs: options.batchPauseMs,
      });
    }

    console.log(`[recv] succeeded this run: ${okCount}`);
  } finally {
    await browser.close();
  }
}
