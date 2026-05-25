"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { splitNewChunks } from "@/lib/sentence-splitter";

const MUTE_STORAGE_KEY = "chronicles.narrator.muted";

export type NarratorAudioStatus = "idle" | "speaking";

interface UseNarratorAudioArgs {
  text: string;
  streaming: boolean;
  turnId: string | undefined;
  onTurnComplete?: (chars: number) => void;
}

interface UseNarratorAudioReturn {
  muted: boolean;
  setMuted: (next: boolean) => void;
  status: NarratorAudioStatus;
  activeTurnId: string | undefined;
  primeAudio: () => void;
  replay: (turnId: string, text: string) => void;
}

interface JobState {
  jobKey: string;
  turnId: string;
  source: "stream" | "replay";
  cursor: number;
  nextSeq: number;
  playSeq: number;
  pending: Map<number, AudioBuffer>;
  controllers: Set<AbortController>;
  flushed: boolean;
  reported: boolean;
  charsSent: number;
  sourceNode: AudioBufferSourceNode | null;
  failed: boolean;
}

function freshJob(jobKey: string, turnId: string, source: "stream" | "replay"): JobState {
  return {
    jobKey,
    turnId,
    source,
    cursor: 0,
    nextSeq: 0,
    playSeq: 0,
    pending: new Map(),
    controllers: new Set(),
    flushed: false,
    reported: false,
    charsSent: 0,
    sourceNode: null,
    failed: false,
  };
}

interface Override {
  jobKey: string;
  turnId: string;
  text: string;
}

