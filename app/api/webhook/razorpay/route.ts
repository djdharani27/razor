import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import {
  failOpenOrdersForMandate,
  getOrderByRzpOrderId,
  getMandateByTokenId,
  markMandateCancelled,
  recordOrderPayment,
  recordPaymentForOrder,
  updateOrderStatus,
} from "@/lib/db";
import { logServer } from "@/lib/agent/server-log";

export const runtime = "nodejs";

const SUCCESS = { ok: true };

interface RazorpayEvent {
  event: string;
  payload?: {
    order?: { entity?: { id?: string } };
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        token_id?: string;
      };
    };
    token?: {
      entity?: {
        id?: string;
        customer_id?: string;
      };
    };
  };
}

/**
 * POST /api/webhook/razorpay
 * Verifies the Razorpay signature (HMAC-SHA256 over the raw body) using
 * RAZORPAY_WEBHOOK_SECRET, then reconciles orders and UPI Reserve Pay mandates:
 *
 *   payment.captured / order.paid  → mark the local order paid (+ payment id)
 *   payment.failed / order.failed / order.cancelled / order.expired
 *                                   → mark the local order failed
 *   token.cancelled / token.revoked / token.expired
 *                                   → mark the mandate cancelled and fail any
 *                                     created-but-unpaid orders that would have
 *                                     debited it
 *
 * The entity id (order id) is the string stored on the local order row. A
 * captured payment event carries the order_id, which also maps to a row.
 * Always returns 200 quickly — the order page polls /api/orders/:id.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";

  if (!secret) {
    return NextResponse.json({ error: "RAZORPAY_WEBHOOK_SECRET is not set." }, { status: 500 });
  }

  try {
    Razorpay.validateWebhookSignature(rawBody, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const eventName = event.event;

  logServer("webhook", `Received event: ${eventName}`, {
    level: eventName.includes("paid") || eventName.includes("captured") ? "info" : "warn",
    detail: {
      order_id: event.payload?.order?.entity?.id ?? event.payload?.payment?.entity?.order_id ?? null,
      payment_id: event.payload?.payment?.entity?.id ?? null,
      token_id: event.payload?.token?.entity?.id ?? event.payload?.payment?.entity?.token_id ?? null,
    },
  });

  // ---- token lifecycle events (UPI Reserve Pay mandates) ----
  if (eventName.startsWith("token.")) {
    const tokenId =
      event.payload?.token?.entity?.id ?? event.payload?.payment?.entity?.token_id ?? null;
    if (!tokenId) {
      logServer("webhook", `No token_id in ${eventName} payload`, { level: "warn" });
      return NextResponse.json(SUCCESS);
    }
    const mandate = getMandateByTokenId(tokenId);
    if (!mandate) {
      logServer("webhook", `${eventName} for unknown token ${tokenId.slice(0, 8)}… (no local mandate)`, {
        level: "warn",
      });
      return NextResponse.json(SUCCESS);
    }
    if (eventName === "token.cancelled" || eventName === "token.revoked" || eventName === "token.expired") {
      markMandateCancelled(tokenId, eventName === "token.expired" ? "expired" : "cancelled");
      failOpenOrdersForMandate(mandate.id);
      logServer("webhook", `${eventName} → mandate #${mandate.id} closed locally`, {
        level: "warn",
        detail: { token_id: `${tokenId.slice(0, 8)}…`, mandate_id: mandate.id },
      });
    } else {
      logServer("webhook", `Unhandled token event ${eventName}`, { level: "warn" });
    }
    return NextResponse.json(SUCCESS);
  }

  // ---- order / payment events ----
  const orderId =
    event.payload?.order?.entity?.id ?? event.payload?.payment?.entity?.order_id ?? null;
  const paymentId = event.payload?.payment?.entity?.id ?? null;
  const paymentTokenId = event.payload?.payment?.entity?.token_id ?? null;

  const okEvents = ["payment.captured", "order.paid"];
  const failEvents = [
    "payment.failed",
    "order.failed",
    "order.cancelled",
    "order.expired",
    "payment.cancelled",
  ];

  if (orderId) {
    const row = getOrderByRzpOrderId(orderId);
    if (!row) {
      logServer("webhook", `${eventName} for ${orderId} — no matching local order`, { level: "warn" });
      return NextResponse.json(SUCCESS);
    }

    if (okEvents.includes(eventName)) {
      if (paymentId) recordOrderPayment(orderId, paymentId);
      else updateOrderStatus(row.id, "paid");
      if (paymentTokenId) {
        const mandate = getMandateByTokenId(paymentTokenId);
        if (mandate) markMandateCancelled(paymentTokenId, "used");
      }
      logServer("webhook", `${eventName} → order #${row.id} paid`, {
        detail: { order_id: orderId, payment_id: paymentId ?? null },
      });
    } else if (failEvents.includes(eventName)) {
      updateOrderStatus(row.id, "failed");
      logServer("webhook", `${eventName} → order #${row.id} failed`, { level: "warn", detail: { order_id: orderId } });
    } else {
      logServer("webhook", `Unhandled event ${eventName} for order ${orderId}`, { level: "warn" });
    }
  } else {
    logServer("webhook", `No order/payment/token entity for event ${eventName}`, { level: "warn" });
  }

  // Always acknowledge quickly; the UI reads status from the orders table.
  return NextResponse.json(SUCCESS);
}
