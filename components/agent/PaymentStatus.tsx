"use client";

interface PaymentStatusProps {
  status: string;
  orderId?: string;
  amount?: string;
  errorMessage?: string;
}

const STEPS = [
  { key: "customer_saved", label: "Customer Saved", icon: "👤" },
  { key: "captured", label: "Payment Captured", icon: "✅" },
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
  const isError = status === "failed" || status === "error";
  const isCustomerSaved = status === "customer_saved";
  const isCaptured = status === "captured";

  return (
    <div className="animate-fade-up my-2 border-[3px] border-[#000000] bg-[#FFFFFF] shadow-[4px_4px_0px_#000000]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b-[3px] border-[#000000] bg-[#F4F4F0] px-4 py-3">
        <span className="text-lg">💳</span>
        <span className="text-sm font-black uppercase tracking-tight text-[#000000]">
          UPI Reserve Pay
        </span>
        {amount && (
          <span className="ml-auto border-2 border-[#000000] bg-[#FF0055] px-2.5 py-0.5 text-xs font-black text-[#FFFFFF]">
            {amount}
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        {/* Steps stepper for recognised statuses */}
        {!isCustomerSaved && !isCaptured && !isError && (
          <div className="flex flex-col gap-2">
            {STEPS.map((step, i) => {
              const isDone = currentIdx >= i;
              const isCurrent = currentIdx === i && !isCustomerSaved;
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center border-2 border-[#000000] text-xs transition-all duration-500 ${
                      isDone ? "bg-[#CCFF00]" : "bg-[#FFFFFF] opacity-40"
                    } ${isCurrent ? "animate-pulse" : ""}`}
                  >
                    {step.icon}
                  </span>
                  <span
                    className={`text-sm font-bold transition-colors ${
                      isDone ? "text-[#000000]" : "text-[#000000]/40"
                    }`}
                  >
                    {step.label}
                  </span>
                  {isDone && !isCurrent && (
                    <span className="ml-auto text-xs font-black text-[#000000]">✓</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Customer saved */}
        {isCustomerSaved && (
          <div className="border-2 border-[#000000] bg-[#CCFF00] px-3 py-2 shadow-[3px_3px_0px_#000000]">
            <p className="text-xs font-bold text-[#000000]">
              👤 Details saved — you&apos;re ready to pay with UPI Reserve Pay.
            </p>
          </div>
        )}

        {/* Captured */}
        {isCaptured && (
          <div className="border-2 border-[#000000] bg-[#CCFF00] px-3 py-2 shadow-[3px_3px_0px_#000000]">
            <p className="text-xs font-bold text-[#000000]">
              ✅ Payment captured instantly from your UPI block — no PIN needed!
            </p>
          </div>
        )}

        {/* Order ID */}
        {orderId && (isCaptured || isError) && (
          <div className="mt-3 border-2 border-[#000000] bg-[#F4F4F0] px-3 py-2">
            <span className="text-xs font-bold uppercase text-[#000000]/60">Order ID: </span>
            <code className="text-xs font-black text-[#000000]">{orderId}</code>
          </div>
        )}

        {/* Error */}
        {isError && errorMessage && (
          <div className="mt-3 border-2 border-[#000000] bg-[#FFFFFF] px-3 py-2 shadow-[3px_3px_0px_#FF0055]">
            <p className="text-xs font-bold text-[#FF0055]">{errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
}
