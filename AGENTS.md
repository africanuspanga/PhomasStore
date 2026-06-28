# PhomasStore Project Guide

This file is the current source of truth for future agents and developers working on this repository. Treat `replit.md` as historical context only; it contains stale assumptions and should not be used as the primary reference.

Do not commit real secrets, API keys, database passwords, or full production connection strings into this file or any docs.

## What This App Is

PhomasStore is a full-stack e-commerce app for PHOMAS DIAGNOSTICS. Customers browse medical products, add items to a cart, place orders, and view order history. Admins approve customers, manage product mappings/images, view orders, update order statuses, and sync orders to ECOUNT ERP.

## Stack

- Frontend: React 18, TypeScript, Vite, Wouter, TanStack Query.
- Styling/UI: Tailwind CSS, shadcn/Radix components, Lucide icons.
- Backend: Express, TypeScript, bundled with esbuild.
- Database access: Drizzle ORM with `postgres`.
- Auth provider: Supabase Auth.
- Database host in production: usually Supabase Postgres, but the server accesses it as Postgres via Drizzle.
- Deployment target: Vercel, using standalone API files plus an Express catch-all API handler.

Important wording: this project uses Supabase for Auth and usually hosts the Postgres database in Supabase. Most persistent server queries are not made through the Supabase JS client; they are made through Drizzle ORM against Postgres.

## Key Commands

```bash
npm run dev
npm run check
npm run build
npm run start
npm run db:push
npm run sync:ecount-inventory
npm run sync:ecount-orders
npm run serve:ecount-order-sync
```

Notes:
- `npm run check` runs TypeScript only.
- `npm run build` builds the Vite frontend into `dist/public` and bundles `server/index.ts`.
- `npm run db:push` requires `DATABASE_URL` because `drizzle.config.ts` throws if it is missing.
- Manual SQL migrations live in `migrations/` and may need to be run in Supabase SQL Editor when `DATABASE_URL` is not available locally.

## Deployment And Routing

`vercel.json` controls production routing.

Standalone API files are routed before the Express catch-all:

- `/api/health` -> `api/health.ts`
- `/api/products` -> `api/products.ts`
- `/api/admin/login` -> `api/admin/login.ts`
- `/api/admin/orders` -> `api/admin/orders.ts`
- `/api/admin/product-mapping/upload` -> `api/admin/product-mapping/upload.ts`
- `/api/admin/approve-user` -> `api/admin/approve-user.ts`
- `/api/admin/users` -> `api/admin/users.ts`
- `/api/admin/pending-users` -> `api/admin/pending-users.ts`
- `/api/admin/change-password` -> `api/admin/change-password.ts`
- `/api/admin/recover-access` -> `api/admin/recover-access.ts`

All other `/api/*` routes go to `api/[...path].ts`, which creates the Express app from `server/app.ts` and registers routes from `server/routes.ts`.

The frontend SPA fallback routes everything else to `index.html`.

## Vercel Cron

There is a daily Vercel cron for ERP order retries:

```json
{
  "path": "/api/cron/ecount-order-sync",
  "schedule": "0 21 * * *"
}
```

This is once per day at 21:00 UTC, roughly midnight in Tanzania. It is intentionally daily because Vercel Hobby/free cron supports daily frequency, not every 10 minutes.

Production requires `CRON_SECRET` or `ORDER_SYNC_CRON_SECRET`. The route accepts the secret as a bearer token or `x-cron-secret`. Vercel automatically sends `CRON_SECRET` as authorization for cron requests.

## Environment Variables

Required or commonly used server variables:

