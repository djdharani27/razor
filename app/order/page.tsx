"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CartItem, Product } from "@/lib/types";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

interface OrderSummary {
  id: number;
  status: "created" | "paid" | "failed";
  amountPaise: number;
  items: CartItem[];
  createdAt: number;
  paidBy: "agent" | "user";
  paymentId: string | null;
  mandateId: number | null;
  rzpOrderId: string | null;
}

const STATUS_STYLE: Record<OrderSummary["status"], string> = {
  created: "border-2 border-[#000000] bg-[#FEF08A] text-[#000000] shadow-[2px_2px_0px_#000000]",
  paid: "border-2 border-[#000000] bg-[#CCFF00] text-[#000000] shadow-[2px_2px_0px_#000000]",
  failed: "border-2 border-[#000000] bg-[#FF0055] text-[#FFFFFF] shadow-[2px_2px_0px_#000000]",
};

const STATUS_LABEL: Record<OrderSummary["status"], string> = {
  created: "Processing",
  paid: "Paid",
  failed: "Failed",
};

export default function OrdersIndexPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "agent" | "user">("all");
  const [searchId, setSearchId] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [ordersRes, productsRes] = await Promise.all([
          fetch("/api/orders", { cache: "no-store" }),
          fetch("/api/products", { cache: "no-store" }),
        ]);

        if (!ordersRes.ok) {
          throw new Error("Failed to load orders.");
        }

        const ordersData = (await ordersRes.json()) as { orders: OrderSummary[] };
        const productsData = productsRes.ok
          ? ((await productsRes.json()) as { products: Product[] })
          : { products: [] };

        if (!cancelled) {
          setOrders(ordersData.orders ?? []);
          setProducts(productsData.products ?? []);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error fetching orders");
          setLoading(false);
        }
      }
    }

    void loadData();
    const interval = setInterval(loadData, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const productsById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const agentOrders = useMemo(
    () => orders.filter((o) => o.paidBy === "agent"),
    [orders]
  );

  const userOrders = useMemo(
    () => orders.filter((o) => o.paidBy === "user"),
    [orders]
  );

  const filteredOrders = useMemo(() => {
    let list = orders;
    if (activeTab === "agent") list = agentOrders;
    if (activeTab === "user") list = userOrders;

    if (searchId.trim()) {
      const q = searchId.trim().replace(/^#/, "");
      list = list.filter((o) => String(o.id).includes(q));
    }
    return list;
  }, [orders, activeTab, agentOrders, userOrders, searchId]);

  const agentTotalPaise = useMemo(
    () => agentOrders.reduce((sum, o) => sum + (o.status === "paid" ? o.amountPaise : 0), 0),
    [agentOrders]
  );

  const userTotalPaise = useMemo(
    () => userOrders.reduce((sum, o) => sum + (o.status === "paid" ? o.amountPaise : 0), 0),
    [userOrders]
  );

  return (
    <main className="min-h-screen bg-[#F4F4F0] px-4 py-8 text-[#000000]">
      <div className="mx-auto max-w-4xl">
        {/* Navigation Bar */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-[3px] border-[#000000] bg-[#FFFFFF] p-4 shadow-[5px_5px_0px_#000000]">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center border-2 border-[#000000] bg-[#CCFF00] text-xl font-black shadow-[2px_2px_0px_#000000]">
              📦
            </span>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight text-[#000000]">
                Orders &amp; Settlement Ledger
              </h1>
              <p className="text-[11px] font-bold text-[#000000]/70">
                Payer Attribution &amp; Settlement Ledger (User vs Agent)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <Link
              href="/"
              className="border-2 border-[#000000] bg-[#FFFFFF] px-3.5 py-1.5 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[2px_2px_0px_#000000] transition-all hover:-translate-y-[1px] hover:shadow-[3px_3px_0px_#000000] active:translate-y-[1px] active:shadow-none"
            >
              ← Store
            </Link>
            <Link
              href="/agent"
              className="border-2 border-[#000000] bg-[#CCFF00] px-3.5 py-1.5 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[2px_2px_0px_#000000] transition-all hover:-translate-y-[1px] hover:shadow-[3px_3px_0px_#000000] active:translate-y-[1px] active:shadow-none"
            >
              🤖 Agent Hub
            </Link>
          </div>
        </header>

        {/* Overview KPI Cards */}
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="border-[3px] border-[#000000] bg-[#FFFFFF] p-4 shadow-[4px_4px_0px_#000000]">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#000000]/60">
              Total Orders
            </span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-3xl font-black text-[#000000]">{orders.length}</span>
              <span className="text-xs font-bold text-[#000000]/70">All Transactions</span>
            </div>
          </div>

          <div className="border-[3px] border-[#000000] bg-[#CCFF00] p-4 shadow-[4px_4px_0px_#000000]">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#000000]">
              🤖 Paid by Agent
            </span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-3xl font-black text-[#000000]">{agentOrders.length}</span>
              <span className="text-xs font-black text-[#000000]">
                {formatPaise(agentTotalPaise)}
              </span>
            </div>
            <p className="mt-1 text-[10px] font-bold text-[#000000]/80">
              Autonomous WebMCP Mandates
            </p>
          </div>

          <div className="border-[3px] border-[#000000] bg-[#FFFFFF] p-4 shadow-[4px_4px_0px_#000000]">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#000000]/60">
              👤 Paid by User
            </span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-3xl font-black text-[#000000]">{userOrders.length}</span>
              <span className="text-xs font-bold text-[#000000]">
                {formatPaise(userTotalPaise)}
              </span>
            </div>
            <p className="mt-1 text-[10px] font-bold text-[#000000]/70">
              Direct Interactive Checkout
            </p>
          </div>
        </section>

        {/* Filter and Search Bar */}
        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 border-[3px] border-[#000000] bg-[#FFFFFF] p-3 shadow-[4px_4px_0px_#000000]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveTab("all")}
              className={`border-2 border-[#000000] px-3 py-1.5 text-xs font-black uppercase tracking-wider shadow-[2px_2px_0px_#000000] transition-all ${
                activeTab === "all"
                  ? "bg-[#000000] text-[#FFFFFF]"
                  : "bg-[#FFFFFF] text-[#000000] hover:bg-[#F4F4F0]"
              }`}
            >
              All Orders ({orders.length})
            </button>
            <button
              onClick={() => setActiveTab("agent")}
              className={`border-2 border-[#000000] px-3 py-1.5 text-xs font-black uppercase tracking-wider shadow-[2px_2px_0px_#000000] transition-all ${
                activeTab === "agent"
                  ? "bg-[#CCFF00] text-[#000000] shadow-[3px_3px_0px_#000000]"
                  : "bg-[#FFFFFF] text-[#000000] hover:bg-[#CCFF00]/30"
              }`}
            >
              🤖 Paid by Agent ({agentOrders.length})
            </button>
            <button
              onClick={() => setActiveTab("user")}
              className={`border-2 border-[#000000] px-3 py-1.5 text-xs font-black uppercase tracking-wider shadow-[2px_2px_0px_#000000] transition-all ${
                activeTab === "user"
                  ? "bg-[#FEF08A] text-[#000000] shadow-[3px_3px_0px_#000000]"
                  : "bg-[#FFFFFF] text-[#000000] hover:bg-[#FEF08A]/30"
              }`}
            >
              👤 Paid by User ({userOrders.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search Order #..."
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              className="w-36 border-2 border-[#000000] bg-[#F4F4F0] px-2.5 py-1 text-xs font-bold text-[#000000] placeholder-[#000000]/40 outline-none focus:bg-[#FFFFFF]"
            />
          </div>
        </section>

        {/* Orders List */}
        <section className="mt-6 space-y-4">
          {loading && (
            <div className="border-[3px] border-[#000000] bg-[#FFFFFF] p-8 text-center shadow-[5px_5px_0px_#000000]">
              <p className="font-black uppercase tracking-tight text-[#000000]">
                Loading orders ledger…
              </p>
            </div>
          )}

          {error && (
            <div className="border-[3px] border-[#000000] bg-[#FF0055] p-4 text-center text-white shadow-[5px_5px_0px_#000000]">
              <p className="font-bold">{error}</p>
            </div>
          )}

          {!loading && filteredOrders.length === 0 && (
            <div className="border-[3px] border-[#000000] bg-[#FFFFFF] p-8 text-center shadow-[5px_5px_0px_#000000]">
              <p className="text-base font-black uppercase text-[#000000]">
                No orders match your filter
              </p>
              <p className="mt-1 text-xs font-semibold text-[#000000]/60">
                Try switching tabs or clearing the search query.
              </p>
            </div>
          )}

          {filteredOrders.map((order) => {
            const isAgent = order.paidBy === "agent";
            return (
              <div
                key={order.id}
                className="border-[3px] border-[#000000] bg-[#FFFFFF] p-5 shadow-[5px_5px_0px_#000000] transition-all hover:shadow-[6px_6px_0px_#000000]"
              >
                {/* Header row: Order ID, Date, Payer Badge, Status Badge */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#000000] pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-black uppercase text-[#000000]">
                      Order #{order.id}
                    </span>
                    <span className="text-xs font-bold text-[#000000]/60">
                      · {new Date(order.createdAt).toLocaleString("en-IN")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Prominent Paid By Badge */}
                    {isAgent ? (
                      <span className="inline-flex items-center gap-1.5 border-2 border-[#000000] bg-[#CCFF00] px-2.5 py-1 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[2px_2px_0px_#000000]">
                        <span>🤖</span>
                        <span>Paid by Agent</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 border-2 border-[#000000] bg-[#FFFFFF] px-2.5 py-1 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[2px_2px_0px_#000000]">
                        <span>👤</span>
                        <span>Paid by User</span>
                      </span>
                    )}

                    {/* Order Status */}
                    <span
                      className={`inline-block px-2.5 py-1 text-xs font-black uppercase tracking-wider ${STATUS_STYLE[order.status]}`}
                    >
                      {STATUS_LABEL[order.status]}
                    </span>
                  </div>
                </div>

                {/* Body: Items list and payment details */}
                <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[#000000]/60">
                      Purchased Items
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {order.items.length === 0 ? (
                        <span className="text-xs font-semibold text-[#000000]/50">
                          (No items listed)
                        </span>
                      ) : (
                        order.items.map((item, idx) => {
                          const product = productsById.get(item.productId);
                          const name = product ? product.name : `Product #${item.productId}`;
                          return (
                            <span
                              key={idx}
                              className="border border-[#000000] bg-[#F4F4F0] px-2 py-0.5 text-xs font-bold text-[#000000]"
                            >
                              {name} × {item.qty}
                            </span>
                          );
                        })
                      )}
                    </div>
                    <p className="pt-1 text-[11px] font-bold text-[#000000]/70">
                      {isAgent
                        ? "Settlement: Autonomous UPI Reserve Pay (Zero-touch WebMCP)"
                        : "Settlement: Customer Direct Checkout"}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-[10px] font-black uppercase tracking-wider text-[#000000]/60">
                        Amount
                      </span>
                      <p className="text-xl font-black text-[#000000]">
                        {formatPaise(order.amountPaise)}
                      </p>
                    </div>
                    <Link
                      href={`/order/${order.id}`}
                      className="inline-flex items-center gap-1.5 border-2 border-[#000000] bg-[#000000] px-3.5 py-2 text-xs font-black uppercase tracking-wider text-[#FFFFFF] shadow-[2px_2px_0px_#CCFF00] transition-all hover:-translate-y-[1px] hover:shadow-[3px_3px_0px_#CCFF00] active:translate-y-[1px] active:shadow-none"
                    >
                      Receipt →
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
