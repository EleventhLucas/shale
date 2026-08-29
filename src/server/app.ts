import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import {
  createParticipantInputSchema,
  createTagInputSchema,
  moveCardInputSchema,
  trashTargetSchema,
  unlockInputSchema,
  updateCardAssigneesInputSchema,
  updateCardInputSchema,
  updateCardTagsInputSchema,
  updateParticipantInputSchema,
  updateTagInputSchema,
} from "../shared/contracts";
import { type AppVariables, createAuth } from "./auth";
import type { AppConfig } from "./config";
import {
  createTag,
  deleteParticipant,
  deleteTag,
  getBoard,
  getBootstrap,
  getCard,
  getParticipants,
  getTrash,
  moveCard,
  permanentlyDeleteEntity,
  restoreEntity,
  trashEntity,
  updateCardAssignees,
  updateCardTags,
  updateParticipant,
  updateTag,
} from "./db";
import { EventHub } from "./events";

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function expectedOrigin(requestUrl: string, headers: Headers, config: AppConfig): string {
  if (config.publicOrigin) return config.publicOrigin;
  const url = new URL(requestUrl);
  const protocol = headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? url.host;
  return `${protocol}://${host}`;
}

export function createApp(db: Database, config: AppConfig, hub = new EventHub()) {
  const app = new Hono<AppVariables>();
  const auth = createAuth(db, config);

  app.use("*", secureHeaders({ xFrameOptions: "DENY" }));
  app.use("*", async (c, next) => {
    c.header("X-Robots-Tag", "noindex, nofollow");
    await next();
  });
  app.use("/_shale/*", async (c, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (!origin || origin !== expectedOrigin(c.req.url, c.req.raw.headers, config)) {
        return c.json({ error: "Cross-origin mutation rejected." }, 403);
      }
    }
    await next();
  });

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.get("/_shale/session", (c) => c.json(auth.sessionState(auth.tokenFromContext(c))));

  app.post("/_shale/session/unlock", zValidator("json", unlockInputSchema), (c) => {
    if (!auth.passwordRequired) {
      return c.json(auth.sessionState(undefined));
    }
    const key = auth.clientKey(c.req.raw.headers);
    if (auth.throttled(key)) {
      return c.json({ error: "Too many unlock attempts. Try again shortly." }, 429);
    }
    if (!auth.passwordMatches(c.req.valid("json").password)) {
      auth.recordFailure(key);
      return c.json({ error: "Password not accepted." }, 401);
    }
    auth.clearFailures(key);
    const session = auth.issueSession();
    auth.setSessionCookie(c, session.token, session.expiresAt);
    return c.json({ unlocked: true, expiresAt: session.expiresAt, passwordRequired: true });
  });

  app.delete("/_shale/session", auth.requireSession, (c) => {
    auth.clearSession(c);
    return c.json(auth.sessionState(undefined));
  });

  app.get("/_shale/bootstrap", (c) => c.json(getBootstrap(db)));

  app.get("/_shale/boards/:workspaceSlug/:boardSlug", (c) => {
    const board = getBoard(db, c.req.param("workspaceSlug"), c.req.param("boardSlug"));
    return board ? c.json(board) : c.json({ error: "Board not found." }, 404);
  });

  app.get("/_shale/participants", (c) => c.json({ participants: getParticipants(db) }));

  app.post(
    "/_shale/participants",
    auth.requireSession,
    zValidator("json", createParticipantInputSchema),
    (c) => {
      const displayName = c.req.valid("json").displayName.trim();
      const participant = {
        id: randomUUID(),
        displayName,
        active: true,
        revision: 1,
      };
      const timestamp = new Date().toISOString();
      try {
        db.query(
          "INSERT INTO participants (id, display_name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ).run(participant.id, displayName, normalizeName(displayName), timestamp, timestamp);
      } catch {
        return c.json({ error: "That display name is already in use." }, 409);
      }
      hub.publish({ resource: "participants", id: participant.id, revision: 1 });
      return c.json(participant, 201);
    },
  );

  app.patch(
    "/_shale/participants/:participantId",
    auth.requireSession,
    zValidator("json", updateParticipantInputSchema),
    (c) => {
      const input = c.req.valid("json");
      const result = updateParticipant(
        db,
        c.req.param("participantId"),
        input.displayName,
        normalizeName(input.displayName),
        input.revision,
      );
      if (result.status === "not_found") return c.json({ error: "Person not found." }, 404);
      if (result.status === "duplicate") {
        return c.json({ error: "That display name is already in use." }, 409);
      }
      if (result.status === "conflict") {
        return c.json(
          { error: "This person changed since you opened Settings.", current: result.participant },
          409,
        );
      }
      hub.publish({
        resource: "participants",
        id: result.participant.id,
        revision: result.participant.revision,
      });
      return c.json(result.participant);
    },
  );

  app.delete("/_shale/participants/:participantId", auth.requireSession, (c) => {
    const participantId = c.req.param("participantId");
    const result = deleteParticipant(db, participantId);
    if (result.status === "not_found") return c.json({ error: "Person not found." }, 404);
    hub.publish({ resource: "participants", id: participantId, revision: 0 });
    return c.json({ ok: true });
  });

  app.patch(
    "/_shale/cards/:cardId",
    auth.requireSession,
    zValidator("json", updateCardInputSchema),
    (c) => {
      const cardId = c.req.param("cardId");
      const input = c.req.valid("json");
      const timestamp = new Date().toISOString();
      const update = input.force
        ? db
            .query(
              "UPDATE cards SET title = ?, description = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND trashed_at IS NULL",
            )
            .run(input.title, input.description, timestamp, cardId)
        : db
            .query(
              "UPDATE cards SET title = ?, description = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND trashed_at IS NULL",
            )
            .run(input.title, input.description, timestamp, cardId, input.revision);
      const current = getCard(db, cardId);
      if (!current) return c.json({ error: "Card not found." }, 404);
      if (update.changes === 0) {
        return c.json({ error: "This card changed since you opened it.", current }, 409);
      }
      hub.publish({ resource: "card", id: cardId, revision: current.revision });
      return c.json(current);
    },
  );

  app.patch(
    "/_shale/cards/:cardId/move",
    auth.requireSession,
    zValidator("json", moveCardInputSchema),
    (c) => {
      const cardId = c.req.param("cardId");
      const input = c.req.valid("json");
      const result = moveCard(
        db,
        cardId,
        input.targetColumnId,
        input.targetPosition,
        input.revision,
      );
      if (result.status === "not_found") return c.json({ error: "Card not found." }, 404);
      if (result.status === "invalid_target") {
        return c.json({ error: "Cards can only move between columns on the same board." }, 400);
      }
      if (result.status === "conflict") {
        return c.json(
          { error: "This card changed before the move completed.", current: result.card },
          409,
        );
      }
      hub.publish({ resource: "card", id: cardId, revision: result.card.revision });
      return c.json(result.card);
    },
  );

  app.post(
    "/_shale/boards/:boardId/tags",
    auth.requireSession,
    zValidator("json", createTagInputSchema),
    (c) => {
      const input = c.req.valid("json");
      const result = createTag(db, randomUUID(), c.req.param("boardId"), input.name, input.color);
      if (result.status === "not_found") return c.json({ error: "Board not found." }, 404);
      if (result.status === "duplicate") {
        return c.json({ error: "That tag already exists on this board." }, 409);
      }
      hub.publish({ resource: "board", id: c.req.param("boardId"), revision: 0 });
      return c.json(result.tag, 201);
    },
  );

  app.patch(
    "/_shale/tags/:tagId",
    auth.requireSession,
    zValidator("json", updateTagInputSchema),
    (c) => {
      const input = c.req.valid("json");
      const result = updateTag(db, c.req.param("tagId"), input.name, input.color, input.revision);
      if (result.status === "not_found") return c.json({ error: "Tag not found." }, 404);
      if (result.status === "duplicate") {
        return c.json({ error: "That tag name is already in use on this board." }, 409);
      }
      if (result.status === "conflict") {
        return c.json({ error: "This tag changed since you opened it.", current: result.tag }, 409);
      }
      hub.publish({ resource: "board", id: result.boardId, revision: result.tag.revision });
      return c.json(result.tag);
    },
  );

  app.delete("/_shale/tags/:tagId", auth.requireSession, (c) => {
    const result = deleteTag(db, c.req.param("tagId"));
    if (result.status === "not_found") return c.json({ error: "Tag not found." }, 404);
    hub.publish({ resource: "board", id: result.boardId, revision: 0 });
    return c.json({ ok: true });
  });

  app.patch(
    "/_shale/cards/:cardId/tags",
    auth.requireSession,
    zValidator("json", updateCardTagsInputSchema),
    (c) => {
      const cardId = c.req.param("cardId");
      const input = c.req.valid("json");
      const result = updateCardTags(db, cardId, input.tagIds, input.revision);
      if (result.status === "not_found") return c.json({ error: "Card not found." }, 404);
      if (result.status === "invalid_tag") {
        return c.json({ error: "Tags must belong to the card's board." }, 400);
      }
      if (result.status === "conflict") {
        return c.json(
          { error: "This card changed before its tags were saved.", current: result.card },
          409,
        );
      }
      hub.publish({ resource: "card", id: cardId, revision: result.card.revision });
      return c.json(result.card);
    },
  );

  app.patch(
    "/_shale/cards/:cardId/assignees",
    auth.requireSession,
    zValidator("json", updateCardAssigneesInputSchema),
    (c) => {
      const cardId = c.req.param("cardId");
      const input = c.req.valid("json");
      const result = updateCardAssignees(db, cardId, input.assigneeIds, input.revision);
      if (result.status === "not_found") return c.json({ error: "Card not found." }, 404);
      if (result.status === "invalid_participant") {
        return c.json({ error: "Assignees must be active people on this Shale instance." }, 400);
      }
      if (result.status === "conflict") {
        return c.json(
          { error: "This card changed before its assignees were saved.", current: result.card },
          409,
        );
      }
      hub.publish({ resource: "card", id: cardId, revision: result.card.revision });
      return c.json(result.card);
    },
  );

  app.get("/_shale/trash", auth.requireSession, (c) => c.json({ items: getTrash(db) }));

  app.post(
    "/_shale/trash/:type/:id",
    auth.requireSession,
    zValidator("param", trashTargetSchema),
    (c) => {
      const target = c.req.valid("param");
      const result = trashEntity(db, target.type, target.id);
      if (result.status === "not_found") return c.json({ error: "Item not found." }, 404);
      hub.publish({ resource: "board", id: target.id, revision: 0 });
      return c.json({ ok: true });
    },
  );

  app.post(
    "/_shale/trash/:type/:id/restore",
    auth.requireSession,
    zValidator("param", trashTargetSchema),
    (c) => {
      const target = c.req.valid("param");
      const result = restoreEntity(db, target.type, target.id);
      if (result.status === "not_found") return c.json({ error: "Item not found." }, 404);
      if (result.status === "invalid_parent") {
        return c.json({ error: "Restore its parent from Trash first." }, 409);
      }
      hub.publish({ resource: "board", id: target.id, revision: 0 });
      return c.json({ ok: true });
    },
  );

  app.delete(
    "/_shale/trash/:type/:id",
    auth.requireSession,
    zValidator("param", trashTargetSchema),
    (c) => {
      const target = c.req.valid("param");
      const result = permanentlyDeleteEntity(db, target.type, target.id);
      if (result.status === "not_found") return c.json({ error: "Item not found." }, 404);
      hub.publish({ resource: "board", id: target.id, revision: 0 });
      return c.json({ ok: true });
    },
  );

  app.get("/_shale/events", (c) => {
    c.header("Cache-Control", "no-cache");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let finish: (() => void) | undefined;
      const closed = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const unsubscribe = hub.subscribe((event) => {
        void stream.writeSSE({ event: "invalidate", data: JSON.stringify(event) });
      });
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: "heartbeat", data: "{}" });
      }, 25_000);
      stream.onAbort(() => finish?.());
      await stream.writeSSE({ event: "connected", data: "{}" });
      await closed;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.onError((error, c) => {
    if (error.name === "ZodError") return c.json({ error: "Invalid request." }, 400);
    return c.json({ error: "Unexpected server error." }, 500);
  });

  return app;
}