- `DATABASE_URL`: preferred Postgres connection string for Drizzle and `npm run db:push`.
- `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `SUPABASE_DB_URL`: alternate database URL names accepted by `server/storage.ts`.
- `SUPABASE_URL` or `VITE_SUPABASE_URL`: Supabase project URL.
- `SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY`: Supabase anon key for auth.
- `SUPABASE_SERVICE_ROLE_KEY`: preferred service-role key name.
- `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE`, `SUPABASE_SECRET_KEY`: accepted fallback service key names.
- `PGPASSWORD`, `SUPABASE_DB_PASSWORD`, `POSTGRES_PASSWORD`: accepted for building the Supabase transaction pooler URL when no direct `DATABASE_URL` is set.
- `ADMIN_EMAIL`: defaults to `admin@phomas.com`.
- `ADMIN_DEFAULT_PASSWORD`: used only for bootstrap database admin credentials.
- `ADMIN_RECOVERY_TOKEN`: required for admin recovery endpoint.
- `CRON_SECRET` or `ORDER_SYNC_CRON_SECRET`: required for production cron auth.
- `RESEND_API_KEY`: enables order/pending-approval notification email.
- `ORDER_NOTIFICATION_EMAIL`, `ORDER_NOTIFICATION_FROM`: notification email config.
- `CLOUDINARY_URL`, or `CLOUDINARY_CLOUD_NAME` plus `CLOUDINARY_API_KEY` plus `CLOUDINARY_API_SECRET`.
- `CLOUDINARY_UPLOAD_PRESET`: defaults to `phomas_products`.
- `ECOUNT_COMPANY_CODE`
- `ECOUNT_AUTH_KEY`
- `ECOUNT_USER_ID`
- `ECOUNT_ZONE`
- `ECOUNT_WAREHOUSE_CODE`
- `ECOUNT_CUSTOMER_CODE`: defaults to `10839`.
- `ECOUNT_MAX_ERRORS`: default `8`.
- `ECOUNT_LOCK_DURATION_MIN`: default `45`.
- `ECOUNT_TEST_API_KEY`: only for diagnostic/test endpoints.
- `ECOUNT_ORDER_SYNC_MODE`: set to `external`/`vps`/`static-ip` on Vercel when ECOUNT only allows the DigitalOcean static IP. Leave unset or set to `direct` when admin/manual sync should call ECOUNT from the app server.
- `ECOUNT_ORDER_SYNC_VIA_VPS`: optional boolean alternative; set to `true` to force external/VPS order sync.
- `ECOUNT_ORDER_SYNC_WORKER_URL`: optional URL for Vercel/admin/cron to trigger the static-IP VPS order worker, for example `http://164.92.205.5:8787/sync`. Only use this in external/VPS mode.
- `ECOUNT_ORDER_SYNC_WORKER_SECRET`: shared bearer token required by the static-IP VPS order worker trigger.
- `ECOUNT_ORDER_SYNC_WORKER_TIMEOUT_MS`: Vercel wait time for the VPS worker trigger; default 50 seconds.
- `ECOUNT_ORDER_SYNC_WORKER_PORT`: VPS worker listen port for `npm run serve:ecount-order-sync`; default `8787`.
- `ECOUNT_ORDER_IO_DATE_MODE`: defaults to `blank`. For SaleOrder sync, blank `IO_DATE` lets ECOUNT use its current date, which the ECOUNT API docs allow and avoids `IO_DATE` `Date(Format)` validation failures. Set to `order-date` only if ECOUNT must receive the original order date as `YYYYMMDD`.
- `ECOUNT_ORDER_DATE_TIMEZONE`: timezone used when recording or sending generated `YYYYMMDD` order dates; defaults to `Africa/Dar_es_Salaam`.

Client-side Vite variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SITE_URL`, `VITE_PUBLIC_SITE_URL`, `VITE_APP_URL`: password reset URL helpers.

ERP retry tuning:

- `ORDER_SYNC_TIMEOUT_MS`: currently defined but the immediate order route now responds before ERP sync completes.
- `ORDER_SYNC_BATCH_SIZE`: default `1`.
- `ORDER_SYNC_RETRY_BASE_DELAY_MS`: default 5 minutes.
- `ORDER_SYNC_RETRY_MAX_DELAY_MS`: default 1 hour.
- `ORDER_SYNC_RETRY_SPACING_MS`: default 22 seconds.
- `ORDER_SYNC_MAX_ATTEMPTS`: default `0`, meaning unlimited retries.
- `ECOUNT_ORDER_SYNC_LIMIT`: VPS order worker batch size; default `1`.
- `ECOUNT_ORDER_SYNC_SPACING_MS`: delay between orders in the VPS worker; default 22 seconds.
- `ECOUNT_ORDER_SYNC_CLAIM_LOCK_MS`: temporary claim window for the VPS worker; default 15 minutes.

## Database Model

Schema lives in `shared/schema.ts`.

Important tables:

- `orders`: customer orders plus checkout details and ERP sync tracking.
- `profiles`: optional Supabase profile data.
- `product_images`: Cloudinary or external image URLs keyed by product code.
- `product_mappings`: parsed Excel product mapping persisted to Postgres.
- `admin_sessions`: persistent admin session tokens.
- `admin_credentials`: hashed admin password fallback.
- `users`, `products`, `inventory`: legacy/local schema still exists; users are not the source of truth for live customer auth.

Orders use Supabase Auth user IDs in `orders.user_id`. There should not be a foreign key from `orders.user_id` to the local `users` table, because customers are managed by Supabase Auth.

If the schema changes:

1. Update `shared/schema.ts`.
2. Add a migration SQL file in `migrations/`.
3. Run the SQL in Supabase SQL Editor or run `npm run db:push` with `DATABASE_URL`.
4. Verify with `npm run check` and `npm run build`.

Latest required manual migration at the time of this guide:

```sql
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS erp_sync_attempts integer,
  ADD COLUMN IF NOT EXISTS erp_last_sync_attempt_at timestamp,
  ADD COLUMN IF NOT EXISTS erp_next_sync_attempt_at timestamp;

