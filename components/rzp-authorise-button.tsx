"use client";

// Reusable "approve your UPI Reserve Pay block" button. Used by both the
// storefront checkout and the agent chat. Opens the recurring checkout modal
// (order_id + customer_id + recurring: true) and then posts the result to
// /api/rzp/authorise/confirm so the server can capture the mandate token.

import { useCallback, useState } from "react";
import { openUpiAuthCheckout } from "@/lib/upi-sbmd/checkout";
import type { CustomerProfile } from "@/components/customer-profile";

export interface AuthorisePayload {
  orderId: string;
  customerId: string;
  keyId: string;
  blockPaise: number;
  expireAt: number;
  amountPaise: number;
}

export interface PendingDebitPayload {
  items: { productId: number; qty: number }[];
  amountPaise: number;
  description?: string;
  receipt?: string;
}

export interface AuthoriseConfirmInput {
  customer: CustomerProfile;
  auth: AuthorisePayload;
  pendingDebit?: PendingDebitPayload | null;
}

export type AuthoriseResult =
  | { kind: "success"; mandateStored: boolean; debit?: { status: string; orderId?: number; paymentId?: string | null; amountPaise?: number } | null }
  | { kind: "dismissed" }
  | { kind: "failed"; error: string };

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

function formatExpiry(unixSec: number): string {
  if (!unixSec) return "90 days";
  return new Date(unixSec * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

interface AuthoriseButtonProps {
  customer: CustomerProfile;
  auth: AuthorisePayload;
  /** Pass a pendingDebit to have the server complete the debit right after the
   *  mandate is captured (agent flow). Storefront passes none — it re-runs
   *  checkout instead. */
  pendingDebit?: PendingDebitPayload | null;
  /** Agent session id (so the server can clear the session cart on success). */
  sessionId?: string | null;
  onResult: (result: AuthoriseResult) => void;
  label?: string;
}

export default function AuthoriseButton({
  customer,
  auth,
  pendingDebit,
  sessionId,
  onResult,
  label = "Approve UPI Reserve Pay block",
}: AuthoriseButtonProps) {
  const [busy, setBusy] = useState<"idle" | "opening" | "confirming">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    if (busy !== "idle") return;
    setError(null);
    setBusy("opening");
    try {
      const checkout = await openUpiAuthCheckout({
        key: auth.keyId,
        orderId: auth.orderId,
        customerId: auth.customerId,
        extras: {
          name: "AgentStore",
          description: `UPI Reserve Pay block of ${formatPaise(auth.blockPaise)}`,
          prefill: { name: customer.name, contact: customer.contact, email: customer.email ?? undefined },
          theme: { color: "#4f46e5" },
        },
      });

      if (checkout.outcome.kind === "dismissed") {
        setBusy("idle");
        onResult({ kind: "dismissed" });
        return;
      }
      if (checkout.outcome.kind === "failed") {
        setBusy("idle");
        const msg = checkout.outcome.error.description ?? "The UPI authorisation could not be completed.";
        setError(msg);
        onResult({ kind: "failed", error: msg });
        return;
      }

      // authorised OR mandate_registered (upi_dummy_payment success) — both give
      // us a payment id to confirm against.
      setBusy("confirming");
      const paymentId =
        checkout.outcome.kind === "authorised"
          ? checkout.outcome.paymentId
          : checkout.outcome.kind === "mandate_registered"
            ? checkout.outcome.paymentId
            : null;
      const signature =
        checkout.outcome.kind === "authorised" ? checkout.outcome.signature : undefined;
      if (!paymentId) {
        throw new Error("No payment id returned from the checkout.");
      }

      const res = await fetch("/api/rzp/authorise/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: customer.contact,
          name: customer.name,
          email: customer.email ?? null,
          razorpayOrderId: auth.orderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signature ?? null,
          blockPaise: auth.blockPaise,
          expireAt: auth.expireAt,
          pendingDebit: pendingDebit ?? null,
          sessionId: sessionId ?? null,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        mandateStored?: boolean;
        error?: string;
        debit?: { status: string; orderId?: number; paymentId?: string | null; amountPaise?: number };
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Confirmation failed (${res.status}).`);
      }
      setBusy("idle");
      onResult({ kind: "success", mandateStored: Boolean(data.mandateStored), debit: data.debit ?? null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong while approving the block.";
      setError(msg);
      setBusy("idle");
      onResult({ kind: "failed", error: msg });
    }
  }, [auth, customer, pendingDebit, sessionId, onResult, busy]);

  return (
    <div className="flex w-full flex-col gap-2">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy !== "idle"}
        className="w-full border-[3px] border-[#000000] bg-[#FF0055] px-4 py-3 text-sm font-black uppercase tracking-tight text-[#FFFFFF] shadow-[4px_4px_0px_#000000] transition-all duration-150 hover:-translate-y-[1px] hover:shadow-[4px_6px_0px_#000000] active:translate-y-[2px] active:shadow-[2px_2px_0px_#000000] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-[4px_4px_0px_#000000]"
      >
        {busy === "opening"
          ? "Opening UPI authorisation…"
          : busy === "confirming"
            ? "Confirming your block…"
            : label}
      </button>
      <p className="text-center text-[11px] font-medium leading-relaxed text-[#000000]/60">
        Approve a one-time UPI block of{" "}
        <span className="border-2 border-[#000000] bg-[#F4F4F0] px-1 font-black text-[#000000]">{formatPaise(auth.blockPaise)}</span> in your UPI
        app. It expires {formatExpiry(auth.expireAt)} and lets you pay by UPI without a PIN on
        repeat orders.
      </p>
      {error && (
        <p className="border-2 border-[#000000] bg-[#FFFFFF] px-3 py-2 text-xs font-bold text-[#FF0055]">
          {error}
        </p>
      )}
    </div>
  );
}
