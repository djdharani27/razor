import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getOrder, markOrderPaid } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/verify
 * Body: { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }
 *
 * Reconciles a Standard Checkout payment: recomputes the HMAC-SHA256 signature
 * over `razorpayOrderId|razorpayPaymentId` with RAZORPAY_KEY_SECRET and, if it
 * matches, marks the local order paid.
 */
export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Razorpay is not configured — set RAZORPAY_KEY_SECRET in .env.local." },
      { status: 500 }
    );
  }

  let body: {
    orderId?: number | string;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const localOrderId = Number(body.orderId);
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;
  if (
    !Number.isInteger(localOrderId) ||
    localOrderId <= 0 ||
    !razorpayOrderId ||
    !razorpayPaymentId ||
    !razorpaySignature
  ) {
    return NextResponse.json({ error: "Missing payment details." }, { status: 400 });
  }

  // The signature covers exactly "razorpayOrderId|razorpayPaymentId".
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(razorpaySignature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.warn(
      `[verify] signature mismatch for local order ${localOrderId} (razorpay order ${razorpayOrderId})`
    );
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Make sure the razorpay order id belongs to the local order before marking paid.
  const order = getOrder(localOrderId) as
    | { id: number; razorpay_payment_link_id: string; status: string }
    | undefined;
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.razorpay_payment_link_id !== razorpayOrderId) {
    console.warn(
      `[verify] razorpay order ${razorpayOrderId} does not match local order ${localOrderId}`
    );
    return NextResponse.json(
      { error: "Razorpay order id does not match this order." },
      { status: 400 }
    );
  }

  markOrderPaid(razorpayOrderId);
  console.log(
    `[verify] payment verified for local order ${localOrderId} (razorpay order ${razorpayOrderId}, payment ${razorpayPaymentId})`
  );

  return NextResponse.json({ ok: true, orderId: localOrderId, paymentId: razorpayPaymentId });
}
