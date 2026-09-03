// Shared server-side payment orchestration for the UPI Reserve Pay flow.
// Both the storefront (/api/checkout) and the agent tools call this same
// logic, so a customer gets one consistent experience:
//   - resolve/create the Razorpay customer from the local identity
//   - look for a reusable mandate (live token check)
//   - reusable  → create charge order (no notification) and debit immediately
//   - not usable → create the authorisation order and hand back a checkout
//                  payload the client opens in the recurring modal

import { logServer } from "@/lib/agent/server-log";
import {
  blockForAmount,
  createAuthorisationOrder,
  createChargeOrder,
  debitToken,
  ensureRzpCustomer,
  fetchCustomerTokens,
  isRzpConfigured,
  type CustomerIdentity,
} from "@/lib/rzp";
import {
  debitMandate,
  expireStaleMandates,
  failOpenOrdersForMandate,
  getActiveMandate,
  getCustomerByContact,
  getMandateById,
  getMandateByTokenId,
  insertChargeOrder,
  insertMandate,
  mandateHasRoom,
  markMandateCancelled,
  recordPaymentForOrder,
  updateOrderStatus,
  upsertCustomer,
  type OrderKind,
} from "@/lib/db";
import type { CartItem, MandateRow } from "@/lib/types";

export const MAX_BLOCK_PAISE = 1_000_000;

export interface PaymentContextInput extends CustomerIdentity {
  /** The order we're trying to fulfil (used for the immediate-debit branch). */
  amountPaise: number;
  items: CartItem[];
  orderKind: OrderKind;
  receipt?: string;
  description?: string;
  notes?: Record<string, string | number>;
}

export interface AuthorisationPayload {
  orderId: string;
  customerId: string;
  keyId: string;
  blockPaise: number;
  expireAt: number;
  amountPaise: number;
}

export type PaymentResolution =
  | { status: "needs_authorisation"; payload: AuthorisationPayload }
  | { status: "debit_created"; debit: DebitOutcome }
  | { status: "error"; error: string; code?: string };

export interface DebitOutcome {
  localOrderId: number;
  rzpOrderId: string;
  paymentId?: string;
  amountPaise: number;
}

/** Resolve a mandate from the DB, then sanity-check it live against Razorpay's
 *  token list. Live check is best-effort: if the tokens endpoint errors (or the
 *  save_vpa feature is disabled), we still trust our local ledger. */
async function resolveUsableMandate(opts: {
  localCustomerId: number;
  rzpCustomerId: string;
  amountPaise: number;
  /** Route/tool this resolution came from, e.g. "/api/checkout". */
  endpoint?: string;
}): Promise<{ usable: MandateRow | undefined; remoteDeadToken: string | null }> {
  expireStaleMandates();
  const local = getActiveMandate(opts.localCustomerId);
  let remoteDeadToken: string | null = null;
  if (!local) return { usable: undefined, remoteDeadToken: null };

  const live = await fetchCustomerTokens(opts.rzpCustomerId, opts.endpoint);
  if (live.ok) {
    const remote = live.tokens.find((t) => t.tokenId === local.token_id);
    if (!remote) {
      // Our stored token no longer exists on Razorpay's side → dead.
      markMandateCancelled(local.token_id, "cancelled");
      failOpenOrdersForMandate(local.id);
      logServer("payment", `Mandate #${local.id} gone from Razorpay — cancelled locally`, {
        level: "warn",
        detail: { token_id: `${local.token_id.slice(0, 8)}…`, customer_id: opts.localCustomerId },
        ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      });
      return { usable: undefined, remoteDeadToken: local.token_id };
    }
    const status = remote.status ?? "confirmed";
    if (status !== "confirmed") {
      markMandateCancelled(local.token_id, "cancelled");
      failOpenOrdersForMandate(local.id);
      logServer("payment", `Mandate #${local.id} no longer confirmed (${status}) — cancelled locally`, {
        level: "warn",
        detail: { token_id: `${local.token_id.slice(0, 8)}…` },
        ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      });
      return { usable: undefined, remoteDeadToken: local.token_id };
    }
    // Prefer live block/debit numbers for the headroom check.
    if (typeof remote.amountBlocked === "number" && typeof remote.amountDebited === "number") {
      const remaining = Math.max(0, remote.amountBlocked - remote.amountDebited);
      if (opts.amountPaise > remaining) {
        logServer("payment", `Mandate #${local.id} exhausted remotely (${remaining} paise left) — needs re-authorisation`, {
          level: "warn",
          detail: { amount_paise: opts.amountPaise, remaining_paise: remaining },
          ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
        });
        markMandateCancelled(local.token_id, "used");
        failOpenOrdersForMandate(local.id);
        return { usable: undefined, remoteDeadToken: null };
      }
    }
  }

  if (!mandateHasRoom(local, opts.amountPaise)) {
    markMandateCancelled(local.token_id, "used");
    failOpenOrdersForMandate(local.id);
    return { usable: undefined, remoteDeadToken: null };
  }

  return { usable: local, remoteDeadToken: null };
}

