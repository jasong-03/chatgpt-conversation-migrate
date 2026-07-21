/**
 * Parse Chrome DevTools "Copy as cURL" into headers for ChatGPT API calls.
 * Never log Authorization/Cookie values.
 */

/** Strip comments and locate the curl command body. */
export function extractCurlCommand(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  if (!text.trim()) throw new Error("source.curl is empty");

  const match = text.match(/(?:^|\n)\s*(curl\b[\s\S]*)$/i);
  if (match?.[1]) return match[1].trim();

  const stripped = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .trim();
  if (/^curl\b/i.test(stripped)) return stripped;

  throw new Error("source.curl must contain a curl command (Copy as cURL from DevTools)");
}

export function parseCurl(raw) {
  const text = extractCurlCommand(raw);
  if (!/^curl\b/i.test(text)) {
    throw new Error("source.curl must start with curl (Copy as cURL from DevTools)");
  }

  const headers = {};
  const headerRe = /(?:^|\s)-H\s+(['"])(.*?)\1/gs;
  let match;
  while ((match = headerRe.exec(text))) {
    const line = match[2];
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name) headers[name] = value;
  }

  const cookieMatch = text.match(/(?:^|\s)(?:-b|--cookie)\s+(['"])(.*?)\1/s);
  if (cookieMatch?.[2]) headers.cookie = cookieMatch[2];

  let url = null;
  const urlQuoted =
    text.match(/curl\s+(?:--location\s+)?(['"])(https?:\/\/[^'"]+)\1/i)
    || text.match(/(['"])(https:\/\/chatgpt\.com\/backend-api\/[^'"]+)\1/i);
  if (urlQuoted?.[2]) url = urlQuoted[2];
  if (!url) {
    const bare = text.match(/https:\/\/chatgpt\.com\/backend-api\/[^\s'"]+/i);
    if (bare) url = bare[0];
  }

  if (!headers.authorization && !headers.cookie) {
    throw new Error("source curl missing Authorization and Cookie headers");
  }

  return {
    url: url || "https://chatgpt.com/backend-api/conversations",
    headers,
    authorization: headers.authorization || null,
    cookie: headers.cookie || null,
  };
}
