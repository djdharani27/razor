"use client";

import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useState } from "react";
import type { CartItem, Product } from "@/lib/types";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

interface OrderData {
  id: number;
  status: "created" | "paid" | "failed";
  amountPaise: number;
  items: CartItem[];
  createdAt: number;
}

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

type RazorpayConstructor = new (options: Record<string, unknown>) => {
  open: () => void;
  on: (event: string, handler: (res: { error?: { description?: string } }) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

const STATUS_LABEL: Record<OrderData["status"], string> = {
  created: "Awaiting payment",
  paid: "Paid",
  failed: "Payment failed",
};

const STATUS_STYLE: Record<OrderData["status"], string> = {
  created: "border-amber-800 bg-amber-950/40 text-amber-300",
  paid: "border-emerald-800 bg-emerald-950/40 text-emerald-300",
  failed: "border-red-800 bg-red-950/40 text-red-300",
};

export default function OrderPage({ params }: { params: { id: string } }) {
  const orderId = Number(params.id);
  const [order, setOrder] = useState<OrderData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Poll order status until it leaves the "created" state.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          if (!cancelled) setError(data.error ?? "Order not found.");
          return;
        }
        const data = (await res.json()) as OrderData;
        if (!cancelled) {
          setOrder(data);
          if (data.status !== "created" && timer) clearInterval(timer);
        }
      } catch {
        // transient error — keep polling
      }
    };

    void tick();
    timer = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [orderId]);

  // Load product details for the ordered items.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/products", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ products: Product[] }>) : null))
      .then((data) => {
        if (!cancelled && data) setProducts(data.products);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePayment = useCallback(async () => {
    if (!order || paying) return;
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: order.items.map((i) => ({ productId: i.productId, qty: i.qty })),
        }),
      });
      const data = (await res.json()) as {
        orderId?: number;
        razorpayOrderId?: string;
        amount?: number;
        currency?: string;
        keyId?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok || !data.razorpayOrderId || !data.keyId) {
        throw new Error(data.error ?? `Checkout failed with status ${res.status}.`);
      }

      const razorpay = typeof window !== "undefined" ? window.Razorpay : undefined;
      if (!razorpay) throw new Error("Razorpay checkout failed to load.");

      const rzp = new razorpay({
        key: data.keyId,
        amount: data.amount,
        currency: data.currency ?? "INR",
        name: "AgentStore",
        description: `Order #${data.orderId} — Razorpay test mode`,
        order_id: data.razorpayOrderId,
        handler: async (response: RazorpayResponse) => {
          try {
            const verifyRes = await fetch("/api/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId: data.orderId,
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            const verifyData = (await verifyRes.json()) as { ok?: boolean; error?: string };
            if (!verifyRes.ok || !verifyData.ok) {
              throw new Error(verifyData.error ?? "Payment verification failed.");
            }
            // Re-fetch status — the poll will see "paid" and stop.
            setPaying(false);
          } catch (err) {
            setPayError(err instanceof Error ? err.message : "Payment verification failed.");
            setPaying(false);
          }
        },
        modal: {
          ondismiss: () => setPaying(false),
        },
        theme: { color: "#4f46e5" },
      });
      rzp.on("payment.failed", (res) => {
        setPayError(res.error?.description ?? "Payment failed.");
        setPaying(false);
      });
      rzp.open();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Checkout failed.");
      setPaying(false);
    }
  }, [order, paying]);

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4">
        <p className="text-red-400">{error}</p>
        <Link href="/" className="mt-4 text-sm text-indigo-400 hover:text-indigo-300">
          ← Back to store
        </Link>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-4">
        <p className="text-zinc-400">Loading order #{orderId}…</p>
      </main>
    );
  }

  const byId = new Map(products.map((p) => [p.id, p]));

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onError={() => setScriptLoaded(false)}
      />

      <Link href="/" className="text-sm text-indigo-400 hover:text-indigo-300">
        ← Back to store
      </Link>

      <h1 className="mt-6 text-2xl font-bold text-zinc-100">Order #{order.id}</h1>

      <span
        className={`mt-3 inline-block rounded-full border px-3 py-1 text-sm font-medium ${STATUS_STYLE[order.status]}`}
      >
        {STATUS_LABEL[order.status]}
      </span>

      {order.status === "created" && (
        <p className="mt-3 text-sm text-zinc-400">
          This page refreshes automatically once payment is confirmed.
        </p>
      )}

      {order.status === "created" && (
        <button
          type="button"
          onClick={handlePayment}
          disabled={paying || !scriptLoaded}
          className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {paying
            ? "Opening payment…"
            : scriptLoaded
              ? `Pay ${formatPaise(order.amountPaise)}`
              : "Loading payment…"}
        </button>
      )}

      {payError && (
        <p className="mt-3 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {payError}
        </p>
      )}

      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Items</h2>
        <ul className="mt-3 space-y-3">
          {order.items.map((item) => {
            const product = byId.get(item.productId);
            return (
              <li key={item.productId} className="flex items-center justify-between text-sm">
                <span className="text-zinc-200">
                  {product ? product.name : `Product #${item.productId}`}
                  <span className="text-zinc-500"> × {item.qty}</span>
                </span>
                <span className="text-zinc-300">
                  {product ? formatPaise(product.price_paise * item.qty) : "—"}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-3 text-sm">
          <span className="text-zinc-400">Total</span>
          <span className="text-lg font-semibold text-zinc-100">
            {formatPaise(order.amountPaise)}
          </span>
        </div>
      </section>

      <p className="mt-6 text-xs text-zinc-500">
        Placed at {new Date(order.createdAt).toLocaleString("en-IN")} · Razorpay test mode
      </p>
    </main>
  );
}
