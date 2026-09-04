import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AgentLogRow,
  CartItem,
  CustomerRow,
  MandateRow,
  MandateStatus,
  OrderRow,
  Product,
} from "./types";

export const DB_FILE = "./data/agentstore.db";

function getDb(): Database.Database {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return new Database(DB_FILE);
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

/** Migrate a legacy orders table (created before the Reserve Pay rebuild) by
 *  adding the new nullable columns. Pre-existing rows keep kind = NULL
 *  (interpreted as legacy standard-checkout rows) and an empty payment_id. */
function migrateOrders(db: Database.Database): void {
  const add = (column: string, decl: string) => {
    if (!columnExists(db, "orders", column)) {
      db.exec(`ALTER TABLE orders ADD COLUMN ${column} ${decl}`);
    }
  };
  add("kind", "TEXT");
  add("customer_id", "INTEGER");
  add("rzp_order_id", "TEXT");
  add("payment_id", "TEXT");
  add("mandate_id", "INTEGER");
}

function migrateMandates(db: Database.Database): void {
  if (!columnExists(db, "mandates", "agent_code")) {
    db.exec("ALTER TABLE mandates ADD COLUMN agent_code TEXT");
  }
}

/** Init schema and run seed if the products table is empty. Called lazily. */
export function initDb(): Database.Database {
  const db = getDb();
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_paise INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      image_url TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      razorpay_payment_link_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'created',
      amount_paise INTEGER NOT NULL DEFAULT 0,
      items_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT,
      rzp_customer_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mandates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      token_id TEXT NOT NULL,
      auth_order_id TEXT NOT NULL,
      auth_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      max_amount_paise INTEGER NOT NULL,
      amount_debited_paise INTEGER NOT NULL DEFAULT 0,
      expire_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      agent_code TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      arguments_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      timestamp INTEGER NOT NULL
    );
  `);
  migrateOrders(db);
  migrateMandates(db);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM products").get() as { n: number }).n;
  if (count === 0) seedProducts(db);
  return db;
}

/** Seed four sample products into the products table. */
export function seedProducts(db: Database.Database = getDb()): void {
  const insert = db.prepare(
    `INSERT INTO products (name, description, price_paise, stock, image_url)
     VALUES (@name, @description, @price_paise, @stock, @image_url)`
  );
  const seed = [
    {
      name: "Sticker Pack (10)",
      description: "10 glossy die-cut stickers with vibrant prints.",
      price_paise: 4900,
      stock: 50,
      image_url: "https://images.unsplash.com/photo-1611926653458-09294b3142bf?w=600&q=80&auto=format&fit=crop",
    },
    {
      name: "Phone Stand",
      description: "Foldable aluminium phone stand with anti-slip grip.",
      price_paise: 8900,
      stock: 40,
      image_url: "https://images.unsplash.com/photo-1585790050230-5dd28404ccb9?w=600&q=80&auto=format&fit=crop",
    },
    {
      name: "Wireless Mouse",
      description: "Silent-click wireless mouse with ergonomic design.",
      price_paise: 29900,
      stock: 25,
      image_url: "https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=600&q=80&auto=format&fit=crop",
    },
    {
      name: "Bluetooth Speaker",
      description: "Portable speaker with 12h battery and deep bass.",
      price_paise: 49900,
      stock: 15,
      image_url: "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=600&q=80&auto=format&fit=crop",
    },
  ];
  const tx = db.transaction((rows: typeof seed) => {
    for (const row of rows) insert.run(row);
  });
  tx(seed);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export function getAllProducts(): Product[] {
  return initDb().prepare("SELECT * FROM products ORDER BY id ASC").all() as Product[];
}

export function findProducts(query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return getAllProducts();
  return getAllProducts().filter(
    (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
  );
}

export function getProductById(id: number): Product | undefined {
  return initDb().prepare("SELECT * FROM products WHERE id = ?").get(id) as Product | undefined;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderKind = "charge" | "standard";

export function getOrder(orderId: number): OrderRow | undefined {
  return initDb().prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as OrderRow | undefined;
}

export function getOrderByRzpOrderId(rzpOrderId: string): OrderRow | undefined {
  return initDb()
    .prepare("SELECT * FROM orders WHERE rzp_order_id = ? OR razorpay_payment_link_id = ?")
    .get(rzpOrderId, rzpOrderId) as OrderRow | undefined;
}

export interface NewOrderInput {
  rzpOrderId: string;
  amount_paise: number;
  items: CartItem[];
  kind: OrderKind;
  customerId?: number | null;
  mandateId?: number | null;
}

export function insertOrder(order: {
  razorpay_payment_link_id: string;
  status: string;
  amount_paise: number;
  items: CartItem[];
}): number {
  const db = initDb();
  const info = db
    .prepare(
      `INSERT INTO orders (razorpay_payment_link_id, status, amount_paise, items_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      order.razorpay_payment_link_id,
      order.status,
      order.amount_paise,
      JSON.stringify(order.items),
      Date.now()
    );
  return Number(info.lastInsertRowid);
}

