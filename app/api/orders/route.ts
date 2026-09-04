import { NextResponse } from "next/server";
import { getAllOrders } from "@/lib/db";
import type { CartItem, OrderRow } from "@/lib/types";

export const runtime = "nodejs";

/** GET /api/orders — retrieve all recent orders with payer attribution. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(1, Number(limitParam) || 50), 200) : 50;

    const rows = getAllOrders(limit) as OrderRow[];

    const orders = rows.map((order) => {
      let items: CartItem[] = [];
      try {
        items = JSON.parse(order.items_json) as CartItem[];
      } catch {
        // Fall back to empty array
      }

      const paidBy: "agent" | "user" =
        order.paid_by ?? (order.mandate_id ? "agent" : "user");

      return {
        id: order.id,
        status: order.status,
        amountPaise: order.amount_paise,
        items,
        createdAt: order.created_at,
        paidBy,
        paymentId: order.payment_id ?? null,
        mandateId: order.mandate_id ?? null,
        rzpOrderId: order.rzp_order_id ?? null,
      };
    });

    return NextResponse.json({ orders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch orders.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
