# AgentStore — Complete Codebase Report

**Generated:** 2026-09-01

## 1. Project Overview

AgentStore is an AI-agent-friendly e-commerce demo built for the **Razorpay AI Buildathon — Track 1 (Agentic Commerce)**. It is a Next.js 14 storefront that exposes its entire shopping flow to browser-based AI agents through **Chrome's WebMCP** standard. Agents can search products, add them to a cart, view the cart, and kick off a **Razorpay test-mode payment** — while every agent action is logged and shown live on the page.

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2 (App Router, TypeScript) |
| UI | React 18, Tailwind CSS 3.4 |
| Database | SQLite via `better-sqlite3` v13 |
| Payments | Razorpay Node SDK v2 (`razorpay@2.9.4`) |
| Agent Integration | WebMCP (Chrome `document.modelContext` API) |
| Runtime | Node.js (server-side route handlers, `runtime = "nodejs"`) |

No external state management (Redux, Zustand, etc.) — React context + SQLite is sufficient.

## 3. Directory Structure

```
buildathon/
├── app/
│   ├── globals.css                    # Tailwind directives, dark color scheme
│   ├── layout.tsx                     # Root layout, CartProvider wrapper, Inter font
│   ├── page.tsx                       # Storefront (server component, reads products)
│   ├── order/
│   │   └── [id]/
│   │       └── page.tsx               # Order confirmation + Razorpay Standard Checkout
│   └── api/
│       ├── checkout/route.ts          # POST: stock validation, spend cap, Razorpay order creation
│       ├── verify/route.ts            # POST: HMAC-SHA256 signature verification
│       ├── webhook/razorpay/route.ts  # POST: webhook signature verification + order reconciliation
│       ├── orders/[id]/route.ts       # GET: order status + items
│       ├── agent-log/route.ts         # GET/POST: agent activity log (read last 20 / insert)
│       └── products/route.ts          # GET: full product list
├── components/
│   ├── storefront.tsx                 # Product grid, cart drawer, agent activity panel
│   ├── cart-context.tsx               # React cart state (add/remove/clear, totalQty)
│   ├── cart-drawer.tsx                # Cart UI + Razorpay checkout button
│   ├── agent-activity-panel.tsx       # 2s-polling activity log panel
│   └── webmcp-tools.tsx              # 8 WebMCP tools, logging, AbortController cleanup
├── lib/
│   ├── db.ts                          # better-sqlite3 init, schema, seed, CRUD queries
│   └── types.ts                       # Shared TypeScript interfaces
├── scripts/
│   ├── seed.mjs                       # Idempotent product seeder
│   └── simulate-webhook.mjs           # Signs fake webhook payload for local testing
├── data/
│   └── agentstore.db                  # SQLite database (auto-created)
├── .env.example                       # Environment variable template (committed)
├── .env.local                         # Actual secrets (gitignored)
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
└── postcss.config.mjs
```

## 4. Data Model (SQLite)

### `products` table

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `name` | TEXT NOT NULL | Product display name |
| `description` | TEXT NOT NULL DEFAULT '' | Short description |
| `price_paise` | INTEGER NOT NULL | Price in paise (₹1 = 100 paise) |
| `stock` | INTEGER NOT NULL DEFAULT 0 | Available inventory |
| `image_url` | TEXT NOT NULL DEFAULT '' | picsum.photos URL |

### `orders` table

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Local order ID |
| `razorpay_payment_link_id` | TEXT NOT NULL DEFAULT '' | Razorpay order ID (reused for both Payment Link and Standard Checkout flows) |
| `status` | TEXT NOT NULL DEFAULT 'created' | `created` / `paid` / `failed` |
| `amount_paise` | INTEGER NOT NULL DEFAULT 0 | Total in paise |
| `items_json` | TEXT NOT NULL DEFAULT '[]' | JSON array of `CartItem[]` |
| `created_at` | INTEGER NOT NULL | Unix timestamp (ms) |

