// Server-side Razorpay core for the UPI Reserve Pay (single_block_multiple_debit)
// flow. Wraps the official SDK so callers never construct HTTP requests or touch
// credentials. Enforces the Reserve Pay contract:
//   - authorisation order  : amount ₹1 (100 paise), method "upi",
//     token.type = "single_block_multiple_debit",
//     token.frequency = "as_presented",
//     token.max_amount ≤ ₹10,000 (1_000_000 paise),
//     token.expire_at ≤ 90 days from now.
//   - charge order         : created WITHOUT a notification object so the
//     subsequent recurring payment debits immediately (no 25h pre-debit hold).
//   - one-time payment     : POST /v1/payments/create/recurring with the token.

import Razorpay from "razorpay";
import type { Orders } from "razorpay/dist/types/orders";
import type { Customers } from "razorpay/dist/types/customers";
import type { Tokens } from "razorpay/dist/types/tokens";
import type { Payments } from "razorpay/dist/types/payments";
import { logServer } from "@/lib/agent/server-log";

// Reserve Pay ceilings (in paise unless noted). The block ceiling is ₹10,000.
export const MAX_BLOCK_PAISE = 1_000_000; // ₹10,000
export const MAX_MANDATE_DAYS = 90;
export const AUTH_ORDER_AMOUNT_PAISE = 100; // ₹1 dummy authorisation payment
// Default block a customer reserves. Cart ≤ SPEND_CAP (₹5,000 default) always
// fits inside it; override via MANDATE_BLOCK_PAISE (env, optional).
export const DEFAULT_BLOCK_PAISE = Number(process.env.MANDATE_BLOCK_PAISE ?? 500000);

export const UPI_DUMMY_PAYMENT_REASON = "upi_dummy_payment";

export interface CustomerIdentity {
  name: string;
  contact: string; // 10-digit, already normalised
  email?: string | null;
}

type RzpError = {
  statusCode?: number;
  error?: { description?: string; code?: string; reason?: string };
  message?: string;
};

function errorMessage(e: unknown, fallback = "Unknown Razorpay error"): string {
  const r = e as RzpError;
  return r?.error?.description ?? r?.message ?? fallback;
}

function errorReason(e: unknown): string | undefined {
  return (e as RzpError)?.error?.reason;
}

export function rzpConfig(): {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
} {
  return {
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
  };
}

export function isRzpConfigured(): boolean {
  const { keyId, keySecret } = rzpConfig();
  return Boolean(keyId && keySecret);
}

