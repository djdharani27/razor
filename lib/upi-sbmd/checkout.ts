// Client-side Razorpay Checkout loader for step 1.3 (UPI Reserve Pay
// authorisation). There is no S2S endpoint for this step — per the docs the
// customer approves the mandate inside the checkout.js modal, and the modal
// reports the result via the handler / payment.failed events.
//
// For a one-time UPI mandate the "success" surfaces oddly: Razorpay fires
// payment.failed with error.reason === "upi_dummy_payment", which actually
// means the mandate was registered successfully. We map that to
// { kind: "mandate_registered" } so callers can treat it as success.

import { UPI_DUMMY_PAYMENT_REASON } from "@/lib/upi-sbmd/steps";

export const CHECKOUT_SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

export type CheckoutError = {
  code: string;
  description: string;
  reason: string;
};

export type CheckoutOutcome =
  | {
      kind: "authorised";
      paymentId: string;
      orderId: string;
      signature: string;
    }
  | {
      kind: "mandate_registered";
      paymentId: string;
      orderId: string;
      signature?: string;
      error: CheckoutError;
    }
  | {
      kind: "failed";
      paymentId?: string;
      orderId?: string;
      error: CheckoutError;
    }
  | { kind: "dismissed" };

// The checkout resolves from an async browser event, so recording the wall
// clock here (module scope, outside React render) keeps component bodies pure.
export interface CheckoutResult {
  outcome: CheckoutOutcome;
  at: number;
}

interface RazorpayFailedResponse {
  error?: {
    code?: string;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: { order_id?: string; payment_id?: string };
  };
}

interface RazorpaySuccessResponse {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
}

interface RazorpayCheckoutInstance {
  open(): void;
  on(event: "payment.failed", handler: (response: RazorpayFailedResponse) => void): void;
}

interface RazorpayCheckoutCtor {
  new (options: Record<string, unknown>): RazorpayCheckoutInstance;
}

// AgentStore's order page also augments window.Razorpay (with its own type),
// so don't redeclare it globally here — read it through a local cast instead.
type WindowWithRazorpay = typeof window & { Razorpay?: RazorpayCheckoutCtor };

function getWindowRazorpay(): RazorpayCheckoutCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as WindowWithRazorpay).Razorpay;
}

let scriptLoad: Promise<void> | null = null;

function loadCheckoutScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Razorpay Checkout can only run in a browser."));
  }
  if (getWindowRazorpay()) return Promise.resolve();
  if (!scriptLoad) {
    scriptLoad = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${CHECKOUT_SCRIPT_URL}"]`
      );
      const script =
        existing ??
        (() => {
          const el = document.createElement("script");
          el.src = CHECKOUT_SCRIPT_URL;
          el.async = true;
          document.head.appendChild(el);
          return el;
        })();
      script.addEventListener("load", () => {
        if (getWindowRazorpay()) resolve();
        else {
          scriptLoad = null;
          reject(new Error("checkout.js loaded but Razorpay is unavailable."));
        }
      });
      script.addEventListener("error", () => {
        scriptLoad = null;
        reject(new Error("Could not load the Razorpay Checkout script."));
      });
    });
  }
  return scriptLoad;
}

function toError(e: RazorpayFailedResponse["error"]): CheckoutError {
  return {
    code: e?.code ?? "UNKNOWN",
    description: e?.description ?? "No error description returned.",
    reason: e?.reason ?? "unknown",
  };
}

/**
 * Open the recurring UPI authorisation checkout. The order_id and customer_id
 * are mandatory and are forced here — callers may only supply presentation /
 * prefill extras (theme, prefill, notes, ...).
 */
