"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MUTE_STORAGE_KEY = "chronicles.narrator.muted";
const PRIME_AUDIO_SECONDS = 0.05;
const PROGRESSIVE_AUDIO_MIME = "audio/mpeg";

export type NarratorAudioStatus = "idle" | "loading" | "speaking";

let sharedAudioContext: AudioContext | null = null;
let sharedMediaElement: HTMLAudioElement | null = null;
let sharedSilentMediaUrl: string | null = null;

type AudioClip =
  | { kind: "web-audio"; buffer: AudioBuffer }
  | { kind: "media-element"; blob: Blob; url: string | null };

interface UseNarratorAudioArgs {
  worldId: number;
  text: string;
  streaming: boolean;
  turnId: string | undefined;
  voice?: string;
  onTurnComplete?: (turnId: string, chars: number) => void;
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
  pending: Map<number, AudioClip>;
  controllers: Set<AbortController>;
  flushed: boolean;
  charsSent: number;
  sourceNode: AudioBufferSourceNode | null;
  mediaUrl: string | null;
  mediaSource: MediaSource | null;
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
    charsSent: 0,
    sourceNode: null,
    mediaUrl: null,
    mediaSource: null,
    failed: false,
  };
}

interface Override {
  jobKey: string;
  turnId: string;
  text: string;
}

