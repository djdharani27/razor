"use client";

import { useEffect, useState } from "react";
import type { AgentLogRow } from "@/lib/types";

interface AgentActivityPanelProps {
  open: boolean;
  onToggle: () => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour12: false });
}

function describeResult(resultJson: string): string {
  try {
    const parsed = JSON.parse(resultJson);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      return `⚠️ ${String(parsed.error)}`;
    }
    if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
      return "✅ ok";
    }
  } catch {
    // fall through
  }
  const short = resultJson.length > 140 ? `${resultJson.slice(0, 140)}…` : resultJson;
  return short.replace(/\n/g, " ");
}

export default function AgentActivityPanel({ open, onToggle }: AgentActivityPanelProps) {
  const [logs, setLogs] = useState<AgentLogRow[]>([]);

  // Poll the agent log every 2s so the panel updates in real time.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      try {
        const res = await fetch("/api/agent-log", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { logs: AgentLogRow[] };
        if (!cancelled) setLogs(data.logs);
      } catch {
        // transient fetch error — try again on the next tick
      }
    };

    void tick();
    timer = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
          🤖 Agent Activity Log
        </h2>
        <span className="text-xs text-zinc-500">
          {open ? "Hide" : `Show (${logs.length})`}
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <p className="mb-3 text-xs text-zinc-500">
            Every WebMCP tool call made by the agent is logged here, in real time.
          </p>
          {logs.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No agent activity yet. Ask your agent to &quot;search_products&quot; or
              &quot;view_cart&quot; and watch this panel light up.
            </p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {logs.map((log) => (
                <li key={log.id} className="rounded-lg bg-zinc-950/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-indigo-300">
                      {log.tool_name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                      {formatTime(log.timestamp)}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                    {log.arguments_json}
                  </p>
                  <p className="mt-0.5 break-words font-mono text-[11px] text-zinc-400">
                    {describeResult(log.result_json)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
