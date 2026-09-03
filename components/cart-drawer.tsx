"use client";

import { useCart } from "@/components/cart-context";
import type { Product } from "@/lib/types";
import {
  CustomerProfileForm,
  type CustomerProfile,
} from "@/components/customer-profile";
import AuthoriseButton from "@/components/rzp-authorise-button";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  onCheckout: () => void;
  checkoutState: "idle" | "loading" | "error" | "authorising" | "paid";
  checkoutError: string | null;
  /** When set, show the inline profile form (first checkout). */
  pendingCustomer: CustomerProfile | null;
  /** When set (with pendingCustomer), show the "approve your block" button. */
  authRef: {
    orderId: string;
    customerId: string;
    keyId: string;
    blockPaise: number;
    expireAt: number;
    amountPaise: number;
  } | null;
  onProfileSave: (profile: CustomerProfile) => void;
  onAuthorised: () => void;
}

export default function CartDrawer({
  open,
  onClose,
  products,
  onCheckout,
  checkoutState,
  checkoutError,
  pendingCustomer,
  authRef,
  onProfileSave,
  onAuthorised,
}: CartDrawerProps) {
  const { items, remove, totalQty } = useCart();
  const byId = new Map(products.map((p) => [p.id, p]));
  const totalPaise = items.reduce((sum, i) => {
    const p = byId.get(i.productId);
    return sum + (p ? p.price_paise * i.qty : 0);
  }, 0);

  const needsProfile = checkoutState === "authorising" && !!pendingCustomer && !authRef;
  const needsAuthorisation = checkoutState === "authorising" && !!pendingCustomer && !!authRef;

  const btnLabel =
    checkoutState === "loading"
      ? "Processing payment…"
      : needsAuthorisation
        ? "Awaiting UPI authorisation"
        : "Checkout with UPI Reserve Pay";

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
            <>
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

              {/* First-checkout profile step */}
              {needsProfile && (
                <div className="mt-5 border-t border-zinc-800 pt-4">
                  <CustomerProfileForm
                    compact
                    onSave={onProfileSave}
                  />
                </div>
              )}

              {/* Authorisation step */}
              {needsAuthorisation && authRef && (
                <div className="mt-5 border-t border-zinc-800 pt-4">
                  <div className="mb-3 rounded-lg border border-indigo-900/60 bg-indigo-950/30 px-3 py-2">
                    <p className="text-xs text-zinc-300">
                      <span className="font-medium text-indigo-300">One more step:</span> approve a
                      UPI block so your future payments don&apos;t need a PIN. This takes a few
                      seconds in your UPI app.
                    </p>
                  </div>
                  <AuthoriseButton
                    customer={pendingCustomer}
                    auth={authRef}
                    onResult={(result) => {
                      if (result.kind === "success") onAuthorised();
                      // dismissed / failed: keep showing the button so the user can retry.
                    }}
                  />
                </div>
              )}
            </>
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
            disabled={items.length === 0 || checkoutState === "loading" || needsAuthorisation}
            onClick={onCheckout}
            className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {btnLabel}
          </button>
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            Test mode — approve with the sandbox UPI app / test UPI ID.
          </p>
        </footer>
      </aside>
    </div>
  );
}
