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

/** Seed six sample products into the products table. */
export function seedProducts(db: Database.Database = getDb()): void {
  const insert = db.prepare(
    `INSERT INTO products (name, description, price_paise, stock, image_url)
     VALUES (@name, @description, @price_paise, @stock, @image_url)`
  );
  const now = Date.now();
  const seed = [
    { name: "Wireless Bluetooth Earbuds", description: "Noise-cancelling earbuds with 24h battery life and fast charging.", price_paise: 199900, stock: 25, image_url: `https://picsum.photos/seed/${now}-earbuds/600/400` },
    { name: "Smart Fitness Band", description: "Heart-rate tracking, step counter, sleep monitoring and 10-day battery.", price_paise: 249900, stock: 18, image_url: `https://picsum.photos/seed/${now}-band/600/400` },
    { name: "Mechanical Keyboard (RGB)", description: "Hot-swappable switches, aluminium frame and per-key RGB lighting.", price_paise: 499900, stock: 12, image_url: `https://picsum.photos/seed/${now}-keyboard/600/400` },
    { name: "Portable SSD 1TB", description: "Pocket-sized USB-C SSD with 1050MB/s read speeds.", price_paise: 899900, stock: 9, image_url: `https://picsum.photos/seed/${now}-ssd/600/400` },
    { name: "4K Action Camera", description: "Waterproof 4K camera with image stabilisation and voice control.", price_paise: 1499900, stock: 6, image_url: `https://picsum.photos/seed/${now}-camera/600/400` },
    { name: "Ergonomic Office Chair", description: "Mesh-backed chair with lumbar support and adjustable armrests.", price_paise: 1199900, stock: 4, image_url: `https://picsum.photos/seed/${now}-chair/600/400` },
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

export function markOrderPaid(paymentLinkId: string): void {
  initDb()
    .prepare("UPDATE orders SET status = 'paid' WHERE razorpay_payment_link_id = ?")
    .run(paymentLinkId);
}

export function markOrderFailed(paymentLinkId: string): void {
  initDb()
    .prepare("UPDATE orders SET status = 'failed' WHERE razorpay_payment_link_id = ?")
    .run(paymentLinkId);
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
