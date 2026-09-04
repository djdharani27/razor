"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChatMessage from "@/components/agent/ChatMessage";
import ChatInput from "@/components/agent/ChatInput";
import { CustomerProfileForm } from "@/components/customer-profile";
import type { CustomerProfile } from "@/components/customer-profile";
import {
  readSavedCustomer,
  saveCustomer,
  clearSavedCustomer,
  useSavedCustomer,
} from "@/components/customer-profile";
import type { AuthoriseResult } from "@/components/rzp-authorise-button";

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface DisplayMessage {
  id: string;
  role: "user" | "model";
  text: string;
  toolCalls?: ToolCall[];
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

const MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      "chrome-devtools": {
        transport: "stdio",
        enabled: true,
        command: "npx",
        args: [
          "-y",
          "chrome-devtools-mcp@latest",
          "--categoryExperimentalWebmcp=true",
          "--chromeArg=--enable-features=WebMCP",
          "--chromeArg=--headless=new",
          "--no-usage-statistics",
        ],
      },
    },
  },
  null,
  2
);

export default function AgentPage() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [agentCode, setAgentCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { customer, refresh } = useSavedCustomer();
  // The customer profile collected in this chat session (via remember_customer),
  // kept so the authorisation card can render even if localStorage has no
  // profile yet.
  const [chatCustomer, setChatCustomer] = useState<CustomerProfile | null>(null);

  const activeCustomer = customer ?? chatCustomer ?? readSavedCustomer();

  const fetchMandateStatus = useCallback(async (contact?: string | null) => {
    const raw = contact ?? activeCustomer?.contact;
    if (!raw) return;
    try {
      const res = await fetch("/api/customer/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact: raw, amountPaise: 100 }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.mandate?.agentCode) {
          setAgentCode(data.mandate.agentCode);
        }
      }
    } catch {
      // transient
    }
  }, [activeCustomer?.contact]);

  useEffect(() => {
    if (activeCustomer?.contact) {
      void fetchMandateStatus(activeCustomer.contact);
    }
  }, [activeCustomer?.contact, fetchMandateStatus]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const sendMessage = useCallback(
    async (text: string, withCustomer?: CustomerProfile | null) => {
      if (loading) return;

      const currentCustomer =
        withCustomer !== undefined
          ? withCustomer
          : (customer ?? chatCustomer ?? readSavedCustomer());

      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            sessionId,
            customer: currentCustomer
              ? { name: currentCustomer.name, contact: currentCustomer.contact, email: currentCustomer.email ?? null }
              : null,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error ?? `Server error (${res.status})`);
          setLoading(false);
          return;
        }

        // Save session ID from first response
        if (data.sessionId && !sessionId) {
          setSessionId(data.sessionId);
        }

        // Check if chat returned a customer profile (from tool execution or session)
        let contactToQuery: string | null = null;
        if (data.customer?.name && data.customer?.contact) {
          const profile: CustomerProfile = {
            name: String(data.customer.name),
            contact: String(data.customer.contact),
            email: data.customer.email ?? null,
          };
          setChatCustomer(profile);
          saveCustomer(profile);
          refresh();
          contactToQuery = profile.contact;
        } else {
          const remembered = (data.toolCalls as ToolCall[] | undefined)?.find(
            (tc) =>
              (tc.name === "remember_customer" || tc.name === "fetch_customer") &&
              ((tc.result as Record<string, unknown> | null)?.saved === true ||
               (tc.result as Record<string, unknown> | null)?.found === true)
          )?.result as { name?: string; contact?: string; email?: string | null; customer?: { name?: string; contact?: string; email?: string | null } } | undefined;

          const profileData = remembered?.customer ?? remembered;
          if (profileData?.name && profileData?.contact) {
            const profile: CustomerProfile = {
              name: String(profileData.name),
              contact: String(profileData.contact),
              email: profileData.email ?? null,
            };
            setChatCustomer(profile);
            saveCustomer(profile);
            refresh();
            contactToQuery = profile.contact;
          }
        }

        if (contactToQuery) {
          void fetchMandateStatus(contactToQuery);
        } else if (currentCustomer?.contact) {
          void fetchMandateStatus(currentCustomer.contact);
        }

        const agentMsg: DisplayMessage = {
          id: `model-${Date.now()}`,
          role: "model",
          text: data.message,
          toolCalls: data.toolCalls,
        };
        setMessages((prev) => [...prev, agentMsg]);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to reach the agent."
        );
      } finally {
        setLoading(false);
      }
    },
    [loading, sessionId, customer, chatCustomer, refresh, fetchMandateStatus]
  );

  const handleProfileSave = useCallback(
    (profile: CustomerProfile) => {
      saveCustomer(profile);
      setShowProfileForm(false);
      refresh();
      void fetchMandateStatus(profile.contact);
    },
    [refresh, fetchMandateStatus]
  );

  const handleAuthoriseDone = useCallback(
    (result: AuthoriseResult & { amountPaise?: number }) => {
      if (result.kind !== "success") return;
      void fetchMandateStatus();
      const debit = result.debit;
      const paidMsg: DisplayMessage = {
        id: `sys-${Date.now()}`,
        role: "model",
        text:
          debit?.status === "captured" && debit?.orderId
            ? `✅ Order #${debit.orderId} paid — the debit was captured from your UPI block. Anything else you need?`
            : `✅ Your UPI block is approved${result.amountPaise ? ` and your order of ${inr.format(result.amountPaise / 100)} is being debited` : ""}. Anything else you need?`,
      };
      setMessages((prev) => [...prev, paidMsg]);
    },
    [fetchMandateStatus]
  );

  return (
    <div className="flex h-screen flex-col bg-[#F4F4F0]">
      {/* Header */}
      <header className="animate-slide-down flex items-center justify-between border-b-4 border-[#000000] bg-[#F4F4F0] px-6 py-3">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="flex h-9 w-9 items-center justify-center border-[3px] border-[#000000] bg-[#FFFFFF] text-[#000000] shadow-[4px_4px_0px_#000000] transition-all duration-150 hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_#000000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
            aria-label="Back to store"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-5 w-5"
            >
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                clipRule="evenodd"
              />
            </svg>
          </a>
          <div>
            <h1 className="text-lg font-black uppercase tracking-tight text-[#000000]">
              Razor
            </h1>
            <p className="text-xs font-medium text-[#000000]/70">
              Powered by Razorpay · Gemini
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeCustomer ? (
            <div className="inline-flex flex-wrap items-center gap-2 border-2 border-[#000000] bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#000000] shadow-[3px_3px_0px_#000000]">
              <span className="h-2 w-2 bg-[#000000]" />
              <span>{activeCustomer.name} · {activeCustomer.contact}</span>

              {agentCode && (
                <div className="ml-1 inline-flex items-center gap-1.5 border border-[#000000] bg-[#CCFF00] px-2 py-0.5 text-[11px] font-black text-[#000000]">
                  <span>🤖 Agent ID:</span>
                  <span className="font-mono">{agentCode}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(agentCode);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className="ml-1 border border-[#000000] bg-[#FFFFFF] px-1 py-0.5 text-[10px] font-black uppercase text-[#000000] hover:bg-[#F4F4F0] active:translate-y-[1px]"
                  >
                    {copiedCode ? "✓ Copied" : "Copy"}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  clearSavedCustomer();
                  setChatCustomer(null);
                  setAgentCode(null);
                  refresh();
                  window.location.reload();
                }}
                title="Reset saved customer to test new customer flow"
                className="ml-1 border border-[#000000] bg-[#FF0055] px-1.5 py-0.5 text-[10px] font-black uppercase text-[#FFFFFF] shadow-[1px_1px_0px_#000000] transition-transform active:translate-y-[1px]"
              >
                Reset
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowProfileForm((v) => !v)}
              className="border-2 border-[#000000] bg-[#FFFFFF] px-3 py-1 text-xs font-bold text-[#000000] shadow-[3px_3px_0px_#000000] transition-all duration-150 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_#000000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            >
              + Add my details
            </button>
          )}
          <a
            href="/order"
            className="flex items-center gap-1.5 border-2 border-[#000000] bg-[#FFFFFF] px-2.5 py-1 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[2px_2px_0px_#000000] transition-all hover:-translate-y-[1px] hover:bg-[#FEF08A] hover:shadow-[3px_3px_0px_#000000] active:translate-y-[1px] active:shadow-none"
            title="View all Orders & Settlements"
          >
            <span>📦 Orders</span>
          </a>
          <button
            type="button"
            onClick={() => setMcpModalOpen(true)}
            className="flex items-center gap-1.5 border-2 border-[#000000] bg-[#FFFFFF] px-2.5 py-1 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[2px_2px_0px_#000000] transition-all hover:-translate-y-[1px] hover:bg-[#CCFF00] hover:shadow-[3px_3px_0px_#000000] active:translate-y-[1px] active:shadow-none"
            title="View copyable WebMCP config for autonomous agents"
          >
            <span>🤖 MCP Config</span>
          </button>
          <span className="inline-flex items-center gap-1.5 border-2 border-[#000000] bg-[#000000] px-3 py-1 text-xs font-bold text-[#F4F4F0] shadow-[3px_3px_0px_#000000]">
            <span className="h-2 w-2 animate-pulse bg-[#CCFF00]" />
            Agent Online
          </span>
        </div>
      </header>

      {/* WebMCP Config Modal */}
      {mcpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl border-[4px] border-[#000000] bg-[#FFFFFF] p-6 shadow-[8px_8px_0px_#000000] animate-pop-in">
            <div className="flex items-start justify-between border-b-2 border-[#000000] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🤖</span>
                <div>
                  <h3 className="text-lg font-black uppercase tracking-tight text-[#000000]">
                    WebMCP Agent Configuration
                  </h3>
                  <p className="text-xs font-medium text-[#000000]/70">
                    Add this to your Claude Desktop / Cursor / DevTools MCP config:
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMcpModalOpen(false)}
                className="border-2 border-[#000000] bg-[#FF0055] px-2 py-0.5 text-xs font-black text-[#FFFFFF] shadow-[2px_2px_0px_#000000] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <div className="relative">
                <pre className="max-h-64 overflow-x-auto border-2 border-[#000000] bg-[#000000] p-4 font-mono text-xs text-[#CCFF00]">
                  {MCP_CONFIG}
                </pre>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] font-bold text-[#000000]/60">
                  Enables autonomous browsing & instant UPI Reserve Pay debits.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(MCP_CONFIG);
                      setCopiedMcp(true);
                      setTimeout(() => setCopiedMcp(false), 2000);
                    }}
                    className="border-[3px] border-[#000000] bg-[#CCFF00] px-4 py-2 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[3px_3px_0px_#000000] transition hover:-translate-y-[1px] hover:shadow-[4px_5px_0px_#000000] active:translate-y-[1px] active:shadow-none"
                  >
                    {copiedMcp ? "✓ Copied to Clipboard!" : "Copy MCP Config"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMcpModalOpen(false)}
                    className="border-2 border-[#000000] bg-[#FFFFFF] px-3 py-2 text-xs font-black uppercase text-[#000000] hover:bg-[#F4F4F0]"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">

          {!customer && showProfileForm && (
            <div className="animate-pop-in mx-auto w-full max-w-sm">
              <CustomerProfileForm onSave={handleProfileSave} />
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className="animate-fade-up">
              <ChatMessage
                role={msg.role}
                text={msg.text}
                toolCalls={msg.toolCalls}
                customer={customer ?? chatCustomer ?? readSavedCustomer()}
                sessionId={sessionId}
                onAuthoriseDone={handleAuthoriseDone}
                onSendMessage={(msgText) => void sendMessage(msgText)}
              />
            </div>
          ))}

          {/* Loading indicator */}
          {loading && <ChatMessage role="model" text="" isLoading />}

          {/* Error banner */}
          {error && (
            <div className="animate-pop-in border-[3px] border-[#000000] bg-[#FFFFFF] px-4 py-3 text-sm font-medium text-[#000000] shadow-[4px_4px_0px_#000000]">
              <span className="font-black uppercase text-[#FF0055]">Error: </span>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Input bar */}
      <ChatInput
        onSend={(text) => void sendMessage(text)}
        disabled={loading}
      />
    </div>
  );
}
