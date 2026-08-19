// Narrator-markdown renderers (P4, spec §5.1-P4 item 5). These turn structured
// world-state values into the narrator's prompt markdown dialect. This is a
// RENDERING concern, not domain: the domain emits structured values
// (NarratorWorldState, StoryDossier); turning them into a prompt string lives
// here in the server/render layer. Extracted verbatim from lib/world-state.ts
// (no behavior change); world-state.ts re-exports for back-compat.
import 'server-only'

import type {
  Character,
  Place,
  ResolvedOutcome,
  Scene,
  StoryDossier,
  StoryThread,
} from '@/domain/entities'
import {
  CLOSED_DOSSIER_CAPS,
  selectRecentlyClosedObjectives,
  selectRecentlyClosedThreads,
} from '@/domain/services/closed-dossier'
import type { DirectorDecision } from '@/domain/services/director'
import { isBindingOutcome } from '@/domain/services/outcome-resolution'
import {
  buildPerceptionPin,
  type PerceptionPin,
} from '@/domain/services/perception-pin'
import {
  pickPrimaryPressure,
  rankClues,
  rankObjectives,
  rankQuests,
  rankResources,
  rankThreads,
  rankTimeline,
  type RankingContext,
} from '@/domain/services/dossier-ranking'
import {
  selectPinnedMemorableFacts,
  stripFactProvenance,
} from '@/domain/services/memorable-fact-provenance'
import { minutesToWorldTime, tryParseWorldTime } from '@/domain/services/narrative-clock'
import { activityForBand, parseDailyLoop } from '@/lib/daily-loop'
import { type PlaceOccupancy } from '@/lib/place-population'
import { type ReverieRow } from '@/lib/reveries'
import type { NarratorWorldState } from '@/lib/world-state'
import { worldTimeBand } from '@/lib/world-time'

// v0.6.9 — plans carry an `intent_id` so the post-narrator reconciler can
// match the narrator prose back to the durable npc_intents row. The narrator
// prompt is forbidden from putting intent IDs on the page (mechanics talk);
// they exist only as a routing key.
export type NpcPlannedAction = {
  npc_name: string
  intent: string
  planned_action?: string
  intent_id?: number
  /** Ephemeral delivery staging edge — not durable intent ledger. */
  speech_hint?: string | null
}

export type ReverieRenderContext = {
  byCharacter: Map<number, ReverieRow[]>
  flaring: Set<number>
}

/** Optional open-order STATUS lines rendered into STATE (facts only — S2). */
export type OpenOrderRenderContext = {
  /** e.g. "Andy Osborne — still at Administrative Wing" */
  statusLines: string[]
  kind?: string
  targetName?: string
}

/** Optional private-channel audience pin rendered into STATE (facts only). */
export type PrivateUtteranceRenderContext = {
  channel: string
  /** Display names of characters allowed to know the private content. */
  audienceNames: string[]
}

