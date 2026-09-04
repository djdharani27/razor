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
    <section className="flex flex-col gap-4 border-[3px] border-[#000000] bg-[#FFFFFF] p-5 shadow-[5px_5px_0px_#000000]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[#000000] pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-7 min-w-7 items-center justify-center border-2 border-[#000000] bg-[#CCFF00] px-2 text-xs font-black text-[#000000] shadow-[2px_2px_0px_#000000]">
            {index + 1}
          </span>
          <h2 className="text-base font-black uppercase tracking-tight text-[#000000]">{step.title}</h2>
          <code className="border border-[#000000] bg-[#F4F4F0] px-2 py-0.5 font-mono text-[11px] font-bold text-[#000000]">
            {checkout ? "JS Checkout" : `${step.method} ${endpoint}`}
          </code>
        </div>
        <span className="border border-[#000000] bg-[#000000] px-2 py-0.5 text-[10px] font-black uppercase text-[#FFFFFF]">
          PLAN {step.num}
        </span>
      </header>

      <p className="text-xs font-medium text-[#000000]/70">{step.hint}</p>

      {checkout && (
        <div className="border-2 border-[#000000] bg-[#CCFF00] p-3 text-xs font-bold text-[#000000] shadow-[2px_2px_0px_#000000]">
          <span className="font-black uppercase">⚡ Mandate Registration Note: </span>
          When Checkout reports a failure with reason <code className="border border-[#000000] bg-[#FFFFFF] px-1 py-0.2 font-mono text-[11px]">upi_dummy_payment</code>,
          that signals the one-time mandate was registered successfully (per Razorpay docs).
        </div>
      )}

      {expiryAdjusted && (
        <div className="border-2 border-[#000000] bg-[#FEF08A] p-3 text-xs font-bold text-[#000000]">
          <span className="font-black uppercase">⚠️ Expiry Adjusted: </span>
          token.expire_at was out of the SBMD 90-day limit. Auto-corrected to ({new Date(orderDefaultExpiry() * 1000).toLocaleDateString()}).
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-black uppercase tracking-wider text-[#000000]/70">
            {checkout ? "Checkout Options" : "Input Parameters"}
          </label>
          {lastResult && (
            <span
              className={`border border-[#000000] px-2 py-0.5 font-mono text-[11px] font-bold ${
                lastResult.ok ? "bg-[#CCFF00] text-[#000000]" : "bg-[#FF0055] text-[#FFFFFF]"
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRun}
            disabled={runDisabled}
            className="border-[3px] border-[#000000] bg-[#CCFF00] px-4 py-2 text-xs font-black uppercase tracking-wider text-[#000000] shadow-[3px_3px_0px_#000000] transition-all hover:-translate-y-[1px] hover:shadow-[4px_5px_0px_#000000] active:translate-y-[1px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
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
              className="border-2 border-[#000000] bg-[#FFFFFF] px-3 py-2 text-xs font-black uppercase text-[#000000] shadow-[2px_2px_0px_#000000] transition hover:bg-[#F4F4F0]"
            >
              Use above result as input
            </button>
          )}
        </div>
        {checkout && (
          <p className="mt-1 text-[11px] font-medium text-[#000000]/60">
            Auto-wires customer_id from 1.1 and order_id from 1.2.
          </p>
        )}
        {runDisabled && helper.length > 0 && (
          <div className="mt-2 border-2 border-[#000000] bg-[#FEF08A] p-2.5 text-xs font-bold text-[#000000]">
            {helper.join(" ")}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-1.5 border-t border-[#000000]/20 pt-3">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-black uppercase tracking-wider text-[#000000]/70">
            {checkout ? "Checkout Result" : "Output Response"}
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onSaveOutput}
              className="border border-[#000000] bg-[#FFFFFF] px-2 py-0.5 text-xs font-bold text-[#000000] hover:bg-[#F4F4F0]"
            >
              Save as Default
            </button>
            <button
              type="button"
              onClick={copyResponse}
              className="border border-[#000000] bg-[#000000] px-2.5 py-0.5 text-xs font-bold text-[#FFFFFF] hover:bg-[#333333]"
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
        {outputError && lastResult && (
          <p className="border border-[#FF0055] bg-[#FFF0F3] p-2 text-xs font-bold text-[#FF0055]">
            {checkout
              ? "Mandate was not registered — the checkout was closed, failed, or errored."
              : `Razorpay returned an error — key ${lastResult.keyIdPreview || "(none)"}`}
          </p>
        )}
      </div>
    </section>
  );
}
