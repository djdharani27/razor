# 🛒 AgentStore

An AI-agent-friendly e-commerce demo built for the **Razorpay AI Buildathon — Track 1 (Agentic Commerce)**.

AgentStore exposes its entire storefront as WebMCP tools, so a browser-based AI agent can browse products, fill the cart, and kick off a Razorpay test payment — with every agent action logged in real time on the page.

## Tech Stack

- **Next.js 14** (App Router, TypeScript, Tailwind CSS)
- **SQLite** via `better-sqlite3` — products, orders, and an agent activity log
- **Razorpay Node SDK** — server-side Payment Links API + webhook signature verification
- **WebMCP** — tools registered with the browser's `document.modelContext` API
- No external state management — React state + SQLite is enough

## Data Model

| Table | Columns |
| --- | --- |
| `products` | `id`, `name`, `description`, `price_paise`, `stock`, `image_url` |
| `orders` | `id`, `razorpay_payment_link_id`, `status` (`created\|paid\|failed`), `amount_paise`, `items_json`, `created_at` |
| `agent_log` | `id`, `tool_name`, `arguments_json`, `result_json`, `timestamp` |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
#    then fill in RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (test-mode keys)
#    and RAZORPAY_WEBHOOK_SECRET (any random string is fine for local testing)

# 3. Seed the database (creates data/agentstore.db and 6 sample products)
npm run seed

# 4. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The products table auto-seeds on first server start too — the explicit `npm run seed` step is only needed if you want to reset or re-seed.

### Environment Variables (`.env.local`)

| Variable | Description |
| --- | --- |
| `RAZORPAY_KEY_ID` | Razorpay test-mode key id (dashboard.razorpay.com → Test Mode) |
| `RAZORPAY_KEY_SECRET` | Razorpay test-mode key secret — **server-side only, never sent to the client** |
| `RAZORPAY_WEBHOOK_SECRET` | Secret used to verify webhook signatures (HMAC-SHA256) |
| `SPEND_CAP_PAISE` | Hard cap per checkout, default `500000` (₹5000). Orders above this are rejected with a structured JSON error. |

**Never commit real keys.** `.env.local` is gitignored; only `.env.example` (placeholders) is committed.

## WebMCP Tools

AgentStore registers 8 tools with the browser via `document.modelContext.registerTool()`:

| Tool | Purpose |
| --- | --- |
| `search_products` | Search the catalog by name/description keyword |
| `get_all_products` | List the full product catalog |
| `get_product` | Full details for one product |
| `add_to_cart` | Add to cart (stock-validated) |
| `view_cart` | Current cart contents + running total |
| `remove_from_cart` | Remove an item from the cart |
| `checkout` | Creates a Razorpay Payment Link for the whole cart, opens it in a new tab for the human to pay. Marked `readOnlyHint: false` / `untrustedContentHint: true`. Handles spend-cap rejections gracefully. |
| `get_order_status` | Check order payment status |

Every tool call is written to the `agent_log` table and streamed to the **Agent Activity Log** panel on the storefront (polls every 2s).

### How to Test the Tools Locally

1. **Enable WebMCP in Chrome** — paste this into the address bar, set the flag to *Enabled*, and relaunch Chrome:

   ```
   chrome://flags/#enable-webmcp-testing
   ```

2. **Install the Model Context Tool Inspector** extension from the Chrome Web Store.

3. Start the app (`npm run dev`), open **http://localhost:3000**, and open the Tool Inspector.

4. You should see the seven AgentStore tools listed. Try:

   - `search_products({ query: "keyboard" })`
   - `get_product({ id: 1 })`
   - `add_to_cart({ id: 1, qty: 2 })`
   - `view_cart({})`
   - `checkout({})` — watch the Razorpay payment link open in a new tab
   - `get_order_status({ orderId: 1 })`

5. Keep the **Agent Activity Log** panel open on the page to watch each call land in real time.

## Payments (Razorpay Test Mode)

Checkout creates a Razorpay **Payment Link** server-side and returns `{ orderId, paymentLinkUrl }`. The human completes payment in the new tab; the `payment_link.paid` webhook flips the order to `paid`.

