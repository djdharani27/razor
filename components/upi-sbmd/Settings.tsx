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
    <section className="border-[3px] border-[#000000] bg-[#FFFFFF] p-5 shadow-[5px_5px_0px_#000000]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#000000] pb-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wider text-[#000000]">
            Razorpay API Credentials
          </h2>
          <p className="mt-0.5 text-xs font-medium text-[#000000]/70">
            Keys loaded from server environment (<code className="border border-[#000000] bg-[#F4F4F0] px-1 font-mono font-bold text-[#000000]">RAZORPAY_KEY_ID</code>). The secret never leaves the server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReload}
            className="border-2 border-[#000000] bg-[#FFFFFF] px-3 py-1.5 text-xs font-black uppercase text-[#000000] shadow-[2px_2px_0px_#000000] transition hover:-translate-y-[1px] hover:bg-[#F4F4F0] active:translate-y-[1px] active:shadow-none"
          >
            Reload Config
          </button>
          {!confirmingClear ? (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              className="border-2 border-[#000000] bg-[#FFF0F3] px-3 py-1.5 text-xs font-black uppercase text-[#FF0055] shadow-[2px_2px_0px_#000000] transition hover:-translate-y-[1px] hover:bg-[#FF0055] hover:text-[#FFFFFF] active:translate-y-[1px] active:shadow-none"
            >
              Clear Saved Steps
            </button>
          ) : (
            <span className="flex items-center gap-1.5 border-2 border-[#000000] bg-[#FFF0F3] px-2 py-1 text-xs font-black text-[#FF0055]">
              Sure?
              <button
                type="button"
                onClick={() => {
                  onClearAll();
                  setConfirmingClear(false);
                }}
                className="border border-[#000000] bg-[#FF0055] px-2 py-0.5 text-[10px] text-[#FFFFFF]"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="border border-[#000000] bg-[#FFFFFF] px-2 py-0.5 text-[10px] text-[#000000]"
              >
                No
              </button>
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="border-2 border-[#000000] bg-[#F4F4F0] p-3 shadow-[2px_2px_0px_#000000]">
          <span className="text-[10px] font-black uppercase tracking-wider text-[#000000]/60">
            Status
          </span>
          <div className="mt-1">
            {configured ? (
              <span className="inline-flex items-center gap-2 border border-[#000000] bg-[#CCFF00] px-2 py-0.5 text-xs font-black text-[#000000]">
                <span className="h-2 w-2 bg-[#000000]" />
                Configured — Runs Enabled
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 border border-[#000000] bg-[#FEF08A] px-2 py-0.5 text-xs font-black text-[#000000]">
                <span className="h-2 w-2 bg-[#000000]" />
                Not Configured (Missing Keys)
              </span>
            )}
          </div>
        </div>
        <div className="border-2 border-[#000000] bg-[#F4F4F0] p-3 shadow-[2px_2px_0px_#000000]">
          <span className="text-[10px] font-black uppercase tracking-wider text-[#000000]/60">
            Key ID (Public)
          </span>
          <p className="mt-1 font-mono text-xs font-black text-[#000000]">
            {keyId ? maskKeyId(keyId) : "(none)"}
          </p>
        </div>
      </div>
    </section>
  );
}
