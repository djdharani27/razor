export interface Product {
  id: number;
  name: string;
  description: string;
  price_paise: number;
  stock: number;
  image_url: string;
}

export interface CartItem {
  productId: number;
  qty: number;
}

/**
 * A checkout order. `status` is what the UI and webhook handlers act on:
 *   created   — payment in flight (debit created but not yet confirmed, or a
 *               legacy pre-rebuild standard-checkout order awaiting capture)
 *   paid      — payment captured
 *   failed    — payment failed or cancelled
 * `kind` distinguishes charge orders created against a UPI Reserve Pay
 * mandate from legacy standard-checkout orders.
 */
export interface OrderRow {
  id: number;
  /** Opaque reference column — for new rows this holds the Razorpay order id. */
  razorpay_payment_link_id: string;
  status: "created" | "paid" | "failed";
  amount_paise: number;
  items_json: string;
  created_at: number;
  /** New orders: "charge" (UPI Reserve Pay debit) or "standard" (legacy). */
  kind?: string | null;
  customer_id?: number | null;
  rzp_order_id?: string | null;
  payment_id?: string | null;
  mandate_id?: number | null;
  /** Whether the order was initiated/settled autonomously by AI Agent or human User */
  paid_by?: "agent" | "user" | null;
}

export interface CustomerRow {
  id: number;
  /** Normalised 10-digit contact — the stable local identity key. */
  contact: string;
  name: string;
  email: string | null;
  rzp_customer_id: string | null;
  created_at: number;
}

export type MandateStatus = "active" | "used" | "cancelled" | "expired";

/** A UPI Reserve Pay (single_block_multiple_debit) mandate + its local ledger. */
export interface MandateRow {
  id: number;
  customer_id: number;
  token_id: string;
  auth_order_id: string;
  auth_payment_id: string | null;
  status: MandateStatus;
  max_amount_paise: number;
  amount_debited_paise: number;
  expire_at: number;
  created_at: number;
  agent_code?: string | null;
}

export interface AgentLogRow {
  id: number;
  tool_name: string;
  arguments_json: string;
  result_json: string;
  timestamp: number;
}

/** Type for window.modelContext (WebMCP imperative API), only present in supporting browsers. */
export interface ModelContext {
  registerTool(tool: unknown): Promise<void>;
  unregisterTool(toolId: string): Promise<void>;
  getCapabilities?(): Promise<unknown>;
}

export interface WebMCPTool {
  id: string;
  name: string;
  description: string;
  inputSchema: object;
  execute(input: Record<string, unknown>): Promise<unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
}
