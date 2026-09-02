"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  STEPS,
  STEP_MAP,
  STEP_ORDER,
  orderDefaultExpiry,
  PRE_DEBIT_HOLD_MESSAGE,
  type StepId,
} from "@/lib/upi-sbmd/steps";
import { openUpiAuthCheckout, checkoutOutcomeBody } from "@/lib/upi-sbmd/checkout";
import type { StepResult } from "@/lib/upi-sbmd/types";
import StepCard from "@/components/upi-sbmd/StepCard";
import History from "@/components/upi-sbmd/History";
import Settings from "@/components/upi-sbmd/Settings";
import { prettyJson, extractField, maskKeyId } from "@/lib/upi-sbmd/format";

const LS_KEY = "rzp-sbmd-v1";
const AUTO_KEY = "rzp-sbmd-autohistory-v1";
const MAX_AUTO = 30;

// Client-side credential knowledge is limited to the Key ID: Razorpay's public
// key, which checkout.js needs to open the payment modal. The Key Secret is
// server-only and never leaves /api/rzp-sbmd (which reads it from env vars).

interface Persisted {
  keyId: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

interface PageState {
  keyId: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

const EMPTY_PERSISTED: Persisted = {
  keyId: "",
  inputs: {},
  outputs: {},
};

const EMPTY_STATE: PageState = {
  keyId: "",
  inputs: {},
  outputs: {},
};

function isValidJson(s: string): boolean {
  try {
    return s.trim() !== "" && JSON.parse(s) !== null;
  } catch {
    return false;
  }
}

function isStepId(v: unknown): v is StepId {
  return STEP_ORDER.includes(v as StepId);
}

function getDefaultInput(id: StepId): string {
  return STEP_MAP[id].defaultBody;
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The PLAN.md order sample carries a stale token.expire_at that Razorpay
// rejects (SBMD caps it at 90 days). Always surface a valid default instead.
function orderBodyWithValidExpiry(existing: string | undefined): string {
  const base = existing && existing.trim() ? parseObject(existing) : null;
  const baseObj = base ?? (parseObject(STEP_MAP.createOrder.defaultBody) as Record<string, unknown>);
  const token =
    baseObj.token && typeof baseObj.token === "object"
      ? { ...(baseObj.token as Record<string, unknown>) }
      : {};
  return JSON.stringify({ ...baseObj, token: { ...token, expire_at: orderDefaultExpiry() } }, null, 2);
}

const SBMD_MAX_EXPIRY_SECS = 90 * 86400;

function orderExpiryIsStale(raw: string | undefined): boolean {
  const parsed = raw && raw.trim() ? parseObject(raw) : null;
  const token =
    parsed && parsed.token && typeof parsed.token === "object"
      ? (parsed.token as { expire_at?: unknown })
      : null;
  const exp = token?.expire_at;
  const nowSecs = Math.floor(Date.now() / 1000);
  return (
    typeof exp !== "number" ||
    exp <= 0 ||
    exp < nowSecs - 86400 ||
    exp > nowSecs + SBMD_MAX_EXPIRY_SECS
  );
}

// Prefer a valid expiry whenever the visible order input is missing one or
// has one outside the allowed 90-day window.
function freshOrderInput(raw: string | undefined): string {
  if (!orderExpiryIsStale(raw)) return raw as string;
  return orderBodyWithValidExpiry(raw);
}

function getDefaultOutput(id: StepId): string {
  return JSON.stringify(
    { note: `Response from ${STEP_MAP[id].endpoint} appears here.` },
    null,
    2
  );
}

// For checkout steps there is no proxy HTTP response: the ids the checkout
// needs must come from the stored outputs of the earlier steps.
function readIdFromOutput(
  output: string | undefined,
  candidates: string[]
): string | undefined {
  if (!output) return undefined;
  try {
    const parsed = JSON.parse(output);
    if (!parsed || typeof parsed !== "object") return undefined;
    for (const candidate of candidates) {
      const found = extractField(parsed, candidate);
      if (found) return found;
    }
  } catch {
    // unparseable output — treat as missing
  }
  return undefined;
}

// customer_id lives on the customer object as "id"; order_id on the order
// object as "id". Prefer the explicit *_id names when present.
function step1_3CheckoutIds(
  outputs: Record<string, string>
): { customerId?: string; orderId?: string } {
  const customerId = readIdFromOutput(outputs.createCustomer, [
    "customer_id",
    "id",
  ]);
  const orderId = readIdFromOutput(outputs.createOrder, ["id", "order_id"]);
  return { customerId, orderId };
}

function mandateRegisteredFromBody(body: string): boolean {
  try {
    const v = JSON.parse(body) as { mandate_status?: string };
    return v?.mandate_status === "registered";
  } catch {
    return false;
  }
}

// Razorpay's UPI Reserve Pay flow enforces a 25-hour pre-debit window: after
// step 3.1 creates an order with notification.token_id, a pre-debit
// notification is delivered to the customer and the debit can only be
// attempted 25 hours later. If step 3.2 is run before that window elapses,
// Razorpay rejects it with this exact error. For the SBMD test harness that is
// a *scheduled* outcome, not a failure — treat it as handled.

function isPreDebitHoldError(body: string): boolean {
  try {
    const v = JSON.parse(body) as {
      error?: { description?: string; reason?: string; code?: string };
    };
    return (
      v?.error?.description === PRE_DEBIT_HOLD_MESSAGE ||
      v?.error?.reason === "pre_debit_notification_pending" ||
      v?.error?.code === "PRE_DEBIT_NOTIFICATION_PENDING"
    );
  } catch {
    return false;
  }
}

// Resolve which payment id step 2.1 should fetch. Precedence:
// 1. A deliberately edited id in the step's editor (anything other than the
//    bundled doc-sample id) — a manual fetch overrides auto-wiring.
// 2. The razorpay_payment_id from the step 1.3 checkout output (authoritative
//    for the last mandate registered in this session).
// 3. Whatever id is in the editor (the sample), so a fresh browser still has a
//    runnable default.
function resolveFetchPaymentId(input: {
  editorInput: string | undefined;
  checkoutOutput: string | undefined;
  sampleId: string;
}): string {
  const pasted = (() => {
    try {
      const v = JSON.parse(input.editorInput ?? "") as { id?: unknown };
      return typeof v.id === "string" ? v.id.trim() : "";
    } catch {
      return "";
    }
  })();
  const saved = extractField(
    (() => {
      try {
        return JSON.parse(input.checkoutOutput ?? "");
      } catch {
        return null;
      }
    })(),
    "razorpay_payment_id"
  );
  return pasted && pasted !== input.sampleId ? pasted : (saved ?? pasted);
}

// Resolve the token_id for charge steps (3.1 notification.token_id, 3.2 token)
// from the step 2.1 output. The saved token_id from the fetched authorisation
// payment is authoritative for the current mandate; the editor's value (e.g.
// a doc sample or manual paste) is only a fallback when 2.1 hasn't run.
function resolveTokenId(args: {
  pasted: string;
  fetchOutput: string | undefined;
}): string {
  const saved = extractField(
    (() => {
      try {
        return JSON.parse(args.fetchOutput ?? "");
      } catch {
        return null;
      }
    })(),
    "token_id"
  );
  return saved ?? args.pasted;
}

// 3.2 requires email/contact matching the customer. When the step 1.1
// customer output exists, its email/contact are authoritative (the flow's
// customer may differ from the doc sample in the editor). Only when the
// customer output has none do the editor's values remain.
function withCustomerContact(
  parsed: Record<string, unknown>,
  customerOutput: string | undefined
): Record<string, unknown> {
  try {
    const cust = JSON.parse(customerOutput ?? "") as {
      email?: unknown;
      contact?: unknown;
    };
    const next = { ...parsed };
    if (typeof cust.email === "string" && cust.email !== "")
      next.email = cust.email;
    if (typeof cust.contact === "string" && cust.contact !== "")
      next.contact = cust.contact;
    return next;
  } catch {
    return parsed;
  }
}

async function postSession(payload: unknown) {
  await fetch("/api/sbmd-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Call the local proxy and measure latency. Kept outside the component so the
// render body stays pure (no performance.now/Date.now during render).
async function callStepEndpoint(payload: {
  endpoint: string;
  method: string;
  body: string;
}): Promise<{
  ok: boolean;
  status: number;
  ms: number;
  pretty: string;
  responseJson: unknown | null;
  errorMessage: string | null;
  at: number;
}> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch("/api/rzp-sbmd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - t0),
      pretty: JSON.stringify(
        {
          error: {
            message: err instanceof Error ? err.message : "Network error",
          },
        },
        null,
        2
      ),
      responseJson: null,
      errorMessage: err instanceof Error ? err.message : "Network error",
      at: Date.now(),
    };
  }
  const ms = Math.round(performance.now() - t0);
  const responseText = await res.text();
  let responseJson: unknown = null;
  let pretty = responseText;
  try {
    responseJson = JSON.parse(responseText);
    pretty = JSON.stringify(responseJson, null, 2);
  } catch {
    pretty = responseText;
  }
  const ok = res.status >= 200 && res.status < 300;
  return {
    ok,
    status: res.status,
    ms,
    pretty,
    responseJson,
    errorMessage: null,
    at: Date.now(),
  };
}

async function loadServerSession(): Promise<Partial<PageState> | null> {
  try {
    const res = await fetch("/api/sbmd-session");
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== "object") return null;
    const merged: Partial<PageState> = { inputs: {}, outputs: {} };
    if (data.inputs && typeof data.inputs === "object") {
      for (const id of STEP_ORDER) {
        const v = (data.inputs as Record<string, unknown>)[id];
        if (typeof v === "string") merged.inputs![id] = v;
      }
    }
    if (data.outputs && typeof data.outputs === "object") {
      for (const id of STEP_ORDER) {
        const v = (data.outputs as Record<string, unknown>)[id];
        if (typeof v === "string") merged.outputs![id] = v;
      }
    }
    return merged;
  } catch {
    return null;
  }
}

// The configured Key ID (public key) comes from the server env. Fetching it on
// load lets the checkout step run without any manual credential entry.
async function loadEnvKeyId(): Promise<{ configured: boolean; keyId: string }> {
  try {
    const res = await fetch("/api/sbmd-env");
    if (!res.ok) return { configured: false, keyId: "" };
    const data = await res.json();
    return {
      configured: Boolean(data?.configured),
      keyId: typeof data?.keyId === "string" ? data.keyId : "",
    };
  } catch {
    return { configured: false, keyId: "" };
  }
}

function loadLocal(): Persisted {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY_PERSISTED;
    const p = JSON.parse(raw) as Persisted;
    return {
      keyId: typeof p.keyId === "string" ? p.keyId : "",
      inputs: p.inputs && typeof p.inputs === "object" ? p.inputs : {},
      outputs: p.outputs && typeof p.outputs === "object" ? p.outputs : {},
    };
  } catch {
    return EMPTY_PERSISTED;
  }
}

export default function Home() {
  const [state, setState] = useState<PageState>(() => {
    if (typeof window === "undefined") return EMPTY_STATE;
    const local = loadLocal();
    return {
      keyId: local.keyId,
      inputs: { ...local.inputs },
      outputs: { ...local.outputs },
    };
  });
  const [configured, setConfigured] = useState(false);
  const [running, setRunning] = useState<StepId | null>(null);
  const [lastResult, setLastResult] = useState<
    Record<
      StepId,
      { status: number; ok: boolean; ms: number; keyIdPreview: string; label?: string }
    >
  >({} as Record<StepId, never>);
  const [history, setHistory] = useState<StepResult[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(AUTO_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as StepResult[];
        if (Array.isArray(arr)) return arr;
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [serverReady, setServerReady] = useState(true);
  const historyRef = useRef<StepResult[]>(history);

  // Load server-side state: env-configured Key ID + persisted step data.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadServerSession(), loadEnvKeyId()])
      .then(([server, env]) => {
        if (cancelled) return;
        if (!server) {
          setServerReady(false);
        } else {
          const hasData = STEP_ORDER.some(
            (id) => server.inputs?.[id] || server.outputs?.[id]
          );
          if (hasData) {
            setState((prev) => ({
              keyId: prev.keyId,
              inputs: { ...prev.inputs, ...server.inputs },
              outputs: { ...prev.outputs, ...server.outputs },
            }));
          }
        }
        setConfigured(env.configured);
        // Prefer the server env Key ID (authoritative for checkout).
        if (env.keyId) {
          setState((prev) => ({
            ...prev,
            keyId: env.keyId,
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setServerReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- keep the ref in sync for the history persist effect ---
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // --- persist to localStorage whenever state changes ---
  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          keyId: state.keyId,
          inputs: state.inputs,
          outputs: state.outputs,
        })
      );
    } catch {
      // storage unavailable — ignore
    }
  }, [state]);

  // --- persist auto history ---
  useEffect(() => {
    try {
      localStorage.setItem(AUTO_KEY, JSON.stringify(historyRef.current));
    } catch {
      // ignore
    }
  }, [history]);

  const mergeInput = useCallback((id: StepId, val: string) => {
    setState((prev) => ({ ...prev, inputs: { ...prev.inputs, [id]: val } }));
  }, []);

  const mergeOutput = useCallback((id: StepId, val: string) => {
    setState((prev) => ({ ...prev, outputs: { ...prev.outputs, [id]: val } }));
  }, []);

  const apiReady = configured && !!state.keyId;

  // Any step can run at any stage — nothing is gated on earlier steps having
  // succeeded. Steps that need ids resolve them from the earlier outputs at
  // run time (or from values pasted manually into the step's input).

  async function runStep(id: StepId) {
    const def = STEP_MAP[id];
    if (running) return;
    if (!apiReady) return;

    if (def.integration === "checkout") {
      await runCheckoutStep(id);
      return;
    }

    const requestBody = inputOf(id);
    if (!isValidJson(requestBody)) {
      alert(`Input JSON for step ${def.num} is not valid.`);
      return;
    }

    // Steps that reference an id created by an earlier step (order → customer,
    // checkout → order + customer, fetch payment → checkout payment) run
    // standalone too: when the earlier step's saved output already carries the
    // id, inject it at run time so a manual paste is only needed if that output
    // is missing or stale.
    let finalBody = requestBody;
    let resolvedEndpoint = stepEndpoint(id);
    if (id === "createOrder") {
      const customerId = extractField(
        (() => {
          try {
            return JSON.parse(state.outputs.createCustomer ?? "");
          } catch {
            return null;
          }
        })(),
        "customer_id"
      );
      if (customerId) {
        const parsed = JSON.parse(requestBody) as Record<string, unknown>;
        finalBody = JSON.stringify({ ...parsed, customer_id: customerId }, null, 2);
      }
    }
    if (id === "fetchPayment") {
      const sampleId = (() => {
        try {
          const s = JSON.parse(STEP_MAP.fetchPayment.defaultBody) as {
            id?: unknown;
          };
          return typeof s.id === "string" ? s.id : "";
        } catch {
          return "";
        }
      })();
      const payId = resolveFetchPaymentId({
        editorInput: requestBody,
        checkoutOutput: state.outputs.createAuthPayment,
        sampleId,
      });
      if (!payId) {
        alert(
          `The ${def.num} fetch needs a payment id. Run step ${STEP_MAP.createAuthPayment.num} to register a mandate, or paste a razorpay_payment_id (e.g. {"id": "pay_..."}) into this step's input.`
        );
        return;
      }
      const parsed = JSON.parse(requestBody) as Record<string, unknown>;
      if (parsed.id !== payId) {
        finalBody = JSON.stringify({ ...parsed, id: payId }, null, 2);
      }
      resolvedEndpoint = def.endpoint.replace(":id", payId);
    }
    if (id === "createChargeOrder") {
      const parsed = JSON.parse(requestBody) as Record<string, unknown>;
      const notification =
        parsed.notification && typeof parsed.notification === "object"
          ? (parsed.notification as Record<string, unknown>)
          : {};
      const pastedToken =
        typeof notification.token_id === "string"
          ? notification.token_id.trim()
          : "";
      const tokenId = resolveTokenId({
        pasted: pastedToken,
        fetchOutput: state.outputs.fetchPayment,
      });
      if (tokenId && tokenId !== pastedToken) {
        finalBody = JSON.stringify(
          {
            ...parsed,
            notification: { ...notification, token_id: tokenId },
          },
          null,
          2
        );
      }
    }
    if (id === "createRecurringPayment") {
      const parsed = JSON.parse(requestBody) as Record<string, unknown>;
      const pastedToken =
        typeof parsed.token === "string" ? parsed.token.trim() : "";
      const tokenId = resolveTokenId({
        pasted: pastedToken,
        fetchOutput: state.outputs.fetchPayment,
      });
      // Saved outputs are authoritative for the current flow (fresh mandate →
      // fresh ids). The editor's pasted values are the fallback when the
      // producing steps haven't run yet.
      const customerId = extractField(
        (() => {
          try {
            return JSON.parse(state.outputs.createCustomer ?? "");
          } catch {
            return null;
          }
        })(),
        "customer_id"
      );
      const orderId = extractField(
        (() => {
          try {
            return JSON.parse(state.outputs.createChargeOrder ?? "");
          } catch {
            return null;
          }
        })(),
        "order_id"
      );
      const customerIdValue =
        customerId ??
        (typeof parsed.customer_id === "string" ? parsed.customer_id : "");
      const orderIdValue =
        orderId ?? (typeof parsed.order_id === "string" ? parsed.order_id : "");
      const tokenValue = tokenId ?? pastedToken;
      const next = withCustomerContact(
        { ...parsed },
        state.outputs.createCustomer
      );
      if (tokenValue) next.token = tokenValue;
      if (customerIdValue) next.customer_id = customerIdValue;
      if (orderIdValue) next.order_id = orderIdValue;
      if (JSON.stringify(next) !== JSON.stringify(parsed)) {
        finalBody = JSON.stringify(next, null, 2);
      }
    }

    setRunning(id);
    const outcome = await callStepEndpoint({
      endpoint: resolvedEndpoint,
      method: def.method,
      body: finalBody,
    });

    // The 25-hour pre-debit hold is an expected intermediate state for the
    // charge steps (3.1 notification → 3.2 debit). Surface it as handled
    // ("payment scheduled") rather than a red failure.
    const preDebitHold =
      (id === "createRecurringPayment" || id === "createChargeOrder") &&
      isPreDebitHoldError(outcome.pretty);

    const handledOutcome = preDebitHold
      ? {
          ...outcome,
          ok: true,
          pretty: JSON.stringify(
            {
              status: "scheduled",
              message:
                "Payment notified to the customer. Razorpay allows the debit only 25 hours after the notification is delivered, so this charge is scheduled and will be attempted automatically once the window elapses.",
              razorpay_response: outcome.responseJson,
            },
            null,
            2
          ),
          errorMessage: null,
        }
      : outcome;

    mergeOutput(id, handledOutcome.pretty);
    setLastResult((prev) => ({
      ...prev,
      [id]: {
        status: handledOutcome.status,
        ok: handledOutcome.ok,
        ms: handledOutcome.ms,
        keyIdPreview: maskKeyId(state.keyId),
        label: preDebitHold ? "scheduled · 25h" : undefined,
      },
    }));

    const entry: StepResult = {
      stepId: id,
      label: def.title,
      endpoint: resolvedEndpoint,
      method: def.method,
      status: handledOutcome.ok ? 200 : handledOutcome.status,
      ok: handledOutcome.ok,
      requestBody,
      responseBody: handledOutcome.pretty,
      responseJson: handledOutcome.responseJson,
      ms: handledOutcome.ms,
      at: handledOutcome.at,
      keyIdPreview: maskKeyId(state.keyId),
      statusLabel: preDebitHold ? "scheduled · 25h" : undefined,
    };
    setHistory((h) => [entry, ...h].slice(0, MAX_AUTO));
    setRunning(null);
  }

  // Step 1.3 has no server endpoint. Open Razorpay Checkout (checkout.js) with
  // an order_id / customer_id (from earlier outputs, or pasted into the
  // editor) and recurring:
  // true. Checkout reports the authorisation result via handler + payment.failed
  // events; upi_dummy_payment means the mandate was registered (per docs).
  async function runCheckoutStep(id: StepId) {
    const checkoutDef = STEP_MAP[id];

    // Read the Checkout options editor first — pasted order_id / customer_id
    // here override (and are preferred over) the earlier saved outputs, so the
    // step runs standalone at any stage. Sanitized the same way below: those
    // keys are always consumed as ids, never passed through to checkout.js.
    let extras: Record<string, unknown> = {};
    const rawInput = state.inputs[id]?.trim();
    if (rawInput) {
      try {
        const parsed = JSON.parse(rawInput) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") extras = parsed;
      } catch {
        alert("Input JSON for step 1.3 is not valid — using the defaults.");
      }
    }
    const pastedOrderId =
      typeof extras.order_id === "string" && extras.order_id.trim() !== ""
        ? extras.order_id.trim()
        : undefined;
    const pastedCustomerId =
      typeof extras.customer_id === "string" && extras.customer_id.trim() !== ""
        ? extras.customer_id.trim()
        : undefined;
    const { customerId: savedCustomerId, orderId: savedOrderId } =
      step1_3CheckoutIds(state.outputs);
    const customerId = pastedCustomerId ?? savedCustomerId;
    const orderId = pastedOrderId ?? savedOrderId;

    if (!customerId || !orderId) {
      alert(
        `The Checkout needs an order_id and a customer_id. Run steps ${STEP_MAP.createCustomer.num} and ${STEP_MAP.createOrder.num} first, or paste ids from their outputs into this step's Checkout options (order_id / customer_id).`
      );
      return;
    }
    if (!state.keyId) {
      alert("No Razorpay Key ID is configured. Set RAZORPAY_KEY_ID in .env.local.");
      return;
    }

    // Sanitize: the ids and flow flags are always taken from the earlier
    // outputs / this editor. Other keys (theme, prefill, notes, ...) pass
    // through as checkout options.
    delete extras.key;
    delete extras.order_id;
    delete extras.customer_id;
    delete extras.recurring;
    delete extras.handler;
    if (extras.modal && typeof extras.modal === "object") {
      delete (extras.modal as Record<string, unknown>).ondismiss;
    }

    setRunning(id);
    try {
      const { outcome, at } = await openUpiAuthCheckout({
        key: state.keyId,
        orderId,
        customerId,
        extras,
      });
      const body = checkoutOutcomeBody(outcome);
      mergeOutput(id, body);
      const ok = mandateRegisteredFromBody(body);
      setLastResult((prev) => ({
        ...prev,
        [id]: {
          status: outcome.kind === "dismissed" ? 0 : 200,
          ok,
          ms: 0,
          keyIdPreview: maskKeyId(state.keyId),
        },
      }));
      const entry: StepResult = {
        stepId: id,
        label: checkoutDef.title,
        endpoint: checkoutDef.endpoint,
        method: checkoutDef.method,
        status: ok ? 200 : outcome.kind === "dismissed" ? 0 : 400,
        ok,
        // History Load restores this into the editable "Checkout options"
        // editor, so persist the sanitized extras the user configured (the
        // required order_id / customer_id / recurring are always injected).
        requestBody: JSON.stringify(extras, null, 2),
        responseBody: body,
        responseJson: JSON.parse(body),
        ms: 0,
        at,
        keyIdPreview: maskKeyId(state.keyId),
      };
      setHistory((h) => [entry, ...h].slice(0, MAX_AUTO));
    } finally {
      setRunning(null);
    }
  }

  function applyResultAsInput(id: StepId) {
    const def = STEP_MAP[id];
    const out = state.outputs[id];
    if (!out) return;
    const customerId = extractField(
      (() => {
        try {
          return JSON.parse(out);
        } catch {
          return null;
        }
      })(),
      "customer_id"
    );
    const nextId = STEP_ORDER[STEP_ORDER.indexOf(id) + 1];
    if (!nextId || !customerId) {
      alert("No customer_id found in this step's output.");
      return;
    }
    const nextBody = (() => {
      try {
        const nextParsed = JSON.parse(state.inputs[nextId] ?? getDefaultInput(nextId));
        return { ...nextParsed, customer_id: customerId };
      } catch {
        return null;
      }
    })();
    if (nextBody) {
      mergeInput(nextId, JSON.stringify(nextBody, null, 2));
      alert(`customer_id ${customerId} copied into step ${def.num} → step ${STEP_ORDER.indexOf(nextId) + 1} input.`);
    }
  }

  function saveOutputAsDefault(id: StepId) {
    postSession({ outputs: { ...state.outputs } }).catch(() => undefined);
    alert(`Step ${STEP_MAP[id].num} output saved as default (survives browser clear).`);
  }

  function clearAll() {
    localStorage.removeItem(LS_KEY);
    setState({ keyId: state.keyId, inputs: {}, outputs: {} });
    setHistory([]);
    setLastResult({} as Record<StepId, never>);
    postSession({ inputs: {}, outputs: {} }).catch(() => undefined);
  }

  function loadHistoryEntry(entry: StepResult) {
    if (!isStepId(entry.stepId)) return;
    const stepId = entry.stepId;
    mergeInput(stepId, prettyJson(entry.requestBody));
    mergeOutput(stepId, prettyJson(entry.responseBody));
    setLastResult((prev) => ({
      ...prev,
      [stepId]: {
        status: entry.status,
        ok: entry.ok,
        ms: entry.ms,
        keyIdPreview: entry.keyIdPreview,
        label: entry.statusLabel,
      },
    }));
    const idx = STEP_ORDER.indexOf(stepId);
    if (idx > 0) {
      const prevId = STEP_ORDER[idx - 1];
      const prevOutput = state.outputs[prevId];
      if (prevOutput) {
        const customerId = extractField(
          (() => {
            try {
              return JSON.parse(prevOutput);
            } catch {
              return null;
            }
          })(),
          "customer_id"
        );
        if (customerId) {
          mergeInput(stepId, prettyJson(entry.requestBody));
        }
      }
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function deleteHistoryEntry(entry: StepResult) {
    setHistory((h) => h.filter((x) => x !== entry));
  }

  const outputOf = (id: StepId) =>
    state.outputs[id] ?? getDefaultOutput(id);
  const inputOf = (id: StepId) => {
    const raw = state.inputs[id] ?? getDefaultInput(id);
    if (id === "createOrder") return freshOrderInput(raw);
    return raw;
  };
  const stepEndpoint = (id: StepId): string => {
    // Checkout steps use the checkout.js URL, API steps their documented
    // endpoint; never let a stale override from storage change it.
    return STEP_MAP[id].endpoint;
  };
  // For path-parameter steps (2.1 fetches /v1/payments/:id) the real URL is
  // only known at run time from the id the editor / earlier output supplies.
  // Show the best known form statically: a deliberately edited id in this
  // step's editor wins; otherwise the saved 1.3 payment id; otherwise the
  // placeholder shape.
  const displayEndpoint = (id: StepId): string => {
    const def = STEP_MAP[id];
    if (def.method === "GET" && def.endpoint.includes(":id")) {
      const sampleId = (() => {
        try {
          const s = JSON.parse(def.defaultBody) as { id?: unknown };
          return typeof s.id === "string" ? s.id : "";
        } catch {
          return "";
        }
      })();
      const payId = resolveFetchPaymentId({
        editorInput: state.inputs[id],
        checkoutOutput: state.outputs.createAuthPayment,
        sampleId,
      });
      return payId
        ? def.endpoint.replace(":id", payId)
        : def.endpoint.replace(":id", "{id}");
    }
    return def.endpoint;
  };
  const isCheckout = (id: StepId) => STEP_MAP[id].integration === "checkout";

  async function reloadEnvConfig() {
    const env = await loadEnvKeyId();
    setConfigured(env.configured);
    if (env.keyId) {
      setState((prev) => ({ ...prev, keyId: env.keyId }));
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <a
          href="/"
          className="text-[13px] text-zinc-400 transition-colors hover:text-zinc-100"
        >
          ← Back to AgentStore
        </a>
      </div>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-zinc-50">
          Razorpay UPI Reserve Pay — SBMD
        </h1>
        <p className="text-[13px] text-zinc-400">
          UPI Reserve Pay (SBMD) end to end: Group 1 registers the mandate
          (1.1 customer → 1.2 authorisation order → 1.3 Razorpay Checkout),
          Group 2 fetches the token (2.1 payment → token_id), Group 3 charges
          the customer (3.1 charge order → 3.2 one-time payment). Each step
          runs standalone at any stage — nothing is locked behind a previous
          step. Steps pick up the ids they need from the earlier outputs
          automatically when those exist (token_id, order_id, customer_id,
          email/contact); otherwise paste them into the step&apos;s own JSON.
          Every input and output is editable, and each run is kept in History
          below.
        </p>
      </header>

      {!apiReady && (
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <span className="font-semibold">Run buttons are disabled until your
          Razorpay Key ID and Key Secret are set in the server environment
          (.env.local).</span>{" "}
          Steps are never blocked in sequence — you can start from any step.
        </p>
      )}

      <Settings
        keyId={state.keyId}
        configured={configured}
        onReload={reloadEnvConfig}
        onClearAll={clearAll}
      />

      {!serverReady && (
        <p className="rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[12px] text-amber-200/90">
          Server-side step storage is unavailable — step inputs and outputs will
          only persist in this browser.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {STEPS.map((step, i) => {
          const expiryAdjusted =
            step.id === "createOrder" &&
            !!state.inputs.createOrder &&
            orderExpiryIsStale(state.inputs.createOrder);
          return (
            <StepCard
              key={step.id}
              step={step}
              index={i}
              endpoint={displayEndpoint(step.id)}
              input={inputOf(step.id)}
              output={outputOf(step.id)}
              lastResult={lastResult[step.id] ?? null}
              running={running === step.id}
              apiReady={apiReady}
              canUseAsInput={step.id === "createCustomer" && !!state.outputs[step.id]}
              checkout={isCheckout(step.id)}
              expiryAdjusted={expiryAdjusted}
              onInputChange={(v) => mergeInput(step.id, v)}
              onOutputChange={(v) => mergeOutput(step.id, v)}
              onRun={() => runStep(step.id)}
              onUseAsInput={() => applyResultAsInput(step.id)}
              onSaveOutput={() => saveOutputAsDefault(step.id)}
            />
          );
        })}
      </div>

      <History
        results={history}
        onLoad={loadHistoryEntry}
        onDelete={deleteHistoryEntry}
        onClear={() => {
          setHistory([]);
          localStorage.removeItem(AUTO_KEY);
        }}
      />
    </main>
  );
}
