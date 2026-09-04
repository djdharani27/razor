// Group 1 SBMD endpoints. The step definitions in lib/steps.ts choose the
// path; only /v1 paths are allowed through to api.razorpay.com.
//
// Credentials come from server-side env vars (RAZORPAY_KEY_ID /
// RAZORPAY_KEY_SECRET, see .env.example) — never from the request body. The
// browser only ever sends the endpoint/method/body to proxy.

const ALLOWED_PREFIX = "/v1/";

const RAZORPAY_BASE = "https://api.razorpay.com";

const ALLOWED_METHODS = new Set(["POST", "GET"]);

function razorpayCredentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  return { keyId, keySecret };
}

interface RzpRequest {
  endpoint: string;
  method: string;
  body?: string;
}

function notJson(message: string, status: number) {
  return Response.json({ error: { message } }, { status });
}

// Never log the secret — it is used only to build the Basic auth header here.
export async function POST(request: Request) {
  let payload: RzpRequest;
  try {
    payload = await request.json();
  } catch {
    return notJson("Request body must be valid JSON.", 400);
  }

  const { endpoint, method: rawMethod, body } = payload ?? {};

  const { keyId, keySecret } = razorpayCredentials();
  if (!keyId || !keySecret) {
    return notJson(
      "Razorpay credentials are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the server environment (.env.local).",
      500
    );
  }
  if (typeof endpoint !== "string" || !endpoint.startsWith(ALLOWED_PREFIX)) {
    return notJson("Endpoint must be under /v1/.", 400);
  }
  const method = (rawMethod || "POST").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return notJson("Only POST and GET are supported.", 400);
  }

  const basicAuth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString(
    "base64"
  )}`;

  let upstream: Response;
  try {
    const hasBody = method !== "GET" && method !== "HEAD";
    upstream = await fetch(`${RAZORPAY_BASE}${endpoint}`, {
      method,
      headers: {
        Authorization: basicAuth,
        "Content-Type": "application/json",
      },
      ...(hasBody ? { body: body ?? "{}" } : {}),
    });
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : "Unknown network error";
    return notJson(`Could not reach Razorpay: ${detail}`, 502);
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get("content-type") ?? "";

  // Preserve the exact upstream status; surface Razorpay's error shape
  // (their non-2xx bodies are { error: { code, description, ... } }).
  if (contentType.includes("application/json")) {
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    // If this is Step 2.1 (/v1/payments/:id) and a mandate token was returned successfully,
    // create the agent delegation code specifically for this verified customer!
    if (
      endpoint.startsWith("/v1/payments/") &&
      method === "GET" &&
      typeof json === "object" &&
      json !== null &&
      "token_id" in json &&
      typeof (json as Record<string, unknown>).token_id === "string" &&
      (json as Record<string, unknown>).token_id
    ) {
      try {
        const { persistMandate } = await import("@/lib/payments");
        const { upsertCustomer } = await import("@/lib/db");
        const p = json as Record<string, unknown>;
        const tokenId = String(p.token_id ?? "").trim();
        const rzpCustId = String(p.customer_id ?? "").trim();
        const rawContact = String(p.contact ?? "").replace(/[^\d]/g, "").slice(-10) || "9876543210";
        const email = typeof p.email === "string" ? p.email : null;
        const name = "Customer";

        const cust = upsertCustomer({ contact: rawContact, name, email, rzpCustomerId: rzpCustId });
        const stored = persistMandate({
          localCustomerId: cust.id,
          rzpCustomerId: rzpCustId,
          tokenId,
          authOrderId: String(p.order_id ?? ""),
          authPaymentId: String(p.id ?? ""),
          fallbackBlockPaise: 1000000,
          fallbackExpireAt: Math.floor(Date.now() / 1000) + 86400 * 90,
          endpoint: "/api/rzp-sbmd (Step 2.1)",
        });

        p.agent_code = stored.agentCode;
        p.agent_token = stored.agentCode;
      } catch (e) {
        // Logging only - keep original response intact on error
      }
    }

    return Response.json(json, { status: upstream.status });
  }

  return Response.json(
    { raw: text },
    { status: upstream.status, headers: { "Content-Type": "application/json" } }
  );
}
