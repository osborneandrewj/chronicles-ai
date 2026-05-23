"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SlashCommandMenu } from "@/components/SlashCommandMenu";
import { formatUsd } from "@/lib/pricing";
import { SLASH_COMMANDS, type SlashCommand } from "@/lib/slash-commands";
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
  const streaming = status === "streaming";
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

  // Auto-scroll: stick to bottom while streaming, but only if the user hasn't
  // intentionally scrolled up. Re-engages once they scroll back near the bottom.
  const scrollRef = useRef<HTMLOListElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(distanceFromBottom < 80);
  }, []);

  useEffect(() => {
    if (!stickToBottom) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, stickToBottom]);

  const costByMessageId = useMemo(() => buildCostMap(messages, usage), [messages, usage]);
  const sessionTotal = usage.reduce((s, t) => s + t.total, 0);
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return undefined;
  }, [messages]);

  function submitInput() {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
    setStickToBottom(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitInput();
  }

  // Slash-command autocomplete: show menu when input starts with "/" and has no
  // space yet. Filtered by prefix; Escape dismisses for the current input only.
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissedFor, setSlashDismissedFor] = useState<string | null>(null);

  const filteredSlashCommands = useMemo(() => {
    if (!input.startsWith("/")) return [];
    if (input.includes(" ")) return [];
    const q = input.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
  }, [input]);

  const slashOpen = filteredSlashCommands.length > 0 && slashDismissedFor !== input;

  useEffect(() => {
    setSlashIndex(0);
  }, [input]);

  const selectSlashCommand = useCallback(
    (cmd: SlashCommand, submit: boolean) => {
      if (submit) {
        if (busy) return;
        sendMessage({ text: cmd.name });
        setInput("");
        setStickToBottom(true);
        setSlashDismissedFor(null);
      } else {
        setInput(cmd.name);
        setSlashDismissedFor(cmd.name);
      }
    },
    [busy, sendMessage],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex(
          (i) => (i - 1 + filteredSlashCommands.length) % filteredSlashCommands.length,
        );
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        selectSlashCommand(filteredSlashCommands[slashIndex], false);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        selectSlashCommand(filteredSlashCommands[slashIndex], true);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissedFor(input);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitInput();
    }
  }

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col">
      <header className="flex items-center justify-between border-b border-neutral-900/80 px-5 py-4 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold tracking-tight text-neutral-100">
            Chronicles
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-500/80">
            MVP
          </span>
        </div>
        <div className="text-xs tabular-nums text-neutral-500">
          {usage.length} turn{usage.length === 1 ? "" : "s"} · ~{formatUsd(sessionTotal)}
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <ol
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full space-y-7 overflow-y-auto px-5 py-8"
        >
          {messages.length === 0 && (
            <li className="pt-12 text-center text-sm text-neutral-500">
              <p className="font-serif italic">The page is blank. Begin.</p>
            </li>
          )}

          {messages.map((m) => {
            const cost = m.role === "assistant" ? costByMessageId.get(m.id) : undefined;
            const isStreamingThis = streaming && m.id === lastAssistantId;
            return (
              <li key={m.id}>
                {m.role === "user" ? (
                  <UserTurn text={messageText(m)} />
                ) : (
                  <NarratorTurn
                    text={messageText(m)}
                    streaming={isStreamingThis}
                    cost={cost}
                  />
                )}
              </li>
            );
          })}

          {showError && error && (
            <li className="space-y-2 rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              <div>Stream failed: {error.message}</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setErrorDismissed(true);
                    void regenerate();
                  }}
                  className="rounded-md border border-red-800 px-2.5 py-1 text-xs transition hover:bg-red-900/40"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => setErrorDismissed(true)}
                  className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 transition hover:bg-neutral-800"
                >
                  Dismiss
                </button>
              </div>
            </li>
          )}

          <div ref={bottomRef} aria-hidden className="h-px" />
        </ol>

        {/* edge fades */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-neutral-950 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-neutral-950 to-transparent" />
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-neutral-900/80 bg-neutral-950 px-5 py-4"
      >
        <div className="group relative flex items-end gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2 transition focus-within:border-neutral-600 focus-within:bg-neutral-900">
          {slashOpen && (
            <SlashCommandMenu
              commands={filteredSlashCommands}
              activeIndex={slashIndex}
              onSelect={(cmd) => selectSlashCommand(cmd, true)}
              onHover={setSlashIndex}
            />
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="What do you do?"
            disabled={busy}
            className="flex-1 resize-none bg-transparent px-1 py-1 text-[15px] leading-relaxed text-neutral-100 placeholder:text-neutral-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="self-end rounded-lg bg-amber-500/90 px-3.5 py-1.5 text-sm font-medium text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] text-neutral-600">
          Enter to send · Shift+Enter for newline
        </p>
      </form>
    </div>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-end">
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-600">
        You
      </div>
      <div className="mt-1 max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-neutral-800/70 px-4 py-2.5 text-[15px] leading-relaxed text-neutral-100">
        {text}
      </div>
    </div>
  );
}

function NarratorTurn({
  text,
  streaming,
  cost,
}: {
  text: string;
  streaming: boolean;
  cost: TurnCost | undefined;
}) {
  return (
    <div className="border-l-2 border-amber-500/40 pl-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-500/70">
        Narrator
      </div>
      <div className="mt-1 whitespace-pre-wrap font-serif text-[16px] leading-[1.75] text-neutral-100">
        {text}
        {streaming && <span className="chronicles-cursor text-amber-500/70" />}
      </div>
      {cost && !streaming && <CostFooter cost={cost} />}
    </div>
  );
}

function CostFooter({ cost }: { cost: TurnCost }) {
  const segments: string[] = [];
  if (cost.narrator) segments.push(agentSegment("narrator", cost.narrator));
  if (cost.extractor) segments.push(agentSegment("state", cost.extractor));
  if (cost.classifier) segments.push(agentSegment("class", cost.classifier));
  return (
    <div className="mt-2 font-sans text-[11px] tabular-nums text-neutral-600">
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

  // Second pass: end-align unmatched assistants with remaining usage and pair
  // from the tail backwards. Guarantees the newest streamed turn always gets
  // the newest cost — robust to retry transients where usage may be one entry
  // ahead of messages (or vice versa) on the render after a stream finishes.
  const remaining = usage.filter((t) => !usedTurnIds.has(t.id));
  const pairCount = Math.min(unmatchedAssistants.length, remaining.length);
  for (let i = 0; i < pairCount; i++) {
    const msg = unmatchedAssistants[unmatchedAssistants.length - 1 - i];
    const cost = remaining[remaining.length - 1 - i];
    map.set(msg.id, cost);
  }

  return map;
}

function findPrevUser(messages: UIMessage[], beforeIdx: number): UIMessage | undefined {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}