UPDATE public.orders
SET erp_sync_attempts = COALESCE(erp_sync_attempts, 0);

ALTER TABLE public.orders
  ALTER COLUMN erp_sync_attempts SET DEFAULT 0,
  ALTER COLUMN erp_sync_attempts SET NOT NULL;
```

This is also in `migrations/0005_add_order_erp_retry_fields.sql`.

## Storage Layer

The storage abstraction is in `server/storage.ts`.

- `MemStorage` is a fallback and sample-data provider.
- `DatabaseStorage` is the exported singleton (`storage`) and should be used by routes.
- `DatabaseStorage` uses Drizzle/Postgres when a database connection is available.
- Product image methods prefer the database, with fallback support through Supabase client or memory.
- Product/inventory display data can still fall back to memory or Excel-derived data when ECOUNT inventory is unavailable.

Database connection priority:

1. `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, or `SUPABASE_DB_URL`.
2. Build a Supabase transaction pooler URL from `SUPABASE_URL` and `PGPASSWORD`/`SUPABASE_DB_PASSWORD`/`POSTGRES_PASSWORD`.
3. Fall back to memory, which means orders will not persist.

## Authentication

Customer auth is handled by Supabase Auth on the frontend in `client/src/contexts/AuthContext.tsx`.

Registration:

- Customers sign up through Supabase Auth.
- Registration metadata includes name, phone, address, BRELA, TIN, user type, and `approved: false`.
- Users cannot log in until approved, except admin users.

Admin auth:

- Admin login endpoint: `/api/admin/login`.
- Admin can authenticate through Supabase admin user, database credential fallback, or the temporary emergency fallback currently present in code.
- Admin API protection is handled by `requireAdminAuth` in `server/routes.ts` for Express routes and shared helper logic in standalone admin API files.

Token handling:

- Frontend API requests attach the best available token from local storage or Supabase session in `client/src/lib/queryClient.ts`.
- Error handling in `queryClient.ts` sanitizes Cloudflare/HTML error pages so huge raw HTML does not appear in toast messages.

## Products, Inventory, Names, Prices, And Images

Product display is not a single source from one system.

- Product codes and inventory primarily come from ECOUNT `InventoryBalance/GetListInventoryBalanceStatus`.
- ECOUNT inventory is rate limited; the service caches product/inventory responses for 20 minutes.
- Human-readable product names, prices, UOM/packaging, categories, and optional image URL mappings come from the admin Excel mapping handled by `server/productMapping.ts`.
- Parsed Excel mappings persist to `product_mappings` when the database is available.
- Product images are separate from ECOUNT and live in `product_images` or Cloudinary.
- `/api/images` resolves images by product codes and normalized product-code candidates.

Customer catalog:

