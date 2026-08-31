import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { markOrderFailed, markOrderPaid } from "@/lib/db";

export const runtime = "nodejs";

const SUCCESS = { ok: true };

/**
 * POST /api/webhook/razorpay
 * Verifies the Razorpay signature (HMAC-SHA256 over the raw body) using
 * RAZORPAY_WEBHOOK_SECRET, then reconciles order status. Handles both Standard
 * Checkout events (order.paid / order.failed) and Payment Link events
 * (payment_link.paid / cancelled / expired / failed). The entity id (order id
 * or payment link id) is the same string stored on the local order, so the
 * same markOrderPaid/markOrderFailed lookups work for both.
 * Returns 200 quickly — the order page polls /api/orders/:id for status.
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

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const eventName = event.event as string;

  // Standard Checkout events carry the order entity; Payment Link events carry
  // the payment_link entity. Both expose the id we store on the local order.
  const entity = event.payload?.order?.entity ?? event.payload?.payment_link?.entity;
  const entityId = entity?.id as string | undefined;
  const amountPaise = entity?.amount as number | undefined;

  if (entityId) {
    if (eventName === "payment_link.paid" || eventName === "order.paid") {
      const n = markOrderPaid(entityId);
      console.log(
        `[webhook] ${eventName} for ${entityId}`,
        `amount=${amountPaise ?? "?"}`,
        n > 0 ? `(order updated)` : `(NO matching order for ${eventName}!)`
      );
    } else if (
      eventName === "payment_link.cancelled" ||
      eventName === "payment_link.expired" ||
      eventName === "payment_link.failed" ||
      eventName === "order.failed" ||
      eventName === "order.cancelled" ||
      eventName === "order.expired"
    ) {
      const n = markOrderFailed(entityId);
      console.log(
        `[webhook] ${eventName} for ${entityId}`,
        n > 0 ? `(order updated)` : `(NO matching order for ${eventName}!)`
      );
    } else {
      console.log(`[webhook] unhandled event ${eventName} for ${entityId}`);
    }
  } else {
    console.log(`[webhook] no order/payment_link entity for event ${eventName}`);
  }

  // Always acknowledge quickly; the UI reads status from the orders table.
  return NextResponse.json(SUCCESS);
}
