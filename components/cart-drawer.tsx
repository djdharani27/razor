"use client";

import { useCart } from "@/components/cart-context";
import type { Product } from "@/lib/types";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  onCheckout: () => void;
  checkoutState: "idle" | "loading" | "error";
  checkoutError: string | null;
}

export default function CartDrawer({
  open,
  onClose,
  products,
  onCheckout,
  checkoutState,
  checkoutError,
}: CartDrawerProps) {
  const { items, remove, totalQty } = useCart();
  const byId = new Map(products.map((p) => [p.id, p]));
  const totalPaise = items.reduce((sum, i) => {
    const p = byId.get(i.productId);
    return sum + (p ? p.price_paise * i.qty : 0);
  }, 0);

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity ${open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close cart"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
        tabIndex={open ? 0 : -1}
      />

      {/* Panel */}
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-lg font-semibold text-zinc-100">
            Your Cart{" "}
            <span className="text-sm font-normal text-zinc-400">
              ({totalQty} item{totalQty === 1 ? "" : "s"})
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <p className="mt-8 text-center text-sm text-zinc-500">
              Your cart is empty. Ask the agent to add something, or browse below.
            </p>
          ) : (
            <ul className="space-y-4">
              {items.map((item) => {
                const product = byId.get(item.productId);
                if (!product) return null;
                return (
                  <li key={item.productId} className="flex items-center gap-4">
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="h-14 w-14 rounded-lg object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">{product.name}</p>
                      <p className="text-xs text-zinc-400">
                        {formatPaise(product.price_paise)} × {item.qty}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-zinc-100">
                      {formatPaise(product.price_paise * item.qty)}
                    </p>
                    <button
                      type="button"
                      onClick={() => remove(item.productId)}
                      className="rounded-md px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-red-400"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="border-t border-zinc-800 px-5 py-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-zinc-400">Total</span>
            <span className="text-lg font-semibold text-zinc-100">{formatPaise(totalPaise)}</span>
          </div>

          {checkoutError && (
            <p className="mb-3 rounded-md border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {checkoutError}
            </p>
          )}

          <button
            type="button"
            disabled={items.length === 0 || checkoutState === "loading"}
            onClick={onCheckout}
            className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checkoutState === "loading" ? "Creating payment link…" : "Checkout with Razorpay"}
          </button>
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            Test mode — use card 4111 1111 1111 1111, any future expiry &amp; CVV.
          </p>
        </footer>
      </aside>
    </div>
  );
}
