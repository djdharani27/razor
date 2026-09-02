// Extract a dot-path field (e.g. "customer_id", "id") from a JSON object.
export function extractField(json: unknown, path: string): string | undefined {
  if (json === null || typeof json !== "object") return undefined;
  const obj = json as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(obj, path)) {
    const v = obj[path];
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    return undefined;
  }
  for (const v of Object.values(obj)) {
    const found = extractField(v, path);
    if (found) return found;
  }
  return undefined;
}

export function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function maskKeyId(id: string | undefined): string {
  if (!id) return "(none)";
  if (id.length <= 6) return id;
  return `${id.slice(0, 4)}…${id.slice(-2)}`;
}

export function summarizeResponse(body: string): string {
  try {
    const obj = JSON.parse(body) as Record<string, unknown>;
    const parts: string[] = [];
    const pick = (keys: string[]) =>
      keys.map((k) => obj[k]).find((v) => typeof v === "string") as
        | string
        | undefined;
    const id = pick([
      "customer_id",
      "order_id",
      "id",
      "razorpay_payment_id",
      "token_id",
      "status",
    ]);
    if (id) parts.push(id);
    if (typeof obj.mandate_status === "string")
      parts.push(`mandate: ${obj.mandate_status}`);
    if (typeof obj.status === "string") parts.push(`status: ${obj.status}`);
    if (typeof obj.amount === "number") parts.push(`amount: ${obj.amount}`);
    return parts.length ? parts.join(" · ") : `(HTTP ${obj.code ?? "response"})`;
  } catch {
    return "(non-JSON response)";
  }
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
