"use client";

// Customer identity for the UPI Reserve Pay flow. Stored locally (localStorage)
// so a returning visitor never re-enters their details — only what Razorpay
// requires: name + contact (10-digit mobile) + optional email.

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

export const CUSTOMER_STORAGE_KEY = "agentstore-customer-v1";

export interface CustomerProfile {
  name: string;
  contact: string; // 10-digit mobile
  email?: string | null;
  savedAt?: number;
}

/** Normalise a 10-digit Indian mobile number (strips +91 / spaces / dashes). */
export function normaliseContact(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

export function isValidContact(raw: string): boolean {
  return normaliseContact(raw) !== null;
}

export function readSavedCustomer(): CustomerProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CUSTOMER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomerProfile;
    if (!parsed?.name || !parsed?.contact || !isValidContact(parsed.contact)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCustomer(profile: CustomerProfile): CustomerProfile {
  const next: CustomerProfile = { ...profile, contact: normaliseContact(profile.contact) ?? profile.contact };
  try {
    window.localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — identity just won't persist across reloads.
  }
  return next;
}

export function clearSavedCustomer(): void {
  try {
    window.localStorage.removeItem(CUSTOMER_STORAGE_KEY);
  } catch {
    // ignore
  }
}

interface CustomerProfileFormProps {
  /** Prefill from a previously saved profile, if any. */
  initial?: CustomerProfile | null;
  /** Called with the validated profile when the user saves it. */
  onSave: (profile: CustomerProfile) => void;
  /** Compact inline variant (no card chrome). */
  compact?: boolean;
}

export function CustomerProfileForm({ initial, onSave, compact = false }: CustomerProfileFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmedName = name.trim();
      const normalised = normaliseContact(contact);
      if (trimmedName.length < 2) {
        setError("Please enter your name.");
        return;
      }
      if (!normalised) {
        setError("Please enter a valid 10-digit Indian mobile number.");
        return;
      }
      setError(null);
      onSave({ name: trimmedName, contact: normalised, email: email.trim() || null });
    },
    [name, contact, email, onSave]
  );

  const inputCls =
    "w-full border-[3px] border-[#000000] bg-[#FFFFFF] px-3 py-2 text-sm font-medium text-[#000000] placeholder-[#000000]/40 shadow-[3px_3px_0px_#000000] outline-none transition-all duration-150 focus:shadow-[1px_1px_0px_#000000]";

  return (
    <form onSubmit={handleSubmit} className={`flex flex-col gap-3 ${compact ? "" : "animate-pop-in border-[3px] border-[#000000] bg-[#F4F4F0] p-5 shadow-[5px_5px_0px_#000000]"}`}>
      <div className={compact ? "" : ""}>
        <h3 className="text-sm font-black uppercase tracking-tight text-[#000000]">
          {initial ? "Confirm your details" : "Your details"}
        </h3>
        <p className="mt-0.5 text-xs font-medium text-[#000000]/60">
          Used to set up your UPI Reserve Pay mandate. We only ask once.
        </p>
      </div>
      <input
        type="text"
        placeholder="Full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={inputCls}
        autoComplete="name"
      />
      <input
        type="tel"
        placeholder="Mobile number (10 digits)"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        className={inputCls}
        autoComplete="tel-national"
        inputMode="numeric"
      />
      <input
        type="email"
        placeholder="Email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={inputCls}
        autoComplete="email"
      />
      {error && <p className="border-2 border-[#000000] bg-[#FFFFFF] px-2 py-1 text-xs font-bold text-[#FF0055]">{error}</p>}
      <button
        type="submit"
        className="border-[3px] border-[#000000] bg-[#000000] px-4 py-2 text-sm font-black uppercase tracking-tight text-[#F4F4F0] shadow-[4px_4px_0px_#000000] transition-all duration-150 hover:-translate-y-[1px] hover:shadow-[4px_6px_0px_#000000] active:translate-y-[2px] active:shadow-[2px_2px_0px_#000000]"
      >
        Continue →
      </button>
    </form>
  );
}

/** Hook to read the saved profile reactively (listens to storage changes). */
export function useSavedCustomer(): { customer: CustomerProfile | null; refresh: () => void } {
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);

  useEffect(() => {
    const read = () => setCustomer(readSavedCustomer());
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  const refresh = useCallback(() => setCustomer(readSavedCustomer()), []);
  return { customer, refresh };
}
