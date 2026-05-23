import { Chat } from "@/components/Chat";
import { allAssistantMetadata, allTurns } from "@/lib/db";
import { summarizeTurn, type TurnCost } from "@/lib/turn-cost";
import type { UIMessage } from "ai";

export const dynamic = "force-dynamic";

export default function Home() {
  const initialMessages: UIMessage[] = allTurns().map((t) => ({
    id: String(t.id),
    role: t.role,
    parts: [{ type: "text", text: t.content }],
  }));

  const initialUsage: TurnCost[] = allAssistantMetadata().map(({ id, metadata }) =>
    summarizeTurn(id, metadata),
  );

  return <Chat initialMessages={initialMessages} initialUsage={initialUsage} />;
}
