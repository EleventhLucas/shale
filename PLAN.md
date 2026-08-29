# Shale 0.1.0 Implementation Plan

## Summary

Build Shale as a minimal, open-source kanban server for small trusted groups.

- The primary deliverable is one Linux x64 Docker image serving both the backend and Web UI.
- Anyone with the unlisted URL can read boards. Editing requires a host-configured shared password
  when one is configured; without one, the instance is publicly editable.
- There are no user accounts or roles. The shared password is the front door: everyone inside has equal editing capabilities. A browser may optionally select a person only for assignment shortcuts such as Add me.
- SQLite is the only database. PostgreSQL, public APIs, plugins, integrations, and hosted-service functionality are deferred.
- The application remains focused on creating boards, adding cards, and moving work forward.

## Product and Interface

- Organize content as a global list of boards -> columns -> cards. Workspaces are not part of the product or navigation; the legacy workspace table remains only as an internal migration detail for existing databases.
- Use the left sidebar exclusively as the global board switcher. Unlocked editors can create boards there. Canonical board URLs use the globally unique human-readable form `/b/{slug}` without exposing the internal board ID; legacy ID-based links redirect to the canonical route. Editors can change the slug in Misc. settings only after explicit confirmation that old slug links will stop working. Enforce case-insensitively unique board names when boards are created, renamed, or imported.
- Support column reordering and card reordering or movement between columns on the same board.
  - Provide pointer and keyboard drag-and-drop from the entire card surface; a click still opens card details.
  - Keep post-drop feedback stable; do not animate cards back toward their previous positions.
- Allow unlocked editors to create columns from a trailing add-column tile, rename them inline, and archive them. Empty columns archive immediately; columns containing cards require confirmation that those cards leave the active board with the column and can be restored together from Archive.
- Cards support:
  - Title and GFM Markdown description.
  - Multiple board-scoped text tags with editable names and colors. The Tags settings category offers useful presets, a full color picker, and deletion; edits save automatically without per-tag save buttons. Cards use removable tag badges and a searchable assignment picker.
  - Multiple assignees selected from the instance-wide Persons list, including an optional browser-local Add me shortcut that disappears when the selected person is already assigned.
  - Timestamped plain-text comments with display-name attribution.
- Ticket due dates and checklists are intentionally omitted. Scheduling belongs to boards and a future sprint-level model rather than individual tickets.
- Put a compact add button beside each column's card count so an unlocked editor can create a card directly in that column.
- Title and description use an inline editing mode with explicit Save/Cancel so the card drawer retains its layout. Moves, tags, assignees, and comments persist immediately.
- Open card details in a right-side drawer by default. Provide a control to switch between drawer and centered-modal presentation and remember that preference in the browser. Card URLs remain directly linkable in either presentation.
- Show the board title once in the top breadcrumb bar, with a left-aligned board search toolbar below it. Search only the current board's card titles and descriptions. Adjacent multi-select filters cover tags and assigned people, work simultaneously with search, combine categories with AND, and combine selections within a category with OR.
- Move boards, columns, and cards to a recoverable archive with restore controls and individually confirmed permanent deletion. Retain archived items indefinitely until an unlocked editor restores or explicitly permanently deletes them.
- Create a resettable Sample Board on a new database. It demonstrates columns, Markdown, editable tags, comments, filtering, the archive, and drag-and-drop without adding fake participants.
- Match Graphite's compact monochrome design family, including local fonts/icons, light and dark themes, clear focus states, and no remote assets. A top-aligned categorized settings modal opens to Appearance, where one theme toggle lives; Tags contains board tag management, Persons contains instance-wide assignment-person management, and the final Misc. category contains import, export, and archive access.
- Keep the Settings cog in the board top bar so it remains available whether the board sidebar is open or collapsed. Do not show a passive "Public editing" status label.
- Give people optional locally stored profile pictures. Resize uploads before saving them and automatically derive each person's accent color from the image's dominant shade; do not expose a manual person-color picker.
- Put edit-gated board export and import controls in the Misc. settings category. Export a versioned Shale JSON file containing the board's active columns, cards, tags, assignments, referenced people, and comments. Import replaces the current board transactionally after an explicit destructive confirmation while preserving its stable board URL.
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
- Treat person records as optional assignment identity, not authentication or edit attribution:
  - Require only the shared edit session for mutations; never require a selected person to edit.
  - Store an optionally selected person ID in browser-local state for Add me.
  - Choose that identity from a searchable person dropdown; creating people belongs only in the Persons settings category.
  - Allow unlocked editors to add, rename, update profile pictures for, or delete people in the Persons settings category.
  - Enforce non-empty, case-insensitively unique display names.
  - Removing a person clears their card assignments while preserving any plain-text comment author name.
- Protect mutations and operational actions with the shared gateway when a password is configured:
  - Accept at most one of `SHALE_PASSWORD` or `SHALE_PASSWORD_FILE`. With neither configured, allow public editing without requiring a selected person.
  - Compare passwords in constant time and apply bounded in-memory unlock throttling.
  - Issue random opaque sessions, store only hashed session tokens in SQLite, use HttpOnly/SameSite cookies, and expire sessions after 30 days.
  - Password rotation invalidates existing sessions. Provide an explicit Lock Editing action.
  - Validate same-origin mutation requests and document HTTPS through a reverse proxy for non-local deployment.