export function getRzpClient(): Razorpay {
  const { keyId, keySecret } = rzpConfig();
  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/** Order expiry Unix seconds: 89 days out keeps a margin under the 90-day cap. */
export function defaultExpireAt(now = Date.now()): number {
  return Math.floor(now / 1000) + MAX_MANDATE_DAYS * 86400 - 86400;
}

/** Reserve Pay block size: at least the current cart total, capped at ₹10,000. */
export function blockForAmount(amountPaise: number): number {
  const base = Math.max(DEFAULT_BLOCK_PAISE, amountPaise);
  return Math.min(base, MAX_BLOCK_PAISE);
}

export interface RzpCustomerResult {
  ok: boolean;
  rzpCustomerId?: string;
  error?: string;
  razorpay_error?: unknown;
}

/**
 * Resolve a Razorpay customer for a local identity. Reuses the stored
 * rzp_customer_id when we have one (validating it still exists), else creates
 * the customer with fail_existing: "0" so an existing Razorpay record for the
 * same contact is returned rather than duplicated.
 */
export async function ensureRzpCustomer(input: {
  name: string;
  contact: string;
  email?: string | null;
  existingRzpCustomerId?: string | null;
}): Promise<RzpCustomerResult> {
  const rzp = getRzpClient();
  const { name, contact, email } = input;

  if (input.existingRzpCustomerId) {
    try {
      const existing = await rzp.customers.fetch(input.existingRzpCustomerId);
      logServer("rzp", `Customer ${existing.id} validated (existing)`, {
        detail: { contact, rzp_customer_id: existing.id },
      });
      return { ok: true, rzpCustomerId: existing.id };
    } catch {
      logServer("rzp", `Stored customer ${input.existingRzpCustomerId} no longer exists — recreating`, {
        level: "warn",
        detail: { contact },
      });
    }
  }

  try {
    // fail_existing must be the STRING "0" for the Razorpay API to return an
    // existing customer instead of throwing. The SDK types only allow
    // boolean|0|1, so widen through Customers.RazorpayCustomerBaseRequestBody.
    const params = {
      name,
      contact, // full 10-digit number; Razorpay prepends the country code
      fail_existing: "0",
      ...(email ? { email } : {}),
    } as unknown as Customers.RazorpayCustomerBaseRequestBody;
    const customer = await rzp.customers.create(params);
    logServer("rzp", `Customer resolved → ${customer.id}`, {
      detail: { contact, rzp_customer_id: customer.id, created: customer.created_at },
    });
    return { ok: true, rzpCustomerId: customer.id };
  } catch (e) {
    // Defensive: if a customer for this contact already exists and the create
    // call still errors (e.g. "Customer already exists for the merchant"),
    // look it up and reuse it instead of failing the checkout.
    const msg = errorMessage(e);
    if (/already exists/i.test(msg)) {
      // A customer for this contact already exists on Razorpay but wasn't
      // returned by the create call (defensive). Look it up by contact and
      // reuse it instead of failing the checkout.
      try {
        const list = (await rzp.customers.all({ count: 100 })) as unknown as {
          items?: { id: string; contact?: string | number }[];
        };
        const match = (list?.items ?? []).find(
          (c) => String(c.contact ?? "").replace(/[^\d]/g, "").slice(-10) === contact
        );
        if (match) {
          logServer("rzp", `Customer already existed — reused ${match.id}`, {
            level: "warn",
            detail: { contact, rzp_customer_id: match.id },
          });
          return { ok: true, rzpCustomerId: match.id };
        }
        logServer("rzp", "Customer already-exists error but no matching contact found in list", {
          level: "warn",
          detail: { contact, error: msg },
        });
      } catch (fetchErr) {
        logServer("rzp", "Customer reuse lookup also FAILED", {
          level: "error",
          detail: { contact, error: errorMessage(fetchErr) },
        });
      }
    }
    logServer("rzp", "Customer creation FAILED", {
      level: "error",
      detail: { contact, error: msg },
    });
    return {
      ok: false,
      error: msg,
      razorpay_error: (e as RzpError)?.error ?? null,
    };
  }
}

export interface TokenInfo {
  tokenId: string;
  status?: string;
  maxAmount?: number;
  amountBlocked?: number;
  amountDebited?: number;
  expiredAt?: number;
  usedAt?: number;
  vpa?: string;
}

type RawRzpToken = Tokens.RazorpayToken & {
  recurring_details?: {
    status?: string;
    amount_blocked?: number;
    amount_debited?: number;
  };
};

/**
 * Fetch the customer's saved tokens (GET /v1/customers/:id/tokens). Requires
 * the save_vpa feature to be enabled on the account, otherwise returns an
 * empty list. Only UPI Reserve Pay tokens (method "upi", recurring true) are
 * returned.
 */
export async function fetchCustomerTokens(
  rzpCustomerId: string
): Promise<{ ok: boolean; tokens: TokenInfo[]; error?: string }> {
  const rzp = getRzpClient();
  try {
    const res = (await rzp.customers.fetchTokens(rzpCustomerId)) as {
      entity?: string;
      count?: number;
      items?: RawRzpToken[];
    };
    const tokens: TokenInfo[] = (res?.items ?? [])
      .filter((t) => t.method === "upi")
      .map((token) => ({
        tokenId: token.id,
        status: token.recurring_details?.status ?? token.status,
        maxAmount: token.max_amount,
        amountBlocked: token.recurring_details?.amount_blocked,
        amountDebited: token.recurring_details?.amount_debited,
        expiredAt: token.expired_at,
        usedAt: token.used_at,
        vpa: typeof token.vpa === "object" && token.vpa ? token.vpa.username ?? undefined : undefined,
      }));
    logServer("rzp", `Fetched ${tokens.length} UPI token(s) for ${rzpCustomerId}`, {
      detail: { rzp_customer_id: rzpCustomerId, tokens: tokens.map((t) => ({ token_id: t.tokenId, status: t.status })) },
    });
    return { ok: true, tokens };
  } catch (e) {
    logServer("rzp", `Fetch tokens FAILED for ${rzpCustomerId}`, {
      level: "warn",
      detail: { rzp_customer_id: rzpCustomerId, error: errorMessage(e) },
    });
    return { ok: false, error: errorMessage(e), tokens: [] };
  }
}

export interface AuthOrderInput {
  rzpCustomerId: string;
  blockPaise: number;
  receipt?: string;
}

export interface AuthOrderResult {
  ok: boolean;
  orderId?: string;
  expireAt?: number;
  blockPaise?: number;
  error?: string;
  razorpay_error?: unknown;
}

/** Step 1.2 — create the authorisation order that registers the mandate. */
export async function createAuthorisationOrder(
  input: AuthOrderInput
): Promise<AuthOrderResult> {
  const rzp = getRzpClient();
  const block = Math.min(blockForAmount(input.blockPaise), MAX_BLOCK_PAISE);
  const expireAt = defaultExpireAt();

  const token = {
    max_amount: block,
    expire_at: expireAt,
    frequency: "as_presented",
    type: "single_block_multiple_debit",
  } as Tokens.RazorpayTokenCard;

  try {
    const params: Orders.RazorpayAuthorizationCreateRequestBody = {
      amount: AUTH_ORDER_AMOUNT_PAISE,
      currency: "INR",
      customer_id: input.rzpCustomerId,
      method: "upi",
      token,
      receipt: input.receipt,
      notes: {
        purpose: "upi_reserve_pay_mandate",
      },
    };
    const order = (await rzp.orders.create(params)) as Orders.RazorpayOrder;
    logServer("rzp", `Authorisation order ${order.id} created`, {
      detail: {
        rzp_customer_id: input.rzpCustomerId,
        order_id: order.id,
        token_type: "single_block_multiple_debit",
        max_amount: block,
        expire_at: expireAt,
      },
    });
    return { ok: true, orderId: order.id, expireAt, blockPaise: block };
  } catch (e) {
    logServer("rzp", "Authorisation order creation FAILED", {
      level: "error",
      detail: {
        rzp_customer_id: input.rzpCustomerId,
        error: errorMessage(e),
        code: (e as RzpError)?.error?.code ?? null,
      },
    });
    return { ok: false, error: errorMessage(e), razorpay_error: (e as RzpError)?.error ?? null };
  }
}

export interface ChargeOrderInput {
  amountPaise: number;
  rzpOrderId?: never; // symmetry marker: charge orders always get fresh rzp ids
  receipt?: string;
  notes?: Record<string, string | number>;
}

export interface ChargeOrderResult {
  ok: boolean;
  orderId?: string;
  amountPaise?: number;
  error?: string;
  razorpay_error?: unknown;
}

/** Step 3.1 — create the charge order WITHOUT the notification object, so the
 *  debit can be executed immediately (no 25-hour pre-debit hold). */
export async function createChargeOrder(input: ChargeOrderInput): Promise<ChargeOrderResult> {
  const rzp = getRzpClient();
  try {
    const params: Orders.RazorpayOrderCreateRequestBody = {
      amount: input.amountPaise,
      currency: "INR",
      ...(input.receipt ? { receipt: input.receipt } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    };
    const order = (await rzp.orders.create(params)) as Orders.RazorpayOrder;
    logServer("rzp", `Charge order ${order.id} created (no notification → immediate debit)`, {
      detail: { order_id: order.id, amount_paise: input.amountPaise },
    });
    return { ok: true, orderId: order.id, amountPaise: Number(order.amount) };
  } catch (e) {
    logServer("rzp", "Charge order creation FAILED", {
      level: "error",
      detail: { amount_paise: input.amountPaise, error: errorMessage(e) },
    });
    return { ok: false, error: errorMessage(e), razorpay_error: (e as RzpError)?.error ?? null };
  }
}

export interface DebitResult {
  ok: boolean;
  status: "captured" | "failed" | "token_consumed";
  paymentId?: string;
  orderId?: string;
  error?: string;
  /** true when Razorpay says the token is gone (cancelled) — caller should
   *  mark the local mandate cancelled and re-authorise. */
  tokenCancelled?: boolean;
  razorpay_error?: unknown;
}

export interface DebitInput {
  rzpOrderId: string;
  rzpCustomerId: string;
  tokenId: string;
  amountPaise: number;
  email?: string | null;
  contact: string;
  name?: string;
  description?: string;
}

/** Step 3.2 — execute the debit against a token. Treats "token already used /
 *  cancelled" style errors as token_consumed so the caller can re-authorise. */
export async function debitToken(input: DebitInput): Promise<DebitResult> {
  const rzp = getRzpClient();
  const description =
    input.description ??
    (input.name ? `AgentStore payment for ${input.name}` : "AgentStore payment");
  try {
    const result = (await rzp.payments.createRecurringPayment({
      email: input.email ?? "",
      contact: input.contact,
      amount: input.amountPaise,
      currency: "INR",
      order_id: input.rzpOrderId,
      customer_id: input.rzpCustomerId,
      token: input.tokenId,
      recurring: true,
      description,
      notes: { source: "agentstore" },
    })) as {
      razorpay_payment_id?: string;
      razorpay_order_id?: string;
      razorpay_signature?: string;
    };
    const paymentId = result.razorpay_payment_id;
    logServer("rzp", `Recurring debit succeeded for order ${input.rzpOrderId}`, {
      detail: {
        order_id: input.rzpOrderId,
        payment_id: paymentId,
        amount_paise: input.amountPaise,
        token_id: `${input.tokenId.slice(0, 8)}…`,
      },
    });
    return {
      ok: true,
      status: "captured",
      paymentId: paymentId ?? undefined,
      orderId: result.razorpay_order_id ?? input.rzpOrderId,
    };
  } catch (e) {
    const reason = errorReason(e) ?? (e as RzpError)?.error?.code;
    const msg = errorMessage(e);
    logServer("rzp", `Recurring debit FAILED for order ${input.rzpOrderId}`, {
      level: "error",
      detail: {
        order_id: input.rzpOrderId,
        amount_paise: input.amountPaise,
        error: msg,
        reason: reason ?? null,
      },
    });
    const tokenConsumed =
      /token.*(cancel|used|invalid|expire|not found|already)/i.test(`${reason ?? ""} ${msg}`) ||
      reason === "token_cancelled" ||
      msg.includes("already been used");
    return {
      ok: false,
      status: tokenConsumed ? "token_consumed" : "failed",
      tokenCancelled: tokenConsumed,
      error: msg,
      razorpay_error: (e as RzpError)?.error ?? null,
    };
  }
}

export interface FetchPaymentResult {
  ok: boolean;
  payment?: {
    id: string;
    tokenId: string | null;
    customerId: string | null;
    status?: string;
    vpa?: string;
    orderId?: string;
  };
  error?: string;
  razorpay_error?: unknown;
}

/** Step 2 — fetch a payment to extract the mandate token_id after checkout. */
export async function fetchPayment(paymentId: string): Promise<FetchPaymentResult> {
  const rzp = getRzpClient();
  try {
    const payment = (await rzp.payments.fetch(paymentId)) as Payments.RazorpayPayment & {
      token_id?: string | null;
      customer_id?: string | null;
      vpa?: string | null;
    };
    logServer("rzp", `Fetched payment ${payment.id}`, {
      detail: {
        payment_id: payment.id,
        status: payment.status,
        order_id: payment.order_id ?? null,
        has_token: Boolean(payment.token_id),
      },
    });
    return {
      ok: true,
      payment: {
        id: payment.id,
        tokenId: payment.token_id ?? null,
        customerId: payment.customer_id ?? null,
        status: payment.status,
        vpa: payment.vpa ?? undefined,
        orderId: payment.order_id ?? undefined,
      },
    };
  } catch (e) {
    logServer("rzp", `Fetch payment ${paymentId} FAILED`, {
      level: "error",
      detail: { payment_id: paymentId, error: errorMessage(e) },
    });
    return { ok: false, error: errorMessage(e), razorpay_error: (e as RzpError)?.error ?? null };
  }
}

export function verifySignature(payload: string, signature: string): boolean {
  try {
    Razorpay.validateWebhookSignature(payload, signature, rzpConfig().keySecret);
    return true;
  } catch {
    return false;
  }
}
