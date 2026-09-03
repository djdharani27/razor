# current.md — AgentStore Codebase Status

**Updated:** 2026-08-31

## What This Is

AgentStore is an AI-agent-friendly e-commerce demo built for the **Razorpay AI
Buildathon — Track 1 (Agentic Commerce)**. It is a Next.js 14 (App Router +
TypeScript + Tailwind) storefront that exposes its entire shopping flow to
browser-based AI agents through **Chrome's WebMCP** standard. Agents can search
products, add them to a cart, view the cart, and kick off a **Razorpay
test-mode payment** — while every agent action is logged and shown live on the
page.

## Current State

- **Working**: production build passes (`npm run build`), lint clean, and the
  storefront + all APIs have been smoke-tested live.
- **Pushed**: `main` branch on `github.com/djdharani27/razor` (commit `add webmcp`,
  followed by `add get all products tool`).
- **Keys**: no real Razorpay keys committed. `.env.local` holds empty
  placeholders; only `.env.example` is tracked.

## Tech Stack

- Next.js 14.2.35 (App Router), React 18, TypeScript 5.5, Tailwind CSS 3.4
- SQLite via `better-sqlite3` v13 (native module; v13 chosen because the
  machine's Node v25 had no prebuilds for v11)
- Razorpay Node SDK v2 (`razorpay@2.9.8`)
- No external state management — React state + SQLite only

## Data Model (SQLite, `data/agentstore.db`)

| Table | Columns | Notes |
| --- | --- | --- |
| `products` | `id`, `name`, `description`, `price_paise`, `stock`, `image_url` | 4 seeded rows |
| `orders` | `id`, `razorpay_payment_link_id`, `status`, `amount_paise`, `items_json`, `created_at` | `status`: `created` / `paid` / `failed` |
| `agent_log` | `id`, `tool_name`, `arguments_json`, `result_json`, `timestamp` | one row per WebMCP tool call |

The DB file is created lazily in `lib/db.ts`; the schema is created and the 4
sample products auto-seeded on first server start. `npm run seed` re-runs the
seed idempotently.

## Seeded Products

1. Sticker Pack (10) — ₹49
2. Phone Stand — ₹89
3. Wireless Mouse — ₹299
4. Bluetooth Speaker — ₹499

(Each with a stock count and a `picsum.photos` image URL.)

## Pages

- **`/`** — storefront: product grid (image, name, price, stock, Add to Cart),
  cart drawer with checkout, and a collapsible **Agent Activity Log** panel that
  polls `/api/agent-log` every 2s.
- **`/order/[id]`** — order confirmation page. Loads Razorpay Standard Checkout and shows a **Pay** button that opens the in-page payment modal. Polls `/api/orders/:id` every 2s until the status leaves `created`; shows items, total, and a status badge.

## API Routes

| Route | Method | What it does |
| --- | --- | --- |
| `/api/checkout` | POST | Validates stock + computes total **server-side** (client prices never trusted). Enforces `SPEND_CAP_PAISE` (default ₹5000) with a graceful `402` + `{ code: "SPEND_CAP_EXCEEDED", ... }`. Creates a Razorpay **order** (Standard Checkout), inserts an order as `created`, returns `{ orderId, razorpayOrderId, amount, currency, keyId }`. |
| `/api/verify` | POST | Verifies the Standard Checkout payment signature (HMAC-SHA256 over `razorpayOrderId|razorpayPaymentId` via `RAZORPAY_KEY_SECRET`, timing-safe compare), confirms the razorpay order id matches the local order, marks it `paid`. |
| `/api/webhook/razorpay` | POST | Verifies the Razorpay signature (HMAC-SHA256 over the raw body via `Razorpay.validateWebhookSignature`). Handles both Standard Checkout (`order.paid` / `order.failed`) and Payment Link (`payment_link.paid` / `cancelled` / `expired` / `failed`) events; marks the matching order `paid` / `failed`. Always acks quickly. |
| `/api/orders/[id]` | GET | Returns order status, amount, items, created_at. |
| `/api/agent-log` | GET | Last 20 agent_log rows, newest first (powers the polling panel). |
| `/api/agent-log` | POST | Internal helper: inserts a log row (called by every WebMCP tool's `execute`). |
| `/api/products` | GET | Full product list (used by the storefront, the order page, and the tools). |

## WebMCP Tools (8 registered)

Registered in `components/webmcp-tools.tsx` on mount via
`document.modelContext.registerTool()`, guarded by `'modelContext' in document`.
Unregistered on unmount using the AbortController pattern.

| Tool | Input | Purpose |
| --- | --- | --- |
| `search_products` | `{ query }` | Search catalog by name/description keyword |
| `get_all_products` | `{}` | Full catalog: id, name, price, stock, description |
| `get_product` | `{ id }` | Full details for one product |
| `add_to_cart` | `{ id, qty }` | Add to cart; validates stock against the server-side catalog |
| `view_cart` | `{}` | Cart contents + running total (with per-line prices) |
| `remove_from_cart` | `{ id }` | Remove an item from the cart |
| `checkout` | `{}` | POSTs the cart to `/api/checkout`, creates the order, clears the cart, and directs the user to `/order/:id` to complete payment in the Razorpay Standard Checkout modal. Annotated `readOnlyHint: false`, `untrustedContentHint: true`. Spend-cap rejections are returned as tool results (not thrown). |
| `get_order_status` | `{ orderId }` | Fetch `/api/orders/:id` and return status |

Every tool logs its call (name + args + result) to `agent_log` before
returning, so all agent activity shows up in the on-page Activity Log.

## Environment Variables (`.env.local`)

| Var | Default | Purpose |
| --- | --- | --- |
| `RAZORPAY_KEY_ID` | (empty) | Razorpay test-mode key id |
| `RAZORPAY_KEY_SECRET` | (empty) | Razorpay test-mode secret — **server-only** |
| `RAZORPAY_WEBHOOK_SECRET` | (empty) | HMAC secret for webhook signature verification |
| `SPEND_CAP_PAISE` | `500000` | Max order total in paise (₹5000); over-cap orders get a structured 402 |

`NEXT_PUBLIC_BASE_URL` is optional; checkout falls back to localhost:3000.

## Scripts

- `npm run dev` / `npm run build` / `npm run start` / `npm run lint`
- `npm run seed` — idempotent product seeder (`scripts/seed.mjs`)
- `node scripts/simulate-webhook.mjs [paymentLinkId] [amountPaise]` — signs a fake
  `payment_link.paid` payload with `RAZORPAY_WEBHOOK_SECRET` and POSTs it locally
  to test the webhook without a tunnel.

## Key Files

```
app/
  layout.tsx              # root layout, CartProvider wrapper
  page.tsx                # server component → reads products, renders Storefront
  globals.css             # Tailwind directives
  order/[id]/page.tsx     # order confirmation + Pay button (Standard Checkout modal)
  api/checkout/route.ts   # server-side validation, spend cap, Razorpay order
  api/verify/route.ts     # Standard Checkout signature verification
  api/webhook/razorpay/route.ts
  api/orders/[id]/route.ts
  api/agent-log/route.ts
  api/products/route.ts
components/
  storefront.tsx          # product grid, layout, checkout handler
  cart-context.tsx        # React cart state (add/remove/clear, totalQty)
  cart-drawer.tsx         # cart UI + Razorpay checkout button
  agent-activity-panel.tsx# 2s-polling activity log
  webmcp-tools.tsx        # 8 WebMCP tools, logging, AbortController cleanup
lib/
  db.ts                   # better-sqlite3 init, schema, seed, queries
  types.ts                # shared TS interfaces
scripts/
  seed.mjs
  simulate-webhook.mjs
```

## Known Notes / Gotchas

- The machine's shell sets `NODE_ENV=production` globally, so plain
  `npm install` skips devDependencies — use `npm install --include=dev`.
- `better-sqlite3` is pinned to `^13` because the older major has no prebuilt
  binary for the machine's Node v25.
- The webhook needs a public HTTPS URL to receive real Razorpay events; use
  ngrok + the Razorpay dashboard, or `scripts/simulate-webhook.mjs` locally.
- Test payments (Standard Checkout modal): UPI VPA `success@razorpay` (any 4-6
  digit PIN), or card `4111 1111 1111 1111`, any future expiry, any CVV.