### `agent_log` table

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `tool_name` | TEXT NOT NULL | WebMCP tool name |
| `arguments_json` | TEXT NOT NULL DEFAULT '{}' | JSON stringified args |
| `result_json` | TEXT NOT NULL DEFAULT '{}' | JSON stringified result |
| `timestamp` | INTEGER NOT NULL | Unix timestamp (ms) |

Schema and seed are created lazily in `lib/db.ts` via `initDb()`. WAL journal mode is enabled for better concurrent read performance.

## 5. Seeded Products

| # | Name | Price | Stock |
|---|---|---|---|
| 1 | Wireless Bluetooth Earbuds | ₹1,999 | 25 |
| 2 | Smart Fitness Band | ₹2,499 | 18 |
| 3 | Mechanical Keyboard (RGB) | ₹4,999 | 12 |
| 4 | Portable SSD 1TB | ₹8,999 | 9 |
| 5 | 4K Action Camera | ₹14,999 | 6 |
| 6 | Ergonomic Office Chair | ₹11,999 | 4 |

Each product has a `picsum.photos` image URL seeded with a timestamp-based seed for uniqueness.

## 6. Pages

### `/` — Storefront (`app/page.tsx`)

Server component that reads products from SQLite and renders `<Storefront>`. Contains:
- Product grid (image, name, description, price, stock, "Add to Cart" button)
- Cart drawer (slide-in panel with items, total, checkout button)
- Agent Activity Log panel (collapsible sidebar, polls `/api/agent-log` every 2s)
- WebMCP tool registration (hidden component, registers tools on mount)

### `/order/[id]` — Order Confirmation (`app/order/[id]/page.tsx`)

Client component that:
- Loads Razorpay Standard Checkout script (`https://checkout.razorpay.com/v1/checkout.js`)
- Polls `/api/orders/:id` every 2s until status leaves `created`
- Shows order items, total, and status badge
- Renders a "Pay" button that opens the Razorpay Standard Checkout modal
- On success, calls `/api/verify` to confirm the payment signature

