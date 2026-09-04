// POST /api/agent/chat — Core agent endpoint.
// Accepts { message, sessionId?, customer? } and returns the agent's response.
// Uses Gemini with function calling to process the message,
// executing tools server-side (product search, cart, UPI Reserve Pay).

import { NextResponse } from "next/server";
import { processAgentMessage } from "@/lib/agent/gemini";
import { getOrCreateSession, setCustomer } from "@/lib/agent/session";
import { initDb } from "@/lib/db";
import type { CustomerRow } from "@/lib/types";

function generateSessionId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { message, sessionId: rawSessionId, customer } = body as {
      message?: string;
      sessionId?: string;
      customer?: { name?: string; contact?: string; email?: string | null } | null;
    };

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "Message is required." },
        { status: 400 }
      );
    }

    // Check Gemini API key is configured
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured. Set it in .env.local." },
        { status: 500 }
      );
    }

    const sessionId = rawSessionId || generateSessionId();
    const session = getOrCreateSession(sessionId);

    // Seed the session with the locally-saved profile (sent from the client)
    // so a returning customer's identity is available to the payment tools
    // without re-asking.
    if (customer?.name && customer?.contact) {
      setCustomer(sessionId, {
        name: String(customer.name).trim(),
        contact: String(customer.contact).replace(/[^\d]/g, "").slice(-10),
        email: customer.email ? String(customer.email).trim() : null,
      });
    }

    const result = await processAgentMessage(sessionId, message.trim());

    return NextResponse.json({
      sessionId,
      message: result.text,
      toolCalls: result.toolCalls ?? [],
    });
  } catch (err) {
    console.error("[agent/chat] Error:", err);
    const errorMessage =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
