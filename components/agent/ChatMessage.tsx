"use client";

import PaymentStatus from "./PaymentStatus";

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
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});
function formatPaise(paise: number): string {
  return inr.format(paise / 100);
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
): { items: { name: string; quantity: number; subtotal_paise: number }[]; total_display: string } | null {
  for (const tc of toolCalls) {
    const r = tc.result as Record<string, unknown>;
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
        };
      }
    }
    // Direct cart response (view_cart)
    if (Array.isArray(r?.items) && r?.total_display) {
      return {
        items: (r.items as Record<string, unknown>[]).map((i) => ({
          name: String(i.name),
          quantity: Number(i.quantity),
          subtotal_paise: Number(i.subtotal_paise),
        })),
        total_display: String(r.total_display),
      };
    }
  }
  return null;
}

/** Extract payment status from tool results */
function extractPaymentInfo(
  toolCalls: ToolCall[]
): { status: string; orderId?: string; amount?: string; errorMessage?: string } | null {
  for (const tc of toolCalls) {
    if (tc.name !== "start_payment" && tc.name !== "complete_payment") continue;
    const r = tc.result as Record<string, unknown>;
    if (r?.error) {
      return {
        status: "error",
        errorMessage: String(r.error),
      };
    }
    if (tc.name === "start_payment") {
      return {
        status: "order_created",
        orderId: String(r?.order_id ?? ""),
        amount: String(r?.amount ?? ""),
      };
    }
    if (tc.name === "complete_payment") {
      const s = String(r?.status ?? "");
      return {
        status: s === "scheduled" ? "payment_scheduled" : s === "captured" ? "payment_captured" : "error",
        orderId: String(r?.order_id ?? ""),
        amount: String(r?.amount ?? ""),
        errorMessage: s === "error" ? String(r?.message ?? "") : undefined,
      };
    }
  }
  return null;
}

export default function ChatMessage({
  role,
  text,
  toolCalls = [],
  isLoading = false,
}: ChatMessageProps) {
  const isUser = role === "user";
  const products = extractProducts(toolCalls);
  const cart = extractCart(toolCalls);
  const payment = extractPaymentInfo(toolCalls);

  return (
    <div
      className={`flex w-full gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${
          isUser
            ? "bg-indigo-600 text-white"
            : "bg-gradient-to-br from-emerald-500 to-teal-600 text-white"
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
            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              isUser
                ? "rounded-tr-md bg-indigo-600 text-white"
                : "rounded-tl-md bg-zinc-800/80 text-zinc-100"
            }`}
          >
            {isLoading ? (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: "0ms" }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: "150ms" }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: "300ms" }} />
              </div>
            ) : (
              <div className="whitespace-pre-wrap">{text}</div>
            )}
          </div>
        )}

        {/* Product cards */}
        {products.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <div
                key={p.id}
                className="w-56 overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-900/80"
              >
                <img
                  src={p.image_url}
                  alt={p.name}
                  className="h-28 w-full object-cover"
                />
                <div className="p-3">
                  <h4 className="text-sm font-semibold text-zinc-100 truncate">
                    {p.name}
                  </h4>
                  <p className="mt-0.5 text-xs text-zinc-400 line-clamp-2">
                    {p.description}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-bold text-zinc-100">
                      {formatPaise(p.price_paise)}
                    </span>
                    <span className="text-xs text-zinc-500">
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
          <div className="w-full max-w-sm rounded-xl border border-zinc-700/50 bg-zinc-900/80 p-3">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              🛒 Cart
            </h4>
            <div className="mt-2 flex flex-col gap-1">
              {cart.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300">
                    {item.quantity}x {item.name}
                  </span>
                  <span className="text-zinc-400">
                    {formatPaise(item.subtotal_paise)}
                  </span>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between border-t border-zinc-800 pt-1 text-sm font-semibold">
                <span className="text-zinc-200">Total</span>
                <span className="text-zinc-100">{cart.total_display}</span>
              </div>
            </div>
          </div>
        )}

        {/* Payment status */}
        {payment && (
          <div className="w-full max-w-sm">
            <PaymentStatus
              status={payment.status}
              orderId={payment.orderId}
              amount={payment.amount}
              errorMessage={payment.errorMessage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
