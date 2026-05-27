"use client";

import { useEffect, useMemo, useState } from "react";

import type { FullWorldState } from "@/lib/world-state";

type InspectorTab = "now" | "story" | "wiki";

const TABS: { id: InspectorTab; label: string; description: string }[] = [
  { id: "now", label: "Now", description: "Current scene, place, present characters" },
  { id: "story", label: "Story", description: "Quests, threads, objectives, clues, resources" },
  { id: "wiki", label: "Wiki", description: "All characters, places, scenes" },
];

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
  const [tab, setTab] = useState<InspectorTab>("now");

  // AbortController guards against a slow /api/world-state response landing
  // *after* a newer fetch has already updated state. Without this, rapid
  // open/close or worldId switches could flash a stale shape over the current
  // one. Either kind of change triggers effect cleanup, which aborts the
  // in-flight request.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/world-state?worldId=${worldId}`, {
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        if (!res.ok) {
          setError(`Inspector unavailable (${res.status})`);
          return;
        }
        const data = (await res.json()) as FullWorldState;
        if (ctrl.signal.aborted) return;
        setState(data);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(String(err));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [open, refreshKey, worldId]);

  return (
    <>
      {/* Tap-out scrim on mobile only — at sm+ the drawer is narrow enough
          that the chat next to it stays usable, so no scrim there. */}
      <div
        aria-hidden
        onClick={onClose}
        className={
          "fixed inset-0 z-20 bg-black/40 transition-opacity duration-200 sm:hidden " +
          (open ? "opacity-100" : "pointer-events-none opacity-0")
        }
      />
      <aside
        aria-label="World inspector"
        aria-hidden={!open}
        className={
          "fixed z-30 transform border-neutral-900 bg-neutral-950/95 transition-transform duration-200 ease-out " +
          // Mobile (<sm): bottom sheet covering most of the viewport.
          "inset-x-0 bottom-0 h-[88svh] rounded-t-[2rem] border-t shadow-2xl " +
          (open ? "translate-y-0" : "translate-y-full") +
          " " +
          // sm+: slide-over drawer pinned right.
          "sm:inset-y-0 sm:bottom-auto sm:right-0 sm:left-auto sm:h-auto sm:w-[360px] sm:max-w-[90vw] sm:rounded-none sm:border-l sm:border-t-0 sm:shadow-none " +
          (open ? "sm:translate-y-0 sm:translate-x-0" : "sm:translate-y-0 sm:translate-x-full")
        }
      >
        {/* Drag handle, mobile only — visual affordance for the sheet. */}
        <div aria-hidden className="flex justify-center pt-2 sm:hidden">
          <span className="block h-1 w-10 rounded-full bg-neutral-700" />
        </div>
        <div className="border-b border-neutral-900">
          <div className="flex min-h-14 items-center justify-between px-4 py-2">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-400">
              World inspector
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close inspector"
              className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-base text-neutral-400 transition hover:bg-neutral-900 hover:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
            >
              ✕
            </button>
          </div>
          <TabStrip active={tab} onChange={setTab} />
        </div>

        {/* Header plus larger tab strip is about 6rem. Subtract that from
            88svh on mobile and 100% on sm+ so the body scrolls within the
            remaining space. */}
        <div className="h-[calc(88svh-6rem)] overflow-y-auto px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-[13px] text-neutral-300 sm:h-[calc(100%-6rem)] sm:pb-3">
          {loading && !state && <p className="text-neutral-500">Loading…</p>}
          {error && <p className="text-red-400">{error}</p>}
          {state && <InspectorBody state={state} tab={tab} />}
        </div>
      </aside>
    </>
  );
}