**Test card:** `4111 1111 1111 1111` — any future expiry, any CVV. This completes a successful test payment.

## UPI Reserve Pay (SBMD) Sandbox — `/upi-sbmd`

The repo also bundles the **UPI Reserve Pay / Single-Block-Multiple-Debit** step-runner at [http://localhost:3000/upi-sbmd](http://localhost:3000/upi-sbmd). It is a self-contained sandbox that walks through the whole SBMD API flow against Razorpay test mode:

1. **1.1 → 1.3** register the mandate (create customer → authorisation order → checkout.js mandate approval).
2. **2.1** fetches the authorisation payment to get its `token_id`.
3. **3.1 → 3.2** create a charge order and initiate the one-time recurring payment against the blocked amount.

It reuses the same server-side `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` as AgentStore (no extra env needed). Steps run standalone at any stage and auto-wire the ids they need from earlier step outputs (`customer_id`, `order_id`, `token_id`, email/contact). Its server-side step session persists under `.rzpdata-sbmd/` (gitignored).

Namespaced SBMD code lives under `lib/upi-sbmd/`, `components/upi-sbmd/`, `app/upi-sbmd/` and its API routes are `/api/rzp-sbmd`, `/api/sbmd-env`, `/api/sbmd-session` — none collide with the AgentStore routes above.

### Testing the Webhook Locally

Razorpay can't reach `localhost`, so expose the app with a tunnel:

```bash
# with ngrok
ngrok http 3000
```

Then in the Razorpay Dashboard → Settings → Webhooks, point the webhook URL at `https://<your-ngrok-id>.ngrok.app/api/webhook/razorpay` and set the secret to your `RAZORPAY_WEBHOOK_SECRET`. Use the **Payment Link** event (`payment_link.paid`).

> Alternatively, simulate the webhook locally:
> ```bash
> # POST a signed payload with the correct signature
> node scripts/simulate-webhook.mjs
> ```

## API Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/checkout` | POST | Validate stock + compute total server-side (client prices never trusted), enforce `SPEND_CAP_PAISE`, create Razorpay Payment Link, insert order as `created`, return `{ orderId, paymentLinkUrl }` |
| `/api/webhook/razorpay` | POST | Verify Razorpay HMAC-SHA256 signature over the raw body, reconcile order status |
| `/api/orders/:id` | GET | Order status + items |
| `/api/agent-log` | GET/POST | Read last 20 log rows / insert a log row |
| `/api/products` | GET | Full product list |

## Project Structure

```
app/
  page.tsx                    # storefront (server component, reads products)
  layout.tsx
  order/[id]/page.tsx         # order confirmation + live status polling
  api/
    checkout/route.ts
    webhook/razorpay/route.ts
    orders/[id]/route.ts
    agent-log/route.ts
    products/route.ts
components/
  storefront.tsx              # product grid + layout
  cart-context.tsx            # React cart state
  cart-drawer.tsx             # cart drawer + checkout button
  agent-activity-panel.tsx    # polls /api/agent-log every 2s
  webmcp-tools.tsx            # WebMCP tool registration (useEffect + AbortController)
lib/
  db.ts                       # better-sqlite3 setup, schema, seed, queries
  types.ts
scripts/
  seed.mjs                    # idempotent product seeder
```

## Notes

- **Prices are never trusted from the client.** `/api/checkout` looks up prices and stock in SQLite and computes the total server-side.
- **Spend cap is a graceful rejection.** If an order exceeds `SPEND_CAP_PAISE`, the API returns `402` with `{ error, code: "SPEND_CAP_EXCEEDED", totalPaise, spendCapPaise }`, and the agent's `checkout` tool surfaces that message instead of throwing — so the agent can explain the cap to the user.
- **Keys stay server-side.** `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are only read from `process.env` in route handlers. The client only ever receives the public `paymentLinkUrl` and an order id.
- For a real deployment, point the webhook at a public HTTPS URL and add `NEXT_PUBLIC_BASE_URL` so checkout callback URLs resolve correctly.
