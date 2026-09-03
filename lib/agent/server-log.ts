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

export function logServer(
  stage: string,
  message: string,
  opts: { level?: ServerLogLevel; detail?: unknown } = {}
): void {
  const level = opts.level ?? "info";
  const ts = new Date().toISOString();
  const entry: Record<string, unknown> = { ts, level, stage, message };
  if (opts.detail !== undefined) {
    try {
      entry.detail = JSON.parse(safeStringify(opts.detail));
    } catch {
      entry.detail = "(detail not JSON-serialisable)";
    }
  }
  const fileLine = JSON.stringify(entry);
  const consoleLine = `[server-log:${stage}] ${level.toUpperCase()} ${message}`;
  const logFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  logFn(consoleLine);
  if (entry.detail !== undefined) {
    try {
      const compact = JSON.stringify(entry.detail);
      logFn(`[server-log:${stage}] ${compact.length > 2000 ? `${compact.slice(0, 2000)}…` : compact}`);
    } catch {
      // detail already stringified above — ignore
    }
  }
  appendToFile(fileLine);
}
