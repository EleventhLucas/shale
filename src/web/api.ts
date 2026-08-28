import {
  boardSnapshotSchema,
  bootstrapSchema,
  type Card,
  cardSchema,
  participantSchema,
  sessionStateSchema,
  type Tag,
  tagSchema,
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
  updateCard: async (
    cardId: string,
    input: { title: string; description: string; revision: number; force?: boolean },
    participantId: string,
  ): Promise<Card> =>
    cardSchema.parse(
      await request(`/_shale/cards/${encodeURIComponent(cardId)}`, {
        method: "PATCH",
        headers: { "x-shale-participant": participantId },
        body: JSON.stringify(input),
      }),
    ),
  moveCard: async (
    cardId: string,
    input: { targetColumnId: string; targetPosition: number; revision: number },
    participantId: string,
  ): Promise<Card> =>
    cardSchema.parse(
      await request(`/_shale/cards/${encodeURIComponent(cardId)}/move`, {
        method: "PATCH",
        headers: { "x-shale-participant": participantId },
        body: JSON.stringify(input),
      }),
    ),
  createTag: async (boardId: string, name: string, participantId: string): Promise<Tag> =>
    tagSchema.parse(
      await request(`/_shale/boards/${encodeURIComponent(boardId)}/tags`, {
        method: "POST",
        headers: { "x-shale-participant": participantId },
        body: JSON.stringify({ name }),
      }),
    ),
  updateTag: async (
    tagId: string,
    input: { name: string; revision: number },
    participantId: string,
  ): Promise<Tag> =>
    tagSchema.parse(
      await request(`/_shale/tags/${encodeURIComponent(tagId)}`, {
        method: "PATCH",
        headers: { "x-shale-participant": participantId },
        body: JSON.stringify(input),
      }),
    ),
  updateCardTags: async (
    cardId: string,
    input: { tagIds: string[]; revision: number },
    participantId: string,
  ): Promise<Card> =>
    cardSchema.parse(
      await request(`/_shale/cards/${encodeURIComponent(cardId)}/tags`, {
        method: "PATCH",
        headers: { "x-shale-participant": participantId },
        body: JSON.stringify(input),
      }),
    ),
};
