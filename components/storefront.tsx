"use client";

import { useCallback, useRef, useState } from "react";
import { useCart } from "@/components/cart-context";
import CartDrawer from "@/components/cart-drawer";
import AgentActivityPanel from "@/components/agent-activity-panel";
import WebMCPTools from "@/components/webmcp-tools";
import type { Product } from "@/lib/types";
import {
  CustomerProfileForm,
  readSavedCustomer,
  saveCustomer,
  useSavedCustomer,
  type CustomerProfile,
} from "@/components/customer-profile";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

interface CheckoutResponse {
  status?: "paid" | "needs_authorisation";
  orderId?: number;
  rzpOrderId?: string;
  paymentId?: string | null;
  amount?: number;
  error?: string;
  code?: string;
  auth?: {
    orderId: string;
    customerId: string;
    keyId: string;
    blockPaise: number;
    expireAt: number;
    amountPaise: number;
  };
}

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

export default function Storefront({ products }: { products: Product[] }) {
  const { add, items, totalQty } = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [checkoutState, setCheckoutState] = useState<"idle" | "loading" | "error" | "authorising" | "paid">("idle");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [pendingCustomer, setPendingCustomer] = useState<CustomerProfile | null>(null);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);
  const { customer } = useSavedCustomer();
  const authRef = useRef<{ orderId: string; customerId: string; keyId: string; blockPaise: number; expireAt: number; amountPaise: number } | null>(null);

  /** Run the checkout: POST items + customer → debit or authorisation handoff. */
  const runCheckout = useCallback(async (profile: CustomerProfile) => {
    if (items.length === 0) return;
    setCheckoutState("loading");
    setCheckoutError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          customer: { name: profile.name, contact: profile.contact, email: profile.email ?? null },
        }),
      });
      const data = (await res.json()) as CheckoutResponse;

      if (!res.ok) {
        setCheckoutError(data.error ?? `Checkout failed with status ${res.status}.`);
        setCheckoutState("error");
        return;
      }

      if (data.status === "needs_authorisation" && data.auth) {
        authRef.current = data.auth;
        setPendingCustomer(profile);
        setCheckoutState("authorising");
        return;
      }

      // Paid immediately (mandate reused / fresh debit).
      if (data.orderId) {
        setCheckoutState("paid");
        window.location.href = `/order/${data.orderId}`;
      }
    } catch {
      setCheckoutError("Network error while reaching the checkout API.");
      setCheckoutState("error");
    }
  }, [items]);

  const handleCheckout = useCallback(async () => {
    if (items.length === 0 || checkoutState === "loading") return;
    setCheckoutError(null);
    const saved = readSavedCustomer();
    if (saved) {
      await runCheckout(saved);
    } else {
      // Show the inline profile form inside the cart drawer.
      setPendingCustomer({ name: "", contact: "" });
      setCheckoutState("authorising");
    }
  }, [items, checkoutState, runCheckout]);

  const handleProfileSave = useCallback(
    (profile: CustomerProfile) => {
      const saved = saveCustomer(profile);
      setPendingCustomer(null);
      authRef.current = null;
      void runCheckout(saved);
    },
    [runCheckout]
  );

  const handleAuthorised = useCallback(async () => {
    // Mandate stored — retry the checkout; the debit should now go through.
    setPendingCustomer(null);
    authRef.current = null;
    const saved = readSavedCustomer();
    if (saved) await runCheckout(saved);
  }, [runCheckout]);

  const copyMcpConfig = () => {
    navigator.clipboard.writeText(MCP_CONFIG);
    setCopiedMcp(true);
    setTimeout(() => setCopiedMcp(false), 2000);
  };

  return (
    <main className="min-h-screen bg-[#F4F4F0] px-4 py-8 sm:px-8 text-[#000000]">
      {/* WebMCP tool registration — no-op in browsers without modelContext */}
      <WebMCPTools />

      <div className="mx-auto max-w-6xl">
        {/* Navigation / Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b-4 border-[#000000] pb-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center border-[3px] border-[#000000] bg-[#CCFF00] font-black text-xl shadow-[3px_3px_0px_#000000]">
                ⚡
              </span>
              <div>
                <h1 className="text-2xl font-black uppercase tracking-tight text-[#000000]">
                  Razor · AgentStore
                </h1>
                <p className="text-xs font-bold text-[#000000]/70">
                  AI-Agent Commerce Demo · Razorpay UPI Reserve Pay (SBMD)
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Human and Agent Buttons */}
            <div className="flex items-center border-[3px] border-[#000000] bg-[#FFFFFF] p-1 shadow-[3px_3px_0px_#000000]">
              <a
                href="/agent"
                className="flex items-center gap-1.5 border-2 border-transparent bg-[#CCFF00] px-3 py-1.5 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[2px_2px_0px_#000000] transition-all hover:-translate-y-[1px] hover:border-[#000000] active:translate-y-[1px] active:shadow-none"
                title="Shop as Human with Gemini AI Agent"
              >
                <span>👤 Human</span>
              </a>
              <button
                type="button"
                onClick={() => setMcpModalOpen(true)}
                className="flex items-center gap-1.5 border-2 border-transparent px-3 py-1.5 text-xs font-black uppercase tracking-wider text-[#000000] transition-all hover:bg-[#F4F4F0] hover:border-[#000000]"
                title="Connect Autonomous WebMCP Agent"
              >
                <span>🤖 Agent</span>
                <span className="rounded bg-[#000000] px-1 py-0.5 text-[9px] font-bold text-[#FFFFFF]">
                  MCP
                </span>
              </button>
            </div>

            <a
              href="/order"
              className="border-[3px] border-[#000000] bg-[#FFFFFF] px-3 py-2 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[3px_3px_0px_#000000] transition-all hover:-translate-y-[1px] hover:shadow-[4px_5px_0px_#000000] active:translate-y-[1px] active:shadow-none"
            >
              📦 Orders
            </a>

            <a
              href="/upi-sbmd"
              className="border-[3px] border-[#000000] bg-[#FFFFFF] px-3 py-2 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[3px_3px_0px_#000000] transition-all hover:-translate-y-[1px] hover:shadow-[4px_5px_0px_#000000] active:translate-y-[1px] active:shadow-none"
            >
              UPI SBMD Sandbox
            </a>

            {customer && (
              <span className="hidden items-center gap-1.5 border-2 border-[#000000] bg-[#FFFFFF] px-2.5 py-1.5 text-xs font-bold text-[#000000] shadow-[2px_2px_0px_#000000] md:inline-flex">
                <span className="h-2 w-2 bg-[#000000]" />
                {customer.name}
              </span>
            )}

            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative flex items-center gap-2 border-[3px] border-[#000000] bg-[#FF0055] px-4 py-2 text-xs font-black uppercase tracking-wider text-[#FFFFFF] shadow-[3px_3px_0px_#000000] transition-all hover:-translate-y-[1px] hover:shadow-[4px_5px_0px_#000000] active:translate-y-[1px] active:shadow-none"
            >
              🛒 Cart
              {totalQty > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center border-2 border-[#000000] bg-[#CCFF00] px-1 text-[11px] font-black text-[#000000]">
                  {totalQty}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Hero Banner with Quick Selector */}
        <div className="mt-6 border-[3px] border-[#000000] bg-[#FFFFFF] p-5 shadow-[5px_5px_0px_#000000]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="border-2 border-[#000000] bg-[#CCFF00] px-2 py-0.5 text-[11px] font-black uppercase text-[#000000]">
                Dual Mode Ready
              </span>
              <h2 className="mt-2 text-lg font-black uppercase tracking-tight text-[#000000]">
                Choose your shopping mode
              </h2>
              <p className="mt-0.5 text-xs font-medium text-[#000000]/70">
                Shop with AI chat assistance or connect autonomous WebMCP agents for instant mandate-backed checkouts.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/agent"
                className="flex items-center gap-2 border-[3px] border-[#000000] bg-[#CCFF00] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[3px_3px_0px_#000000] transition-all hover:-translate-y-[1px] hover:shadow-[4px_5px_0px_#000000] active:translate-y-[1px] active:shadow-none"
              >
                <span>👤 Shop as Human (/agent)</span>
                <span>→</span>
              </a>
              <button
                type="button"
                onClick={() => setMcpModalOpen(true)}
                className="flex items-center gap-2 border-[3px] border-[#000000] bg-[#000000] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-[#FFFFFF] shadow-[3px_3px_0px_#000000] transition-all hover:-translate-y-[1px] hover:bg-[#222222] hover:shadow-[4px_5px_0px_#000000] active:translate-y-[1px] active:shadow-none"
              >
                <span>🤖 Connect Agent (MCP Config)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Main Grid: Products + Activity Panel */}
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Product grid */}
          <section className="lg:col-span-2">
            <div className="flex items-center justify-between border-b-2 border-[#000000] pb-2">
              <h2 className="text-sm font-black uppercase tracking-wider text-[#000000]">
                Featured Products ({products.length})
              </h2>
              <span className="text-xs font-bold text-[#000000]/60">
                Pay with UPI Reserve Pay
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
              {products.map((product) => (
                <article
                  key={product.id}
                  className="flex flex-col justify-between border-[3px] border-[#000000] bg-[#FFFFFF] shadow-[5px_5px_0px_#000000] transition-all duration-150 hover:-translate-y-[2px] hover:shadow-[7px_7px_0px_#000000]"
                >
                  <div>
                    <div className="relative border-b-[3px] border-[#000000] bg-[#F4F4F0]">
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="h-44 w-full object-cover"
                      />
                      <span className="absolute bottom-2 left-2 border-2 border-[#000000] bg-[#CCFF00] px-2 py-0.5 text-[10px] font-black uppercase text-[#000000] shadow-[2px_2px_0px_#000000]">
                        {product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}
                      </span>
                    </div>
                    <div className="p-4">
                      <h3 className="text-base font-black uppercase tracking-tight text-[#000000]">
                        {product.name}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-xs font-medium text-[#000000]/70">
                        {product.description}
                      </p>
                    </div>
                  </div>

                  <div className="border-t-2 border-[#000000] p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]/60">
                          Price
                        </span>
                        <p className="text-xl font-black text-[#000000]">
                          {formatPaise(product.price_paise)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={product.stock === 0}
                        onClick={() => add(product.id, 1)}
                        className="border-[3px] border-[#000000] bg-[#000000] px-4 py-2 text-xs font-black uppercase tracking-wider text-[#FFFFFF] shadow-[3px_3px_0px_#000000] transition-all duration-150 hover:-translate-y-[1px] hover:bg-[#CCFF00] hover:text-[#000000] active:translate-y-[1px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {product.stock === 0 ? "Sold Out" : "+ Add to Cart"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* Agent activity log aside */}
          <aside className="lg:col-span-1">
            <div className="lg:sticky lg:top-6">
              <AgentActivityPanel open={logOpen} onToggle={() => setLogOpen((v) => !v)} />
            </div>
          </aside>
        </div>
      </div>

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
                    onClick={copyMcpConfig}
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

      {/* Cart Drawer */}
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        products={products}
        onCheckout={() => void handleCheckout()}
        checkoutState={checkoutState}
        checkoutError={checkoutError}
        pendingCustomer={pendingCustomer}
        authRef={authRef.current}
        onProfileSave={(p) => handleProfileSave(p)}
        onAuthorised={() => void handleAuthorised()}
      />
    </main>
  );
}