export async function openUpiAuthCheckout(input: {
  key: string;
  orderId: string;
  customerId: string;
  extras?: Record<string, unknown>;
}): Promise<CheckoutResult> {
  // Fail as a returned outcome (with a timestamp) instead of throwing, so
  // callers never have to fabricate an `at` inside React's render scope.
  let RazorpayCtor: RazorpayCheckoutCtor | undefined;
  try {
    await loadCheckoutScript();
    RazorpayCtor = getWindowRazorpay();
  } catch (err) {
    return {
      at: Date.now(),
      outcome: {
        kind: "failed",
        orderId: input.orderId,
        error: {
          code: "CHECKOUT_UNAVAILABLE",
          description:
            err instanceof Error ? err.message : "Could not load the Razorpay Checkout script.",
          reason: "checkout_unavailable",
        },
      },
    };
  }
  if (!RazorpayCtor) {
    return {
      at: Date.now(),
      outcome: {
        kind: "failed",
        orderId: input.orderId,
        error: {
          code: "CHECKOUT_UNAVAILABLE",
          description: "Razorpay Checkout is unavailable.",
          reason: "checkout_unavailable",
        },
      },
    };
  }

  return new Promise<CheckoutResult>((resolve) => {
    let settled = false;
    const settle = (outcome: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      resolve({ outcome, at: Date.now() });
    };

    const extras = input.extras ?? {};
    const userModal =
      extras.modal && typeof extras.modal === "object"
        ? (extras.modal as Record<string, unknown>)
        : {};
    const options: Record<string, unknown> = {
      ...extras,
      // Mandatory / protected fields — always win over any caller extras so a
      // stale JSON body can never reroute the checkout into a non-recurring
      // flow or a different order/customer.
      key: input.key,
      order_id: input.orderId,
      customer_id: input.customerId,
      recurring: true,
      modal: { ...userModal, ondismiss: () => settle({ kind: "dismissed" }) },
      handler: (response: RazorpaySuccessResponse) => {
        if (!response.razorpay_payment_id || !response.razorpay_signature) {
          settle({
            kind: "failed",
            orderId: response.razorpay_order_id,
            error: {
              code: "HANDLER_INCOMPLETE",
              description: "Checkout handler returned without a payment id or signature.",
              reason: "incomplete_handler_response",
            },
          });
          return;
        }
        settle({
          kind: "authorised",
          paymentId: response.razorpay_payment_id,
          orderId: response.razorpay_order_id ?? input.orderId,
          signature: response.razorpay_signature,
        });
      },
    };

    const rzp = new RazorpayCtor(options);
    rzp.on("payment.failed", (response) => {
      const error = toError(response.error);
      if (error.reason === UPI_DUMMY_PAYMENT_REASON) {
        // Per Razorpay docs this "failure" is a successful one-time mandate
        // registration for UPI Reserve Pay.
        settle({
          kind: "mandate_registered",
          paymentId:
            response.error?.metadata?.payment_id ??
            (options.order_id as string) ??
            input.orderId,
          orderId: response.error?.metadata?.order_id ?? input.orderId,
          error,
        });
        return;
      }
      settle({
        kind: "failed",
        paymentId: response.error?.metadata?.payment_id,
        orderId: response.error?.metadata?.order_id ?? input.orderId,
        error,
      });
    });
    try {
      rzp.open();
    } catch (err) {
      settle({
        kind: "failed",
        orderId: input.orderId,
        error: {
          code: "CHECKOUT_OPEN_FAILED",
          description: err instanceof Error ? err.message : "Could not open Razorpay Checkout.",
          reason: "checkout_open_failed",
        },
      });
    }
  });
}

/** Human/JSON body built from the checkout outcome, mirroring the fields the
 *  handler/callback would return so history stays self-describing. */
export function checkoutOutcomeBody(outcome: CheckoutOutcome): string {
  switch (outcome.kind) {
    case "authorised":
      return JSON.stringify(
        {
          mandate_status: "registered",
          razorpay_payment_id: outcome.paymentId,
          razorpay_order_id: outcome.orderId,
          razorpay_signature: outcome.signature,
        },
        null,
        2
      );
    case "mandate_registered":
      return JSON.stringify(
        {
          mandate_status: "registered",
          note: `${outcome.error.reason} means the one-time mandate was registered successfully (per Razorpay docs).`,
          razorpay_payment_id: outcome.paymentId,
          razorpay_order_id: outcome.orderId,
          ...(outcome.signature ? { razorpay_signature: outcome.signature } : {}),
          error: {
            code: outcome.error.code,
            description: outcome.error.description,
            reason: outcome.error.reason,
          },
        },
        null,
        2
      );
    case "failed":
      return JSON.stringify(
        {
          mandate_status: "not_registered",
          razorpay_payment_id: outcome.paymentId ?? null,
          razorpay_order_id: outcome.orderId ?? null,
          error: {
            code: outcome.error.code,
            description: outcome.error.description,
            reason: outcome.error.reason,
          },
        },
        null,
        2
      );
    case "dismissed":
      return JSON.stringify(
        {
          mandate_status: "not_registered",
          note: "Checkout was closed before the customer completed the UPI authorisation.",
        },
        null,
        2
      );
  }
}
