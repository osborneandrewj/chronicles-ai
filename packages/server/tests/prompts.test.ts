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
  it('confines narration to what the protagonist can perceive and keeps off-scene off the page', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/inside the protagonist'?s perception/i)
    expect(p).toMatch(/off-scene/i)
    expect(p).toMatch(/never as omniscient fact/i)
    expect(p).toMatch(/Do not write another mind's thoughts/i)
    expect(p).toMatch(/stay off the page/i)
    expect(p).not.toMatch(/may surface ONLY as the protagonist's own thought/i)
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
    expect(p).toMatch(/PERCEPTION wins/i)
    expect(p).toMatch(/HERE NPCs speak and hear/i)
    expect(p).toMatch(/ELSEWHERE NPCs do not talk/i)
    expect(p).toMatch(/not logs, grids, or other rooms/i)
  })
})

describe('conductor prompt', () => {
  it('treats player wording as intent and forbids granting unopposed kills', () => {
    const p = loadPrompt('conductor-system')
    expect(p).toMatch(/intent, not fact/i)
    expect(p).toMatch(/do not grant/i)
    expect(p).toMatch(/impossible/)
  })
})

describe('director-brain prompt', () => {
  it('forbids inventing new major threads and asks for one initiator', () => {
    const p = loadPrompt('director-brain')
    expect(p).toMatch(/do not invent new major threads/i)
    expect(p).toMatch(/one `initiate`/)
    expect(p).toMatch(/player agency/i)
    expect(p).toMatch(/change the board/i)
    expect(p).toMatch(/do not restage/i)
    expect(p).toMatch(/Camera stays with the protagonist/i)
    expect(p).toMatch(/mustStage.*present-character/i)
    expect(p).toMatch(/invitation is not arrival/i)
  })
})

describe('npc-agent prompt — director CAST slots', () => {
  it('tells the agent to honor initiate/react/arrive/background', () => {
    const p = loadPrompt('npc-agent-system')
    expect(p).toMatch(/director_slot/i)
    expect(p).toMatch(/initiate/)
    expect(p).toMatch(/background/)
    expect(p).toMatch(/Fill assigned slots only/i)
  })
})

