# Changelog

All notable changes to the Braiin dashboard.

## [Unreleased]

### Email

- Direct/CC'd tabs now match the logged-in user exactly, not the company domain. Previously every email with any Corten address in To/CC counted as "Direct to me" (wrong for shared mailboxes). `isUserInTo` / `isUserInCc` now accept userEmail parameter.
- Pinned emails now persist to Supabase per user (new `email_pins` table, migration `008_email_pins.sql`). Previously pins vanished on refresh. Includes optimistic UI with rollback on DB error.
- Email list now caches across navigation. Leaving and returning to /email within 1 minute renders instantly from the cache with no network call. After 1 minute, seed from cache then refresh silently in background. Cache stays in sync with local mutations (archive/delete/unsubscribe).
- New **Marketing** tab alongside Direct / CC'd / FYI / Pinned. Uses AI classification when available, falls back to narrow heuristics (marketing-tool domains, newsletter sender patterns, presence of List-Unsubscribe header).
- "Unsubscribe & Archive" triage shortcut now appears on any marketing email, not just AI-classified ones. Fixes the case where this button "disappeared" when classification hadn't run yet.
- Email header icon buttons (Reply, Reply All, Forward, Pin, Archive, Delete, Unsubscribe, More) now have proper tooltips on hover/focus via new `<Tooltip>` component, replacing native browser `title=""` attributes.
- Archive / delete now sync to Outlook via Graph API. Previously the quick-action icons on email cards and three triage shortcuts (Unsubscribe & Archive, FYI Archive, Recruiter Delete) only updated the Braiin UI, so emails reappeared on next refresh and Outlook never saw the change. All routes now go through `emailActions.archiveEmail/deleteEmail` which call the `/api/email-sync` PATCH endpoint.
- Archive/delete now fail loud: on Graph API error, the optimistic UI update is reverted and a toast shows the failure reason.
- Opening an unread email now marks it as read in Outlook automatically. Previously read-state drifted between Braiin and Outlook.
- Extended `/api/email-sync` PATCH with `mark_read` and `mark_unread` actions, ready for the upcoming multi-select bulk operations.

### Security

- JWT session signing: the `braiin_session` cookie is now a signed HS256 JWT instead of raw JSON. Forged cookies are rejected cryptographically at the proxy (edge) layer. Closes auth bypass where any non-empty cookie passed the previous presence check.
- Azure `access_token` and `refresh_token` removed from the JWT payload and the `Session` type. They were never read anywhere (all Graph calls use app-level `client_credentials`), so keeping them in the cookie only served as a leak vector for Mail.Read/Mail.Send scope tokens. If user-delegated Graph access is ever needed in future, store tokens in a dedicated encrypted table keyed by staff_id - not in the session cookie.
- `SESSION_SECRET` is now required at startup and must be at least 32 characters. The previous fallbacks (`SUPABASE_SERVICE_KEY`, literal `"fallback-dev-secret-change-me"`) have been removed - the app now refuses to start without a valid secret.
- Renamed `src/middleware.ts` to `src/proxy.ts` (Next 16 convention). The proxy cryptographically verifies the JWT via `verifySessionToken` on every `/api/*` request except `/api/auth/*` and `/api/cron/*`. Expired tokens return 401.
- Added shared `getSession()` helper in `src/lib/session.ts` that verifies the JWT and returns a typed `SessionPayload`. Replaced 7 duplicated route-local `getSession()` functions that did unsafe `JSON.parse` on the raw cookie value.
- `auth/session` endpoint now logs Supabase errors when looking up staff access rather than swallowing them silently.
- `send-email` now reads sender from the verified session, never from the request body. Closes the sender-spoofing vector where any authenticated user could send email appearing to come from any address. Also requires the session email to be an internal domain (403 otherwise), returns 401 if unauthenticated, and no longer leaks the full Resend error payload in the response.
- `email-composer` client no longer sends `from_email` / `from_name` (they were being ignored server-side after the fix).
- Consolidated Supabase client: 21 API routes now import `supabase` from `@/services/base` instead of each instantiating their own client. Closes the silent privilege-downgrade where `SUPABASE_SERVICE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY` would fall through to anon if the service key was missing.
- `services/base.ts` now throws at startup if `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing, or if `SUPABASE_SERVICE_KEY` is missing on the server. No more silent fallbacks.
- `src/lib/supabase.ts` reduced to a thin re-export of `@/services/base`'s supabase for backwards compatibility with existing client imports.

### Types

- Generated `src/types/database.ts` (61 tables/views) from the Supabase PostgREST OpenAPI spec. Wired `createClient<Database>()` so `.from(...).select(...)` calls are now fully typed. Regenerate with `npx tsx scripts/gen-supabase-types.ts`.
- Auto-generator script `scripts/gen-supabase-types.ts` fetches the spec using the service role key alone (no Supabase management API token / `supabase login` needed) and correctly marks PK/default columns as optional on Insert.
- Added `src/lib/db-utils.ts` with `asStringArray` helper to narrow jsonb columns at the boundary (used in `client-intel-panel`).
- Fixed 27 latent type errors surfaced by the generated types: nullable columns treated as non-null (staff email, contact fields), `new Date(nullable_date)` unguarded (braiin-chat, deal-coach), `inbox_group_id` used as index without null check, `companies` insert missing required `trade_type`, `selectedId` used without null guard in lead-intel, and more. These were all latent runtime-bug risks fixed at the source.
- `services/deals.createDeal` now uses `TablesInsert<"deals">` from the generated types.
- `services/base.fetchAllRows` uses a typed `any` escape for the supabase client to accept dynamic table names (the generic helper inherently cannot type-narrow at runtime).

### Authorization

- `accounts` GET and POST now require a valid session. PATCH lift_blacklist now requires `admin` / `super_admin` / `branch_md` role. Non-admin attempts are logged as warnings. Blacklist lifts are logged as info with who did it.
- `classify-email` PUT (training feedback) now requires a valid session. Corruption of the AI training corpus by unauthenticated callers is no longer possible.
- `upload-avatar` now reads the target email from the verified session. Users can only upload their own avatar; admins can upload for other staff. Previously the `email` form field was trusted, letting any authenticated user overwrite any staff avatar.

### Reliability

- Silent catch sweep (high-impact server paths): `api/research` now logs Perplexity + Claude failures before returning 502, `api/email-sync` getAppToken now logs token errors instead of returning null silently, `api/incidents` logs per-director email failures and the emailDirectors spawn failure, `services/incidents` logs blacklistAccount failures with the account code and incident ID. Closes five silent paths where operations failed with no diagnostics in Vercel logs.
- Supabase-backed rate limiter: `src/lib/rate-limit.ts` replaced the module-level `Map` (which reset on cold start and didn't work across Vercel workers) with a Postgres `check_rate_limit` RPC backed by the new `rate_limits` table. Fails open on DB error to avoid locking out all users on transient Supabase issues. All 13 callers converted to `await checkRateLimit(...)`. See `supabase/migrations/007_rate_limits.sql` - this migration must be applied to production before deploying.
- `getClientIp` now prefers `x-vercel-forwarded-for` (unspoofable) over `x-forwarded-for`. When falling back to the latter it uses the last hop (closest to our infra) instead of the first, which clients could arbitrarily set to bypass per-IP limits.