export function formatStateBlock(
  state: NarratorWorldState,
  plannedActions: NpcPlannedAction[] = [],
  recentNarratorProse: string[] = [],
  reveryCtx: ReverieRenderContext = { byCharacter: new Map(), flaring: new Set() },
  openOrderCtx: OpenOrderRenderContext | null = null,
  privateUtteranceCtx: PrivateUtteranceRenderContext | null = null,
): string {
  const lines: string[] = [
    '## STATE',
    'Listed facts are fixed. Unlisted small, genre-consistent details are open canvas.',
    'The Place line is the protagonist\'s physical location; hold it unless the player or world physically moves them.',
    'The Time line is the authoritative world clock; ordinary watches, phones, computers, and clocks display it unless state says otherwise.',
    `- Time: ${state.worldTime ?? '(unset)'}`,
  ]

  if (state.currentScene) {
    lines.push(`- Scene: ${state.currentScene.title} (scene ${state.currentScene.scene_number})`)
    const pacing = formatScenePacing(state.currentScene)
    if (pacing) lines.push(`  - pacing: ${pacing}`)
  }
  // v0.6.10 belt-and-suspenders: if the active scene's place disagrees with
  // recent prose (the last 2 narrator turns clearly depicted travel/arrival to
  // a different named place), omit the Place line rather than assert a stale
  // anchor. The narrator reads location from recent prose well; a wrong
  // authoritative Place line is what produced the Call-In snap-back. This is a
  // thin fallback — the archivist invariant fixing the cursor early is the
  // primary fix; this only catches transitions the invariant cannot (e.g. an
  // unpopulated destination with no NPC cluster to vote on).
  const placeContradicted =
    state.currentPlace !== null &&
    recentProseDepictsTravelElsewhere(recentNarratorProse, state.currentPlace, state.knownPlaces)
  if (state.currentPlace && !placeContradicted) {
    lines.push(`- Place: ${state.currentPlace.name}`)
    if (state.currentPlace.description) {
      lines.push(`  ${state.currentPlace.description}`)
    }
    const geo = formatPlaceGeo(state.currentPlace)
    if (geo) {
      lines.push(`  - real-world geo: ${geo}`)
    }
  }

  if (state.presentCharacters.length > 0) {
    lines.push('', '### Present')
    for (const c of state.presentCharacters) {
      const role = c.is_player === 1 ? 'player' : c.status
      lines.push(`- ${c.name} (${role})${c.description ? ` — ${limit(c.description, 180)}` : ''}`)
      if (c.is_player === 1) {
        if (c.status !== 'active') lines.push(`  - status: ${c.status}`)
        // Single protagonist identity pin — narrator and archivist must not invent
        // a second PC name (Andy vs Joseph Osborne class of bug).
        lines.push(
          `  - canonical name: ${c.name} (use this; never invent another PC name)`,
        )
        if (c.aliases) {
          const aka = c.aliases
            .split(/[\n,;]/)
            .map((a) => a.trim())
            .filter(Boolean)
            .slice(0, 4)
          if (aka.length > 0) {
            lines.push(`  - also known as: ${aka.join(', ')}`)
          }
        }
        lines.push('  - continuity: this row is the protagonist; preserve location, carried items, injuries, notable discoveries, obligations, and relationship facts unless narration clearly changes them.')
        // A4: pinned CARRIED / TRACKED OBJECTS — the authoritative possession
        // ledger for the protagonist. Rendered as flat `name — status` lines (not
        // paraphrased prose) so the narrator honours what the player holds and a
        // stale "NPC still has X" fact cannot override it.
        const carried = state.dossier.resources.filter((r) => r.held_by_character_id === c.id)
        if (carried.length > 0) {
          lines.push('  - CARRIED / TRACKED OBJECTS (authoritative — the protagonist holds these now):')
          for (const r of carried.slice(0, 10)) {
            const status = [r.kind, r.status].filter(Boolean).join(', ')
            lines.push(`    - ${r.name}${status ? ` — ${status}` : ''}`)
          }
        }
      }
      const facts = stripFactProvenance(c.memorable_facts)
      if (facts) {
        const anchors =
          c.is_player === 1
            ? [
                ...state.dossier.objectives
                  .filter((o) => o.status === 'completed')
                  .map((o) => `${o.title} ${o.detail ?? ''}`),
                ...state.dossier.clues
                  .filter((cl) => cl.status === 'interpreted')
                  .map((cl) => `${cl.title} ${cl.detail ?? ''}`),
              ]
            : []
        const factLines = selectPinnedMemorableFacts(facts, anchors)
        for (const fact of factLines) {
          lines.push(`  - ${fact}`)
        }
      }
      // NPC-only social/agency fields, in order of arc-width: personal_goals
      // (long arc) → focus (current preoccupation) → active_goal (scene-
      // immediate) → attitude (right now) → recent_activity (off-scene
      // gap-fill) → behavior cue (what they've noticed about the protagonist).
      // Each is omitted when null to keep state-block tokens bounded.
      if (c.is_player !== 1) {
        // Salient objects this NPC physically carries (authoritative). Pinned so
        // the narrator honours who holds a tracked weapon/key/evidence and does
        // not invent the NPC reaching for something they don't have. Capped at 2.
        const npcHeld = state.dossier.resources.filter(
          (r) => r.held_by_character_id === c.id && r.salient === 1,
        )
        if (npcHeld.length > 0) {
          const items = npcHeld
            .slice(0, 2)
            .map((r) => r.name)
            .join(', ')
          lines.push(`  - carries (authoritative): ${items}`)
        }
        if (c.personal_goals) {
          const goals = c.personal_goals.split('\n').filter((s) => s.trim().length > 0)
          if (goals.length === 1) {
            lines.push(`  - personal goal: ${limit(goals[0], 160)}`)
          } else {
            lines.push('  - personal goals:')
            for (const g of goals.slice(0, 3)) lines.push(`    - ${limit(g, 160)}`)
          }
        }
        if (c.long_term_agenda) {
          const agenda = c.long_term_agenda.split('\n').filter((s) => s.trim().length > 0)
          if (agenda.length === 1) {
            lines.push(`  - agenda: ${limit(agenda[0], 160)}`)
          } else {
            lines.push('  - agenda:')
            for (const item of agenda.slice(0, 3)) lines.push(`    - ${limit(item, 160)}`)
          }
        }
        if (c.relationship_to_player) {
          lines.push(`  - relationship to protagonist: ${limit(c.relationship_to_player, 180)}`)
        }
        // v0.6.19 (A2): surface at most one private belief, explicitly scoped to
        // this NPC, so the narrator does not let other NPCs act on it. Reducing
        // the broadcast also cuts state-block tokens.
        if (c.private_beliefs) {
          const beliefs = c.private_beliefs.split('\n').filter((s) => s.trim().length > 0)
          if (beliefs.length > 0) {
            lines.push(
              `  - private read (known only to ${c.name}; never let another NPC act on it): ${limit(beliefs[0], 170)}`,
            )
          }
        }
        const reveryRows = reveryCtx.byCharacter.get(c.id) ?? []
        const flaring = reveryRows.filter((r) => reveryCtx.flaring.has(r.id))
        const ambient = reveryRows.filter((r) => !reveryCtx.flaring.has(r.id))
        // v0.6.x: never put the word "reverie" or the raw memory on the page.
        // These are private inner-life pressure for the NPC; the labels are
        // framed as do-not-state directives and avoid the token "reverie"
        // entirely, so the narrator can't parrot it into prose (the leak this
        // fixes). The memory text stays as context so the narrator can render
        // its *effect* as behavior — never as exposition.
        for (const r of flaring) {
          lines.push(
            `  - ⚡ FLARING SUBTEXT (private; render ONLY as a physical tell, hesitation, misread, or charged choice this turn — never name, quote, paraphrase, or describe it on the page): ${limit(r.text, 180)}`,
          )
        }
        if (ambient.length === 1) {
          lines.push(
            `  - private subtext (backstory pressure; color tone and choices only, never state on the page): ${limit(ambient[0].text, 180)}`,
          )
        } else if (ambient.length > 1) {
          lines.push('  - private subtext (color tone and choices only, never state on the page):')
          for (const r of ambient.slice(0, 3)) lines.push(`    - ${limit(r.text, 180)}`)
        }
        if (c.tool_access) {
          lines.push(`  - diegetic tools: ${limit(c.tool_access, 180)}`)
        }
        if (c.current_focus) lines.push(`  - focus: ${limit(c.current_focus, 160)}`)
        if (c.active_goal) lines.push(`  - goal: ${limit(c.active_goal, 160)}`)
        if (c.current_attitude) lines.push(`  - attitude: ${limit(c.current_attitude, 160)}`)
        // Sticky idiolect near delivery cues (not agenda/private canon).
        if (c.speech_register) {
          lines.push(`  - voice: ${limit(c.speech_register, 160)}`)
        }
        const activity = stripFactProvenance(c.recent_activity)
        if (activity) {
          for (const line of activity.split('\n').filter((s) => s.trim().length > 0).slice(-2)) {
            lines.push(`  - activity: ${limit(line, 160)}`)
          }
        }
        const obs = stripFactProvenance(c.observations)
        if (obs) {
          for (const line of obs.split('\n').filter((s) => s.trim().length > 0).slice(-2)) {
            lines.push(`  - behavior cue: ${limit(line, 160)}`)
          }
        }
      }
    }
  }

  const perception = formatPerceptionPin(perceptionPinFromState(state))
  if (perception) {
    lines.push('', perception)
  }

  // Items resting in the current place — dropped, stored, or left behind. The
  // authoritative "what's on the floor / in the locker / on the desk here"
  // ledger, distinct from the protagonist's CARRIED list: objects with no holder
  // whose location is the current place. Salient-first so load-bearing objects
  // lead; capped at 6 to keep state-block tokens bounded.
  if (state.currentPlace) {
    const place = state.currentPlace
    const here = state.dossier.resources
      .filter((r) => r.location_place_id === place.id && r.held_by_character_id === null)
      .sort((a, b) => b.salient - a.salient)
      .slice(0, 6)
    if (here.length > 0) {
      lines.push('', '### ITEMS HERE (authoritative — these objects are in this location)')
      for (const r of here) {
        const detail = [r.kind, r.status].filter(Boolean).join(', ')
        lines.push(`- ${r.name}${detail ? ` — ${detail}` : ''}`)
      }
    }
  }

  const occupancyBlock = formatOccupancyBlock(state.occupancy)
  if (occupancyBlock) {
    lines.push('', occupancyBlock)
  }

  // Real-world geographic anchors for known places. These come from a one-time
  // Nominatim resolve per place and are authoritative: the narrator (and the
  // NPC agent, which sees a parallel block) must not contradict the street or
  // neighborhood listed here. Omitted when nothing in the world has resolved
  // (fantasy settings, fresh world before first resolution call).
  const placesWithGeo = state.knownPlaces.filter((p) => p.geo_status === 'ok')
  if (placesWithGeo.length > 0) {
    lines.push('', '### KNOWN PLACES (real-world geography — authoritative)')
    for (const p of placesWithGeo) {
      const geo = formatPlaceGeo(p)
      if (geo) lines.push(`- ${p.name} — ${geo}`)
    }
  }

  // Open-order status (S2) — system fact the narrator dramatizes; never invent
  // off-scene relocation beyond these lines.
  if (openOrderCtx && openOrderCtx.statusLines.length > 0) {
    lines.push('', '### OPEN ORDER (authoritative status — dramatize this turn)')
    if (openOrderCtx.targetName) {
      lines.push(
        `- pending ${openOrderCtx.kind ?? 'order'}: ${openOrderCtx.targetName}`,
      )
    }
    for (const line of openOrderCtx.statusLines) {
      lines.push(`- ${line}`)
    }
  }

  // Private-channel audience pin — who may act on private speech this turn.
  // Do not restate the secret body here (player action already has it).
  if (privateUtteranceCtx && privateUtteranceCtx.audienceNames.length > 0) {
    const audience =
      privateUtteranceCtx.audienceNames.length === 1
        ? `${privateUtteranceCtx.audienceNames[0]} only`
        : privateUtteranceCtx.audienceNames.join(', ')
    lines.push('', '### PRIVATE THIS TURN (authoritative audience)')
    lines.push(`- channel: ${privateUtteranceCtx.channel}`)
    lines.push(`- audience: ${audience}`)
    lines.push(
      '- Non-audience present NPCs MUST NOT react as if they heard the private content.',
    )
    lines.push('- Do not have off-scene NPCs reference it.')
    lines.push(
      '- The protagonist and audience may act on it; others only if later fiction transmits it.',
    )
  }

  // Off-scene NPCs the narrator might reference this turn (phone calls,
  // messages, recollections, sudden arrivals). The NPC agent ticks them in
  // the background and writes last_known_situation + journey state. The
  // narrator must ground any off-scene NPC line in these facts and must
  // not teleport an NPC ahead of arrival_world_time.
  // Open-order targets are always included even if plain `npc` / no situation.
  const presentIds = new Set(state.presentCharacters.map((c) => c.id))
  const openOrderTargetName = openOrderCtx?.targetName?.toLowerCase() ?? null
  const offScene = state.knownCharacters
    .filter(
      (c) =>
        c.is_player !== 1 &&
        c.status !== 'dead' &&
        !presentIds.has(c.id) &&
        (c.agency_level === 'local' ||
          c.agency_level === 'nearby' ||
          c.agency_level === 'distant' ||
          (openOrderTargetName != null &&
            c.name.toLowerCase() === openOrderTargetName)),
    )
    .filter(
      (c) =>
        c.last_known_situation !== null ||
        c.current_place_id !== null ||
        c.in_transit_to_place_id !== null ||
        (openOrderTargetName != null && c.name.toLowerCase() === openOrderTargetName),
    )
    .sort((a, b) => (b.last_seen_turn_id ?? 0) - (a.last_seen_turn_id ?? 0))
    .slice(0, 5)
  if (offScene.length > 0) {
    const placeNameById = new Map(state.knownPlaces.map((p) => [p.id, p.name]))
    lines.push('', '### OFF-SCENE NPCs (tracked — do not contradict)')
    for (const c of offScene) {
      const where = c.current_place_id ? placeNameById.get(c.current_place_id) ?? null : null
      const dest = c.in_transit_to_place_id
        ? placeNameById.get(c.in_transit_to_place_id) ?? null
        : null
      const head = where ? `${c.name} at ${where}` : c.name
      // Prefer structured arrival_minutes when present (Track M clock-law).
      const etaLabel =
        c.arrival_minutes != null && Number.isFinite(c.arrival_minutes)
          ? minutesToWorldTime(c.arrival_minutes).worldTime
          : c.arrival_world_time
      const journey =
        dest !== null
          ? ` → ${dest}${etaLabel ? ` (ETA ${etaLabel})` : ''}`
          : ''
      lines.push(`- ${head}${journey}`)
      if (c.in_transit_to_place_id != null) {
        lines.push(
          '  - MUST NOT stage as present until world clock reaches ETA; radio/off-scene only while en route.',
        )
      }
      if (c.last_known_situation) {
        lines.push(`  - situation: ${limit(c.last_known_situation, 200)}`)
      }
      const activity = stripFactProvenance(c.recent_activity)
      if (activity) {
        const last = activity.split('\n').filter((l) => l.trim().length > 0).slice(-1)[0]
        if (last) lines.push(`  - last activity: ${limit(last, 180)}`)
      }
      // Deterministic loop continuity: a stationary off-scene NPC with a daily
      // routine surfaces what they'd be doing in this time band, so the narrator
      // can ground an off-scene reference without an LLM tick this turn.
      if (!c.in_transit_to_place_id) {
        const loopActivity = activityForBand(parseDailyLoop(c.daily_loop), worldTimeBand(state.worldTime))
        if (loopActivity) {
          lines.push(`  - routine: ${limit(loopActivity.activity, 160)}`)
        }
      }
    }
  }

  // Agent NPCs' planned moves for THIS turn. Decided by the NPC agent before
  // the narrator runs; the narrator stages them as the actual scene rather
  // than improvising those characters' choices. Omitted when there are no
  // present agent NPCs or the agent returned no plans.
  //
  // The concrete planned_action is what the narrator stages; the upstream
  // intent_text is shown alongside so the narrator can pick a faithful
  // realization. Intent IDs are deliberately NOT printed — narration must
  // never mention mechanics.
  if (plannedActions.length > 0) {
    lines.push('', '### PLANNED MOVES THIS TURN (agent NPCs)')
    for (const p of plannedActions) {
      const action = p.planned_action ?? p.intent
      lines.push(`- **${p.npc_name}** — ${action}`)
      if (p.planned_action && p.intent && p.intent !== p.planned_action) {
        lines.push(`  - intent: ${limit(p.intent, 180)}`)
      }
      if (p.speech_hint) {
        lines.push(`  - speech: ${limit(p.speech_hint, 160)}`)
      }
    }
  }

  const canonBlock = formatPlayerCanonBlock(state.knownCharacters, state.knownPlaces)
  if (canonBlock) {
    lines.push('', canonBlock)
  }

  const dossierBlock = formatDossierBlock(state.dossier, {
    worldTime: state.worldTime,
  })
  if (dossierBlock) {
    lines.push('', dossierBlock)
  }

  return lines.join('\n')
}

