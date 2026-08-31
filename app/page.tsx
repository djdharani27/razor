import { initDb, getAllProducts } from "@/lib/db";
import Storefront from "@/components/storefront";

export const dynamic = "force-dynamic";

export default function Home() {
  initDb(); // ensure schema + seed before first read
  const products = getAllProducts();
  return <Storefront products={products} />;
}
