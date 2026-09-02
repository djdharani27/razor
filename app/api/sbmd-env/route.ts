import { NextResponse } from "next/server";

// Tells the browser which Razorpay Key ID is configured server-side and
// whether the full credential pair is present. The Key ID is Razorpay's
// "public" key (checkout.js receives it client-side anyway); the secret is
// never exposed here.

export function GET() {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  return NextResponse.json({
    configured: Boolean(keyId && keySecret),
    keyId,
  });
}
