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
    expect((await app.request("/_shale/board-files/sandbox-board")).status).toBe(401);

    const lockedMutation = await app.request("/_shale/cards/card-welcome", {
      method: "PATCH",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ title: "Still locked", description: "Updated", revision: 1 }),
    });
    expect(lockedMutation.status).toBe(401);

    const unlock = await app.request("/_shale/session/unlock", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ password: "disposable-test-password" }),
    });
    expect(unlock.status).toBe(200);
    const cookie = unlock.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    expect(
      (
        await app.request("/_shale/board-files/sandbox-board", {
          headers: { cookie: cookie as string },
        })
      ).status,
    ).toBe(200);

    const updated = await app.request("/_shale/cards/card-welcome", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
        cookie: cookie as string,
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

  it("allows high-trust editing and manages tags, people, and assignments", async () => {
    db.query("UPDATE tags SET color = 'blue' WHERE id = 'tag-collaboration'").run();
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
    const participant = (await participantResponse.json()) as { id: string; revision: number };
    expect(participantResponse.status).toBe(201);

    const moved = await app.request("/_shale/cards/card-live/move", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
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
      },
      body: JSON.stringify({ name: "Needs review" }),
    });
    expect(createdTag.status).toBe(201);
    const tag = (await createdTag.json()) as { id: string; color: string; revision: number };
    expect(tag.color).toBe("#6b6b68");

    const tagged = await app.request("/_shale/cards/card-live/tags", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({
        tagIds: ["tag-collaboration", tag.id],
        revision: movedCard.revision,
      }),
    });
    expect(tagged.status).toBe(200);
    const taggedCard = (await tagged.json()) as {
      revision: number;
      tags: Array<{ name: string; color: string }>;
    };
    expect(taggedCard).toMatchObject({
      tags: [
        { name: "Collaboration", color: "#4f78b8" },
        { name: "Needs review", color: "#6b6b68" },
      ],
    });

    const assigned = await app.request("/_shale/cards/card-live/assignees", {
      method: "PATCH",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        assigneeIds: [participant.id],
        revision: taggedCard.revision,
      }),
    });
    expect(assigned.status).toBe(200);
    expect(await assigned.json()).toMatchObject({ assigneeIds: [participant.id] });

    const renamed = await app.request(`/_shale/tags/${tag.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({
        name: "Ready for review",
        color: "#3a7bd5",
        revision: tag.revision,
      }),
    });
    expect(renamed.status).toBe(200);

    const renamedPerson = await app.request(`/_shale/participants/${participant.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        displayName: "Board Visitor",
        avatarDataUrl: "data:image/png;base64,AA==",
        color: "#376b52",
        revision: participant.revision,
      }),
    });
    expect(renamedPerson.status).toBe(200);
    expect(await renamedPerson.json()).toMatchObject({
      displayName: "Board Visitor",
      avatarDataUrl: "data:image/png;base64,AA==",
      color: "#376b52",
      revision: 2,
    });

    const snapshot = (await (
      await app.request("/_shale/boards/sample-workspace/sample-board")
    ).json()) as {
      workspace: { name: string };
      board: { name: string };
      tags: Array<{ name: string; color: string }>;
      columns: Array<{ cards: Array<Record<string, unknown>> }>;
    };
    expect(snapshot.workspace.name).toBe("Sample Workspace");
    expect(snapshot.board.name).toBe("Sample Board");
    expect(
      snapshot.tags.some((item) => item.name === "Ready for review" && item.color === "#3a7bd5"),
    ).toBe(true);
    const liveCard = snapshot.columns
      .flatMap((column) => column.cards)
      .find((card) => card.id === "card-live");
    expect(liveCard).not.toHaveProperty("dueDate");
    expect(liveCard).not.toHaveProperty("checklist");
    expect(liveCard).not.toHaveProperty("labels");

    const deletedTag = await app.request(`/_shale/tags/${tag.id}`, {
      method: "DELETE",
      headers: { origin },
    });
    expect(deletedTag.status).toBe(200);
    const deletedPerson = await app.request(`/_shale/participants/${participant.id}`, {
      method: "DELETE",
      headers: { origin },
    });
    expect(deletedPerson.status).toBe(200);

    const afterDeletes = (await (
      await app.request("/_shale/boards/sample-workspace/sample-board")
    ).json()) as {
      tags: Array<{ id: string }>;
      columns: Array<{ cards: Array<{ id: string; assigneeIds: string[] }> }>;
    };
    expect(afterDeletes.tags.some((item) => item.id === tag.id)).toBe(false);
    expect(
      afterDeletes.columns.flatMap((column) => column.cards).find((card) => card.id === "card-live")
        ?.assigneeIds,
    ).toEqual([]);
  });

  it("exports and transactionally replaces the current board", async () => {
    const app = createApp(db, {
      port: 3000,
      dataDir: ".",
      publicOrigin: origin,
      sessionDays: 30,
    });
    const createdPerson = await app.request("/_shale/participants", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ displayName: "Portable Person" }),
    });
    const person = (await createdPerson.json()) as { id: string };
    const assigned = await app.request("/_shale/cards/card-welcome/assignees", {
      method: "PATCH",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ assigneeIds: [person.id], revision: 1 }),
    });
    expect(assigned.status).toBe(200);

    const exportedResponse = await app.request("/_shale/board-files/sandbox-board");
    expect(exportedResponse.status).toBe(200);
    const exported = (await exportedResponse.json()) as {
      format: string;
      version: number;
      board: {
        name: string;
        tags: Array<{ id: string }>;
        people: Array<{ id: string }>;
        columns: unknown[];
      };
    };
    expect(exported).toMatchObject({
      format: "shale-board",
      version: 1,
      board: { name: "Sample Board" },
    });
    expect(exported.board.people.map((item) => item.id)).toContain(person.id);

    const rejectedImport = await app.request("/_shale/board-files/sandbox-board", {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        ...exported,
        board: {
          ...exported.board,
          columns: [
            {
              title: "Broken import",
              cards: [
                {
                  title: "Missing tag reference",
                  description: "",
                  tagIds: ["missing-tag"],
                  assigneeIds: [],
                  comments: [],
                },
              ],
            },
          ],
        },
      }),
    });
    expect(rejectedImport.status).toBe(400);
    expect(
      (
        (await (await app.request("/_shale/boards/sample-workspace/sample-board")).json()) as {
          columns: Array<{ cards: Array<{ id: string }> }>;
        }
      ).columns
        .flatMap((column) => column.cards)
        .some((card) => card.id === "card-welcome"),
    ).toBe(true);

    const importedFile = {
      ...exported,
      board: {
        ...exported.board,
        name: "Imported Board",
        columns: [
          {
            title: "Imported column",
            cards: [
              {
                title: "Imported card",
                description: "Portable Markdown",
                tagIds: [exported.board.tags[0].id],
                assigneeIds: [person.id],
                comments: [],
              },
            ],
          },
        ],
      },
    };
    const importedResponse = await app.request("/_shale/board-files/sandbox-board", {
      method: "PUT",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(importedFile),
    });
    expect(importedResponse.status).toBe(200);

    const board = (await (
      await app.request("/_shale/boards/sample-workspace/sample-board")
    ).json()) as {
      board: { name: string };
      columns: Array<{
        id: string;
        title: string;
        position: number;
        revision: number;
        cards: Array<{ title: string; assigneeIds: string[] }>;
      }>;
    };
    expect(board.board.name).toBe("Imported Board");
    expect(board.columns).toEqual([
      {
        id: expect.any(String),
        title: "Imported column",
        position: 0,
        revision: 1,
        cards: [
          expect.objectContaining({
            title: "Imported card",
            assigneeIds: [person.id],
          }),
        ],
      },
    ]);
    expect(
      board.columns
        .flatMap((column) => column.cards)
        .some((card) => card.title === "Explore the sample board"),
    ).toBe(false);
  });

  it("lists boards globally and creates cards directly in a column", async () => {
    const app = createApp(db, {
      port: 3000,
      dataDir: ".",
      publicOrigin: origin,
      sessionDays: 30,
    });
    const globalSample = await app.request("/_shale/board/sandbox-board");
    expect(globalSample.status).toBe(200);

    const createdResponse = await app.request("/_shale/boards", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ name: "Second Board" }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { id: string; revision: number };
    expect(created.revision).toBe(1);

    const renamedResponse = await app.request(`/_shale/boards/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ name: "Renamed Board", revision: created.revision }),
    });
    expect(renamedResponse.status).toBe(200);
    expect(await renamedResponse.json()).toMatchObject({ name: "Renamed Board", revision: 2 });

    const createdBoard = (await (await app.request(`/_shale/board/${created.id}`)).json()) as {
      board: { name: string };
      columns: Array<{ id: string; title: string; cards: unknown[] }>;
    };
    expect(createdBoard.board.name).toBe("Renamed Board");
    expect(createdBoard.columns.map((column) => column.title)).toEqual([
      "Backlog",
      "In progress",
      "Done",
    ]);

    const cardResponse = await app.request(`/_shale/columns/${createdBoard.columns[0].id}/cards`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ title: "Created from the column" }),
    });
    expect(cardResponse.status).toBe(201);
    expect(await cardResponse.json()).toMatchObject({
      title: "Created from the column",
      columnId: createdBoard.columns[0].id,
      position: 0,
    });

    const bootstrap = (await (await app.request("/_shale/bootstrap")).json()) as {
      workspaces: Array<{ boards: Array<{ id: string; name: string }> }>;
    };
    expect(
      bootstrap.workspaces
        .flatMap((workspace) => workspace.boards)
        .some((board) => board.id === created.id && board.name === "Renamed Board"),
    ).toBe(true);
  });

  it("restores and permanently deletes items through the recoverable trash", async () => {
    const app = createApp(db, {
      port: 3000,
      dataDir: ".",
      publicOrigin: origin,
      sessionDays: 30,
    });
    const mutationHeaders = { origin };

    const initialTrash = (await (await app.request("/_shale/trash")).json()) as {
      items: Array<{ id: string; type: string }>;
    };
    expect(
      initialTrash.items.some((item) => item.id === "card-trashed-example" && item.type === "card"),
    ).toBe(true);

    const restored = await app.request("/_shale/trash/card/card-trashed-example/restore", {
      method: "POST",
      headers: mutationHeaders,
    });
    expect(restored.status).toBe(200);
    const boardAfterRestore = (await (
      await app.request("/_shale/boards/sample-workspace/sample-board")
    ).json()) as { columns: Array<{ cards: Array<{ id: string }> }> };
    expect(
      boardAfterRestore.columns
        .flatMap((column) => column.cards)
        .some((card) => card.id === "card-trashed-example"),
    ).toBe(true);

    const trashedAgain = await app.request("/_shale/trash/card/card-trashed-example", {
      method: "POST",
      headers: mutationHeaders,
    });
    expect(trashedAgain.status).toBe(200);
    const deleted = await app.request("/_shale/trash/card/card-trashed-example", {
      method: "DELETE",
      headers: mutationHeaders,
    });
    expect(deleted.status).toBe(200);
    expect(db.query("SELECT 1 FROM cards WHERE id = ?").get("card-trashed-example")).toBeNull();

    const trashedBoard = await app.request("/_shale/trash/board/sandbox-board", {
      method: "POST",
      headers: mutationHeaders,
    });
    expect(trashedBoard.status).toBe(200);
    expect((await app.request("/_shale/boards/sample-workspace/sample-board")).status).toBe(404);
    const restoredBoard = await app.request("/_shale/trash/board/sandbox-board/restore", {
      method: "POST",
      headers: mutationHeaders,
    });
    expect(restoredBoard.status).toBe(200);
    expect((await app.request("/_shale/boards/sample-workspace/sample-board")).status).toBe(200);

    const trashedColumn = await app.request("/_shale/trash/column/sandbox-progress", {
      method: "POST",
      headers: mutationHeaders,
    });
    expect(trashedColumn.status).toBe(200);
    const boardWithoutColumn = (await (
      await app.request("/_shale/boards/sample-workspace/sample-board")
    ).json()) as { columns: Array<{ id: string; position: number }> };
    expect(boardWithoutColumn.columns.map((column) => [column.id, column.position])).toEqual([
      ["sandbox-backlog", 0],
      ["sandbox-done", 1],
    ]);
    expect(
      (
        await app.request("/_shale/trash/column/sandbox-progress/restore", {
          method: "POST",
          headers: mutationHeaders,
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await app.request("/_shale/trash/workspace/sandbox-workspace", {
          method: "POST",
          headers: mutationHeaders,
        })
      ).status,
    ).toBe(200);
    const bootstrapWhileTrashed = (await (await app.request("/_shale/bootstrap")).json()) as {
      workspaces: unknown[];
    };
    expect(bootstrapWhileTrashed.workspaces).toEqual([]);
    expect(
      (
        await app.request("/_shale/trash/workspace/sandbox-workspace/restore", {
          method: "POST",
          headers: mutationHeaders,
        })
      ).status,
    ).toBe(200);
  });
});
