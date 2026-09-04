"use client";

import { useCallback, useState } from "react";
import PaymentStatus from "./PaymentStatus";
import AuthoriseCard from "./AuthoriseCard";
import type { CustomerProfile } from "@/components/customer-profile";
import type { AuthoriseResult } from "@/components/rzp-authorise-button";

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface ChatMessageProps {
  role: "user" | "model";
  text: string;
  toolCalls?: ToolCall[];
  isLoading?: boolean;
  /** The customer profile saved in localStorage — enables the authorise card. */
  customer?: CustomerProfile | null;
  /** Agent session id — lets the server complete parked debits after approval. */
  sessionId?: string | null;
  /** Called after a successful authorisation so the parent can append a
   *  system-style "payment captured" confirmation message. */
  onAuthoriseDone?: (result: AuthoriseResult & { amountPaise?: number }) => void;
  /** Send message back into chat (e.g. from the Pay button). */
  onSendMessage?: (message: string) => void;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});
function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

interface AuthorisePayload {
  orderId: string;
  customerId: string;
  keyId: string;
  blockPaise: number;
  expireAt: number;
  amountPaise: number;
}

/** Extract product cards from tool results */
function extractProducts(
  toolCalls: ToolCall[]
): { id: number; name: string; description: string; price: string; price_paise: number; stock: number; image_url: string }[] {
  const products: ReturnType<typeof extractProducts> = [];
  for (const tc of toolCalls) {
    const r = tc.result as Record<string, unknown>;
    if (Array.isArray(r?.products)) {
      for (const p of r.products as Record<string, unknown>[]) {
        products.push({
          id: Number(p.id),
          name: String(p.name ?? ""),
          description: String(p.description ?? ""),
          price: String(p.price ?? ""),
          price_paise: Number(p.price_paise ?? 0),
          stock: Number(p.stock ?? 0),
          image_url: String(p.image_url ?? ""),
        });
      }
    }
    // Single product
    if (r?.name && r?.price_paise && tc.name === "get_product") {
      products.push({
        id: Number(r.id),
        name: String(r.name),
        description: String(r.description ?? ""),
        price: String(r.price ?? ""),
        price_paise: Number(r.price_paise),
        stock: Number(r.stock ?? 0),
        image_url: String(r.image_url ?? ""),
      });
    }
  }
  return products;
}

/** Extract cart info from tool results */
function extractCart(
  toolCalls: ToolCall[]
): { items: { name: string; quantity: number; subtotal_paise: number }[]; total_display: string; isCheckout?: boolean } | null {
  for (const tc of toolCalls) {
    const r = tc.result as Record<string, unknown>;
    const isCheckout = tc.name === "checkout" || r?.isCheckout === true;
    if (r?.cart && typeof r.cart === "object") {
      const cart = r.cart as Record<string, unknown>;
      if (Array.isArray(cart.items)) {
        return {
          items: (cart.items as Record<string, unknown>[]).map((i) => ({
            name: String(i.name),
            quantity: Number(i.quantity),
            subtotal_paise: Number(i.subtotal_paise),
          })),
          total_display: String(cart.total_display ?? ""),
          isCheckout,
        };
      }
    }
    // Direct cart response (view_cart or checkout)
    if (Array.isArray(r?.items) && r?.total_display) {
      return {
        items: (r.items as Record<string, unknown>[]).map((i) => ({
          name: String(i.name),
          quantity: Number(i.quantity),
          subtotal_paise: Number(i.subtotal_paise),
        })),
        total_display: String(r.total_display),
        isCheckout,
      };
    }
  }
  return null;
}

interface PaymentToolInfo {
  status: string;
  orderId?: number;
  rzpOrderId?: string;
  amount?: string;
  amountPaise?: number;
  errorMessage?: string;
}

