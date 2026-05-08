# Step 9 — Throwaway-branch spike notes

> Written from the `spike/step-9-react-19-and-next-15` branch (since deleted). The branch installed `next@15.5.18 + react@19 + react-dom@19 + eslint-config-next@15.5.18 + @types/react@19 + @types/react-dom@19`, applied the minimum `cookies()` async fix, and exercised lint / build / dev / route-handler smoke. Findings below.

## 1. dnd-kit v6 under React 19 — works

- `npm install` produced peer-dep `npm warn ERESOLVE` lines on `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`, and the transitive `@dnd-kit/accessibility@3.1.1`. **npm chose the new resolution anyway — no `--legacy-peer-deps` needed.** The warnings are stale peer ranges (`react: ">=16.8.0"`), not actual breakage.
- `npm run build` (which runs `tsc` typecheck + lint as part of the Next build) succeeded with `@dnd-kit/*` v6 imports in [components/screens/Admin.tsx](../components/screens/Admin.tsx) (`DndContext`, `SortableContext`, `useSortable`, `arrayMove`, `rectSortingStrategy`, `sortableKeyboardCoordinates`, `PointerSensor`, `KeyboardSensor`, `closestCenter`, `useSensor`, `useSensors`, `type DragEndEvent`, `CSS`). No type-level React-19 incompat surfaced.
- Runtime drag-reorder of the AdminExamples grid was **not** keyboard- or mouse-tested in this spike (would require interactive sign-in as admin). Type-clean compile + the library's "ref-as-callback" idiom not changing in React 19 strongly suggests it works, but the real step 9 PR should still hand-verify by dragging an example card and reordering via keyboard.
- **Verdict for step 9:** keep `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`, `@dnd-kit/utilities@^3.2.2` as-is. The v7 migration is not required. The user's instinct on this was correct; ~1 hour saved vs. the original plan.

## 2. eslint-config-next 15.5.18 with .eslintrc.json — works

- `npm run lint` passed clean against the unchanged one-line [.eslintrc.json](../.eslintrc.json) (`{"extends":"next/core-web-vitals"}`) on `eslint@^8.57.0` + `eslint-config-next@^15.5.18`.
- Only output: the two pre-existing cosmetic warnings (`no-page-custom-font` in [app/layout.tsx](../app/layout.tsx), `no-img-element` in [components/screens/Admin.tsx](../components/screens/Admin.tsx)) plus a deprecation notice that `next lint` itself will be removed in **Next 16** (`npx @next/codemod@canary next-lint-to-eslint-cli .` is the migration path). Not relevant for staying on 15.5.x.
- **Verdict for step 9:** keep `.eslintrc.json` and `eslint@^8.57.0`. Flat-config migration is a no-op on the 15.5.x line. ~1 hour saved vs. the original plan.

## 3. npm audit delta on 15.5.18

- Pre-spike (`next@14.2.15`): 4 high-severity advisories.
- Post-spike (`next@15.5.18`): **0 high, 2 moderate.** Both moderates are the same advisory — `postcss <8.5.10` reachable via the `next` package's bundled subdep ([GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), unescaped `</style>` in CSS Stringify output, XSS only in CSS-tooling contexts). It is **not** a Next.js CVE — it tracks postcss's own release cadence and won't be resolved until Next bumps the bundled postcss.
- **Verdict for step 9:** 15.5.18 closes every high-severity item in the original audit. The two remaining moderates are inherited from `next/node_modules/postcss` and would persist on Next 16 too; no action required for step 9.

## 4. Smoke test results

| Check | Result |
|---|---|
| `npm install` | OK, peer warnings only |
| `npm run lint` | OK (pre-existing warnings only) |
| `npm run build` (typecheck + compile) | OK after async-cookies fix (see below) |
| `npm run dev` cold start | OK — `Ready in 8.8s`, Next 15.5.18 banner |
| `GET /` unauthenticated | 307 → `/login` (middleware works) |
| `GET /login` | 200 (React 19 client tree renders) |
| `GET /api/smugmug/sync-scheduled` no bearer | 401 (cron-secret gate works) |
| `GET /api/smugmug/sync-folders` unauthenticated | 307 (admin gate works) |

**The only real code change Next 15 forces is the `cookies()` async migration in [lib/supabase/server.ts](../lib/supabase/server.ts):**

```ts
export async function createClient() {
  const cookieStore = await cookies();
  // ...rest unchanged
}
```

Plus `await createClient()` at every server-side call site:

