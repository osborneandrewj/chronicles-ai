import 'server-only'

import {
  MAX_REVERIES_PER_NPC,
  clampIntensity,
  normalizeReverieTag,
  normalizeReverieText,
} from '@/domain/services/reverie-flare'
import type { ReverieInput, ReverieRow } from '@/lib/reveries'
import type { ReverieRepository } from '@/domain/ports/reverie-repository'

import type { MongoContext } from '../mongo-context'
import { mapReverie } from './mappers'

// Mongo ReverieRepository (spec §4.2, §4.6). Append-only NPC reverie log. The
// repository exposes the prune as part of `add`/`repoint` (spec §4.6: "the
// app-side prunes must port, not just the inserts") — the cap-3/NPC eviction
// and the repoint-before-delete ordering run in the same session as the insert
// so they commit atomically. The flaring / mint-state DECISION stays in the
// pure domain service; only the dedup + prune persistence lives here.
//
// The dedup-normalize + intensity-clamp + cap-3 eviction order is byte-identical
// to the SQLite `addReveriesForCharacter` / `repointReveries` transactions.
export class MongoReverieRepository implements ReverieRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get session() {
    return this.ctx.currentSession ?? undefined
  }

  async forCharacter(characterId: number): Promise<ReverieRow[]> {
    const docs = await this.ctx.models.Reverie.find({ characterId })
      .sort({ id: 1 })
      .lean()
    return docs.map(mapReverie)
  }

  async forCharacters(characterIds: number[]): Promise<Map<number, ReverieRow[]>> {
    const out = new Map<number, ReverieRow[]>()
    if (characterIds.length === 0) return out
    const docs = await this.ctx.models.Reverie.find({
      characterId: { $in: characterIds },
    })
      .sort({ characterId: 1, id: 1 })
      .lean()
    for (const id of characterIds) out.set(id, [])
    for (const d of docs) {
      const list = out.get(d.characterId) ?? []
      list.push(mapReverie(d))
      out.set(d.characterId, list)
    }
    return out
  }

  async forWorld(worldId: number): Promise<ReverieRow[]> {
    const docs = await this.ctx.models.Reverie.find({ worldId })
      .sort({ characterId: 1, id: 1 })
      .lean()
    return docs.map(mapReverie)
  }

  async add(
    worldId: number,
    characterId: number,
    inputs: ReverieInput[],
    createdTurnId: number | null,
  ): Promise<void> {
    if (inputs.length === 0) return
    const existing = await this.ctx.models.Reverie.find({ characterId })
      .sort({ id: 1 })
      .lean()
    const seen = new Set(existing.map((r) => normalizeReverieText(r.text)))
    for (const input of inputs) {
      const text = input.text.trim()
      if (text.length === 0) continue
      const norm = normalizeReverieText(text)
      if (seen.has(norm)) continue
      seen.add(norm)
      const tags = (input.match_tags ?? [])
        .map(normalizeReverieTag)
        .filter((t) => t.length > 0)
      const intensity = clampIntensity(input.intensity)
      const id = await this.ctx.nextSeq('reverieId')
      await this.ctx.models.Reverie.create(
        [
          {
            id,
            worldId,
            characterId,
            text,
            matchTagsJson: JSON.stringify(tags),
            intensity,
            isCornerstone: false,
            createdTurnId,
            lastFlaredTurnId: null,
            createdAt: new Date(),
          },
        ],
        { session: this.session },
      )
    }
    await this.prune(characterId)
  }

  async stampFlared(reverieIds: number[], turnId: number): Promise<void> {
    if (reverieIds.length === 0) return
    await this.ctx.models.Reverie.updateMany(
      { id: { $in: reverieIds } },
      { $set: { lastFlaredTurnId: turnId } },
      { session: this.session },
    )
  }

  async repoint(
    sourceCharacterId: number,
    targetCharacterId: number,
  ): Promise<void> {
    const targetExisting = await this.ctx.models.Reverie.find({
      characterId: targetCharacterId,
    })
      .sort({ id: 1 })
      .lean()
    const seen = new Set(targetExisting.map((r) => normalizeReverieText(r.text)))
    const sourceRows = await this.ctx.models.Reverie.find({
      characterId: sourceCharacterId,
    })
      .sort({ id: 1 })
      .lean()
    for (const row of sourceRows) {
      const norm = normalizeReverieText(row.text)
      if (seen.has(norm)) {
        // Repoint-before-delete: the duplicate is dropped (CASCADE landmine —
        // the dedupe drop must precede the prune so we don't strand rows).
        await this.ctx.models.Reverie.deleteOne(
          { id: row.id },
          { session: this.session },
        )
      } else {
        seen.add(norm)
        await this.ctx.models.Reverie.updateOne(
          { id: row.id },
          { $set: { characterId: targetCharacterId } },
          { session: this.session },
        )
      }
    }
    await this.prune(targetCharacterId)
  }

  // Mirrors `reverieMintState`: MAX(created_turn_id) is the NPC's last minted
  // turn (turn ids are the monotone `seq`), and the cooldown counts this world's
  // player turns inserted after it. `lastTurn === null` (no minted rows, or only
  // backfilled NULLs) yields Infinity so the cooldown never blocks the next mint.
  async mintState(
    worldId: number,
    characterId: number,
  ): Promise<{ hasAny: boolean; playerTurnsSinceLast: number }> {
    const rows = await this.ctx.models.Reverie.find({ characterId })
      .select({ createdTurnId: 1 })
      .lean()
    const hasAny = rows.length > 0
    const minted = rows
      .map((r) => r.createdTurnId)
      .filter((t): t is number => t !== null && t !== undefined)
    if (minted.length === 0) {
      return { hasAny, playerTurnsSinceLast: Number.POSITIVE_INFINITY }
    }
    const lastTurn = Math.max(...minted)
    const playerTurnsSinceLast = await this.ctx.models.Turn.countDocuments({
      worldId,
      role: 'user',
      seq: { $gt: lastTurn },
    })
    return { hasAny, playerTurnsSinceLast }
  }

  // Keep the strongest, then most-recently-flared, then newest. Evict the rest.
  // Mirrors `pruneReveriesForCharacter` (spec §4.6) — runs in the active session.
  private async prune(characterId: number, max = MAX_REVERIES_PER_NPC): Promise<void> {
    const rows = await this.ctx.models.Reverie.find({ characterId })
      .sort({ id: 1 })
      .lean()
    if (rows.length <= max) return
    const ranked = [...rows].sort((a, b) => {
      if (b.intensity !== a.intensity) return b.intensity - a.intensity
      const af = a.lastFlaredTurnId ?? -1
      const bf = b.lastFlaredTurnId ?? -1
      if (bf !== af) return bf - af
      return b.id - a.id
    })
    const evictIds = ranked.slice(max).map((r) => r.id)
    if (evictIds.length > 0) {
      await this.ctx.models.Reverie.deleteMany(
        { id: { $in: evictIds } },
        { session: this.session },
      )
    }
  }
}
