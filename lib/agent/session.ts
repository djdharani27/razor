// In-memory session store for the AI agent. Tracks conversation history,
// cart state, and SBMD payment state per session. Adequate for a hackathon
// demo; swap for Redis/DB in production.

import type { CartItem } from "@/lib/types";

export interface PaymentState {
  /** The charge order_id from step 3.1 */
  chargeOrderId: string | null;
  /** Status of the current charge flow */
  status: "idle" | "order_created" | "payment_pending" | "payment_scheduled" | "payment_captured" | "error";
  /** Error message if status is "error" */
  errorMessage: string | null;
  /** Amount in paise */
  amountPaise: number;
  /** Receipt counter */
  receiptNo: number;
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  /** Structured data attached to this message (product cards, payment status, etc.) */
  data?: Record<string, unknown>;
}

export interface AgentSession {
  id: string;
  cart: CartItem[];
  messages: ChatMessage[];
  payment: PaymentState;
  createdAt: number;
}

const sessions = new Map<string, AgentSession>();

function freshPayment(): PaymentState {
  return {
    chargeOrderId: null,
    status: "idle",
    errorMessage: null,
    amountPaise: 0,
    receiptNo: 1,
  };
}

export function getOrCreateSession(sessionId: string): AgentSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      cart: [],
      messages: [],
      payment: freshPayment(),
      createdAt: Date.now(),
    };
    sessions.set(sessionId, session);
  }
  return session;
}

export function getSession(sessionId: string): AgentSession | undefined {
  return sessions.get(sessionId);
}

export function addMessage(sessionId: string, msg: ChatMessage): void {
  const session = getOrCreateSession(sessionId);
  session.messages.push(msg);
}

export function getMessages(sessionId: string): ChatMessage[] {
  return getOrCreateSession(sessionId).messages;
}

export function setCart(sessionId: string, cart: CartItem[]): void {
  getOrCreateSession(sessionId).cart = cart;
}

export function getCart(sessionId: string): CartItem[] {
  return getOrCreateSession(sessionId).cart;
}

export function updatePayment(sessionId: string, patch: Partial<PaymentState>): void {
  const session = getOrCreateSession(sessionId);
  Object.assign(session.payment, patch);
}

export function getPayment(sessionId: string): PaymentState {
  return getOrCreateSession(sessionId).payment;
}

export function resetPayment(sessionId: string): void {
  getOrCreateSession(sessionId).payment = freshPayment();
}
