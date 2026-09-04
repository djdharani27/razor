import { NextResponse } from "next/server";
import { createAuthorisationOrder, ensureRzpCustomer, isRzpConfigured } from "@/lib/rzp";
import { upsertCustomer } from "@/lib/db";
import { logServer } from "@/lib/agent/server-log";

export const runtime = "nodejs";

function normaliseContact(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

/**
 * POST /api/rzp/authorise/create
 * Body: { customer: { name, contact, email? } }
 *
 * Creates a ₹1 dummy authorisation order for setting up a UPI Reserve Pay
 * mandate directly (e.g. from the Agent Delegation Code banner).
 */
export async function POST(req: Request) {
  if (!isRzpConfigured()) {
    return NextResponse.json(
      { error: "Razorpay is not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.local." },
      { status: 500 }
    );
  }

  let body: { customer?: { name?: string; contact?: string; email?: string | null } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawCustomer = body.customer ?? {};
  const name = String(rawCustomer.name ?? "").trim();
  const contact = normaliseContact(String(rawCustomer.contact ?? ""));
  const email = rawCustomer.email ? String(rawCustomer.email).trim() : null;

  if (!name || !contact) {
    return NextResponse.json(
      { error: "Customer name and a valid 10-digit Indian mobile number are required." },
      { status: 400 }
    );
  }

  try {
    const local = upsertCustomer({ contact, name, email });
    const rzp = await ensureRzpCustomer({
      name,
      contact,
      email,
      existingRzpCustomerId: local.rzp_customer_id,
      endpoint: "/api/rzp/authorise/create",
    });
    if (!rzp.ok || !rzp.rzpCustomerId) {
      return NextResponse.json(
        { error: rzp.error ?? "Failed to create/resolve Razorpay customer." },
        { status: 502 }
      );
    }
    if (local.rzp_customer_id !== rzp.rzpCustomerId) {
      upsertCustomer({ contact, name, email, rzpCustomerId: rzp.rzpCustomerId });
    }

    const blockPaise = Number(process.env.MANDATE_BLOCK_PAISE ?? 1000000); // default ₹10,000 block
    const auth = await createAuthorisationOrder({
      rzpCustomerId: rzp.rzpCustomerId,
      blockPaise,
      receipt: `mandate-setup-${Date.now()}`,
      endpoint: "/api/rzp/authorise/create",
    });

    if (!auth.ok || !auth.orderId) {
      return NextResponse.json(
        { error: auth.error ?? "Failed to create UPI authorisation order." },
        { status: 502 }
      );
    }

    logServer("authorise/create", `Mandate setup order created for ${contact}`, {
      detail: { order_id: auth.orderId, customer_id: rzp.rzpCustomerId, block_paise: blockPaise },
      endpoint: "/api/rzp/authorise/create",
    });

    return NextResponse.json({
      ok: true,
      auth: {
        orderId: auth.orderId,
        customerId: rzp.rzpCustomerId,
        keyId: process.env.RAZORPAY_KEY_ID ?? "",
        blockPaise: auth.blockPaise ?? blockPaise,
        expireAt: auth.expireAt ?? 0,
        amountPaise: 100,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error initializing mandate authorization.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