/** Persist a captured mandate discovered after the checkout modal. */
export function persistMandate(input: {
  localCustomerId: number;
  rzpCustomerId: string;
  tokenId: string;
  authOrderId: string;
  authPaymentId?: string | null;
  fallbackBlockPaise: number;
  fallbackExpireAt: number;
  /** Route this mandate came from, e.g. "/api/rzp/authorise/confirm". */
  endpoint?: string;
}): { mandateId: number; blockPaise: number; expireAt: number } {
  const blockPaise = input.fallbackBlockPaise;
  const expireAt = input.fallbackExpireAt;
  const existing = getMandateByTokenId(input.tokenId);
  if (existing) {
    logServer("payment", `Mandate ${input.tokenId.slice(0, 8)}… already stored — keeping it`, {
      level: "warn",
      detail: { mandate_id: existing.id, customer_id: input.localCustomerId },
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    });
    return { mandateId: existing.id, blockPaise, expireAt };
  }
  const mandateId = insertMandate({
    customerId: input.localCustomerId,
    tokenId: input.tokenId,
    authOrderId: input.authOrderId,
    authPaymentId: input.authPaymentId,
    maxAmountPaise: blockPaise,
    expireAt,
  });
  logServer("payment", `Mandate stored (#${mandateId})`, {
    detail: {
      mandate_id: mandateId,
      customer_id: input.localCustomerId,
      token_id: `${input.tokenId.slice(0, 8)}…`,
      block_paise: blockPaise,
      expire_at: expireAt,
    },
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
  });
  return { mandateId, blockPaise, expireAt };
}

/** After the mandate is confirmed, run the debit that was waiting on it
 *  (steps 3.1 → 3.2). Mirrors executePayment but always with a fresh usable
 *  mandate. */
async function completePendingDebit(opts: {
  rzpCustomerId: string;
  localCustomerId: number;
  tokenId: string;
  mandateId: number;
  amountPaise: number;
  items: CartItem[];
  email?: string | null;
  contact: string;
  name: string;
  orderKind: OrderKind;
  receipt?: string;
  description?: string;
  /** Route/tool this debit came from, e.g. "pay_cart_now". */
  endpoint?: string;
}): Promise<DebitOutcome> {
  const charge = await createChargeOrder({
    amountPaise: opts.amountPaise,
    receipt: opts.receipt,
    notes: { source: "agentstore", items: opts.items.map((i) => `${i.qty}x${i.productId}`).join(",") },
    endpoint: opts.endpoint,
  });
  if (!charge.ok || !charge.orderId) {
    throw new Error(charge.error ?? "Failed to create charge order after authorisation.");
  }
  const localOrderId = insertChargeOrder({
    rzpOrderId: charge.orderId,
    amount_paise: opts.amountPaise,
    items: opts.items,
    kind: opts.orderKind,
    customerId: opts.localCustomerId,
    mandateId: opts.mandateId,
  });
  const debit = await debitToken({
    rzpOrderId: charge.orderId,
    rzpCustomerId: opts.rzpCustomerId,
    tokenId: opts.tokenId,
    amountPaise: opts.amountPaise,
    email: opts.email,
    contact: opts.contact,
    name: opts.name,
    description: opts.description,
    endpoint: opts.endpoint,
  });
  if (debit.status === "captured" && debit.paymentId) {
    debitMandate(opts.mandateId, opts.amountPaise);
    recordPaymentForOrder(localOrderId, debit.paymentId);
    return { localOrderId, rzpOrderId: charge.orderId, paymentId: debit.paymentId, amountPaise: opts.amountPaise };
  }
  // Debit failed or token consumed — flip the order to failed and surface.
  updateOrderStatus(localOrderId, "failed");
  throw new Error(debit.error ?? "Debit failed after authorisation.");
}