- Page: `client/src/pages/Home.tsx`.
- Grid: `client/src/components/ProductGrid.tsx`.
- Product card: `client/src/components/ProductCard.tsx`.
- Current grid card count is `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.
- The left sidebar uses 256px width on desktop, so the content area is narrower than the viewport.

Admin mapping upload:

- Route: `/api/admin/product-mapping/upload`.
- Upload accepts `.xlsx`, `.xls`, and `.csv`.
- After upload, product mapping is replaced and ECOUNT product cache is cleared.
- If image URL columns exist in the Excel file, image mappings are imported into `product_images`.

## Orders And Checkout

Customer checkout page: `client/src/pages/Cart.tsx`.

Checkout rules:

- Customer name, email, and phone are required.
- Delivery requires a delivery address and delivery area.
- Cash payment is only allowed for pickup.
- Online payment can be used for pickup or delivery.
- Ice pack support includes size and quantity.
- Server recalculates subtotal, transport, ice pack, and total; it does not trust client totals blindly.

Order creation route:

- `POST /api/orders` in `server/routes.ts`.
- Saves the order locally/database first.
- Immediately returns success to the customer after the local order is saved.
- Starts order notification and ECOUNT sync as background tasks via `waitUntil` when available.

This is intentional for smooth customer UX: customers should see order completion even if ERP sync is temporarily delayed.

## ECOUNT ERP Integration

Core file: `server/ecountApi.ts`.

ECOUNT auth:

- Uses production base URL `https://oapi{ZONE}.ecount.com`.
- Resolves zone through `/OAPI/V2/Zone`.
- Logs in through `/OAPI/V2/OAPILogin`.
- Stores session ID, zone, and cookies.
- Deduplicates login attempts and rate limits login retries.

Inventory/product fetch:

- Uses `/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus`.
- Inventory calls are cached/rate limited because ECOUNT limits this endpoint.
- In production, live inventory should be pulled by `npm run sync:ecount-inventory` from the static-IP DigitalOcean VPS when ECOUNT IP allowlisting is enabled. Vercel then serves product/inventory data from Postgres.

Order sync:

- Uses `/OAPI/V2/SaleOrder/SaveSaleOrder`.
- Builds `SaleOrderList` with `BulkDatas`.
- Uses `ECOUNT_CUSTOMER_CODE` defaulting to `10839`.
- Uses `ECOUNT_WAREHOUSE_CODE` defaulting to `00001` in some paths.
- Requires every ordered product to have an Excel/ProductMapping match.
- Uses deterministic 4-digit `UPLOAD_SER_NO` derived from the local order, so retries reuse the same serial instead of randomizing.
- Sends blank `IO_DATE` by default for `SaleOrder/SaveSaleOrder` because the ECOUNT docs say blank uses the current date and this avoids `Date(Format)` rejections. Set `ECOUNT_ORDER_IO_DATE_MODE=order-date` to send a generated `YYYYMMDD` date instead.
- When ECOUNT IP allowlisting is enabled, Vercel must not send order sync calls directly. Set `ECOUNT_ORDER_SYNC_MODE=external` on Vercel and run `npm run sync:ecount-orders` on a schedule from the static-IP DigitalOcean VPS, or run `npm run serve:ecount-order-sync` on the VPS and configure Vercel's `ECOUNT_ORDER_SYNC_WORKER_URL`/`ECOUNT_ORDER_SYNC_WORKER_SECRET` so admin manual sync can trigger the VPS. The VPS worker logs in to ECOUNT and marks each order synced/failed in Postgres.

Error control:

- Centralized `ecountRequest` handles session refresh, body-level ECOUNT errors, circuit breaker, exponential backoff, and self-locking to avoid ECOUNT account lockouts.
- Consecutive critical/network errors self-lock the ECOUNT client before hitting ECOUNT's documented lockout threshold.

## ERP Order Retry Queue

The current ERP sync design is durable:

- New order saves first and returns success.
- In direct mode, background sync attempts ECOUNT from the app server.
- In external/VPS mode, background handling queues the order and triggers the static-IP VPS worker when `ECOUNT_ORDER_SYNC_WORKER_URL` and `ECOUNT_ORDER_SYNC_WORKER_SECRET` are configured. The worker submits it to ECOUNT. Outside explicit external/VPS mode, admin manual sync and cron sync call ECOUNT directly from the app server.
- Failed sync updates `erp_sync_status = failed`, stores `erp_sync_error`, increments attempts, and sets `erp_next_sync_attempt_at`.
- Due pending/failed orders are selected by `storage.getOrdersNeedingErpSync`.

Retry entry points:

- Daily cron: `GET/POST /api/cron/ecount-order-sync`.
- Admin manual queue button: `POST /api/admin/orders/sync-pending`.
- Single-order admin button: `POST /api/admin/orders/:orderId/sync`.

Manual admin queue sync currently processes only one order per click. This is intentional to avoid Cloudflare/Vercel 502 timeouts and to respect ECOUNT save rate limits. The admin UI button says `Sync Next ERP (N)`.

