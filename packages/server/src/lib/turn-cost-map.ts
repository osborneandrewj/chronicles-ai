import type { UIMessage } from "ai";

import type { TurnCost } from "@/lib/turn-cost";

// Concatenate the text parts of a UI message, ignoring tool/data parts.
export function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function findPrevUser(messages: UIMessage[], beforeIdx: number): UIMessage | undefined {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

// Resolve the DB turn id for a message. A freshly-streamed assistant message
// carries the AI SDK's generated `msg-…` id; the real DB id rides in
// `metadata.dbTurnId` (attached by /api/chat once the turn is persisted). A
// history-loaded message instead uses `String(t.id)` as its message id. Prefer
// the explicit dbTurnId, then fall back to a numeric message id. Returns
// undefined for a live turn that hasn't been persisted yet (the `msg-…` window)
// and for meta-command responses (`meta-…`).
export function effectiveDbTurnId(m: UIMessage): number | undefined {
  const dbTurnId = (m.metadata as { dbTurnId?: number } | undefined)?.dbTurnId;
  if (typeof dbTurnId === "number" && Number.isInteger(dbTurnId) && dbTurnId > 0) {
    return dbTurnId;
  }
  const numeric = Number(m.id);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

export function buildCostMap(messages: UIMessage[], usage: TurnCost[]): Map<string, TurnCost> {
  const map = new Map<string, TurnCost>();
  const usageById = new Map<number, TurnCost>(usage.map((t) => [t.id, t]));

  // First pass: match by resolved DB id (metadata.dbTurnId for live turns,
  // numeric message id for history-loaded turns).
  const unmatchedAssistants: UIMessage[] = [];
  const usedTurnIds = new Set<number>();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant") continue;

    // Skip meta-command responses (their preceding user message starts with "/")
    const prevUser = findPrevUser(messages, i);
    if (prevUser && messageText(prevUser).trim().startsWith("/")) continue;

    const dbId = effectiveDbTurnId(m);
    if (dbId !== undefined && usageById.has(dbId)) {
      const cost = usageById.get(dbId)!;
      map.set(m.id, cost);
      usedTurnIds.add(dbId);
    } else {
      unmatchedAssistants.push(m);
    }
  }

  // Second pass: end-align unmatched assistants with remaining usage and pair
  // from the tail backwards. Guarantees the newest streamed turn always gets
  // the newest cost — robust to retry transients where usage may be one entry
  // ahead of messages (or vice versa) on the render after a stream finishes,
  // and to the brief window before a live turn's dbTurnId metadata arrives.
  const remaining = usage.filter((t) => !usedTurnIds.has(t.id));
  const pairCount = Math.min(unmatchedAssistants.length, remaining.length);
  for (let i = 0; i < pairCount; i++) {
    const msg = unmatchedAssistants[unmatchedAssistants.length - 1 - i];
    const cost = remaining[remaining.length - 1 - i];
    map.set(msg.id, cost);
  }

  return map;
}
