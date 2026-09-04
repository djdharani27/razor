"use client";

import { useMemo, useState } from "react";

interface JsonEditorProps {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  readOnly?: boolean;
  placeholder?: string;
}

export default function JsonEditor({
  value,
  onChange,
  rows = 12,
  readOnly = false,
  placeholder = "{}",
}: JsonEditorProps) {
  const [error, setError] = useState<string | null>(null);

  // JSON.parse("") throws, so treat empty as an error too.
  const valid = useMemo(() => {
    try {
      if (value.trim() === "") return false;
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null;
    } catch {
      return false;
    }
  }, [value]);

  function handleBlur() {
    if (readOnly) return;
    if (valid) setError(null);
    else setError("Not valid JSON");
  }

  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={value}
        spellCheck={false}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => {
          setError(null);
          onChange(e.target.value);
        }}
        onBlur={handleBlur}
        rows={rows}
        className={`w-full resize-y border-2 border-[#000000] bg-[#000000] p-3 font-mono text-[12px] leading-relaxed text-[#CCFF00] shadow-[2px_2px_0px_#000000] outline-none transition focus:border-[#000000] focus:shadow-[4px_4px_0px_#000000] ${
          readOnly ? "cursor-text opacity-95" : ""
        } ${error ? "!border-[#FF0055] !text-[#FF0055]" : ""}`}
      />
      <div className="flex min-h-[1.2rem] items-center justify-between text-[11px]">
        <span className={error ? "font-bold text-[#FF0055]" : "font-medium text-[#000000]/60"}>
          {error ?? (valid ? "✓ Valid JSON" : "Edit JSON above")}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="border border-[#000000] bg-[#FFFFFF] px-2 py-0.5 text-[10px] font-bold text-[#000000] hover:bg-[#F4F4F0]"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
