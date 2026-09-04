"use client";

import { useState } from "react";
import type { StepResult } from "@/lib/upi-sbmd/types";
import { STEPS } from "@/lib/upi-sbmd/steps";
import { summarizeResponse, timeAgo } from "@/lib/upi-sbmd/format";

interface HistoryProps {
  results: StepResult[];
  onLoad: (r: StepResult) => void;
  onDelete: (r: StepResult) => void;
  onClear: () => void;
}

export default function History({ results, onLoad, onDelete, onClear }: HistoryProps) {
  const [filter, setFilter] = useState<string>("all");
  const [showConfirm, setShowConfirm] = useState(false);

  const filtered =
    filter === "all" ? results : results.filter((r) => r.stepId === filter);
  const count = filtered.length;

  return (
    <section className="border-[3px] border-[#000000] bg-[#FFFFFF] p-5 shadow-[5px_5px_0px_#000000]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#000000] pb-3">
        <h2 className="text-sm font-black uppercase tracking-wider text-[#000000]">
          Execution History{" "}
          <span className="ml-1 border border-[#000000] bg-[#CCFF00] px-1.5 py-0.5 text-xs font-black text-[#000000]">
            {results.length} total
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border-2 border-[#000000] bg-[#FFFFFF] px-2.5 py-1 text-xs font-black text-[#000000] focus:outline-none"
          >
            <option value="all">All steps</option>
            {STEPS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.num} {s.title}
              </option>
            ))}
          </select>
          {count > 0 &&
            (showConfirm ? (
              <span className="flex items-center gap-1.5 border-2 border-[#000000] bg-[#FFF0F3] px-2 py-1 text-xs font-black text-[#FF0055]">
                Clear {count}?
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    setShowConfirm(false);
                  }}
                  className="border border-[#000000] bg-[#FF0055] px-2 py-0.5 text-[10px] text-[#FFFFFF]"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="border border-[#000000] bg-[#FFFFFF] px-2 py-0.5 text-[10px] text-[#000000]"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                className="border-2 border-[#000000] bg-[#FFF0F3] px-2.5 py-1 text-xs font-black uppercase text-[#FF0055] shadow-[2px_2px_0px_#000000] transition hover:-translate-y-[1px] hover:bg-[#FF0055] hover:text-[#FFFFFF] active:translate-y-[1px] active:shadow-none"
              >
                Clear
              </button>
            ))}
        </div>
      </div>

      {count === 0 ? (
        <div className="border-2 border-dashed border-[#000000]/30 bg-[#F4F4F0] p-6 text-center text-xs font-bold text-[#000000]/60">
          No history captured yet. Click “Run” on any step above to record its request & response here.
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filtered.map((r) => (
            <li
              key={`${r.stepId}-${r.at}-${r.endpoint}`}
              className="flex items-center gap-3 border-2 border-[#000000] bg-[#FFFFFF] p-3 shadow-[2px_2px_0px_#000000]"
            >
              <span
                className={`h-3 w-3 shrink-0 border border-[#000000] ${
                  r.ok ? "bg-[#CCFF00]" : "bg-[#FF0055]"
                }`}
                title={r.ok ? "Success" : "Error"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-xs font-black uppercase text-[#000000]">
                    {r.label}
                  </span>
                  <code className="border border-[#000000]/30 bg-[#F4F4F0] px-1.5 py-0.5 font-mono text-[10px] text-[#000000]/70">
                    {r.method === "JS" ? "Razorpay Checkout" : `${r.method} ${r.endpoint}`}
                  </code>
                  <span
                    className={`border border-[#000000] px-1.5 py-0.5 font-mono text-[10px] font-black ${
                      r.ok ? "bg-[#CCFF00] text-[#000000]" : "bg-[#FF0055] text-[#FFFFFF]"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-[#000000]/60">
                  {summarizeResponse(r.responseBody)} · {timeAgo(r.at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onLoad(r)}
                className="shrink-0 border-2 border-[#000000] bg-[#FFFFFF] px-2.5 py-1 text-xs font-black uppercase text-[#000000] shadow-[1px_1px_0px_#000000] transition hover:bg-[#CCFF00]"
              >
                Load
              </button>
              <button
                type="button"
                onClick={() => onDelete(r)}
                className="shrink-0 border border-[#000000] bg-[#FFF0F3] px-2 py-1 text-xs font-bold text-[#FF0055] hover:bg-[#FF0055] hover:text-[#FFFFFF]"
                title="Delete"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
