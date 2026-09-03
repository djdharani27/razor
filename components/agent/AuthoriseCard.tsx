"use client";

// Renders the "approve your UPI Reserve Pay block" handoff inside the chat,
// when pay_cart_now returns needs_authorisation. On success it also appends a
// user turn that says "payment captured" so the conversation shows the order
// confirmed — the server already debited the cart after the mandate was stored.

import { useCallback, useState } from "react";
import AuthoriseButton, {
  type AuthorisePayload,
  type AuthoriseResult,
  type PendingDebitPayload,
} from "@/components/rzp-authorise-button";
import type { CustomerProfile } from "@/components/customer-profile";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

interface AuthoriseCardProps {
  customer: CustomerProfile;
  auth: AuthorisePayload;
  /** Parked cart to debit once the block is approved (server-side). */
  pendingDebit: PendingDebitPayload;
  /** Agent session id (server clears the session cart once the debit lands). */
  sessionId?: string | null;
  /** Called with the confirm result so the parent can append a captured message. */
  onDone: (result: AuthoriseResult) => void;
}

export default function AuthoriseCard({ customer, auth, pendingDebit, sessionId, onDone }: AuthoriseCardProps) {
  const [state, setState] = useState<"idle" | "success" | "dismissed" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleResult = useCallback(
    (result: AuthoriseResult) => {
      setState(result.kind === "success" ? "success" : result.kind === "dismissed" ? "dismissed" : "failed");
      if (result.kind === "failed") setError(result.error);
      onDone(result);
    },
    [onDone]
  );

  if (state === "success") {
    return (
      <div className="animate-fade-up w-full max-w-sm border-[3px] border-[#000000] bg-[#FFFFFF] shadow-[4px_4px_0px_#000000]">
        <div className="border-b-[3px] border-[#000000] bg-[#CCFF00] px-4 py-3">
          <span className="text-sm font-black uppercase tracking-tight text-[#000000]">✅ UPI block approved</span>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-[#000000]">
            Your block of{" "}
            <span className="border-2 border-[#000000] bg-[#F4F4F0] px-1 font-black">{formatPaise(auth.blockPaise)}</span> is
            active. Debiting your order of {formatPaise(auth.amountPaise)}…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up w-full max-w-sm border-[3px] border-[#000000] bg-[#FFFFFF] shadow-[4px_4px_0px_#000000]">
      <div className="flex items-center gap-2 border-b-[3px] border-[#000000] bg-[#F4F4F0] px-4 py-3">
        <span className="text-lg">💳</span>
        <span className="text-sm font-black uppercase tracking-tight text-[#000000]">Approve UPI Reserve Pay block</span>
      </div>
      <div className="px-4 py-3">
        <p className="text-xs font-medium leading-relaxed text-[#000000]/80">
          One-time approval so future orders pay instantly without a UPI PIN. Your block:{" "}
          <span className="font-black text-[#000000]">{formatPaise(auth.blockPaise)}</span>.
        </p>
        <div className="mt-3">
          <AuthoriseButton
            customer={customer}
            auth={auth}
            pendingDebit={pendingDebit}
            sessionId={sessionId}
            onResult={handleResult}
            label="Approve block"
          />
        </div>
        {state === "dismissed" && (
          <p className="mt-2 text-xs font-bold text-[#000000]/60">You closed the popup — approve it when you&apos;re ready.</p>
        )}
        {state === "failed" && error && (
          <p className="mt-2 border-2 border-[#000000] bg-[#FFFFFF] px-2 py-1 text-xs font-bold text-[#FF0055]">{error}</p>
        )}
      </div>
    </div>
  );
}
