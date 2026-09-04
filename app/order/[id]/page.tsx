"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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

const STATUS_LABEL: Record<OrderData["status"], string> = {
  created: "Processing payment",
  paid: "Paid",
  failed: "Payment failed",
};

const STATUS_STYLE: Record<OrderData["status"], string> = {
  created: "border-2 border-[#000000] bg-[#FEF08A] text-[#000000] shadow-[2px_2px_0px_#000000]",
  paid: "border-2 border-[#000000] bg-[#CCFF00] text-[#000000] shadow-[2px_2px_0px_#000000]",
  failed: "border-2 border-[#000000] bg-[#FF0055] text-[#FFFFFF] shadow-[2px_2px_0px_#000000]",
};

export default function OrderPage({ params }: { params: { id: string } }) {
  const orderId = Number(params.id);
  const [order, setOrder] = useState<OrderData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  // Poll order status until it leaves the "created" state (the debit is created
  // server-side, so this usually resolves on the first fetch).
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

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center bg-[#F4F4F0] px-4 text-[#000000]">
        <div className="border-[3px] border-[#000000] bg-[#FFFFFF] p-6 text-center shadow-[5px_5px_0px_#000000]">
          <p className="font-bold text-[#FF0055]">{error}</p>
          <Link
            href="/"
            className="mt-4 inline-block border-2 border-[#000000] bg-[#CCFF00] px-4 py-2 text-xs font-black uppercase text-[#000000] shadow-[2px_2px_0px_#000000]"
          >
            ← Back to store
          </Link>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center bg-[#F4F4F0] px-4 text-[#000000]">
        <div className="border-[3px] border-[#000000] bg-[#FFFFFF] p-6 text-center shadow-[5px_5px_0px_#000000]">
          <p className="font-black uppercase tracking-tight text-[#000000]">
            Loading order #{orderId}…
          </p>
        </div>
      </main>
    );
  }

  const byId = new Map(products.map((p) => [p.id, p]));

  return (
    <main className="min-h-screen bg-[#F4F4F0] px-4 py-12 text-[#000000]">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 border-[3px] border-[#000000] bg-[#FFFFFF] px-3.5 py-1.5 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[3px_3px_0px_#000000] transition-all hover:-translate-y-[1px] hover:shadow-[4px_5px_0px_#000000] active:translate-y-[1px] active:shadow-none"
        >
          ← Back to store
        </Link>

        <div className="mt-6 border-[3px] border-[#000000] bg-[#FFFFFF] p-6 shadow-[6px_6px_0px_#000000]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#000000] pb-4">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-[#000000]/60">
                Order Receipt
              </span>
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#000000]">
                Order #{order.id}
              </h1>
            </div>
            <span
              className={`inline-block px-3 py-1 text-xs font-black uppercase tracking-wider ${STATUS_STYLE[order.status]}`}
            >
              {STATUS_LABEL[order.status]}
            </span>
          </div>

          {order.status === "paid" && (
            <div className="mt-4 border-2 border-[#000000] bg-[#CCFF00] p-3 text-xs font-bold text-[#000000]">
              🎉 Payment captured from your UPI Reserve Pay block — zero PIN required!
            </div>
          )}
          {order.status === "created" && (
            <div className="mt-4 border-2 border-[#000000] bg-[#FEF08A] p-3 text-xs font-bold text-[#000000]">
              ⏳ Confirming your payment with Razorpay — this page refreshes automatically.
            </div>
          )}
          {order.status === "failed" && (
            <div className="mt-4 border-2 border-[#000000] bg-[#FF0055] p-3 text-xs font-bold text-[#FFFFFF]">
              ⚠️ The debit could not be completed. Please try again.
            </div>
          )}

          <section className="mt-6">
            <h2 className="border-b border-[#000000]/20 pb-1 text-xs font-black uppercase tracking-wider text-[#000000]">
              Purchased Items
            </h2>
            <ul className="mt-3 space-y-2.5">
              {order.items.map((item) => {
                const product = byId.get(item.productId);
                return (
                  <li
                    key={item.productId}
                    className="flex items-center justify-between border-b border-[#000000]/10 pb-2 text-sm"
                  >
                    <span className="font-bold text-[#000000]">
                      {product ? product.name : `Product #${item.productId}`}
                      <span className="ml-1 text-xs font-normal text-[#000000]/60">
                        × {item.qty}
                      </span>
                    </span>
                    <span className="font-black text-[#000000]">
                      {product ? formatPaise(product.price_paise * item.qty) : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 flex items-center justify-between border-t-2 border-[#000000] pt-4">
              <span className="text-sm font-black uppercase text-[#000000]">Total Paid</span>
              <span className="text-2xl font-black text-[#000000]">
                {formatPaise(order.amountPaise)}
              </span>
            </div>
          </section>

          <p className="mt-6 border-t border-[#000000]/10 pt-3 text-[11px] font-bold text-[#000000]/60">
            Placed on {new Date(order.createdAt).toLocaleString("en-IN")} · Razorpay UPI Reserve Pay (SBMD)
          </p>
        </div>
      </div>
    </main>
  );
}
