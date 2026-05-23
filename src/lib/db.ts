import Database from "better-sqlite3";
import path from "node:path";

export type TurnRole = "user" | "assistant";

export type Turn = {
  id: number;
  role: TurnRole;
  content: string;
  created_at: string;
};

type Globals = typeof globalThis & { __chroniclesDb?: Database.Database };
const g = globalThis as Globals;

function open(): Database.Database {
  const db = new Database(path.join(process.cwd(), "chronicles.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      role       TEXT    NOT NULL CHECK (role IN ('user','assistant')),
      content    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

export const db: Database.Database = g.__chroniclesDb ?? (g.__chroniclesDb = open());

const insertStmt = db.prepare<[TurnRole, string]>(
  "INSERT INTO turns (role, content) VALUES (?, ?) RETURNING id, role, content, created_at",
);
const allStmt = db.prepare("SELECT id, role, content, created_at FROM turns ORDER BY id ASC");
const recentStmt = db.prepare(
  "SELECT id, role, content FROM turns ORDER BY id DESC LIMIT ?",
);

export function insertTurn(role: TurnRole, content: string): Turn {
  return insertStmt.get(role, content) as Turn;
}

export function allTurns(): Turn[] {
  return allStmt.all() as Turn[];
}

export function recentTurns(limit: number): Array<Pick<Turn, "id" | "role" | "content">> {
  const rows = recentStmt.all(limit) as Array<Pick<Turn, "id" | "role" | "content">>;
  return rows.reverse();
}
