import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BoardExport,
  BoardSnapshot,
  Bootstrap,
  Card,
  Column,
  Participant,
  Tag,
  TagColor,
  TrashItem,
  TrashItemType,
} from "../shared/contracts";
import { defaultTagColor, hexColorSchema, tagColorSchema } from "../shared/contracts";

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

const legacyTagColors: Record<string, TagColor> = {
  neutral: defaultTagColor,
  red: "#c15b53",
  amber: "#b87d26",
  green: "#4f8a62",
  blue: "#4f78b8",
  violet: "#8064b2",
};

function tagColorFromRow(value: SqliteValue): TagColor {
  const color = String(value);
  const parsed = tagColorSchema.safeParse(color);
  return parsed.success ? parsed.data : (legacyTagColors[color] ?? defaultTagColor);
}

function colorFromRow(value: SqliteValue): TagColor {
  const parsed = hexColorSchema.safeParse(String(value));
  return parsed.success ? parsed.data : defaultTagColor;
}

export function openDatabase(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "shale.sqlite"), { create: true });
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  seedSandbox(db);
  ensureGlobalBoardSlugs(db);
  return db;
}

export function openTestDatabase(): Database {
  const db = new Database(":memory:", { create: true, strict: true });
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  seedSandbox(db);
  ensureGlobalBoardSlugs(db);
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
    insertTag.run("tag-getting-started", fixture.boardId, "Getting started", "#4f78b8", 0);
    insertTag.run("tag-collaboration", fixture.boardId, "Collaboration", "#4f8a62", 1);
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
        "SELECT id, display_name, active, avatar_data_url, color, revision FROM participants ORDER BY display_name COLLATE NOCASE",
      )
      .all(),
  ).map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name),
    active: Boolean(row.active),
    avatarDataUrl: row.avatar_data_url === null ? null : String(row.avatar_data_url),
    color: colorFromRow(row.color),
    revision: Number(row.revision),
  }));
}

export type UpdateParticipantResult =
  | { status: "ok"; participant: Participant }
  | { status: "conflict"; participant: Participant }
  | { status: "not_found" }
  | { status: "duplicate" };

export function updateParticipant(
  db: Database,
  participantId: string,
  displayName: string,
  normalizedName: string,
  avatarDataUrl: string | null | undefined,
  color: TagColor | undefined,
  revision: number,
): UpdateParticipantResult {
  const row = db
    .query(
      "SELECT id, display_name, active, avatar_data_url, color, revision FROM participants WHERE id = ?",
    )
    .get(participantId) as Row | null;
  if (!row) return { status: "not_found" };
  const current = {
    id: String(row.id),
    displayName: String(row.display_name),
    active: Boolean(row.active),
    avatarDataUrl: row.avatar_data_url === null ? null : String(row.avatar_data_url),
    color: colorFromRow(row.color),
    revision: Number(row.revision),
  };
  if (current.revision !== revision) return { status: "conflict", participant: current };
  try {
    const result = db
      .query(
        `UPDATE participants
        SET display_name = ?, normalized_name = ?, avatar_data_url = ?, color = ?,
          revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ?`,
      )
      .run(
        displayName,
        normalizedName,
        avatarDataUrl === undefined ? current.avatarDataUrl : avatarDataUrl,
        color ?? current.color,
        now(),
        participantId,
        revision,
      );
    if (result.changes === 0) return { status: "conflict", participant: current };
  } catch {
    return { status: "duplicate" };
  }
  return {
    status: "ok",
    participant: {
      ...current,
      displayName,
      avatarDataUrl: avatarDataUrl === undefined ? current.avatarDataUrl : avatarDataUrl,
      color: color ?? current.color,
      revision: revision + 1,
    },
  };
}

