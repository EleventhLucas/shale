# Agent Instructions

`PLAN.md` is the approved source of truth for Shale 0.1.0. Keep the first implementation focused on its vertical slice and explicit acceptance criteria.

Local-only agent and development instructions belong in `AGENTS_LOCAL.md`.
Read `AGENTS_LOCAL.md` after this file when it exists. It must remain gitignored and must not be committed.
When it is absent, continue normally and inform the user once that they may create it for machine-specific paths, ports, launch notes, and repo-local Git identity.
Never store passwords, access tokens, private keys, or other secrets in either agent file.

## Documentation and Text Files

- Keep `README.md` and `CONTRIBUTING.md` intentionally slim.
- Finalize edited repository text files with CRLF line endings unless a Unix executable or container entrypoint requires LF.
- Keep documentation aligned with commands and behavior that actually exist.

## Product Boundaries

- Shale is a small self-hosted board, not a general project-management platform.
- SQLite is the only database for 0.1.0, and one server process owns it.
- Do not introduce accounts, roles, PostgreSQL, public APIs, plugins, integrations, webhooks, AppImage packaging, or a standalone Web deployment unless the plan is explicitly revised.
- Private same-origin data routes are implementation details and must not be presented as a supported external API.

## Privacy, Security, and Network Behavior

- The public Shale repository URL may be committed, displayed in-app, and queried for user-triggered update checks.
- Do not add telemetry, analytics, automatic uploads, content logging, raw path logging, command-output logging, remote fonts, CDNs, or unrelated outbound requests.
- Do not commit secrets, PII, private configuration, personal paths, copied transcripts, runtime databases, or backups.
- Treat the configured shared password as a secret. Examples must use placeholders and tests must use disposable values.
- Public-read behavior is intentional, but mutations, backup downloads, trash purges, and sandbox reset must enforce the edit session.

## SQLite and Runtime Data

- Use temporary directories and databases for tests; never point tests or development utilities at a user's persistent Shale volume by default.
- Preserve transactional ordering, entity revisions, foreign keys, and atomic backup writes.
- Do not delete, replace, migrate backward, or restore a persistent database without explicit user authorization and a verified target path.
- Runtime databases, WAL/SHM files, backup snapshots, and Docker volumes must remain untracked.

## Portable Workflows

- Use repository-relative paths, environment variables, or checked-in wrappers instead of personal paths.
- Put machine-specific paths and notes in ignored `AGENTS_LOCAL.md` or `.env.local`.
- A wrapper for a variably installed executable must accept an environment override, check `PATH`, and fail with actionable setup help.
- Do not assume Docker is installed on the current machine; detect it before Docker-specific validation and report the missing prerequisite clearly.

## Validation

- Default to quick, targeted validation for the affected subsystem.
- Do not run packaging, publish images, alter persistent volumes, or run the complete end-to-end suite unless explicitly requested.
- Use temporary data for integration and smoke tests and clean it up without touching tracked files.
- Before a release, run the full checks and the Linux x64 Docker smoke flow required by `PLAN.md`.
