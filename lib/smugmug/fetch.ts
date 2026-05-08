import "server-only";
import {
  buildAuthorizationHeader,
  loadCredentialsFromEnv,
  type OAuth1Credentials,
} from "./oauth";
import type { SmugMugResponseEnvelope } from "./types";

const BASE_URL = "https://api.smugmug.com";

const MAX_RETRIES_429 = 3;
const MAX_RETRIES_5XX = 3;
const MAX_REDIRECTS = 3;
const BASE_BACKOFF_MS = 1000;

export class SmugMugApiError extends Error {
  status: number;
  url: string;
  bodyExcerpt: string;

  constructor(status: number, url: string, bodyExcerpt: string) {
    super(`SmugMug ${status} for ${url}: ${bodyExcerpt.slice(0, 200)}`);
    this.name = "SmugMugApiError";
    this.status = status;
    this.url = url;
    this.bodyExcerpt = bodyExcerpt;
  }
}

export interface FetchOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined | null>;
  formBody?: Record<string, string>;
  credentials?: OAuth1Credentials;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(
  path: string,
  query?: Record<string, string | number | undefined | null>
): string {
  const url = new URL(path.startsWith("http") ? path : `${BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Server-only signed fetch against the SmugMug v2 API.
 *
 * Handles OAuth 1.0a signing per request (nonce/timestamp regenerate on each
 * retry attempt), retries 429s honoring `Retry-After`, retries 5xx with
 * exponential backoff, manually re-signs and follows 3xx redirects (SmugMug
 * uses 301 to canonicalize bare image keys to versioned keys, e.g.
 * `/api/v2/image/abc` → `/api/v2/image/abc-0`; auto-following with the
 * original Authorization header would replay the OAuth nonce and trigger
 * `oauth_problem=nonce_used` on the second hop), and throws SmugMugApiError
 * on any other non-2xx.
 *
 * Returns the unwrapped `Response` payload from SmugMug's envelope, typed as T.
 */
export async function smugmugFetch<T>(
  path: string,
  opts: FetchOptions = {}
): Promise<T> {
  const method = opts.method ?? "GET";
  const credentials = opts.credentials ?? loadCredentialsFromEnv();
  // Reassigned when we follow a redirect — each hop needs its own
  // OAuth signature because the URL is part of the signing base string.
  let url = buildUrl(path, opts.query);

  let attempt429 = 0;
  let attempt5xx = 0;
  let redirectsFollowed = 0;

  // Loop until the request succeeds, throws, or exhausts retries.
  while (true) {
    const authHeader = buildAuthorizationHeader({
      method,
      url,
      credentials,
      formBody: opts.formBody,
    });

    const headers: Record<string, string> = {
      Authorization: authHeader,
      Accept: "application/json",
    };

    let body: string | undefined;
    if (opts.formBody) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.formBody).toString();
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        cache: "no-store",
        // Critical for OAuth 1.0a: undici (Node's fetch) follows 3xx
        // redirects by default and re-sends the original Authorization
        // header verbatim. SmugMug treats the second request's nonce
        // as a replay and returns 401 oauth_problem=nonce_used. Manual
        // mode lets us surface the redirect as a hard error instead
        // (see below) — SmugMug's v2 API isn't supposed to redirect
        // for legitimate calls, so a 3xx is a signal that the URL we
        // built is slightly wrong (trailing slash, wrong casing,
        // unencoded character) and worth fixing at the source.
        redirect: "manual",
      });
    } catch (err) {
      // Network-level failure: treat as 5xx for backoff purposes.
      if (attempt5xx < MAX_RETRIES_5XX) {
        attempt5xx++;
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt5xx - 1));
        continue;
      }
      throw err;
    }

    if (response.ok) {
      const json = (await response.json()) as SmugMugResponseEnvelope<T>;
      return json.Response;
    }

    // Follow 3xx redirects manually so the next iteration re-signs
    // for the new URL. SmugMug legitimately uses 301 to canonicalize
    // bare image keys to their versioned form (`/api/v2/image/<key>`
    // → `/api/v2/image/<key>-N`, where N bumps every time the image
    // is edited), so a redirect here is normal — not a bug. The
    // critical bit is that OAuth 1.0a binds the URL into the signing
    // base string, so undici's default auto-follow re-uses the
    // original Authorization header against a different URL and
    // SmugMug rejects the second hop with oauth_problem=nonce_used.
    // Manually re-entering the loop forces a fresh signature.
    //
    // Don't bump attempt5xx — these aren't errors. Cap at MAX_REDIRECTS
    // so a misconfigured endpoint can't infinite-loop.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new SmugMugApiError(
          response.status,
          url,
          "3xx response with no Location header — cannot follow."
        );
      }
      if (redirectsFollowed >= MAX_REDIRECTS) {
        throw new SmugMugApiError(
          response.status,
          url,
          `Exceeded ${MAX_REDIRECTS} redirects (last hop: ${location}).`
        );
      }
      // Resolve relative Locations against the current URL. For
      // SmugMug's image-versioning case the Location is path-only
      // (e.g. `/api/v2/image/abc-0`), so the URL constructor lifts
      // the host off the previous request automatically.
      url = new URL(location, url).toString();
      redirectsFollowed++;
      continue;
    }

    const bodyText = (await response.text()).slice(0, 500);

    if (response.status === 429 && attempt429 < MAX_RETRIES_429) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : BASE_BACKOFF_MS * 2 ** attempt429;
      attempt429++;
      await sleep(waitMs);
      continue;
    }

    if (response.status >= 500 && attempt5xx < MAX_RETRIES_5XX) {
      attempt5xx++;
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt5xx - 1));
      continue;
    }

    throw new SmugMugApiError(response.status, url, bodyText);
  }
}

export interface PaginateOptions {
  pageSize?: number;
  query?: Record<string, string | number | undefined | null>;
  credentials?: OAuth1Credentials;
}

/**
 * Async iterator over a paginated SmugMug collection. Yields one item at a
 * time, transparently following `Pages.NextPage` until the collection is
 * exhausted.
 *
 * The first request explicitly sets start=1 and count=pageSize. Subsequent
 * requests follow the relative NextPage URL SmugMug provides, which already
 * carries its own start/count, so we don't append query params after page 1.
 */
export async function* smugmugPaginate<TItem>(
  initialPath: string,
  itemsKey: string,
  opts: PaginateOptions = {}
): AsyncGenerator<TItem, void, void> {
  const pageSize = opts.pageSize ?? 100;
  let nextPath: string | undefined = initialPath;
  let firstPage = true;

  while (nextPath) {
    const response: any = await smugmugFetch(nextPath, {
      method: "GET",
      query: firstPage ? { ...opts.query, start: 1, count: pageSize } : undefined,
      credentials: opts.credentials,
    });
    firstPage = false;

    const items: TItem[] = response[itemsKey] ?? [];
    for (const item of items) yield item;

    nextPath = response.Pages?.NextPage ?? undefined;
  }
}
