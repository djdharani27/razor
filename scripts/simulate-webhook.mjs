// Simulates a Razorpay payment_link.paid webhook against your local server.
// Usage: node scripts/simulate-webhook.mjs [paymentLinkId] [amountPaise]
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

const paymentLinkId = process.argv[2] ?? "plink_test_example";
const amountPaise = Number(process.argv[3] ?? 50000);

const payload = {
  entity: "event",
  account_id: "acc_test_example",
  event: "payment_link.paid",
  contains: ["payment_link"],
  payload: {
    payment_link: {
      entity: {
        id: paymentLinkId,
        amount: amountPaise,
        currency: "INR",
        status: "paid",
      },
    },
  },
  created_at: Math.floor(Date.now() / 1000),
};

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
console.log(`  payment_link_id: ${paymentLinkId}`);
console.log(`  signature:       ${signature.slice(0, 24)}…`);
console.log(`  status:          ${res.status} ${res.statusText}`);
console.log(`  response:        ${await res.text()}`);
