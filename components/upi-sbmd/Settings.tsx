"use client";

import { useState } from "react";
import { maskKeyId } from "@/lib/upi-sbmd/format";

interface SettingsProps {
  keyId: string;
  configured: boolean;
  onReload: () => Promise<void>;
  onClearAll: () => void;
}

export default function Settings({
  keyId,
  configured,
  onReload,
  onClearAll,
}: SettingsProps) {
  const [confirmingClear, setConfirmingClear] = useState(false);

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-zinc-100">Razorpay API credentials</h2>
          <p className="text-[12px] text-zinc-500">
            Keys are read from server-side environment variables (
            <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px]">
              RAZORPAY_KEY_ID
            </code>{" "}
            /{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px]">
              RAZORPAY_KEY_SECRET
            </code>
            ). Set them in <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px]">.env.local</code>{" "}
            and restart the dev server. The secret never reaches this page.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReload}
            className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-400"
          >
            Reload config
          </button>
          {!confirmingClear ? (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              className="rounded-md border border-red-900/60 px-3 py-1.5 text-xs text-red-400/90 transition-colors hover:border-red-700 hover:text-red-300"
            >
              Clear saved steps
            </button>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-zinc-400">
              Sure?
              <button
                type="button"
                onClick={() => {
                  onClearAll();
                  setConfirmingClear(false);
                }}
                className="rounded bg-red-900/60 px-2 py-0.5 text-red-200 hover:bg-red-800"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="rounded px-2 py-0.5 text-zinc-400 hover:text-zinc-200"
              >
                No
              </button>
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Status
          </span>
          {configured ? (
            <span className="inline-flex items-center gap-2 text-sm text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Configured — runs are enabled
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Not configured — set the env vars to enable runs
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Key ID (from server env)
          </span>
          <span className="font-mono text-sm text-zinc-100">
            {keyId ? maskKeyId(keyId) : "(none)"}
          </span>
        </div>
      </div>
    </section>
  );
}
