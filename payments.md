# AgentStore — Razorpay Implementation Deep Dive

**Generated:** 2026-09-01

## 1. Overview

AgentStore integrates Razorpay in **test mode** to process payments. The application supports two payment flows:

1. **Standard Checkout (Primary Flow)** — Uses the Razorpay Checkout Modal loaded via `checkout.js` script. The user clicks "Pay" on the order page, a modal opens, and payment is verified client-side via HMAC-SHA256 signature.

2. **Payment Links (Legacy/Alternate Flow)** — Creates a Razorpay Payment Link server-side, opens it in a new tab. Payment completion is confirmed via webhook (`payment_link.paid`).

The current active implementation uses **Standard Checkout** as the primary flow. Payment Links code still exists in the codebase but is not the active checkout path.

## 2. Razorpay SDK Setup

### Installation

```json
// package.json
"razorpay": "^2.9.4"
```

### Initialization (Server-Side Only)

```typescript
// app/api/checkout/route.ts
import Razorpay from "razorpay";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
```

The Razorpay client is instantiated fresh in each request handler. It is **never** exposed to the client — only the `key_id` (public) is sent in the API response.

## 3. Environment Variables

| Variable | Purpose | Where Used |
|---|---|---|
| `RAZORPAY_KEY_ID` | Public test-mode key (e.g., `rzp_test_...`) | `/api/checkout` (returned to client), order page |
| `RAZORPAY_KEY_SECRET` | Secret key for server-side signing | `/api/checkout`, `/api/verify` |
| `RAZORPAY_WEBHOOK_SECRET` | HMAC secret for webhook signature verification | `/api/webhook/razorpay`, `simulate-webhook.mjs` |
| `SPEND_CAP_PAISE` | Maximum order amount in paise (default ₹5000) | `/api/checkout` |

All secrets are server-side only. The client never receives `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET`.

## 4. Standard Checkout Flow (Primary)

### 4.1 Order Creation (`/api/checkout`)

**File:** `app/api/checkout/route.ts`

**Request:**
```json
POST /api/checkout
{
  "items": [{ "productId": 1, "qty": 2 }, { "productId": 3, "qty": 1 }]
}
```

**Processing:**
1. Parse and validate JSON body
2. Normalize items (convert to integers, validate positive)
3. Server-side price lookup from SQLite (client prices never trusted)
4. Stock validation for each item
5. Spend-cap check (`SPEND_CAP_PAISE`, default ₹5000 / 500000 paise)
6. Create Razorpay order via SDK

```typescript
const createParams: Orders.RazorpayOrderCreateRequestBody = {
  amount: totalPaise,        // Amount in paise
  currency: "INR",
  receipt: `order-${Date.now()}`,
  notes: {
    items: JSON.stringify(items),  // Store cart items in notes
  },
};
order = await razorpay.orders.create(createParams);
```

7. Insert order into SQLite with `status: "created"` and the Razorpay order ID

**Response:**
```json
{
  "orderId": 42,
  "razorpayOrderId": "order_QxYz123abc",
  "amount": 1199800,
  "currency": "INR",
  "keyId": "rzp_test_..."
}
```

**Error Handling:**
- Invalid JSON → 400
- Empty cart → 400
- Invalid productId/qty → 400
- Product not found → 400
- Insufficient stock → 409 with `{ productId, requested, available }`
- Spend cap exceeded → 402 with `{ code: "SPEND_CAP_EXCEEDED", totalPaise, spendCapPaise }`
- Razorpay API failure → 502 with `{ code: "CHECKOUT_REJECTED", statusCode, razorpayCode }`
- Missing Razorpay config → 500

### 4.2 Client-Side Payment (Order Page)

**File:** `app/order/[id]/page.tsx`

The order page loads the Razorpay checkout script and opens the modal:

```html
<Script
  src="https://checkout.razorpay.com/v1/checkout.js"
  strategy="afterInteractive"
  onLoad={() => setScriptLoaded(true)}
/>
```

