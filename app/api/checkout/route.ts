import { NextResponse } from "next/server";
import { getAllProducts } from "@/lib/db";
import type { CartItem } from "@/lib/types";
import { logServer } from "@/lib/agent/server-log";
import { executePayment } from "@/lib/payments";

export const runtime = "nodejs";

const SPEND_CAP_PAISE = Number(process.env.SPEND_CAP_PAISE ?? 500000);

interface CheckoutItem {
  productId: number | string;
  qty: number | string;
}

interface CustomerBody {
  name?: string;
  contact?: string;
  email?: string | null;
}

/** Normalise a 10-digit Indian mobile number (strips +91 / spaces / dashes). */
function normaliseContact(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

/**
 * POST /api/checkout
 * Body: { items: [{ productId, qty }], customer: { name, contact, email? } }
 *
 * Validates stock + prices server-side (client prices are never trusted),
 * enforces SPEND_CAP_PAISE and the ₹10,000 Reserve Pay block ceiling, then runs
 * the UPI Reserve Pay decision:
 *   - reusable mandate → debits immediately → { status: "paid", orderId, ... }
 *   - no mandate       → creates the authorisation order →
 *                       { status: "needs_authorisation", auth: {...} }
 */
export async function POST(req: Request) {
  let body: { items?: CheckoutItem[]; customer?: CustomerBody };
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

  const rawCustomer = body.customer ?? {};
  const name = String(rawCustomer.name ?? "").trim();
  const rawContact = String(rawCustomer.contact ?? "").trim();
  const contact = normaliseContact(rawContact);
  if (!name || name.length < 2) {
    return NextResponse.json(
      { error: "Please provide your name to check out." },
      { status: 400 }
    );
  }
  if (!contact) {
    return NextResponse.json(
      {
        error: `Please provide a valid 10-digit Indian mobile number (got "${rawContact || "(empty)"}").`,
      },
      { status: 400 }
    );
  }
  const email = rawCustomer.email ? String(rawCustomer.email).trim() : null;

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
    logServer("checkout", "Order rejected — exceeds spend cap", {
      level: "warn",
      detail: { total_paise: totalPaise, spend_cap_paise: SPEND_CAP_PAISE, items: requested },
      endpoint: "/api/checkout",
    });
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

  try {
    const resolution = await executePayment({
      name,
      contact,
      email,
      amountPaise: totalPaise,
      items,
      orderKind: "charge",
      description: `AgentStore order — ${items.map((i) => `${byId.get(i.productId)?.name ?? `#${i.productId}`} x${i.qty}`).join(", ")}`,
      endpoint: "/api/checkout",
    });

    if (resolution.status === "needs_authorisation") {
      const { payload } = resolution;
      logServer("checkout", `Authorisation required for ₹${(totalPaise / 100).toFixed(2)}`, {
        detail: { order_id: payload.orderId, customer_id: payload.customerId, block_paise: payload.blockPaise },
        endpoint: "/api/checkout",
      });
      return NextResponse.json({
        status: "needs_authorisation",
        auth: {
          orderId: payload.orderId,
          customerId: payload.customerId,
          keyId: payload.keyId,
          blockPaise: payload.blockPaise,
          expireAt: payload.expireAt,
          amountPaise: payload.amountPaise,
        },
      });
    }

    if (resolution.status === "error") {
      return NextResponse.json(
        { error: resolution.error, code: resolution.code ?? "PAYMENT_FAILED" },
        { status: 502 }
      );
    }

    const { debit } = resolution;
    logServer("checkout", `Debit captured → local order #${debit.localOrderId}`, {
      detail: {
        local_order_id: debit.localOrderId,
        rzp_order_id: debit.rzpOrderId,
        payment_id: debit.paymentId ?? null,
        amount_paise: debit.amountPaise,
      },
      endpoint: "/api/checkout",
    });
    return NextResponse.json({
      status: "paid",
      orderId: debit.localOrderId,
      rzpOrderId: debit.rzpOrderId,
      paymentId: debit.paymentId ?? null,
      amount: totalPaise,
      currency: "INR",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payment could not be completed.";
    logServer("checkout", "Checkout FAILED", {
      level: "error",
      detail: { error: message },
      endpoint: "/api/checkout",
    });
    return NextResponse.json(
      { error: message, code: "CHECKOUT_REJECTED" },
      { status: 502 }
    );
  }
}