export function useNarratorAudio({
  text,
  streaming,
  turnId,
  onTurnComplete,
}: UseNarratorAudioArgs): UseNarratorAudioReturn {
  const [muted, setMutedState] = useState<boolean>(false);
  const [status, setStatus] = useState<NarratorAudioStatus>("idle");
  const [override, setOverride] = useState<Override | null>(null);
  const jobRef = useRef<JobState | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mutedRef = useRef(false);
  const onTurnCompleteRef = useRef(onTurnComplete);
  // The first turn visible on mount is history, not a fresh narration request.
  // Suppressing only that initial turn avoids relying on whether useChat exposes
  // the new assistant id during a `streaming=true` render.
  const initialTurnIdRef = useRef<string | undefined>(turnId);
  // Tracks turns that have finished playback. This prevents the dispatch effect
  // from re-fetching/playing a turn when the override transitions replay →
  // stream for the same turnId after a replay completes.
  const playedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    onTurnCompleteRef.current = onTurnComplete;
  }, [onTurnComplete]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setMutedState(window.localStorage.getItem(MUTE_STORAGE_KEY) === "1");
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // A new streaming turn always supersedes a replay in progress. Gate on
  // `streaming` so replays of older turns aren't clobbered just because
  // `turnId` (always the latest assistant message) differs from the replay
  // target.
  useEffect(() => {
    if (override && streaming && turnId && turnId !== override.turnId) {
      setOverride(null);
    }
  }, [turnId, override, streaming]);

  const effective = useMemo(() => {
    if (override) {
      return {
        jobKey: override.jobKey,
        turnId: override.turnId,
        text: override.text,
        streaming: false,
        source: "replay" as const,
      };
    }
    return {
      jobKey: turnId ?? "",
      turnId: turnId ?? "",
      text,
      streaming,
      source: "stream" as const,
    };
  }, [override, turnId, text, streaming]);

  const ensureAudioContext = useCallback(() => {
    const existing = audioContextRef.current;
    if (existing && existing.state !== "closed") return existing;
    const Ctor = getAudioContextConstructor();
    if (!Ctor) return null;
    const ctx = new Ctor();
    audioContextRef.current = ctx;
    return ctx;
  }, []);

  const primeAudio = useCallback(() => {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().catch((err) => {
        console.error("[narrator-audio] audio context resume rejected", err);
      });
    }
    try {
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      source.connect(ctx.destination);
      source.start();
    } catch (err) {
      console.error("[narrator-audio] audio context prime failed", err);
    }
  }, [ensureAudioContext]);

  const stopCurrentAudio = useCallback(() => {
    const j = jobRef.current;
    if (!j) return;
    if (j.sourceNode) {
      j.sourceNode.onended = null;
      try {
        j.sourceNode.stop();
      } catch {
        // Already stopped.
      }
      j.sourceNode.disconnect();
      j.sourceNode = null;
    }
  }, []);

  const resetJob = useCallback(
    (nextKey: string | null, nextTurnId: string, nextSource: "stream" | "replay") => {
      const j = jobRef.current;
      if (j) {
        j.controllers.forEach((c) => c.abort());
        j.controllers.clear();
        j.pending.clear();
      }
      stopCurrentAudio();
      setStatus("idle");
      jobRef.current = nextKey ? freshJob(nextKey, nextTurnId, nextSource) : null;
    },
    [stopCurrentAudio],
  );

  const playNext = useCallback(() => {
    const j = jobRef.current;
    if (!j || mutedRef.current) return;
    const buffer = j.pending.get(j.playSeq);
    if (!buffer) {
      if (j.flushed && j.nextSeq === j.playSeq) {
        setStatus("idle");
        playedRef.current.add(j.turnId);
        if (j.source === "replay") setOverride(null);
      }
      return;
    }
    j.pending.delete(j.playSeq);
    const ctx = ensureAudioContext();
    if (!ctx) {
      markFailed(j, "[narrator-audio] Web Audio API unavailable");
      return;
    }
    if (ctx.state === "suspended") {
      void ctx.resume().catch((err) => {
        console.error("[narrator-audio] audio context resume rejected", err);
      });
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    j.sourceNode = source;
    setStatus("speaking");
    source.onended = () => {
      const cur = jobRef.current;
      if (!cur || cur !== j) return;
      source.disconnect();
      cur.sourceNode = null;
      cur.playSeq += 1;
      playNext();
    };
    try {
      source.start();
    } catch (err) {
      source.disconnect();
      j.sourceNode = null;
      markFailed(j, `[narrator-audio] playback failed: ${String(err)}`);
    }
  }, [ensureAudioContext]);

  const fetchChunk = useCallback(
    async (chunk: string, seq: number, owner: JobState) => {
      if (owner.failed) return;
      const controller = new AbortController();
      owner.controllers.add(controller);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunk }),
          signal: controller.signal,
        });
        if (!res.ok) {
          markFailed(owner, `[narrator-audio] /api/tts ${res.status} ${await safeText(res)}`);
          return;
        }
        const arrayBuffer = await res.arrayBuffer();
        if (jobRef.current !== owner) return;
        const ctx = ensureAudioContext();
        if (!ctx) {
          markFailed(owner, "[narrator-audio] Web Audio API unavailable");
          return;
        }
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        if (jobRef.current !== owner) return;
        owner.pending.set(seq, buffer);
        if (!owner.sourceNode && seq === owner.playSeq && !mutedRef.current) {
          playNext();
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        markFailed(owner, `[narrator-audio] fetch failed: ${String(err)}`);
      } finally {
        owner.controllers.delete(controller);
      }
    },
    [ensureAudioContext, playNext],
  );

  useEffect(() => {
    if (!effective.jobKey) {
      resetJob(null, "", "stream");
      return;
    }
    // Only auto-narrate turns created after this hook mounted. Without this
    // gate, opening a world re-fetches TTS for the last existing narration on
    // every page load. Replays invoked explicitly by the user bypass this.
    const allowed =
      effective.source === "replay" ||
      (effective.turnId !== initialTurnIdRef.current &&
        !playedRef.current.has(effective.turnId));
    if (!allowed) return;
    if (!jobRef.current || jobRef.current.jobKey !== effective.jobKey) {
      resetJob(effective.jobKey, effective.turnId, effective.source);
    }

    const j = jobRef.current;
    if (!j) return;
    const { chunks, cursor } = splitNewChunks(effective.text, j.cursor, {
      flush: !effective.streaming,
    });
    j.cursor = cursor;
    if (!effective.streaming) j.flushed = true;

    // Advance the cursor even while muted so unmuting mid-turn starts from
    // "now" instead of replaying everything already on screen. Skip dispatch
    // entirely if muted or this job has already hit a TTS error.
    if (!mutedRef.current && !j.failed) {
      for (const chunk of chunks) {
        const seq = j.nextSeq++;
        j.charsSent += chunk.length;
        void fetchChunk(chunk, seq, j);
      }
    }

    if (!effective.streaming && j.flushed && !j.reported) {
      j.reported = true;
      if (j.charsSent > 0 && j.source === "stream") {
        onTurnCompleteRef.current?.(j.charsSent);
      }
    }

    if (!effective.streaming && j.flushed && j.nextSeq === j.playSeq && !j.sourceNode) {
      setStatus("idle");
      playedRef.current.add(j.turnId);
      if (j.source === "replay") setOverride(null);
    }
  }, [effective, fetchChunk, resetJob]);

  const setMuted = useCallback(
    (next: boolean) => {
      setMutedState(next);
      mutedRef.current = next;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
      }
      if (!next) {
        primeAudio();
      }
      if (next) {
        const j = jobRef.current;
        if (j) {
          j.controllers.forEach((c) => c.abort());
          j.controllers.clear();
          j.pending.clear();
        }
        stopCurrentAudio();
        setStatus("idle");
        setOverride(null);
      }
    },
    [primeAudio, stopCurrentAudio],
  );

  const replay = useCallback((replayTurnId: string, replayText: string) => {
    if (!replayTurnId || !replayText.trim()) return;
    if (mutedRef.current) return;
    primeAudio();
    setOverride({
      jobKey: `replay:${replayTurnId}:${Date.now()}`,
      turnId: replayTurnId,
      text: replayText,
    });
  }, [primeAudio]);

  useEffect(() => {
    return () => {
      resetJob(null, "", "stream");
      const ctx = audioContextRef.current;
      audioContextRef.current = null;
      if (ctx && ctx.state !== "closed") void ctx.close();
    };
  }, [resetJob]);

  const activeTurnId = jobRef.current && status === "speaking" ? jobRef.current.turnId : undefined;

  return { muted, setMuted, status, activeTurnId, primeAudio, replay };
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return res.statusText;
  }
}

// First failure in a job logs once, aborts in-flight siblings, and flips the
// failed flag so subsequent dispatches no-op. Later failures (from already
// in-flight requests) see the flag and stay silent.
function markFailed(job: JobState, message: string): void {
  if (job.failed) return;
  job.failed = true;
  console.error(message);
  job.controllers.forEach((c) => c.abort());
  job.controllers.clear();
  job.pending.clear();
}
