import { describe, expect, it } from "vitest";
import {
  createParticipantInputSchema,
  createTagInputSchema,
  moveCardInputSchema,
  updateCardInputSchema,
  updateTagInputSchema,
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
});
