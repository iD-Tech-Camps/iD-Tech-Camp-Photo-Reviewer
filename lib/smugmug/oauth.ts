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
  const {
    SMUGMUG_API_KEY,
    SMUGMUG_API_SECRET,
    SMUGMUG_ACCESS_TOKEN,
    SMUGMUG_ACCESS_TOKEN_SECRET,
  } = process.env;

  if (
    !SMUGMUG_API_KEY ||
    !SMUGMUG_API_SECRET ||
    !SMUGMUG_ACCESS_TOKEN ||
    !SMUGMUG_ACCESS_TOKEN_SECRET
  ) {
    throw new Error(
      "SmugMug credentials missing. Set SMUGMUG_API_KEY, SMUGMUG_API_SECRET, " +
        "SMUGMUG_ACCESS_TOKEN, and SMUGMUG_ACCESS_TOKEN_SECRET in .env.local."
    );
  }

  return {
    consumerKey: SMUGMUG_API_KEY,
    consumerSecret: SMUGMUG_API_SECRET,
    accessToken: SMUGMUG_ACCESS_TOKEN,
    accessTokenSecret: SMUGMUG_ACCESS_TOKEN_SECRET,
  };
}
