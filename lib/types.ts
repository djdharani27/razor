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

export interface OrderRow {
  id: number;
  razorpay_payment_link_id: string;
  status: "created" | "paid" | "failed";
  amount_paise: number;
  items_json: string;
  created_at: number;
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
