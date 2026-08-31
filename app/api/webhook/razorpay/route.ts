import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { markOrderFailed, markOrderPaid } from "@/lib/db";

export const runtime = "nodejs";

const SUCCESS = { ok: true };

/**
 * POST /api/webhook/razorpay
 * Verifies the Razorpay signature (HMAC-SHA256 over the raw body) using
 * RAZORPAY_WEBHOOK_SECRET, then reconciles order status from payment_link events.
 * Returns 200 quickly — the payment link UI polls /api/orders/:id for status.
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
  const paymentLinkId = event.payload?.payment_link?.entity?.id as string | undefined;
  const amountPaise = event.payload?.payment_link?.entity?.amount as number | undefined;

  if (paymentLinkId) {
    if (eventName === "payment_link.paid") {
      markOrderPaid(paymentLinkId);
      console.log(
        `[webhook] payment_link.paid for ${paymentLinkId}`,
        amountPaise !== undefined ? `amount=${amountPaise}` : ""
      );
    } else if (
      eventName === "payment_link.cancelled" ||
      eventName === "payment_link.expired" ||
      eventName === "payment_link.failed"
    ) {
      markOrderFailed(paymentLinkId);
      console.log(`[webhook] ${eventName} for ${paymentLinkId}`);
    } else {
      console.log(`[webhook] unhandled event ${eventName} for ${paymentLinkId}`);
    }
  } else {
    console.log(`[webhook] no payment_link entity for event ${eventName}`);
  }

  // Always acknowledge quickly; the UI reads status from the orders table.
  return NextResponse.json(SUCCESS);
}