In external/VPS mode, app routes do not call ECOUNT directly. They clear the selected order's retry delay and leave it as `pending`. If `ECOUNT_ORDER_SYNC_WORKER_URL` and `ECOUNT_ORDER_SYNC_WORKER_SECRET` are configured, the route also calls the VPS worker trigger, which runs `scripts/ecount-order-sync.mjs` from the allowlisted static IP and returns the synced/failed result. If the worker URL or secret is not configured, responses should say the worker was not triggered instead of only saying the order was queued.

## Notifications

Email notifications are sent with Resend if `RESEND_API_KEY` is configured.

- New order notification uses `ORDER_NOTIFICATION_EMAIL` and `ORDER_NOTIFICATION_FROM`.
- Pending approval notification also uses Resend.
- Notification failures are logged but should not fail registration or order creation.

## Cloudinary And Images

Cloudinary config is resolved from `CLOUDINARY_URL` or individual Cloudinary variables.

The server attempts to ensure an unsigned upload preset exists at startup when Cloudinary is configured.

Image upload and management routes:

- `GET /api/cloudinary-config`
- `POST /api/admin/upload-image`
- `POST /api/images/set-url`
- `GET /api/images`
- `GET /api/images/:code(*)`
- `DELETE /api/images/:code(*)`
- `PUT /api/admin/products/:id/image`

## Frontend Structure

Main routing: `client/src/App.tsx`.

Routes:

- `/login`
- `/registration`
- `/auth/confirm`
- `/admin-login`
- `/admin-recovery`
- `/`
- `/cart`
- `/orders`
- `/account`
- `/admin`

Protected routes are wrapped in `Layout`, which includes top navigation, sidebar, and customer assistance for non-admin users.

Important client modules:

- `client/src/contexts/AuthContext.tsx`: customer/admin auth state.
- `client/src/contexts/CartContext.tsx`: per-user cart in localStorage.
- `client/src/lib/queryClient.ts`: API request helper, token attachment, error sanitization.
- `client/src/services/ecountService.ts`: thin frontend API service layer. Despite the name, it calls local app API routes, not ECOUNT directly.
- `client/src/hooks/useProductImages.ts`: image lookup helpers.

## Admin Panel

Main file: `client/src/pages/AdminPanel.tsx`.

Admin capabilities include:

- View all orders.
- Change order status.
- Sync one order to ECOUNT.
- Sync next due ERP order from queue.
- Delete local orders.
- View users.
- Approve pending users.
- Upload product mapping Excel.
- Upload/set product images.
- Run some ECOUNT diagnostic/test endpoints.

Deleting an order locally does not delete it from ECOUNT if it was already synced.

## Important API Caveats

- `/api/products` is routed to `api/products.ts`, which delegates to the Express app. Because `vercel.json` routes it before catch-all, remember this standalone file exists even though behavior still comes from `server/routes.ts`.
- `/api/admin/orders` is also a standalone file in production. It reads directly from Supabase REST, not the Express route, because `vercel.json` routes it first.
- Some older diagnostic endpoints duplicate names, including inventory diagnostic routes. Be careful before removing them; they may be used for ECOUNT support troubleshooting.
- `client/src/services/ecountService.ts` contains an old commented "future ECOUNT" example. Ignore that comment for current behavior.

## Verification Before Pushing

For normal code changes:

```bash
npm run check
npm run build
```

For schema changes:

```bash
npm run check
npm run build
```

Then also apply/run the matching SQL migration or `npm run db:push` with `DATABASE_URL`.

For frontend layout changes, run the app locally and inspect desktop and mobile breakpoints. Use the existing Tailwind/shadcn patterns and avoid adding unrelated redesigns.

## Current Known Operational Notes

- Vercel Hobby cron is daily, so the cron retry queue is intentionally conservative.
- Admin can manually process ERP sync one order at a time.
- ECOUNT InventoryBalance can be fragile/rate-limited. Product display should preserve fallback behavior.
- Product names/prices should come from ProductMapping/Excel when possible.
- Product images must remain separate from ECOUNT.
- Supabase Auth metadata approval is the gate for customers.
- Database migrations are not automatically guaranteed on deploy; verify Supabase schema after schema changes.

## Source-Of-Truth Rule For Future Agents

When answering architecture or operational questions, prefer current code plus this `AGENTS.md` over `replit.md`.

If code and this file disagree, inspect the code and update this file in the same change. This document should stay small enough to read but accurate enough to prevent wrong assumptions.
