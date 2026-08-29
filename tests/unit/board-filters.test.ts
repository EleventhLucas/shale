import { describe, expect, it } from "vitest";
import type { Card } from "../../src/shared/contracts";
import { cardMatchesBoardFilters } from "../../src/web/board-filters";

const card: Card = {
  id: "card-1",
  columnId: "column-1",
  title: "Review release notes",
  description: "Check the migration guide",
  position: 0,
  revision: 1,
  tags: [
    { id: "tag-review", name: "Review", color: "#446688", revision: 1 },
    { id: "tag-docs", name: "Docs", color: "#886644", revision: 1 },
  ],
  assigneeIds: ["person-avery", "person-riley"],
};

describe("board search and filters", () => {
  it("combines search, tag filters, and person filters with AND", () => {
    expect(cardMatchesBoardFilters(card, "migration", ["tag-review"], ["person-avery"])).toBe(true);
    expect(cardMatchesBoardFilters(card, "missing", ["tag-review"], ["person-avery"])).toBe(false);
    expect(cardMatchesBoardFilters(card, "migration", ["tag-other"], ["person-avery"])).toBe(false);
    expect(cardMatchesBoardFilters(card, "migration", ["tag-review"], ["person-other"])).toBe(
      false,
    );
  });

  it("uses OR within each selected filter category", () => {
    expect(
      cardMatchesBoardFilters(
        card,
        "",
        ["tag-other", "tag-docs"],
        ["person-other", "person-riley"],
      ),
    ).toBe(true);
  });
});