**Payment Modal Initialization:**
```typescript
const rzp = new window.Razorpay({
  key: data.keyId,                    // Public key from API
  amount: data.amount,                // Amount in paise
  currency: data.currency ?? "INR",
  name: "AgentStore",
  description: `Order #${data.orderId} — Razorpay test mode`,
  order_id: data.razorpayOrderId,     // Razorpay order ID
  handler: async (response: RazorpayResponse) => {
    // Called on successful payment
    // Verify signature server-side
    const verifyRes = await fetch("/api/verify", {
      method: "POST",
      body: JSON.stringify({
        orderId: data.orderId,
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      }),
    });
    // ...
  },
  modal: {
    ondismiss: () => setPaying(false),
  },
  theme: { color: "#4f46e5" },
});
rzp.on("payment.failed", (res) => {
  setPayError(res.error?.description ?? "Payment failed.");
});
rzp.open();
```

**RazorpayResponse type:**
```typescript
interface RazorpayResponse {
  razorpay_payment_id: string;   // e.g., "pay_..."
  razorpay_order_id: string;     // e.g., "order_..."
  razorpay_signature: string;    // HMAC-SHA256 signature
}
```

### 4.3 Payment Verification (`/api/verify`)

**File:** `app/api/verify/route.ts`

**Request:**
```json
POST /api/verify
{
  "orderId": 42,
  "razorpayOrderId": "order_QxYz123abc",
  "razorpayPaymentId": "pay_...",
  "razorpaySignature": "..."
}
```

**Verification Process:**

1. Compute expected signature:
   ```typescript
   const expected = crypto
     .createHmac("sha256", secret)
     .update(`${razorpayOrderId}|razorpayPaymentId`)
     .digest("hex");
   ```

2. Timing-safe comparison:
   ```typescript
   const a = Buffer.from(expected);
   const b = Buffer.from(razorpaySignature);
   if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
     return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
   }
   ```

3. Verify the Razorpay order ID matches the local order:
   ```typescript
   const order = getOrder(localOrderId);
   if (order.razorpay_payment_link_id !== razorpayOrderId) {
     return NextResponse.json(
       { error: "Razorpay order id does not match this order." },
       { status: 400 }
     );
   }
   ```

4. Mark order as `paid`:
   ```typescript
   markOrderPaid(razorpayOrderId);
   ```

**Response:**
```json
{ "ok": true, "orderId": 42, "paymentId": "pay_..." }
```

### 4.4 Order Status Polling

The order page polls `/api/orders/[id]` every 2 seconds:

```typescript
useEffect(() => {
  const tick = async () => {
    const res = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
    const data = await res.json();
    setOrder(data);
    if (data.status !== "created" && timer) clearInterval(timer);
  };
  void tick();
  timer = setInterval(tick, 2000);
  return () => { cancelled = true; clearInterval(timer); };
}, [orderId]);
```

Once status changes from `created` to `paid` or `failed`, polling stops.

## 5. Webhook Flow (Secondary/Fallback)

### 5.1 Webhook Endpoint (`/api/webhook/razorpay`)

**File:** `app/api/webhook/razorpay/route.ts`

**Signature Verification:**
```typescript
const rawBody = await req.text();
const signature = req.headers.get("x-razorpay-signature") ?? "";
Razorpay.validateWebhookSignature(rawBody, signature, secret);
```

**Event Handling:**

| Event | Action |
|---|---|
| `payment_link.paid` | `markOrderPaid(entityId)` |
| `order.paid` | `markOrderPaid(entityId)` |
| `payment_link.cancelled` | `markOrderFailed(entityId)` |
| `payment_link.expired` | `markOrderFailed(entityId)` |
| `payment_link.failed` | `markOrderFailed(entityId)` |
| `order.failed` | `markOrderFailed(entityId)` |
| `order.cancelled` | `markOrderFailed(entityId)` |
| `order.expired` | `markOrderFailed(entityId)` |

**Entity extraction:**
```typescript
const entity = event.payload?.order?.entity ?? event.payload?.payment_link?.entity;
const entityId = entity?.id as string | undefined;
```

Both Standard Checkout events (order entity) and Payment Link events (payment_link entity) are supported. The entity ID is the same string stored in `razorpay_payment_link_id` column.

The endpoint always returns 200 quickly — the UI polls for status updates.

### 5.2 Webhook Testing Script

**File:** `scripts/simulate-webhook.mjs`

```bash
node scripts/simulate-webhook.mjs [paymentLinkId] [amountPaise]
```

- Reads `RAZORPAY_WEBHOOK_SECRET` from `.env.local`
- Constructs a `payment_link.paid` event payload
- Signs with HMAC-SHA256
- POSTs to `http://localhost:3000/api/webhook/razorpay`

