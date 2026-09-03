// Simulates Razorpay webhook events against your local server for the UPI
// Reserve Pay rebuild.
// Usage:
//   node scripts/simulate-webhook.mjs captured   [razorpayOrderId] [paymentId] [tokenId]
//   node scripts/simulate-webhook.mjs token-cancelled [tokenId]
//   node scripts/simulate-webhook.mjs failed     [razorpayOrderId] [paymentId]
//
// Reads RAZORPAY_WEBHOOK_SECRET from .env.local and signs the payload exactly
// the way Razorpay does (HMAC-SHA256 over the raw body).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader (no dotenv dependency).
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
if (!secret) {
  console.error("RAZORPAY_WEBHOOK_SECRET is not set in .env.local — cannot sign the payload.");
  process.exit(1);
}

const kind = process.argv[2] ?? "captured";
const arg1 = process.argv[3] ?? "order_test_example";
const arg2 = process.argv[4] ?? "pay_test_example";
const arg3 = process.argv[5] ?? "token_test_example";

let payload;
switch (kind) {
  case "captured": {
    payload = {
      entity: "event",
      account_id: "acc_test_example",
      event: "payment.captured",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: arg2,
            entity: "payment",
            order_id: arg1,
            status: "captured",
            amount: 50000,
            currency: "INR",
            token_id: arg3,
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    };
    break;
  }
  case "failed": {
    payload = {
      entity: "event",
      account_id: "acc_test_example",
      event: "payment.failed",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: arg2,
            entity: "payment",
            order_id: arg1,
            status: "failed",
            amount: 50000,
            currency: "INR",
            token_id: arg3,
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    };
    break;
  }
  case "token-cancelled": {
    payload = {
      entity: "event",
      account_id: "acc_test_example",
      event: "token.cancelled",
      contains: ["token"],
      payload: {
        token: {
          entity: {
            id: arg1,
            entity: "token",
            customer_id: arg2,
            method: "upi",
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    };
    break;
  }
  default:
    console.error(`Unknown event kind "${kind}" — use captured, failed, or token-cancelled.`);
    process.exit(1);
}

const rawBody = JSON.stringify(payload);
const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const res = await fetch(`${baseUrl}/api/webhook/razorpay`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-razorpay-signature": signature,
  },
  body: rawBody,
});

console.log(`POST ${baseUrl}/api/webhook/razorpay`);
console.log(`  event:   ${payload.event}`);
console.log(`  id:      ${kind === "token-cancelled" ? arg1 : `${arg1} / payment ${arg2}`}`);
console.log(`  status:  ${res.status} ${res.statusText}`);
console.log(`  response: ${await res.text()}`);
