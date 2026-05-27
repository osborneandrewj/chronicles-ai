"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import Link from "next/link";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SlashCommandMenu } from "@/components/SlashCommandMenu";
import { useNarratorAudio } from "@/components/useNarratorAudio";
import { WorldInspector } from "@/components/WorldInspector";
import { formatUsd } from "@/lib/pricing";
import { SLASH_COMMANDS, type SlashCommand } from "@/lib/slash-commands";
import type { AgentCost, TurnCost } from "@/lib/turn-cost";

const INSPECTOR_STORAGE_KEY = "chronicles.inspector.open";

type MessageMetadata = {
  createdAt?: string;
};

export type ChroniclesMessage = UIMessage<MessageMetadata>;

type Props = {
  worldId: number;
  worldName: string;
  initialMessages: ChroniclesMessage[];
  initialUsage: TurnCost[];
  // Pagination cursor for "Load older". null when the world has no turns yet;
  // initialHasOlder is true when more turns exist before this slice.
  initialOldestId: number | null;
  initialHasOlder: boolean;
};

type OlderTurn = {
  id: number;
  world_id: number;
  role: "user" | "assistant";
  content: string;
  scene_id: number | null;
  created_at: string;
};
type OlderResponse = { turns: OlderTurn[]; usage: TurnCost[]; hasMore: boolean };

