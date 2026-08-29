# Deploying Shale

Shale is a stateful, self-hosted application for a trusted group. A Bun server serves the React application, owns a SQLite database, and exposes private same-origin routes used by the browser. It is not a static site.

## Runtime contract

- Runtime: Bun 1.3.14
- Build: `bun install --frozen-lockfile`, then `bun run build`
- Start: `bun run start`
- Default port: `3000`
- Health check: `GET /healthz`
- Persistent data: `${SHALE_DATA_DIR}/shale.sqlite`
- Database ownership: one Shale server process per database
- External services: none
- File storage: no card attachments or object-storage integration; person profile pictures are stored in SQLite as resized data URLs

Shale applies database migrations and creates a sample board on first startup.

### Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SHALE_PORT` | No | `3000` | HTTP port inside the process or container. Shale does not read `PORT`. |
| `SHALE_DATA_DIR` | No | `/data` | Directory containing `shale.sqlite` and its SQLite sidecar files. |
| `SHALE_PUBLIC_ORIGIN` | Recommended behind a proxy | Derived from request headers | Canonical absolute origin, such as `https://boards.example.com`. It is used for mutation-origin checks and secure cookies. |
| `SHALE_PASSWORD` | No | Unset | Shared editing password supplied directly in the environment. |
| `SHALE_PASSWORD_FILE` | No | Unset | Path to a file containing the shared editing password. Prefer this over `SHALE_PASSWORD` in production. |

Set at most one password variable. With neither set, the board is publicly readable and editable. With a password set, reading remains public and editing requires unlocking with the shared password. Shale does not provide accounts, roles, or OAuth integration.

## Docker Compose

The repository includes a Dockerfile and a development-oriented Compose definition. This production-style example publishes Shale only on the host loopback interface while keeping its internal port at `3000`:

```yaml
services:
  shale:
    image: shale:local
    build:
      context: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:3002:3000"
    environment:
      SHALE_PORT: "3000"
      SHALE_DATA_DIR: /data
      SHALE_PUBLIC_ORIGIN: https://boards.example.com
      SHALE_PASSWORD_FILE: /run/secrets/shale_password
    secrets:
      - shale_password
    volumes:
      - shale_data:/data

secrets:
  shale_password:
    file: ./.secrets/shale_password

volumes:
  shale_data:
```

Create `.secrets/shale_password` with restrictive file permissions before starting the service. The `.secrets` directory is ignored by Git. Remove the password environment entry and the `secrets` sections when intentionally deploying a publicly editable board.

Build and start the service from the repository root:

```sh
docker compose up --detach --build
curl --fail http://127.0.0.1:3002/healthz
```

The current Docker image targets Linux AMD64. Confirm the deployment host has a compatible architecture before building it.

## Running directly with Bun

Docker is optional. On a host with Bun 1.3.14 installed:

```sh
bun install --frozen-lockfile
bun run build
SHALE_DATA_DIR=/var/lib/shale SHALE_PORT=3002 bun run start
```

Run the process from the repository root so it can find the built web assets and migrations. Arrange persistent storage, process supervision, and backups separately.

## Reverse proxies and tunnels

Terminate TLS at the reverse proxy or tunnel and forward traffic to the loopback-bound Shale port. Web requests, server-sent events, and same-origin mutation routes must all reach the same Shale service.

Set `SHALE_PUBLIC_ORIGIN` to the exact browser-facing origin with no trailing slash:

```dotenv
SHALE_PUBLIC_ORIGIN=https://boards.example.com
```

The proxy should preserve `Host` and communicate the original protocol through `X-Forwarded-Proto`. Configuring `SHALE_PUBLIC_ORIGIN` explicitly avoids depending on inferred forwarding headers and causes HTTPS deployments to use secure session cookies.

An identity-aware proxy may be added as an outer access boundary, but it does not create Shale users or replace Shale's shared editing-password behavior. If readers should remain public while edits are protected, use Shale's shared password.

## Persistence and backups

Mount the entire `SHALE_DATA_DIR`, normally `/data` in Docker. Do not mount only the main database file: SQLite may also use `shale.sqlite-wal` and `shale.sqlite-shm` while the server is running.

Shale does not currently schedule automatic database backups. Before relying on a deployment, establish one of these operational approaches:

- Stop Shale briefly and snapshot or copy the complete persistent volume.
- Use tooling that performs a SQLite-consistent online backup.
- Export important boards through Shale in addition to backing up the database.

A board export is portable application data, but it is not a replacement for backing up the complete database. Test restoration using a separate temporary volume; never test a restore against the live volume.

## Importing an existing Shale board file

Shale imports `shale-board` JSON files through the browser. It does not discover JSON files placed in `/data`, and it does not load a board file automatically at startup.

To preserve a useful board URL during an import:

1. Start Shale with its persistent volume attached.
2. Unlock editing if a password is configured.
3. Create and open a board with the desired unique name.
4. Open **Settings**, select **Misc.**, and choose **Import board**.
5. Select the `.shale.json` file and confirm the replacement.
6. Verify columns, cards, tags, people, and comments.
7. Restart Shale and confirm the imported board and a test edit persist.

Importing replaces the selected board's contents and name. It does not replace the entire Shale database. The selected board's URL slug remains unchanged, so creating the correctly named destination board first usually produces the desired slug.

The board file must be accessible to the browser performing the import. A file that exists only on the server must first be transferred to the administrator's browser machine; it does not need to be placed on a public web server.

## Replacing an existing board service

This sequence keeps the old service recoverable while moving an existing public hostname to Shale:

1. Back up the old service's database, uploads, and container configuration.
2. Leave the old service and its volumes intact.
3. Start Shale on a different loopback port with a new persistent volume.
4. Check `/healthz`, import the converted board, make a test edit, and restart Shale.
5. Confirm the test edit survives and create a Shale database backup.
6. Set the final `SHALE_PUBLIC_ORIGIN` and restart Shale.
7. Change the reverse proxy or tunnel to send the existing hostname to Shale.
8. Verify page loading, unlocking, edits, imports or exports, and live updates through the public hostname.
9. Stop the old service only after Shale passes those checks. Do not delete its containers, database, or volumes yet.

For a rollback, point the reverse proxy or tunnel back to the old service and restart it. Keep the old data until the conversion and an independent Shale restore test are complete.

When testing Shale on a temporary local origin before cutover, omit `SHALE_PUBLIC_ORIGIN` so Shale can derive the test origin from the request. Set the final HTTPS origin and restart the service immediately before switching public traffic.