### 5.3 Webhook Setup (Production)

For real Razorpay webhooks:
1. Expose app with ngrok: `ngrok http 3000`
2. In Razorpay Dashboard → Settings → Webhooks
3. Set URL to `https://<ngrok-id>.ngrok.app/api/webhook/razorpay`
4. Set secret to `RAZORPAY_WEBHOOK_SECRET`
5. Enable `payment_link.paid` event

## 6. Database Schema for Payments

### Order Table

```sql
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  razorpay_payment_link_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'created',
  amount_paise INTEGER NOT NULL DEFAULT 0,
  items_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
```

**Key details:**
- `razorpay_payment_link_id` stores the Razorpay order ID (e.g., `order_QxYz123abc`)
- Despite the column name, this is used for both Payment Links and Standard Checkout
- `status` transitions: `created` → `paid` or `created` → `failed`
- `items_json` is a JSON array of `CartItem[]` objects
- `created_at` is a Unix timestamp in milliseconds

### Order Functions

```typescript
insertOrder({
  razorpay_payment_link_id: order.id,
  status: "created",
  amount_paise: totalPaise,
  items,
}) → number  // Returns local order ID

markOrderPaid(paymentLinkId: string) → number  // Returns rows affected
markOrderFailed(paymentLinkId: string) → number  // Returns rows affected
getOrder(orderId: number) → OrderRow | undefined
```

## 7. Client-Side Cart → Checkout → Payment Flow

### Step 1: Cart Management (React Context)

**File:** `components/cart-context.tsx`

```typescript
interface CartItem {
  productId: number;
  qty: number;
}

// Cart operations
add(productId, qty)     // Merges if already in cart
remove(productId)       // Removes entirely
clear()                 // Empties cart
totalQty                // Sum of all quantities
```

### Step 2: WebMCP Agent Checkout

**File:** `components/webmcp-tools.tsx`

When an agent calls the `checkout` tool:

```typescript
execute: (input) => runTool("checkout", input, async () => {
  const cart = cartRef.current;
  const res = await fetch("/api/checkout", {
    method: "POST",
    body: JSON.stringify({ items: cart }),
  });
  const data = await res.json();
  
  if (!res.ok) {
    return { error: data.error, code: data.code };
  }
  
  clear();
  return {
    ok: true,
    message: `Order ${data.orderId} created. Tell the user to open /order/${data.orderId} and click "Pay"`,
    orderId: data.orderId,
  };
})
```

### Step 3: Manual Checkout (Cart Drawer)

**File:** `components/cart-drawer.tsx`

```typescript
// Checkout button handler in cart drawer
<button onClick={onCheckout} disabled={items.length === 0 || checkoutState === "loading"}>
  {checkoutState === "loading" ? "Creating payment link…" : "Checkout with Razorpay"}
</button>
```

### Step 4: Storefront Checkout Handler

**File:** `components/storefront.tsx`

