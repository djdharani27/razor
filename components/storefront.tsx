"use client";

import { useCallback, useState } from "react";
import { useCart } from "@/components/cart-context";
import CartDrawer from "@/components/cart-drawer";
import AgentActivityPanel from "@/components/agent-activity-panel";
import WebMCPTools from "@/components/webmcp-tools";
import type { Product } from "@/lib/types";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

export default function Storefront({ products }: { products: Product[] }) {
  const { add, items, totalQty } = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [checkoutState, setCheckoutState] = useState<"idle" | "loading" | "error">("idle");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const handleCheckout = useCallback(async () => {
    if (items.length === 0) return;
    setCheckoutState("loading");
    setCheckoutError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = (await res.json()) as {
        orderId?: number;
        paymentLinkUrl?: string;
        error?: string;
        code?: string;
      };

      if (!res.ok) {
        // Graceful rejection (spend cap, stock, etc.) — show the message.
        setCheckoutError(
          data.error ?? `Checkout failed with status ${res.status}.`
        );
        setCheckoutState("error");
        return;
      }

      if (data.paymentLinkUrl) {
        window.open(data.paymentLinkUrl, "_blank", "noopener,noreferrer");
      }
      // Navigate to the confirmation page after the link opens.
      window.location.href = `/order/${data.orderId}`;
    } catch {
      setCheckoutError("Network error while reaching the checkout API.");
      setCheckoutState("error");
    }
  }, [items]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* WebMCP tool registration — no-op in browsers without modelContext */}
      <WebMCPTools />

      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">AgentStore</h1>
          <p className="text-sm text-zinc-400">
            AI-agent-friendly commerce demo · Razorpay test-mode payments
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/agent"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            💬 Chat with Agent
          </a>
          <a
            href="/upi-sbmd"
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white"
          >
            UPI Reserve Pay SBMD sandbox
          </a>
          <span className="rounded-full border border-emerald-900 bg-emerald-950/50 px-3 py-1 text-xs font-medium text-emerald-300">
            ● WebMCP tools registered
          </span>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="relative rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            Cart
            {totalQty > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-xs font-bold text-zinc-900">
                {totalQty}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Product grid */}
        <section className="lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Products ({products.length})
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {products.map((product) => (
              <article
                key={product.id}
                className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60"
              >
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="h-44 w-full object-cover"
                />
                <div className="p-4">
                  <h3 className="font-semibold text-zinc-100">{product.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-zinc-400">
                    {product.description}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <p className="text-lg font-bold text-zinc-100">
                        {formatPaise(product.price_paise)}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={product.stock === 0}
                      onClick={() => add(product.id, 1)}
                      className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {product.stock === 0 ? "Out of stock" : "Add to cart"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Agent activity log */}
        <aside className="lg:col-span-1">
          <div className="lg:sticky lg:top-6">
            <AgentActivityPanel open={logOpen} onToggle={() => setLogOpen((v) => !v)} />
          </div>
        </aside>
      </div>

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        products={products}
        onCheckout={() => void handleCheckout()}
        checkoutState={checkoutState}
        checkoutError={checkoutError}
      />
    </main>
  );
}
