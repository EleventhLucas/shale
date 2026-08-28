import { describe, expect, it } from "vitest";
import {
  createParticipantInputSchema,
  moveCardInputSchema,
  updateCardInputSchema,
} from "../../src/shared/contracts";

describe("shared input contracts", () => {
  it("trims participant names and rejects empty attribution", () => {
    expect(createParticipantInputSchema.parse({ displayName: "  Avery  " })).toEqual({
      displayName: "Avery",
    });
    expect(() => createParticipantInputSchema.parse({ displayName: "   " })).toThrow();
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
});
