"use client";

import { useCallback, useEffect, useState } from "react";

import type { FullWorldState } from "@/lib/world-state";

interface WorldInspectorProps {
  worldId: number;
  open: boolean;
  onClose: () => void;
  // Bumped by the parent after each turn finishes streaming, so the drawer
  // refetches without us needing to poll or duplicate the chat status watcher.
  refreshKey: number;
}

export function WorldInspector({ worldId, open, onClose, refreshKey }: WorldInspectorProps) {
  const [state, setState] = useState<FullWorldState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/world-state?worldId=${worldId}`);
      if (!res.ok) {
        setError(`Inspector unavailable (${res.status})`);
        return;
      }
      setState((await res.json()) as FullWorldState);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  useEffect(() => {
    if (!open) return;
    void fetchState();
  }, [open, refreshKey, fetchState]);

  return (
    <aside
      aria-label="World inspector"
      aria-hidden={!open}
      className={
        "fixed inset-y-0 right-0 z-30 w-[360px] max-w-[90vw] transform border-l border-neutral-900 bg-neutral-950/95 transition-transform duration-200 ease-out " +
        (open ? "translate-x-0" : "translate-x-full")
      }
    >
      <div className="flex items-center justify-between border-b border-neutral-900 px-4 py-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-400">
          World inspector
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="text-sm text-neutral-500 transition hover:text-neutral-200"
        >
          ✕
        </button>
      </div>

      <div className="h-[calc(100%-3rem)] overflow-y-auto px-4 py-3 text-[13px] text-neutral-300">
        {loading && !state && <p className="text-neutral-500">Loading…</p>}
        {error && <p className="text-red-400">{error}</p>}
        {state && <InspectorBody state={state} />}
      </div>
    </aside>
  );
}

function InspectorBody({ state }: { state: FullWorldState }) {
  const activeScene = state.scenes.find((s) => s.id === state.currentSceneId) ?? null;
  return (
    <div className="space-y-5">
      <section>
        <SectionHeader>Clock</SectionHeader>
        <p className="text-neutral-200">{state.worldTime ?? "(unset)"}</p>
        {activeScene && (
          <p className="mt-1 text-neutral-500">
            {activeScene.title} · scene {activeScene.scene_number}
          </p>
        )}
      </section>

      <section>
        <SectionHeader>Characters ({state.characters.length})</SectionHeader>
        {state.characters.length === 0 ? (
          <p className="text-neutral-500">None.</p>
        ) : (
          <ul className="space-y-2">
            {state.characters.map((c) => (
              <li key={c.id} className="border-l-2 border-neutral-800 pl-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-neutral-100">{c.name}</span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                    {c.is_player === 1 ? "player" : c.status}
                  </span>
                </div>
                {c.description && (
                  <p className="mt-0.5 text-neutral-400">{c.description}</p>
                )}
                {c.memorable_facts && (
                  <ul className="mt-1 list-disc pl-4 text-neutral-500">
                    {c.memorable_facts
                      .split("\n")
                      .filter((f) => f.trim().length > 0)
                      .map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader>Places ({state.places.length})</SectionHeader>
        {state.places.length === 0 ? (
          <p className="text-neutral-500">None.</p>
        ) : (
          <ul className="space-y-2">
            {state.places.map((p) => (
              <li key={p.id} className="border-l-2 border-neutral-800 pl-2.5">
                <div className="font-medium text-neutral-100">{p.name}</div>
                {p.description && <p className="mt-0.5 text-neutral-400">{p.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader>Scenes ({state.scenes.length})</SectionHeader>
        {state.scenes.length === 0 ? (
          <p className="text-neutral-500">None.</p>
        ) : (
          <ol className="space-y-2">
            {state.scenes.map((s) => (
              <li
                key={s.id}
                className={
                  "border-l-2 pl-2.5 " +
                  (s.status === "active" ? "border-amber-500/60" : "border-neutral-800")
                }
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-neutral-100">
                    {s.scene_number}. {s.title}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                    {s.status}
                  </span>
                </div>
                {s.summary && <p className="mt-0.5 text-neutral-400">{s.summary}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-500">
      {children}
    </h3>
  );
}
