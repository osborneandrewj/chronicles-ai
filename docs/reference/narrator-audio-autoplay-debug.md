# Narrator-Audio Auto-Play Bug — Handoff (2026-05-25)

Started in chat with three reported symptoms; two are fixed, one is still broken.
Branch is `main`, **changes are uncommitted**. Restart from a clean head when picking this back up — don't bolt onto the in-flight attempt.

## TL;DR

`useNarratorAudio` no longer auto-plays the *current* turn after the user submits a prompt. Replay buttons work. Page-load auto-narration is correctly suppressed. The witness/played-gate code I added to fix the page-load bug appears to also be blocking the freshly-streamed turn somehow — but I couldn't run the dev server to confirm where exactly the gate is failing.

## Today's session (chronological)

1. **Repo state at start:** `main` at `8b05352` (paragraph-chunked TTS, post-v0.5.0). Memory said v0.5.1 was code-complete in testing.
2. **User reported bug A:** Replay button on any narration plays the *last* narration. → Fixed in `useNarratorAudio.ts` by gating the override-clear effect on `streaming`.
3. **User reported bug B:** World card turn count differed from chat-header turn count. → Fixed in `worlds.ts` (count only `role='assistant'`, matching what the header counts).
4. **Cosmetic:** Header showed `v0.3` while package was `0.3.0` and last tag was `v0.5.0`. → Bumped `package.json` to `0.5.1`, sourced header from `pkg.version`.
5. **DB recovery:** Local DB had been hand-migrated to a `user_version = 5` schema (scenes/places/characters, `turn_states` dropped) with no matching migration in the repo. Restored from `chronicles.sqlite.pre-v5-backup-20260524-193100`; archived the v5-state DB in `backups/`. Lost ~4 recent turns; user OK'd.
6. **User reported bug C** (after smoke-testing the above): typing a new prompt no longer produces audio; clicking replay ~30s later double-plays. I hypothesized this was the page-load auto-narration bug (the "v0.4.2 hotfix pending" item in memory that actually never shipped — v0.4.2 turned out to be the Railway build fix). Implemented the witness gate. **User reports auto-play of the new turn still doesn't work.**

## Current state of the code (uncommitted)

```
modified:   package.json                       (0.3.0 → 0.5.1)
modified:   src/app/page.tsx                   (v0.3 → v{pkg.version})
modified:   src/components/useNarratorAudio.ts (override-clear gate + witness/played gate)
modified:   src/lib/worlds.ts                  (turn_count: WHERE role='assistant')
```

Untracked: `backups/` directory (archived v5-state DB), three `chronicles.sqlite.pre-v5-backup-*` snapshot files at repo root.

### What's verified working

- Replay button on any older turn plays *that* turn (bug A fixed).
- World card and chat header turn counts now match (bug B fixed).
- Header shows `v0.5.1` from package.json (cosmetic).
- Page-load no longer auto-plays the last existing narration.

### What's still broken

- Typing a new prompt: narration streams in fine, but `audio.play()` never fires for it. User can still click the replay button on that same turn and it plays normally.

## The gate I added (the suspect)

`src/components/useNarratorAudio.ts`:

```ts
const witnessedRef = useRef<Set<string>>(new Set());
const playedRef = useRef<Set<string>>(new Set());

// Sibling effect, declared before dispatch effect:
useEffect(() => {
  if (streaming && turnId) witnessedRef.current.add(turnId);
}, [streaming, turnId]);

// Inside dispatch effect, right after the `if (!effective.jobKey)` guard:
const allowed =
  effective.source === "replay" ||
  effective.streaming ||
  (witnessedRef.current.has(effective.turnId) &&
    !playedRef.current.has(effective.turnId));
if (!allowed) return;
```

`playedRef.current.add(j.turnId)` is set in two places: inside `playNext` when pending is empty + flushed, and inside the dispatch effect's terminal `setStatus("idle")` block.

**Intent:**
- Page load: `effective.streaming = false`, witnessed empty → denied (suppresses page-load auto-narration). ✓
- New turn streaming live: `effective.streaming = true` → allowed via the `effective.streaming` bypass. (Added later as defense against witness-ref timing.)
- New turn post-stream flush: `effective.streaming = false`, but witnessed should now have the turnId, played should not → allowed via `witnessed AND !played`.
- Replay: allowed via `source === "replay"`.

**The hole:** something in this gate (or in another effect interacting with it) is preventing audio dispatch for the new turn. I never ran the dev server, so I don't know *which* branch of the gate is denying it, or whether dispatch is reaching the `for (const chunk of chunks)` loop and `fetchChunk` is being called.

## Hypotheses still on the table

Listed roughly in order of "what I'd check first":

