import { describe, expect, it } from "vitest";
import {
  boardExportSchema,
  createParticipantInputSchema,
  createTagInputSchema,
  moveCardInputSchema,
  updateCardAssigneesInputSchema,
  updateCardInputSchema,
  updateParticipantInputSchema,
  updateTagInputSchema,
} from "../../src/shared/contracts";

describe("shared input contracts", () => {
  it("trims person names and rejects empty names", () => {
    expect(createParticipantInputSchema.parse({ displayName: "  Avery  " })).toEqual({
      displayName: "Avery",
    });
    expect(() => createParticipantInputSchema.parse({ displayName: "   " })).toThrow();
    expect(
      updateParticipantInputSchema.parse({ displayName: "  Avery T.  ", revision: 2 }),
    ).toEqual({
      displayName: "Avery T.",
      revision: 2,
    });
  });

  it("requires a revision and explicit non-empty card title", () => {
    expect(
      updateCardInputSchema.parse({
        title: "  A clearer title  ",
        description: "Body",
        revision: 2,
      }),
    ).toEqual({ title: "A clearer title", description: "Body", revision: 2, force: false });
    expect(() =>
      updateCardInputSchema.parse({ title: "", description: "Body", revision: 2 }),
    ).toThrow();
  });

  it("validates dense card movement targets", () => {
    expect(
      moveCardInputSchema.parse({
        targetColumnId: "column-done",
        targetPosition: 0,
        revision: 3,
      }),
    ).toEqual({ targetColumnId: "column-done", targetPosition: 0, revision: 3 });
    expect(() =>
      moveCardInputSchema.parse({
        targetColumnId: "column-done",
        targetPosition: -1,
        revision: 3,
      }),
    ).toThrow();
  });

  it("requires unique person assignments", () => {
    expect(
      updateCardAssigneesInputSchema.parse({
        assigneeIds: ["person-a", "person-b"],
        revision: 4,
      }),
    ).toEqual({ assigneeIds: ["person-a", "person-b"], revision: 4 });
    expect(() =>
      updateCardAssigneesInputSchema.parse({
        assigneeIds: ["person-a", "person-a"],
        revision: 4,
      }),
    ).toThrow();
  });

  it("accepts six-digit tag colors and supplies a neutral default", () => {
    expect(createTagInputSchema.parse({ name: "Review" })).toEqual({
      name: "Review",
      color: "#6b6b68",
    });
    expect(updateTagInputSchema.parse({ name: "Review", color: "#A1B2C3", revision: 2 })).toEqual({
      name: "Review",
      color: "#a1b2c3",
      revision: 2,
    });
    expect(() =>
      updateTagInputSchema.parse({ name: "Review", color: "violet", revision: 2 }),
    ).toThrow();
  });

  it("validates local person profile pictures and board files", () => {
    expect(
      updateParticipantInputSchema.parse({
        displayName: "Avery",
        avatarDataUrl: "data:image/png;base64,AA==",
        color: "#A1B2C3",
        revision: 3,
      }),
    ).toEqual({
      displayName: "Avery",
      avatarDataUrl: "data:image/png;base64,AA==",
      color: "#a1b2c3",
      revision: 3,
    });
    expect(() =>
      updateParticipantInputSchema.parse({
        displayName: "Avery",
        avatarDataUrl: "https://example.test/avatar.png",
        color: "#a1b2c3",
        revision: 3,
      }),
    ).toThrow();
    expect(
      boardExportSchema.parse({
        format: "shale-board",
        version: 1,
        exportedAt: "2026-08-29T12:00:00.000Z",
        board: { name: "Portable board", tags: [], people: [], columns: [] },
      }),
    ).toMatchObject({ format: "shale-board", version: 1 });
  });
});