function TabStrip({ active, onChange }: { active: InspectorTab; onChange: (t: InspectorTab) => void }) {
  return (
    <div role="tablist" aria-label="Inspector view" className="flex gap-1.5 px-2 pb-2">
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            title={t.description}
            className={
              "min-h-11 flex-1 rounded-full px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 " +
              (isActive
                ? "bg-amber-500/15 text-amber-300"
                : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function InspectorBody({ state, tab }: { state: FullWorldState; tab: InspectorTab }) {
  if (tab === "now") return <NowView state={state} />;
  if (tab === "story") return <StoryView state={state} />;
  return <WikiView state={state} />;
}

function NowView({ state }: { state: FullWorldState }) {
  const activeScene = state.scenes.find((s) => s.id === state.currentSceneId) ?? null;
  const presentCharacters = useMemo(() => {
    if (!activeScene) return state.characters.filter((c) => c.is_player === 1);
    const here = activeScene.place_id;
    return state.characters.filter((c) => c.is_player === 1 || (here != null && c.current_place_id === here));
  }, [activeScene, state.characters]);
  const currentPlace = activeScene
    ? state.places.find((p) => p.id === activeScene.place_id) ?? null
    : null;

  return (
    <div className="space-y-5">
      <section>
        <SectionHeader>Now</SectionHeader>
        <p className="text-neutral-200">{state.worldTime ?? "(time unset)"}</p>
        {activeScene && (
          <p className="mt-0.5 text-neutral-500">
            Scene {activeScene.scene_number} · {activeScene.title}
          </p>
        )}
        {currentPlace && (
          <p className="mt-0.5 text-neutral-500">
            <span className="text-neutral-600">at</span> {currentPlace.name}
          </p>
        )}
      </section>

      <section>
        <SectionHeader>In the scene ({presentCharacters.length})</SectionHeader>
        {presentCharacters.length === 0 ? (
          <p className="text-neutral-500">Just the protagonist.</p>
        ) : (
          <ul className="space-y-2">
            {presentCharacters.map((c) => (
              <CharacterCard key={c.id} character={c} turnTimestamps={state.turnTimestamps} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StoryView({ state }: { state: FullWorldState }) {
  const { dossier } = state;
  const activeQuests = dossier.threads.filter((t) => t.status === "active" && t.kind === "quest");
  const activeThreads = dossier.threads.filter((t) => t.status === "active" && t.kind !== "quest");
  const objectives = dossier.objectives.filter((o) => o.status === "active" || o.status === "blocked");
  const clues = dossier.clues.filter((c) => c.status === "open" || c.status === "interpreted");
  const resources = dossier.resources;
  const empty =
    activeQuests.length === 0 &&
    activeThreads.length === 0 &&
    objectives.length === 0 &&
    clues.length === 0 &&
    resources.length === 0;

  if (empty) {
    return (
      <p className="text-neutral-500">
        No active quests, threads, objectives, clues, or resources yet. The dossier fills out as the world is played.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {activeQuests.length > 0 && (
        <DossierGroup label={`Quests (${activeQuests.length})`}>
          {activeQuests.map((q) => (
            <DossierItem
              key={q.id}
              title={q.title}
              meta={[
                q.stakes ? `stakes: ${q.stakes}` : null,
                q.rewards ? `rewards: ${q.rewards}` : null,
                q.consequences ? `consequences: ${q.consequences}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || null}
            >
              {q.summary}
            </DossierItem>
          ))}
        </DossierGroup>
      )}
      {activeThreads.length > 0 && (
        <DossierGroup label={`Threads (${activeThreads.length})`}>
          {activeThreads.map((t) => (
            <DossierItem
              key={t.id}
              title={t.title}
              meta={[t.kind, t.stakes ? `stakes: ${t.stakes}` : null].filter(Boolean).join(" · ") || null}
            >
              {t.summary}
            </DossierItem>
          ))}
        </DossierGroup>
      )}
      {objectives.length > 0 && (
        <DossierGroup label={`Objectives (${objectives.length})`}>
          {objectives.map((o) => (
            <DossierItem
              key={o.id}
              title={o.title}
              meta={o.status === "blocked" ? `blocked: ${o.blocker ?? "unknown"}` : null}
            >
              {o.detail}
            </DossierItem>
          ))}
        </DossierGroup>
      )}
      {clues.length > 0 && (
        <DossierGroup label={`Clues (${clues.length})`}>
          {clues.map((c) => (
            <DossierItem key={c.id} title={c.title} meta={c.thread_title ?? c.implication}>
              {c.detail}
            </DossierItem>
          ))}
        </DossierGroup>
      )}
      {resources.length > 0 && (
        <DossierGroup label={`Resources (${resources.length})`}>
          {resources.map((r) => (
            <DossierItem
              key={r.id}
              title={r.owner_name ? `${r.owner_name}: ${r.name}` : r.name}
              meta={[r.kind, r.status].filter(Boolean).join(" · ") || null}
            >
              {r.detail}
            </DossierItem>
          ))}
        </DossierGroup>
      )}
    </div>
  );
}

function WikiView({ state }: { state: FullWorldState }) {
  type WikiSubtab = "characters" | "places" | "scenes";
  const [sub, setSub] = useState<WikiSubtab>("characters");
  const sortedScenes = useMemo(
    () => [...state.scenes].sort((a, b) => b.scene_number - a.scene_number),
    [state.scenes],
  );
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Wiki section" className="flex gap-1.5">
        {(["characters", "places", "scenes"] as WikiSubtab[]).map((s) => {
          const count =
            s === "characters"
              ? state.characters.length
              : s === "places"
                ? state.places.length
                : state.scenes.length;
          const isActive = s === sub;
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSub(s)}
              className={
                "min-h-11 flex-1 rounded-full border px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 " +
                (isActive
                  ? "border-neutral-700 bg-neutral-900 text-neutral-100"
                  : "border-neutral-900 bg-neutral-950 text-neutral-500 hover:border-neutral-800 hover:text-neutral-300")
              }
            >
              {s} ({count})
            </button>
          );
        })}
      </div>

      {sub === "characters" && (
        state.characters.length === 0 ? (
          <p className="text-neutral-500">No characters yet.</p>
        ) : (
          <ul className="space-y-2">
            {state.characters.map((c) => (
              <CharacterCard key={c.id} character={c} turnTimestamps={state.turnTimestamps} />
            ))}
          </ul>
        )
      )}

      {sub === "places" && (
        state.places.length === 0 ? (
          <p className="text-neutral-500">No places yet.</p>
        ) : (
          <ul className="space-y-2">
            {state.places.map((p) => (
              <li key={p.id} className="border-l-2 border-neutral-800 pl-2.5">
                <div className="font-medium text-neutral-100">{p.name}</div>
                <TimestampText label="Updated" value={p.updated_at} />
                {p.description && <p className="mt-0.5 text-neutral-400">{p.description}</p>}
              </li>
            ))}
          </ul>
        )
      )}

      {sub === "scenes" && (
        sortedScenes.length === 0 ? (
          <p className="text-neutral-500">No scenes yet.</p>
        ) : (
          <ol className="space-y-2">
            {sortedScenes.map((s) => (
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
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  <TimestampText label="Opened" value={s.created_at} />
                  {s.updated_at !== s.created_at && (
                    <TimestampText label="Updated" value={s.updated_at} />
                  )}
                </div>
                {s.summary && <p className="mt-0.5 text-neutral-400">{s.summary}</p>}
              </li>
            ))}
          </ol>
        )
      )}
    </div>
  );
}

function CharacterCard({
  character: c,
  turnTimestamps,
}: {
  character: FullWorldState["characters"][number];
  turnTimestamps: Record<number, string>;
}) {
  const hasAgencyFields =
    c.is_player !== 1 &&
    (c.personal_goals ||
      c.active_goal ||
      c.current_focus ||
      c.current_attitude ||
      c.recent_activity ||
      c.observations);
  return (
    <li className="border-l-2 border-neutral-800 pl-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-neutral-100">{c.name}</span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-500">
          {c.is_player === 1 ? "player" : c.status}
        </span>
        {c.is_player !== 1 && c.agency_level !== "npc" && (
          <span className="rounded bg-sky-900/40 px-1 text-[10px] uppercase tracking-[0.12em] text-sky-300">
            {c.agency_level}
          </span>
        )}
      </div>
      <TimestampText label="Updated" value={c.updated_at} />
      {c.description && <p className="mt-0.5 text-neutral-400">{c.description}</p>}
      {hasAgencyFields && (
        <dl className="mt-1 space-y-0.5 text-[12px]">
          {c.personal_goals && (
            <CharField label="personal goals" tone="emerald">
              <MultiLine value={c.personal_goals} turnTimestamps={turnTimestamps} />
            </CharField>
          )}
          {c.active_goal && (
            <CharField label="goal" tone="amber">{c.active_goal}</CharField>
          )}
          {c.current_focus && (
            <CharField label="focus" tone="sky">{c.current_focus}</CharField>
          )}
          {c.current_attitude && (
            <CharField label="attitude" tone="amber">{c.current_attitude}</CharField>
          )}
          {c.recent_activity && (
            <CharField label="activity" tone="sky">
              <MultiLine value={c.recent_activity} turnTimestamps={turnTimestamps} />
            </CharField>
          )}
          {c.observations && (
            <CharField label="observed" tone="amber">
              <MultiLine value={c.observations} turnTimestamps={turnTimestamps} />
            </CharField>
          )}
        </dl>
      )}
      {c.memorable_facts && (
        <ul className="mt-1 list-disc pl-4 text-neutral-500">
          {c.memorable_facts
            .split("\n")
            .filter((f) => f.trim().length > 0)
            .map((f, i) => (
              <li key={i}>
                <StateEntryLine value={f} turnTimestamps={turnTimestamps} />
              </li>
            ))}
        </ul>
      )}
    </li>
  );
}

function DossierGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-neutral-600">
        {label}
      </div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

function DossierItem({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string | null;
  children: React.ReactNode;
}) {
  return (
    <li className="border-l-2 border-emerald-900/60 pl-2.5">
      <div className="font-medium text-neutral-100">{title}</div>
      {meta && <div className="text-[11px] text-emerald-400/70">{meta}</div>}
      {children && <p className="mt-0.5 text-neutral-400">{children}</p>}
    </li>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-500">
      {children}
    </h3>
  );
}

type FieldTone = "amber" | "sky" | "emerald";
const TONE_CLASS: Record<FieldTone, string> = {
  amber: "text-amber-500/70",
  sky: "text-sky-400/80",
  emerald: "text-emerald-400/80",
};

function CharField({
  label,
  tone,
  children,
}: {
  label: string;
  tone: FieldTone;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-1.5">
      <dt className={`shrink-0 ${TONE_CLASS[tone]}`}>{label}:</dt>
      <dd className="text-neutral-300">{children}</dd>
    </div>
  );
}

function MultiLine({
  value,
  turnTimestamps,
}: {
  value: string;
  turnTimestamps: Record<number, string>;
}) {
  const lines = value.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 1) {
    return <StateEntryLine value={lines[0]} turnTimestamps={turnTimestamps} />;
  }
  return (
    <ul className="space-y-0.5">
      {lines.map((l, i) => (
        <li key={i}>
          <StateEntryLine value={l} turnTimestamps={turnTimestamps} />
        </li>
      ))}
    </ul>
  );
}

function StateEntryLine({
  value,
  turnTimestamps,
}: {
  value: string;
  turnTimestamps: Record<number, string>;
}) {
  const entry = parseStateEntry(value);
  const timestamp = entry.turnId === null ? undefined : turnTimestamps[entry.turnId];
  return (
    <span>
      {entry.text}
      {timestamp && (
        <time
          dateTime={dateTimeAttr(timestamp)}
          title={formatFullTimestamp(timestamp)}
          className="ml-1.5 whitespace-nowrap text-[10px] text-neutral-600"
        >
          {formatTimestamp(timestamp)}
        </time>
      )}
    </span>
  );
}

function TimestampText({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <time
      dateTime={dateTimeAttr(value)}
      title={formatFullTimestamp(value)}
      className="mt-0.5 block text-[10px] uppercase tracking-[0.12em] text-neutral-600"
    >
      {label} {formatTimestamp(value)}
    </time>
  );
}

function parseStateEntry(value: string): { text: string; turnId: number | null } {
  const match = value.match(/\s*\[t:(\d+)\]\s*$/);
  if (!match) return { text: value, turnId: null };
  return {
    text: value.slice(0, match.index).trimEnd(),
    turnId: Number(match[1]),
  };
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
