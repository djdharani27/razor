import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AgentLogRow, CartItem, Product } from "./types";

export const DB_FILE = "./data/agentstore.db";

function getDb(): Database.Database {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return new Database(DB_FILE);
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
    CREATE TABLE IF NOT EXISTS agent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      arguments_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      timestamp INTEGER NOT NULL
    );
  `);
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
  const now = Date.now();
  const seed = [
    { name: "Sticker Pack (10)", description: "10 glossy die-cut stickers with vibrant prints.", price_paise: 4900, stock: 50, image_url: `https://picsum.photos/seed/${now}-stickers/600/400` },
    { name: "Phone Stand", description: "Foldable aluminium phone stand with anti-slip grip.", price_paise: 8900, stock: 40, image_url: `https://picsum.photos/seed/${now}-stand/600/400` },
    { name: "Wireless Mouse", description: "Silent-click wireless mouse with ergonomic design.", price_paise: 29900, stock: 25, image_url: `https://picsum.photos/seed/${now}-mouse/600/400` },
    { name: "Bluetooth Speaker", description: "Portable speaker with 12h battery and deep bass.", price_paise: 49900, stock: 15, image_url: `https://picsum.photos/seed/${now}-speaker/600/400` },
  ];
  const tx = db.transaction((rows: typeof seed) => {
    for (const row of rows) insert.run(row);
  });
  tx(seed);
}

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

export function getOrder(orderId: number) {
  return initDb().prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
}

export function insertOrder(order: {
  razorpay_payment_link_id: string;
  status: string;
  amount_paise: number;
  items: CartItem[];
}): number {
  const info = initDb()
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

export function markOrderPaid(paymentLinkId: string): number {
  const info = initDb()
    .prepare("UPDATE orders SET status = 'paid' WHERE razorpay_payment_link_id = ?")
    .run(paymentLinkId);
  return info.changes;
}

export function markOrderFailed(paymentLinkId: string): number {
  const info = initDb()
    .prepare("UPDATE orders SET status = 'failed' WHERE razorpay_payment_link_id = ?")
    .run(paymentLinkId);
  return info.changes;
}

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