export function Chat({
  worldId,
  worldName,
  initialMessages,
  initialUsage,
  initialOldestId,
  initialHasOlder,
}: Props) {
  const [input, setInput] = useState("");
  const [usage, setUsage] = useState<TurnCost[]>(initialUsage);
  const [oldestId, setOldestId] = useState<number | null>(initialOldestId);
  const [hasOlder, setHasOlder] = useState<boolean>(initialHasOlder);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const chatApi = `/api/chat?worldId=${worldId}`;
  const usageApi = `/api/usage?worldId=${worldId}`;
  const transport = useMemo(
    () => new DefaultChatTransport<ChroniclesMessage>({ api: chatApi }),
    [chatApi],
  );
  const { messages, setMessages, sendMessage, regenerate, status, error } =
    useChat<ChroniclesMessage>({
    messages: initialMessages,
    transport,
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
      const res = await fetch(usageApi);
      if (!res.ok) return;
      const data = (await res.json()) as { turns: TurnCost[]; total: number };
      setUsage(data.turns);
    } catch {
      // best-effort; ignore
    }
  }, [usageApi]);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorRefreshKey, setInspectorRefreshKey] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setInspectorOpen(window.localStorage.getItem(INSPECTOR_STORAGE_KEY) === "1");
  }, []);
  const toggleInspector = useCallback(() => {
    setInspectorOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(INSPECTOR_STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  }, []);

  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "streaming" && status === "ready") {
      void refetchUsage();
      // Archivist patch commits ~1-3s after stream finish — refresh twice so
      // the inspector picks up the new rows without polling.
      setInspectorRefreshKey((k) => k + 1);
      const t = setTimeout(() => {
        void refetchUsage();
        setInspectorRefreshKey((k) => k + 1);
      }, 2000);
      prevStatus.current = status;
      return () => clearTimeout(t);
    }
    prevStatus.current = status;
  }, [status, refetchUsage]);

  // Auto-scroll: stick to bottom while streaming, but only if the user hasn't
  // intentionally scrolled up. Re-engages once they scroll back near the bottom.
  const scrollRef = useRef<HTMLOListElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight - el.clientHeight,
      behavior,
    });
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
    setStickToBottom(distanceFromBottom <= 4);
  }, []);

  // Prepends an older slice without yanking the user's viewport. Capture the
  // scroll geometry pre-prepend, let the DOM update, then re-anchor so the
  // first previously-visible message stays where the user was looking.
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder || oldestId === null) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    try {
      const res = await fetch(`/api/turns?worldId=${worldId}&before=${oldestId}&limit=60`);
      if (!res.ok) return;
      const data = (await res.json()) as OlderResponse;
      if (data.turns.length === 0) {
        setHasOlder(false);
        return;
      }
      const olderMessages: ChroniclesMessage[] = data.turns.map((t) => ({
        id: String(t.id),
        role: t.role,
        metadata: { createdAt: t.created_at },
        parts: [{ type: "text", text: t.content }],
      }));
      // Stop sticking to the bottom while the prepend lands; otherwise the
      // useEffect that calls scrollIntoView would snap us back down.
      setStickToBottom(false);
      setMessages([...olderMessages, ...messages]);
      setUsage((prev) => [...data.usage, ...prev]);
      setOldestId(data.turns[0].id);
      setHasOlder(data.hasMore);
      // After the DOM paints the new rows, restore the visual position: the
      // old top message stays under the same Y coordinate by adding the new
      // content's height delta to scrollTop.
      requestAnimationFrame(() => {
        const elNow = scrollRef.current;
        if (!elNow) return;
        const delta = elNow.scrollHeight - prevHeight;
        elNow.scrollTop = prevTop + delta;
      });
    } catch {
      // Network blip; leave the button in place so the user can retry.
    } finally {
      setLoadingOlder(false);
    }
  }, [hasOlder, loadingOlder, messages, oldestId, setMessages, worldId]);

  useEffect(() => {
    if (!stickToBottom) return;
    requestAnimationFrame(() => scrollToBottom());
  }, [messages, scrollToBottom, stickToBottom]);

  const scrollToEnd = useCallback(() => {
    setStickToBottom(true);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  const costByMessageId = useMemo(() => buildCostMap(messages, usage), [messages, usage]);
  const sessionTotal = usage.reduce((s, t) => s + t.total, 0);
  const latestMessage = messages[messages.length - 1];
  const streamingAssistantId =
    streaming && latestMessage?.role === "assistant" ? latestMessage.id : undefined;
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return undefined;
  }, [messages]);

  // Meta-command responses (preceding user message starts with "/") are
  // pre-canned strings, not narrator prose — skip TTS for them so /pause etc.
  // don't get spoken. Passing undefined turnId tears down any in-flight audio,
  // matching the "new turn supersedes" semantics of real narrator turns.
  const narratableTurn = useMemo(() => {
    if (!lastAssistantId) return { id: undefined, text: "" };
    const idx = messages.findIndex((msg) => msg.id === lastAssistantId);
    if (idx < 0) return { id: undefined, text: "" };
    const prevUser = findPrevUser(messages, idx);
    if (prevUser && messageText(prevUser).trim().startsWith("/")) {
      return { id: undefined, text: "" };
    }
    return { id: lastAssistantId, text: messageText(messages[idx]) };
  }, [messages, lastAssistantId]);

  const reportTtsChars = useCallback(
    async (turnIdStr: string, chars: number) => {
      const turnId = Number(turnIdStr);
      if (!Number.isInteger(turnId) || turnId <= 0) return;
      try {
        await fetch(`/api/tts/record?worldId=${worldId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnId, chars }),
        });
        void refetchUsage();
      } catch {
        // best-effort cost tracking; ignore
      }
    },
    [worldId, refetchUsage],
  );

  const {
    muted,
    setMuted,
    activeTurnId: speakingTurnId,
    primeAudio,
    replay,
  } = useNarratorAudio({
    text: narratableTurn.text,
    streaming: narratableTurn.id === streamingAssistantId,
    turnId: narratableTurn.id,
    onTurnComplete: reportTtsChars,
  });

  function submitInput() {
    const text = input.trim();
    if (!text || busy) return;
    primeAudio();
    sendMessage({ text, metadata: { createdAt: new Date().toISOString() } });
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
        sendMessage({ text: cmd.name, metadata: { createdAt: new Date().toISOString() } });
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
    <div className="relative mx-auto flex h-[100svh] w-full max-w-3xl flex-col overflow-hidden bg-black">
      <WorldInspector
        worldId={worldId}
        open={inspectorOpen}
        onClose={toggleInspector}
        refreshKey={inspectorRefreshKey}
      />
      <header className="relative z-10 flex min-h-14 items-center justify-between gap-2 border-b border-neutral-900 bg-black/90 px-2.5 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-black/75 sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link
            href="/"
            aria-label="Back to worlds"
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-900 hover:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
          >
            <BackIcon />
          </Link>
          <span className="truncate text-lg font-semibold tracking-tight text-neutral-100">
            {worldName}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {/* Session total — hidden when there's not enough room next to the
              world name. The per-turn footer carries the cost on every turn,
              so this chip is supplemental. */}
          <div className="mr-1 hidden text-xs tabular-nums text-neutral-500 md:block">
            {usage.length} turn{usage.length === 1 ? "" : "s"} · ~{formatUsd(sessionTotal)}
          </div>
          <HeaderIconButton
            onClick={toggleInspector}
            pressed={inspectorOpen}
            label={inspectorOpen ? "Close world inspector" : "Open world inspector"}
            tone={inspectorOpen ? "amber" : "neutral"}
          >
            <InspectorIcon />
          </HeaderIconButton>
          <HeaderIconButton
            onClick={() => setMuted(!muted)}
            pressed={!muted}
            label={muted ? "Turn narrator audio on" : "Turn narrator audio off"}
            tone={muted ? "neutral" : "amber"}
          >
            <AudioIcon muted={muted} />
          </HeaderIconButton>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <ol
          ref={scrollRef}
          onScroll={onScroll}
          // pb-64 clears the floating composer plus the optional scroll-to-end
          // button, so bottom content can scroll above the controls instead of
          // being covered by them.
          className="h-full space-y-8 overflow-y-auto overscroll-y-contain px-4 pt-6 pb-64 sm:px-8 sm:pt-8"
        >
          {hasOlder && (
            <li className="flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="min-h-11 rounded-full border border-neutral-800 bg-neutral-950/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400 transition hover:border-neutral-700 hover:bg-neutral-900 hover:text-neutral-200 disabled:cursor-wait disabled:opacity-50"
              >
                {loadingOlder ? "Loading…" : "Load older"}
              </button>
            </li>
          )}

          {messages.length === 0 && (
            <li className="pt-12 text-center text-sm text-neutral-500">
              <p className="font-serif italic">The page is blank. Begin.</p>
            </li>
          )}

          {messages.map((m, idx) => {
            const cost = m.role === "assistant" ? costByMessageId.get(m.id) : undefined;
            const isStreamingThis = m.id === streamingAssistantId;
            const isSpeakingThis = m.role === "assistant" && m.id === speakingTurnId;
            const text = messageText(m);
            const createdAt = m.metadata?.createdAt;
            const prevUser = m.role === "assistant" ? findPrevUser(messages, idx) : undefined;
            const isMetaResponse = !!prevUser && messageText(prevUser).trim().startsWith("/");
            const canReplay =
              m.role === "assistant" && !isStreamingThis && !isMetaResponse && text.trim().length > 0;
            return (
              <li key={m.id}>
                {m.role === "user" ? (
                  <UserTurn text={text} createdAt={createdAt} />
                ) : (
                  <NarratorTurn
                    text={text}
                    streaming={isStreamingThis}
                    speaking={isSpeakingThis}
                    cost={cost}
                    canReplay={canReplay}
                    replayDisabled={muted}
                    onReplay={() => replay(m.id, text)}
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
                  className="min-h-10 rounded-full border border-red-800 px-4 py-2 text-xs font-semibold transition hover:bg-red-900/40"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => setErrorDismissed(true)}
                  className="min-h-10 rounded-full border border-neutral-700 px-4 py-2 text-xs font-semibold text-neutral-300 transition hover:bg-neutral-800"
                >
                  Dismiss
                </button>
              </div>
            </li>
          )}

          <div aria-hidden className="h-px" />
        </ol>

        {/* Edge fades: soften the chat-→-composer overlap at every viewport.
            The bottom fade is sized to match the composer clearance. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-black to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black via-black/90 to-transparent" />
      </div>

      <form
        onSubmit={onSubmit}
        // Floating composer at every viewport. Absolutely positioned over the
        // scroll area with horizontal margins so the card sits inset from the
        // edges — the Grok pattern, applied uniformly mobile and desktop so
        // the chrome stays consistent. Safe-area padding clears the iOS home
        // indicator on phones; harmless elsewhere.
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-6 sm:pb-4"
      >
        {!stickToBottom && (
          <div className="mx-auto mb-2 flex max-w-2xl justify-end px-2">
            <button
              type="button"
              onClick={scrollToEnd}
              aria-label="Scroll to end"
              title="Scroll to end"
              className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-neutral-700/80 bg-[#1b1c1f] text-neutral-200 shadow-xl shadow-black/40 transition hover:border-amber-500/50 hover:bg-neutral-800 hover:text-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
            >
              <ScrollEndIcon />
            </button>
          </div>
        )}
        {/* Grok-style composer card: pill-shaped, two-row, generously
            padded. The textarea sits on top; an action row sits below with
            the slash-command button on the left and a round Send affordance
            on the right. */}
        <div className="pointer-events-auto group relative mx-auto flex max-w-2xl flex-col gap-2 rounded-[2rem] border border-neutral-700/80 bg-[#1b1c1f] px-4 pt-4 pb-3 shadow-2xl shadow-black/50 backdrop-blur transition focus-within:border-neutral-500 focus-within:bg-[#1f2024]">
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
            // text-base (16px) at every size — prevents iOS Safari from auto-
            // zooming on focus, and reads more comfortably on desktop too.
            className="max-h-40 min-h-14 w-full resize-none bg-transparent text-base leading-relaxed text-neutral-100 placeholder:text-neutral-500 focus:outline-none disabled:opacity-50"
          />
          <div className="flex min-h-12 items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (input.startsWith("/")) return;
                  setInput("/");
                }}
                aria-label="Slash command"
                title="Slash command"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
              >
                <SlashIcon />
              </button>
            </div>
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 text-neutral-950 shadow-lg shadow-amber-950/30 transition hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-600 disabled:shadow-none"
            >
              {busy ? <BusyDots /> : <SendIcon />}
            </button>
          </div>
        </div>
        {/* Keyboard hint — useful for users with a physical keyboard. Hidden
            below sm where touch input is the norm. */}
        <p className="mx-auto mt-1.5 hidden max-w-2xl px-1 text-[11px] text-neutral-600 sm:block">
          Enter to send · Shift+Enter for newline
        </p>
      </form>
    </div>
  );
}

function UserTurn({ text, createdAt }: { text: string; createdAt: string | undefined }) {
  return (
    <div className="flex flex-col items-end">
      <div className="flex max-w-[85%] items-baseline gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-600">
        <span>You</span>
        {createdAt && (
          <time
            dateTime={dateTimeAttr(createdAt)}
            title={formatFullTimestamp(createdAt)}
            className="font-normal normal-case tracking-normal text-neutral-700"
          >
            {formatTimestamp(createdAt)}
          </time>
        )}
      </div>
      <div className="mt-1.5 max-w-[90%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-[#1f2024] px-4 py-3 text-base leading-relaxed text-neutral-100 sm:max-w-[85%]">
        {text}
      </div>
    </div>
  );
}

function NarratorTurn({
  text,
  streaming,
  speaking,
  cost,
  canReplay,
  replayDisabled,
  onReplay,
}: {
  text: string;
  streaming: boolean;
  speaking: boolean;
  cost: TurnCost | undefined;
  canReplay: boolean;
  replayDisabled: boolean;
  onReplay: () => void;
}) {
  return (
    <div className="border-l-2 border-amber-500/40 pl-4">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-amber-500/70">
          Narrator
        </span>
        {speaking && (
          <span
            aria-label="Narrator speaking"
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500/80"
          />
        )}
      </div>
      <div className="mt-1.5 whitespace-pre-wrap font-serif text-[17px] leading-[1.8] text-neutral-100">
        {text}
        {streaming && <span className="chronicles-cursor text-amber-500/70" />}
      </div>
      {!streaming && (cost || canReplay) && (
        <div className="mt-3 flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          {canReplay && (
            <button
              type="button"
              onClick={onReplay}
              disabled={replayDisabled}
              aria-label={
                replayDisabled
                  ? "Replay unavailable while audio is off"
                  : speaking
                    ? "Replay this narration from the start"
                    : "Replay this narration"
              }
              title={
                replayDisabled
                  ? "Turn audio on to replay"
                  : speaking
                    ? "Restart playback"
                    : "Replay"
              }
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-neutral-700/80 bg-neutral-900/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-200 transition hover:border-amber-500/60 hover:bg-neutral-800 hover:text-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-700/80 disabled:hover:bg-neutral-900/80 disabled:hover:text-neutral-200"
            >
              <ReplayIcon />
              <span>Replay</span>
            </button>
          )}
          {cost && <CostFooter cost={cost} />}
        </div>
      )}
    </div>
  );
}

function HeaderIconButton({
  children,
  onClick,
  pressed,
  label,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pressed: boolean;
  label: string;
  tone: "neutral" | "amber";
}) {
  // Ghost icon button — same shape at every viewport. Tinted background
  // shows the "on" state. Used identically on mobile and desktop so the
  // chrome stays consistent.
  const base =
    "inline-flex h-11 w-11 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60";
  const stateClass =
    tone === "amber"
      ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
      : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={`${base} ${stateClass}`}
    >
      {children}
    </button>
  );
}

function SlashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 3L5 13" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8h10" />
      <path d="M9 4l4 4-4 4" />
    </svg>
  );
}

function ScrollEndIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 3v9" />
      <path d="M4.5 8.5L8 12l3.5-3.5" />
      <path d="M4 14h8" />
    </svg>
  );
}

function BusyDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
        style={{ animationDelay: "300ms" }}
      />
    </span>
  );
}

function ReplayIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8a5 5 0 1 0 1.5-3.5" />
      <path d="M3 2v3h3" />
    </svg>
  );
}

function InspectorIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <line x1="5" y1="6" x2="11" y2="6" />
      <line x1="5" y1="9" x2="9" y2="9" />
    </svg>
  );
}

function AudioIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h2l3.5-2.5v9L5 10H3z" />
      {muted ? (
        <>
          <line x1="11" y1="6" x2="14" y2="9" />
          <line x1="14" y1="6" x2="11" y2="9" />
        </>
      ) : (
        <>
          <path d="M11 5.5c.9.8 1.4 1.7 1.4 2.5s-.5 1.7-1.4 2.5" />
          <path d="M13 4c1.4 1.1 2.1 2.5 2.1 4s-.7 2.9-2.1 4" />
        </>
      )}
    </svg>
  );
}

function CostFooter({ cost }: { cost: TurnCost }) {
  const segments: string[] = [];
  if (cost.narrator) segments.push(agentSegment("narrator", cost.narrator));
  if (cost.archivist) segments.push(agentSegment("archivist", cost.archivist));
  if (cost.classifier) segments.push(agentSegment("class", cost.classifier));
  if (cost.npcAgent) segments.push(agentSegment("npc", cost.npcAgent));
  if (cost.tts) segments.push(`tts ${fmt(cost.tts.chars)} chars`);
  // Wraps cleanly at narrow widths; on wider viewports the same flex layout
  // keeps it on a single line. No viewport-specific clipping.
  return (
    <div className="min-w-0 max-w-full font-sans text-xs leading-relaxed tabular-nums text-neutral-500">
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

function formatTimestamp(value: string): string {
  const date = parseTimestamp(value);
  if (!date) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFullTimestamp(value: string): string {
  const date = parseTimestamp(value);
  if (!date) return value;
  return date.toLocaleString([], {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function dateTimeAttr(value: string): string {
  return parseTimestamp(value)?.toISOString() ?? value;
}

function parseTimestamp(value: string): Date | null {
  const normalized = /^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
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
