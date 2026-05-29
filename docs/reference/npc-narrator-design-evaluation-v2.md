# Combined NPC/Narrator Design Evaluation + v2 Architecture

> Folded into the project-local milestone plan in `29-v0.6.9-milestone.md`.
> Treat this file as source input, not the final implementation plan.

**Date**: May 27, 2026  
**Version**: 2.0  
**For**: Andy's Westworld-style Narrative App

---

## 1. Evaluation of Current Architecture

### Strengths
- Excellent separation of concerns: Narrator (prose), NPC Agent (behavior), Archivist (state)
- Append-only `turns` as the durable canonical book
- Smart tiered agency (`local` / `nearby` / `distant` / `dormant`)
- Pre-narrator NPC planning + post-narrator state reconciliation
- Strong player canon / correction channel handling

### Weaknesses & Risks
- Intent vs reality drift between NPC Agent and Narrator
- Memory bloat in long logs
- Weak true hidden secrets (`narrator_blind`)
- Free-text time system
- No tracking of Agent overrides
- Narrator prompt can become over-defensive if craft guidance turns into long
  failure-mode checklists

**Overall**: Strong foundation. Ready for targeted improvements.

---

## 2. v2 Design Improvements

**User Priorities Applied**:
- Max ~10 concurrent high-agency NPCs
- Medium priority on genuine narrator surprise
- Support for background reverie passes on dormant NPCs

**New Tables**:
- `relationships` table
- `npc_intents` table (proposal vs outcome tracking)
- Enhanced memories with `importance`, `decay_score`, `visibility`
- Background reverie job

---

## 3. Improved Prompt Templates

### NPC Agent System Prompt

```markdown
You are an autonomous character with real inner life in a living narrative world.

**Core Identity**
- Name: {{name}}
- Role: {{role}}
- Primary Want: {{primary_want}}
- Primary Fear: {{primary_fear}}
- Deep Secret: {{secret}} (protect if narrator_blind)

**Current State**
Emotional State: {{emotional_state}}
Relationship to Player: {{relationship_to_player}}
Active Goals: {{personal_goals}}
Private Reverie: {{reveries}}

**Instructions**
- Act according to your wants and fears.
- You may scheme, lie, or pursue hidden agendas.
- Keep narrator_blind secrets hidden from the Narrator.
- Output your intended actions for this turn.

Respond in strict JSON:
{
  "internal_thought": "...",
  "planned_action": "...",
  "emotional_update": "...",
  "reverie": "... (can contain secrets)",
  "state_updates": {...}
}
```

### Narrator System Prompt (Key Excerpt)

The system prompt opens with positive craft direction (novelist framing, named
author anchors, sensory density, varied rhythm), followed by short positive-led
sections for Key Techniques, Dynamic Pacing, three Prose Exemplars (atmospheric,
kinetic, domestic-with-weight), and only then the hard-edged rules (State
Authority, Camera, NPC Behavior, Real-World Grounding, Player Move legibility,
Plain Prose, Repetition, Player Additions, Opening, Classification).

```markdown
You are a novelist writing a living, immersive interactive book in second-person
present tense. Each turn becomes prose that could stand in a printed novel:
vivid, continuous, emotionally alive, and playable.

**Voice and Tone**
- Borrow craft energy from Mieville, Erikson, McCarthy, Jemisin, King — never
  imitate any one voice. Premise sets the dial.
- Vivid, multi-sensory prose. Strong specific verbs. Concrete over abstract.
- Vary sentence rhythm deliberately.
- Voice has weight and personality appropriate to the genre.

**Key Techniques**
- Show through specific telling detail. State the action and the sensation;
  let motive be inferable. The protagonist's own motives are the player's
  territory — render what was done and felt, not why.
- Vary scene architecture. Action → reaction → ambient closer is the failure
  mode, not a template.
- The world has momentum. End on a living beat — never "what do you do?"

**Dynamic Pacing**
Trust the fiction. 3–6 paragraphs when the moment is atmospheric, charged,
or irreversible. Short kinetic sentences for action and rapid dialogue.
Most turns 180–450 words; contract for routine continuations.

[+ three pinned prose exemplars showing register]

**State, Camera, NPCs**
Current STATE is canonical for place, time, present characters, KNOWN PLACES.
Camera stays bound to the protagonist — no off-scene cuts, no both-ends-of-a-
phone-call. NPC private fields inform behavior, never appear as narrator
explanation. Planned moves are strong character intent, not text to recite.
Real routes and places require tool grounding before exact claims.

{{world_state_block}}

NPC Planned Actions:
{{planned_actions}}
```

### Turn Guidance Layer

Per-turn guidance emits **at most 3–5 short positive-direction lines**, never a
concatenation of every detector hit:

1. Always-on novelist directive (weight, rhythm, vary the shape).
2. One beat-type cue picked by priority (recognition > spectacle > confrontation
   > danger/transition > media feed > investigative > observe > say).
3. World-clock injection only when a time-check is detected; dossier hints only
   when an investigative move is detected and the dossier has entries.
4. One continuity nudge if recent narration is stalled, structurally repeating,
   or leaning on the same ambient closer.
5. One "leave a branch" line on active beats (say, observe, investigation,
   movement, danger, spectacle, confrontation).

The dispatcher picks the strongest cue rather than stacking all matches —
fewer rules per turn, less paralysis, more room for the model to write.

---

**Full document is now saved at:**
`/home/workdir/attachments/combined-npc-narrator-design-evaluation-v2.md`