/** Upsert a local customer + resolve their Razorpay customer, persisting the
 *  Razorpay id back onto the local row. */
async function ensureCustomer(input: CustomerIdentity & { endpoint?: string }) {
  const local = upsertCustomer({
    contact: input.contact,
    name: input.name,
    email: input.email ?? null,
  });
  const rzp = await ensureRzpCustomer({
    name: input.name,
    contact: input.contact,
    email: input.email ?? null,
    existingRzpCustomerId: local.rzp_customer_id,
    endpoint: input.endpoint,
  });
  if (!rzp.ok || !rzp.rzpCustomerId) {
    throw new Error(rzp.error ?? "Could not resolve the Razorpay customer.");
  }
  if (local.rzp_customer_id !== rzp.rzpCustomerId) {
    upsertCustomer({ contact: input.contact, name: input.name, email: input.email ?? null, rzpCustomerId: rzp.rzpCustomerId });
  }
  return { localCustomer: local, rzpCustomerId: rzp.rzpCustomerId };
}

export interface ExecutePaymentOptions extends PaymentContextInput {
  /** Set when we already know the mandate (e.g. after authorisation confirm) —
   *  skips the reusable-token lookup and debits straight away. */
  knownMandateId?: number;
  /** Route/tool this payment came from, e.g. "/api/checkout" or "pay_cart_now". */
  endpoint?: string;
}

/** Core decision + execution for a payment. The flow steps mirror README /
 *  lib/upi-sbmd: 1.1 resolve customer → 2.x look up a reusable mandate →
 *  reusable (3.1 charge order + 3.2 debit) OR authorisation required
 *  (1.2 authorisation order → 1.3 checkout approval).
 */
