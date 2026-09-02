// Single source of truth for the UPI Reserve Pay (SBMD) steps across the three
// API groups:
//   Group 1 (authorisation): 1.1 customer, 1.2 order, 1.3 checkout (no API).
//   Group 2 (fetch token):   2.1 payment → token_id.
//   Group 3 (charge):        3.1 charge order, 3.2 one-time recurring payment.
// Steps 1.1–1.2 and 3.x mirror the API payloads in PLAN.md / the Reserve Pay
// docs. Each subsequent step auto-wires the ids it needs from earlier outputs.

export type StepId =
  | "createCustomer"
  | "createOrder"
  | "createAuthPayment"
  | "fetchPayment"
  | "createChargeOrder"
  | "createRecurringPayment";

export interface StepDef {
  id: StepId;
  num: string;
  title: string;
  endpoint: string;
  method: "POST" | "GET" | "JS";
  /** "checkout" steps are not proxied to api.razorpay.com — they open Razorpay Checkout in the browser. */
  integration?: "checkout";
  hint: string;
  defaultBody: string;
}

// Error reason Razorpay Checkout returns for a one-time mandate registration.
// Per the docs this actually signals a successful registration, not a failure.
export const UPI_DUMMY_PAYMENT_REASON = "upi_dummy_payment";

// Exact description Razorpay returns when a debit is attempted before the
// 25-hour pre-debit notification window has elapsed. The SBMD harness treats
// this as a "scheduled" outcome rather than a failure.
export const PRE_DEBIT_HOLD_MESSAGE =
  "Payment can only be attempted 25 hours after the notification is delivered";

export const STEPS: StepDef[] = [
  {
    id: "createCustomer",
    num: "1.1",
    title: "Create a Customer",
    endpoint: "/v1/customers",
    method: "POST",
    hint: "Returns a customer_id used by the next two steps.",
    defaultBody: JSON.stringify(
      {
        name: "John Smith",
        email: "john.smith@example.com",
        contact: "+11234567890",
        fail_existing: "0",
        notes: {
          note_key_1: "September",
          note_key_2: "Make it so.",
        },
      },
      null,
      2
    ),
  },
  {
    id: "createOrder",
    num: "1.2",
    title: "Create an Order (Authorisation / Mandate)",
    endpoint: "/v1/orders",
    method: "POST",
    hint: "Amount limits: block ≤ ₹10,000, token.max_amount ≤ ₹10,000, token.expire_at ≤ 90 days from now.",
    defaultBody: JSON.stringify(
      {
        amount: 100,
        currency: "INR",
        customer_id: "cust_4xbQrmEoA5WJ01",
        method: "upi",
        token: {
          max_amount: 200000,
          expire_at: 2709971120,
          frequency: "as_presented",
          type: "single_block_multiple_debit",
        },
        receipt: "Receipt No. 1",
        notes: {
          note_key_1: "September",
          note_key_2: "Make it so.",
        },
      },
      null,
      2
    ),
  },
  {
    id: "createAuthPayment",
    num: "1.3",
    title: "Authorisation Payment (Razorpay Checkout)",
    endpoint: "https://checkout.razorpay.com/v1/checkout.js",
    method: "JS",
    integration: "checkout",
    hint: "No API call. Opens the Razorpay Checkout with the order_id from step 1.2 and customer_id from step 1.1 (recurring: true). The customer approves the UPI block here — that registers the SBMD mandate.",
    defaultBody: JSON.stringify(
      {
        recurring: true,
        theme: { color: "#F37254" },
      },
      null,
      2
    ),
  },
  {
    id: "fetchPayment",
    num: "2.1",
    title: "Fetch Token from Payment ID",
    endpoint: "/v1/payments/:id",
    method: "GET",
    hint: "Fetch the authorisation payment to get its token_id. Runs standalone — paste a razorpay_payment_id into the input below, or it auto-picks the payment id from the step 1.3 checkout result. Response includes token_id, vpa, customer_id, amount, status, and more.",
    defaultBody: JSON.stringify(
      {
        id: "pay_TXE6GlS2AsCOBH",
      },
      null,
      2
    ),
  },
  {
    id: "createChargeOrder",
    num: "3.1",
    title: "Create an Order to Charge the Customer",
    endpoint: "/v1/orders",
    method: "POST",
    hint: "A new order — distinct from the step 1.2 authorisation order — created for each charge. The notification.token_id (from step 2.1) triggers the pre-debit notification. Amount must not exceed the blocked amount from step 1.2.",
    defaultBody: JSON.stringify(
      {
        amount: 100,
        currency: "INR",
        payment_capture: true,
        receipt: "Receipt No. 2",
        notification: {
          token_id: "token_TXE6GucHxg9rcx",
        },
        notes: {
          note_key_1: "September",
          note_key_2: "Make it so.",
        },
      },
      null,
      2
    ),
  },
  {
    id: "createRecurringPayment",
    num: "3.2",
    title: "Create a One Time Payment",
    endpoint: "/v1/payments/create/recurring",
    method: "POST",
    hint: "Charges the customer against the step 3.1 order using the step 2.1 token. Auto-wires order_id, customer_id, token, email and contact from the earlier outputs; amount must match the step 3.1 order.",
    defaultBody: JSON.stringify(
      {
        email: "john.smith@example.com",
        contact: "+11234567890",
        amount: 100,
        currency: "INR",
        order_id: "order_TXE5V2cP08ANnw",
        customer_id: "cust_TXA9fF1bBAjSif",
        token: "token_TXE6GucHxg9rcx",
        recurring: true,
        description: "Creating recurring payment for John Smith",
        notes: {
          note_key_1: "September",
          note_key_2: "Make it so.",
        },
      },
      null,
      2
    ),
  },
];

export const STEP_MAP: Record<StepId, StepDef> = Object.fromEntries(
  STEPS.map((s) => [s.id, s])
) as Record<StepId, StepDef>;

export const STEP_ORDER: StepId[] = STEPS.map((s) => s.id);

// SBMD mandates cap token.expire_at at 90 days from now.
export const MAX_MANDATE_DAYS = 90;

export function orderDefaultExpiry(now = Date.now()): number {
  // 89 days out keeps a comfortable margin under the 90-day limit.
  return Math.floor(now / 1000) + MAX_MANDATE_DAYS * 86400 - 86400;
}

export function expiryInRange(expireAt: number, now = Date.now()): boolean {
  const min = Math.floor(now / 1000);
  const max = Math.floor(now / 1000) + MAX_MANDATE_DAYS * 86400;
  return expireAt >= min && expireAt <= max;
}