1. **Witness ref never gets populated for the new turn.** AI SDK v2 may not transition `status` through `"streaming"` in a way that the hook observes with `streaming=true && turnId=newId` in the same render. If the prop `streaming` is always derived from `status === "streaming"` but the new assistant message id arrives a render later (or earlier), witness might add the wrong id (or never add). **First debug step: `console.log` inside the witness effect to confirm what `streaming`/`turnId` look like across the submit→stream→ready sequence.**
2. **`narratableTurn.id !== lastAssistantId` flips false during transition.** `Chat.tsx` computes `streaming: streaming && narratableTurn.id === lastAssistantId`. If `narratableTurn.id` ever doesn't match `lastAssistantId` while `streaming === true`, the hook sees `streaming=false` and witness never fires.
3. **Hook is unmounting/remounting** (e.g., a `key` change in the parent), wiping `witnessedRef` and `playedRef` between submit and stream-end. Refs are NOT React state and don't survive remounts.
4. **Browser autoplay policy.** `audio.play()` is rejecting because the prompt-submit gesture (Enter key in `<textarea>`) doesn't count as activation in this browser. The replay button click *does* count, which is why it works. This would explain the symptom but not the "double-play on replay" the user reported earlier (unless a suspended/queued audio element gets unblocked on the click). Easy verification: open DevTools console while submitting a prompt; look for `"[narrator-audio] audio.play() rejected"`.
5. **Strict-mode double-effect in dev** wiping `playedRef` via cleanup. The unmount-cleanup effect at line 327 calls `resetJob`, which doesn't touch the refs — but if React 18+ strict mode unmounts and remounts the *component*, the `useRef(new Set())` initializer could theoretically allocate a new set on remount. (I don't think this actually happens — refs persist — but worth verifying.)
6. **`splitNewChunks` returning empty for the actual narration shape.** If the narrator output never hits a `\n\n` and is under 600 chars, during streaming nothing emits. At stream end with `flush=true` it *should* emit the full text. If the gate is fine but `splitNewChunks` returns `chunks=[]` somehow at flush, no fetch happens. Verify by logging `chunks.length` in the dispatch effect.

## Concrete next steps for a fresh chat

Tell the new agent: **don't fix anything until you can run the dev server and reproduce.** This session's mistake was trying to reason my way to a fix without runtime confirmation.

1. `npm run dev`. Open a world. Confirm no page-load audio (good — fix held).
2. Open DevTools → Network → filter for `/api/tts`. Open Console.
3. Submit a prompt. Watch:
   - Is `/api/tts` requested? **If no:** the gate is denying; instrument it. **If yes:** TTS API is being called but audio isn't playing — check Console for `audio.play()` rejection (autoplay policy).
4. If gate is denying, add temporary `console.log` inside the dispatch effect right before `if (!allowed) return;` printing `effective.turnId`, `effective.streaming`, `effective.source`, `witnessedRef.current.has(effective.turnId)`, `playedRef.current.has(effective.turnId)`. Submit a prompt and step through the log sequence.
5. Also log inside the witness effect: `console.log("witness", { streaming, turnId })`. Confirm it fires with `streaming=true` and a turnId matching what dispatch sees.

## Files to read first

- `src/components/useNarratorAudio.ts` — the hook with the witness/played gate
- `src/components/Chat.tsx` — `useChat` consumer, computes `narratableTurn`
- `src/lib/sentence-splitter.ts` — `splitNewChunks` (paragraph-first, 600-char soft cap)
- `src/app/api/chat/route.ts` — narrator stream endpoint
- `src/app/api/tts/route.ts` — TTS endpoint (xAI)
- `docs/plans/milestones/v0.5.1-audio-chunking.md` — the chunking spec landed in `8b05352`

## Don'ts

- Don't theorize-and-edit without confirming what's actually firing in the browser. (My session today.)
- Don't commit any of the four modified files until the auto-play bug is actually fixed end-to-end. The cosmetic version bump and the worlds-card turn-count fix are correct on their own, but bundling them in the same commit as a broken audio fix muddies the bisect history.
- The original `audio_hotfix_pending` memory entry was edited to `audio_hotfix_shipped` during this session — **it isn't actually shipped**. Either re-flip that memory or write a new entry that supersedes it.

## Restore points

- Last good commit (audio chunking only, no witness gate): `8b05352`. `git checkout 8b05352 -- src/components/useNarratorAudio.ts` will undo today's audio changes specifically. The replay-button bug fix (the `streaming` gate on the override-clear effect) is also in that file's diff — losing it brings bug A back.
- DB rolled back to pre-v5 (`user_version = 4`); v5-state archived at `backups/chronicles.sqlite.v5-state-20260525`.