- Public readers can view all boards, card details, comments, and person names. Add `noindex, nofollow` headers/meta, but clearly document that an unlisted URL is not privacy protection.
- Render card descriptions with CommonMark/GFM and conservative sanitization. Do not render raw HTML or remote images. External links open only after an explicit click with safe browser attributes.
- Add automatic consistent SQLite snapshots:
  - Run on startup when the newest snapshot is older than the configured interval, then every 24 hours by default.
  - Retain 14 snapshots by default; make interval and retention configurable.
  - Write snapshots through a temporary file and atomic rename under `${SHALE_DATA_DIR}/backups`.
  - Provide an edit-gated manual SQLite download.
  - Document full-instance restoration by stopping Shale and replacing the database. Board-level JSON import/export is intentionally separate from SQLite disaster-recovery backups.
- No public API is introduced. The React client uses undocumented same-origin routes with shared TypeScript/Zod schemas for entities, mutation results, conflicts, authentication state, backup metadata, and realtime invalidations. These routes are not a supported integration contract.

## Repository and Distribution

- Initialize version `0.1.0` with Bun 1.3.14, one committed `bun.lock`, exact dependency versions, and a single-package structure grouped into server, web, shared schemas, SQL migrations, fixtures, and tests.
- Add slim `README.md` and `CONTRIBUTING.md`, The Unlicense, `AGENTS.md`, `.gitignore`, `.dockerignore`, `.gitattributes`, Biome/TypeScript/Vitest/Playwright configuration, and `.env.example` without secrets.
- Keep `AGENTS_LOCAL.md` ignored for machine-specific paths, ports, and launch notes. Never commit secrets or personal machine configuration.
- Finalize repository text files with CRLF while allowing runtime-generated Unix scripts and container entrypoints to use LF where required.
- Do not add GitHub Actions.
- Provide scripts for `dev`, `dev:server`, `dev:web`, `start`, `build`, `package:docker`, `test`, `test:integration`, `test:e2e`, `test:smoke`, `typecheck`, `lint`, `format`, and `format:check`.
- Add VS Code launches for the complete app, server-only development, Web UI development, browser debugging, and targeted tests. Do not add `.vscode/tasks.json`.
- Build a non-root Docker image from the exact Bun 1.3.14 Linux x64 base:
  - Serve the backend and compiled Web UI on port 3000.
  - Persist `/data` through a named or bind-mounted volume.
  - Include schema migrations, health checking, graceful shutdown, and a Compose example.
  - Support `SHALE_PORT`, `SHALE_DATA_DIR`, `SHALE_PASSWORD`/`SHALE_PASSWORD_FILE`, backup interval/retention, and an optional public-origin setting.
- Publish versioned Linux x64 container images manually to the configured registry. Do not promise arm64, AppImage, standalone Web hosting, or standalone binaries in 0.1.0.
- Docker is not currently available on the planning machine. Document it as a release prerequisite and perform final container validation on a Linux x64 Docker host.
- Add no telemetry, analytics, update checks, request/content logging, remote fonts, CDNs, or outbound background network activity.

## Test and Acceptance Plan

- Unit-test validation, natural ordering, board search/filter combinations, Markdown sanitization, person profiles/uniqueness/deletion, board-file schemas, revisions, session expiry/password rotation, archive restoration, sample reset boundaries, and backup retention.
- Integration-test migrations and CRUD against temporary SQLite databases, transactional card movement and board replacement, board export, concurrent revision conflicts, cascading trash/restore, consistent live-database snapshots, and SSE invalidation delivery.
- Component-test public read mode, unlock and optional identity prompts, global board navigation, card creation, card drawer/modal switching, assignments, explicit text saves, immediate card controls, filters, theme behavior, archive access, and accessible focus states.
- Use browser tests for pointer and keyboard card movement, deep-linked cards, simultaneous sessions receiving live changes, conflict recovery, sample reset, and persisted browser preferences.
- Add a bounded Docker smoke test using a temporary volume: start the image with a test password, wait for `/healthz`, confirm the sandbox board renders, unlock editing, perform one card mutation, restart the container, and confirm persistence without touching tracked files.
- Acceptance requires all tests, type checking, linting, formatting checks, production build, portability/privacy scan, and Linux x64 Docker smoke test to pass. The container must remain functional without outbound network access.

## Explicitly Deferred

Accounts, registration, per-user passwords, roles, private workspaces, SSO, PostgreSQL, public APIs, plugins, webhooks, general attachments, notifications, activity history, full-text/global search, cross-board card movement, recurring tasks, WIP limits, roadmaps, CRM, time tracking, budgeting, docs, chat, whiteboards, PWA/offline editing, polished mobile support, horizontal scaling, desktop wrappers, AppImage, and hosted-service operations.

## Implementation Handoff

- Repository state at approval: `main` contains no application scaffold; this plan was the only initial working-tree file.
- Use the repository's configured Git remote; do not record maintainer-specific remote URLs here.
- Available locally: Bun 1.3.14. Docker and Docker Compose are not currently discoverable and are required before container smoke testing.
- The approved Git identity is recorded above and must be set repo-locally before the first commit.
- Start with a thin vertical slice: repository baseline, Bun/Hono server, Vite/React shell, initial SQLite migration, seeded sandbox board, public board read, shared-password unlock, one card mutation, and live invalidation between two browser sessions.
- Keep the same-origin routes private to the application. The rough draft's proposed API/plugin layer was explicitly rejected and must not be scaffolded.
- Do not broaden the first release while implementing. When a deferred feature appears necessary, record the dependency and return for product approval instead of silently adding it.
