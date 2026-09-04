"use client";

import { useState } from "react";
import type { StepDef } from "@/lib/upi-sbmd/steps";
import { orderDefaultExpiry } from "@/lib/upi-sbmd/steps";
import JsonEditor from "./JsonEditor";

interface StepCardProps {
  step: StepDef;
  index: number;
  endpoint: string;
  input: string;
  output: string;
  lastResult: { status: number; ok: boolean; ms: number; keyIdPreview: string; label?: string } | null;
  running: boolean;
  apiReady: boolean;
  canUseAsInput: boolean;
  checkout?: boolean;
  expiryAdjusted?: boolean;
  onInputChange: (next: string) => void;
  onOutputChange: (next: string) => void;
  onRun: () => void;
  onUseAsInput: () => void;
  onSaveOutput: () => void;
}

export default function StepCard({
  step,
  index,
  endpoint,
  input,
  output,
  lastResult,
  running,
  apiReady,
  canUseAsInput,
  checkout = false,
  expiryAdjusted,
  onInputChange,
  onOutputChange,
  onRun,
  onUseAsInput,
  onSaveOutput,
}: StepCardProps) {
  const [copied, setCopied] = useState(false);

  const outputError = !lastResult?.ok && !!lastResult;

  const runDisabled = !apiReady || running;
  const helper: string[] = [];
  if (!apiReady) helper.push("Enter your Razorpay API keys above to enable running.");
  if (running) helper.push("Opening checkout…");

  async function copyResponse() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-400/15 px-1.5 text-xs font-semibold text-amber-300">
          {index + 1}
        </span>
        <h2 className="font-semibold text-zinc-100">{step.title}</h2>
        <code className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-amber-200/80">
          {checkout ? "JS Checkout" : `${step.method} ${endpoint}`}
        </code>
        <span className="text-[11px] text-zinc-500">PLAN {step.num}</span>
      </header>

      <p className="text-[12px] text-zinc-400">{step.hint}</p>

      {checkout && (
        <p className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[12px] text-emerald-100">
          <span className="font-semibold">Mandate registration</span> — when
          Checkout reports a failed payment with reason{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px] text-amber-200/80">
            upi_dummy_payment
          </code>
          , that actually indicates the one-time mandate was registered
          successfully (per Razorpay docs), and this step will be marked
          success.
        </p>
      )}

      {expiryAdjusted && (
        <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100">
          <span className="font-semibold">token.expire_at was out of the SBMD
          90-day limit</span> — the input above and the request were sent with a
          fresh valid value ({new Date(orderDefaultExpiry() * 1000).toLocaleDateString()}).
        </p>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            {checkout ? "Checkout options" : "Input parameters"}
          </label>
          {lastResult && (
            <span
              className={`font-mono text-[11px] ${
                lastResult.ok ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {checkout
                ? lastResult.ok
                  ? "mandate registered"
                  : "not registered"
                : lastResult.label
                  ? lastResult.label
                  : `${lastResult.status} · ${lastResult.ms}ms`}
            </span>
          )}
        </div>
        <JsonEditor value={input} onChange={onInputChange} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRun}
            disabled={runDisabled}
            className="rounded-md bg-amber-400 px-4 py-1.5 text-sm font-semibold text-black transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {checkout
              ? running
                ? "Opening Checkout…"
                : "Open Razorpay Checkout"
              : running
                ? "Running…"
                : `Run ${step.method}`}
          </button>
          {canUseAsInput && (
            <button
              type="button"
              onClick={onUseAsInput}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
            >
              Use above result as input
            </button>
          )}
        </div>
        {checkout && (
          <p className="text-[11px] text-zinc-500">
            No ids needed — if steps 1.1 and 1.2 haven&apos;t run yet, paste an
            order_id and customer_id from their outputs into the JSON above
            (Razorpay rejects the checkout without them).
          </p>
        )}
        {runDisabled && helper.length > 0 && (
          <p className="rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[12px] text-amber-200/90">
            {helper.join(" ")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            {checkout ? "Checkout result" : "Output response"}
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onSaveOutput}
              className="rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Save as default
            </button>
            <button
              type="button"
              onClick={copyResponse}
              className="rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <JsonEditor
          value={output}
          onChange={onOutputChange}
          readOnly={false}
          rows={10}
          placeholder='{"run": "a step to see its response here"}'
        />
        {(() => {
          try {
            const parsed = JSON.parse(output) as { agent_code?: unknown; agent_token?: unknown };
            const code =
              typeof parsed?.agent_code === "string"
                ? parsed.agent_code
                : typeof parsed?.agent_token === "string"
                  ? parsed.agent_token
                  : null;
            if (!code) return null;
            return (
              <div className="mt-2 flex flex-col gap-2 rounded-xl border border-indigo-500/40 bg-indigo-950/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🤖</span>
                  <div>
                    <p className="text-xs font-semibold text-indigo-300">
                      Step 2.1 Token Authenticated — Agent Code Generated!
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      This delegation code is unique to this verified customer and bank mandate.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-black/80 px-2.5 py-1 font-mono text-sm font-bold text-indigo-200 border border-indigo-500/30">
                    {code}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(code)}
                    className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-indigo-500"
                  >
                    Copy Code
                  </button>
                </div>
              </div>
            );
          } catch {
            return null;
          }
        })()}
        {outputError && lastResult && (
          <p className="text-[11px] text-red-400">
            {checkout
              ? "Mandate was not registered — the checkout was closed, failed, or errored. See the result above."
              : `Razorpay returned an error — key ${lastResult.keyIdPreview || "(none)"}`}
          </p>
        )}
      </div>
    </section>
  );
}
