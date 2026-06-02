# State Inspector Collapsible Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse every World Inspector entity (Wiki + Now + Story) into accordion disclosure rows that show at-a-glance status badges and expand on press.

**Architecture:** A single controlled `<Disclosure>` primitive renders a button header (chevron + title + badges) and a body shown only when open. Each list owns one `openId` (accordion). Badge *logic* lives in a new pure module `src/lib/inspector-badges.ts` (unit-tested); rendering stays in `WorldInspector.tsx`. No data/API changes — purely presentational over the existing `FullWorldState`.

**Tech Stack:** Next.js 15 + React (client component), TypeScript, Tailwind, Vitest.

---

## File Structure

- **Create** `src/lib/inspector-badges.ts` — pure `deriveCharacterBadges` / `deriveSceneBadge` + `InspectorBadge` / `BadgeTone` types. One responsibility: map entity state → ordered badge descriptors.
- **Create** `tests/inspector-badges.test.ts` — unit tests for the above.
- **Modify** `src/components/WorldInspector.tsx` — add `Disclosure`, `Chevron`, `BadgeRow`, `BADGE_TONE_CLASS`, `useAccordion`; refactor `NowView`, `WikiView`, `StoryView`, `DossierGroup`; replace `CharacterCard` with `CharacterRow` + `CharacterDetail`; remove `DossierItem`.

Reference (current line anchors in `WorldInspector.tsx`): `NowView` 192–241, `StoryView` 256–337, `WikiView` 339–479, `CharacterCard` 481–642, `DossierGroup` 694–709, `DossierItem` 711–727.

---

## Task 1: Badge derivation module (pure, TDD)

**Files:**
- Create: `src/lib/inspector-badges.ts`
- Test: `tests/inspector-badges.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/inspector-badges.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { deriveCharacterBadges, deriveSceneBadge } from '@/lib/inspector-badges'

const baseChar = {
  is_player: 0 as number,
  status: 'active' as 'active' | 'inactive' | 'dead',
  agency_level: 'npc' as 'npc' | 'local' | 'nearby' | 'distant' | 'dormant',
  current_place_id: null as number | null,
}

describe('deriveCharacterBadges', () => {
  it('returns no badge for a plain active npc', () => {
    expect(deriveCharacterBadges(baseChar, null)).toEqual([])
  })

  it('flags inactive and dead via life status', () => {
    expect(deriveCharacterBadges({ ...baseChar, status: 'inactive' }, null)).toEqual([
      { label: 'inactive', tone: 'muted' },
    ])
    expect(deriveCharacterBadges({ ...baseChar, status: 'dead' }, null)).toEqual([
      { label: 'dead', tone: 'danger' },
    ])
  })

  it('flags presence only when in the current place', () => {
    expect(deriveCharacterBadges({ ...baseChar, current_place_id: 7 }, 7)).toEqual([
      { label: 'here', tone: 'here' },
    ])
    expect(deriveCharacterBadges({ ...baseChar, current_place_id: 7 }, 9)).toEqual([])
    expect(deriveCharacterBadges({ ...baseChar, current_place_id: 7 }, null)).toEqual([])
  })

  it('shows agency level for non-npc, hides plain npc', () => {
    expect(deriveCharacterBadges({ ...baseChar, agency_level: 'dormant' }, null)).toEqual([
      { label: 'dormant', tone: 'agency' },
    ])
    expect(deriveCharacterBadges({ ...baseChar, agency_level: 'npc' }, null)).toEqual([])
  })

  it('marks the player and never shows their agency', () => {
    expect(deriveCharacterBadges({ ...baseChar, is_player: 1, agency_level: 'local' }, null)).toEqual([
      { label: 'you', tone: 'player' },
    ])
  })

  it('orders badges player, life, presence, agency', () => {
    expect(
      deriveCharacterBadges(
        { is_player: 0, status: 'dead', agency_level: 'nearby', current_place_id: 3 },
        3,
      ),
    ).toEqual([
      { label: 'dead', tone: 'danger' },
      { label: 'here', tone: 'here' },
      { label: 'nearby', tone: 'agency' },
    ])
  })
})

describe('deriveSceneBadge', () => {
  it('maps scene status to active/done', () => {
    expect(deriveSceneBadge({ status: 'active' })).toEqual({ label: 'active', tone: 'active' })
    expect(deriveSceneBadge({ status: 'completed' })).toEqual({ label: 'done', tone: 'muted' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/inspector-badges.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/inspector-badges"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/inspector-badges.ts`:

