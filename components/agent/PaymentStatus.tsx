"use client";

interface PaymentStatusProps {
  status: string;
  orderId?: string;
  amount?: string;
  errorMessage?: string;
}

const STEPS = [
  { key: "order_created", label: "Charge Order Created", icon: "📋" },
  { key: "payment_pending", label: "Processing Payment", icon: "⏳" },
  { key: "payment_scheduled", label: "Payment Scheduled (25h)", icon: "🕐" },
  { key: "payment_captured", label: "Payment Captured", icon: "✅" },
];

function stepIndex(status: string): number {
  const idx = STEPS.findIndex((s) => s.key === status);
  return idx === -1 ? -1 : idx;
}

export default function PaymentStatus({
  status,
  orderId,
  amount,
  errorMessage,
}: PaymentStatusProps) {
  const currentIdx = stepIndex(status);
  const isError = status === "error";

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-zinc-700/60 bg-gradient-to-br from-zinc-900 to-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <span className="text-lg">💳</span>
        <span className="text-sm font-semibold text-zinc-100">
          UPI SBMD Payment
        </span>
        {amount && (
          <span className="ml-auto rounded-full bg-indigo-900/50 px-2.5 py-0.5 text-xs font-medium text-indigo-300">
            {amount}
          </span>
        )}
      </div>

      {/* Steps */}
      <div className="px-4 py-3">
        <div className="flex flex-col gap-2">
          {STEPS.map((step, i) => {
            const isDone = currentIdx >= i;
            const isCurrent = currentIdx === i;
            const isScheduled = step.key === "payment_scheduled" && status === "payment_scheduled";

            return (
              <div key={step.key} className="flex items-center gap-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs transition-all duration-500 ${
                    isDone
                      ? isScheduled
                        ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40"
                        : "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40"
                      : "bg-zinc-800 text-zinc-600"
                  } ${isCurrent && !isScheduled ? "animate-pulse" : ""}`}
                >
                  {step.icon}
                </span>
                <span
                  className={`text-sm transition-colors ${
                    isDone
                      ? isScheduled
                        ? "font-medium text-amber-300"
                        : "text-zinc-200"
                      : "text-zinc-600"
                  }`}
                >
                  {step.label}
                </span>
                {isDone && !isCurrent && (
                  <span className="ml-auto text-xs text-emerald-500">✓</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Order ID */}
        {orderId && (
          <div className="mt-3 rounded-lg bg-zinc-800/50 px-3 py-2">
            <span className="text-xs text-zinc-500">Order ID: </span>
            <code className="text-xs text-zinc-300">{orderId}</code>
          </div>
        )}

        {/* Scheduled message */}
        {status === "payment_scheduled" && (
          <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <p className="text-xs text-amber-200/90">
              🕐 Razorpay requires a 25-hour waiting period after the pre-debit
              notification. The payment will be automatically captured once this
              window elapses.
            </p>
          </div>
        )}

        {/* Captured message */}
        {status === "payment_captured" && (
          <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
            <p className="text-xs text-emerald-200/90">
              ✅ Payment successfully captured!
            </p>
          </div>
        )}

        {/* Error */}
        {isError && errorMessage && (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
            <p className="text-xs text-red-300">{errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
}