// True when the last 2 narrator turns clearly depict travel/arrival/entry to a
// known place other than the active scene's place. Deliberately a simple
// keyword + substring check, not LLM-based: a travel verb plus the name of a
// *different* known place in the recent window. Conservative by design — when
// the check is unsure it does not fire, and even a missed-but-correct
// suppression is harmless because the narrator can still read place from prose.
const TRAVEL_VERB =
  /\b(?:arrive|arrives|arrived|arriving|enter|enters|entered|entering|walk(?:s|ed)? into|step(?:s|ped)? into|reach(?:es|ed)?|pull(?:s|ed)? into|drive(?:s)? to|drove to|head(?:s|ed)? to|head(?:s|ed)? off|made (?:your|their|his|her) way to|cross(?:es|ed)? into|leave(?:s|ing)?|left behind|the two of you leave)\b/
function recentProseDepictsTravelElsewhere(
  recentNarratorProse: string[],
  currentPlace: Place,
  knownPlaces: Place[],
): boolean {
  const window = recentNarratorProse
    .slice(-2)
    .join('\n')
    .toLowerCase()
  if (!window || !TRAVEL_VERB.test(window)) return false

  const currentKey = currentPlace.name.toLowerCase()
  return knownPlaces.some((p) => {
    if (p.id === currentPlace.id) return false
    const name = p.name.toLowerCase()
    if (name.length < 4 || name === currentKey) return false
    return window.includes(name)
  })
}