```ts
import type { Character, Scene } from '@/lib/world-state'

export type BadgeTone = 'player' | 'danger' | 'muted' | 'here' | 'agency' | 'active'

export interface InspectorBadge {
  label: string
  tone: BadgeTone
}

/**
 * At-a-glance badges for a character's collapsed row, in fixed order:
 * player marker, life status (dead/inactive; active shows nothing), presence
 * (in the current place), agency level (npc shows nothing).
 */
export function deriveCharacterBadges(
  c: Pick<Character, 'is_player' | 'status' | 'agency_level' | 'current_place_id'>,
  currentPlaceId: number | null,
): InspectorBadge[] {
  const badges: InspectorBadge[] = []
  if (c.is_player === 1) badges.push({ label: 'you', tone: 'player' })
  if (c.status === 'dead') badges.push({ label: 'dead', tone: 'danger' })
  else if (c.status === 'inactive') badges.push({ label: 'inactive', tone: 'muted' })
  if (currentPlaceId !== null && c.current_place_id === currentPlaceId) {
    badges.push({ label: 'here', tone: 'here' })
  }
  if (c.is_player !== 1 && c.agency_level !== 'npc') {
    badges.push({ label: c.agency_level, tone: 'agency' })
  }
  return badges
}

export function deriveSceneBadge(s: Pick<Scene, 'status'>): InspectorBadge {
  return s.status === 'active'
    ? { label: 'active', tone: 'active' }
    : { label: 'done', tone: 'muted' }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/inspector-badges.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/inspector-badges.ts tests/inspector-badges.test.ts
git commit -m "feat(inspector): pure badge-derivation helpers + tests"
```

---

## Task 2: Disclosure primitive + accordion hook, wired into the Scenes list

**Files:**
- Modify: `src/components/WorldInspector.tsx`

- [ ] **Step 1: Add the import**

At the top of `src/components/WorldInspector.tsx`, below the existing `import type { ReverieRow }` line, add:

```ts
import { deriveCharacterBadges, deriveSceneBadge, type BadgeTone, type InspectorBadge } from "@/lib/inspector-badges";
```

- [ ] **Step 2: Add the primitives**

Insert these definitions just above `function SectionHeader(` (currently ~line 729):

```tsx
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
          key={b.label}
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
```

- [ ] **Step 3: Rewrite the Scenes branch of `WikiView`**

In `WikiView`, replace the entire `{sub === "scenes" && ( ... )}` block (currently ~lines 444–476) with:

```tsx
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
```

- [ ] **Step 4: Add the scenes accordion state to `WikiView`**

Inside `WikiView`, immediately after the `sortedScenes` `useMemo` (currently ~line 345), add:

```tsx
  const activeSceneId = useMemo(
    () => sortedScenes.find((s) => s.status === "active")?.id ?? null,
    [sortedScenes],
  );
  const sceneAccordion = useAccordion(activeSceneId ? `scene-${activeSceneId}` : null);
```

- [ ] **Step 5: Verify type-check and lint pass**

Run: `npm run type-check`
Expected: no errors.
Run: `npm run lint`
Expected: no errors. (If lint flags `deriveCharacterBadges` as unused, that is expected — it is consumed in Task 3. If the lint config errors on unused imports, proceed to Task 3 before the final lint gate; otherwise it passes.)

- [ ] **Step 6: Commit**

```bash
git add src/components/WorldInspector.tsx
git commit -m "feat(inspector): Disclosure primitive + accordion, applied to Scenes"
```

---

## Task 3: CharacterRow + CharacterDetail, wired into the Wiki Characters list

