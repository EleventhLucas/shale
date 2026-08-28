import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardSnapshot, Bootstrap, Card, Participant, Tag } from "../shared/contracts";

type SqliteValue = string | number | bigint | boolean | Uint8Array | null;
type Row = Record<string, SqliteValue>;

const fixture = {
  workspaceId: "sandbox-workspace",
  boardId: "sandbox-board",
  columns: ["sandbox-backlog", "sandbox-progress", "sandbox-done"],
};

function now(): string {
  return new Date().toISOString();
}

function asRows(value: unknown): Row[] {
  return value as Row[];
}

export function openDatabase(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "shale.sqlite"), { create: true });
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  seedSandbox(db);
  return db;
}

export function openTestDatabase(): Database {
  const db = new Database(":memory:", { create: true, strict: true });
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  seedSandbox(db);
  return db;
}

export function runMigrations(db: Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);",
  );
  const migrationsDir = new URL("../../migrations/", import.meta.url);
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const applied = db.query("SELECT 1 FROM schema_migrations WHERE name = ?");
  const record = db.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");

  for (const file of files) {
    if (applied.get(file)) continue;
    const sql = readFileSync(new URL(file, migrationsDir), "utf8");
    db.transaction(() => {
      db.exec(sql);
      record.run(file, now());
    })();
  }
}

export function seedSandbox(db: Database): void {
  if (db.query("SELECT 1 FROM workspaces WHERE id = ?").get(fixture.workspaceId)) return;
  const timestamp = now();
  db.transaction(() => {
    db.query(
      "INSERT INTO workspaces (id, name, slug, is_sandbox, position, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)",
    ).run(fixture.workspaceId, "Sample Workspace", "sample-workspace", timestamp, timestamp);
    db.query(
      "INSERT INTO boards (id, workspace_id, name, slug, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
    ).run(
      fixture.boardId,
      fixture.workspaceId,
      "Sample Board",
      "sample-board",
      timestamp,
      timestamp,
    );

    const insertColumn = db.query(
      "INSERT INTO board_columns (id, board_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insertColumn.run(fixture.columns[0], fixture.boardId, "Backlog", 0, timestamp, timestamp);
    insertColumn.run(fixture.columns[1], fixture.boardId, "In progress", 1, timestamp, timestamp);
    insertColumn.run(fixture.columns[2], fixture.boardId, "Done", 2, timestamp, timestamp);

    const insertCard = db.query(
      "INSERT INTO cards (id, column_id, title, description, due_date, position, trashed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertCard.run(
      "card-welcome",
      fixture.columns[0],
      "Explore the sample board",
      "Open this card to edit its **Markdown** description. Changes use revision checks so another editor cannot silently overwrite your work.",
      null,
      0,
      null,
      timestamp,
      timestamp,
    );
    insertCard.run(
      "card-live",
      fixture.columns[1],
      "Try live collaboration",
      "Open Shale in a second browser window. A saved card change invalidates the board in every connected session.",
      null,
      0,
      null,
      timestamp,
      timestamp,
    );
    insertCard.run(
      "card-finished",
      fixture.columns[2],
      "Public board reading",
      "This board can be read without unlocking editing.",
      null,
      0,
      null,
      timestamp,
      timestamp,
    );
    insertCard.run(
      "card-trashed-example",
      fixture.columns[0],
      "Restore me from trash",
      "A later slice will expose trash restore and permanent deletion controls.",
      null,
      1,
      timestamp,
      timestamp,
      timestamp,
    );

    const insertTag = db.query(
      "INSERT INTO tags (id, board_id, name, color, position) VALUES (?, ?, ?, ?, ?)",
    );
    insertTag.run("tag-getting-started", fixture.boardId, "Getting started", "neutral", 0);
    insertTag.run("tag-collaboration", fixture.boardId, "Collaboration", "neutral", 1);
    db.query("INSERT INTO card_tags (card_id, label_id) VALUES (?, ?)").run(
      "card-welcome",
      "tag-getting-started",
    );
    db.query("INSERT INTO card_tags (card_id, label_id) VALUES (?, ?)").run(
      "card-live",
      "tag-collaboration",
    );
    db.query(
      "INSERT INTO comments (id, card_id, author_name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "comment-welcome",
      "card-welcome",
      "Shale",
      "This fixture comment demonstrates timestamped plain-text discussion without adding a fake participant.",
      timestamp,
      timestamp,
    );
  })();
}

export function getParticipants(db: Database): Participant[] {
  return asRows(
    db
      .query(
        "SELECT id, display_name, active FROM participants ORDER BY display_name COLLATE NOCASE",
      )
      .all(),
  ).map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name),
    active: Boolean(row.active),
  }));
}

