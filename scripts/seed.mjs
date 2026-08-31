// Idempotent seed script. Usage: npm run seed
// Creates the SQLite schema and inserts the six sample products if the
// products table is empty. Safe to run multiple times.
import { initDb, seedProducts } from "../lib/db.ts";

const db = initDb();
const count = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;

if (count === 0) {
  seedProducts(db);
  console.log("✅ Seeded 6 sample products into the database.");
} else {
  console.log(`ℹ️  Products table already has ${count} rows — nothing to do.`);
}