/** Extract payment status from pay_cart_now / remember_customer tool results. */
function extractPaymentInfo(toolCalls: ToolCall[]): PaymentToolInfo | null {
  for (const tc of toolCalls) {
    if (tc.name !== "pay_cart_now" && tc.name !== "remember_customer") continue;
    const r = tc.result as Record<string, unknown>;
    if (tc.name === "remember_customer") {
      if (r?.saved) {
        return { status: "customer_saved", amount: undefined };
      }
      if (r?.error) {
        return { status: "error", errorMessage: String(r.error) };
      }
      continue;
    }
    const status = String(r?.status ?? "");
    if (status === "needs_authorisation") continue; // rendered as AuthoriseCard
    if (r?.error || status === "failed") {
      return {
        status: "failed",
        errorMessage: String(r?.error ?? r?.message ?? ""),
        amountPaise: Number(r?.amount_paise ?? 0) || undefined,
      };
    }
    if (status === "captured") {
      return {
        status: "captured",
        orderId: Number(r?.orderId ?? 0) || undefined,
        rzpOrderId: String(r?.rzpOrderId ?? ""),
        amount: String(r?.amount ?? ""),
        amountPaise: Number(r?.amount_paise ?? 0) || undefined,
      };
    }
  }
  return null;
}

interface AuthoriseHandoff {
  auth: AuthorisePayload;
  amountPaise: number;
  amountDisplay: string;
  pendingDebit: { items: { productId: number; qty: number }[]; amountPaise: number; description?: string; receipt?: string };
}

/** Extract a needs_authorisation handoff from pay_cart_now. */
function extractAuthoriseHandoff(toolCalls: ToolCall[]): AuthoriseHandoff | null {
  for (const tc of toolCalls) {
    if (tc.name !== "pay_cart_now") continue;
    const r = tc.result as Record<string, unknown>;
    if (r?.status !== "needs_authorisation") continue;
    const auth = r.auth as AuthorisePayload | undefined;
    if (!auth?.orderId || !auth?.customerId || !auth?.keyId) return null;
    const amountPaise = Number(r.amount_paise ?? auth.amountPaise ?? 0) || 0;
    const pendingDebit = (r.pendingDebit ?? {}) as Record<string, unknown>;
    const rawItems = Array.isArray(pendingDebit.items) ? (pendingDebit.items as Record<string, unknown>[]) : [];
    return {
      auth: {
        orderId: String(auth.orderId),
        customerId: String(auth.customerId),
        keyId: String(auth.keyId),
        blockPaise: Number(auth.blockPaise ?? 0),
        expireAt: Number(auth.expireAt ?? 0),
        amountPaise: Number(auth.amountPaise ?? 0) || 0,
      },
      amountPaise,
      amountDisplay: String(r.amount ?? formatPaise(amountPaise)),
      pendingDebit: {
        items: rawItems.map((i) => ({ productId: Number(i.productId), qty: Number(i.qty) })),
        amountPaise,
        description: pendingDebit.description ? String(pendingDebit.description) : undefined,
        receipt: pendingDebit.receipt ? String(pendingDebit.receipt) : undefined,
      },
    };
  }
  return null;
}

