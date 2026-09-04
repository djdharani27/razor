// Clean structured logger for the payment/agent flows. Every Razorpay call and
// checkout step logs one compact line to the terminal and one JSON line to
// .server-logs/razorpay.log. Never logs secrets or full token values.

import fs from "node:fs";
import path from "node:path";

export type ServerLogLevel = "info" | "warn" | "error";

const LOG_DIR = path.join(process.cwd(), ".server-logs");
const LOG_FILE = path.join(LOG_DIR, "razorpay.log");

function appendToFile(line: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${line}\n`, "utf8");
  } catch {
    // Logging must never crash a request — ignore file errors.
  }
}

/** Redact anything that could be a live credential before it hits a log. */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const redacted = JSON.stringify(
    value,
    function (this: unknown, key: string, val: unknown) {
      const k = key.toLowerCase();
      if (
        /authorization|secret|api[_-]?key|password|token\b|razorpay_signature/i.test(k) &&
        typeof val === "string"
      ) {
        return "[REDACTED]";
      }
      if (typeof this === "object" && this !== null) {
        const self = this as Record<string, unknown>;
        if (k === "notes" || k === "detail") return val;
      }
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const obj = val as Record<string, unknown>;
        for (const [nestedKey, nestedVal] of Object.entries(obj)) {
          if (/authorization|secret|api[_-]?key|password|razorpay_signature/i.test(nestedKey) &&
              typeof nestedVal === "string") {
            obj[nestedKey] = "[REDACTED]";
          }
        }
      }
      if (val && typeof val === "object") {
        const obj = val as object;
        if (!seen.has(obj)) seen.add(obj);
      }
      return val;
    },
    2
  );
  if (redacted === undefined) return String(value);
  return redacted.length > 4000 ? `${redacted.slice(0, 4000)}…(truncated)` : redacted;
}

// Which HTTP route / agent tool triggered this log line (e.g. "/api/checkout",
// "pay_cart_now"). Shared helpers in lib/rzp.ts and lib/payments.ts are called
// from several endpoints, so the caller passes its own route here — otherwise
// server logs are impossible to attribute.
type EndpointId = string;

export interface ServerLogOptions {
  level?: ServerLogLevel;
  detail?: unknown;
  /** API route or agent tool the call came from, e.g. "/api/checkout". */
  endpoint?: EndpointId;
  /**
   * UPI Reserve Pay flow step this call belongs to (see README / lib/upi-sbmd):
   *   1.1 create customer · 1.2 authorisation order · 1.3 checkout approval
   *   2.1 fetch auth payment → token · 3.1 charge order · 3.2 recurring debit
   */
  step?: string;
  /** Razorpay API endpoint this step hits, e.g. "/v1/orders". */
  rzpEndpoint?: string;
}

export function logServer(
  stage: string,
  message: string,
  opts: ServerLogOptions = {}
): void {
  const level = opts.level ?? "info";
  const ts = new Date().toISOString();
  const entry: Record<string, unknown> = {
    ts,
    level,
    stage,
    message,
    ...(opts.step ? { step: opts.step } : {}),
    ...(opts.rzpEndpoint ? { rzp_endpoint: opts.rzpEndpoint } : {}),
    ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
  };
  if (opts.detail !== undefined) {
    try {
      entry.detail = JSON.parse(safeStringify(opts.detail));
    } catch {
      entry.detail = "(detail not JSON-serialisable)";
    }
  }
  const fileLine = JSON.stringify(entry);
  // Build a clean tag. Stages are short words ("rzp", "checkout"); endpoints
  // are either an agent tool ("pay_cart_now") or a full route such as
  // "/api/checkout". A bare-word endpoint joins as "rzp/pay_cart_now", while a
  // route endpoint already carries its path, so it stands alone.
  const endp = opts.endpoint ?? "";
  let tag = stage;
  if (endp) {
    tag = endp.startsWith("/") ? endp.slice(1) : `${stage}/${endp}`;
  }
  const stepTag = opts.step ? `Step ${opts.step}` : tag;
  const rzpTag = opts.rzpEndpoint ? ` (${opts.rzpEndpoint})` : "";

  // Terminal color constants
  const isErr = level === "error";
  const isWarn = level === "warn";
  const col = isErr ? "\x1b[31m" : isWarn ? "\x1b[33m" : "\x1b[32m";
  const cyan = "\x1b[36m";
  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";

  // Build clean human-readable card
  const lines: string[] = [];
  lines.push(`\n${bold}${col}┌─ [${stepTag}]${reset} ${bold}${message}${reset}${dim}${rzpTag}${reset}`);

  const detail = entry.detail as Record<string, any> | undefined;
  if (detail && typeof detail === "object") {
    // 1. Order Object
    if (detail.id && typeof detail.id === "string" && detail.id.startsWith("order_")) {
      const amt = typeof detail.amount === "number" ? `₹${(detail.amount / 100).toFixed(2)}` : "-";
      lines.push(`│  ${bold}Order ID:${reset}       ${cyan}${detail.id}${reset} ${dim}(Amount: ${amt}, Status: ${detail.status})${reset}`);
      if (detail.notification) {
        lines.push(`│  ${bold}Notification:${reset}   ${detail.notification.id || "registered"} ${dim}(Token: ${detail.notification.token_id || "-"})${reset}`);
        if (detail.notification.payment_after) {
          const dateStr = new Date(detail.notification.payment_after * 1000).toLocaleString();
          lines.push(`│  ${bold}Debit Window:${reset}   ${dim}25h regulatory window (Eligible: ${dateStr})${reset}`);
        }
      }
    }
    // 2. 25-Hour Pre-Debit Notice (Step 3.2)
    else if (detail.notification_schedule === "25_hours_recurring") {
      const amt = typeof detail.amount_paise === "number" ? `₹${(detail.amount_paise / 100).toFixed(2)}` : "-";
      lines.push(`│  ${bold}Order ID:${reset}       ${cyan}${detail.order_id}${reset} ${dim}(Amount: ${amt})${reset}`);
      lines.push(`│  ${bold}Token ID:${reset}       ${detail.token_id}`);
      lines.push(`│  ${bold}Status:${reset}         ${col}25-Hour Pre-Debit Notice Registered (RBI Protocol)${reset}`);
      lines.push(`│  ${bold}Mandate Action:${reset} Authorized under approved UPI Reserve Pay mandate.`);
    }
    // 3. Customer Object
    else if (detail.id && typeof detail.id === "string" && detail.id.startsWith("cust_")) {
      lines.push(`│  ${bold}Customer ID:${reset}    ${cyan}${detail.id}${reset}`);
      if (detail.name) lines.push(`│  ${bold}Name:${reset}           ${detail.name}`);
      if (detail.contact) lines.push(`│  ${bold}Contact:${reset}        ${detail.contact}`);
      if (detail.email) lines.push(`│  ${bold}Email:${reset}          ${detail.email}`);
    }
    // 4. Token Collection
    else if (detail.entity === "collection" && Array.isArray(detail.items)) {
      lines.push(`│  ${bold}Tokens Count:${reset}   ${detail.count}`);
      for (const t of detail.items) {
        lines.push(`│   • ${cyan}${t.id}${reset} (${t.method || "upi"}) → ${bold}${t.recurring_details?.status || t.status || "active"}${reset}`);
      }
    }
    // 5. Payment Result
    else if (detail.razorpay_payment_id || detail.payment_id) {
      const pid = detail.razorpay_payment_id || detail.payment_id;
      lines.push(`│  ${bold}Payment ID:${reset}     ${cyan}${pid}${reset}`);
      if (detail.amount_paise) lines.push(`│  ${bold}Amount:${reset}         ₹${(detail.amount_paise / 100).toFixed(2)}`);
      if (detail.local_order_id) lines.push(`│  ${bold}Local Order:${reset}    #${detail.local_order_id}`);
    }
    // 6. Generic Object / Fallback (Clean Key-Value)
    else {
      const entries = Object.entries(detail);
      if (entries.length > 0 && entries.length <= 5) {
        for (const [k, v] of entries) {
          const valStr = typeof v === "object" ? JSON.stringify(v) : String(v);
          lines.push(`│  ${bold}${k}:${reset} ${valStr}`);
        }
      } else {
        const compact = JSON.stringify(detail, null, 2);
        const split = compact.split("\n").slice(0, 8);
        for (const sl of split) {
          lines.push(`│  ${dim}${sl}${reset}`);
        }
        if (compact.split("\n").length > 8) {
          lines.push(`│  ${dim}...${reset}`);
        }
      }
    }
  }

  lines.push(`${bold}${col}└${"─".repeat(50)}${reset}\n`);
  const formatted = lines.join("\n");

  if (isErr) {
    console.error(formatted);
  } else if (isWarn) {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }

  appendToFile(fileLine);
}