export async function executePayment(input: ExecutePaymentOptions): Promise<PaymentResolution> {
  if (!isRzpConfigured()) {
    return {
      status: "error",
      error: "Razorpay is not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.local.",
      code: "RZP_NOT_CONFIGURED",
    };
  }

  if (input.amountPaise > MAX_BLOCK_PAISE) {
    return {
      status: "error",
      error: `Order total ₹${(input.amountPaise / 100).toFixed(2)} exceeds the UPI Reserve Pay block limit of ₹10,000.`,
      code: "BLOCK_LIMIT_EXCEEDED",
    };
  }

  const { rzpCustomerId } = await ensureCustomer({ ...input, endpoint: input.endpoint });
  const localCustomerId = getCustomerByContact(input.contact)?.id ?? 0;

  // Fast path: a known mandate (post-authorisation) — debit it.
  if (input.knownMandateId) {
    const mandate = getMandateById(input.knownMandateId);
    if (!mandate || !mandateHasRoom(mandate, input.amountPaise)) {
      return {
        status: "needs_authorisation",
        payload: await buildAuthorisationPayload({
          rzpCustomerId,
          localCustomerId,
          amountPaise: input.amountPaise,
          keyId: process.env.RAZORPAY_KEY_ID ?? "",
          endpoint: input.endpoint,
        }),
      };
    }
    try {
      const outcome = await completePendingDebit({
        rzpCustomerId,
        localCustomerId,
        tokenId: mandate.token_id,
        mandateId: mandate.id,
        amountPaise: input.amountPaise,
        items: input.items,
        email: input.email,
        contact: input.contact,
        name: input.name,
        orderKind: input.orderKind,
        receipt: input.receipt,
        description: input.description,
        endpoint: input.endpoint,
      });
      return { status: "debit_created", debit: outcome };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Debit failed.";
      logServer("payment", `Debit for known mandate failed — ${msg}`, {
        level: "error",
        step: "3.2",
        rzpEndpoint: "/v1/payments/create/recurring",
        ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      });
      return { status: "error", error: msg };
    }
  }

  // Standard path: resolve a usable mandate, else re-authorise.
  const mandateResolution = await resolveUsableMandate({
    localCustomerId,
    rzpCustomerId,
    amountPaise: input.amountPaise,
    endpoint: input.endpoint,
  });

  if (mandateResolution.usable) {
    const mandate = mandateResolution.usable;
    const charge = await createChargeOrder({
      amountPaise: input.amountPaise,
      receipt: input.receipt,
      notes: input.notes ?? { source: "agentstore" },
      endpoint: input.endpoint,
    });
    if (!charge.ok || !charge.orderId) {
      return { status: "error", error: charge.error ?? "Failed to create charge order.", code: "CHARGE_ORDER_FAILED" };
    }
    const localOrderId = insertChargeOrder({
      rzpOrderId: charge.orderId,
      amount_paise: input.amountPaise,
      items: input.items,
      kind: input.orderKind,
      customerId: localCustomerId,
      mandateId: mandate.id,
    });
    const debit = await debitToken({
      rzpOrderId: charge.orderId,
      rzpCustomerId,
      tokenId: mandate.token_id,
      amountPaise: input.amountPaise,
      email: input.email,
      contact: input.contact,
      name: input.name,
      description: input.description,
      endpoint: input.endpoint,
    });
    if (debit.status === "captured") {
      if (debit.paymentId) {
        debitMandate(mandate.id, input.amountPaise);
        recordPaymentForOrder(localOrderId, debit.paymentId);
      } else {
        // No payment id came back (defensive) — webhook will reconcile.
        logServer("payment", `Debit captured but no payment id returned for order ${charge.orderId}`, {
          level: "warn",
          detail: { local_order_id: localOrderId },
          step: "3.2",
          rzpEndpoint: "/v1/payments/create/recurring",
          ...(input.endpoint ? { endpoint: input.endpoint } : {}),
        });
      }
      return {
        status: "debit_created",
        debit: { localOrderId, rzpOrderId: charge.orderId, paymentId: debit.paymentId, amountPaise: input.amountPaise },
      };
    }
    if (debit.tokenCancelled) {
      markMandateCancelled(mandate.token_id, "cancelled");
      failOpenOrdersForMandate(mandate.id);
      updateOrderStatus(localOrderId, "failed");
      // Fall through to a fresh authorisation.
      const payload = await buildAuthorisationPayload({
        rzpCustomerId,
        localCustomerId,
        amountPaise: input.amountPaise,
        keyId: process.env.RAZORPAY_KEY_ID ?? "",
        endpoint: input.endpoint,
      });
      return { status: "needs_authorisation", payload };
    }
    updateOrderStatus(localOrderId, "failed");
    return {
      status: "error",
      error: debit.error ?? "Debit failed.",
      code: "DEBIT_FAILED",
    };
  }

  const payload = await buildAuthorisationPayload({
    rzpCustomerId,
    localCustomerId,
    amountPaise: input.amountPaise,
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    endpoint: input.endpoint,
  });
  return { status: "needs_authorisation", payload };
}

/** Build the authorisation handoff (step 1.2 created the order server-side;
 *  step 1.3 happens client-side in the Razorpay Checkout modal). */
async function buildAuthorisationPayload(opts: {
  rzpCustomerId: string;
  localCustomerId: number;
  amountPaise: number;
  keyId: string;
  endpoint?: string;
}): Promise<AuthorisationPayload> {
  const auth = await createAuthorisationOrder({
    rzpCustomerId: opts.rzpCustomerId,
    blockPaise: blockForAmount(opts.amountPaise),
    receipt: `auth-${Date.now()}`,
    endpoint: opts.endpoint,
  });
  if (!auth.ok || !auth.orderId) {
    throw new Error(auth.error ?? "Failed to create authorisation order.");
  }
  return {
    orderId: auth.orderId,
    customerId: opts.rzpCustomerId,
    keyId: opts.keyId,
    blockPaise: auth.blockPaise ?? blockForAmount(opts.amountPaise),
    expireAt: auth.expireAt ?? 0,
    amountPaise: opts.amountPaise,
  };
}
