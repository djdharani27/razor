import { NextResponse } from "next/server";
import { getOrder } from "@/lib/db";
import type { CartItem, OrderRow } from "@/lib/types";

export const runtime = "nodejs";

interface Params {
  params: { id: string };
}

/** GET /api/orders/:id — order status plus the items that were ordered. */
export async function GET(_req: Request, { params }: Params) {
  const orderId = Number(params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "Invalid order id." }, { status: 400 });
  }

  const order = getOrder(orderId) as OrderRow | undefined;
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  let items: CartItem[] = [];
  try {
    items = JSON.parse(order.items_json) as CartItem[];
  } catch {
    // items_json should always be valid; fall back to empty array.
  }

  const paidBy = order.paid_by ?? (order.mandate_id ? "agent" : "user");

  return NextResponse.json({
    id: order.id,
    status: order.status,
    amountPaise: order.amount_paise,
    items,
    createdAt: order.created_at,
    paidBy,
    paymentId: order.payment_id ?? null,
    mandateId: order.mandate_id ?? null,
  });
}
