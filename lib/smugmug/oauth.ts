import "server-only";
import { createHmac, randomBytes } from "crypto";

export interface OAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface SignOptions {
  method: string;
  url: string;
  credentials: OAuth1Credentials;
  formBody?: Record<string, string>;
}

// RFC 3986 percent-encoding. encodeURIComponent leaves !*'() unescaped, which
// breaks OAuth 1.0a base-string normalization. We escape those four manually.
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

function generateTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

/**
 * Builds the Authorization header for an OAuth 1.0a HMAC-SHA1 request.
 *
 * The base string includes oauth_* params, query-string params, and any
 * application/x-www-form-urlencoded body params, all percent-encoded and
 * sorted lexicographically. The signing key is `consumerSecret&tokenSecret`,
 * each percent-encoded.
 */
export function buildAuthorizationHeader(opts: SignOptions): string {
  const { method, url, credentials, formBody } = opts;
  const parsed = new URL(url);
  const baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_token: credentials.accessToken,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: generateTimestamp(),
    oauth_nonce: generateNonce(),
    oauth_version: "1.0",
  };

  const allParams: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(oauthParams)) allParams.push([k, v]);
  for (const [k, v] of parsed.searchParams.entries()) allParams.push([k, v]);
  if (formBody) {
    for (const [k, v] of Object.entries(formBody)) allParams.push([k, v]);
  }

  const encoded = allParams
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
    );

  const paramString = encoded.map(([k, v]) => `${k}=${v}`).join("&");

  const baseString = [
    method.toUpperCase(),
    rfc3986(baseUrl),
    rfc3986(paramString),
  ].join("&");

  const signingKey = `${rfc3986(credentials.consumerSecret)}&${rfc3986(credentials.accessTokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  oauthParams.oauth_signature = signature;

  return (
    "OAuth " +
    Object.entries(oauthParams)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`)
      .join(", ")
  );
}

export function loadCredentialsFromEnv(): OAuth1Credentials {
  const consumerKey = sanitizeEnv("SMUGMUG_API_KEY");
  const consumerSecret = sanitizeEnv("SMUGMUG_API_SECRET");
  const accessToken = sanitizeEnv("SMUGMUG_ACCESS_TOKEN");
  const accessTokenSecret = sanitizeEnv("SMUGMUG_ACCESS_TOKEN_SECRET");

  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    throw new Error(
      "SmugMug credentials missing. Set SMUGMUG_API_KEY, SMUGMUG_API_SECRET, " +
        "SMUGMUG_ACCESS_TOKEN, and SMUGMUG_ACCESS_TOKEN_SECRET in .env.local."
    );
  }

  return { consumerKey, consumerSecret, accessToken, accessTokenSecret };
}

// Defensive normalization for credentials read from .env.local. Trims
// whitespace and strips a single layer of surrounding straight or curly
// quotes — the two most common foot-guns when editing a .env file by
// hand. Either of those silently corrupts the OAuth signing key and
// SmugMug returns oauth_problem=signature_invalid (sometimes mapped
// through to nonce_used), which is hard to debug because the error
// looks like a replay attack rather than a credential-shape problem.
function sanitizeEnv(name: string): string {
  const raw = process.env[name];
  if (!raw) return "";
  let v = raw.trim();
  const first = v.charAt(0);
  const last = v.charAt(v.length - 1);
  const QUOTES = new Set(['"', "'", "\u201C", "\u201D", "\u2018", "\u2019"]);
  if (v.length >= 2 && QUOTES.has(first) && QUOTES.has(last)) {
    v = v.slice(1, -1).trim();
  }
  return v;
}
