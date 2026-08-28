# Shale 0.1.0 Implementation Plan

## Summary

Build Shale as a minimal, open-source kanban server for small trusted groups.

- The primary deliverable is one Linux x64 Docker image serving both the backend and Web UI.
- Anyone with the unlisted URL can read boards. Editing requires a host-configured shared password
  when one is configured; without one, the instance is publicly editable.
- There are no user accounts or roles. Editors select or create a display name for attribution and assignment; all unlocked editors have equal capabilities.
- SQLite is the only database. PostgreSQL, public APIs, plugins, integrations, and hosted-service functionality are deferred.
- The application remains focused on creating boards, adding cards, and moving work forward.

## Product and Interface

- Organize content as workspaces -> boards -> columns -> cards. Workspaces are organizational only and do not establish permissions.
- Support column reordering and card reordering or movement between columns on the same board.
  - Provide pointer and keyboard drag-and-drop from the entire card surface; a click still opens card details.
  - Keep post-drop feedback stable; do not animate cards back toward their previous positions.
- Cards support:
  - Title and GFM Markdown description.
  - Multiple board-scoped text tags with editable names and colors. Board settings offers useful presets and a full color picker; edits save automatically without per-tag save buttons. Cards use removable tag badges and a searchable assignment picker; tag creation and management lives in a board settings modal opened from the sidebar.
  - Multiple assignees selected from the instance-wide participant list.
  - Timestamped plain-text comments with display-name attribution.
- Ticket due dates and checklists are intentionally omitted. Scheduling belongs to boards and a future sprint-level model rather than individual tickets.
- Title and description use an inline editing mode with explicit Save/Cancel so the card drawer retains its layout. Moves, tags, assignees, and comments persist immediately.
- Open card details in a right-side drawer by default. Provide a control to switch between drawer and centered-modal presentation and remember that preference in the browser. Card URLs remain directly linkable in either presentation.
- Show the board title once in the top breadcrumb bar, with a left-aligned board search toolbar below it. Search only the current board's card titles and descriptions. Filters cover tags, assignees, and unassigned cards. Combine categories with AND and selections within a category with OR.
- Move workspaces, boards, columns, and cards to a recoverable trash. A sidebar Trash panel lists recoverable items with restore controls and individually confirmed permanent deletion. Retain trash indefinitely until an unlocked editor restores or explicitly permanently deletes it.
- Create a resettable Sample Workspace on a new database. Its Sample Board demonstrates columns, Markdown, editable tags, comments, filtering, trash, and drag-and-drop without adding fake participants. Reset affects only the marked sample workspace and requires confirmation.
- Match Graphite's compact monochrome design family, including local fonts/icons, light and dark themes, a one-click theme toggle, clear focus states, and no remote assets.
- Target current desktop Chrome, Edge, Firefox, and Safari. Keep narrow layouts readable with collapsible navigation and horizontally scrolling boards, but defer polished mobile and touch workflows.

## Architecture, Data, and Security

- Use Bun 1.3.14, TypeScript, Hono, React, Vite, Tailwind CSS, shadcn/ui, Lucide icons, React Router, TanStack Query, Zod, and stable dnd-kit packages selected and pinned during initialization.
- Use a client-rendered SPA. Hono serves the production assets, private same-origin data routes, the SSE stream, and `/healthz`. Vite proxies those routes during development.
- Keep server state in TanStack Query and UI preferences in small React contexts/local storage. Do not add a general global-state dependency.
- Use `bun:sqlite` directly with prepared statements and ordered SQL migrations; do not add an ORM or premature database abstraction.
  - Enable foreign keys, WAL mode, and a bounded busy timeout.
  - Store the database at `${SHALE_DATA_DIR}/shale.sqlite`, defaulting to `/data` in Docker.
  - Use transactional dense integer positions for columns and cards.
  - Run one Shale server process against one database; horizontal replicas are unsupported.
- Use entity revisions for mutable records. Text saves submit the last-read revision; stale writes return a conflict with the current snapshot and offer Use Latest or Force Save. Immediate controls refetch and report failure if their optimistic mutation loses a race.
- Deliver live collaboration through Server-Sent Events. Events carry resource identifiers and revisions, not full content; clients invalidate affected queries. Reconnecting or missing events triggers a normal refetch.
- Treat participant names as attribution, not identity:
  - Require a selected participant before the first mutation.
  - Store the selected participant ID in browser-local state.
  - Allow unlocked editors to choose, add, rename, deactivate, or reactivate names.
  - Enforce non-empty, case-insensitively unique display names.
  - Preserve historical comments and assignments when a participant is deactivated.
- Protect mutations and operational actions with the shared gateway when a password is configured:
  - Accept at most one of `SHALE_PASSWORD` or `SHALE_PASSWORD_FILE`. With neither configured, allow
    public editing while continuing to require participant attribution.
  - Compare passwords in constant time and apply bounded in-memory unlock throttling.
  - Issue random opaque sessions, store only hashed session tokens in SQLite, use HttpOnly/SameSite cookies, and expire sessions after 30 days.
  - Password rotation invalidates existing sessions. Provide an explicit Lock Editing action.
  - Validate same-origin mutation requests and document HTTPS through a reverse proxy for non-local deployment.