export function getBootstrap(db: Database): Bootstrap {
  const workspaces = asRows(
    db
      .query(
        "SELECT id, name, slug, is_sandbox FROM workspaces WHERE trashed_at IS NULL ORDER BY position",
      )
      .all(),
  ).map((workspace) => {
    const boards = asRows(
      db
        .query(
          "SELECT id, name, slug, workspace_id FROM boards WHERE workspace_id = ? AND trashed_at IS NULL ORDER BY position",
        )
        .all(workspace.id),
    ).map((board) => ({
      id: String(board.id),
      name: String(board.name),
      slug: String(board.slug),
      workspaceId: String(board.workspace_id),
    }));
    return {
      id: String(workspace.id),
      name: String(workspace.name),
      slug: String(workspace.slug),
      isSandbox: Boolean(workspace.is_sandbox),
      boards,
    };
  });
  return { workspaces, participants: getParticipants(db) };
}

function cardFromRow(db: Database, row: Row): Card {
  const tags = asRows(
    db
      .query(
        "SELECT tags.id, tags.name, tags.revision FROM tags JOIN card_tags ON card_tags.label_id = tags.id WHERE card_tags.card_id = ? ORDER BY tags.position",
      )
      .all(row.id),
  ).map((tag) => ({
    id: String(tag.id),
    name: String(tag.name),
    revision: Number(tag.revision),
  }));
  const assigneeIds = asRows(
    db.query("SELECT participant_id FROM card_assignees WHERE card_id = ?").all(row.id),
  ).map((assignee) => String(assignee.participant_id));
  return {
    id: String(row.id),
    columnId: String(row.column_id),
    title: String(row.title),
    description: String(row.description),
    position: Number(row.position),
    revision: Number(row.revision),
    tags,
    assigneeIds,
  };
}

export function getBoard(
  db: Database,
  workspaceSlug: string,
  boardSlug: string,
): BoardSnapshot | null {
  const row = db
    .query(
      `SELECT boards.id AS board_id, boards.name AS board_name, boards.slug AS board_slug,
        workspaces.id AS workspace_id, workspaces.name AS workspace_name,
        workspaces.slug AS workspace_slug, workspaces.is_sandbox
      FROM boards JOIN workspaces ON workspaces.id = boards.workspace_id
      WHERE workspaces.slug = ? COLLATE NOCASE AND boards.slug = ? COLLATE NOCASE
        AND workspaces.trashed_at IS NULL AND boards.trashed_at IS NULL`,
    )
    .get(workspaceSlug, boardSlug) as Row | null;
  if (!row) return null;

  const columns = asRows(
    db
      .query(
        "SELECT id, title, position, revision FROM board_columns WHERE board_id = ? AND trashed_at IS NULL ORDER BY position",
      )
      .all(row.board_id),
  ).map((column) => {
    const cards = asRows(
      db
        .query(
          "SELECT id, column_id, title, description, position, revision FROM cards WHERE column_id = ? AND trashed_at IS NULL ORDER BY position",
        )
        .all(column.id),
    ).map((card) => cardFromRow(db, card));
    return {
      id: String(column.id),
      title: String(column.title),
      position: Number(column.position),
      revision: Number(column.revision),
      cards,
    };
  });

  const tags = asRows(
    db
      .query("SELECT id, name, revision FROM tags WHERE board_id = ? ORDER BY position")
      .all(row.board_id),
  ).map((tag) => ({
    id: String(tag.id),
    name: String(tag.name),
    revision: Number(tag.revision),
  }));

  return {
    workspace: {
      id: String(row.workspace_id),
      name: String(row.workspace_name),
      slug: String(row.workspace_slug),
      isSandbox: Boolean(row.is_sandbox),
    },
    board: {
      id: String(row.board_id),
      name: String(row.board_name),
      slug: String(row.board_slug),
      workspaceId: String(row.workspace_id),
    },
    tags,
    columns,
  };
}

export function getCard(db: Database, cardId: string): Card | null {
  const row = db
    .query(
      "SELECT id, column_id, title, description, position, revision FROM cards WHERE id = ? AND trashed_at IS NULL",
    )
    .get(cardId) as Row | null;
  return row ? cardFromRow(db, row) : null;
}

export type CreateTagResult =
  | { status: "ok"; tag: Tag }
  | { status: "not_found" }
  | { status: "duplicate" };

export function createTag(
  db: Database,
  tagId: string,
  boardId: string,
  name: string,
): CreateTagResult {
  const board = db.query("SELECT id FROM boards WHERE id = ? AND trashed_at IS NULL").get(boardId);
  if (!board) return { status: "not_found" };
  const position = Number(
    (
      db
        .query("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tags WHERE board_id = ?")
        .get(boardId) as Row
    ).position,
  );
  try {
    db.query(
      "INSERT INTO tags (id, board_id, name, color, position) VALUES (?, ?, ?, 'neutral', ?)",
    ).run(tagId, boardId, name, position);
  } catch {
    return { status: "duplicate" };
  }
  return { status: "ok", tag: { id: tagId, name, revision: 1 } };
}

export type UpdateTagResult =
  | { status: "ok"; tag: Tag; boardId: string }
  | { status: "conflict"; tag: Tag }
  | { status: "not_found" }
  | { status: "duplicate" };

