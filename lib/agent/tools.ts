// Agent tool definitions and executors. Each tool maps to a Gemini function
// declaration and an executor that runs server-side against the SQLite DB
// and/or the Razorpay API.
//
// Payment tools implement the UPI Reserve Pay (single_block_multiple_debit)
// flow against the shared orchestration in lib/payments.ts:
//   remember_customer — records the customer identity on the session (and
//                       resolves/creates their Razorpay customer).
//   pay_cart_now       — resolves a reusable mandate and debits immediately, or
//                       creates an authorisation order and hands back a
//                       checkout payload for the client modal.

import {
  getAllProducts,
  findProducts,
  getProductById,
  getCustomerByContact,
  upsertCustomer,
  initDb,
} from "@/lib/db";
import type { Product, CustomerRow } from "@/lib/types";
import {
  getCart,
  setCart,
  updatePayment,
  getPayment,
  getCustomer,
  setCustomer,
  type AgentSession,
} from "@/lib/agent/session";
import { logServer } from "@/lib/agent/server-log";
import { Type, type FunctionDeclaration } from "@google/genai";
import { executePayment, type AuthorisationPayload } from "@/lib/payments";
import { ensureRzpCustomer } from "@/lib/rzp";

function normaliseContact(raw: string): string | null {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits.length === 10 ? digits : null;
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
    name: "checkout",
    description:
      "Prepares and displays the checkout review with the Pay button. Call this when the customer asks to checkout, proceed to payment, or says 'yes' to checking out.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "fetch_customer",
    description:
      "Fetches an existing customer's saved profile by their 10-digit Indian mobile number from the database. Call this if a customer provides their phone number or asks to retrieve their account.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        contact: { type: Type.STRING, description: "Customer's 10-digit Indian mobile number" },
      },
      required: ["contact"],
    },
  },
  {
    name: "remember_customer",
    description:
      "Records the customer's identity (name, 10-digit Indian mobile number, optional email) for payment. The customer must provide these — ask for them if missing. Call this before pay_cart_now on the first order.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Customer's full name" },
        contact: { type: Type.STRING, description: "Customer's 10-digit Indian mobile number" },
        email: { type: Type.STRING, description: "Customer's email (optional)" },
      },
      required: ["name", "contact"],
    },
  },
  {
    name: "pay_cart_now",
    description:
      "Pays for the current cart total using UPI Reserve Pay. If the customer has a reusable mandate it debits immediately and returns status 'captured'. If not (first purchase or the block was used up), it creates an authorisation order and returns status 'needs_authorisation' with the checkout details the customer must approve in the popup.",
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

    case "checkout": {
      const cartInfo = cartWithDetails(sid);
      if (cartInfo.items.length === 0) {
        return { error: "Your cart is empty. Add items before checking out." };
      }

      let customer = getCustomer(sid);
      if (!customer) {
        const dbCustomer = initDb()
          .prepare("SELECT * FROM customers ORDER BY id DESC LIMIT 1")
          .get() as CustomerRow | undefined;
        if (dbCustomer) {
          customer = {
            name: dbCustomer.name,
            contact: dbCustomer.contact,
            email: dbCustomer.email ?? null,
            rzpCustomerId: dbCustomer.rzp_customer_id ?? null,
          };
          setCustomer(sid, customer);
        }
      }

      return {
        isCheckout: true,
        cart: cartInfo,
        customer: customer ? { name: customer.name, contact: customer.contact } : null,
        message: customer
          ? `Ready for checkout, ${customer.name}! Total is ${cartInfo.total_display}. Click the Pay button below to complete your order.`
          : `Ready for checkout! Total is ${cartInfo.total_display}. Please provide your full name and 10-digit Indian mobile number to complete payment.`,
      };
    }

    case "fetch_customer": {
      const rawContact = String(args.contact ?? "").trim();
      const contact = normaliseContact(rawContact);
      if (!contact) {
        return {
          error: `Please provide a valid 10-digit Indian mobile number (got "${rawContact || "(empty)"}").`,
        };
      }

      const existing = getCustomerByContact(contact);
      if (!existing) {
        return {
          found: false,
          message: `No saved profile found for mobile number ${contact}. Please ask for their full name to register.`,
        };
      }

      setCustomer(sid, {
        name: existing.name,
        contact: existing.contact,
        email: existing.email ?? null,
        rzpCustomerId: existing.rzp_customer_id ?? null,
      });

      logServer("fetch_customer", `Fetched profile for ${existing.name} (${contact})`, {
        detail: { contact, rzp_customer_id: existing.rzp_customer_id, session: sid },
        endpoint: "fetch_customer",
      });

      return {
        found: true,
        customer: {
          name: existing.name,
          contact: existing.contact,
          email: existing.email,
        },
        message: `Welcome back, ${existing.name}! Your details have been fetched.`,
      };
    }

    case "remember_customer": {
      const name = String(args.name ?? "").trim();
      const rawContact = String(args.contact ?? "").trim();
      const contact = normaliseContact(rawContact);
      const email = args.email ? String(args.email).trim() : null;

      if (name.length < 2) {
        return { error: "Please provide the customer's full name (at least 2 characters)." };
      }
      if (!contact) {
        return {
          error: `Please provide a valid 10-digit Indian mobile number (got "${rawContact || "(empty)"}").`,
        };
      }

      // Resolve the local customer (by contact) + the Razorpay customer.
      const local = getCustomerByContact(contact);
      const rzp = await ensureRzpCustomer({
        name,
        contact,
        email,
        existingRzpCustomerId: local?.rzp_customer_id ?? null,
        endpoint: "remember_customer",
      });
      const rzpCustomerId = rzp.ok ? rzp.rzpCustomerId ?? null : null;

      // Save to SQLite database so customer is permanently remembered
      upsertCustomer({
        contact,
        name,
        email,
        rzpCustomerId,
      });

      setCustomer(sid, { name, contact, email, rzpCustomerId });
      logServer("remember_customer", `Identity recorded for ${name}`, {
        detail: { contact, rzp_customer_id: rzpCustomerId, session: sid },
        endpoint: "remember_customer",
      });

      return {
        message: `Thanks, ${name}! Your details are saved and will be remembered for future orders.`,
        name,
        contact,
        ...(email ? { email } : {}),
        saved: true,
      };
    }

    case "pay_cart_now": {
      let customer = getCustomer(sid);
      if (!customer) {
        // Fallback: check SQLite database for recent registered customer
        const dbCustomer = initDb()
          .prepare("SELECT * FROM customers ORDER BY id DESC LIMIT 1")
          .get() as CustomerRow | undefined;
        if (dbCustomer) {
          customer = {
            name: dbCustomer.name,
            contact: dbCustomer.contact,
            email: dbCustomer.email ?? null,
            rzpCustomerId: dbCustomer.rzp_customer_id ?? null,
          };
          setCustomer(sid, customer);
        }
      }

      if (!customer) {
        return {
          error:
            "I don't have the customer's payment details yet. Ask for their name and 10-digit mobile number, then call remember_customer.",
          code: "CUSTOMER_REQUIRED",
        };
      }

      const cartInfo = cartWithDetails(sid);
      if (cartInfo.items.length === 0) {
        return { error: "Cart is empty. Add items before paying." };
      }
      const amountPaise = cartInfo.total_paise;

      updatePayment(sid, {
        status: "debit_created",
        amountPaise,
        errorMessage: null,
      });

      let resolution;
      try {
        resolution = await executePayment({
          name: customer.name,
          contact: customer.contact,
          email: customer.email ?? null,
          amountPaise,
          items: cartInfo.items.map((i) => ({ productId: i.productId, qty: i.quantity })),
          orderKind: "charge",
          receipt: `Receipt No. ${getPayment(sid).receiptNo}`,
          description: `AI Agent payment — ${cartInfo.items.map((i) => i.name).join(", ")}`,
          notes: { source: "ai_agent" },
          endpoint: "pay_cart_now",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Payment could not be completed.";
        logServer("pay_cart_now", `Payment error: ${message}`, {
          level: "error",
          endpoint: "pay_cart_now",
          step: "3.2",
          rzpEndpoint: "/v1/payments/create/recurring",
        });
        updatePayment(sid, { status: "failed", errorMessage: message });
        return { error: message, status: "failed" };
      }

      if (resolution.status === "needs_authorisation") {
        const payload: AuthorisationPayload = resolution.payload;
        const pendingCart = getCart(sid).map((i) => ({ productId: i.productId, qty: i.qty }));
        updatePayment(sid, {
          status: "needs_authorisation",
          authOrderId: payload.orderId,
          amountPaise,
        });
        logServer("pay_cart_now", `Authorisation required (order ${payload.orderId})`, {
          detail: { amount_paise: amountPaise, session: sid },
          endpoint: "pay_cart_now",
          step: "1.2",
          rzpEndpoint: "/v1/orders",
        });
        return {
          status: "needs_authorisation",
          message:
            "This is your first UPI Reserve Pay purchase (or your previous block was used up). You need to approve a one-time block of funds in the UPI popup that just appeared — please click the approve button.",
          amount: formatPaise(amountPaise),
          amount_paise: amountPaise,
          auth: {
            orderId: payload.orderId,
            customerId: payload.customerId,
            keyId: payload.keyId,
            blockPaise: payload.blockPaise,
            expireAt: payload.expireAt,
            amountPaise: payload.amountPaise,
          },
          // The parked cart is echoed so the client can pass it back to the
          // confirm endpoint, which completes the debit after the mandate is
          // stored.
          pendingDebit: {
            items: pendingCart,
            amountPaise,
            description: `AI Agent payment — ${cartInfo.items.map((i) => i.name).join(", ")}`,
            receipt: `Receipt No. ${getPayment(sid).receiptNo}`,
          },
        };
      }

      if (resolution.status === "error") {
        logServer("pay_cart_now", `Payment rejected: ${resolution.error}`, {
          level: "error",
          endpoint: "pay_cart_now",
          step: "3.2",
          rzpEndpoint: "/v1/payments/create/recurring",
        });
        updatePayment(sid, { status: "failed", errorMessage: resolution.error });
        return { error: resolution.error, status: "failed", code: resolution.code };
      }

      const { debit } = resolution;
      // Debit captured — clear the cart and record the order.
      setCart(sid, []);
      const payment = getPayment(sid);
      updatePayment(sid, {
        status: "captured",
        chargeOrderId: debit.rzpOrderId,
        lastOrderId: debit.localOrderId,
        receiptNo: payment.receiptNo + 1,
        authOrderId: null,
      });
      logServer("agentstore", `Local order #${debit.localOrderId} saved to store database`, {
        detail: {
          session: sid,
          local_order_id: debit.localOrderId,
          rzp_order_id: debit.rzpOrderId,
          payment_id: debit.paymentId ?? null,
          amount_paise: amountPaise,
        },
        endpoint: "pay_cart_now",
      });
      return {
        status: "captured",
        message: "Order placed!",
        orderId: debit.localOrderId,
        rzpOrderId: debit.rzpOrderId,
        paymentId: debit.paymentId ?? null,
        amount: formatPaise(amountPaise),
        amount_paise: amountPaise,
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