- Public readers can view all workspaces, boards, card details, comments, and participant names. Add `noindex, nofollow` headers/meta, but clearly document that an unlisted URL is not privacy protection.
- Render card descriptions with CommonMark/GFM and conservative sanitization. Do not render raw HTML or remote images. External links open only after an explicit click with safe browser attributes.
- Add automatic consistent SQLite snapshots:
  - Run on startup when the newest snapshot is older than the configured interval, then every 24 hours by default.
  - Retain 14 snapshots by default; make interval and retention configurable.
  - Write snapshots through a temporary file and atomic rename under `${SHALE_DATA_DIR}/backups`.
  - Provide an edit-gated manual SQLite download.
  - Document restoration by stopping Shale and replacing the database; do not add in-app restore or JSON export in v1.
- No public API is introduced. The React client uses undocumented same-origin routes with shared TypeScript/Zod schemas for entities, mutation results, conflicts, authentication state, backup metadata, and realtime invalidations. These routes are not a supported integration contract.

## Repository and Distribution

- Initialize version `0.1.0` with Bun 1.3.14, one committed `bun.lock`, exact dependency versions, and a single-package structure grouped into server, web, shared schemas, SQL migrations, fixtures, and tests.
- Add slim `README.md` and `CONTRIBUTING.md`, The Unlicense, `AGENTS.md`, `.gitignore`, `.dockerignore`, `.gitattributes`, Biome/TypeScript/Vitest/Playwright configuration, and `.env.example` without secrets.
- Keep `AGENTS_LOCAL.md` ignored for machine-specific paths, ports, and launch notes. Never commit secrets or personal machine configuration.
- Finalize repository text files with CRLF while allowing runtime-generated Unix scripts and container entrypoints to use LF where required.
- Configure the repo-local identity as `Lucas <59397873+EleventhLucas@users.noreply.github.com>`.
- Do not add GitHub Actions.
- Provide scripts for `dev`, `dev:server`, `dev:web`, `start`, `build`, `package:docker`, `test`, `test:integration`, `test:e2e`, `test:smoke`, `typecheck`, `lint`, `format`, and `format:check`.
- Add VS Code launches for the complete app, server-only development, Web UI development, browser debugging, and targeted tests. Do not add `.vscode/tasks.json`.
- Build a non-root Docker image from the exact Bun 1.3.14 Linux x64 base:
  - Serve the backend and compiled Web UI on port 3000.
  - Persist `/data` through a named or bind-mounted volume.
  - Include schema migrations, health checking, graceful shutdown, and a Compose example.
  - Support `SHALE_PORT`, `SHALE_DATA_DIR`, `SHALE_PASSWORD`/`SHALE_PASSWORD_FILE`, backup interval/retention, and an optional public-origin setting.
- Publish versioned `ghcr.io/eleventhlucas/shale` Linux x64 images manually for releases. Do not promise arm64, AppImage, standalone Web hosting, or standalone binaries in 0.1.0.
- Docker is not currently available on the planning machine. Document it as a release prerequisite and perform final container validation on a Linux x64 Docker host.
- Add no telemetry, analytics, update checks, request/content logging, remote fonts, CDNs, or outbound background network activity.

## Test and Acceptance Plan

- Unit-test validation, natural ordering, board search/filter combinations, Markdown sanitization, participant uniqueness/deactivation, revisions, session expiry/password rotation, trash restoration, sample reset boundaries, and backup retention.
- Integration-test migrations and CRUD against temporary SQLite databases, transactional card movement, concurrent revision conflicts, cascading trash/restore, consistent live-database snapshots, and SSE invalidation delivery.
- Component-test public read mode, unlock and identity prompts, board navigation, card drawer/modal switching, explicit text saves, immediate card controls, filters, theme behavior, trash, and accessible focus states.
- Use browser tests for pointer and keyboard card movement, deep-linked cards, simultaneous sessions receiving live changes, conflict recovery, sample reset, and persisted browser preferences.
- Add a bounded Docker smoke test using a temporary volume: start the image with a test password, wait for `/healthz`, confirm the sandbox board renders, unlock editing, perform one card mutation, restart the container, and confirm persistence without touching tracked files.
- Acceptance requires all tests, type checking, linting, formatting checks, production build, portability/privacy scan, and Linux x64 Docker smoke test to pass. The container must remain functional without outbound network access.

## Explicitly Deferred

Accounts, registration, per-user passwords, roles, private workspaces, SSO, PostgreSQL, public APIs, plugins, webhooks, imports, JSON export, attachments, notifications, activity history, full-text/global search, cross-board card movement, recurring tasks, WIP limits, roadmaps, CRM, time tracking, budgeting, docs, chat, whiteboards, PWA/offline editing, polished mobile support, horizontal scaling, desktop wrappers, AppImage, and hosted-service operations.

## Implementation Handoff

- Repository state at approval: `main` contains no application scaffold; this plan was the only initial working-tree file.
- Remote: `https://github.com/EleventhLucas/shale.git`.
- Available locally: Bun 1.3.14. Docker and Docker Compose are not currently discoverable and are required before container smoke testing.
- The approved Git identity is recorded above and must be set repo-locally before the first commit.
- Start with a thin vertical slice: repository baseline, Bun/Hono server, Vite/React shell, initial SQLite migration, seeded sandbox board, public board read, shared-password unlock, one card mutation, and live invalidation between two browser sessions.
- Keep the same-origin routes private to the application. The rough draft's proposed API/plugin layer was explicitly rejected and must not be scaffolded.
- Do not broaden the first release while implementing. When a deferred feature appears necessary, record the dependency and return for product approval instead of silently adding it.