- [app/layout.tsx](../app/layout.tsx) (`generateMetadata`)
- [app/auth/callback/route.ts](../app/auth/callback/route.ts) (`GET`)
- [app/api/smugmug/ping/route.ts](../app/api/smugmug/ping/route.ts) (`GET`)
- [app/api/smugmug/sync-now/route.ts](../app/api/smugmug/sync-now/route.ts) (`POST`)
- [app/api/smugmug/sync-folders/route.ts](../app/api/smugmug/sync-folders/route.ts) (`requireAdmin`)
- [app/api/smugmug/prioritize/route.ts](../app/api/smugmug/prioritize/route.ts) (`requireAdmin`)
- [app/api/smugmug/clear-pending/route.ts](../app/api/smugmug/clear-pending/route.ts) (`requireAdmin`)
- [app/api/smugmug/quarantine/route.ts](../app/api/smugmug/quarantine/route.ts) (`POST`)

[lib/supabase/middleware.ts](../lib/supabase/middleware.ts) does **not** need to change — it pulls cookies off `request.cookies` (a `NextRequest` field, still synchronous), not via `next/headers`'s `cookies()`. The browser client at [lib/supabase/client.ts](../lib/supabase/client.ts) is unaffected.

`@next/codemod`'s `next-async-request-api` rewrite was not needed — the change is mechanical and the call-site count is small enough that hand-editing is faster and produces a smaller diff. (The codemod tends to over-await; preferred to leave it untouched.)

`request.nextUrl.searchParams` accesses in the route handlers ([app/auth/callback/route.ts](../app/auth/callback/route.ts), [app/api/smugmug/sync-folders/route.ts](../app/api/smugmug/sync-folders/route.ts)) are unchanged in Next 15.

## 5. Revised effort estimate for the real step 9 PR

Original guess was "half a day to a day." Spike confirms it's much smaller:

| Task | Original budget | Revised |
|---|---|---|
| React 18 → 19 incidental fallout | 1–2 hr | **0 hr** (clean compile) |
| Async `cookies()` migration | 30 min | **15 min** (1 file + 8 call sites; diff already mapped above) |
| @dnd-kit v6 → v7 migration | 1–2 hr | **0 hr** (v6 stays) |
| ESLint 8 → 9 + flat config | 1 hr | **0 hr** (`.eslintrc.json` + ESLint 8 stay) |
| Manual click-through retest | 1–2 hr | 1 hr (still required — sign-in, OAuth callback, all 7 SmugMug routes, the cron handler, reviewer/senior/admin UIs, AdminExamples drag-reorder) |
| Vercel re-deploy + post-deploy verify | 30 min | 30 min |
| **Total** | **~6 hr** | **~2 hr** |

The bulk of the original budget was for unknowns the spike collapsed. The remaining work is: apply the 9-file diff above, run the same `npm install` pin set, click through the manual retest list, push.

## 6. Recommended approach for the real step 9 PR

1. Branch off `main`: `step-9-next-15-upgrade`.
2. `npm install next@15.5.18 react@19 react-dom@19 eslint-config-next@15.5.18 @types/react@19 @types/react-dom@19` — no `@dnd-kit` bumps, no ESLint bumps.
3. Apply the `await createClient()` / `await cookies()` diff catalogued in section 4.
4. `npm run lint && npm run build` clean.
5. `npm run dev` and run the manual click-through retest list (sign-in, middleware, OAuth callback, every SmugMug admin action, cron handler, AdminExamples drag-reorder mouse + keyboard, reviewer approve, reviewer flag-with-quarantine, senior accept, senior delete).
6. Push, watch Vercel build, repeat the smoke test against the preview URL.
7. Merge. Update [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) (move step 9 to ✅, drop the "npm audit reports 4 high-severity issues" gotcha, refresh the "Tech stack" Next.js / React versions, refresh the migration-count line) and the framework version line in [README.md](../README.md).

## 7. Out of scope — explicit non-goals for step 9

- **Next 16.** Stay on 15.5.x for now. 16's surface change (Turbopack-default builds, Node 20+ minimum, more lifecycle deprecations) buys nothing the audit cares about and adds risk. Revisit when one of those becomes valuable.
- **Flat ESLint config.** Becomes mandatory at `eslint-config-next@16`. Defer alongside the Next-16 bump.
- **`next/image` migration.** The `no-img-element` warning on [components/screens/Admin.tsx](../components/screens/Admin.tsx) is intentional — the example library renders Supabase Storage URLs and the optimizer would add cost without benefit. Leave the warning.
- **`next lint` → ESLint CLI migration.** Forced at Next 16. Defer.
