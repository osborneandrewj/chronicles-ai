"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

type Props = { initialMessages: UIMessage[] };

export function Chat({ initialMessages }: Props) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const busy = status === "submitted" || status === "streaming";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col">
      <header className="border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-medium tracking-wide text-neutral-400">CHRONICLES · MVP</h1>
      </header>

      <ol className="flex-1 space-y-6 overflow-y-auto px-4 py-6">
        {messages.map((m) => (
          <li key={m.id} className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-neutral-500">
              {m.role === "user" ? "You" : "Narrator"}
            </div>
            <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-100">
              {messageText(m)}
            </div>
          </li>
        ))}
        {error && (
          <li className="text-sm text-red-400">Stream error: {error.message}</li>
        )}
      </ol>

      <form onSubmit={onSubmit} className="border-t border-neutral-800 p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e);
              }
            }}
            rows={2}
            placeholder="What do you do?"
            disabled={busy}
            className="flex-1 resize-none rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-[15px] text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="self-end rounded-md border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm text-neutral-100 hover:bg-neutral-700 disabled:opacity-40"
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}
