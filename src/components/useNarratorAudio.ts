"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { splitNewSentences } from "@/lib/sentence-splitter";

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
  replay: (turnId: string, text: string) => void;
}

interface JobState {
  jobKey: string;
  turnId: string;
  source: "stream" | "replay";
  cursor: number;
  nextSeq: number;
  playSeq: number;
  pending: Map<number, Blob>;
  controllers: Set<AbortController>;
  flushed: boolean;
  reported: boolean;
  charsSent: number;
  audio: HTMLAudioElement | null;
  blobUrl: string | null;
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
    audio: null,
    blobUrl: null,
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
  const mutedRef = useRef(false);
  const onTurnCompleteRef = useRef(onTurnComplete);

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

  // A new streaming turn always supersedes a replay in progress.
  useEffect(() => {
    if (override && turnId && turnId !== override.turnId) {
      setOverride(null);
    }
  }, [turnId, override]);

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

  const stopCurrentAudio = useCallback(() => {
    const j = jobRef.current;
    if (!j) return;
    if (j.audio) {
      j.audio.onended = null;
      j.audio.onerror = null;
      j.audio.pause();
      j.audio = null;
    }
    if (j.blobUrl) {
      URL.revokeObjectURL(j.blobUrl);
      j.blobUrl = null;
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
    const blob = j.pending.get(j.playSeq);
    if (!blob) {
      if (j.flushed && j.nextSeq === j.playSeq) {
        setStatus("idle");
        if (j.source === "replay") setOverride(null);
      }
      return;
    }
    j.pending.delete(j.playSeq);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    j.audio = audio;
    j.blobUrl = url;
    setStatus("speaking");
    audio.onended = () => {
      const cur = jobRef.current;
      if (!cur || cur !== j) return;
      URL.revokeObjectURL(url);
      if (cur.blobUrl === url) cur.blobUrl = null;
      cur.audio = null;
      cur.playSeq += 1;
      playNext();
    };
    audio.onerror = () => {
      const cur = jobRef.current;
      if (!cur || cur !== j) return;
      console.error("[narrator-audio] playback error", audio.error);
      URL.revokeObjectURL(url);
      if (cur.blobUrl === url) cur.blobUrl = null;
      cur.audio = null;
      cur.playSeq += 1;
      playNext();
    };
    void audio.play().catch((err) => {
      console.error("[narrator-audio] audio.play() rejected", err);
    });
  }, []);

  const fetchSentence = useCallback(
    async (sentence: string, seq: number, owner: JobState) => {
      if (owner.failed) return;
      const controller = new AbortController();
      owner.controllers.add(controller);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sentence }),
          signal: controller.signal,
        });
        if (!res.ok) {
          markFailed(owner, `[narrator-audio] /api/tts ${res.status} ${await safeText(res)}`);
          return;
        }
        const blob = await res.blob();
        if (jobRef.current !== owner) return;
        owner.pending.set(seq, blob);
        if (!owner.audio && seq === owner.playSeq && !mutedRef.current) {
          playNext();
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        markFailed(owner, `[narrator-audio] fetch failed: ${String(err)}`);
      } finally {
        owner.controllers.delete(controller);
      }
    },
    [playNext],
  );

  useEffect(() => {
    if (!effective.jobKey) {
      resetJob(null, "", "stream");
      return;
    }
    if (!jobRef.current || jobRef.current.jobKey !== effective.jobKey) {
      resetJob(effective.jobKey, effective.turnId, effective.source);
    }

    const j = jobRef.current;
    if (!j) return;
    const { sentences, cursor } = splitNewSentences(effective.text, j.cursor, {
      flush: !effective.streaming,
    });
    j.cursor = cursor;
    if (!effective.streaming) j.flushed = true;

    // Advance the cursor even while muted so unmuting mid-turn starts from
    // "now" instead of replaying everything already on screen. Skip dispatch
    // entirely if muted or this job has already hit a TTS error.
    if (!mutedRef.current && !j.failed) {
      for (const sentence of sentences) {
        const seq = j.nextSeq++;
        j.charsSent += sentence.length;
        void fetchSentence(sentence, seq, j);
      }
    }

    if (!effective.streaming && j.flushed && !j.reported) {
      j.reported = true;
      if (j.charsSent > 0 && j.source === "stream") {
        onTurnCompleteRef.current?.(j.charsSent);
      }
    }

    if (!effective.streaming && j.flushed && j.nextSeq === j.playSeq && !j.audio) {
      setStatus("idle");
      if (j.source === "replay") setOverride(null);
    }
  }, [effective, fetchSentence, resetJob]);

  const setMuted = useCallback(
    (next: boolean) => {
      setMutedState(next);
      mutedRef.current = next;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
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
    [stopCurrentAudio],
  );

  const replay = useCallback((replayTurnId: string, replayText: string) => {
    if (!replayTurnId || !replayText.trim()) return;
    if (mutedRef.current) return;
    setOverride({
      jobKey: `replay:${replayTurnId}:${Date.now()}`,
      turnId: replayTurnId,
      text: replayText,
    });
  }, []);

  useEffect(() => {
    return () => {
      resetJob(null, "", "stream");
    };
  }, [resetJob]);

  const activeTurnId = jobRef.current && status === "speaking" ? jobRef.current.turnId : undefined;

  return { muted, setMuted, status, activeTurnId, replay };
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