export function updateTag(
  db: Database,
  tagId: string,
  name: string,
  revision: number,
): UpdateTagResult {
  const row = db
    .query("SELECT id, name, revision, board_id FROM tags WHERE id = ?")
    .get(tagId) as Row | null;
  if (!row) return { status: "not_found" };
  const current = { id: String(row.id), name: String(row.name), revision: Number(row.revision) };
  if (current.revision !== revision) return { status: "conflict", tag: current };
  try {
    const result = db
      .query("UPDATE tags SET name = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
      .run(name, tagId, revision);
    if (result.changes === 0) return { status: "conflict", tag: current };
  } catch {
    return { status: "duplicate" };
  }
  return {
    status: "ok",
    tag: { id: tagId, name, revision: revision + 1 },
    boardId: String(row.board_id),
  };
}

export type UpdateCardTagsResult =
  | { status: "ok"; card: Card }
  | { status: "conflict"; card: Card }
  | { status: "not_found" }
  | { status: "invalid_tag" };

export function updateCardTags(
  db: Database,
  cardId: string,
  tagIds: string[],
  revision: number,
): UpdateCardTagsResult {
  return db.transaction((): UpdateCardTagsResult => {
    const source = db
      .query(
        `SELECT cards.revision, board_columns.board_id
        FROM cards JOIN board_columns ON board_columns.id = cards.column_id
        WHERE cards.id = ? AND cards.trashed_at IS NULL AND board_columns.trashed_at IS NULL`,
      )
      .get(cardId) as Row | null;
    if (!source) return { status: "not_found" };
    const current = getCard(db, cardId);
    if (!current) return { status: "not_found" };
    if (Number(source.revision) !== revision) return { status: "conflict", card: current };

    for (const tagId of tagIds) {
      const tag = db.query("SELECT board_id FROM tags WHERE id = ?").get(tagId) as Row | null;
      if (!tag || String(tag.board_id) !== String(source.board_id)) {
        return { status: "invalid_tag" };
      }
    }

    db.query("DELETE FROM card_tags WHERE card_id = ?").run(cardId);
    const assign = db.query("INSERT INTO card_tags (card_id, label_id) VALUES (?, ?)");
    for (const tagId of tagIds) assign.run(cardId, tagId);
    db.query("UPDATE cards SET revision = revision + 1, updated_at = ? WHERE id = ?").run(
      now(),
      cardId,
    );
    const updated = getCard(db, cardId);
    return updated ? { status: "ok", card: updated } : { status: "not_found" };
  })();
}

export type MoveCardResult =
  | { status: "ok"; card: Card }
  | { status: "conflict"; card: Card }
  | { status: "not_found" }
  | { status: "invalid_target" };

export function moveCard(
  db: Database,
  cardId: string,
  targetColumnId: string,
  targetPosition: number,
  revision: number,
): MoveCardResult {
  return db
    .transaction((): MoveCardResult => {
      const source = db
        .query(
          `SELECT cards.column_id, cards.revision, board_columns.board_id
          FROM cards JOIN board_columns ON board_columns.id = cards.column_id
          WHERE cards.id = ? AND cards.trashed_at IS NULL AND board_columns.trashed_at IS NULL`,
        )
        .get(cardId) as Row | null;
      if (!source) return { status: "not_found" };

      const current = getCard(db, cardId);
      if (!current) return { status: "not_found" };
      if (Number(source.revision) !== revision) return { status: "conflict", card: current };

      const target = db
        .query("SELECT board_id FROM board_columns WHERE id = ? AND trashed_at IS NULL")
        .get(targetColumnId) as Row | null;
      if (!target || String(target.board_id) !== String(source.board_id)) {
        return { status: "invalid_target" };
      }

      const sourceColumnId = String(source.column_id);
      const idsInColumn = (columnId: string): string[] =>
        asRows(
          db
            .query(
              "SELECT id FROM cards WHERE column_id = ? AND trashed_at IS NULL ORDER BY position",
            )
            .all(columnId),
        ).map((row) => String(row.id));

      const sourceIds = idsInColumn(sourceColumnId).filter((id) => id !== cardId);
      const targetIds =
        sourceColumnId === targetColumnId
          ? sourceIds
          : idsInColumn(targetColumnId).filter((id) => id !== cardId);
      const insertionIndex = Math.min(targetPosition, targetIds.length);
      targetIds.splice(insertionIndex, 0, cardId);

      const shift = db.query(
        "UPDATE cards SET position = position + 1000000 WHERE column_id = ? AND trashed_at IS NULL",
      );
      shift.run(sourceColumnId);
      if (sourceColumnId !== targetColumnId) shift.run(targetColumnId);

      const timestamp = now();
      const place = db.query(
        "UPDATE cards SET column_id = ?, position = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
      );
      if (sourceColumnId !== targetColumnId) {
        sourceIds.forEach((id, position) => {
          place.run(sourceColumnId, position, timestamp, id);
        });
      }
      targetIds.forEach((id, position) => {
        place.run(targetColumnId, position, timestamp, id);
      });

      const moved = getCard(db, cardId);
      return moved ? { status: "ok", card: moved } : { status: "not_found" };
    })
    .immediate();
}
