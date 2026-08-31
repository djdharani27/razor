import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import type { Orders } from "razorpay/dist/types/orders";
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
 * creates a Razorpay order for Standard Checkout and records the order as
 * "created". Returns { orderId, razorpayOrderId, amount, currency, keyId }.
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
    console.warn(
      `[checkout] rejected: order ₹${(totalPaise / 100).toFixed(2)} exceeds spend cap ₹${(SPEND_CAP_PAISE / 100).toFixed(2)}`
    );
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

  let order;
  try {
    const createParams: Orders.RazorpayOrderCreateRequestBody = {
      amount: totalPaise,
      currency: "INR",
      receipt: `order-${Date.now()}`,
      notes: {
        items: JSON.stringify(items),
      },
    };
    order = await razorpay.orders.create(createParams);
  } catch (err) {
    // Razorpay SDK errors carry statusCode + { error: { description, code } }.
    // Surface those so the real cause isn't swallowed as "Unknown error".
    const e = err as {
      statusCode?: number;
      error?: { description?: string; code?: string };
      message?: string;
    };
    const detail = e.error?.description ?? e.message ?? "Unknown Razorpay error";
    console.error(
      `[checkout] order creation failed for ₹${(totalPaise / 100).toFixed(2)}`,
      { statusCode: e.statusCode ?? null, code: e.error?.code ?? null, detail }
    );
    return NextResponse.json(
      {
        error: `Failed to create order: ${detail}`,
        code: "CHECKOUT_REJECTED",
        ...(e.statusCode ? { statusCode: e.statusCode } : {}),
        ...(e.error?.code ? { razorpayCode: e.error.code } : {}),
      },
      { status: 502 }
    );
  }

  // Record the order as "created". The Razorpay order id is stored in
  // razorpay_payment_link_id (the column is just an opaque reference string);
  // it's how payment status is reconciled, whether via the in-page checkout
  // handler or the payment_link.paid webhook.
  const orderId = insertOrder({
    razorpay_payment_link_id: order.id,
    status: "created",
    amount_paise: totalPaise,
    items,
  });

  return NextResponse.json({
    orderId,
    razorpayOrderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
  });
}
