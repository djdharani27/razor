import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  createChargeOrder,
  debitToken,
  fetchPayment,
  isRzpConfigured,
} from "@/lib/rzp";
import {
  debitMandate,
  insertChargeOrder,
  markMandateCancelled,
  recordPaymentForOrder,
  updateOrderStatus,
  upsertCustomer,
} from "@/lib/db";
import type { CartItem } from "@/lib/types";
import { logServer } from "@/lib/agent/server-log";
import { persistMandate } from "@/lib/payments";
import { getSession, setCart } from "@/lib/agent/session";

export const runtime = "nodejs";

function normaliseContact(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

/**
 * POST /api/rzp/authorise/confirm
 * Body: {
 *   contact, name?, email?,
 *   razorpayOrderId, razorpayPaymentId, razorpaySignature?,
 *   blockPaise, expireAt,
 *   pendingDebit?: { items: CartItem[], amountPaise, description? } | null
 * }
 *
 * Called by the client after the recurring checkout modal closes. Captures the
 * mandate token (GET /v1/payments/:id), stores it against the customer, then —
 * when a pendingDebit was parked (agent flow) — executes the debit server-side
 * and returns the captured order id so the chat UI can show the result without
 * another Gemini round-trip.
 *
 * razorpaySignature is optional: a one-time UPI mandate "fails" the payment
 * with reason upi_dummy_payment, which Razorpay documents as a SUCCESSFUL
 * registration — in that case the modal supplies no signature and we accept
 * the payment id at face value.
 */
export async function POST(req: Request) {
  if (!isRzpConfigured()) {
    return NextResponse.json(
      { error: "Razorpay is not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.local." },
      { status: 500 }
    );
  }

  let body: {
    contact?: string;
    name?: string;
    email?: string | null;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
    blockPaise?: number | string;
    expireAt?: number | string;
    pendingDebit?: {
      items?: { productId: number | string; qty: number | string }[];
      amountPaise?: number | string;
      description?: string;
      receipt?: string;
    } | null;
    /** Agent session whose cart should be cleared once the debit succeeds. */
    sessionId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const contact = normaliseContact(String(body.contact ?? ""));
  const paymentId = String(body.razorpayPaymentId ?? "").trim();
  const orderId = String(body.razorpayOrderId ?? "").trim();
  const signature = body.razorpaySignature ? String(body.razorpaySignature).trim() : null;

  if (!contact || !paymentId || !orderId) {
    return NextResponse.json(
      { error: "contact, razorpayOrderId and razorpayPaymentId are required." },
      { status: 400 }
    );
  }

  // When a signature is present verify it; when absent, accept (upi_dummy_payment
  // success case). Never trust a signature that fails to verify.
  if (signature) {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: "Razorpay is not configured — set RAZORPAY_KEY_SECRET in .env.local." },
        { status: 500 }
      );
    }
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      logServer("authorise/confirm", "Authorisation signature mismatch", { level: "error", detail: { order_id: orderId } });
      return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
    }
  }

  // Fetch the payment to extract the mandate token_id (step 2 of the flow).
  const fetched = await fetchPayment(paymentId);
  if (!fetched.ok || !fetched.payment) {
    return NextResponse.json(
      { error: fetched.error ?? `Could not fetch payment ${paymentId}.` },
      { status: 502 }
    );
  }
  const tokenId = fetched.payment.tokenId;
  const rzpCustomerId = fetched.payment.customerId;
  if (!tokenId || !rzpCustomerId) {
    logServer("authorise/confirm", `Payment ${paymentId} carried no token_id`, {
      level: "error",
      detail: { order_id: orderId, payment_status: fetched.payment.status },
    });
    return NextResponse.json(
      { error: "The authorisation payment did not return a mandate token. Please try again." },
      { status: 422 }
    );
  }

  // Upsert the local customer and link the Razorpay customer id.
  const name = String(body.name ?? "").trim() || "Customer";
  const email = body.email ? String(body.email).trim() : null;
  const customer = upsertCustomer({ contact, name, email, rzpCustomerId });
  logServer("authorise/confirm", `Mandate token captured for customer #${customer.id}`, {
    detail: {
      customer_id: customer.id,
      rzp_customer_id: rzpCustomerId,
      token_id: `${tokenId.slice(0, 8)}…`,
      order_id: orderId,
      payment_id: paymentId,
      had_signature: Boolean(signature),
    },
  });

  // Store the mandate. Fall back to what the checkout handoff told us for the
  // block size / expiry when the live token list isn't available.
  const blockPaise = Math.round(Number(body.blockPaise ?? 0)) || 0;
  const expireAt = Math.round(Number(body.expireAt ?? 0)) || 0;
  const stored = persistMandate({
    localCustomerId: customer.id,
    rzpCustomerId,
    tokenId,
    authOrderId: orderId,
    authPaymentId: paymentId,
    fallbackBlockPaise: blockPaise,
    fallbackExpireAt: expireAt,
  });

  // If a debit is parked on this confirmation (agent flow), execute it now.
  const pending = body.pendingDebit;
  if (pending && pending.items?.length) {
    const amountPaise = Math.round(Number(pending.amountPaise ?? 0));
    const items: CartItem[] = pending.items.map((i) => ({
      productId: Number(i.productId),
      qty: Number(i.qty),
    }));
    if (amountPaise > 0 && items.every((i) => Number.isInteger(i.productId) && Number.isInteger(i.qty))) {
      const charge = await createChargeOrder({
        amountPaise,
        receipt: pending.receipt ?? `order-${Date.now()}`,
        notes: { source: "agentstore_agent", items: items.map((i) => `${i.qty}x${i.productId}`).join(",") },
      });
      if (!charge.ok || !charge.orderId) {
        return NextResponse.json(
          { error: charge.error ?? "Failed to create the charge order." },
          { status: 502 }
        );
      }
      const localOrderId = insertChargeOrder({
        rzpOrderId: charge.orderId,
        amount_paise: amountPaise,
        items,
        kind: "charge",
        customerId: customer.id,
        mandateId: stored.mandateId,
      });
      const debit = await debitToken({
        rzpOrderId: charge.orderId,
        rzpCustomerId,
        tokenId,
        amountPaise,
        email,
        contact,
        name,
        description: pending.description,
      });
      if (debit.status === "captured") {
        if (debit.paymentId) {
          debitMandate(stored.mandateId, amountPaise);
          recordPaymentForOrder(localOrderId, debit.paymentId);
        }
        // The agent flow clears its session cart once the parked debit lands.
        if (body.sessionId) {
          try {
            const session = getSession(body.sessionId);
            if (session) setCart(body.sessionId, []);
          } catch {
            // session clearing must never break the confirm response
          }
        }
        return NextResponse.json({
          ok: true,
          mandateStored: true,
          debit: {
            status: "captured",
            orderId: localOrderId,
            rzpOrderId: charge.orderId,
            paymentId: debit.paymentId ?? null,
            amountPaise,
          },
        });
      }
      if (debit.tokenCancelled) {
        markMandateCancelled(tokenId, "cancelled");
      }
      updateOrderStatus(localOrderId, "failed");
      return NextResponse.json(
        { ok: true, mandateStored: true, debit: { status: "failed", error: debit.error, orderId: localOrderId } },
        { status: 200 }
      );
    }
  }

  return NextResponse.json({ ok: true, mandateStored: true });
}