describe('npc-agent prompt — staged presence loops', () => {
  it('treats a cleanly staged repeat as a loop, not a success', () => {
    const p = loadPrompt('npc-agent-system')
    expect(p).toMatch(/plan_loop_warning/)
    expect(p).toMatch(/Staged repeats are also a loop/i)
    expect(p).toMatch(/Answer what they just did|do not replace their beat/i)
    expect(p).toMatch(/I'm here/)
    expect(p).toMatch(/do not freeze a finished situation/i)
    expect(p).toMatch(/Leave means they go/i)
    expect(p).toMatch(/leave the protagonist behind/i)
  })
})

describe('npc-agent prompt — perception / place', () => {
  it('forbids off-scene speech and other-room logs', () => {
    const p = loadPrompt('npc-agent-system')
    expect(p).toMatch(/Perception \/ place/)
    expect(p).toMatch(/Only NPCs present with the protagonist may speak/i)
    expect(p).toMatch(/Do not cite other rooms' logs/i)
  })
})

describe('narrator prompt — director beat is binding', () => {
  it('treats DIRECTOR MUST STAGE like planned moves', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/## DIRECTOR/)
    expect(p).toMatch(/MUST STAGE/)
    expect(p).toMatch(/same force as planned moves/i)
    expect(p).toMatch(/MUST NOT/)
    expect(p).toMatch(/CAST/)
    expect(p).toMatch(/do not write "director"/i)
    expect(p).toMatch(/### OUTCOME/)
    expect(p).toMatch(/do not upgrade/i)
    expect(p).toMatch(/fold the player into the prose/i)
    expect(p).toMatch(/predicates/i)
    expect(p).toMatch(/world'?s voice/i)
    expect(p).toMatch(/paraphrase is allowed/i)
    expect(p).toMatch(/do not paste the typed line/i)
    expect(p).toMatch(/cannot act/i)
    expect(p).toMatch(/agency returns/i)
    expect(p).toMatch(/I'm here/)
    expect(p).toMatch(/palm-on-glass/i)
    expect(p).toMatch(/Camera stays with the protagonist/i)
    expect(p).toMatch(/If they followed, they arrive now/i)
    expect(p).toMatch(/do not arrive beside them/i)
  })
})

describe('narrator prompt — no option menus (A3)', () => {
  it('forbids enumerating choices / option menus', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/never (present|offer|enumerate|list).*(option|choice)/i)
    expect(p).toMatch(/your options are|from here you could|if you choose to/i)
  })
})

describe('narrator prompt — stay in fiction (no OOC policy refusal)', () => {
  it('frames the work as fiction and forbids OOC refusal speech', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/fictional|interactive fiction|interactive story/i)
    expect(p).toMatch(/never refuse out of character|never write policy disclaimers/i)
    expect(p).toMatch(/I will not narrate|can't assist|crosses a line/i)
    expect(p).toMatch(/combat|lethal|violence/i)
  })
})

describe('prompts — dialogue depth & character voice', () => {
  it('narrator craft includes dialogue craft and speech staging edges', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/dialogue craft/i)
    expect(p).toMatch(/real conversation|two to four clauses/i)
    expect(p).toMatch(/yielded the floor|write through the conversation/i)
    expect(p).toMatch(/speech:/i)
    expect(p).toMatch(/speakable lines|whispers|SSML|physical tell/i)
  })

  it('npc-agent authors speech_register once and uses speech_hint on talk plans', () => {
    const p = loadPrompt('npc-agent-system')
    expect(p).toMatch(/speech_register once/i)
    expect(p).toMatch(/personal_goals once/i)
    expect(p).toMatch(/do not write refusals/i)
    expect(p).toMatch(/do not rewrite/i)
    expect(p).toMatch(/speech_hint/i)
    expect(p).toMatch(/never write the full line/i)
    expect(p).toMatch(/never script the line/i)
    expect(p).toMatch(/required on talk-shaped/i)
    expect(p).toMatch(/yielded the floor/i)
    expect(p).toMatch(/two-or-three-clause sequence/i)
  })

  it('ensemble dressing authors a distinct speechRegister per crew member', () => {
    const p = loadPrompt('ensemble-dressing')
    expect(p).toMatch(/speechRegister/)
    expect(p).toMatch(/how-they-talk|default move/i)
    expect(p).toMatch(/each member MUST sound different/i)
  })
})

describe('prompt content guards', () => {
  it('narrator prompt is craft + hard and materially shorter than the old checklist', () => {
    const p = loadPrompt('narrator-system')
    expect(p).toMatch(/# Craft/i)
    expect(p).toMatch(/# Hard constraints/i)
    // Target ≤ ~1.5k words (pre-change was ~3k).
    const words = p.trim().split(/\s+/).length
    expect(words).toBeLessThanOrEqual(1600)
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

describe('prompts — plot lifecycle continuity', () => {
  it('archivist prompt locks closed-thread lifecycle and forbids implicit reopen', () => {
    const p = loadPrompt('archivist-system').toLowerCase()
    expect(p).toMatch(/lifecycle lock|closed threads stay closed/)
    expect(p).toMatch(/recently_closed_threads/)
    expect(p).toMatch(/explicit `?story_threads/)
    expect(p).toMatch(/do not revive|not reopen|must \*\*not\*\* reopen|must not reopen/)
    expect(p).toMatch(/repeating medical or procedure symptom|somatic/)
  })

  it('opening-plots prompt uses Booker shapes without printing their names as titles', () => {
    const p = loadPrompt('opening-plots')
    expect(p).toMatch(/Overcoming the Monster/)
    expect(p).toMatch(/Voyage and Return/)
    expect(p).toMatch(/plot_shape/)
    expect(p).toMatch(/never a Booker name/i)
    expect(p).toMatch(/tremor|medical/)
  })

  it('npc-agent prompt tells agents to drop obsolete goals when plot is closed', () => {
    const p = loadPrompt('npc-agent-system').toLowerCase()
    expect(p).toMatch(/plot lifecycle|story context/)
    expect(p).toMatch(/recently_closed/)
    expect(p).toMatch(/closed objectives|obsolete/)
  })
})
