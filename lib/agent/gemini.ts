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
- Collect the customer's identity with remember_customer (needed before the first payment)
- Process payments with UPI Reserve Pay via pay_cart_now

PAYMENT FLOW (UPI Reserve Pay — one block, multiple debits):
The customer can approve a single UPI block once (in a checkout popup) and then be debited instantly on later orders — no PIN on repeat purchases.
1. Before the FIRST payment, the customer must provide their name and a 10-digit Indian mobile number (email optional). If they have not, ask for these details and call remember_customer.
2. When the customer asks to pay and the cart is not empty, call pay_cart_now exactly once. It returns one of:
   - status "captured" — the payment was debited immediately from the customer's existing UPI Reserve Pay block. Confirm the order to the customer.
   - status "needs_authorisation" — no reusable block exists yet (first purchase, block expired, or used up). Tell the customer to click the "Approve UPI Reserve Pay block" button that appears in the chat to approve a one-time block in the UPI popup. After they approve, the payment completes automatically — do NOT call pay_cart_now again.
   - status "failed" with an error — explain the error and suggest a fix (e.g. the block limit is ₹10,000).
3. If the cart is empty when the customer asks to pay, suggest adding items first.

IMPORTANT:
- Call pay_cart_now only once per payment request and wait for its result before speaking.
- Never call remember_customer with details the customer has not provided.
- A "needs_authorisation" result is NOT a failure — it is the first step of the flow. The block approval happens in the browser popup, not in the chat.

FORMATTING:
- When showing products, present them clearly with name, price, and description
- Format prices in INR (the prices are in paise, so divide by 100 for rupees)
- Be concise but helpful
- Use emoji sparingly for a friendly tone

DO NOT:
- Never ask for payment credentials, UPI PINs, or UPI IDs — the customer approves via the Razorpay popup only
- Never expose internal IDs (order_id, customer_id, token_id) to the user
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
