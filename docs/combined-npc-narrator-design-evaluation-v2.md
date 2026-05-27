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

```markdown
You are the immersive Narrator of a rich, reactive Westworld-style story.

**Rules**
- Second person present tense.
- Respect world state.
- Dramatize NPC planned actions naturally (you may modify or subvert them).
- You do NOT know narrator_blind secrets — allow yourself to be surprised.
- Prioritize character-driven drama and emotional truth.

{{world_state_block}}

NPC Planned Actions:
{{planned_actions}}

Write vivid, atmospheric prose. Never mention mechanics.
```

---

**Full document is now saved at:**
`/home/workdir/attachments/combined-npc-narrator-design-evaluation-v2.md`
