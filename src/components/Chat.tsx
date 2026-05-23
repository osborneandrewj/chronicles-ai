"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatUsd } from "@/lib/pricing";
import type { AgentCost, TurnCost } from "@/lib/turn-cost";

type Props = { initialMessages: UIMessage[]; initialUsage: TurnCost[] };

export function Chat({ initialMessages, initialUsage }: Props) {
  const [input, setInput] = useState("");
  const [usage, setUsage] = useState<TurnCost[]>(initialUsage);
  const { messages, sendMessage, regenerate, status, error } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const busy = status === "submitted" || status === "streaming";
  const [errorDismissed, setErrorDismissed] = useState(false);
  useEffect(() => {
    if (error) setErrorDismissed(false);
  }, [error]);
  const showError = !!error && !errorDismissed;

  const refetchUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (!res.ok) return;
      const data = (await res.json()) as { turns: TurnCost[]; total: number };
      setUsage(data.turns);
    } catch {
      // best-effort; ignore
    }
  }, []);

  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "streaming" && status === "ready") {
      void refetchUsage();
      const t = setTimeout(refetchUsage, 2000);
      prevStatus.current = status;
      return () => clearTimeout(t);
    }
    prevStatus.current = status;
  }, [status, refetchUsage]);

  const costByMessageId = useMemo(() => buildCostMap(messages, usage), [messages, usage]);
  const sessionTotal = usage.reduce((s, t) => s + t.total, 0);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col">
      <header className="flex items-baseline justify-between border-b border-neutral-800 px-4 py-3">
        <h1 className="text-sm font-medium tracking-wide text-neutral-400">CHRONICLES · MVP</h1>
        <div className="text-xs tabular-nums text-neutral-500">
          {usage.length} turn{usage.length === 1 ? "" : "s"} · ~{formatUsd(sessionTotal)}
        </div>
      </header>

      <ol className="flex-1 space-y-6 overflow-y-auto px-4 py-6">
        {messages.map((m) => {
          const cost = m.role === "assistant" ? costByMessageId.get(m.id) : undefined;
          return (
            <li key={m.id} className="space-y-1">
              <div className="text-xs uppercase tracking-wider text-neutral-500">
                {m.role === "user" ? "You" : "Narrator"}
              </div>
              <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-100">
                {messageText(m)}
              </div>
              {cost && <CostFooter cost={cost} />}
            </li>
          );
        })}
        {showError && error && (
          <li className="space-y-2 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            <div>Stream failed: {error.message}</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setErrorDismissed(true);
                  void regenerate();
                }}
                className="rounded border border-red-800 px-2 py-1 text-xs hover:bg-red-900/40"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setErrorDismissed(true)}
                className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Dismiss
              </button>
            </div>
          </li>
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

function CostFooter({ cost }: { cost: TurnCost }) {
  const segments: string[] = [];
  if (cost.narrator) segments.push(agentSegment("narrator", cost.narrator));
  if (cost.extractor) segments.push(agentSegment("state", cost.extractor));
  if (cost.classifier) segments.push(agentSegment("class", cost.classifier));
  return (
    <div className="pt-1 text-[11px] tabular-nums text-neutral-500">
      {segments.join(" · ")} · ~{formatUsd(cost.total)}
    </div>
  );
}

function agentSegment(label: string, a: AgentCost): string {
  return `${label} ${fmt(a.inputTokens)} in / ${fmt(a.outputTokens)} out`;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function buildCostMap(messages: UIMessage[], usage: TurnCost[]): Map<string, TurnCost> {
  const map = new Map<string, TurnCost>();
  const usageById = new Map<number, TurnCost>(usage.map((t) => [t.id, t]));

  // First pass: match by DB id when the message id is a numeric DB id.
  const unmatchedAssistants: UIMessage[] = [];
  const usedTurnIds = new Set<number>();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant") continue;

    // Skip meta-command responses (their preceding user message starts with "/")
    const prevUser = findPrevUser(messages, i);
    if (prevUser && messageText(prevUser).trim().startsWith("/")) continue;

    const dbId = Number(m.id);
    if (Number.isInteger(dbId) && dbId > 0 && usageById.has(dbId)) {
      const cost = usageById.get(dbId)!;
      map.set(m.id, cost);
      usedTurnIds.add(dbId);
    } else {
      unmatchedAssistants.push(m);
    }
  }

  // Second pass: assign remaining usage entries (from the tail) to unmatched assistant
  // messages in order. Handles fresh-this-session messages whose ids are AI-SDK uuids.
  const remaining = usage.filter((t) => !usedTurnIds.has(t.id));
  const offset = Math.max(0, unmatchedAssistants.length - remaining.length);
  for (let i = offset; i < unmatchedAssistants.length; i++) {
    const cost = remaining[i - offset];
    if (cost) map.set(unmatchedAssistants[i].id, cost);
  }

  return map;
}

function findPrevUser(messages: UIMessage[], beforeIdx: number): UIMessage | undefined {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}
