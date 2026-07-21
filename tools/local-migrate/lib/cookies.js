/**
 * Parse target account cookies for Playwright.
 * Accepts Cookie header string or JSON array.
 */

const CF_FINGERPRINT_COOKIES = new Set(["cf_clearance", "__cf_bm", "_cfuvid"]);

function sanitizePlaywrightCookie(cookie) {
  const name = String(cookie?.name || "").trim();
  let value = cookie?.value;
  if (value === undefined || value === null) value = "";
  value = String(value);
  if (!name || /[\s;,]/.test(name)) return null;

  // url-only shape avoids Playwright domain/path validation issues
  return {
    name,
    value,
    url: "https://chatgpt.com/",
  };
}

export function parseTargetCookies(raw) {
  const text = String(raw || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .trim();
  if (!text) throw new Error("target.cookies is empty");

  let cookies = [];

  if (text.startsWith("[")) {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error("target.cookies JSON array is empty");
    }
    cookies = arr.map(sanitizePlaywrightCookie).filter(Boolean);
  } else {
    const header = text.replace(/^cookie:\s*/i, "").replace(/\n/g, " ");
    cookies = header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((pair) => {
        const eq = pair.indexOf("=");
        if (eq === -1) return null;
        return sanitizePlaywrightCookie({
          name: pair.slice(0, eq).trim(),
          value: pair.slice(eq + 1).trim(),
        });
      })
      .filter(Boolean);
  }

  if (cookies.length === 0) {
    throw new Error("No valid cookies parsed from target.cookies");
  }
  return cookies;
}

/** Drop CF clearance cookies from another browser fingerprint. */
export function filterCookiesForPlaywright(cookies) {
  const filtered = cookies.filter((c) => !CF_FINGERPRINT_COOKIES.has(c.name));
  return { filtered, dropped: cookies.length - filtered.length };
}
