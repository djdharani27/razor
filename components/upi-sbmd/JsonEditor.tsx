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
        className={`w-full resize-y rounded-md border bg-zinc-950 p-2 font-mono text-[12px] leading-relaxed text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400/60 ${
          readOnly ? "cursor-text border-zinc-800" : "border-zinc-700"
        } ${error ? "border-red-500" : ""}`}
      />
      <div className="flex min-h-[1rem] items-center justify-between text-[11px]">
        <span className={error ? "text-red-400" : "text-zinc-500"}>
          {error ?? (valid ? "Valid JSON" : "Edit the JSON above")}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded px-1.5 py-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
