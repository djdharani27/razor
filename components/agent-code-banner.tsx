"use client";

import { useCallback, useEffect, useState } from "react";
import { useSavedCustomer, CustomerProfileForm, saveCustomer, type CustomerProfile } from "@/components/customer-profile";
import AuthoriseButton, { type AuthorisePayload, type AuthoriseResult } from "@/components/rzp-authorise-button";

interface MandateInfo {
  reusable: boolean;
  blockPaise?: number | null;
  remainingPaise?: number | null;
  agentCode?: string | null;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
function formatPaise(paise?: number | null): string {
  if (typeof paise !== "number") return "₹0.00";
  return inr.format(paise / 100);
}

interface AgentCodeBannerProps {
  onMandateChange?: () => void;
}

export default function AgentCodeBanner({ onMandateChange }: AgentCodeBannerProps) {
  const { customer, refresh: refreshCustomer } = useSavedCustomer();
  const [mandate, setMandate] = useState<MandateInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [authPayload, setAuthPayload] = useState<AuthorisePayload | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const checkStatus = useCallback(async (contact: string) => {
    try {
      setLoading(true);
      const res = await fetch("/api/customer/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact, amountPaise: 100 }),
      });
      if (res.ok) {
        const data = await res.json();
        setMandate(data.mandate ?? null);
      }
    } catch {
      // transient error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (customer?.contact) {
      void checkStatus(customer.contact);
    } else {
      setMandate(null);
    }
  }, [customer?.contact, checkStatus]);

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartSetup = async (profile: CustomerProfile) => {
    setSetupError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/rzp/authorise/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: profile }),
      });
      const data = await res.json();
      if (!res.ok || !data.auth) {
        setSetupError(data.error ?? "Failed to create UPI authorisation order.");
        setLoading(false);
        return;
      }
      setAuthPayload(data.auth);
      setLoading(false);
    } catch {
      setSetupError("Network error while creating authorisation order.");
      setLoading(false);
    }
  };

  const handleAuthoriseResult = (result: AuthoriseResult) => {
    if (result.kind === "success") {
      setShowSetup(false);
      setAuthPayload(null);
      refreshCustomer();
      if (customer?.contact) void checkStatus(customer.contact);
      onMandateChange?.();
    } else if (result.kind === "failed") {
      setSetupError(result.error);
    }
  };

  // State 1: Active UPI Reserve Pay Mandate with Agent Code
  if (mandate?.reusable && mandate.agentCode) {
    return (
      <div className="border-[3px] border-[#000000] bg-[#FFFFFF] p-4 shadow-[4px_4px_0px_#000000]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-[#000000] bg-[#CCFF00] text-xl font-bold shadow-[2px_2px_0px_#000000]">
              🤖
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-[#000000]">
                  Agent Delegation Active
                </span>
                <span className="inline-flex items-center border border-[#000000] bg-[#CCFF00] px-2 py-0.5 text-[10px] font-black text-[#000000]">
                  Block: {formatPaise(mandate.remainingPaise)} Left
                </span>
              </div>
              <p className="mt-1 text-xs font-medium text-[#000000]/80">
                Share this delegation code with your in-browser / WebMCP agent to authorize instant checkout:
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center border-2 border-[#000000] bg-[#000000] px-3 py-1.5 shadow-[2px_2px_0px_#000000]">
              <span className="font-mono text-base font-black tracking-wider text-[#CCFF00]">
                {mandate.agentCode}
              </span>
              <button
                type="button"
                onClick={() => handleCopy(mandate.agentCode!)}
                className="ml-3 border border-[#000000] bg-[#FFFFFF] px-2.5 py-1 text-xs font-black uppercase text-[#000000] transition hover:bg-[#F4F4F0] active:translate-y-[1px]"
              >
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between border-t-2 border-[#000000]/10 pt-2 text-[11px] text-[#000000]/70">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">Prompt WebMCP agent:</span>
            <code className="border border-[#000000] bg-[#F4F4F0] px-1.5 py-0.5 font-mono font-bold text-[#000000]">
              &quot;checkout with code {mandate.agentCode}&quot;
            </code>
          </div>
          <span className="font-bold text-[#000000]/60">
            UPI Reserve Pay SBMD
          </span>
        </div>
      </div>
    );
  }

  // State 2: No active mandate yet — prompt user to authorize one
  return (
    <div className="border-[3px] border-[#000000] bg-[#FFFFFF] p-4 shadow-[4px_4px_0px_#000000]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-[#000000] bg-[#FFFFFF] text-xl shadow-[2px_2px_0px_#000000]">
            🤖
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-[#000000]">
                Autonomous WebMCP Checkout
              </span>
              <span className="inline-flex items-center border border-[#000000] bg-[#F4F4F0] px-2 py-0.5 text-[10px] font-bold text-[#000000]">
                Mandate Required
              </span>
            </div>
            <p className="mt-1 text-xs font-medium text-[#000000]/70">
              Authorize a one-time UPI Reserve Pay mandate (₹1 auth) to generate an <strong>Agent Delegation Code</strong> for AI agents.
            </p>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowSetup((v) => !v)}
            className="border-2 border-[#000000] bg-[#000000] px-3.5 py-1.5 text-xs font-black uppercase text-[#FFFFFF] shadow-[2px_2px_0px_#000000] transition-transform active:translate-y-[1px] hover:bg-[#333333]"
          >
            {showSetup ? "Close" : "⚡ Authorize UPI Reserve Pay"}
          </button>
        </div>
      </div>

      {showSetup && (
        <div className="mt-4 border-t-2 border-[#000000] pt-4">
          <h4 className="text-sm font-black uppercase text-[#000000]">
            One-Time UPI Reserve Pay Authorization
          </h4>
          <p className="mt-1 text-xs font-medium text-[#000000]/70">
            A ₹1 authorization creates a reusable UPI block (up to ₹10,000) so your AI agent can buy products autonomously.
          </p>

          {setupError && (
            <div className="mt-2 border-2 border-[#FF0055] bg-[#FFF0F3] p-2.5 text-xs font-bold text-[#FF0055]">
              {setupError}
            </div>
          )}

          {!customer ? (
            <div className="mt-3">
              <CustomerProfileForm
                compact
                onSave={(profile) => {
                  saveCustomer(profile);
                  refreshCustomer();
                  void handleStartSetup(profile);
                }}
              />
            </div>
          ) : authPayload ? (
            <div className="mt-3">
              <AuthoriseButton
                customer={customer}
                auth={authPayload}
                onResult={handleAuthoriseResult}
                label="Approve UPI Reserve Pay block in Razorpay"
              />
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleStartSetup(customer)}
                className="border-2 border-[#000000] bg-[#000000] px-4 py-2 text-xs font-black uppercase text-[#FFFFFF] shadow-[3px_3px_0px_#000000] transition hover:bg-[#333333] disabled:opacity-50"
              >
                {loading ? "Preparing Authorization…" : `Authorize for ${customer.name} (${customer.contact})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
