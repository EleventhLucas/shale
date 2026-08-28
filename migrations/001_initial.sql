CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  is_sandbox INTEGER NOT NULL DEFAULT 0 CHECK (is_sandbox IN (0, 1)),
  position INTEGER NOT NULL CHECK (position >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  trashed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL COLLATE NOCASE,
  position INTEGER NOT NULL CHECK (position >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  trashed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, slug)
);

CREATE TABLE board_columns (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id),
  title TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  trashed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (board_id, position)
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  column_id TEXT NOT NULL REFERENCES board_columns(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  position INTEGER NOT NULL CHECK (position >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  trashed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

CREATE UNIQUE INDEX cards_live_position
  ON cards(column_id, position)
  WHERE trashed_at IS NULL;

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE labels (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (board_id, name COLLATE NOCASE)
);

CREATE TABLE card_labels (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, label_id)
);

CREATE TABLE card_assignees (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  PRIMARY KEY (card_id, participant_id)
);

CREATE TABLE checklist_groups (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (card_id, position)
);

CREATE TABLE checklist_items (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES checklist_groups(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  position INTEGER NOT NULL CHECK (position >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (group_id, position)
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author_participant_id TEXT REFERENCES participants(id),
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  password_fingerprint TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX boards_workspace_position ON boards(workspace_id, position);
CREATE INDEX columns_board_position ON board_columns(board_id, position);
CREATE INDEX cards_column_position ON cards(column_id, position);
CREATE INDEX sessions_expiry ON sessions(expires_at);