**Files:**
- Modify: `src/components/WorldInspector.tsx`

- [ ] **Step 1: Replace `CharacterCard` with `CharacterRow` + `CharacterDetail`**

Delete the entire `CharacterCard` function (currently lines 481–642) and replace it with:

```tsx
function CharacterRow({
  character: c,
  places,
  currentPlaceId,
  turnTimestamps,
  turnNumbers,
  reveries,
  open,
  onToggle,
}: {
  character: FullWorldState["characters"][number];
  places: FullWorldState["places"];
  currentPlaceId: number | null;
  turnTimestamps: Record<number, string>;
  turnNumbers: Record<number, number>;
  reveries: ReverieRow[];
  open: boolean;
  onToggle: () => void;
}) {
  const badges = deriveCharacterBadges(c, currentPlaceId);
  return (
    <Disclosure
      id={`char-${c.id}`}
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
```

- [ ] **Step 2: Add `currentPlaceId` + characters accordion to `WikiView`**

Inside `WikiView`, after the `activeSceneId` / `sceneAccordion` lines added in Task 2, add:

```tsx
  const currentPlaceId = useMemo(
    () => state.scenes.find((s) => s.id === state.currentSceneId)?.place_id ?? null,
    [state.scenes, state.currentSceneId],
  );
  const charAccordion = useAccordion();
```

- [ ] **Step 3: Rewrite the Characters list in `WikiView`**

Replace the characters list (the `state.characters.length === 0 ? ... : ( <ul> ... </ul> )` block inside `{sub === "characters" && (...)}`, currently ~lines 394–409) with:

```tsx
          {state.characters.length === 0 ? (
            <p className="text-neutral-500">No characters yet.</p>
          ) : (
            <ul className="space-y-1">
              {state.characters.map((c) => (
                <CharacterRow
                  key={c.id}
                  character={c}
                  places={state.places}
                  currentPlaceId={currentPlaceId}
                  turnTimestamps={state.turnTimestamps}
                  turnNumbers={state.turnNumbers}
                  reveries={state.reveriesByCharacter[c.id] ?? []}
                  open={charAccordion.openId === `char-${c.id}`}
                  onToggle={() => charAccordion.toggle(`char-${c.id}`)}
                />
              ))}
            </ul>
          )}
```

- [ ] **Step 4: Verify type-check and lint pass**

Run: `npm run type-check`
Expected: no errors.
Run: `npm run lint`
Expected: no errors. (`NowView` still references `CharacterCard`? No — `NowView` is fixed in Task 4. `CharacterCard` is now gone, so `NowView` will fail type-check here.) **Therefore complete Task 4 before running the gate, or temporarily expect the `NowView` reference error and resolve it in Task 4.**

- [ ] **Step 5: Commit**

```bash
git add src/components/WorldInspector.tsx
git commit -m "feat(inspector): split CharacterCard into CharacterRow + CharacterDetail; collapse Wiki characters"
```

---

## Task 4: Collapse the Now tab present-character cards

**Files:**
- Modify: `src/components/WorldInspector.tsx`

- [ ] **Step 1: Rewrite `NowView`**

Replace the entire `NowView` function (currently lines 192–241) with:

```tsx
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
            {presentCharacters.map((c) => (
              <CharacterRow
                key={c.id}
                character={c}
                places={state.places}
                currentPlaceId={currentPlaceId}
                turnTimestamps={state.turnTimestamps}
                turnNumbers={state.turnNumbers}
                reveries={state.reveriesByCharacter[c.id] ?? []}
                open={openId === `char-${c.id}`}
                onToggle={() => toggle(`char-${c.id}`)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify type-check and lint pass**

Run: `npm run type-check`
Expected: no errors.
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/WorldInspector.tsx
git commit -m "feat(inspector): collapse Now-tab present characters into accordion rows"
```

---

## Task 5: Collapse the Wiki Places list

**Files:**
- Modify: `src/components/WorldInspector.tsx`

- [ ] **Step 1: Add the places accordion to `WikiView`**

Inside `WikiView`, after `const charAccordion = useAccordion();` (added in Task 3), add:

