import type { Metadata } from "next";
import { Inter } from "next/font/google";
import CartProvider from "@/components/cart-context";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Razorpay — Agentic Commerce Demo",
  description:
    "An AI-agent-friendly e-commerce demo. Browse products, add to cart and check out with Razorpay test payments — hands-free via the WebMCP agent tools.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-[#F4F4F0] text-[#000000] antialiased selection:bg-[#CCFF00] selection:text-[#000000]`}>
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
