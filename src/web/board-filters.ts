import type { Card } from "../shared/contracts";

export function cardMatchesBoardFilters(
  card: Card,
  search: string,
  tagIds: string[],
  personIds: string[],
): boolean {
  const query = search.trim().toLocaleLowerCase();
  const matchesSearch =
    !query ||
    card.title.toLocaleLowerCase().includes(query) ||
    card.description.toLocaleLowerCase().includes(query);
  const matchesTags = tagIds.length === 0 || card.tags.some((tag) => tagIds.includes(tag.id));
  const matchesPeople =
    personIds.length === 0 ||
    card.assigneeIds.some((participantId) => personIds.includes(participantId));
  return matchesSearch && matchesTags && matchesPeople;
}
