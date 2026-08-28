# Shale

Shale is a small self-hosted kanban board for trusted groups. Anyone with the URL can read. Editing
requires the host's shared password when configured; otherwise the instance is publicly editable.

## Development

Requires Bun 1.3.14.

```sh
cp .env.example .env.local
bun install --frozen-lockfile
bun run dev
```

Do not expose Shale directly to the internet without HTTPS through a reverse proxy. An unlisted
URL is not privacy protection.
