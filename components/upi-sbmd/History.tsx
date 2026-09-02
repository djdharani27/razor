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
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-zinc-100">
          History{" "}
          <span className="text-sm font-normal text-zinc-500">
            ({results.length} total)
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 focus:outline-none"
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
              <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                Clear {count}?
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    setShowConfirm(false);
                  }}
                  className="rounded bg-red-900/60 px-2 py-0.5 text-red-200 hover:bg-red-800"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="rounded px-2 py-0.5 text-zinc-400 hover:text-zinc-200"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                className="rounded-md border border-red-900/60 px-2.5 py-1 text-xs text-red-400/90 transition-colors hover:border-red-700 hover:text-red-300"
              >
                Clear
              </button>
            ))}
        </div>
      </div>

      {count === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-800 px-3 py-6 text-center text-[12px] text-zinc-500">
          No history yet. Click “Run” on a step above to capture its request and
          response here, or press “Save” on any step to pin it.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((r) => (
            <li
              key={`${r.stepId}-${r.at}-${r.endpoint}`}
              className="group flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2"
            >
              <span
                className={`w-2 h-2 shrink-0 rounded-full ${
                  r.ok ? "bg-emerald-400" : "bg-red-400"
                }`}
                title={r.ok ? "Success" : "Error"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-zinc-200">
                    {r.label}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {r.method === "JS" ? "Razorpay Checkout" : `${r.method} ${r.endpoint}`}
                  </span>
                  <span
                    className={`font-mono text-[11px] ${
                      r.ok ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                <p className="truncate font-mono text-[11px] text-zinc-500">
                  {summarizeResponse(r.responseBody)} · {timeAgo(r.at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onLoad(r)}
                className="shrink-0 rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-amber-400/60 hover:text-amber-300"
              >
                Load
              </button>
              <button
                type="button"
                onClick={() => onDelete(r)}
                className="shrink-0 rounded border border-transparent px-1.5 py-1 text-[11px] text-zinc-600 transition-colors hover:border-red-900/60 hover:text-red-300"
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
