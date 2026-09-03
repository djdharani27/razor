"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChatMessage from "@/components/agent/ChatMessage";
import ChatInput from "@/components/agent/ChatInput";

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

interface DisplayMessage {
  id: string;
  role: "user" | "model";
  text: string;
  toolCalls?: ToolCall[];
}

export default function AgentPage() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (loading) return;

      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        text,
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, sessionId }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error ?? `Server error (${res.status})`);
          setLoading(false);
          return;
        }

        // Save session ID from first response
        if (data.sessionId && !sessionId) {
          setSessionId(data.sessionId);
        }

        const agentMsg: DisplayMessage = {
          id: `model-${Date.now()}`,
          role: "model",
          text: data.message,
          toolCalls: data.toolCalls,
        };
        setMessages((prev) => [...prev, agentMsg]);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to reach the agent."
        );
      } finally {
        setLoading(false);
      }
    },
    [loading, sessionId]
  );

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-6 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="text-zinc-400 transition-colors hover:text-zinc-200"
            aria-label="Back to store"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-5 w-5"
            >
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                clipRule="evenodd"
              />
            </svg>
          </a>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">
              AI Shopping Agent
            </h1>
            <p className="text-xs text-zinc-500">
              Powered by Gemini · UPI SBMD Payments
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/50 px-3 py-1 text-xs text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Agent Online
          </span>
        </div>
      </header>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              role={msg.role}
              text={msg.text}
              toolCalls={msg.toolCalls}
            />
          ))}

          {/* Loading indicator */}
          {loading && (
            <ChatMessage role="model" text="" isLoading />
          )}

          {/* Error banner */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              <span className="font-medium">Error: </span>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Input bar */}
      <ChatInput onSend={sendMessage} disabled={loading} />
    </div>
  );
}
