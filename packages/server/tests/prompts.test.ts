import { describe, expect, it } from 'vitest'

import { loadPrompt } from '@/lib/prompt-files'

describe('narrator prompt — inner life never on the page (v0.6.x)', () => {
  it('forbids naming/stating an NPC reverie and bans the word "reverie" in prose', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toContain('FLARING SUBTEXT')
    expect(p).toMatch(/never use the word "reverie"/i)
    expect(p).toMatch(/"reverie"/)
  })
})

describe('narrator prompt — reverie ban promoted to non-negotiable', () => {
  it('carries a blunt non-negotiable ban on the word and on reciting subtext', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/never use the word "reverie" in prose/i)
    expect(p).toMatch(/never recite, quote, or paraphrase .*(private subtext|FLARING SUBTEXT)/i)
  })
})

describe('narrator prompt — limited POV (no omniscient off-scene narration)', () => {
  it('confines narration to the protagonist perception and frames off-scene as their awareness', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/inside the protagonist'?s perception/i)
    expect(p).toMatch(/outside their view|off-scene/i)
    expect(p).toMatch(/never as omniscient fact/i)
  })
})

describe('prompts — orientation is not a default (characterization)', () => {
  it('narrator must not invent a character orientation', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/do not invent .*orientation/i)
    expect(p).toMatch(/player establishes|already establish|deliberately created/i)
  })
  it('archivist must not infer orientation from nothing', () => {
    const a = loadPrompt('archivist-system')
    expect(a).toMatch(/orientation|same-sex/i)
    expect(a).toMatch(/only record|explicitly establish/i)
  })
})

describe('archivist prompt — perception check (A2)', () => {
  it('only records observations the NPC could perceive', () => {
    const p = loadPrompt('archivist-system')
    expect(p).toMatch(/could (actually )?(sense|perceive|witness|hear|see)/i)
    expect(p).toMatch(/same place|open (radio|audio) channel/i)
  })
})

describe('narrator prompt — NPC knowledge boundary (A2)', () => {
  it('forbids NPCs acting on knowledge they could not have', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/only what it (has )?perceived|knows only what/i)
    expect(p).toMatch(/another NPC'?s private|did not (witness|perceive)/i)
  })
})

describe('narrator prompt — no option menus (A3)', () => {
  it('forbids enumerating choices / option menus', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/never (present|offer|enumerate|list).*(option|choice)/i)
    expect(p).toMatch(/your options are|from here you could|if you choose to/i)
  })
})

describe('prompt content guards', () => {
  it('narrator prompt is craft + hard and materially shorter than the old checklist', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/# Craft/i)
    expect(p).toMatch(/# Hard constraints/i)
    // Target ≤ ~1.5k words (pre-change was ~3k).
    const words = p.trim().split(/\s+/).length
    expect(words).toBeLessThanOrEqual(1500)
    expect(words).toBeGreaterThan(200)
    // Numeric length bands are not soft law.
    expect(p).not.toMatch(/Medium \(300–500 words\)/)
    expect(p).not.toMatch(/Long & rich \(550–850/)
  })

  it('narrator prompt carries the historical-fidelity rule', () => {
    const p = loadPrompt('narrator-system').toLowerCase()
    expect(p).toContain('historical')
    expect(p).toContain('era-appropriate')
  })

  it('npc-agent prompt carries the historical-fidelity rule', () => {
    const p = loadPrompt('npc-agent-system').toLowerCase()
    expect(p).toContain('era-appropriate')
  })

  it('npc-agent prompt carries the open-order outcome floor (S1)', () => {
    const p = loadPrompt('npc-agent-system').toLowerCase()
    expect(p).toMatch(/outcome floor/)
    expect(p).toMatch(/open order/)
    expect(p).toMatch(/monitors channel/)
  })

  it('archivist prompt makes dossier emission a directive, not optional', () => {
    const p = loadPrompt('archivist-system').toLowerCase()
    expect(p).toContain('a memorable_fact is not a substitute for a thread')
  })

  it('narrator prompt instructs the world to act when the player is passive', () => {
    const p = loadPrompt('narrator-system').toLowerCase()
    // Craft layer: world momentum (no longer a long "scenes must never stall" essay).
    expect(p).toMatch(/world momentum|marks time|something concrete can happen/)
  })

  it('time-passage prompt is genre-neutral (no starship-only framing)', () => {
    const p = loadPrompt('time-passage').toLowerCase()
    expect(p).not.toContain("starship story's narrative clock")
    expect(p).not.toContain('watch standing')
    expect(p).toContain('genre-neutral')
  })

  it('archivist records purchase/synonym story_resources and objective completion', () => {
    const p = loadPrompt('archivist-system').toLowerCase()
    expect(p).toContain('purchase / synonym backstop')
    expect(p).toContain('held_by_name: "protagonist"')
    expect(p).toMatch(/completion \/ failure is mandatory/)
  })

  it('correction channel forces protagonist identity onto is_player', () => {
    const p = loadPrompt('archivist-correction').toLowerCase()
    expect(p).toContain('is_player: true')
    expect(p).toMatch(/never mint a second protagonist|never create a non-player/)
  })
})

describe('prompts — NPC initiation (P2/P4/P5)', () => {
  it('narrator prompt MUST-stages the PLANNED MOVES block (compact hard constraint)', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toContain('### PLANNED MOVES THIS TURN')
    expect(p).toMatch(/realize every planned move/i)
  })

  it('narrator prompt licenses a present character to press the protagonist (not a menu)', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/present character may initiate|NPCs act from own goals/i)
    expect(p).toMatch(/never present a menu of choices/i)
  })

  it('npc-agent prompt sets a single-NPC engagement floor toward the protagonist', () => {
    const p = loadPrompt('npc-agent-system')
    expect(p).toMatch(/never leave the protagonist unaddressed/i)
    expect(p).toMatch(/at least one .* directs its plan at the protagonist/i)
    expect(p).toMatch(/floor is ONE engaged NPC/i)
  })
})