```typescript
const handleCheckout = useCallback(async () => {
  const res = await fetch("/api/checkout", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
  const data = await res.json();
  
  if (!res.ok) {
    setCheckoutError(data.error);
    return;
  }
  
  // For Payment Links: open in new tab
  if (data.paymentLinkUrl) {
    window.open(data.paymentLinkUrl, "_blank");
  }
  // Navigate to order page for Standard Checkout
  window.location.href = `/order/${data.orderId}`;
}, [items]);
```

## 8. Spend Cap Enforcement

**Default:** ₹5,000 (500,000 paise)

```typescript
const SPEND_CAP_PAISE = Number(process.env.SPEND_CAP_PAISE ?? 500000);

if (totalPaise > SPEND_CAP_PAISE) {
  return NextResponse.json({
    error: `Order total ₹${(totalPaise / 100).toFixed(2)} exceeds the spend cap...`,
    code: "SPEND_CAP_EXCEEDED",
    totalPaise,
    spendCapPaise: SPEND_CAP_PAISE,
  }, { status: 402 });
}
```

This is a **graceful rejection** — the agent's `checkout` tool surfaces the message instead of throwing, so the agent can explain the cap to the user.

## 9. Error Handling Summary

### Server-Side Errors

| Error | Status Code | Response |
|---|---|---|
| Invalid JSON body | 400 | `{ error: "Invalid JSON body." }` |
| Empty cart | 400 | `{ error: "Cart is empty..." }` |
| Invalid productId/qty | 400 | `{ error: "Invalid productId..." }` |
| Product not found | 400 | `{ error: "Product X does not exist." }` |
| Insufficient stock | 409 | `{ error: "...", productId, requested, available }` |
| Spend cap exceeded | 402 | `{ error: "...", code: "SPEND_CAP_EXCEEDED", ... }` |
| Razorpay not configured | 500 | `{ error: "Razorpay is not configured..." }` |
| Razorpay API failure | 502 | `{ error: "Failed to create order:...", code: "CHECKOUT_REJECTED" }` |
| Invalid webhook signature | 400 | `{ error: "Invalid webhook signature." }` |
| Order not found | 404 | `{ error: "Order not found." }` |
| Invalid signature (verify) | 400 | `{ error: "Invalid signature." }` |
| Razorpay order ID mismatch | 400 | `{ error: "Razorpay order id does not match..." }` |

### Client-Side Errors

| Scenario | Handling |
|---|---|
| Spend cap rejection | Shows error message in cart drawer, does not redirect |
| Razorpay modal load failure | Shows "Razorpay checkout failed to load." |
| Payment failed | Shows error from `res.error.description` |
| Verification failure | Shows "Payment verification failed." |
| Network error | Shows "Network error while reaching the checkout API." |

## 10. Security Measures

### 1. Server-Side Price Validation

```typescript
// Client prices are NEVER trusted
const products = getAllProducts();
const byId = new Map(products.map((p) => [p.id, p]));
for (const { productId, qty } of requested) {
  const product = byId.get(productId);
  // Validate stock
  if (qty > product.stock) { /* reject */ }
  // Compute total from DB prices
  totalPaise += product.price_paise * qty;
}
```

### 2. Timing-Safe Signature Comparison

```typescript
const a = Buffer.from(expected);
const b = Buffer.from(razorpaySignature);
if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
  return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
}
```

### 3. Webhook Signature Verification

```typescript
Razorpay.validateWebhookSignature(rawBody, signature, secret);
```

### 4. Order ID Cross-Verification

```typescript
const order = getOrder(localOrderId);
if (order.razorpay_payment_link_id !== razorpayOrderId) {
  return NextResponse.json({ error: "Razorpay order id does not match..." });
}
```

### 5. Environment Variable Isolation

- `RAZORPAY_KEY_SECRET` — server-only
- `RAZORPAY_WEBHOOK_SECRET` — server-only
- Client only receives `RAZORPAY_KEY_ID` (public) and `paymentLinkUrl`

