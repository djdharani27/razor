"use client";

import { useEffect, useRef } from "react";
import { useCart } from "@/components/cart-context";
import type { CartItem, ModelContext, Product, WebMCPTool } from "@/lib/types";

/**
 * Registers the AgentStore WebMCP tools with the browser's model context API.
 * No-op in browsers without `document.modelContext`. All tools log their calls
 * to /api/agent-log and are unregistered on unmount (AbortController pattern).
 */
export default function WebMCPTools() {
  const { add, remove, clear, items } = useCart();

  // Keep tool closures reading the live cart, not a stale snapshot.
  const cartRef = useRef(items);
  cartRef.current = items;

  useEffect(() => {
    if (typeof document === "undefined" || !("modelContext" in document)) return;
    const modelContext = (document as Document & { modelContext: ModelContext }).modelContext;

    // AbortController lets the browser cancel in-flight tool calls on unmount.
    const controller = new AbortController();
    const signal = controller.signal;

    const log = async (toolName: string, args: unknown, result: unknown) => {
      try {
        await fetch("/api/agent-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool_name: toolName,
            arguments_json: JSON.stringify(args ?? {}),
            result_json: JSON.stringify(result),
          }),
          signal,
        });
      } catch {
        // Logging must never break the tool result.
      }
    };

    const findProducts = async (query: string): Promise<Product[]> => {
      const res = await fetch("/api/products", { cache: "no-store", signal });
      if (!res.ok) throw new Error(`Failed to load products: ${res.status}`);
      const data = (await res.json()) as { products: Product[] };
      const q = query.trim().toLowerCase();
      if (!q) return data.products;
      return data.products.filter(
        (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
      );
    };

    const productById = async (id: number): Promise<Product | undefined> => {
      const products = await findProducts("");
      return products.find((p) => p.id === id);
    };

    const runTool = async (
      name: string,
      args: Record<string, unknown>,
      fn: () => Promise<unknown>
    ) => {
      try {
        const result = await fn();
        await log(name, args, result);
        return result;
      } catch (err) {
        const result = { error: err instanceof Error ? err.message : "Unknown error" };
        await log(name, args, result);
        return result;
      }
    };

    const tools: WebMCPTool[] = [
      {
        id: "search_products",
        name: "search_products",
        description: "Search the product catalog by name or category keyword",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        execute: (input) =>
          runTool("search_products", input, async () => {
            const query = typeof input.query === "string" ? input.query : "";
            const matches = await findProducts(query);
            return matches.map((p) => ({
              id: p.id,
              name: p.name,
              pricePaise: p.price_paise,
              priceInr: `₹${(p.price_paise / 100).toFixed(2)}`,
              stock: p.stock,
              description: p.description,
            }));
          }),
      },
      {
        id: "get_product",
        name: "get_product",
        description: "Get full details for a single product by id",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        execute: (input) =>
          runTool("get_product", input, async () => {
            const product = await productById(Number(input.id));
            if (!product) return { error: `Product ${input.id} not found.` };
            return {
              id: product.id,
              name: product.name,
              description: product.description,
              pricePaise: product.price_paise,
              priceInr: `₹${(product.price_paise / 100).toFixed(2)}`,
              stock: product.stock,
              imageUrl: product.image_url,
            };
          }),
      },
      {
        id: "add_to_cart",
        name: "add_to_cart",
        description: "Add a product to the cart. Validates stock before adding.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            qty: { type: "number" },
          },
          required: ["id", "qty"],
        },
        execute: (input) =>
          runTool("add_to_cart", input, async () => {
            const productId = Number(input.id);
            const qty = Math.floor(Number(input.qty));
            if (!Number.isInteger(productId) || productId <= 0) {
              return { error: `Invalid product id "${input.id}".` };
            }
            if (!Number.isInteger(qty) || qty <= 0) {
              return { error: `Invalid quantity "${input.qty}".` };
            }
            const product = await productById(productId);
            if (!product) return { error: `Product ${productId} does not exist.` };
            const current = cartRef.current.find((i) => i.productId === productId)?.qty ?? 0;
            if (current + qty > product.stock) {
              return {
                error: `Cannot add ${qty} of "${product.name}": only ${product.stock} in stock (${current} already in cart).`,
              };
            }
            add(productId, qty);
            return { cart: cartRef.current, totalQty: cartRef.current.reduce((s, i) => s + i.qty, 0) };
          }),
      },
      {
        id: "view_cart",
        name: "view_cart",
        description: "View the current cart contents and running total",
        inputSchema: { type: "object", properties: {} },
        execute: (input) =>
          runTool("view_cart", input, async () => {
            const cart = cartRef.current;
            const products = await findProducts("");
            const byId = new Map(products.map((p) => [p.id, p]));
            const lines = cart.map((i) => {
              const p = byId.get(i.productId);
              return {
                productId: i.productId,
                name: p?.name ?? `Product ${i.productId}`,
                qty: i.qty,
                unitPricePaise: p?.price_paise ?? 0,
                lineTotalPaise: (p?.price_paise ?? 0) * i.qty,
              };
            });
            const totalPaise = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
            return {
              cart: lines,
              totalPaise,
              totalInr: `₹${(totalPaise / 100).toFixed(2)}`,
              isEmpty: cart.length === 0,
            };
          }),
      },
      {
        id: "remove_from_cart",
        name: "remove_from_cart",
        description: "Remove a product from the cart entirely",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        execute: (input) =>
          runTool("remove_from_cart", input, async () => {
            const productId = Number(input.id);
            const existed = cartRef.current.some((i) => i.productId === productId);
            if (!existed) return { error: `Product ${input.id} is not in the cart.` };
            remove(productId);
            return {
              cart: cartRef.current,
              totalQty: cartRef.current.reduce((s, i) => s + i.qty, 0),
            };
          }),
      },
      {
        id: "checkout",
        name: "checkout",
        description:
          "Complete purchase of everything in the cart via Razorpay. This is a money-spending action and requires the current cart to be non-empty.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input) =>
          runTool("checkout", input, async () => {
            const cart = cartRef.current;
            if (cart.length === 0) {
              return { error: "Cart is empty — add items before checking out." };
            }
            const res = await fetch("/api/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: cart }),
              signal,
            });
            const data = (await res.json()) as {
              orderId?: number;
              paymentLinkUrl?: string;
              error?: string;
              code?: string;
            };

            if (!res.ok) {
              // Graceful rejection (e.g. spend cap) — return the structured error
              // as the tool result so the agent can explain it to the user.
              return {
                error: data.error ?? `Checkout failed with status ${res.status}.`,
                code: data.code ?? "CHECKOUT_REJECTED",
              };
            }

            // Hand the actual payment step to the human in a new tab.
            if (data.paymentLinkUrl) {
              window.open(data.paymentLinkUrl, "_blank", "noopener,noreferrer");
            }
            clear();
            return {
              ok: true,
              message: `Order ${data.orderId} created. The payment link was opened in a new tab — the user must complete the Razorpay payment there.`,
              orderId: data.orderId,
              paymentLinkUrl: data.paymentLinkUrl,
            };
          }),
      },
      {
        id: "get_order_status",
        name: "get_order_status",
        description: "Check the payment status of an order by its id",
        inputSchema: {
          type: "object",
          properties: { orderId: { type: "string" } },
          required: ["orderId"],
        },
        execute: (input) =>
          runTool("get_order_status", input, async () => {
            const orderId = Number(input.orderId);
            if (!Number.isInteger(orderId) || orderId <= 0) {
              return { error: `Invalid orderId "${input.orderId}".` };
            }
            const res = await fetch(`/api/orders/${orderId}`, { cache: "no-store", signal });
            if (!res.ok) {
              const data = (await res.json().catch(() => ({}))) as { error?: string };
              return { error: data.error ?? `Order ${orderId} not found.` };
            }
            const data = (await res.json()) as {
              id: number;
              status: string;
              amountPaise: number;
              items: CartItem[];
              createdAt: number;
            };
            return {
              orderId: data.id,
              status: data.status,
              amountPaise: data.amountPaise,
              amountInr: `₹${(data.amountPaise / 100).toFixed(2)}`,
              items: data.items,
            };
          }),
      },
    ];

    const registered = new Set<string>();
    const registerAll = async () => {
      for (const tool of tools) {
        try {
          await modelContext.registerTool(tool);
          registered.add(tool.id);
        } catch (err) {
          console.warn(`[AgentStore] failed to register WebMCP tool "${tool.id}"`, err);
        }
      }
    };
    void registerAll();

    return () => {
      controller.abort();
      // Unregister only the tools this component registered.
      for (const id of registered) {
        void modelContext.unregisterTool(id).catch(() => undefined);
      }
    };
    // Intentionally run once on mount; refs keep closures fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