## 7. API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/checkout` | POST | Validates stock + computes total **server-side** (client prices never trusted). Enforces `SPEND_CAP_PAISE` (default ₹5000). Creates a Razorpay order, inserts order as `created`, returns `{ orderId, razorpayOrderId, amount, currency, keyId }`. |
| `/api/verify` | POST | Verifies Standard Checkout payment signature (HMAC-SHA256 over `razorpayOrderId|razorpayPaymentId` via `RAZORPAY_KEY_SECRET`, timing-safe compare). Confirms Razorpay order ID matches local order. Marks `paid`. |
| `/api/webhook/razorpay` | POST | Verifies Razorpay HMAC-SHA256 signature over raw body. Handles both Standard Checkout events (`order.paid`, `order.failed`) and Payment Link events (`payment_link.paid`, `cancelled`, `expired`, `failed`). Marks matching order `paid` / `failed`. Always acks quickly. |
| `/api/orders/[id]` | GET | Returns order status, amount, items, `created_at`. |
| `/api/agent-log` | GET | Last 20 `agent_log` rows, newest first (powers the polling panel). |
| `/api/agent-log` | POST | Internal helper: inserts a log row (called by every WebMCP tool's `execute`). |
| `/api/products` | GET | Full product list (used by storefront, order page, and tools). |

All route handlers set `export const runtime = "nodejs"` to ensure Node.js APIs are available.

## 8. Components

### `cart-context.tsx`

React Context providing cart state:
- `items: CartItem[]` — current cart contents
- `add(productId, qty)` — add item (merges if already present)
- `remove(productId)` — remove item entirely
- `clear()` — empty cart
- `totalQty` — sum of all quantities

Wrapped around the entire app in `layout.tsx`.

### `storefront.tsx`

Main storefront layout:
- Header with "AgentStore" title, "WebMCP tools registered" badge, cart button with badge
- Product grid (2-column responsive)
- Agent Activity Log sidebar (sticky on desktop)
- Cart drawer integration
- Checkout handler: POSTs to `/api/checkout`, handles errors gracefully (spend cap, stock), redirects to `/order/[id]`

### `cart-drawer.tsx`

Slide-in cart panel:
- Lists cart items with image, name, unit price × qty, line total
- Remove button per item
- Total display
- "Checkout with Razorpay" button (disabled when empty or loading)
- Checkout error display
- Test mode hint: "use card 4111 1111 1111 1111"

### `agent-activity-panel.tsx`

Collapsible panel that polls `/api/agent-log` every 2s:
- Shows tool name, timestamp, arguments (truncated), result (with emoji indicators)
- Error results prefixed with ⚠️
- Empty state encourages testing with "search_products" or "view_cart"

### `webmcp-tools.tsx`

The core agent integration component. Registers 8 tools on mount via `document.modelContext.registerTool()`, guarded by `'modelContext' in document`. Unregisters on unmount using `AbortController` pattern.

| Tool | Input Schema | Purpose |
|---|---|---|
| `search_products` | `{ query: string }` | Search catalog by name/description keyword |
| `get_all_products` | `{}` | Full catalog: id, name, price, stock, description |
| `get_product` | `{ id: string }` | Full details for one product |
| `add_to_cart` | `{ id: string, qty: number }` | Add to cart; validates stock against server-side catalog |
| `view_cart` | `{}` | Cart contents + running total (with per-line prices) |
| `remove_from_cart` | `{ id: string }` | Remove an item from the cart |
| `checkout` | `{}` | POSTs cart to `/api/checkout`, creates order, clears cart, directs user to `/order/:id`. Annotated `readOnlyHint: false`, `untrustedContentHint: true`. |
| `get_order_status` | `{ orderId: string }` | Fetch `/api/orders/:id` and return status |

Every tool logs its call (name + args + result) to `agent_log` before returning. The `checkout` tool handles spend-cap rejections gracefully (returns structured error instead of throwing).

Key implementation details:
- Uses `useRef` to keep cart closures reading the live cart (avoids stale snapshots)
- `AbortController` cancels in-flight fetch calls on unmount
- Handles `InvalidStateError` / `Duplicate` gracefully (StrictMode double-mount)

## 9. Database Layer (`lib/db.ts`)

Key functions:

| Function | Purpose |
|---|---|
| `initDb()` | Creates schema + seeds if products table empty. Called lazily. |
| `seedProducts(db)` | Inserts 6 sample products in a transaction. |
| `getAllProducts()` | `SELECT * FROM products ORDER BY id ASC` |
| `findProducts(query)` | Filters products by name/description (in-memory after fetch). |
| `getProductById(id)` | `SELECT * FROM products WHERE id = ?` |
| `getOrder(orderId)` | `SELECT * FROM orders WHERE id = ?` |
| `insertOrder(order)` | Inserts order with items_json, returns `lastInsertRowid`. |
| `markOrderPaid(paymentLinkId)` | Updates status to `paid` by Razorpay ID. |
| `markOrderFailed(paymentLinkId)` | Updates status to `failed` by Razorpay ID. |
| `getRecentAgentLog(limit)` | Last N log rows, newest first. |
| `insertAgentLog(entry)` | Inserts a log row with timestamp. |

Database file: `./data/agentstore.db` (auto-created in `data/` directory).

## 10. Type Definitions (`lib/types.ts`)

| Interface | Fields |
|---|---|
| `Product` | `id`, `name`, `description`, `price_paise`, `stock`, `image_url` |
| `CartItem` | `productId`, `qty` |
| `OrderRow` | `id`, `razorpay_payment_link_id`, `status`, `amount_paise`, `items_json`, `created_at` |
| `AgentLogRow` | `id`, `tool_name`, `arguments_json`, `result_json`, `timestamp` |
| `ModelContext` | `registerTool(tool)`, `unregisterTool(toolId)`, `getCapabilities?()` |
| `WebMCPTool` | `id`, `name`, `description`, `inputSchema`, `execute(input)`, `annotations?` |

## 11. Scripts

### `scripts/seed.mjs`

Idempotent product seeder. Usage: `npm run seed`. Creates schema and inserts 6 products if table is empty. Safe to run multiple times.

### `scripts/simulate-webhook.mjs`

Simulates a `payment_link.paid` webhook against the local server. Usage: `node scripts/simulate-webhook.mjs [paymentLinkId] [amountPaise]`.

- Reads `RAZORPAY_WEBHOOK_SECRET` from `.env.local`
- Signs the payload with HMAC-SHA256
- POSTs to `http://localhost:3000/api/webhook/razorpay`
- Useful for testing without a Razorpay tunnel

## 12. Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `RAZORPAY_KEY_ID` | (empty) | Razorpay test-mode key ID |
| `RAZORPAY_KEY_SECRET` | (empty) | Razorpay test-mode secret — **server-only** |
| `RAZORPAY_WEBHOOK_SECRET` | (empty) | HMAC secret for webhook signature verification |
| `SPEND_CAP_PAISE` | `500000` | Max order total in paise (₹5000) |
| `NEXT_PUBLIC_BASE_URL` | (optional) | Base URL for checkout callbacks; falls back to `localhost:3000` |

`.env.local` is gitignored. Only `.env.example` (placeholders) is committed.

## 13. Configuration Files

### `next.config.mjs`
- `reactStrictMode: true`

### `tsconfig.json`
- Target: ES2017
- Module: ESNext with bundler resolution
- Strict mode enabled
- Path alias: `@/*` → `./*`

### `tailwind.config.ts`
- Content: `app/**` and `components/**`
- No plugins

### `postcss.config.mjs`
- Standard Tailwind + Autoprefixer

## 14. Security Considerations

1. **Prices never trusted from client.** `/api/checkout` looks up prices and stock in SQLite and computes the total server-side.
2. **Spend cap is a graceful rejection.** Orders above `SPEND_CAP_PAISE` get a structured `402` JSON error (not a crash).
3. **Keys stay server-side.** `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are only read in route handlers.
4. **Webhook signature verification.** HMAC-SHA256 over raw body using `Razorpay.validateWebhookSignature`.
5. **Payment verification.** Timing-safe comparison of HMAC-SHA256 signature.
6. **`.env.local` is gitignored.** Never committed.

## 15. Build & Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server (Next.js) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |
| `npm run seed` | Idempotent product seeder |
| `node scripts/simulate-webhook.mjs` | Simulate webhook locally |

## 16. Testing Webhooks Locally

Razorpay can't reach `localhost`, so:

1. **Option A: ngrok tunnel**
   ```bash
   ngrok http 3000
   ```
   Point webhook URL in Razorpay Dashboard to `https://<ngrok-id>.ngrok.app/api/webhook/razorpay`.

2. **Option B: simulate-webhook script**
   ```bash
   node scripts/simulate-webhook.mjs [paymentLinkId] [amountPaise]
   ```
   Signs and POSTs a fake `payment_link.paid` payload.

## 17. Testing WebMCP Tools

1. Enable WebMCP in Chrome: `chrome://flags/#enable-webmcp-testing`
2. Install the Model Context Tool Inspector extension
3. Open `http://localhost:3000` and the Tool Inspector
4. Try: `search_products({ query: "keyboard" })`, `add_to_cart({ id: 1, qty: 2 })`, `checkout({})`

## 18. Known Notes / Gotchas

- The machine's shell sets `NODE_ENV=production` globally, so plain `npm install` skips devDependencies — use `npm install --include=dev`.
- `better-sqlite3` is pinned to `^13` because the older major has no prebuilt binary for Node v25.
- The webhook needs a public HTTPS URL for real Razorpay events; use ngrok or `simulate-webhook.mjs` locally.
- Test payments (Standard Checkout modal): UPI VPA `success@razorpay` (any 4-6 digit PIN), or card `4111 1111 1111 1111`, any future expiry, any CVV.
- `razorpay_payment_link_id` column stores the Razorpay order ID (reused for both Payment Link and Standard Checkout flows).