/** Insert a Reserve Pay charge order row (kind = 'charge'). */
export function insertChargeOrder(input: NewOrderInput): number {
  const db = initDb();
  const info = db
    .prepare(
      `INSERT INTO orders
         (razorpay_payment_link_id, status, amount_paise, items_json, created_at,
          kind, customer_id, rzp_order_id, payment_id, mandate_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(
      input.rzpOrderId,
      "created",
      input.amount_paise,
      JSON.stringify(input.items),
      Date.now(),
      input.kind,
      input.customerId ?? null,
      input.rzpOrderId,
      input.mandateId ?? null
    );
  return Number(info.lastInsertRowid);
}

export function updateOrderStatus(orderId: number, status: "paid" | "failed"): number {
  return initDb()
    .prepare("UPDATE orders SET status = ? WHERE id = ?")
    .run(status, orderId).changes;
}

/** Attach a captured payment id and flip the order to paid (webhook path). */
export function recordOrderPayment(paymentLinkId: string, paymentId: string): number {
  return initDb()
    .prepare(
      `UPDATE orders SET status = 'paid', payment_id = COALESCE(payment_id, ?)
       WHERE razorpay_payment_link_id = ?`
    )
    .run(paymentId, paymentLinkId).changes;
}

export function recordPaymentForOrder(localOrderId: number, paymentId: string): number {
  return initDb()
    .prepare("UPDATE orders SET status = 'paid', payment_id = ? WHERE id = ?")
    .run(paymentId, localOrderId).changes;
}

/** Invalidate any created (unpaid) orders that were going to debit this mandate. */
export function failOpenOrdersForMandate(mandateId: number): void {
  initDb()
    .prepare("UPDATE orders SET status = 'failed' WHERE mandate_id = ? AND status = 'created'")
    .run(mandateId);
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export function getCustomerByContact(contact: string): CustomerRow | undefined {
  return initDb().prepare("SELECT * FROM customers WHERE contact = ?").get(contact) as
    | CustomerRow
    | undefined;
}

export function getCustomerById(id: number): CustomerRow | undefined {
  return initDb().prepare("SELECT * FROM customers WHERE id = ?").get(id) as CustomerRow | undefined;
}

export function getCustomerByRzpId(rzpCustomerId: string): CustomerRow | undefined {
  return initDb()
    .prepare("SELECT * FROM customers WHERE rzp_customer_id = ?")
    .get(rzpCustomerId) as CustomerRow | undefined;
}

export function upsertCustomer(input: {
  contact: string;
  name: string;
  email?: string | null;
  rzpCustomerId?: string | null;
}): CustomerRow {
  const db = initDb();
  const existing = getCustomerByContact(input.contact);
  if (existing) {
    db.prepare(
      `UPDATE customers
       SET name = ?, email = COALESCE(?, email), rzp_customer_id = COALESCE(?, rzp_customer_id)
       WHERE id = ?`
    ).run(input.name, input.email ?? null, input.rzpCustomerId ?? null, existing.id);
    return getCustomerById(existing.id)!;
  }
  const info = db
    .prepare(
      `INSERT INTO customers (contact, name, email, rzp_customer_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.contact, input.name, input.email ?? null, input.rzpCustomerId ?? null, Date.now());
  return getCustomerById(Number(info.lastInsertRowid))!;
}

// ---------------------------------------------------------------------------
// Mandates
// ---------------------------------------------------------------------------

export function getMandateById(id: number): MandateRow | undefined {
  return initDb().prepare("SELECT * FROM mandates WHERE id = ?").get(id) as MandateRow | undefined;
}

export function getMandateByTokenId(tokenId: string): MandateRow | undefined {
  return initDb().prepare("SELECT * FROM mandates WHERE token_id = ?").get(tokenId) as
    | MandateRow
    | undefined;
}

export function getMandatesForCustomer(customerId: number): MandateRow[] {
  return initDb()
    .prepare("SELECT * FROM mandates WHERE customer_id = ? ORDER BY id DESC")
    .all(customerId) as MandateRow[];
}

export function generateAgentCode(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `RZP-${num}`;
}

/** Newest non-terminal mandate, or undefined when re-authorisation is needed. */
export function getActiveMandate(customerId: number): MandateRow | undefined {
  const db = initDb();
  const mandate = db
    .prepare(
      `SELECT * FROM mandates
       WHERE customer_id = ? AND status = 'active' AND expire_at > ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(customerId, Math.floor(Date.now() / 1000)) as MandateRow | undefined;

  if (mandate && !mandate.agent_code) {
    const code = generateAgentCode();
    db.prepare("UPDATE mandates SET agent_code = ? WHERE id = ?").run(code, mandate.id);
    mandate.agent_code = code;
  }
  return mandate;
}

export function getMandateByAgentCode(
  code: string
): { mandate: MandateRow; customer: CustomerRow } | undefined {
  const clean = code.trim().toUpperCase();
  if (!clean) return undefined;
  const db = initDb();
  const row = db
    .prepare(
      `SELECT m.*, c.name AS customer_name, c.contact AS customer_contact, c.email AS customer_email, c.rzp_customer_id
       FROM mandates m
       JOIN customers c ON c.id = m.customer_id
       WHERE UPPER(m.agent_code) = ? AND m.status = 'active' AND m.expire_at > ?
       ORDER BY m.id DESC LIMIT 1`
    )
    .get(clean, Math.floor(Date.now() / 1000)) as
    | (MandateRow & {
        customer_name: string;
        customer_contact: string;
        customer_email: string | null;
        rzp_customer_id: string | null;
      })
    | undefined;

  if (!row) return undefined;

  const customer: CustomerRow = {
    id: row.customer_id,
    contact: row.customer_contact,
    name: row.customer_name,
    email: row.customer_email,
    rzp_customer_id: row.rzp_customer_id,
    created_at: row.created_at,
  };

  const mandate: MandateRow = {
    id: row.id,
    customer_id: row.customer_id,
    token_id: row.token_id,
    auth_order_id: row.auth_order_id,
    auth_payment_id: row.auth_payment_id,
    status: row.status,
    max_amount_paise: row.max_amount_paise,
    amount_debited_paise: row.amount_debited_paise,
    expire_at: row.expire_at,
    created_at: row.created_at,
    agent_code: row.agent_code,
  };

  return { mandate, customer };
}

export function insertMandate(input: {
  customerId: number;
  tokenId: string;
  authOrderId: string;
  authPaymentId?: string | null;
  maxAmountPaise: number;
  expireAt: number;
  agentCode?: string | null;
}): number {
  // Deactivate any prior active mandates — a fresh block supersedes them.
  const db = initDb();
  db.prepare("UPDATE mandates SET status = 'used' WHERE customer_id = ? AND status = 'active'")
    .run(input.customerId);
  const agentCode = input.agentCode ?? generateAgentCode();
  const info = db
    .prepare(
      `INSERT INTO mandates
         (customer_id, token_id, auth_order_id, auth_payment_id, status,
          max_amount_paise, amount_debited_paise, expire_at, created_at, agent_code)
       VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?, ?)`
    )
    .run(
      input.customerId,
      input.tokenId,
      input.authOrderId,
      input.authPaymentId ?? null,
      input.maxAmountPaise,
      input.expireAt,
      Date.now(),
      agentCode
    );
  return Number(info.lastInsertRowid);
}

export function markMandateCancelled(tokenId: string, reason: MandateStatus = "cancelled"): void {
  initDb()
    .prepare("UPDATE mandates SET status = ? WHERE token_id = ? AND status = 'active'")
    .run(reason, tokenId);
}

export function markMandateExpired(customerId: number): void {
  initDb()
    .prepare(
      "UPDATE mandates SET status = 'expired' WHERE customer_id = ? AND status = 'active' AND expire_at <= ?"
    )
    .run(customerId, Math.floor(Date.now() / 1000));
}

/** Add a successful debit to the mandate's ledger. */
export function debitMandate(mandateId: number, amountPaise: number): void {
  initDb()
    .prepare("UPDATE mandates SET amount_debited_paise = amount_debited_paise + ? WHERE id = ?")
    .run(amountPaise, mandateId);
}

/** Whether the mandate still has headroom for amountPaise (in paise). */
export function mandateHasRoom(mandate: MandateRow, amountPaise: number): boolean {
  if (mandate.status !== "active") return false;
  if (mandate.expire_at <= Math.floor(Date.now() / 1000)) return false;
  const remaining = Math.max(0, mandate.max_amount_paise - mandate.amount_debited_paise);
  return amountPaise <= remaining;
}

export function expireStaleMandates(): void {
  initDb()
    .prepare(
      "UPDATE mandates SET status = 'expired' WHERE status = 'active' AND expire_at <= ?"
    )
    .run(Math.floor(Date.now() / 1000));
}

// ---------------------------------------------------------------------------
// Agent logs
// ---------------------------------------------------------------------------

export function getRecentAgentLog(limit = 20): AgentLogRow[] {
  return initDb()
    .prepare("SELECT * FROM agent_log ORDER BY id DESC LIMIT ?")
    .all(limit) as AgentLogRow[];
}

export function insertAgentLog(entry: {
  tool_name: string;
  arguments_json: string;
  result_json: string;
}): void {
  initDb()
    .prepare(
      `INSERT INTO agent_log (tool_name, arguments_json, result_json, timestamp)
       VALUES (?, ?, ?, ?)`
    )
    .run(entry.tool_name, entry.arguments_json, entry.result_json, Date.now());
}