export default function ChatMessage({
  role,
  text,
  toolCalls = [],
  isLoading = false,
  customer,
  sessionId,
  onAuthoriseDone,
  onSendMessage,
}: ChatMessageProps) {
  const isUser = role === "user";
  const products = extractProducts(toolCalls);
  const cart = extractCart(toolCalls);
  const payment = extractPaymentInfo(toolCalls);
  const handoff = extractAuthoriseHandoff(toolCalls);
  const [authorised, setAuthorised] = useState(false);

  const handleAuthoriseDone = useCallback(
    (result: AuthoriseResult) => {
      setAuthorised(true);
      if (result.kind === "success" && onAuthoriseDone) {
        onAuthoriseDone({ ...result, amountPaise: handoff?.amountPaise });
      }
    },
    [onAuthoriseDone, handoff]
  );

  return (
    <div
      className={`flex w-full gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center border-[3px] border-[#000000] text-sm font-black shadow-[2px_2px_0px_#000000] ${
          isUser ? "bg-[#FF5500] text-[#000000]" : "bg-[#000000] text-[#F4F4F0]"
        }`}
      >
        {isUser ? "U" : "🤖"}
      </div>

      {/* Message bubble */}
      <div
        className={`flex max-w-[80%] flex-col gap-2 ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        {/* Text content */}
        {(text || isLoading) && (
          <div
            className={`border-[3px] border-[#000000] px-4 py-2.5 text-sm font-medium leading-relaxed text-[#000000] ${
              isUser
                ? "bg-[#CCFF00] shadow-[4px_4px_0px_#000000]"
                : "bg-[#FFFFFF] shadow-[4px_4px_0px_#000000]"
            }`}
          >
            {isLoading ? (
              <div className="flex items-center gap-1.5 py-0.5">
                <span className="thinking-dot h-2.5 w-2.5 rounded-full bg-[#FF0055]" style={{ animationDelay: "0ms" }} />
                <span className="thinking-dot h-2.5 w-2.5 rounded-full bg-[#FF0055]" style={{ animationDelay: "150ms" }} />
                <span className="thinking-dot h-2.5 w-2.5 rounded-full bg-[#FF0055]" style={{ animationDelay: "300ms" }} />
              </div>
            ) : (
              <div className="whitespace-pre-wrap">{text}</div>
            )}
          </div>
        )}

        {/* Product cards */}
        {products.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {products.map((p, i) => (
              <div
                key={p.id}
                className="animate-fade-up w-56 border-[3px] border-[#000000] bg-[#FFFFFF] shadow-[4px_4px_0px_#000000]"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <img
                  src={p.image_url}
                  alt={p.name}
                  className="h-28 w-full border-b-[3px] border-[#000000] object-cover"
                />
                <div className="p-3">
                  <h4 className="truncate text-sm font-black uppercase tracking-tight text-[#000000]">
                    {p.name}
                  </h4>
                  <p className="mt-0.5 line-clamp-2 text-xs text-[#000000]/70">
                    {p.description}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="border-2 border-[#000000] bg-[#F4F4F0] px-1.5 py-0.5 text-sm font-black text-[#000000]">
                      {formatPaise(p.price_paise)}
                    </span>
                    <span className="text-xs font-bold text-[#000000]/60">
                      {p.stock > 0 ? `${p.stock} left` : "Out of stock"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Cart summary */}
        {cart && cart.items.length > 0 && (
          <div className="animate-fade-up w-full max-w-sm border-[3px] border-[#000000] bg-[#FFFFFF] p-3 shadow-[4px_4px_0px_#000000]">
            <h4 className="flex items-center gap-2 border-b-2 border-[#000000] pb-1.5 text-sm font-black uppercase tracking-tight text-[#000000]">
              {cart.isCheckout ? "💳 Checkout" : "🛒 Cart"}
            </h4>
            <div className="mt-2 flex flex-col gap-1">
              {cart.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#000000]/80">
                    {item.quantity}x {item.name}
                  </span>
                  <span className="font-bold text-[#000000]/70">
                    {formatPaise(item.subtotal_paise)}
                  </span>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between border-t-2 border-[#000000] pt-1.5 text-sm font-black">
                <span className="uppercase text-[#000000]">Total</span>
                <span className="bg-[#000000] px-1.5 py-0.5 text-[#F4F4F0]">
                  {cart.total_display}
                </span>
              </div>
            </div>

            {/* Pay button - only when checkout */}
            {cart.isCheckout && (
              <button
                type="button"
                onClick={() => onSendMessage?.("Pay")}
                className="mt-3 flex w-full items-center justify-center gap-2 border-[3px] border-[#000000] bg-[#CCFF00] py-2.5 text-sm font-black uppercase tracking-wider text-[#000000] shadow-[3px_3px_0px_#000000] transition-all duration-150 hover:-translate-y-[1px] hover:shadow-[4px_5px_0px_#000000] active:translate-y-[2px] active:shadow-[1px_1px_0px_#000000]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M2.5 4A1.5 1.5 0 001 5.5V6h18v-.5A1.5 1.5 0 0017.5 4h-15zM19 8.5H1v6A1.5 1.5 0 002.5 16h15a1.5 1.5 0 001.5-1.5v-6zM3 13.25a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5a.75.75 0 01-.75-.75zm4.75-.75a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z" clipRule="evenodd" />
                </svg>
                <span>Pay {cart.total_display}</span>
              </button>
            )}
          </div>
        )}

        {/* Payment status */}
        {payment && (
          <div className="w-full max-w-sm">
            <PaymentStatus
              status={payment.status}
              orderId={payment.orderId ? String(payment.orderId) : payment.rzpOrderId}
              amount={payment.amount}
              errorMessage={payment.errorMessage}
            />
          </div>
        )}

        {/* Authorisation handoff card */}
        {handoff && customer && !authorised && (
          <div className="w-full max-w-sm">
            <AuthoriseCard
              customer={customer}
              auth={handoff.auth}
              pendingDebit={handoff.pendingDebit}
              sessionId={sessionId}
              onDone={handleAuthoriseDone}
            />
          </div>
        )}
      </div>
    </div>
  );
}