export function useNarratorAudio({
  worldId,
  text,
  streaming,
  turnId,
  voice,
  onTurnComplete,
}: UseNarratorAudioArgs): UseNarratorAudioReturn {
  const [muted, setMutedState] = useState<boolean>(false);
  const [status, setStatus] = useState<NarratorAudioStatus>("idle");
  const [override, setOverride] = useState<Override | null>(null);
  const jobRef = useRef<JobState | null>(null);
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
    const existing = sharedAudioContext;
    if (existing && existing.state !== "closed") return existing;
    const Ctor = getAudioContextConstructor();
    if (!Ctor) return null;
    const ctx = new Ctor();
    sharedAudioContext = ctx;
    return ctx;
  }, []);

  const primeAudio = useCallback(() => {
    if (shouldUseMediaElementPlayback()) {
      primeMediaElement();
      return;
    }

    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().catch((err) => {
        console.error("[narrator-audio] audio context resume rejected", err);
      });
    }
    try {
      const source = ctx.createBufferSource();
      const frameCount = Math.max(1, Math.ceil(ctx.sampleRate * PRIME_AUDIO_SECONDS));
      source.buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
      source.connect(ctx.destination);
      source.start();
      source.onended = () => {
        source.disconnect();
      };
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
    if (j.mediaUrl) {
      const audio = sharedMediaElement;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      URL.revokeObjectURL(j.mediaUrl);
      j.mediaUrl = null;
    }
    j.mediaSource = null;
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

  const playNext = useCallback(async () => {
    const j = jobRef.current;
    if (!j || mutedRef.current) return;
    const clip = j.pending.get(j.playSeq);
    if (!clip) {
      if (j.flushed && j.nextSeq === j.playSeq) {
        setStatus("idle");
        playedRef.current.add(j.turnId);
        if (j.source === "replay") setOverride(null);
      }
      return;
    }
    j.pending.delete(j.playSeq);
    if (clip.kind === "media-element") {
      await playMediaClip(clip, j, playNext, setStatus);
      return;
    }

    const ctx = ensureAudioContext();
    if (!ctx) {
      setStatus("idle");
      markFailed(j, "[narrator-audio] Web Audio API unavailable");
      return;
    }
    const resumed = await resumeAudioContext(ctx, j);
    if (!resumed || jobRef.current !== j || mutedRef.current) {
      if (jobRef.current === j && !mutedRef.current) setStatus("idle");
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = clip.buffer;
    source.connect(ctx.destination);
    j.sourceNode = source;
    setStatus("speaking");
    source.onended = () => {
      const cur = jobRef.current;
      if (!cur || cur !== j) return;
      source.disconnect();
      cur.sourceNode = null;
      cur.playSeq += 1;
      void playNext();
    };
    try {
      source.start();
    } catch (err) {
      source.disconnect();
      j.sourceNode = null;
      setStatus("idle");
      markFailed(j, `[narrator-audio] playback failed: ${String(err)}`);
    }
  }, [ensureAudioContext]);

  const fetchChunk = useCallback(
    async (chunk: string, seq: number, owner: JobState) => {
      if (owner.failed) return;
      const controller = new AbortController();
      owner.controllers.add(controller);
      try {
        if (!mutedRef.current) setStatus("loading");
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: chunk,
            worldId,
            turnId: numericTurnId(owner.turnId),
            voice,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setStatus("idle");
          markFailed(owner, `[narrator-audio] /api/tts ${res.status} ${await safeText(res)}`);
          return;
        }
        if (jobRef.current !== owner) return;
        if (res.headers.get("X-TTS-Cache") !== "HIT") {
          owner.charsSent += chunk.length;
          if (owner.turnId) {
            onTurnCompleteRef.current?.(owner.turnId, chunk.length);
          }
        }
        if (seq === owner.playSeq && await playProgressiveMediaResponse(res, owner, playNext, setStatus)) {
          return;
        }
        if (shouldUseMediaElementPlayback()) {
          const blob = await res.blob();
          if (jobRef.current !== owner) return;
          owner.pending.set(seq, { kind: "media-element", blob, url: null });
          if (!owner.sourceNode && !owner.mediaUrl && seq === owner.playSeq && !mutedRef.current) {
            void playNext();
          }
          return;
        }

        const arrayBuffer = await res.arrayBuffer();
        if (jobRef.current !== owner) return;
        const ctx = ensureAudioContext();
        if (!ctx) {
          setStatus("idle");
          markFailed(owner, "[narrator-audio] Web Audio API unavailable");
          return;
        }
        let buffer: AudioBuffer;
        try {
          buffer = await ctx.decodeAudioData(arrayBuffer);
        } catch (err) {
          setStatus("idle");
          markFailed(owner, `[narrator-audio] decodeAudioData failed: ${String(err)}`);
          return;
        }
        if (jobRef.current !== owner) return;
        owner.pending.set(seq, { kind: "web-audio", buffer });
        if (!owner.sourceNode && !owner.mediaUrl && seq === owner.playSeq && !mutedRef.current) {
          void playNext();
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setStatus("idle");
        markFailed(owner, `[narrator-audio] fetch failed: ${String(err)}`);
      } finally {
        owner.controllers.delete(controller);
      }
    },
    [ensureAudioContext, playNext, voice, worldId],
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
    if (effective.streaming) return;

    j.flushed = true;
    const fullText = effective.text.trim();
    if (j.cursor === 0) {
      j.cursor = effective.text.length;
      if (fullText && !mutedRef.current && !j.failed) {
        const seq = j.nextSeq++;
        void fetchChunk(fullText, seq, j);
      }
    }

    if (!effective.streaming && j.flushed && j.nextSeq === j.playSeq && !j.sourceNode && !j.mediaUrl) {
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
    };
  }, [resetJob]);

  const activeTurnId = jobRef.current && status !== "idle" ? jobRef.current.turnId : undefined;

  return { muted, setMuted, status, activeTurnId, primeAudio, replay };
}

async function playProgressiveMediaResponse(
  res: Response,
  job: JobState,
  playNext: () => Promise<void>,
  setStatus: (status: NarratorAudioStatus) => void,
): Promise<boolean> {
  if (!res.body || !shouldUseProgressiveMediaPlayback()) return false;

  const audio = ensureMediaElement();
  const MediaSourceCtor = getMediaSourceConstructor();
  if (!audio || !MediaSourceCtor) return false;

  let mediaSource: MediaSource;
  let url: string;
  try {
    mediaSource = new MediaSourceCtor();
    url = URL.createObjectURL(mediaSource);
  } catch {
    return false;
  }

  job.mediaSource = mediaSource;
  job.mediaUrl = url;
  audio.onended = () => {
    if (job.failed || job.mediaUrl !== url) return;
    cleanupMediaUrl(job, audio);
    job.mediaSource = null;
    job.playSeq += 1;
    void playNext();
  };
  audio.onerror = () => {
    if (job.failed || job.mediaUrl !== url) return;
    cleanupMediaUrl(job, audio);
    job.mediaSource = null;
    setStatus("idle");
    markFailed(
      job,
      `[narrator-audio] progressive media playback error: ${String(
        audio.error?.message ?? audio.error?.code ?? "unknown",
      )}`,
    );
  };

  audio.src = url;
  audio.currentTime = 0;
  setStatus("loading");

  try {
    await once(mediaSource, "sourceopen");
    if (job.mediaUrl !== url || job.failed) return true;

    const sourceBuffer = mediaSource.addSourceBuffer(PROGRESSIVE_AUDIO_MIME);
    const reader = res.body.getReader();
    let started = false;

    while (true) {
      const { value, done } = await reader.read();
      if (job.mediaUrl !== url || job.failed) {
        await reader.cancel().catch(() => undefined);
        return true;
      }
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      await appendSourceBuffer(sourceBuffer, toExactArrayBuffer(value));
      if (!started) {
        started = true;
        setStatus("speaking");
        await audio.play();
      }
    }

    if (sourceBuffer.updating) await once(sourceBuffer, "updateend");
    if (mediaSource.readyState === "open") {
      mediaSource.endOfStream();
    }
    return true;
  } catch (err) {
    if (job.mediaUrl === url && !job.failed) {
      cleanupMediaUrl(job, audio);
      job.mediaSource = null;
      setStatus("idle");
      markFailed(job, `[narrator-audio] progressive playback failed: ${String(err)}`);
    }
    return true;
  }
}

async function playMediaClip(
  clip: Extract<AudioClip, { kind: "media-element" }>,
  job: JobState,
  playNext: () => Promise<void>,
  setStatus: (status: NarratorAudioStatus) => void,
): Promise<void> {
  const audio = ensureMediaElement();
  if (!audio) {
    markFailed(job, "[narrator-audio] HTMLAudioElement unavailable");
    return;
  }

  const url = URL.createObjectURL(clip.blob);
  clip.url = url;
  job.mediaUrl = url;

  audio.onended = () => {
    if (job.failed || job.mediaUrl !== url) return;
    cleanupMediaUrl(job, audio);
    job.playSeq += 1;
    void playNext();
  };
  audio.onerror = () => {
    if (job.failed || job.mediaUrl !== url) return;
    cleanupMediaUrl(job, audio);
    setStatus("idle");
    markFailed(
      job,
      `[narrator-audio] media playback error: ${String(
        audio.error?.message ?? audio.error?.code ?? "unknown",
      )}`,
    );
  };

  audio.src = url;
  audio.currentTime = 0;
  setStatus("speaking");
  try {
    await audio.play();
  } catch (err) {
    if (job.mediaUrl !== url) return;
    cleanupMediaUrl(job, audio);
    setStatus("idle");
    markFailed(job, `[narrator-audio] media play rejected: ${String(err)}`);
  }
}

function cleanupMediaUrl(job: JobState, audio: HTMLAudioElement): void {
  audio.onended = null;
  audio.onerror = null;
  audio.removeAttribute("src");
  audio.load();
  if (job.mediaUrl) {
    URL.revokeObjectURL(job.mediaUrl);
    job.mediaUrl = null;
  }
}

async function resumeAudioContext(ctx: AudioContext, job: JobState): Promise<boolean> {
  if (ctx.state === "running") return true;
  if (ctx.state === "closed") {
    markFailed(job, "[narrator-audio] audio context is closed");
    return false;
  }
  try {
    await ctx.resume();
  } catch (err) {
    markFailed(job, `[narrator-audio] audio context resume rejected: ${String(err)}`);
    return false;
  }
  const nextState = ctx.state as AudioContextState;
  if (nextState === "running") return true;
  markFailed(job, `[narrator-audio] audio context still ${nextState} after resume`);
  return false;
}

function shouldUseMediaElementPlayback(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|Android)/i.test(ua);
}

