// Single source of truth for the UPI Reserve Pay (SBMD) steps across the three
// API groups:
//   Group 1 (authorisation): 1.1 customer, 1.2 order, 1.3 checkout (no API).
//   Group 2 (fetch token):   2.1 payment → token_id.
//   Group 3 (charge):        3.1 charge order, 3.2 one-time recurring payment.
//
// NO fake/hardcoded Razorpay data lives here. defaultBody only holds the
// fields a step needs that have no real value yet — placeholders are left
// empty and the harness refuses to run a step until every required id comes
// from a previous step's REAL API response (or a deliberate manual paste).
// Every id that Razorpay returns (customer_id, order_id, payment_id, token_id)
// is read only from an earlier API response.

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

export const STEPS: StepDef[] = [
  {
    id: "createCustomer",
    num: "1.1",
    title: "Create a Customer",
    endpoint: "/v1/customers",
    method: "POST",
    hint: "Returns a real customer_id used by the next steps. Fill in a real name / 10-digit contact. fail_existing \"0\" reuses an existing customer for the same contact instead of duplicating.",
    defaultBody: JSON.stringify(
      {
        name: "",
        contact: "",
        fail_existing: "0",
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
    hint: "Authorises the UPI Reserve Pay block. customer_id is auto-filled from the real step 1.1 response. Amount limits: block ≤ ₹10,000, token.max_amount ≤ ₹10,000, token.expire_at ≤ 90 days from now.",
    defaultBody: JSON.stringify(
      {
        amount: 100,
        currency: "INR",
        customer_id: "",
        method: "upi",
        token: {
          max_amount: 100000,
          expire_at: 0,
          frequency: "as_presented",
          type: "single_block_multiple_debit",
        },
        notes: {},
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
    hint: "No API call. Opens the Razorpay Checkout with the real order_id from step 1.2 and customer_id from step 1.1 (recurring: true). The customer approves the UPI block here — that registers the SBMD mandate.",
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
    hint: "Fetch the authorisation payment to get its token_id. Runs standalone — paste a real razorpay_payment_id into the input below, or it auto-picks the payment id from the real step 1.3 checkout result. Response includes token_id, vpa, customer_id, amount, status, and more.",
    defaultBody: JSON.stringify({ id: "" }, null, 2),
  },
  {
    id: "createChargeOrder",
    num: "3.1",
    title: "Create an Order to Charge the Customer",
    endpoint: "/v1/orders",
    method: "POST",
    hint: "A new order — distinct from the step 1.2 authorisation order — created for each charge. Includes the notification object with token_id for Razorpay UPI Reserve Pay.",
    defaultBody: JSON.stringify(
      {
        amount: 100,
        currency: "INR",
        payment_capture: true,
        notification: {
          token_id: "",
        },
        notes: {},
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
    hint: "Charges the customer against the real step 3.1 order using the real step 2.1 token. Auto-wires order_id, customer_id, token, email and contact from the earlier API outputs; amount must match the step 3.1 order.",
    defaultBody: JSON.stringify(
      {
        email: "",
        contact: "",
        amount: 100,
        currency: "INR",
        order_id: "",
        customer_id: "",
        token: "",
        recurring: true,
        notes: {},
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