```tsx
  const placeAccordion = useAccordion();
```

- [ ] **Step 2: Rewrite the Places branch of `WikiView`**

Replace the entire `{sub === "places" && ( ... )}` block (currently ~lines 413–442) with:

```tsx
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
```

- [ ] **Step 3: Verify type-check and lint pass**

Run: `npm run type-check`
Expected: no errors.
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/WorldInspector.tsx
git commit -m "feat(inspector): collapse Wiki places into accordion rows with current badge"
```

---

## Task 6: Collapse the Story dossier groups

**Files:**
- Modify: `src/components/WorldInspector.tsx`

- [ ] **Step 1: Replace `DossierGroup` and remove `DossierItem`**

Delete the `DossierGroup` function (currently lines 694–709) and the `DossierItem` function (currently lines 711–727), and in their place add:

```tsx
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
```

- [ ] **Step 2: Rewrite the `StoryView` return body**

In `StoryView`, replace the final `return ( <div className="space-y-4"> ... </div> )` (the non-empty branch, currently ~lines 278–335) with:

```tsx
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
```

- [ ] **Step 3: Verify type-check and lint pass**

Run: `npm run type-check`
Expected: no errors.
Run: `npm run lint`
Expected: no errors (no remaining references to `DossierItem`).

- [ ] **Step 4: Commit**

```bash
git add src/components/WorldInspector.tsx
git commit -m "feat(inspector): collapse Story dossier groups into per-group accordions"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check, lint, and test**

Run: `npm run type-check` — Expected: no errors.
Run: `npm run lint` — Expected: no errors.
Run: `npm test` — Expected: all suites pass, including `tests/inspector-badges.test.ts`.

- [ ] **Step 2: Browser verification (required — a UI change is not done until seen live)**

Run: `npm run dev`, open a world with several characters/scenes, open the inspector, and confirm:
- **Now:** present characters are collapsed rows; the `you` badge shows on the protagonist; `here` shows for present NPCs; tapping one opens it and closes any other.
- **Story:** threads/objectives/clues/resources are collapsed with their tag; opening one in a group closes its sibling; groups are independent.
- **Wiki → Characters:** collapsed rows; `dead`/`inactive`/agency badges render correctly; accordion is one-at-a-time.
- **Wiki → Places:** collapsed rows; the current place shows the `current` badge.
- **Wiki → Scenes:** the active scene starts open and shows `active`; others show `done`.
- **Refresh stability:** open a row, take a turn in the chat, and confirm the row stays in the same open/closed state after the drawer refetches.

- [ ] **Step 3: Confirm done**

All gates green and the browser checklist passes.

---

## Self-Review Notes

- **Spec coverage:** Disclosure primitive (Task 2) ✓; per-list accordion (Tasks 2–6) ✓; initial-only default-open for active scene (Task 2 Step 4 via `useAccordion` initializer) ✓; `inspector-badges.ts` pure helpers + tests (Task 1) ✓; character badges player/life/presence/agency (Task 1 + Task 3) ✓; scene badge (Task 1 + Task 2) ✓; place `current` badge (Task 5) ✓; dossier rows (Task 6) ✓; collapsed vs expanded content (Tasks 3–6) ✓; no data/API changes ✓; browser + unit verification (Task 7) ✓.
- **Type consistency:** `useAccordion` returns `{ openId, toggle }` and is consumed identically everywhere; `Disclosure` props (`id, open, onToggle, title, badges, children, borderClass`) match every call site; `InspectorBadge`/`BadgeTone` from Task 1 match `BADGE_TONE_CLASS` keys (player, danger, muted, here, agency, active) in Task 2; row id conventions are stable (`char-`, `scene-`, `place-`, `thread-`, `obj-`, `clue-`, `res-`).
- **Ordering caveat:** Tasks 3 and 4 are a pair — `CharacterCard` is removed in Task 3 and its last consumer (`NowView`) is migrated in Task 4, so the clean lint/type gate is reached at the end of Task 4. This is called out in Task 3 Step 4.
