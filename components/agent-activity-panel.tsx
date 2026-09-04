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
    <section className="border-[3px] border-[#000000] bg-[#FFFFFF] shadow-[5px_5px_0px_#000000]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-[#FFFFFF] px-4 py-3 text-left transition hover:bg-[#F4F4F0]"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span>🤖</span>
          <h2 className="text-xs font-black uppercase tracking-wider text-[#000000]">
            Agent Activity Log
          </h2>
        </div>
        <span className="border-2 border-[#000000] bg-[#CCFF00] px-2 py-0.5 text-[10px] font-black text-[#000000]">
          {open ? "Hide" : `Show (${logs.length})`}
        </span>
      </button>

      {open && (
        <div className="border-t-[3px] border-[#000000] bg-[#F4F4F0] p-4">
          <p className="mb-3 text-xs font-medium text-[#000000]/70">
            Real-time tool calls dispatched by autonomous WebMCP agents:
          </p>
          {logs.length === 0 ? (
            <div className="border-2 border-dashed border-[#000000]/30 bg-[#FFFFFF] p-4 text-center">
              <p className="text-xs font-bold text-[#000000]/50">
                No tool calls yet. Ask your agent to &quot;search_products&quot; or
                &quot;checkout&quot; to see activity here.
              </p>
            </div>
          ) : (
            <ul className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
              {logs.map((log) => (
                <li
                  key={log.id}
                  className="border-2 border-[#000000] bg-[#FFFFFF] p-2.5 shadow-[2px_2px_0px_#000000]"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-[#000000]/10 pb-1">
                    <span className="font-mono text-xs font-black text-[#000000]">
                      {log.tool_name}
                    </span>
                    <span className="font-mono text-[10px] font-bold text-[#000000]/50">
                      {formatTime(log.timestamp)}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-[#000000]/70">
                    {log.arguments_json}
                  </p>
                  <p className="mt-0.5 break-words font-mono text-[11px] font-bold text-[#000000]">
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
