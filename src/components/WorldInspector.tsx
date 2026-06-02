"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { organizePlayerProfileFacts, type PlayerProfileGroup } from "@/lib/player-profile";
import type { ReverieRow } from "@/lib/reveries";
import { deriveCharacterBadges, deriveSceneBadge, type BadgeTone, type InspectorBadge } from "@/lib/inspector-badges";
import type { FullWorldState } from "@/lib/world-state";

type InspectorTab = "now" | "story" | "wiki" | "archivist";

const TABS: { id: InspectorTab; label: string; description: string }[] = [
  { id: "now", label: "Now", description: "Current scene, place, present characters" },
  { id: "story", label: "Story", description: "Quests, threads, objectives, clues, resources" },
  { id: "wiki", label: "Wiki", description: "All characters, places, scenes" },
  { id: "archivist", label: "Archivist", description: "Talk to the archivist — corrections and player canon" },
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
  // Local counter the Archivist tab can bump after a correction lands so the
  // other tabs re-fetch FullWorldState and reflect the change. Stays internal
  // so the parent doesn't need to know about correction flow.
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const bumpLocalRefresh = useCallback(() => setLocalRefreshKey((n) => n + 1), []);

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
  }, [open, refreshKey, worldId, localRefreshKey]);

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
          "sm:inset-y-0 sm:right-0 sm:left-auto sm:h-svh sm:w-[360px] sm:max-w-[90vw] sm:rounded-none sm:border-l sm:border-t-0 sm:shadow-none " +
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
        <div
          className={
            "h-[calc(88svh-6rem)] text-[13px] text-neutral-300 sm:h-[calc(100%-6rem)] " +
            (tab === "archivist"
              ? "overflow-hidden"
              : "overflow-y-auto px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:pb-3")
          }
        >
          {loading && !state && <p className="text-neutral-500">Loading…</p>}
          {error && <p className="text-red-400">{error}</p>}
          {state && (
            <InspectorBody
              state={state}
              tab={tab}
              worldId={worldId}
              onCorrectionApplied={bumpLocalRefresh}
            />
          )}
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

function InspectorBody({
  state,
  tab,
  worldId,
  onCorrectionApplied,
}: {
  state: FullWorldState;
  tab: InspectorTab;
  worldId: number;
  onCorrectionApplied: () => void;
}) {
  if (tab === "now") return <NowView state={state} />;
  if (tab === "story") return <StoryView state={state} />;
  if (tab === "archivist")
    return <ArchivistView worldId={worldId} onCorrectionApplied={onCorrectionApplied} />;
  return <WikiView state={state} worldId={worldId} />;
}