## 11. Test Mode Credentials

### Test Card
```
Number: 4111 1111 1111 1111
Expiry: Any future date
CVV: Any 3 digits
```

### Test UPI
```
VPA: success@razorpay
PIN: Any 4-6 digits
```

## 12. Razorpay Dashboard Configuration

For local development:
1. Go to https://dashboard.razorpay.com → Test Mode
2. Copy `Key ID` and `Key Secret` to `.env.local`
3. For webhooks: Settings → Webhooks → Add New Webhook
4. Set URL (via ngrok) and secret
5. Enable events: `payment_link.paid`, `order.paid`, `order.failed`

## 13. Flow Diagrams

### Standard Checkout Flow

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │     │  Next.js API │     │   Razorpay   │
│   (Agent)    │     │   (Server)   │     │   (Cloud)    │
└──────┬──────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                     │
       │  POST /api/checkout│                     │
       │  { items: [...] }  │                     │
       │───────────────────>│                     │
       │                    │  orders.create()    │
       │                    │────────────────────>│
       │                    │  { id, amount }     │
       │                    │<────────────────────│
       │  { orderId,        │                     │
       │    razorpayOrderId,│                     │
       │    amount, keyId } │                     │
       │<───────────────────│                     │
       │                    │                     │
       │  Open Razorpay Modal (checkout.js)       │
       │─────────────────────────────────────────>│
       │                    │                     │
       │  User enters card details               │
       │─────────────────────────────────────────>│
       │                    │                     │
       │  { razorpay_payment_id,                  │
       │    razorpay_order_id,                    │
       │    razorpay_signature }                  │
       │<─────────────────────────────────────────│
       │                    │                     │
       │  POST /api/verify  │                     │
       │  { orderId, razorpayOrderId,             │
       │    razorpayPaymentId, razorpaySignature }│
       │───────────────────>│                     │
       │                    │  Verify HMAC-SHA256 │
       │                    │  markOrderPaid()    │
       │  { ok: true }      │                     │
       │<───────────────────│                     │
       │                    │                     │
       │  Poll /api/orders/:id                    │
       │───────────────────>│                     │
       │  { status: "paid" }│                     │
       │<───────────────────│                     │
```

### Webhook Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Razorpay   │     │  Next.js API │     │   SQLite     │
│   (Cloud)    │     │   (Server)   │     │   (Local)    │
└──────┬──────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                     │
       │  POST /api/webhook/razorpay              │
       │  { event: "payment_link.paid",           │
       │    payload: { payment_link: { entity } } }│
       │───────────────────>│                     │
       │                    │  Verify HMAC-SHA256 │
       │                    │  Extract entityId   │
       │                    │  markOrderPaid()    │
       │                    │────────────────────>│
       │  { ok: true }      │                     │
       │<───────────────────│                     │
```

## 14. Column Naming Note

The `razorpay_payment_link_id` column name is a historical artifact. Despite the name, it stores the **Razorpay order ID** (e.g., `order_QxYz123abc`) for both Payment Link and Standard Checkout flows. The column is used as an opaque reference string to reconcile payment status. Renaming this column would be a breaking change, so it's kept as-is.

## 15. Future Considerations

1. **Payment Links vs Standard Checkout** — The codebase supports both flows. Standard Checkout is currently primary because it provides a better UX (modal vs new tab).

2. **Webhook Redundancy** — The webhook handler is a fallback for when the client-side verification fails or the user closes the modal after payment.

3. **Real Deployment** — Would need:
   - Public HTTPS URL for webhooks
   - `NEXT_PUBLIC_BASE_URL` environment variable
   - Production Razorpay keys
   - Database persistence (SQLite is fine for demo, but not production)

4. **Stock Management** — Currently decrements are not implemented (demo only). Production would need atomic stock decrement on payment confirmation.

5. **Refund Handling** — Not implemented. Production would need Razorpay refund API integration.
