// POST /api/agent/chat — Core agent endpoint.
// Accepts { message, sessionId? } and returns the agent's response.
// Uses Gemini with function calling to process the message,
// executing tools server-side (product search, cart, SBMD payments).

import { NextResponse } from "next/server";
import { processAgentMessage } from "@/lib/agent/gemini";
import { getOrCreateSession } from "@/lib/agent/session";

function generateSessionId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { message, sessionId: rawSessionId } = body as {
      message?: string;
      sessionId?: string;
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
    // Ensure session exists
    getOrCreateSession(sessionId);

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
