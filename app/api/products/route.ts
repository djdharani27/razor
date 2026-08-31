import { NextResponse } from "next/server";
import { getAllProducts } from "@/lib/db";

export const runtime = "nodejs";

/** GET /api/products — full product list (used by the order page and agents). */
export async function GET() {
  return NextResponse.json({ products: getAllProducts() });
}