function NowView({ state }: { state: FullWorldState }) {
  const activeScene = state.scenes.find((s) => s.id === state.currentSceneId) ?? null;
  const presentCharacters = useMemo(() => {
    if (!activeScene) return state.characters.filter((c) => c.is_player === 1);
    const here = activeScene.place_id;
    return state.characters.filter(
      (c) => c.is_player === 1 || (here != null && c.current_place_id === here),
    );
  }, [activeScene, state.characters]);
  const currentPlace = activeScene
    ? state.places.find((p) => p.id === activeScene.place_id) ?? null
    : null;
  const currentPlaceId = activeScene ? activeScene.place_id : null;
  const { openId, toggle } = useAccordion();

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
          <ul className="space-y-1">
            {presentCharacters.map((c) => {
              const rowId = `now-char-${c.id}`;
              return (
                <CharacterRow
                  key={c.id}
                  rowId={rowId}
                  character={c}
                  places={state.places}
                  currentPlaceId={currentPlaceId}
                  turnTimestamps={state.turnTimestamps}
                  turnNumbers={state.turnNumbers}
                  reveries={state.reveriesByCharacter[c.id] ?? []}
                  open={openId === rowId}
                  onToggle={() => toggle(rowId)}
                />
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// Active story pressure first, quests at the top. Quests were previously a
// separate group from threads, which meant the protagonist's actual objective
// could sit under a "Threads" header while the "Quests" group rendered nothing
// at all — reading as "no quests" even mid-quest. One ordered list, kind shown
// as a tag, keeps every active thread visible in one place.
const THREAD_KIND_RANK: Record<string, number> = {
  quest: 0,
  threat: 1,
  mystery: 2,
  relationship: 3,
  background: 4,
};

function StoryView({ state }: { state: FullWorldState }) {
  const { dossier } = state;
  const threads = dossier.threads
    .filter((t) => t.status === "active")
    .sort((a, b) => (THREAD_KIND_RANK[a.kind] ?? 5) - (THREAD_KIND_RANK[b.kind] ?? 5));
  const objectives = dossier.objectives.filter((o) => o.status === "active" || o.status === "blocked");
  const clues = dossier.clues.filter((c) => c.status === "open" || c.status === "interpreted");
  const resources = dossier.resources;
  const empty =
    threads.length === 0 &&
    objectives.length === 0 &&
    clues.length === 0 &&
    resources.length === 0;

  if (empty) {
    return (
      <p className="text-neutral-500">
        No active threads, objectives, clues, or resources yet. The dossier fills out as the world is played.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {threads.length > 0 && (
        <DossierGroup
          label={`Threads (${threads.length})`}
          items={threads.map((t) => {
            const meta = [
              t.stakes ? `stakes: ${t.stakes}` : null,
              t.rewards ? `rewards: ${t.rewards}` : null,
              t.consequences ? `consequences: ${t.consequences}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return {
              id: `thread-${t.id}`,
              title: t.title,
              tag: t.kind,
              body: (
                <>
                  {meta && <div className="text-[11px] text-emerald-400/70">{meta}</div>}
                  {t.summary && <p className="mt-0.5 text-neutral-400">{t.summary}</p>}
                </>
              ),
            };
          })}
        />
      )}
      {objectives.length > 0 && (
        <DossierGroup
          label={`Objectives (${objectives.length})`}
          items={objectives.map((o) => ({
            id: `obj-${o.id}`,
            title: o.title,
            tag: o.status === "blocked" ? "blocked" : null,
            body: (
              <>
                {o.status === "blocked" && (
                  <div className="text-[11px] text-emerald-400/70">blocked: {o.blocker ?? "unknown"}</div>
                )}
                {o.detail && <p className="mt-0.5 text-neutral-400">{o.detail}</p>}
              </>
            ),
          }))}
        />
      )}
      {clues.length > 0 && (
        <DossierGroup
          label={`Clues (${clues.length})`}
          items={clues.map((c) => {
            const meta = c.thread_title ?? c.implication;
            return {
              id: `clue-${c.id}`,
              title: c.title,
              tag: null,
              body: (
                <>
                  {meta && <div className="text-[11px] text-emerald-400/70">{meta}</div>}
                  {c.detail && <p className="mt-0.5 text-neutral-400">{c.detail}</p>}
                </>
              ),
            };
          })}
        />
      )}
      {resources.length > 0 && (
        <DossierGroup
          label={`Resources (${resources.length})`}
          items={resources.map((r) => ({
            id: `res-${r.id}`,
            title: r.owner_name ? `${r.owner_name}: ${r.name}` : r.name,
            tag: [r.kind, r.status].filter(Boolean).join(" · ") || null,
            body: r.detail ? <p className="text-neutral-400">{r.detail}</p> : null,
          }))}
        />
      )}
    </div>
  );
}

function WikiView({ state, worldId }: { state: FullWorldState; worldId: number }) {
  type WikiSubtab = "characters" | "places" | "scenes";
  const [sub, setSub] = useState<WikiSubtab>("characters");
  const sortedScenes = useMemo(
    () => [...state.scenes].sort((a, b) => b.scene_number - a.scene_number),
    [state.scenes],
  );
  const activeSceneId = useMemo(
    () => sortedScenes.find((s) => s.status === "active")?.id ?? null,
    [sortedScenes],
  );
  // Initial-only by design: useAccordion seeds the open row from the active
  // scene on mount and never resyncs. This is deliberate — the inspector
  // refetches FullWorldState every turn, and resetting open state from data on
  // each refetch (via an effect) would yank a row the user has opened/closed.
  const sceneAccordion = useAccordion(activeSceneId ? `scene-${activeSceneId}` : null);
  const currentPlaceId = useMemo(
    () => state.scenes.find((s) => s.id === state.currentSceneId)?.place_id ?? null,
    [state.scenes, state.currentSceneId],
  );
  const charAccordion = useAccordion();
  const placeAccordion = useAccordion();
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
        <>
          {state.potentialDuplicates.length > 0 && (
            <div className="mb-3 rounded border border-amber-700/50 bg-amber-950/30 p-2 text-xs text-amber-200">
              <p className="font-medium">Potential duplicate characters</p>
              <ul className="mt-1 space-y-1">
                {state.potentialDuplicates.map((d) => (
                  <li key={`${d.aId}-${d.bId}`}>
                    &quot;{d.aName}&quot; (#{d.aId}) ~ &quot;{d.bName}&quot; (#{d.bId}) — {d.reason}
                    <code className="ml-1 block text-amber-300/80">
                      node scripts/merge-characters.mjs --world {worldId} --canonical {d.bId} --dupe {d.aId}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.characters.length === 0 ? (
            <p className="text-neutral-500">No characters yet.</p>
          ) : (
            <ul className="space-y-1">
              {state.characters.map((c) => {
                const rowId = `wiki-char-${c.id}`;
                return (
                  <CharacterRow
                    key={c.id}
                    rowId={rowId}
                    character={c}
                    places={state.places}
                    currentPlaceId={currentPlaceId}
                    turnTimestamps={state.turnTimestamps}
                    turnNumbers={state.turnNumbers}
                    reveries={state.reveriesByCharacter[c.id] ?? []}
                    open={charAccordion.openId === rowId}
                    onToggle={() => charAccordion.toggle(rowId)}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}

      {sub === "places" &&
        (state.places.length === 0 ? (
          <p className="text-neutral-500">No places yet.</p>
        ) : (
          <ul className="space-y-1">
            {state.places.map((p) => (
              <Disclosure
                key={p.id}
                id={`place-${p.id}`}
                open={placeAccordion.openId === `place-${p.id}`}
                onToggle={() => placeAccordion.toggle(`place-${p.id}`)}
                title={<span className="font-medium text-neutral-100">{p.name}</span>}
                badges={
                  p.id === currentPlaceId ? (
                    <BadgeRow badges={[{ label: "current", tone: "active" }]} />
                  ) : null
                }
              >
                <TimestampText label="Updated" value={p.updated_at} />
                {p.description && <p className="mt-0.5 text-neutral-400">{p.description}</p>}
                {p.player_notes && (
                  <div className="mt-1 rounded border border-emerald-900/50 bg-emerald-900/10 px-2 py-1 text-[12px]">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-400/80">
                      Player canon
                    </div>
                    <ul className="mt-0.5 list-disc pl-4 text-neutral-300">
                      {p.player_notes
                        .split("\n")
                        .filter((l) => l.trim().length > 0)
                        .map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                    </ul>
                  </div>
                )}
              </Disclosure>
            ))}
          </ul>
        ))}

      {sub === "scenes" &&
        (sortedScenes.length === 0 ? (
          <p className="text-neutral-500">No scenes yet.</p>
        ) : (
          <ol className="space-y-1">
            {sortedScenes.map((s) => (
              <Disclosure
                key={s.id}
                id={`scene-${s.id}`}
                open={sceneAccordion.openId === `scene-${s.id}`}
                onToggle={() => sceneAccordion.toggle(`scene-${s.id}`)}
                borderClass={s.status === "active" ? "border-amber-500/60" : "border-neutral-800"}
                title={
                  <span className="font-medium text-neutral-100">
                    {s.scene_number}. {s.title}
                  </span>
                }
                badges={<BadgeRow badges={[deriveSceneBadge(s)]} />}
              >
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  <TimestampText label="Opened" value={s.created_at} />
                  {s.updated_at !== s.created_at && <TimestampText label="Updated" value={s.updated_at} />}
                </div>
                {s.summary && <p className="mt-0.5 text-neutral-400">{s.summary}</p>}
              </Disclosure>
            ))}
          </ol>
        ))}
    </div>
  );
}

function CharacterRow({
  character: c,
  places,
  currentPlaceId,
  turnTimestamps,
  turnNumbers,
  reveries,
  rowId,
  open,
  onToggle,
}: {
  character: FullWorldState["characters"][number];
  places: FullWorldState["places"];
  currentPlaceId: number | null;
  turnTimestamps: Record<number, string>;
  turnNumbers: Record<number, number>;
  reveries: ReverieRow[];
  rowId: string;
  open: boolean;
  onToggle: () => void;
}) {
  const badges = deriveCharacterBadges(c, currentPlaceId);
  return (
    <Disclosure
      id={rowId}
      open={open}
      onToggle={onToggle}
      title={<span className="font-medium text-neutral-100">{c.name}</span>}
      badges={<BadgeRow badges={badges} />}
    >
      <CharacterDetail
        character={c}
        places={places}
        turnTimestamps={turnTimestamps}
        turnNumbers={turnNumbers}
        reveries={reveries}
      />
    </Disclosure>
  );
}

function CharacterDetail({
  character: c,
  places,
  turnTimestamps,
  turnNumbers,
  reveries,
}: {
  character: FullWorldState["characters"][number];
  places: FullWorldState["places"];
  turnTimestamps: Record<number, string>;
  turnNumbers: Record<number, number>;
  reveries: ReverieRow[];
}) {
  const currentPlace = c.current_place_id
    ? places.find((p) => p.id === c.current_place_id)?.name
    : null;
  const playerProfileGroups = useMemo(
    () => (c.is_player === 1 ? organizePlayerProfileFacts(c.memorable_facts) : []),
    [c.is_player, c.memorable_facts],
  );
  const hasMindFields =
    c.is_player !== 1 &&
    (c.long_term_agenda ||
      c.relationship_to_player ||
      c.private_beliefs ||
      reveries.length > 0 ||
      c.tool_access);
  const hasNowFields =
    c.is_player !== 1 &&
    (c.personal_goals || c.active_goal || c.current_focus || c.current_attitude);
  const hasHistoryFields = c.is_player !== 1 && (c.recent_activity || c.observations);
  const hasAgencyFields = hasMindFields || hasNowFields || hasHistoryFields;
  return (
    <>
      <TimestampText label="Updated" value={c.updated_at} />
      {currentPlace && (
        <div className="mt-0.5 text-[11px] text-neutral-500">
          <span className="text-neutral-600">at</span> {currentPlace}
        </div>
      )}
      {c.is_player !== 1 && (
        <NpcAgencySummary character={c} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />
      )}
      {c.description && <p className="mt-0.5 text-neutral-400">{c.description}</p>}
      {c.player_notes && (
        <div className="mt-1 rounded border border-emerald-900/50 bg-emerald-900/10 px-2 py-1 text-[12px]">
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-400/80">
            Player canon
          </div>
          <ul className="mt-0.5 list-disc pl-4 text-neutral-300">
            {c.player_notes
              .split("\n")
              .filter((l) => l.trim().length > 0)
              .map((line, i) => (
                <li key={i}>{line}</li>
              ))}
          </ul>
        </div>
      )}
      {hasAgencyFields && (
        <dl className="mt-1.5 space-y-1.5 text-[12px]">
          {hasMindFields && (
            <CharacterStateGroup label="Mind">
              {c.long_term_agenda && (
                <CharField label="agenda" tone="emerald">
                  <MultiLine value={c.long_term_agenda} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />
                </CharField>
              )}
              {c.relationship_to_player && (
                <CharField label="relationship" tone="amber">{c.relationship_to_player}</CharField>
              )}
              {c.private_beliefs && (
                <CharField label="beliefs" tone="sky">
                  <MultiLine value={c.private_beliefs} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />
                </CharField>
              )}
              {reveries.length > 0 && (
                <CharField label="reveries" tone="violet">
                  <ul className="space-y-0.5">
                    {reveries.map((r) => (
                      <li key={r.id}>
                        {r.is_cornerstone ? "★ " : ""}
                        {r.text}
                        {r.match_tags.length > 0 ? (
                          <span className="opacity-60"> · {r.match_tags.join(", ")}</span>
                        ) : null}
                        {r.last_flared_turn_id ? <span className="opacity-60"> · flared</span> : null}
                      </li>
                    ))}
                  </ul>
                </CharField>
              )}
              {c.tool_access && (
                <CharField label="tools" tone="sky">
                  <MultiLine value={c.tool_access} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />
                </CharField>
              )}
            </CharacterStateGroup>
          )}
          {hasNowFields && (
            <CharacterStateGroup label="Now">
              {c.personal_goals && (
                <CharField label="personal goals" tone="emerald">
                  <MultiLine value={c.personal_goals} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />
                </CharField>
              )}
              {c.active_goal && <CharField label="goal" tone="amber">{c.active_goal}</CharField>}
              {c.current_focus && <CharField label="focus" tone="sky">{c.current_focus}</CharField>}
              {c.current_attitude && <CharField label="attitude" tone="amber">{c.current_attitude}</CharField>}
            </CharacterStateGroup>
          )}
          {hasHistoryFields && (
            <CharacterStateGroup label="History">
              {c.recent_activity && (
                <CharField label="activity" tone="sky">
                  <MultiLine value={c.recent_activity} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />
                </CharField>
              )}
              {c.observations && (
                <CharField label="observed" tone="amber">
                  <MultiLine value={c.observations} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />
                </CharField>
              )}
            </CharacterStateGroup>
          )}
        </dl>
      )}
      {c.is_player === 1 && playerProfileGroups.length > 0 && (
        <PlayerProfileGroups groups={playerProfileGroups} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />
      )}
      {c.is_player !== 1 && c.memorable_facts && (
        <StateEntryList
          value={c.memorable_facts}
          turnTimestamps={turnTimestamps}
          turnNumbers={turnNumbers}
          className="mt-1 list-disc pl-4 text-neutral-500"
          collapsedLabel="updates"
        />
      )}
    </>
  );
}

function PlayerProfileGroups({
  groups,
  turnTimestamps,
  turnNumbers,
}: {
  groups: PlayerProfileGroup[];
  turnTimestamps: Record<number, string>;
  turnNumbers: Record<number, number>;
}) {
  return (
    <dl className="mt-1.5 space-y-1.5 text-[12px]">
      {groups.map((group) => (
        <CharacterStateGroup key={group.key} label={group.label}>
          <ul className="space-y-0.5">
            {group.entries.map((entry, i) => (
              <li key={`${group.key}-${i}`} className="text-neutral-300">
                <StateEntryLine value={entry.line} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />
              </li>
            ))}
          </ul>
        </CharacterStateGroup>
      ))}
    </dl>
  );
}

function NpcAgencySummary({
  character: c,
  turnTimestamps,
  turnNumbers,
}: {
  character: FullWorldState["characters"][number];
  turnTimestamps: Record<number, string>;
  turnNumbers: Record<number, number>;
}) {
  const parts = [`seen ${c.appearance_count}x`];
  const lastSeen = turnLabel(c.last_seen_turn_id, turnTimestamps, turnNumbers);
  const lastTick = turnLabel(c.last_agent_tick_turn_id, turnTimestamps, turnNumbers);
  if (lastSeen) parts.push(`last seen ${lastSeen}`);
  if (lastTick) parts.push(`agent tick ${lastTick}`);

  return (
    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-600">
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </div>
  );
}

type DossierEntry = {
  id: string;
  title: string;
  tag: string | null;
  body: React.ReactNode;
};

function DossierGroup({ label, items }: { label: string; items: DossierEntry[] }) {
  const { openId, toggle } = useAccordion();
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-neutral-600">{label}</div>
      <ul className="space-y-1">
        {items.map((it) => (
          <Disclosure
            key={it.id}
            id={it.id}
            open={openId === it.id}
            onToggle={() => toggle(it.id)}
            borderClass="border-emerald-900/60"
            title={<span className="font-medium text-neutral-100">{it.title}</span>}
            badges={it.tag ? <BadgeRow badges={[{ label: it.tag, tone: "muted" }]} /> : null}
          >
            {it.body}
          </Disclosure>
        ))}
      </ul>
    </div>
  );
}

function useAccordion(initial: string | null = null) {
  const [openId, setOpenId] = useState<string | null>(initial);
  const toggle = useCallback((id: string) => {
    setOpenId((cur) => (cur === id ? null : id));
  }, []);
  return { openId, toggle };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden
      className={"shrink-0 text-neutral-500 transition-transform " + (open ? "rotate-90" : "")}
    >
      <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  player: "bg-amber-500/20 text-amber-200",
  danger: "bg-red-900/50 text-red-300",
  muted: "bg-neutral-800 text-neutral-400",
  here: "bg-emerald-900/40 text-emerald-300",
  agency: "bg-sky-900/40 text-sky-300",
  active: "bg-amber-500/20 text-amber-300",
};

function BadgeRow({ badges }: { badges: InspectorBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {badges.map((b) => (
        <span
          key={`${b.tone}-${b.label}`}
          className={
            "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] " +
            BADGE_TONE_CLASS[b.tone]
          }
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}

function Disclosure({
  id,
  open,
  onToggle,
  title,
  badges,
  children,
  borderClass = "border-neutral-800",
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  title: React.ReactNode;
  badges?: React.ReactNode;
  children: React.ReactNode;
  borderClass?: string;
}) {
  const bodyId = `disc-${id}`;
  return (
    <li className={"border-l-2 " + borderClass}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="flex w-full min-h-11 items-center gap-2 py-1.5 pl-2.5 pr-1 text-left transition hover:bg-neutral-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1">{title}</span>
        {badges}
      </button>
      {open && (
        <div id={bodyId} className="pb-2 pl-2.5">
          {children}
        </div>
      )}
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

type FieldTone = "amber" | "sky" | "emerald" | "violet";
const TONE_CLASS: Record<FieldTone, string> = {
  amber: "text-amber-500/70",
  sky: "text-sky-400/80",
  emerald: "text-emerald-400/80",
  violet: "text-violet-400/80",
};

function CharacterStateGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-l border-neutral-800/80 pl-2">
      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-neutral-600">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

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
      <dd className="min-w-0 break-words text-neutral-300">{children}</dd>
    </div>
  );
}

function turnLabel(
  turnId: number | null | undefined,
  turnTimestamps: Record<number, string>,
  turnNumbers: Record<number, number>,
): string | null {
  if (!turnId) return null;
  const turnNo = turnNumbers[turnId];
  const timestamp = turnTimestamps[turnId];
  const date = timestamp ? formatTimestamp(timestamp) : null;
  if (turnNo) return date ? `#${turnNo} ${date}` : `#${turnNo}`;
  return date ?? `#${turnId}`;
}

function MultiLine({
  value,
  turnTimestamps,
  turnNumbers,
}: {
  value: string;
  turnTimestamps: Record<number, string>;
  turnNumbers: Record<number, number>;
}) {
  const lines = value.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 1) {
    return <StateEntryLine value={lines[0]} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />;
  }
  return <StateEntryList value={value} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />;
}

function StateEntryList({
  value,
  turnTimestamps,
  turnNumbers,
  className = "space-y-0.5",
  collapsedLabel = "entries",
  initialVisible = 5,
}: {
  value: string;
  turnTimestamps: Record<number, string>;
  turnNumbers: Record<number, number>;
  className?: string;
  collapsedLabel?: string;
  initialVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = value.split("\n").filter((l) => l.trim().length > 0);
  const hiddenCount = Math.max(0, lines.length - initialVisible);
  const visibleLines = expanded || hiddenCount === 0 ? lines : lines.slice(-initialVisible);

  return (
    <div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mb-1 inline-flex min-h-7 items-center rounded-full border border-neutral-800 bg-neutral-950/60 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500 transition hover:border-neutral-700 hover:text-neutral-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
        >
          {expanded ? "Show recent only" : `Show ${hiddenCount} older ${collapsedLabel}`}
        </button>
      )}
      <ul className={className}>
        {visibleLines.map((l, i) => (
          <li key={`${expanded ? "all" : "recent"}-${i}`}>
            <StateEntryLine value={l} turnTimestamps={turnTimestamps} turnNumbers={turnNumbers} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StateEntryLine({
  value,
  turnTimestamps,
  turnNumbers,
}: {
  value: string;
  turnTimestamps: Record<number, string>;
  turnNumbers: Record<number, number>;
}) {
  const entry = parseStateEntry(value);
  const timestamp = entry.turnId === null ? undefined : turnTimestamps[entry.turnId];
  const turnNo = entry.turnId === null ? undefined : turnNumbers[entry.turnId];
  return (
    <span>
      {entry.text}
      {turnNo && (
        <span className="ml-1.5 whitespace-nowrap text-[10px] text-neutral-500">
          #{turnNo}
        </span>
      )}
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

// v0.6.6 — conversational channel between the player and the archivist. Stays
// inside the inspector so it never appears in the narration chat. Scrollback
// is server-backed (world_corrections) so it survives reloads. On successful
// send, calls onCorrectionApplied so the parent re-fetches FullWorldState and
// the Wiki tab shows the new player_notes.
type Correction = {
  id: number;
  turnId: number | null;
  playerText: string;
  archivistReply: string;
  createdAt: string;
};

function ArchivistView({
  worldId,
  onCorrectionApplied,
}: {
  worldId: number;
  onCorrectionApplied: () => void;
}) {
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Fetch the scrollback on mount and on worldId change. No refreshKey
  // dependency needed — local mutations append directly and successful sends
  // skip the round-trip.
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/world-corrections?worldId=${worldId}`, {
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        if (!res.ok) {
          setError(`Scrollback unavailable (${res.status})`);
          return;
        }
        const data = (await res.json()) as { corrections: Correction[] };
        if (ctrl.signal.aborted) return;
        setCorrections(data.corrections);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(String(err));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [worldId]);

  // Auto-scroll to the bottom whenever the scrollback grows, so the newest
  // exchange is always in view without the user reaching for the scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [corrections.length]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/world-correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldId, text: trimmed }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setSendError(body || `Correction failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as {
        id: number;
        reply: string;
        appliedPatch: unknown;
        createdAt: string;
      };
      setCorrections((prev) => [
        ...prev,
        {
          id: data.id,
          turnId: null,
          playerText: trimmed,
          archivistReply: data.reply,
          createdAt: data.createdAt,
        },
      ]);
      setText("");
      onCorrectionApplied();
    } catch (err) {
      setSendError(String(err));
    } finally {
      setSending(false);
    }
  }, [worldId, text, sending, onCorrectionApplied]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // ⌘/Ctrl+Enter submits; plain Enter inserts a newline (default).
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  const isEmpty = corrections.length === 0 && !loading && !error;

  return (
    <div className="h-full overflow-y-auto px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:pb-4">
      <div
        ref={scrollRef}
        className={
          isEmpty
            ? "pb-6 pt-6 sm:pt-4"
            : "max-h-[42svh] overflow-y-auto pb-5 pr-1 sm:max-h-[48svh]"
        }
      >
        {loading && <p className="text-neutral-500">Loading scrollback...</p>}
        {error && <p className="text-red-400">{error}</p>}
        {isEmpty && (
          <div className="flex min-h-24 items-center justify-center">
            <p className="max-w-56 text-center font-serif text-[15px] italic leading-relaxed text-neutral-500">
              The archive is quiet.
            </p>
          </div>
        )}
        {corrections.length > 0 && (
          <ol className="space-y-5">
            {corrections.map((c) => (
              <li key={c.id} className="space-y-1">
                <div className="flex flex-col items-end">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-600">
                    You
                  </div>
                  <div className="max-w-[92%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-[#1f2024] px-3.5 py-2.5 text-[13px] leading-relaxed text-neutral-100">
                    {c.playerText}
                  </div>
                </div>
                <div className="border-l-2 border-emerald-500/40 pl-3">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-400/80">
                      Archivist
                    </span>
                    <TimestampText label="At" value={c.createdAt} />
                  </div>
                  <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-200">
                    {c.archivistReply}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <label htmlFor="archivist-composer" className="sr-only">
          Message to the archivist
        </label>
        <div className="rounded-[1.5rem] border border-neutral-800 bg-neutral-900/90 px-3 py-2 shadow-2xl shadow-black/30 focus-within:border-amber-500/50 focus-within:ring-1 focus-within:ring-amber-500/30">
          <textarea
            id="archivist-composer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={2000}
            disabled={sending}
            placeholder="Message the archivist"
            className="max-h-32 min-h-12 w-full resize-none bg-transparent text-base leading-relaxed text-neutral-100 placeholder:text-neutral-500 focus:outline-none disabled:opacity-60"
          />
          <div className="flex min-h-11 items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending || !text.trim()}
              aria-label="Send to archivist"
              title="Send"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-amber-500 text-neutral-950 shadow-lg shadow-amber-950/30 transition hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-600 disabled:shadow-none"
            >
              {sending ? <BusyDots /> : <SendArrowIcon />}
            </button>
          </div>
        </div>
        {sendError && <p className="text-[11px] text-red-400">{sendError}</p>}
      </div>
    </div>
  );
}

function SendArrowIcon() {
  return (
    <svg
      width="18"
      height="18"
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

function BusyDots() {
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
    </span>
  );
}