function formatScenePacing(scene: Scene): string | null {
  const parts = [
    scene.scene_mood ? `mood ${scene.scene_mood}` : null,
    scene.pace ? `pace ${scene.pace}` : null,
    scene.focus ? `focus ${scene.focus}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join('; ') : null
}

// Player-asserted canon. Written only via the v0.6.6 archivist correction
// channel — never by the narrator-extraction archivist. Treat these as ground
// truth: if prior narration contradicts a line here, retcon gracefully or
// quietly move forward with the corrected version. Never call attention to a
// retcon ("you were never driving a Suburban after all") — fix the word and
// keep going.
function formatPlayerCanonBlock(
  knownCharacters: Character[],
  knownPlaces: Place[],
): string {
  const charactersWithNotes = knownCharacters.filter((c) => c.player_notes?.trim())
  const placesWithNotes = knownPlaces.filter((p) => p.player_notes?.trim())
  if (charactersWithNotes.length === 0 && placesWithNotes.length === 0) return ''

  const lines: string[] = ['## PLAYER CANON', 'Player-asserted ground truth. Respect these without restating them as discoveries.']

  if (charactersWithNotes.length > 0) {
    const sorted = [...charactersWithNotes].sort((a, b) => {
      if (a.is_player !== b.is_player) return a.is_player === 1 ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const c of sorted) {
      for (const line of (c.player_notes ?? '').split('\n').filter((l) => l.trim().length > 0)) {
        lines.push(`- ${c.name}: ${limit(line, 200)}`)
      }
    }
  }

  if (placesWithNotes.length > 0) {
    for (const p of [...placesWithNotes].sort((a, b) => a.name.localeCompare(b.name))) {
      for (const line of (p.player_notes ?? '').split('\n').filter((l) => l.trim().length > 0)) {
        lines.push(`- ${p.name}: ${limit(line, 200)}`)
      }
    }
  }

  return lines.join('\n')
}

export function formatOccupancyBlock(occupancy: PlaceOccupancy | null): string {
  if (!occupancy || (occupancy.groups.length === 0 && !occupancy.traffic)) return ''
  const lines: string[] = []
  lines.push('### NEARBY (ambient — not durable characters)')
  lines.push(
    'Texture, witnesses, obstacles, and service — use naturally; do not name every person. These are not tracked NPCs unless the protagonist engages them.',
  )
  lines.push(`- density: ${occupancy.density}`)
  for (const g of occupancy.groups) {
    const avail = g.promotable ? ' (could become someone)' : ''
    lines.push(`- ${limit(g.label, 80)} — ${limit(g.behavior, 80)}${avail}`)
  }
  if (occupancy.traffic) {
    const t = occupancy.traffic
    const motion = t.notable_motion ? `; ${t.notable_motion}` : ''
    lines.push(`- traffic: vehicles ${t.vehicles}, pedestrians ${t.pedestrians}${motion}`)
  }
  if (occupancy.encounter_hooks.length > 0) {
    lines.push('- possible encounters (latent — surface only if the protagonist engages; never as a quest marker):')
    for (const h of occupancy.encounter_hooks) {
      lines.push(`  - ${limit(h.narrator_cue, 160)}`)
    }
  }
  return lines.join('\n')
}

export type FormatDossierOptions = {
  /** Current internal narrative clock minutes for deadline ranking. */
  clockMinutes?: number | null
  /** Rendered world_time string — used to backfill ranking when minutes absent. */
  worldTime?: string | null
  /**
   * When set, heavy pressure is limited to these thread ids (+ foreground);
   * other actives render as compact background one-liners (Track A Director).
   */
  heavyThreadIds?: number[]
  backgroundThreadIds?: number[]
}

/**
 * ## DIRECTOR block from a pure Director decision.
 * MUST STAGE / MUST NOT / CAST are structural (same force as planned moves).
 * Fail-open empty string when there is nothing to direct.
 */
export function formatDirectorBlock(
  decision: DirectorDecision,
  threads: StoryThread[],
): string {
  const hasBrief =
    decision.foregroundThreadId != null ||
    decision.mustStage.length > 0 ||
    decision.cast.length > 0 ||
    decision.guidanceLines.length > 0
  if (!hasBrief) return ''

  const byId = new Map(threads.map((t) => [t.id, t]))
  const lines: string[] = [
    '## DIRECTOR',
    'Structural beat — MUST realize every MUST STAGE line this turn (same force as PLANNED MOVES). Craft is free on how. Do not invent mechanics or list as menu options.',
  ]
  const fg =
    decision.foregroundThreadId != null
      ? byId.get(decision.foregroundThreadId)
      : undefined
  const beatLabel = [
    decision.beatKind,
    fg ? `"${fg.title}"` : null,
    fg ? fg.kind : null,
    decision.phase,
    decision.tension > 0 ? `tension ${decision.tension.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  if (beatLabel) lines.push(`Beat: ${beatLabel}`)

  if (decision.mustStage.length > 0) {
    lines.push('MUST STAGE')
    for (const item of decision.mustStage) lines.push(`- ${item}`)
  }
  if (decision.mustNot.length > 0) {
    lines.push('MUST NOT')
    for (const item of decision.mustNot) lines.push(`- ${item}`)
  }
  if (decision.cast.length > 0) {
    lines.push('CAST')
    for (const slot of decision.cast) {
      lines.push(`- ${slot.role}: ${slot.name}`)
    }
  }
  if (decision.guidanceLines.length > 0) {
    lines.push('Notes (soft)')
    for (const g of decision.guidanceLines) lines.push(`- ${g}`)
  }
  if (decision.backgroundThreadIds.length > 0) {
    const bg = decision.backgroundThreadIds
      .map((id) => byId.get(id)?.title)
      .filter((t): t is string => Boolean(t))
      .slice(0, 4)
    if (bg.length > 0) {
      lines.push(`- Background pressure (compact): ${bg.join('; ')}`)
    }
  }
  return lines.join('\n')
}

/**
 * Binding referee pin. Fail-open empty when the outcome is not_applicable.
 */
export function formatResolvedOutcomeBlock(resolution: ResolvedOutcome | null): string {
  if (!resolution || !isBindingOutcome(resolution)) return ''
  return [
    '### OUTCOME',
    "The player's words are intent, not fact. Narrate ONLY this resolved result.",
    `- result: ${resolution.outcome}`,
    `- intent: ${resolution.intent}`,
    `- fact: ${resolution.worldStateDelta}`,
    'Do not upgrade this into a stronger success than listed.',
  ].join('\n')
}

export function formatPerceptionPin(pin: PerceptionPin): string {
  if (!pin.placeName && pin.here.length === 0 && pin.elsewhere.length === 0) return ''
  const lines = [
    '### PERCEPTION (authoritative)',
    pin.placeName ? `This room: ${pin.placeName}` : 'This room: (unset)',
    `HERE (can hear/see/speak here): ${pin.here.length > 0 ? pin.here.join(', ') : '(none)'}`,
  ]
  if (pin.elsewhere.length > 0) {
    lines.push(
      "ELSEWHERE (cannot speak into this room; do not give them this scene's facts):",
    )
    for (const row of pin.elsewhere.slice(0, 8)) {
      lines.push(`- ${row.name}${row.place ? ` — ${row.place}` : ''}`)
    }
  }
  lines.push(
    'HERE NPCs know only what they perceived in this place or while present with you. They do not share a plot file. No voice from a doorway unless that NPC is listed HERE. A radio/terminal must be in this room to carry another room\'s facts.',
  )
  return lines.join('\n')
}

function perceptionPinFromState(state: NarratorWorldState): PerceptionPin {
  return buildPerceptionPin({
    placeName: state.currentPlace?.name ?? null,
    present: state.presentCharacters.map((c) => ({
      name: c.name,
      isPlayer: c.is_player === 1,
      status: c.status,
      currentPlaceId: c.current_place_id,
    })),
    known: state.knownCharacters.map((c) => ({
      name: c.name,
      isPlayer: c.is_player === 1,
      status: c.status,
      currentPlaceId: c.current_place_id,
    })),
    placeNameById: new Map(state.knownPlaces.map((p) => [p.id, p.name])),
  })
}

function rankingContextFrom(options?: FormatDossierOptions): RankingContext {
  if (options?.clockMinutes != null && Number.isFinite(options.clockMinutes)) {
    return { clockMinutes: options.clockMinutes }
  }
  if (options?.worldTime) {
    const parsed = tryParseWorldTime(options.worldTime)
    if (parsed.ok) return { clockMinutes: parsed.minutes }
  }
  return { clockMinutes: null }
}

export function formatDossierBlock(
  dossier: StoryDossier,
  options?: FormatDossierOptions,
): string {
  const lines: string[] = []
  const ctx = rankingContextFrom(options)
  // R8: rank before slice so stale actives do not permanently occupy the window.
  const activeQuests = rankQuests(
    dossier.threads.filter((t) => t.status === 'active' && t.kind === 'quest'),
    ctx,
  )
  const activeThreads = rankThreads(
    dossier.threads.filter((t) => t.status === 'active' && t.kind !== 'quest'),
    ctx,
  )
  const activeObjectives = rankObjectives(
    dossier.objectives.filter((o) => o.status === 'active' || o.status === 'blocked'),
    ctx,
  )
  const openClues = rankClues(
    dossier.clues.filter((c) => c.status === 'open' || c.status === 'interpreted'),
  )
  const resources = rankResources(dossier.resources)
  const timeline = rankTimeline(dossier.timeline)
  // Settled work: compact, capped, never primary pressure.
  const closedThreads = selectRecentlyClosedThreads(
    dossier.threads,
    CLOSED_DOSSIER_CAPS.narratorThreads,
  )
  const closedObjectives = selectRecentlyClosedObjectives(
    dossier.objectives,
    CLOSED_DOSSIER_CAPS.narratorObjectives,
  )

  if (
    activeQuests.length === 0 &&
    activeThreads.length === 0 &&
    activeObjectives.length === 0 &&
    openClues.length === 0 &&
    resources.length === 0 &&
    timeline.length === 0 &&
    closedThreads.length === 0 &&
    closedObjectives.length === 0
  ) {
    return ''
  }

  lines.push('## STORY DOSSIER')
  lines.push('Use this as playable pressure, not exposition. Hidden pressure can move the world but must not be blurted out.')

  const primary = pickPrimaryPressure(
    dossier.threads.filter((t) => t.status === 'active'),
    dossier.objectives.filter((o) => o.status === 'active' || o.status === 'blocked'),
    ctx,
  )
  if (primary) {
    lines.push('', '### PRIMARY PRESSURE (internal — never list as options to the player)')
    const detail = primary.detail ? ` — ${limit(primary.detail, 180)}` : ''
    const clock = options?.worldTime ? ` (world time: ${options.worldTime})` : ''
    lines.push(`- ${primary.title}${detail}${clock}`)
  }

  if (activeQuests.length > 0) {
    lines.push('', '### ACTIVE QUESTS')
    for (const q of activeQuests) {
      const details = [
        q.summary,
        q.stakes ? `stakes: ${q.stakes}` : null,
        q.rewards ? `rewards: ${q.rewards}` : null,
        q.consequences ? `consequences: ${q.consequences}` : null,
      ]
        .filter(Boolean)
        .join(' ')
      lines.push(`- ${q.title}${details ? ` — ${limit(details, 260)}` : ''}`)
      if (q.hidden) lines.push(`  - hidden pressure: ${limit(q.hidden, 180)}`)
    }
  }

  if (activeThreads.length > 0) {
    lines.push('', '### ACTIVE THREADS')
    for (const t of activeThreads) {
      const details = [
        `${t.kind}:`,
        t.summary,
        t.stakes ? `stakes: ${t.stakes}` : null,
        t.consequences ? `consequences: ${t.consequences}` : null,
      ]
        .filter(Boolean)
        .join(' ')
      lines.push(`- ${t.title}${details ? ` — ${limit(details, 220)}` : ''}`)
      if (t.hidden) lines.push(`  - hidden pressure: ${limit(t.hidden, 180)}`)
    }
  }

  if (activeObjectives.length > 0) {
    lines.push('', '### CURRENT OBJECTIVES')
    for (const o of activeObjectives) {
      const detail = [o.detail, o.blocker ? `blocker: ${o.blocker}` : null]
        .filter(Boolean)
        .join(' ')
      lines.push(`- ${o.title}${o.status === 'blocked' ? ' (blocked)' : ''}${detail ? ` — ${limit(detail, 200)}` : ''}`)
    }
  }

  if (openClues.length > 0) {
    lines.push('', '### CLUES')
    for (const c of openClues) {
      const detail = [c.detail, c.implication ? `implies: ${c.implication}` : null]
        .filter(Boolean)
        .join(' ')
      lines.push(`- ${c.title}${c.thread_title ? ` [${c.thread_title}]` : ''}${detail ? ` — ${limit(detail, 220)}` : ''}`)
    }
  }

  if (resources.length > 0) {
    lines.push('', '### RESOURCES')
    for (const r of resources) {
      const owner = r.owner_name ? `${r.owner_name}: ` : ''
      const detail = [r.kind, r.status, r.detail].filter(Boolean).join('; ')
      lines.push(`- ${owner}${r.name}${detail ? ` — ${limit(detail, 180)}` : ''}`)
    }
  }

  if (timeline.length > 0) {
    lines.push('', '### RECENT TIMELINE')
    for (const e of timeline) {
      lines.push(
        `- ${e.thread_title ? `[${e.thread_title}] ` : ''}${e.world_time ? `${e.world_time}: ` : ''}${e.title} — ${limit(e.summary, 180)}`,
      )
    }
  }

  if (closedThreads.length > 0 || closedObjectives.length > 0) {
    lines.push('', '### RECENTLY CLOSED')
    lines.push(
      'Treat these as settled; do not revive unless current fiction explicitly creates a new complication.',
    )
    for (const t of closedThreads) {
      const turn =
        t.resolved_turn_id != null ? ` [resolved t:${t.resolved_turn_id}]` : ''
      const detail = t.summary ? ` — ${limit(t.summary, 160)}` : ''
      lines.push(`- ${t.title} (${t.status})${detail}${turn}`)
    }
    for (const o of closedObjectives) {
      const turn =
        o.completed_turn_id != null ? ` [completed t:${o.completed_turn_id}]` : ''
      const detail = o.detail ? ` — ${limit(o.detail, 160)}` : ''
      lines.push(`- ${o.title} (${o.status})${detail}${turn}`)
    }
  }

  return lines.join('\n')
}

function limit(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1).trimEnd()}...`
}

export function formatPlaceGeo(place: Place): string | null {
  if (place.geo_status !== 'ok') return null
  const parts: string[] = []
  if (place.osm_street) parts.push(place.osm_street)
  if (place.osm_neighborhood && place.osm_neighborhood !== place.osm_street) {
    parts.push(place.osm_neighborhood)
  }
  if (parts.length === 0 && place.osm_display_name) {
    return limit(place.osm_display_name, 160)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}
