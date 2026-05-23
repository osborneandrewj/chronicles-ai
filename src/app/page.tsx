import { Chat } from "@/components/Chat";
import { allTurns } from "@/lib/db";
import type { UIMessage } from "ai";

export const dynamic = "force-dynamic";

export default function Home() {
  const initialMessages: UIMessage[] = allTurns().map((t) => ({
    id: String(t.id),
    role: t.role,
    parts: [{ type: "text", text: t.content }],
  }));

  return <Chat initialMessages={initialMessages} />;
}
