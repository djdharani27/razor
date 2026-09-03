// Agent tool definitions and executors. Each tool maps to a Gemini function
// declaration and an executor that runs server-side against the SQLite DB
// and/or the Razorpay API (via the existing /api/rzp-sbmd proxy logic).
//
// The SBMD charge flow uses ONLY env-var IDs (customer_id, token_id) —
// no new customers or mandates are created.

import {
  getAllProducts,
  findProducts,
  getProductById,
} from "@/lib/db";
import type { Product } from "@/lib/types";
import {
  getCart,
  setCart,
  updatePayment,
  getPayment,
  type AgentSession,
} from "@/lib/agent/session";
import { Type, type FunctionDeclaration } from "@google/genai";

// ---------------------------------------------------------------------------
// Razorpay config from env
// ---------------------------------------------------------------------------
function rzpConfig() {
  return {
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    customerId: process.env.RAZORPAY_CUSTOMER_ID ?? "",
    tokenId: process.env.RAZORPAY_TOKEN_ID ?? "",
    email: process.env.RAZORPAY_CUSTOMER_EMAIL ?? "",
    contact: process.env.RAZORPAY_CUSTOMER_CONTACT ?? "",
  };
}

async function rzpFetch(endpoint: string, method: string, body?: unknown) {
  const { keyId, keySecret } = rzpConfig();
  const basicAuth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
  const hasBody = method !== "GET" && method !== "HEAD";
  const res = await fetch(`https://api.razorpay.com${endpoint}`, {
    method,
    headers: {
      Authorization: basicAuth,
      "Content-Type": "application/json",
    },
    ...(hasBody ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: { raw: text } };
  }
}

// ---------------------------------------------------------------------------
// Tool declarations (Gemini function calling format)
// ---------------------------------------------------------------------------
export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "get_all_products",
    description: "Returns the full product catalog with id, name, description, price in paise, stock count, and image URL.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "search_products",
    description: "Searches products by name or description keyword. Returns matching products.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Search keyword" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_product",
    description: "Get a single product's full details by its numeric ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        product_id: { type: Type.NUMBER, description: "Product ID" },
      },
      required: ["product_id"],
    },
  },
  {
    name: "add_to_cart",
    description: "Adds a product to the customer's cart or increases its quantity. Returns the updated cart.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        product_id: { type: Type.NUMBER, description: "Product ID to add" },
        quantity: { type: Type.NUMBER, description: "Quantity to add (default 1)" },
      },
      required: ["product_id"],
    },
  },
  {
    name: "remove_from_cart",
    description: "Removes a product entirely from the customer's cart. Returns the updated cart.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        product_id: { type: Type.NUMBER, description: "Product ID to remove" },
      },
      required: ["product_id"],
    },
  },
  {
    name: "view_cart",
    description: "Returns the current cart contents with product details and total.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "start_payment",
    description: "Creates a Razorpay charge order (step 3.1) for the current cart total using the pre-authorized UPI SBMD mandate token. This sends a pre-debit notification to the customer. Returns the order details.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "complete_payment",
    description: "Executes the recurring payment (step 3.2) against the charge order created by start_payment. Uses the pre-authorized token. Returns payment result — either 'captured' or 'scheduled' (25h pre-debit hold is normal and means the payment will be automatically processed after 25 hours).",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Cart helpers
// ---------------------------------------------------------------------------
function formatPaise(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

function cartWithDetails(sessionId: string) {
  const cart = getCart(sessionId);
  const items = cart.map((ci) => {
    const product = getProductById(ci.productId);
    return {
      productId: ci.productId,
      name: product?.name ?? "Unknown",
      price_paise: product?.price_paise ?? 0,
      quantity: ci.qty,
      subtotal_paise: (product?.price_paise ?? 0) * ci.qty,
    };
  });
  const total_paise = items.reduce((sum, i) => sum + i.subtotal_paise, 0);
  return { items, total_paise, total_display: formatPaise(total_paise) };
}

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------
function productToCard(p: Product) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: formatPaise(p.price_paise),
    price_paise: p.price_paise,
    stock: p.stock,
    image_url: p.image_url,
  };
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  session: AgentSession
): Promise<unknown> {
  const sid = session.id;

  switch (toolName) {
    case "get_all_products": {
      const products = getAllProducts();
      return { products: products.map(productToCard), count: products.length };
    }

    case "search_products": {
      const query = String(args.query ?? "");
      const products = findProducts(query);
      return { products: products.map(productToCard), count: products.length, query };
    }

    case "get_product": {
      const id = Number(args.product_id);
      const product = getProductById(id);
      if (!product) return { error: `Product ${id} not found` };
      return productToCard(product);
    }

    case "add_to_cart": {
      const productId = Number(args.product_id);
      const qty = Number(args.quantity ?? 1);
      const product = getProductById(productId);
      if (!product) return { error: `Product ${productId} not found` };
      if (product.stock < 1) return { error: `${product.name} is out of stock` };

      const cart = getCart(sid);
      const existing = cart.find((c) => c.productId === productId);
      if (existing) {
        existing.qty += qty;
      } else {
        cart.push({ productId, qty });
      }
      setCart(sid, cart);
      return { message: `Added ${qty}x ${product.name} to cart`, cart: cartWithDetails(sid) };
    }

    case "remove_from_cart": {
      const productId = Number(args.product_id);
      const cart = getCart(sid).filter((c) => c.productId !== productId);
      setCart(sid, cart);
      return { message: `Removed product ${productId} from cart`, cart: cartWithDetails(sid) };
    }

    case "view_cart": {
      return cartWithDetails(sid);
    }

    case "start_payment": {
      const { customerId, tokenId, email, contact } = rzpConfig();
      if (!customerId || !tokenId) {
        return { error: "SBMD mandate not configured. Set RAZORPAY_CUSTOMER_ID and RAZORPAY_TOKEN_ID in env." };
      }

      const cartInfo = cartWithDetails(sid);
      if (cartInfo.items.length === 0) {
        return { error: "Cart is empty. Add items before starting payment." };
      }

      const amountPaise = cartInfo.total_paise;
      const payment = getPayment(sid);
      const receiptNo = payment.receiptNo;

      // Step 3.1: Create charge order with notification.token_id
      const orderBody = {
        amount: amountPaise,
        currency: "INR",
        payment_capture: true,
        receipt: `Receipt No. ${receiptNo}`,
        notification: {
          token_id: tokenId,
        },
        notes: {
          customer_id: customerId,
          customer_email: email,
          customer_contact: contact,
          source: "ai_agent",
        },
      };

      const result = await rzpFetch("/v1/orders", "POST", orderBody);

      if (!result.ok) {
        updatePayment(sid, {
          status: "error",
          errorMessage: result.data?.error?.description ?? `Order creation failed (${result.status})`,
        });
        return { error: result.data?.error?.description ?? "Failed to create charge order", razorpay_response: result.data };
      }

      const orderId = result.data.id;
      updatePayment(sid, {
        chargeOrderId: orderId,
        status: "order_created",
        amountPaise,
        receiptNo: receiptNo + 1,
        errorMessage: null,
      });

      return {
        message: "Charge order created successfully. Pre-debit notification sent to customer.",
        order_id: orderId,
        amount: formatPaise(amountPaise),
        amount_paise: amountPaise,
        receipt: `Receipt No. ${receiptNo}`,
        notification_status: result.data.notification?.status ?? "created",
        note: "The recurring payment can be executed next. Due to Razorpay's 25-hour pre-debit notification window, the payment will be scheduled if attempted before that window elapses.",
      };
    }

    case "complete_payment": {
      const { customerId, tokenId, email, contact } = rzpConfig();
      const payment = getPayment(sid);

      if (!payment.chargeOrderId) {
        return { error: "No charge order exists. Run start_payment first to create a charge order." };
      }

      // Step 3.2: Create recurring payment
      const cartInfo = cartWithDetails(sid);
      const paymentBody = {
        email,
        contact,
        amount: payment.amountPaise,
        currency: "INR",
        order_id: payment.chargeOrderId,
        customer_id: customerId,
        token: tokenId,
        recurring: true,
        description: `AI Agent payment - ${cartInfo.items.map((i) => i.name).join(", ")}`,
        notes: {
          source: "ai_agent",
          cart_items: cartInfo.items.map((i) => `${i.quantity}x ${i.name}`).join(", "),
        },
      };

      const result = await rzpFetch("/v1/payments/create/recurring", "POST", paymentBody);

      // The 25-hour pre-debit hold error is expected and means the payment is scheduled
      const isPreDebitHold =
        result.data?.error?.description === "Payment can only be attempted 25 hours after the notification is delivered" ||
        result.data?.error?.reason === "pre_debit_notification_pending";

      if (isPreDebitHold) {
        updatePayment(sid, { status: "payment_scheduled" });
        return {
          status: "scheduled",
          message: "Payment has been scheduled! Razorpay requires a 25-hour window after the pre-debit notification before the payment can be captured. The payment will be automatically processed once this window elapses.",
          order_id: payment.chargeOrderId,
          amount: formatPaise(payment.amountPaise),
        };
      }

      if (!result.ok) {
        updatePayment(sid, {
          status: "error",
          errorMessage: result.data?.error?.description ?? `Payment failed (${result.status})`,
        });
        return { error: result.data?.error?.description ?? "Recurring payment failed", razorpay_response: result.data };
      }

      // Payment captured successfully
      updatePayment(sid, { status: "payment_captured" });
      return {
        status: "captured",
        message: "Payment captured successfully!",
        payment_id: result.data.razorpay_payment_id ?? result.data.id,
        order_id: payment.chargeOrderId,
        amount: formatPaise(payment.amountPaise),
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
