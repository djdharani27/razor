"use client";

import { useState } from "react";
import WebMCPTools from "@/components/webmcp-tools";
import type { Product } from "@/lib/types";

const MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      "chrome-devtools": {
        transport: "stdio",
        enabled: true,
        command: "npx",
        args: [
          "-y",
          "chrome-devtools-mcp@latest",
          "--categoryExperimentalWebmcp=true",
          "--chromeArg=--enable-features=WebMCP",
          "--chromeArg=--headless=new",
          "--no-usage-statistics",
        ],
      },
    },
  },
  null,
  2
);

export default function Storefront({ products: _products }: { products: Product[] }) {
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);

  const copyMcpConfig = () => {
    navigator.clipboard.writeText(MCP_CONFIG);
    setCopiedMcp(true);
    setTimeout(() => setCopiedMcp(false), 2000);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#F4F4F0] px-4 py-12 text-[#000000]">
      {/* WebMCP tool registration — headless background execution for autonomous agents */}
      <WebMCPTools />

      <div className="w-full max-w-xl">
        {/* Brand Header */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 border-[3px] border-[#000000] bg-[#CCFF00] px-4 py-1.5 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[3px_3px_0px_#000000]">
            <span>⚡ Razorpay UPI Reserve Pay</span>
          </div>
        </div>

        {/* Mode Selector Card */}
        <div className="border-[4px] border-[#000000] bg-[#FFFFFF] p-6 shadow-[8px_8px_0px_#000000] sm:p-8">
          <div className="text-center">
            <h2 className="text-lg font-black uppercase tracking-tight text-[#000000] sm:text-xl">
              Choose Shopping Mode
            </h2>
            <p className="mt-1 text-xs font-semibold text-[#000000]/70">
              Select how you want to interact with the store:
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Human Button */}
            <a
              href="/agent"
              className="group flex flex-col justify-between border-[3px] border-[#000000] bg-[#CCFF00] p-5 shadow-[4px_4px_0px_#000000] transition-all duration-150 hover:-translate-y-[2px] hover:shadow-[7px_7px_0px_#000000] active:translate-y-[2px] active:shadow-none"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center border-2 border-[#000000] bg-[#FFFFFF] text-2xl shadow-[2px_2px_0px_#000000]">
                    👤
                  </span>
                  <span className="border border-[#000000] bg-[#000000] px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#CCFF00]">
                    Interactive
                  </span>
                </div>
                <h3 className="mt-4 text-xl font-black uppercase tracking-tight text-[#000000]">
                  Human
                </h3>
                <p className="mt-1 text-xs font-semibold text-[#000000]/80">
                  Shop through conversational AI powered by Gemini with voice, chat, and UPI mandate authorization.
                </p>
              </div>

              <div className="mt-6 flex items-center justify-between border-t-2 border-[#000000] pt-3 font-black text-xs uppercase tracking-wider text-[#000000]">
                <span>Open /agent</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </a>

            {/* Agent Button */}
            <button
              type="button"
              onClick={() => setMcpModalOpen(true)}
              className="group flex flex-col justify-between border-[3px] border-[#000000] bg-[#FFFFFF] p-5 text-left shadow-[4px_4px_0px_#000000] transition-all duration-150 hover:-translate-y-[2px] hover:shadow-[7px_7px_0px_#000000] active:translate-y-[2px] active:shadow-none"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center border-2 border-[#000000] bg-[#000000] text-2xl text-[#FFFFFF] shadow-[2px_2px_0px_#000000]">
                    🤖
                  </span>
                  <span className="border border-[#000000] bg-[#CCFF00] px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#000000]">
                    WebMCP
                  </span>
                </div>
                <h3 className="mt-4 text-xl font-black uppercase tracking-tight text-[#000000]">
                  Agent
                </h3>
                <p className="mt-1 text-xs font-semibold text-[#000000]/80">
                  Connect Chrome DevTools MCP or Claude Desktop for autonomous browsing &amp; zero-touch token debits.
                </p>
              </div>

              <div className="mt-6 flex items-center justify-between border-t-2 border-[#000000] pt-3 font-black text-xs uppercase tracking-wider text-[#000000]">
                <span>MCP Config</span>
                <span className="transition-transform group-hover:translate-x-1">⚡</span>
              </div>
            </button>
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="mt-6 flex items-center justify-center gap-4 text-center">
          <a
            href="/order"
            className="border-2 border-[#000000] bg-[#FFFFFF] px-3 py-1.5 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[2px_2px_0px_#000000] transition-all hover:-translate-y-[1px] hover:bg-[#CCFF00] hover:shadow-[3px_3px_0px_#000000]"
          >
            📦 Orders Ledger
          </a>
          <a
            href="/upi-sbmd"
            className="border-2 border-[#000000] bg-[#FFFFFF] px-3 py-1.5 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[2px_2px_0px_#000000] transition-all hover:-translate-y-[1px] hover:shadow-[3px_3px_0px_#000000]"
          >
            ⚙️ UPI Sandbox
          </a>
        </div>
      </div>

      {/* WebMCP Config Modal */}
      {mcpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl border-[4px] border-[#000000] bg-[#FFFFFF] p-6 shadow-[8px_8px_0px_#000000] animate-pop-in">
            <div className="flex items-start justify-between border-b-2 border-[#000000] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🤖</span>
                <div>
                  <h3 className="text-lg font-black uppercase tracking-tight text-[#000000]">
                    WebMCP Agent Configuration
                  </h3>
                  <p className="text-xs font-medium text-[#000000]/70">
                    Add this to your Claude Desktop / Cursor / DevTools MCP config:
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMcpModalOpen(false)}
                className="border-2 border-[#000000] bg-[#FF0055] px-2 py-0.5 text-xs font-black text-[#FFFFFF] shadow-[2px_2px_0px_#000000] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <div className="relative">
                <pre className="max-h-64 overflow-x-auto border-2 border-[#000000] bg-[#000000] p-4 font-mono text-xs text-[#CCFF00]">
                  {MCP_CONFIG}
                </pre>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] font-bold text-[#000000]/60">
                  Enables autonomous browsing &amp; instant UPI Reserve Pay debits.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copyMcpConfig}
                    className="border-[3px] border-[#000000] bg-[#CCFF00] px-4 py-2 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[3px_3px_0px_#000000] transition hover:-translate-y-[1px] hover:shadow-[4px_5px_0px_#000000] active:translate-y-[1px] active:shadow-none"
                  >
                    {copiedMcp ? "✓ Copied to Clipboard!" : "Copy MCP Config"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMcpModalOpen(false)}
                    className="border-2 border-[#000000] bg-[#FFFFFF] px-3 py-2 text-xs font-black uppercase text-[#000000] hover:bg-[#F4F4F0]"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
