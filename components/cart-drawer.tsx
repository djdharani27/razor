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
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l-4 border-[#000000] bg-[#F4F4F0] shadow-[-8px_0px_0px_rgba(0,0,0,0.2)] transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
      >
        <header className="flex items-center justify-between border-b-4 border-[#000000] bg-[#FFFFFF] px-5 py-4">
          <h2 className="text-base font-black uppercase tracking-tight text-[#000000]">
            Your Cart{" "}
            <span className="ml-1 border-2 border-[#000000] bg-[#CCFF00] px-1.5 py-0.5 text-xs font-black text-[#000000]">
              {totalQty} item{totalQty === 1 ? "" : "s"}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center border-2 border-[#000000] bg-[#FF0055] font-black text-xs text-[#FFFFFF] shadow-[2px_2px_0px_#000000] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <div className="mt-8 border-[3px] border-dashed border-[#000000]/40 bg-[#FFFFFF] p-6 text-center">
              <span className="text-3xl">🛒</span>
              <p className="mt-2 text-sm font-black uppercase text-[#000000]">
                Your cart is empty
              </p>
              <p className="mt-1 text-xs font-medium text-[#000000]/60">
                Ask the AI agent in /agent or add items from the catalog.
              </p>
            </div>
          ) : (
            <>
              <ul className="space-y-3">
                {items.map((item) => {
                  const product = byId.get(item.productId);
                  if (!product) return null;
                  return (
                    <li
                      key={item.productId}
                      className="flex items-center gap-3 border-[3px] border-[#000000] bg-[#FFFFFF] p-3 shadow-[3px_3px_0px_#000000]"
                    >
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="h-14 w-14 border-2 border-[#000000] object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black uppercase text-[#000000]">
                          {product.name}
                        </p>
                        <p className="text-xs font-bold text-[#000000]/60">
                          {formatPaise(product.price_paise)} × {item.qty}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black text-[#000000]">
                          {formatPaise(product.price_paise * item.qty)}
                        </p>
                        <button
                          type="button"
                          onClick={() => remove(item.productId)}
                          className="mt-1 border border-[#000000] bg-[#FFF0F3] px-1.5 py-0.5 text-[10px] font-black uppercase text-[#FF0055] hover:bg-[#FF0055] hover:text-[#FFFFFF]"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* First-checkout profile step */}
              {needsProfile && (
                <div className="mt-5 border-t-2 border-[#000000] pt-4">
                  <CustomerProfileForm
                    compact
                    onSave={onProfileSave}
                  />
                </div>
              )}

              {/* Authorisation step */}
              {needsAuthorisation && authRef && (
                <div className="mt-5 border-t-2 border-[#000000] pt-4">
                  <div className="mb-3 border-2 border-[#000000] bg-[#CCFF00] p-3 shadow-[2px_2px_0px_#000000]">
                    <p className="text-xs font-black uppercase text-[#000000]">
                      ⚡ One-Time Mandate Required:
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-[#000000]/80">
                      Approve a ₹1 UPI block in Razorpay Checkout so future debits happen without entering a PIN.
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

        <footer className="border-t-4 border-[#000000] bg-[#FFFFFF] px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-[#000000]/70">
              Total Due
            </span>
            <span className="text-2xl font-black text-[#000000]">{formatPaise(totalPaise)}</span>
          </div>

          {checkoutError && (
            <div className="mb-3 border-2 border-[#FF0055] bg-[#FFF0F3] p-2.5 text-xs font-bold text-[#FF0055]">
              {checkoutError}
            </div>
          )}

          <button
            type="button"
            disabled={items.length === 0 || checkoutState === "loading" || needsAuthorisation}
            onClick={onCheckout}
            className="w-full border-[3px] border-[#000000] bg-[#CCFF00] px-4 py-3 text-sm font-black uppercase tracking-wider text-[#000000] shadow-[4px_4px_0px_#000000] transition-all hover:-translate-y-[1px] hover:shadow-[4px_6px_0px_#000000] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {btnLabel}
          </button>
          <p className="mt-2 text-center text-[11px] font-bold text-[#000000]/60">
            Powered by Razorpay UPI Reserve Pay (SBMD)
          </p>
        </footer>
      </aside>
    </div>
  );
}
