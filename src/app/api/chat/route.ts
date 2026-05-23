import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

import { insertTurn, recentTurns } from "@/lib/db";
import { NARRATOR_SYSTEM } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: UIMessage[] };

  const latest = messages[messages.length - 1];
  const playerText = latest?.role === "user" ? extractText(latest) : "";
  if (!playerText) {
    return new Response("Empty player action", { status: 400 });
  }
  insertTurn("user", playerText);

  const history = recentTurns(20).map((t) => ({ role: t.role, content: t.content }));
  const modelMessages = convertToModelMessages(
    history.map((t, i) => ({
      id: String(i),
      role: t.role,
      parts: [{ type: "text" as const, text: t.content }],
    })),
  );

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: NARRATOR_SYSTEM,
    messages: modelMessages,
    onFinish: ({ text }) => {
      if (text.trim().length > 0) insertTurn("assistant", text);
    },
  });

  return result.toUIMessageStreamResponse();
}

function extractText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}
