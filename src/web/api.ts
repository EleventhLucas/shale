import {
  boardSnapshotSchema,
  bootstrapSchema,
  type Card,
  cardSchema,
  participantSchema,
  sessionStateSchema,
  type Tag,
  type TagColor,
  type TrashItemType,
  tagSchema,
  trashSnapshotSchema,
} from "../shared/contracts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    const message =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : "Request failed.";
    throw new ApiError(message, response.status, body);
  }
  return body;
}

export const api = {
  session: async () => sessionStateSchema.parse(await request("/_shale/session")),
  unlock: async (password: string) =>
    sessionStateSchema.parse(
      await request("/_shale/session/unlock", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    ),
  lock: async () =>
    sessionStateSchema.parse(await request("/_shale/session", { method: "DELETE" })),
  bootstrap: async () => bootstrapSchema.parse(await request("/_shale/bootstrap")),
  board: async (workspaceSlug: string, boardSlug: string) =>
    boardSnapshotSchema.parse(
      await request(
        `/_shale/boards/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(boardSlug)}`,
      ),
    ),
  createParticipant: async (displayName: string) =>
    participantSchema.parse(
      await request("/_shale/participants", {
        method: "POST",
        body: JSON.stringify({ displayName }),
      }),
    ),
  updateParticipant: async (
    participantId: string,
    input: { displayName: string; revision: number },
  ) =>
    participantSchema.parse(
      await request(`/_shale/participants/${encodeURIComponent(participantId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    ),
  deleteParticipant: async (participantId: string): Promise<void> => {
    await request(`/_shale/participants/${encodeURIComponent(participantId)}`, {
      method: "DELETE",
    });
  },
  updateCard: async (
    cardId: string,
    input: { title: string; description: string; revision: number; force?: boolean },
  ): Promise<Card> =>
    cardSchema.parse(
      await request(`/_shale/cards/${encodeURIComponent(cardId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    ),
  moveCard: async (
    cardId: string,
    input: { targetColumnId: string; targetPosition: number; revision: number },
  ): Promise<Card> =>
    cardSchema.parse(
      await request(`/_shale/cards/${encodeURIComponent(cardId)}/move`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    ),
  createTag: async (boardId: string, name: string, color: TagColor): Promise<Tag> =>
    tagSchema.parse(
      await request(`/_shale/boards/${encodeURIComponent(boardId)}/tags`, {
        method: "POST",
        body: JSON.stringify({ name, color }),
      }),
    ),
  updateTag: async (
    tagId: string,
    input: { name: string; color: TagColor; revision: number },
  ): Promise<Tag> =>
    tagSchema.parse(
      await request(`/_shale/tags/${encodeURIComponent(tagId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    ),
  deleteTag: async (tagId: string): Promise<void> => {
    await request(`/_shale/tags/${encodeURIComponent(tagId)}`, { method: "DELETE" });
  },
  updateCardTags: async (
    cardId: string,
    input: { tagIds: string[]; revision: number },
  ): Promise<Card> =>
    cardSchema.parse(
      await request(`/_shale/cards/${encodeURIComponent(cardId)}/tags`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    ),
  updateCardAssignees: async (
    cardId: string,
    input: { assigneeIds: string[]; revision: number },
  ): Promise<Card> =>
    cardSchema.parse(
      await request(`/_shale/cards/${encodeURIComponent(cardId)}/assignees`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    ),
  trash: async () => trashSnapshotSchema.parse(await request("/_shale/trash")),
  moveToTrash: async (type: TrashItemType, id: string): Promise<void> => {
    await request(`/_shale/trash/${type}/${encodeURIComponent(id)}`, {
      method: "POST",
    });
  },
  restoreFromTrash: async (type: TrashItemType, id: string): Promise<void> => {
    await request(`/_shale/trash/${type}/${encodeURIComponent(id)}/restore`, {
      method: "POST",
    });
  },
  permanentlyDelete: async (type: TrashItemType, id: string): Promise<void> => {
    await request(`/_shale/trash/${type}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};
