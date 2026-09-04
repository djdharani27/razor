// Session store for the AI agent.
// Tracks conversation history, cart state, customer identity, and payment state per session.
// Persisted in memory on globalThis and mirrored to .server-logs/sessions.json
// so Next.js route re-evaluations and restarts never drop the customer's cart.

import fs from "node:fs";
import path from "node:path";
import type { CartItem } from "@/lib/types";

export interface SessionCustomer {
  name: string;
  contact: string; // 10-digit mobile
  email?: string | null;
  rzpCustomerId?: string | null;
}

export interface PaymentState {
  /** Status of the current payment flow. */
  status:
    | "idle"
    | "needs_authorisation"
    | "debit_created"
    | "captured"
    | "failed";
  /** Authorisation order (step 1.2) awaiting customer approval in the modal. */
  authOrderId: string | null;
  /** Charge order id (step 3.1) for the in-flight debit. */
  chargeOrderId: string | null;
  /** Local order id of the most recent captured order. */
  lastOrderId: number | null;
  /** Amount in paise being processed. */
  amountPaise: number;
  /** Receipt counter for charge orders. */
  receiptNo: number;
  /** Error message if status is "error"/"failed". */
  errorMessage: string | null;
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
  customer: SessionCustomer | null;
  createdAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __agent_sessions: Map<string, AgentSession> | undefined;
}

const sessions: Map<string, AgentSession> =
  globalThis.__agent_sessions || (globalThis.__agent_sessions = new Map<string, AgentSession>());

const SESSIONS_FILE = path.join(process.cwd(), ".server-logs", "agent_sessions.json");

function loadPersistedSessions(): void {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
      const list = JSON.parse(raw) as AgentSession[];
      if (Array.isArray(list)) {
        for (const s of list) {
          if (s?.id && !sessions.has(s.id)) {
            sessions.set(s.id, s);
          }
        }
      }
    }
  } catch {
    // transient read error ignored
  }
}

// Initial load on first module evaluation
loadPersistedSessions();

function savePersistedSessions(): void {
  try {
    const dir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const array = Array.from(sessions.values());
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(array, null, 2), "utf-8");
  } catch {
    // transient write error ignored
  }
}

function freshPayment(): PaymentState {
  return {
    status: "idle",
    authOrderId: null,
    chargeOrderId: null,
    lastOrderId: null,
    amountPaise: 0,
    receiptNo: 1,
    errorMessage: null,
  };
}

export function getOrCreateSession(sessionId: string): AgentSession {
  let session = sessions.get(sessionId);
  if (!session) {
    loadPersistedSessions();
    session = sessions.get(sessionId);
  }

  if (!session) {
    session = {
      id: sessionId,
      cart: [],
      messages: [],
      payment: freshPayment(),
      customer: null,
      createdAt: Date.now(),
    };
    sessions.set(sessionId, session);
    savePersistedSessions();
  }
  return session;
}

export function getSession(sessionId: string): AgentSession | undefined {
  return getOrCreateSession(sessionId);
}

export function addMessage(sessionId: string, msg: ChatMessage): void {
  const session = getOrCreateSession(sessionId);
  session.messages.push(msg);
  savePersistedSessions();
}

export function getMessages(sessionId: string): ChatMessage[] {
  return getOrCreateSession(sessionId).messages;
}

export function setCart(sessionId: string, cart: CartItem[]): void {
  const session = getOrCreateSession(sessionId);
  session.cart = cart;
  savePersistedSessions();
}

export function getCart(sessionId: string): CartItem[] {
  return getOrCreateSession(sessionId).cart;
}

export function setCustomer(sessionId: string, customer: SessionCustomer): void {
  const session = getOrCreateSession(sessionId);
  session.customer = {
    name: customer.name,
    contact: customer.contact,
    email: customer.email ?? null,
    rzpCustomerId: customer.rzpCustomerId ?? null,
  };
  savePersistedSessions();
}

export function getCustomer(sessionId: string): SessionCustomer | null {
  return getOrCreateSession(sessionId).customer;
}

export function updatePayment(sessionId: string, patch: Partial<PaymentState>): void {
  const session = getOrCreateSession(sessionId);
  Object.assign(session.payment, patch);
  savePersistedSessions();
}

export function getPayment(sessionId: string): PaymentState {
  return getOrCreateSession(sessionId).payment;
}

export function resetPayment(sessionId: string): void {
  const session = getOrCreateSession(sessionId);
  session.payment = freshPayment();
  savePersistedSessions();
}

/** Find any active session with cart items for this customer contact (recovery fallback) */
export function findSessionByContact(contact: string): AgentSession | undefined {
  loadPersistedSessions();
  const cleanContact = contact.replace(/[^\d]/g, "").slice(-10);
  for (const s of sessions.values()) {
    if (
      s.customer?.contact?.replace(/[^\d]/g, "").slice(-10) === cleanContact &&
      s.cart.length > 0
    ) {
      return s;
    }
  }
  return undefined;
}
