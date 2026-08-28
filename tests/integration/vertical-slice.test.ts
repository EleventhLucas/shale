import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createApp } from "../../src/server/app";
import { openTestDatabase } from "../../src/server/db";

const origin = "http://shale.test";

describe("Shale vertical slice", () => {
  let db: Database;

  beforeEach(() => {
    db = openTestDatabase();
  });

  afterEach(() => db.close());

  it("allows public reads, then authenticates and revision-checks a card save", async () => {
    const app = createApp(db, {
      password: "disposable-test-password",
      port: 3000,
      dataDir: ".",
      publicOrigin: origin,
      sessionDays: 30,
    });

    const publicRead = await app.request("/_shale/boards/sample-workspace/sample-board");
    expect(publicRead.status).toBe(200);

    const unlock = await app.request("/_shale/session/unlock", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ password: "disposable-test-password" }),
    });
    expect(unlock.status).toBe(200);
    const cookie = unlock.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();

    const participantResponse = await app.request("/_shale/participants", {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie: cookie as string },
      body: JSON.stringify({ displayName: "Test Editor" }),
    });
    expect(participantResponse.status).toBe(201);
    const participant = (await participantResponse.json()) as { id: string };

    const updated = await app.request("/_shale/cards/card-welcome", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
        cookie: cookie as string,
        "x-shale-participant": participant.id,
      },
      body: JSON.stringify({ title: "Saved once", description: "Updated", revision: 1 }),
    });
    expect(updated.status).toBe(200);

    const stale = await app.request("/_shale/cards/card-welcome", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
        cookie: cookie as string,
        "x-shale-participant": participant.id,
      },
      body: JSON.stringify({ title: "Stale save", description: "Updated", revision: 1 }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ current: { title: "Saved once", revision: 2 } });

    const moved = await app.request("/_shale/cards/card-welcome/move", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
        cookie: cookie as string,
        "x-shale-participant": participant.id,
      },
      body: JSON.stringify({
        targetColumnId: "sandbox-done",
        targetPosition: 1,
        revision: 2,
      }),
    });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ columnId: "sandbox-done", position: 1 });

    const boardAfterMove = await app.request("/_shale/boards/sample-workspace/sample-board");
    const snapshot = (await boardAfterMove.json()) as {
      columns: Array<{ id: string; cards: Array<{ id: string; position: number }> }>;
    };
    const done = snapshot.columns.find((column) => column.id === "sandbox-done");
    expect(done?.cards.map((card) => [card.id, card.position])).toEqual([
      ["card-finished", 0],
      ["card-welcome", 1],
    ]);

    const reordered = await app.request("/_shale/cards/card-finished/move", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
        cookie: cookie as string,
        "x-shale-participant": participant.id,
      },
      body: JSON.stringify({
        targetColumnId: "sandbox-done",
        targetPosition: 1,
        revision: 2,
      }),
    });
    expect(reordered.status).toBe(200);
    const boardAfterReorder = (await (
      await app.request("/_shale/boards/sample-workspace/sample-board")
    ).json()) as {
      columns: Array<{ id: string; cards: Array<{ id: string; position: number }> }>;
    };
    expect(
      boardAfterReorder.columns
        .find((column) => column.id === "sandbox-done")
        ?.cards.map((card) => [card.id, card.position]),
    ).toEqual([
      ["card-welcome", 0],
      ["card-finished", 1],
    ]);
  });

  it("allows attributed mutations without a session when passwordless", async () => {
    const app = createApp(db, {
      port: 3000,
      dataDir: ".",
      publicOrigin: origin,
      sessionDays: 30,
    });
    const session = await app.request("/_shale/session");
    expect(await session.json()).toEqual({
      unlocked: true,
      expiresAt: null,
      passwordRequired: false,
    });

    const participantResponse = await app.request("/_shale/participants", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ displayName: "Public Editor" }),
    });
    const participant = (await participantResponse.json()) as { id: string };
    expect(participantResponse.status).toBe(201);

    const moved = await app.request("/_shale/cards/card-live/move", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
        "x-shale-participant": participant.id,
      },
      body: JSON.stringify({
        targetColumnId: "sandbox-done",
        targetPosition: 0,
        revision: 1,
      }),
    });
    expect(moved.status).toBe(200);
    const movedCard = (await moved.json()) as { revision: number };

    const createdTag = await app.request("/_shale/boards/sandbox-board/tags", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-shale-participant": participant.id,
      },
      body: JSON.stringify({ name: "Needs review" }),
    });
    expect(createdTag.status).toBe(201);
    const tag = (await createdTag.json()) as { id: string; revision: number };

    const tagged = await app.request("/_shale/cards/card-live/tags", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
        "x-shale-participant": participant.id,
      },
      body: JSON.stringify({
        tagIds: ["tag-collaboration", tag.id],
        revision: movedCard.revision,
      }),
    });
    expect(tagged.status).toBe(200);
    expect(await tagged.json()).toMatchObject({
      tags: [{ name: "Collaboration" }, { name: "Needs review" }],
    });

    const renamed = await app.request(`/_shale/tags/${tag.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
        "x-shale-participant": participant.id,
      },
      body: JSON.stringify({ name: "Ready for review", revision: tag.revision }),
    });
    expect(renamed.status).toBe(200);

    const snapshot = (await (
      await app.request("/_shale/boards/sample-workspace/sample-board")
    ).json()) as {
      workspace: { name: string };
      board: { name: string };
      tags: Array<{ name: string }>;
      columns: Array<{ cards: Array<Record<string, unknown>> }>;
    };
    expect(snapshot.workspace.name).toBe("Sample Workspace");
    expect(snapshot.board.name).toBe("Sample Board");
    expect(snapshot.tags.some((item) => item.name === "Ready for review")).toBe(true);
    const liveCard = snapshot.columns
      .flatMap((column) => column.cards)
      .find((card) => card.id === "card-live");
    expect(liveCard).not.toHaveProperty("dueDate");
    expect(liveCard).not.toHaveProperty("checklist");
    expect(liveCard).not.toHaveProperty("labels");
  });
});
