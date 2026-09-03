// Gemini API client for the conversational agent. Uses the @google/genai SDK
// with function calling. Model is configurable via GEMINI_MODEL env var.
//
// The system prompt instructs the model that it's a shopping assistant with
// payment capabilities via UPI SBMD. It must NEVER create new customers —
// the customer already has an authorized mandate.

import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { toolDeclarations, executeTool } from "@/lib/agent/tools";
import {
  getOrCreateSession,
  addMessage,
  type ChatMessage,
} from "@/lib/agent/session";

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in environment variables.");
  return new GoogleGenAI({ apiKey });
}

function getModel(): string {
  return process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
}

const SYSTEM_PROMPT = `You are a friendly and helpful AI shopping assistant for AgentStore — an electronics store demo.

CAPABILITIES:
- Browse and search products using the get_all_products, search_products, and get_product tools
- Manage the customer's cart using add_to_cart, remove_from_cart, and view_cart tools  
- Process payments using the UPI Reserve Pay (SBMD) system via start_payment and complete_payment tools

PAYMENT FLOW:
The customer already has an authorized UPI SBMD (Single Block Multiple Debit) mandate. You do NOT create new customers or new mandates. When they want to pay:
1. Call start_payment — this creates a charge order and sends a pre-debit notification
2. Call complete_payment — this executes the recurring payment against that order

IMPORTANT: The 25-hour pre-debit notification window is EXPECTED. If the payment comes back as "scheduled", reassure the customer that this is normal — Razorpay requires a 25-hour waiting period after notification before the funds can be debited. The payment will be processed automatically.

FORMATTING:
- When showing products, present them clearly with name, price, and description
- Format prices in INR (the prices are in paise, so divide by 100 for rupees)
- Be concise but helpful
- Use emoji sparingly for a friendly tone
- When the cart is empty and the user wants to pay, suggest adding items first

DO NOT:
- Never mention creating customers or mandates
- Never ask for payment credentials or UPI IDs
- Never expose internal IDs (customer_id, token_id) to the user
- Never hallucinate products — only show what the tools return`;

export interface AgentResponse {
  text: string;
  toolCalls?: { name: string; args: Record<string, unknown>; result: unknown }[];
}

/**
 * Process a user message through the Gemini agent. Handles multi-turn
 * function calling (the model may call multiple tools in sequence).
 * Returns the final text response.
 */
export async function processAgentMessage(
  sessionId: string,
  userMessage: string
): Promise<AgentResponse> {
  const client = getClient();
  const session = getOrCreateSession(sessionId);

  // Record the user message
  addMessage(sessionId, { role: "user", text: userMessage });

  // Build conversation history for Gemini
  const contents: Content[] = session.messages.map((msg: ChatMessage) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.text }] as Part[],
  }));

  const allToolCalls: { name: string; args: Record<string, unknown>; result: unknown }[] = [];

  // Loop: call Gemini, execute any tool calls, feed results back, repeat
  // until the model returns a text response with no more tool calls.
  let maxIterations = 10; // safety limit
  let currentContents = contents;

  while (maxIterations-- > 0) {
    const response = await client.models.generateContent({
      model: getModel(),
      contents: currentContents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ functionDeclarations: toolDeclarations }],
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      // No response — return a fallback
      const fallback = "I'm sorry, I couldn't process that. Could you try again?";
      addMessage(sessionId, { role: "model", text: fallback });
      return { text: fallback, toolCalls: allToolCalls };
    }

    const parts = candidate.content.parts;

    // Check if there are function calls
    const functionCalls = parts.filter(
      (p): p is Part & { functionCall: { name: string; args: Record<string, unknown> } } =>
        !!p.functionCall
    );

    if (functionCalls.length === 0) {
      // No tool calls — extract the text response
      const textParts = parts.filter((p) => p.text).map((p) => p.text!);
      const finalText = textParts.join("\n") || "I'm here to help! What would you like to do?";
      addMessage(sessionId, { role: "model", text: finalText });
      return { text: finalText, toolCalls: allToolCalls };
    }

    // Execute each function call
    const functionResponses: Part[] = [];
    for (const fc of functionCalls) {
      const { name, args } = fc.functionCall;
      const result = await executeTool(name, args ?? {}, session);
      allToolCalls.push({ name, args: args ?? {}, result });
      functionResponses.push({
        functionResponse: {
          name,
          response: result as Record<string, unknown>,
        },
      });
    }

    // Feed tool results back to the model
    currentContents = [
      ...currentContents,
      { role: "model", parts: parts },
      { role: "user", parts: functionResponses },
    ];
  }

  // If we exhausted iterations, return what we have
  const fallback = "I processed your request. Is there anything else I can help with?";
  addMessage(sessionId, { role: "model", text: fallback });
  return { text: fallback, toolCalls: allToolCalls };
}