export function deleteParticipant(
  db: Database,
  participantId: string,
): { status: "ok" } | { status: "not_found" } {
  return db.transaction(() => {
    if (!db.query("SELECT id FROM participants WHERE id = ?").get(participantId)) {
      return { status: "not_found" as const };
    }
    db.query(
      `UPDATE cards
      SET revision = revision + 1, updated_at = ?
      WHERE id IN (SELECT card_id FROM card_assignees WHERE participant_id = ?)`,
    ).run(now(), participantId);
    db.query("DELETE FROM card_assignees WHERE participant_id = ?").run(participantId);
    db.query(
      "UPDATE comments SET author_participant_id = NULL WHERE author_participant_id = ?",
    ).run(participantId);
    db.query("DELETE FROM participants WHERE id = ?").run(participantId);
    return { status: "ok" as const };
  })();
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
          "SELECT id, name, slug, workspace_id, revision FROM boards WHERE workspace_id = ? AND trashed_at IS NULL ORDER BY position",
        )
        .all(workspace.id),
    ).map((board) => ({
      id: String(board.id),
      name: String(board.name),
      slug: String(board.slug),
      workspaceId: String(board.workspace_id),
      revision: Number(board.revision),
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
        "SELECT tags.id, tags.name, tags.color, tags.revision FROM tags JOIN card_tags ON card_tags.label_id = tags.id WHERE card_tags.card_id = ? ORDER BY tags.position",
      )
      .all(row.id),
  ).map((tag) => ({
    id: String(tag.id),
    name: String(tag.name),
    color: tagColorFromRow(tag.color),
    revision: Number(tag.revision),
  }));
  const assigneeIds = asRows(
    db
      .query(
        `SELECT card_assignees.participant_id
        FROM card_assignees
        JOIN participants ON participants.id = card_assignees.participant_id
        WHERE card_assignees.card_id = ?
        ORDER BY participants.display_name COLLATE NOCASE`,
      )
      .all(row.id),
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

function boardSnapshotFromRow(db: Database, row: Row): BoardSnapshot {
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
      .query("SELECT id, name, color, revision FROM tags WHERE board_id = ? ORDER BY position")
      .all(row.board_id),
  ).map((tag) => ({
    id: String(tag.id),
    name: String(tag.name),
    color: tagColorFromRow(tag.color),
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
      revision: Number(row.board_revision),
    },
    tags,
    columns,
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
        boards.revision AS board_revision, workspaces.id AS workspace_id,
        workspaces.name AS workspace_name, workspaces.slug AS workspace_slug,
        workspaces.is_sandbox
      FROM boards JOIN workspaces ON workspaces.id = boards.workspace_id
      WHERE workspaces.slug = ? COLLATE NOCASE AND boards.slug = ? COLLATE NOCASE
        AND workspaces.trashed_at IS NULL AND boards.trashed_at IS NULL`,
    )
    .get(workspaceSlug, boardSlug) as Row | null;
  return row ? boardSnapshotFromRow(db, row) : null;
}

export function getBoardById(db: Database, boardId: string): BoardSnapshot | null {
  const row = db
    .query(
      `SELECT boards.id AS board_id, boards.name AS board_name, boards.slug AS board_slug,
        boards.revision AS board_revision, workspaces.id AS workspace_id,
        workspaces.name AS workspace_name, workspaces.slug AS workspace_slug,
        workspaces.is_sandbox
      FROM boards JOIN workspaces ON workspaces.id = boards.workspace_id
      WHERE boards.id = ? AND workspaces.trashed_at IS NULL AND boards.trashed_at IS NULL`,
    )
    .get(boardId) as Row | null;
  return row ? boardSnapshotFromRow(db, row) : null;
}

export function getBoardBySlug(db: Database, boardSlug: string): BoardSnapshot | null {
  const row = db
    .query(
      `SELECT boards.id AS board_id, boards.name AS board_name, boards.slug AS board_slug,
        boards.revision AS board_revision, workspaces.id AS workspace_id,
        workspaces.name AS workspace_name, workspaces.slug AS workspace_slug,
        workspaces.is_sandbox
      FROM boards JOIN workspaces ON workspaces.id = boards.workspace_id
      WHERE boards.slug = ? COLLATE NOCASE
        AND workspaces.trashed_at IS NULL AND boards.trashed_at IS NULL`,
    )
    .get(boardSlug) as Row | null;
  return row ? boardSnapshotFromRow(db, row) : null;
}

export function getCard(db: Database, cardId: string): Card | null {
  const row = db
    .query(
      "SELECT id, column_id, title, description, position, revision FROM cards WHERE id = ? AND trashed_at IS NULL",
    )
    .get(cardId) as Row | null;
  return row ? cardFromRow(db, row) : null;
}

function boardSlug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "board"
  );
}

function normalizedBoardName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function boardNameExists(db: Database, name: string, excludingId?: string): boolean {
  const normalized = normalizedBoardName(name);
  return asRows(db.query("SELECT id, name FROM boards").all()).some(
    (board) =>
      String(board.id) !== excludingId && normalizedBoardName(String(board.name)) === normalized,
  );
}

function boardSlugExists(db: Database, slug: string, excludingId?: string): boolean {
  return Boolean(
    db
      .query("SELECT 1 FROM boards WHERE slug = ? COLLATE NOCASE AND id <> ?")
      .get(slug, excludingId ?? ""),
  );
}

function ensureGlobalBoardSlugs(db: Database): void {
  db.transaction(() => {
    const used = new Set<string>();
    const boards = asRows(db.query("SELECT id, slug FROM boards ORDER BY created_at, id").all());
    const update = db.query(
      "UPDATE boards SET slug = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
    );
    const timestamp = now();
    for (const board of boards) {
      const original = String(board.slug);
      let slug = original;
      let suffix = 2;
      while (used.has(slug.toLocaleLowerCase("en-US"))) {
        slug = `${original}-${suffix}`;
        suffix += 1;
      }
      used.add(slug.toLocaleLowerCase("en-US"));
      if (slug !== original) update.run(slug, timestamp, board.id);
    }
  })();
}

export type CreateBoardResult =
  | { status: "ok"; board: BoardSnapshot["board"] }
  | { status: "duplicate_name" }
  | { status: "duplicate_slug" };

export function createBoard(db: Database, boardId: string, name: string): CreateBoardResult {
  return db.transaction((): CreateBoardResult => {
    if (boardNameExists(db, name)) return { status: "duplicate_name" };
    const slug = boardSlug(name);
    if (boardSlugExists(db, slug)) return { status: "duplicate_slug" };
    const timestamp = now();
    const workspaceId = "shale-default-workspace";
    if (!db.query("SELECT 1 FROM workspaces WHERE id = ?").get(workspaceId)) {
      const workspacePosition = Number(
        (
          db
            .query("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM workspaces")
            .get() as Row
        ).position,
      );
      db.query(
        `INSERT INTO workspaces
        (id, name, slug, is_sandbox, position, created_at, updated_at)
        VALUES (?, 'Boards', 'boards', 0, ?, ?, ?)`,
      ).run(workspaceId, workspacePosition, timestamp, timestamp);
    } else {
      db.query("UPDATE workspaces SET trashed_at = NULL, updated_at = ? WHERE id = ?").run(
        timestamp,
        workspaceId,
      );
    }
    const position = Number(
      (
        db
          .query(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM boards WHERE workspace_id = ?",
          )
          .get(workspaceId) as Row
      ).position,
    );
    db.query(
      `INSERT INTO boards
      (id, workspace_id, name, slug, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(boardId, workspaceId, name, slug, position, timestamp, timestamp);
    const insertColumn = db.query(
      `INSERT INTO board_columns
      (id, board_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    ["Backlog", "In progress", "Done"].forEach((title, columnPosition) => {
      insertColumn.run(randomUUID(), boardId, title, columnPosition, timestamp, timestamp);
    });
    return {
      status: "ok",
      board: { id: boardId, name, slug, workspaceId, revision: 1 },
    };
  })();
}

export type UpdateBoardResult =
  | { status: "ok"; board: BoardSnapshot["board"] }
  | { status: "conflict"; board: BoardSnapshot["board"] }
  | { status: "duplicate_name" }
  | { status: "not_found" };

export function updateBoard(
  db: Database,
  boardId: string,
  name: string,
  revision: number,
): UpdateBoardResult {
  const snapshot = getBoardById(db, boardId);
  if (!snapshot) return { status: "not_found" };
  if (snapshot.board.revision !== revision) {
    return { status: "conflict", board: snapshot.board };
  }
  if (boardNameExists(db, name, boardId)) return { status: "duplicate_name" };
  const result = db
    .query(
      `UPDATE boards SET name = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ? AND trashed_at IS NULL`,
    )
    .run(name, now(), boardId, revision);
  if (result.changes === 0) return { status: "conflict", board: snapshot.board };
  return {
    status: "ok",
    board: { ...snapshot.board, name, revision: revision + 1 },
  };
}

export type UpdateBoardSlugResult =
  | { status: "ok"; board: BoardSnapshot["board"] }
  | { status: "conflict"; board: BoardSnapshot["board"] }
  | { status: "duplicate" }
  | { status: "not_found" };

export function updateBoardSlug(
  db: Database,
  boardId: string,
  slug: string,
  revision: number,
): UpdateBoardSlugResult {
  const snapshot = getBoardById(db, boardId);
  if (!snapshot) return { status: "not_found" };
  if (snapshot.board.revision !== revision) {
    return { status: "conflict", board: snapshot.board };
  }
  if (boardSlugExists(db, slug, boardId)) return { status: "duplicate" };
  const result = db
    .query(
      `UPDATE boards SET slug = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ? AND trashed_at IS NULL`,
    )
    .run(slug, now(), boardId, revision);
  if (result.changes === 0) return { status: "conflict", board: snapshot.board };
  return {
    status: "ok",
    board: { ...snapshot.board, slug, revision: revision + 1 },
  };
}

export function createColumn(
  db: Database,
  columnId: string,
  boardId: string,
  title: string,
): Column | null {
  return db.transaction(() => {
    if (!getBoardById(db, boardId)) return null;
    const position = Number(
      (
        db
          .query(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM board_columns WHERE board_id = ? AND trashed_at IS NULL",
          )
          .get(boardId) as Row
      ).position,
    );
    const timestamp = now();
    db.query(
      `INSERT INTO board_columns
      (id, board_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(columnId, boardId, title, position, timestamp, timestamp);
    return { id: columnId, title, position, revision: 1, cards: [] };
  })();
}

export type UpdateColumnResult =
  | { status: "ok"; column: Column }
  | { status: "conflict"; column: Column }
  | { status: "not_found" };

function getColumn(db: Database, columnId: string): Column | null {
  const row = db
    .query(
      `SELECT board_columns.id, board_columns.title, board_columns.position,
        board_columns.revision, board_columns.board_id
      FROM board_columns JOIN boards ON boards.id = board_columns.board_id
      JOIN workspaces ON workspaces.id = boards.workspace_id
      WHERE board_columns.id = ? AND board_columns.trashed_at IS NULL
        AND boards.trashed_at IS NULL AND workspaces.trashed_at IS NULL`,
    )
    .get(columnId) as Row | null;
  if (!row) return null;
  const cards = asRows(
    db
      .query(
        "SELECT id, column_id, title, description, position, revision FROM cards WHERE column_id = ? AND trashed_at IS NULL ORDER BY position",
      )
      .all(columnId),
  ).map((card) => cardFromRow(db, card));
  return {
    id: String(row.id),
    title: String(row.title),
    position: Number(row.position),
    revision: Number(row.revision),
    cards,
  };
}

export function updateColumn(
  db: Database,
  columnId: string,
  title: string,
  revision: number,
): UpdateColumnResult {
  const current = getColumn(db, columnId);
  if (!current) return { status: "not_found" };
  if (current.revision !== revision) return { status: "conflict", column: current };
  const result = db
    .query(
      `UPDATE board_columns SET title = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ? AND trashed_at IS NULL`,
    )
    .run(title, now(), columnId, revision);
  if (result.changes === 0) return { status: "conflict", column: current };
  return { status: "ok", column: { ...current, title, revision: revision + 1 } };
}

export function createCard(
  db: Database,
  cardId: string,
  columnId: string,
  title: string,
  description: string,
): Card | null {
  return db.transaction(() => {
    const column = db
      .query(
        `SELECT board_columns.id FROM board_columns
        JOIN boards ON boards.id = board_columns.board_id
        JOIN workspaces ON workspaces.id = boards.workspace_id
        WHERE board_columns.id = ? AND board_columns.trashed_at IS NULL
          AND boards.trashed_at IS NULL AND workspaces.trashed_at IS NULL`,
      )
      .get(columnId);
    if (!column) return null;
    const position = Number(
      (
        db
          .query(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cards WHERE column_id = ? AND trashed_at IS NULL",
          )
          .get(columnId) as Row
      ).position,
    );
    const timestamp = now();
    db.query(
      `INSERT INTO cards
      (id, column_id, title, description, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(cardId, columnId, title, description, position, timestamp, timestamp);
    return getCard(db, cardId);
  })();
}

export function exportBoard(db: Database, boardId: string): BoardExport | null {
  const board = db
    .query("SELECT id, name FROM boards WHERE id = ? AND trashed_at IS NULL")
    .get(boardId) as Row | null;
  if (!board) return null;

  const tags = asRows(
    db.query("SELECT id, name, color FROM tags WHERE board_id = ? ORDER BY position").all(boardId),
  ).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    color: tagColorFromRow(row.color),
  }));
  const personIds = new Set<string>();
  const columns = asRows(
    db
      .query(
        "SELECT id, title FROM board_columns WHERE board_id = ? AND trashed_at IS NULL ORDER BY position",
      )
      .all(boardId),
  ).map((column) => ({
    title: String(column.title),
    cards: asRows(
      db
        .query(
          "SELECT id, title, description FROM cards WHERE column_id = ? AND trashed_at IS NULL ORDER BY position",
        )
        .all(column.id),
    ).map((card) => {
      const tagIds = asRows(
        db.query("SELECT label_id FROM card_tags WHERE card_id = ? ORDER BY label_id").all(card.id),
      ).map((row) => String(row.label_id));
      const assigneeIds = asRows(
        db
          .query(
            "SELECT participant_id FROM card_assignees WHERE card_id = ? ORDER BY participant_id",
          )
          .all(card.id),
      ).map((row) => {
        const id = String(row.participant_id);
        personIds.add(id);
        return id;
      });
      const comments = asRows(
        db
          .query(
            `SELECT author_participant_id, author_name, body, created_at
            FROM comments WHERE card_id = ? ORDER BY created_at, id`,
          )
          .all(card.id),
      ).map((row) => {
        const authorParticipantId =
          row.author_participant_id === null ? null : String(row.author_participant_id);
        if (authorParticipantId) personIds.add(authorParticipantId);
        return {
          authorParticipantId,
          authorName: String(row.author_name),
          body: String(row.body),
          createdAt: String(row.created_at),
        };
      });
      return {
        title: String(card.title),
        description: String(card.description),
        tagIds,
        assigneeIds,
        comments,
      };
    }),
  }));
  const people = getParticipants(db)
    .filter((person) => personIds.has(person.id))
    .map(({ id, displayName, avatarDataUrl, color }) => ({
      id,
      displayName,
      avatarDataUrl,
      color,
    }));

  return {
    format: "shale-board",
    version: 1,
    exportedAt: now(),
    board: { name: String(board.name), tags, people, columns },
  };
}

export type ImportBoardResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "duplicate_name" }
  | { status: "invalid_data" };

function normalizedPersonName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function importBoard(db: Database, boardId: string, input: BoardExport): ImportBoardResult {
  const board = db.query("SELECT id FROM boards WHERE id = ? AND trashed_at IS NULL").get(boardId);
  if (!board) return { status: "not_found" };
  if (boardNameExists(db, input.board.name, boardId)) return { status: "duplicate_name" };

  const tagIds = new Set<string>();
  const tagNames = new Set<string>();
  for (const tag of input.board.tags) {
    const normalized = tag.name.toLocaleLowerCase();
    if (tagIds.has(tag.id) || tagNames.has(normalized)) return { status: "invalid_data" };
    tagIds.add(tag.id);
    tagNames.add(normalized);
  }
  const personIds = new Set<string>();
  const personNames = new Set<string>();
  for (const person of input.board.people) {
    const normalized = normalizedPersonName(person.displayName);
    if (personIds.has(person.id) || personNames.has(normalized)) return { status: "invalid_data" };
    personIds.add(person.id);
    personNames.add(normalized);
  }
  for (const column of input.board.columns) {
    for (const card of column.cards) {
      if (
        new Set(card.tagIds).size !== card.tagIds.length ||
        new Set(card.assigneeIds).size !== card.assigneeIds.length ||
        card.tagIds.some((id) => !tagIds.has(id)) ||
        card.assigneeIds.some((id) => !personIds.has(id)) ||
        card.comments.some(
          (comment) =>
            comment.authorParticipantId !== null && !personIds.has(comment.authorParticipantId),
        )
      ) {
        return { status: "invalid_data" };
      }
    }
  }

  return db.transaction((): ImportBoardResult => {
    const importedPeople = new Map<string, string>();
    const timestamp = now();
    for (const person of input.board.people) {
      const normalized = normalizedPersonName(person.displayName);
      const existing = db
        .query("SELECT id FROM participants WHERE normalized_name = ?")
        .get(normalized) as Row | null;
      if (existing) {
        importedPeople.set(person.id, String(existing.id));
      } else {
        const id = randomUUID();
        db.query(
          `INSERT INTO participants
          (id, display_name, normalized_name, active, avatar_data_url, color, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
        ).run(
          id,
          person.displayName,
          normalized,
          person.avatarDataUrl,
          person.color,
          timestamp,
          timestamp,
        );
        importedPeople.set(person.id, id);
      }
    }

    const boardCardIds = `SELECT cards.id FROM cards
      JOIN board_columns ON board_columns.id = cards.column_id
      WHERE board_columns.board_id = ?`;
    db.query(`DELETE FROM comments WHERE card_id IN (${boardCardIds})`).run(boardId);
    db.query(`DELETE FROM card_assignees WHERE card_id IN (${boardCardIds})`).run(boardId);
    db.query(`DELETE FROM card_tags WHERE card_id IN (${boardCardIds})`).run(boardId);
    db.query(`DELETE FROM cards WHERE id IN (${boardCardIds})`).run(boardId);
    db.query("DELETE FROM board_columns WHERE board_id = ?").run(boardId);
    db.query("DELETE FROM tags WHERE board_id = ?").run(boardId);

    const importedTags = new Map<string, string>();
    input.board.tags.forEach((tag, position) => {
      const id = randomUUID();
      db.query("INSERT INTO tags (id, board_id, name, color, position) VALUES (?, ?, ?, ?, ?)").run(
        id,
        boardId,
        tag.name,
        tag.color,
        position,
      );
      importedTags.set(tag.id, id);
    });

    input.board.columns.forEach((column, columnPosition) => {
      const columnId = randomUUID();
      db.query(
        `INSERT INTO board_columns
        (id, board_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(columnId, boardId, column.title, columnPosition, timestamp, timestamp);
      column.cards.forEach((card, cardPosition) => {
        const cardId = randomUUID();
        db.query(
          `INSERT INTO cards
          (id, column_id, title, description, position, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(cardId, columnId, card.title, card.description, cardPosition, timestamp, timestamp);
        for (const oldTagId of card.tagIds) {
          db.query("INSERT INTO card_tags (card_id, label_id) VALUES (?, ?)").run(
            cardId,
            importedTags.get(oldTagId) as string,
          );
        }
        for (const oldPersonId of card.assigneeIds) {
          db.query("INSERT INTO card_assignees (card_id, participant_id) VALUES (?, ?)").run(
            cardId,
            importedPeople.get(oldPersonId) as string,
          );
        }
        for (const comment of card.comments) {
          db.query(
            `INSERT INTO comments
            (id, card_id, author_participant_id, author_name, body, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            randomUUID(),
            cardId,
            comment.authorParticipantId
              ? (importedPeople.get(comment.authorParticipantId) ?? null)
              : null,
            comment.authorName,
            comment.body,
            comment.createdAt,
            comment.createdAt,
          );
        }
      });
    });
    db.query(
      "UPDATE boards SET name = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
    ).run(input.board.name, timestamp, boardId);
    return { status: "ok" };
  })();
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
  color: TagColor,
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
    db.query("INSERT INTO tags (id, board_id, name, color, position) VALUES (?, ?, ?, ?, ?)").run(
      tagId,
      boardId,
      name,
      color,
      position,
    );
  } catch {
    return { status: "duplicate" };
  }
  return { status: "ok", tag: { id: tagId, name, color, revision: 1 } };
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
  color: TagColor,
  revision: number,
): UpdateTagResult {
  const row = db
    .query("SELECT id, name, color, revision, board_id FROM tags WHERE id = ?")
    .get(tagId) as Row | null;
  if (!row) return { status: "not_found" };
  const current = {
    id: String(row.id),
    name: String(row.name),
    color: tagColorFromRow(row.color),
    revision: Number(row.revision),
  };
  if (current.revision !== revision) return { status: "conflict", tag: current };
  try {
    const result = db
      .query(
        "UPDATE tags SET name = ?, color = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
      )
      .run(name, color, tagId, revision);
    if (result.changes === 0) return { status: "conflict", tag: current };
  } catch {
    return { status: "duplicate" };
  }
  return {
    status: "ok",
    tag: { id: tagId, name, color, revision: revision + 1 },
    boardId: String(row.board_id),
  };
}

export function deleteTag(
  db: Database,
  tagId: string,
): { status: "ok"; boardId: string } | { status: "not_found" } {
  const row = db.query("SELECT board_id FROM tags WHERE id = ?").get(tagId) as Row | null;
  if (!row) return { status: "not_found" };
  db.transaction(() => {
    db.query(
      `UPDATE cards
      SET revision = revision + 1, updated_at = ?
      WHERE id IN (SELECT card_id FROM card_tags WHERE label_id = ?)`,
    ).run(now(), tagId);
    db.query("DELETE FROM tags WHERE id = ?").run(tagId);
  })();
  return { status: "ok", boardId: String(row.board_id) };
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

export type UpdateCardAssigneesResult =
  | { status: "ok"; card: Card }
  | { status: "conflict"; card: Card }
  | { status: "not_found" }
  | { status: "invalid_participant" };

export function updateCardAssignees(
  db: Database,
  cardId: string,
  assigneeIds: string[],
  revision: number,
): UpdateCardAssigneesResult {
  return db.transaction((): UpdateCardAssigneesResult => {
    const current = getCard(db, cardId);
    if (!current) return { status: "not_found" };
    if (current.revision !== revision) return { status: "conflict", card: current };

    for (const participantId of assigneeIds) {
      const participant = db
        .query("SELECT id FROM participants WHERE id = ? AND active = 1")
        .get(participantId);
      if (!participant) return { status: "invalid_participant" };
    }

    db.query("DELETE FROM card_assignees WHERE card_id = ?").run(cardId);
    const assign = db.query("INSERT INTO card_assignees (card_id, participant_id) VALUES (?, ?)");
    for (const participantId of assigneeIds) assign.run(cardId, participantId);
    db.query("UPDATE cards SET revision = revision + 1, updated_at = ? WHERE id = ?").run(
      now(),
      cardId,
    );
    const updated = getCard(db, cardId);
    return updated ? { status: "ok", card: updated } : { status: "not_found" };
  })();
}

export function getTrash(db: Database): TrashItem[] {
  const boards = asRows(
    db
      .query(
        `SELECT boards.id, boards.name, boards.trashed_at, workspaces.name AS workspace_name
        FROM boards JOIN workspaces ON workspaces.id = boards.workspace_id
        WHERE boards.trashed_at IS NOT NULL AND workspaces.trashed_at IS NULL`,
      )
      .all(),
  ).map((row) => ({
    id: String(row.id),
    type: "board" as const,
    name: String(row.name),
    context: "Board",
    trashedAt: String(row.trashed_at),
  }));
  const columns = asRows(
    db
      .query(
        `SELECT board_columns.id, board_columns.title, board_columns.trashed_at,
          boards.name AS board_name, workspaces.name AS workspace_name
        FROM board_columns
        JOIN boards ON boards.id = board_columns.board_id
        JOIN workspaces ON workspaces.id = boards.workspace_id
        WHERE board_columns.trashed_at IS NOT NULL
          AND boards.trashed_at IS NULL AND workspaces.trashed_at IS NULL`,
      )
      .all(),
  ).map((row) => ({
    id: String(row.id),
    type: "column" as const,
    name: String(row.title),
    context: String(row.board_name),
    trashedAt: String(row.trashed_at),
  }));
  const cards = asRows(
    db
      .query(
        `SELECT cards.id, cards.title, cards.trashed_at, board_columns.title AS column_title,
          boards.name AS board_name, workspaces.name AS workspace_name
        FROM cards
        JOIN board_columns ON board_columns.id = cards.column_id
        JOIN boards ON boards.id = board_columns.board_id
        JOIN workspaces ON workspaces.id = boards.workspace_id
        WHERE cards.trashed_at IS NOT NULL AND board_columns.trashed_at IS NULL
          AND boards.trashed_at IS NULL AND workspaces.trashed_at IS NULL`,
      )
      .all(),
  ).map((row) => ({
    id: String(row.id),
    type: "card" as const,
    name: String(row.title),
    context: `${String(row.board_name)} / ${String(row.column_title)}`,
    trashedAt: String(row.trashed_at),
  }));
  return [...boards, ...columns, ...cards].sort((left, right) =>
    right.trashedAt.localeCompare(left.trashedAt),
  );
}

export type TrashMutationResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "invalid_parent" };

function normalizeCardPositions(db: Database, columnId: string, timestamp: string): void {
  const ids = asRows(
    db
      .query("SELECT id FROM cards WHERE column_id = ? AND trashed_at IS NULL ORDER BY position")
      .all(columnId),
  ).map((row) => String(row.id));
  db.query(
    "UPDATE cards SET position = position + 1000000 WHERE column_id = ? AND trashed_at IS NULL",
  ).run(columnId);
  const place = db.query(
    "UPDATE cards SET position = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
  );
  ids.forEach((id, position) => {
    place.run(position, timestamp, id);
  });
}

function normalizeColumnPositions(db: Database, boardId: string, timestamp: string): void {
  const ids = asRows(
    db
      .query(
        "SELECT id FROM board_columns WHERE board_id = ? AND trashed_at IS NULL ORDER BY position",
      )
      .all(boardId),
  ).map((row) => String(row.id));
  db.query(
    "UPDATE board_columns SET position = position + 2000000 WHERE board_id = ? AND trashed_at IS NULL",
  ).run(boardId);
  const place = db.query(
    "UPDATE board_columns SET position = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
  );
  ids.forEach((columnId, position) => {
    place.run(position, timestamp, columnId);
  });
}

export function trashEntity(db: Database, type: TrashItemType, id: string): TrashMutationResult {
  return db.transaction((): TrashMutationResult => {
    const timestamp = now();
    if (type === "card") {
      const row = db
        .query("SELECT column_id FROM cards WHERE id = ? AND trashed_at IS NULL")
        .get(id) as Row | null;
      if (!row) return { status: "not_found" };
      db.query(
        "UPDATE cards SET trashed_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
      ).run(timestamp, timestamp, id);
      normalizeCardPositions(db, String(row.column_id), timestamp);
      return { status: "ok" };
    }
    if (type === "column") {
      const row = db
        .query("SELECT board_id FROM board_columns WHERE id = ? AND trashed_at IS NULL")
        .get(id) as Row | null;
      if (!row) return { status: "not_found" };
      const parkedPosition =
        Number(
          (
            db
              .query(
                "SELECT COALESCE(MAX(position), 0) AS position FROM board_columns WHERE board_id = ?",
              )
              .get(row.board_id) as Row
          ).position,
        ) + 1_000_000;
      db.query(
        "UPDATE board_columns SET trashed_at = ?, position = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
      ).run(timestamp, parkedPosition, timestamp, id);
      normalizeColumnPositions(db, String(row.board_id), timestamp);
      return { status: "ok" };
    }
    const table = type === "workspace" ? "workspaces" : "boards";
    const result = db
      .query(
        `UPDATE ${table} SET trashed_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND trashed_at IS NULL`,
      )
      .run(timestamp, timestamp, id);
    return result.changes ? { status: "ok" } : { status: "not_found" };
  })();
}

export function restoreEntity(db: Database, type: TrashItemType, id: string): TrashMutationResult {
  return db.transaction((): TrashMutationResult => {
    const timestamp = now();
    if (type === "card") {
      const row = db
        .query(
          `SELECT cards.column_id
          FROM cards
          JOIN board_columns ON board_columns.id = cards.column_id
          JOIN boards ON boards.id = board_columns.board_id
          JOIN workspaces ON workspaces.id = boards.workspace_id
          WHERE cards.id = ? AND cards.trashed_at IS NOT NULL
            AND board_columns.trashed_at IS NULL AND boards.trashed_at IS NULL
            AND workspaces.trashed_at IS NULL`,
        )
        .get(id) as Row | null;
      if (!row) {
        return db.query("SELECT 1 FROM cards WHERE id = ? AND trashed_at IS NOT NULL").get(id)
          ? { status: "invalid_parent" }
          : { status: "not_found" };
      }
      const position = Number(
        (
          db
            .query(
              "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cards WHERE column_id = ? AND trashed_at IS NULL",
            )
            .get(row.column_id) as Row
        ).position,
      );
      db.query(
        "UPDATE cards SET trashed_at = NULL, position = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
      ).run(position, timestamp, id);
      return { status: "ok" };
    }
    if (type === "column") {
      const row = db
        .query(
          `SELECT board_columns.board_id
          FROM board_columns
          JOIN boards ON boards.id = board_columns.board_id
          JOIN workspaces ON workspaces.id = boards.workspace_id
          WHERE board_columns.id = ? AND board_columns.trashed_at IS NOT NULL
            AND boards.trashed_at IS NULL AND workspaces.trashed_at IS NULL`,
        )
        .get(id) as Row | null;
      if (!row) {
        return db
          .query("SELECT 1 FROM board_columns WHERE id = ? AND trashed_at IS NOT NULL")
          .get(id)
          ? { status: "invalid_parent" }
          : { status: "not_found" };
      }
      const position = Number(
        (
          db
            .query(
              "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM board_columns WHERE board_id = ? AND trashed_at IS NULL",
            )
            .get(row.board_id) as Row
        ).position,
      );
      db.query(
        "UPDATE board_columns SET trashed_at = NULL, position = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
      ).run(position, timestamp, id);
      return { status: "ok" };
    }
    if (type === "board") {
      const row = db
        .query(
          `SELECT boards.workspace_id FROM boards
          JOIN workspaces ON workspaces.id = boards.workspace_id
          WHERE boards.id = ? AND boards.trashed_at IS NOT NULL AND workspaces.trashed_at IS NULL`,
        )
        .get(id) as Row | null;
      if (!row) {
        return db.query("SELECT 1 FROM boards WHERE id = ? AND trashed_at IS NOT NULL").get(id)
          ? { status: "invalid_parent" }
          : { status: "not_found" };
      }
      const position = Number(
        (
          db
            .query(
              "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM boards WHERE workspace_id = ? AND trashed_at IS NULL",
            )
            .get(row.workspace_id) as Row
        ).position,
      );
      db.query(
        "UPDATE boards SET trashed_at = NULL, position = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
      ).run(position, timestamp, id);
      return { status: "ok" };
    }
    const position = Number(
      (
        db
          .query(
            "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM workspaces WHERE trashed_at IS NULL",
          )
          .get() as Row
      ).position,
    );
    const result = db
      .query(
        "UPDATE workspaces SET trashed_at = NULL, position = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND trashed_at IS NOT NULL",
      )
      .run(position, timestamp, id);
    return result.changes ? { status: "ok" } : { status: "not_found" };
  })();
}

function permanentlyDeleteBoard(db: Database, boardId: string): void {
  db.query(
    "DELETE FROM cards WHERE column_id IN (SELECT id FROM board_columns WHERE board_id = ?)",
  ).run(boardId);
  db.query("DELETE FROM tags WHERE board_id = ?").run(boardId);
  db.query("DELETE FROM board_columns WHERE board_id = ?").run(boardId);
  db.query("DELETE FROM boards WHERE id = ?").run(boardId);
}

export function permanentlyDeleteEntity(
  db: Database,
  type: TrashItemType,
  id: string,
): TrashMutationResult {
  return db.transaction((): TrashMutationResult => {
    const table =
      type === "workspace"
        ? "workspaces"
        : type === "board"
          ? "boards"
          : type === "column"
            ? "board_columns"
            : "cards";
    if (!db.query(`SELECT 1 FROM ${table} WHERE id = ? AND trashed_at IS NOT NULL`).get(id)) {
      return { status: "not_found" };
    }
    if (type === "workspace") {
      const boardIds = asRows(db.query("SELECT id FROM boards WHERE workspace_id = ?").all(id)).map(
        (row) => String(row.id),
      );
      boardIds.forEach((boardId) => {
        permanentlyDeleteBoard(db, boardId);
      });
      db.query("DELETE FROM workspaces WHERE id = ?").run(id);
    } else if (type === "board") {
      permanentlyDeleteBoard(db, id);
    } else if (type === "column") {
      db.query("DELETE FROM cards WHERE column_id = ?").run(id);
      db.query("DELETE FROM board_columns WHERE id = ?").run(id);
    } else {
      db.query("DELETE FROM cards WHERE id = ?").run(id);
    }
    return { status: "ok" };
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
