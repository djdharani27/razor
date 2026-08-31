import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import type { PaymentLinks } from "razorpay/dist/types/paymentLink";
import { getAllProducts, insertOrder } from "@/lib/db";
import type { CartItem } from "@/lib/types";

export const runtime = "nodejs";

const SPEND_CAP_PAISE = Number(process.env.SPEND_CAP_PAISE ?? 500000);

interface CheckoutItem {
  productId: number | string;
  qty: number | string;
}

/**
 * POST /api/checkout
 * Body: { items: [{ productId, qty }] }
 *
 * Validates stock and computes the total server-side (client prices are never
 * trusted). Rejects orders above SPEND_CAP_PAISE with a structured JSON error,
 * creates a Razorpay Payment Link, records the order as "created" and returns
 * { orderId, paymentLinkUrl }.
 */
export async function POST(req: Request) {
  let body: { items?: CheckoutItem[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { error: "Cart is empty — add at least one item before checking out." },
      { status: 400 }
    );
  }

  // Normalise and validate the incoming items.
  const requested: CartItem[] = [];
  for (const raw of body.items) {
    const productId = Number(raw?.productId);
    const qty = Number(raw?.qty);
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json(
        { error: `Invalid productId "${raw?.productId}".` },
        { status: 400 }
      );
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return NextResponse.json(
        { error: `Invalid qty "${raw?.qty}" for product ${productId}.` },
        { status: 400 }
      );
    }
    requested.push({ productId, qty });
  }

  // Server-side price lookup + stock validation. Never trust client prices.
  const products = getAllProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const items: CartItem[] = [];
  let totalPaise = 0;

  for (const { productId, qty } of requested) {
    const product = byId.get(productId);
    if (!product) {
      return NextResponse.json(
        { error: `Product ${productId} does not exist.` },
        { status: 400 }
      );
    }
    if (qty > product.stock) {
      return NextResponse.json(
        {
          error: `Not enough stock for "${product.name}" (requested ${qty}, only ${product.stock} available).`,
          productId,
          requested: qty,
          available: product.stock,
        },
        { status: 409 }
      );
    }
    items.push({ productId, qty });
    totalPaise += product.price_paise * qty;
  }

  // Spend-cap guard: graceful, structured rejection, not a crash.
  if (totalPaise > SPEND_CAP_PAISE) {
    return NextResponse.json(
      {
        error: `Order total ₹${(totalPaise / 100).toFixed(2)} exceeds the spend cap of ₹${(SPEND_CAP_PAISE / 100).toFixed(2)} (SPEND_CAP_PAISE). Remove some items or split the order.`,
        code: "SPEND_CAP_EXCEEDED",
        totalPaise,
        spendCapPaise: SPEND_CAP_PAISE,
      },
      { status: 402 }
    );
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return NextResponse.json(
      {
        error: "Razorpay is not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.local.",
      },
      { status: 500 }
    );
  }

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  const origin =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    "http://localhost:3000";

  let link;
  try {
    const createParams: PaymentLinks.RazorpayPaymentLinkCreateRequestBody = {
      amount: totalPaise,
      currency: "INR",
      description: `AgentStore order (${items.length} item${items.length === 1 ? "" : "s"})`,
      customer: { name: "AgentStore Customer", email: "customer@agentstore.demo" },
      notify: { sms: false, email: false },
      callback_url: origin + "/order/__ORDER_ID__",
      callback_method: "get",
      reference_id: `order-${Date.now()}`,
    };
    link = await razorpay.paymentLink.create(createParams);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Razorpay error";
    return NextResponse.json(
      { error: `Failed to create payment link: ${message}` },
      { status: 502 }
    );
  }

  // Insert the order as "created" (status flips to "paid" via webhook).
  const orderId = insertOrder({
    razorpay_payment_link_id: link.id,
    status: "created",
    amount_paise: totalPaise,
    items,
  });

  return NextResponse.json({ orderId, paymentLinkUrl: link.short_url });
}