function shouldUseProgressiveMediaPlayback(): boolean {
  if (typeof navigator === "undefined") return false;
  if (shouldUseMediaElementPlayback()) return false;
  const MediaSourceCtor = getMediaSourceConstructor();
  return !!MediaSourceCtor?.isTypeSupported?.(PROGRESSIVE_AUDIO_MIME);
}

function getMediaSourceConstructor(): typeof MediaSource | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.MediaSource ??
    (window as Window & typeof globalThis & { WebKitMediaSource?: typeof MediaSource })
      .WebKitMediaSource
  );
}

function ensureMediaElement(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (sharedMediaElement) return sharedMediaElement;
  const audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("playsinline", "true");
  sharedMediaElement = audio;
  return audio;
}

function primeMediaElement(): void {
  const audio = ensureMediaElement();
  if (!audio) return;
  try {
    const primeUrl = getSilentMediaUrl();
    audio.src = primeUrl;
    audio.currentTime = 0;
    void audio
      .play()
      .then(() => {
        if (audio.src === primeUrl) {
          audio.pause();
          audio.currentTime = 0;
        }
      })
      .catch((err) => {
        if (audio.src !== primeUrl) return;
        console.error("[narrator-audio] media element prime rejected", err);
      });
  } catch (err) {
    console.error("[narrator-audio] media element prime failed", err);
  }
}

function getSilentMediaUrl(): string {
  if (sharedSilentMediaUrl) return sharedSilentMediaUrl;
  const sampleRate = 8000;
  const frameCount = Math.ceil(sampleRate * PRIME_AUDIO_SECONDS);
  const dataSize = frameCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  sharedSilentMediaUrl = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  return sharedSilentMediaUrl;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

function numericTurnId(turnId: string): number | undefined {
  const parsed = Number(turnId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function once(target: EventTarget, eventName: string): Promise<Event> {
  return new Promise((resolve) => {
    target.addEventListener(eventName, resolve, { once: true });
  });
}

function appendSourceBuffer(sourceBuffer: SourceBuffer, chunk: BufferSource): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      sourceBuffer.removeEventListener("updateend", onUpdateEnd);
      sourceBuffer.removeEventListener("error", onError);
    };
    const onUpdateEnd = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("SourceBuffer append failed"));
    };

    sourceBuffer.addEventListener("updateend", onUpdateEnd);
    sourceBuffer.addEventListener("error", onError);
    try {
      sourceBuffer.appendBuffer(chunk);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

function toExactArrayBuffer(value: Uint8Array): ArrayBuffer {
  if (
    value.buffer instanceof ArrayBuffer &&
    value.byteOffset === 0 &&
    value.byteLength === value.buffer.byteLength
  ) {
    return value.buffer;
  }
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
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
