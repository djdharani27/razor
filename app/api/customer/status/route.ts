import { NextResponse } from "next/server";
import {
  getActiveMandate,
  getCustomerByContact,
  expireStaleMandates,
  mandateHasRoom,
} from "@/lib/db";
import { fetchCustomerTokens, isRzpConfigured } from "@/lib/rzp";
import { logServer } from "@/lib/agent/server-log";

export const runtime = "nodejs";

function normaliseContact(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

/**
 * POST /api/customer/status
 * Body: { contact }
 *
 * Returns whether the customer has a reusable UPI Reserve Pay mandate for a
 * given amount, so the storefront can skip straight to the debit without
 * bouncing through the authorisation modal. Best-effort live check against
 * Razorpay's token list; falls back to the local ledger when the token list is
 * unavailable (save_vpa not enabled).
 */
export async function POST(req: Request) {
  if (!isRzpConfigured()) {
    return NextResponse.json({ ok: false, mandate: null }, { status: 200 });
  }
  let body: { contact?: string; amountPaise?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const contact = normaliseContact(String(body.contact ?? ""));
  if (!contact) {
    return NextResponse.json({ error: "A valid contact is required." }, { status: 400 });
  }
  const amountPaise = Math.round(Number(body.amountPaise ?? 0)) || 0;

  expireStaleMandates();
  const customer = getCustomerByContact(contact);
  if (!customer || !customer.rzp_customer_id) {
    return NextResponse.json({ ok: true, mandate: null, customerKnown: false }, { status: 200 });
  }

  const local = getActiveMandate(customer.id);
  let reusable = false;
  let blockPaise: number | null = null;
  let remainingPaise: number | null = null;

  if (local && mandateHasRoom(local, amountPaise)) {
    const live = await fetchCustomerTokens(customer.rzp_customer_id, "/api/customer/status");
    if (live.ok) {
      const remote = live.tokens.find((t) => t.tokenId === local.token_id);
      if (remote && remote.status !== "confirmed") {
        reusable = false;
      } else {
        reusable = true;
        blockPaise = local.max_amount_paise;
        remainingPaise = Math.max(0, local.max_amount_paise - local.amount_debited_paise);
        if (
          typeof remote?.amountBlocked === "number" &&
          typeof remote?.amountDebited === "number"
        ) {
          remainingPaise = Math.max(0, remote.amountBlocked - remote.amountDebited);
        }
      }
    } else {
      // Token list unavailable — trust the local ledger.
      reusable = true;
      blockPaise = local.max_amount_paise;
      remainingPaise = Math.max(0, local.max_amount_paise - local.amount_debited_paise);
    }
    // Fresh sanity check: local expiry/headroom already enforced by the query.
  }

  logServer("customer/status", `Status for contact ${contact}`, {
    detail: { reusable, block_paise: blockPaise, remaining_paise: remainingPaise, for_amount_paise: amountPaise },
    endpoint: "/api/customer/status",
  });

  return NextResponse.json({
    ok: true,
    mandate: reusable
      ? {
          reusable: true,
          blockPaise,
          remainingPaise,
          mandateId: local?.id ?? null,
          agentCode: local?.agent_code ?? null,
        }
      : { reusable: false },
    customerKnown: true,
  });
}
