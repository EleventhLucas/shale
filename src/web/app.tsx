import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Check,
  ChevronLeft,
  CircleUserRound,
  GripHorizontal,
  LockKeyhole,
  Menu,
  Moon,
  Plus,
  Search,
  Sun,
  Tags,
  UnlockKeyhole,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { BoardSnapshot, Card, Column, Participant, Tag } from "../shared/contracts";
import { ApiError, api } from "./api";
import { Button } from "./components/button";

const participantStorageKey = "shale.participant";
const themeStorageKey = "shale.theme";

function useRealtime(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const events = new EventSource("/_shale/events");
    const invalidate = () => void queryClient.invalidateQueries();
    events.addEventListener("invalidate", invalidate);
    events.onerror = invalidate;
    return () => {
      events.removeEventListener("invalidate", invalidate);
      events.close();
    };
  }, [queryClient]);
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem(themeStorageKey);
    if (stored === "light" || stored === "dark") return stored;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);
  return [theme, setTheme] as const;
}

export function App() {
  useRealtime();
  const [theme, setTheme] = useTheme();
  const [participantId, setParticipantId] = useState(
    () => localStorage.getItem(participantStorageKey) ?? "",
  );
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const session = useQuery({ queryKey: ["session"], queryFn: api.session });
  const bootstrap = useQuery({ queryKey: ["bootstrap"], queryFn: api.bootstrap });

  function selectParticipant(id: string): void {
    localStorage.setItem(participantStorageKey, id);
    setParticipantId(id);
    setIdentityOpen(false);
  }

  const activeParticipant = bootstrap.data?.participants.find(
    (participant) => participant.id === participantId && participant.active,
  );

  function requestEditing(): boolean {
    if (!session.data?.unlocked) {
      setUnlockOpen(true);
      return false;
    }
    if (!activeParticipant) {
      setIdentityOpen(true);
      return false;
    }
    return true;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            bootstrap.isLoading ? (
              <LoadingScreen />
            ) : bootstrap.isError ? (
              <EmptyState message="Shale's server is unavailable. Check the server launch output." />
            ) : bootstrap.data?.workspaces[0]?.boards[0] ? (
              <Navigate
                replace
                to={`/w/${bootstrap.data.workspaces[0].slug}/b/${bootstrap.data.workspaces[0].boards[0].slug}`}
              />
            ) : (
              <EmptyState />
            )
          }
        />
        <Route
          path="/w/:workspaceSlug/b/:boardSlug"
          element={
            <BoardPage
              participant={activeParticipant}
              requestEditing={requestEditing}
              theme={theme}
              setTheme={setTheme}
              openUnlock={() => setUnlockOpen(true)}
              openIdentity={() => setIdentityOpen(true)}
            />
          }
        />
        <Route
          path="/w/:workspaceSlug/b/:boardSlug/c/:cardId"
          element={
            <BoardPage
              participant={activeParticipant}
              requestEditing={requestEditing}
              theme={theme}
              setTheme={setTheme}
              openUnlock={() => setUnlockOpen(true)}
              openIdentity={() => setIdentityOpen(true)}
            />
          }
        />
      </Routes>
      {unlockOpen && (
        <UnlockDialog
          onClose={() => setUnlockOpen(false)}
          onUnlocked={() => {
            setUnlockOpen(false);
            if (!activeParticipant) setIdentityOpen(true);
          }}
        />
      )}
      {identityOpen && (
        <IdentityDialog
          participants={
            bootstrap.data?.participants.filter((participant) => participant.active) ?? []
          }
          onClose={() => setIdentityOpen(false)}
          onSelect={selectParticipant}
        />
      )}
    </BrowserRouter>
  );
}

function BoardPage({
  participant,
  requestEditing,
  theme,
  setTheme,
  openUnlock,
  openIdentity,
}: {
  participant?: Participant;
  requestEditing: () => boolean;
  theme: "light" | "dark";
  setTheme: (value: "light" | "dark") => void;
  openUnlock: () => void;
  openIdentity: () => void;
}) {
  const { workspaceSlug = "", boardSlug = "", cardId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [navOpen, setNavOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string>();
  const [moveError, setMoveError] = useState<string>();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const session = useQuery({ queryKey: ["session"], queryFn: api.session });
  const bootstrap = useQuery({ queryKey: ["bootstrap"], queryFn: api.bootstrap });
  const board = useQuery({
    queryKey: ["board", workspaceSlug, boardSlug],
    queryFn: () => api.board(workspaceSlug, boardSlug),
  });
  const lock = useMutation({
    mutationFn: api.lock,
    onSuccess: (data) => queryClient.setQueryData(["session"], data),
  });
  const boardKey = ["board", workspaceSlug, boardSlug] as const;
  const move = useMutation<
    Card,
    Error,
    { card: Card; targetColumnId: string; targetPosition: number },
    { previous?: BoardSnapshot }
  >({
    mutationFn: ({ card, targetColumnId, targetPosition }) => {
      if (!participant) throw new Error("Select a participant before moving cards.");
      return api.moveCard(
        card.id,
        { targetColumnId, targetPosition, revision: card.revision },
        participant.id,
      );
    },
    onMutate: async ({ card, targetColumnId, targetPosition }) => {
      setMoveError(undefined);
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<BoardSnapshot>(boardKey);
      if (previous) {
        queryClient.setQueryData(
          boardKey,
          moveCardInSnapshot(previous, card.id, targetColumnId, targetPosition),
        );
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous);
      setMoveError(error.message);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: boardKey }),
  });

  const selectedCard = board.data?.columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === cardId);
  const activeCard = board.data?.columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === activeCardId);
  const query = search.trim().toLocaleLowerCase();

  function requestMove(card: Card, targetColumnId: string, targetPosition: number): void {
    if (card.columnId === targetColumnId && card.position === targetPosition) return;
    if (!requestEditing()) return;
    move.mutate({ card, targetColumnId, targetPosition });
  }

  function handleDragStart(event: DragStartEvent): void {
    const card = board.data?.columns
      .flatMap((column) => column.cards)
      .find((item) => item.id === String(event.active.id));
    if (!card || !requestEditing()) return;
    setActiveCardId(card.id);
  }

  function handleDragEnd(event: DragEndEvent): void {
    const draggedId = activeCardId;
    setActiveCardId(undefined);
    if (!draggedId || !event.over || !board.data) return;
    const dragged = board.data.columns
      .flatMap((column) => column.cards)
      .find((card) => card.id === draggedId);
    if (!dragged) return;

    const overId = String(event.over.id);
    const overCard = board.data.columns
      .flatMap((column) => column.cards)
      .find((card) => card.id === overId);
    const targetColumn = overCard
      ? board.data.columns.find((column) => column.id === overCard.columnId)
      : board.data.columns.find((column) => column.id === overId);
    if (!targetColumn) return;

    let targetPosition = overCard
      ? targetColumn.cards.findIndex((card) => card.id === overCard.id)
      : targetColumn.cards.length;
    if (dragged.columnId === targetColumn.id) {
      const sourcePosition = targetColumn.cards.findIndex((card) => card.id === dragged.id);
      if (sourcePosition < targetPosition) targetPosition -= 1;
    }
    requestMove(dragged, targetColumn.id, Math.max(0, targetPosition));
  }

  if (board.isLoading || bootstrap.isLoading) return <LoadingScreen />;
  if (board.error || !board.data) return <EmptyState message="That board could not be found." />;

  return (
    <div className={`app-shell ${navOpen ? "app-shell--nav" : ""}`}>
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand-row">
          <img className="brand-mark" src="/shale-mark.png" alt="" />
          <span>SHALE</span>
        </div>
        <div className="workspace-heading">Workspaces</div>
        <nav>
          {bootstrap.data?.workspaces.map((workspace) => (
            <div className="workspace-group" key={workspace.id}>
              <div className="workspace-name">{workspace.name}</div>
              {workspace.boards.map((item) => (
                <a
                  className={
                    item.slug === boardSlug ? "board-link board-link--active" : "board-link"
                  }
                  href={`/w/${workspace.slug}/b/${item.slug}`}
                  key={item.id}
                >
                  <span className="board-dot" />
                  {item.name}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Archive size={15} /> Trash
          <span>Soon</span>
        </div>
      </aside>

      <main className="board-main">
        <header className="topbar">
          <Button
            variant="quiet"
            size="icon"
            aria-label={navOpen ? "Hide navigation" : "Show navigation"}
            onClick={() => setNavOpen((current) => !current)}
          >
            {navOpen ? <ChevronLeft size={18} /> : <Menu size={18} />}
          </Button>
          <div className="breadcrumbs">
            <span>{board.data.workspace.name}</span>
            <b>/</b>
            <strong>{board.data.board.name}</strong>
          </div>
          <div className="topbar-actions">
            <Button
              variant="quiet"
              size="icon"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </Button>
            {session.data?.unlocked ? (
              <>
                <Button variant="quiet" size="small" onClick={openIdentity}>
                  <CircleUserRound size={16} /> {participant?.displayName ?? "Choose name"}
                </Button>
                {session.data.passwordRequired ? (
                  <Button variant="quiet" size="small" onClick={() => lock.mutate()}>
                    <LockKeyhole size={15} /> Lock
                  </Button>
                ) : (
                  <span className="public-editing">Public editing</span>
                )}
              </>
            ) : (
              <Button size="small" onClick={openUnlock}>
                <UnlockKeyhole size={15} /> Unlock editing
              </Button>
            )}
          </div>
        </header>

        <section className="board-toolbar">
          <label className="search-box">
            <Search size={16} />
            <span className="sr-only">Search cards</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search this board"
            />
            <kbd>/</kbd>
          </label>
          <Button
            variant="quiet"
            size="small"
            onClick={() => {
              if (requestEditing()) setTagManagerOpen(true);
            }}
          >
            <Tags size={15} /> Manage tags
          </Button>
        </section>

        {moveError && (
          <div className="board-error" role="alert">
            {moveError}
          </div>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragCancel={() => setActiveCardId(undefined)}
          onDragEnd={handleDragEnd}
        >
          <section className="board-scroll" aria-label="Board columns">
            {board.data.columns.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                query={query}
                onOpen={(card) =>
                  navigate(`/w/${workspaceSlug}/b/${boardSlug}/c/${encodeURIComponent(card.id)}`)
                }
              />
            ))}
          </section>
          <DragOverlay dropAnimation={null}>
            {activeCard ? <CardPreview card={activeCard} /> : null}
          </DragOverlay>
        </DndContext>
      </main>

      {cardId && (
        <CardDrawer
          key={cardId}
          card={selectedCard}
          boardKey={["board", workspaceSlug, boardSlug]}
          tags={board.data.tags}
          participant={participant}
          requestEditing={requestEditing}
          onClose={() => navigate(`/w/${workspaceSlug}/b/${boardSlug}`)}
        />
      )}
      {tagManagerOpen && (
        <TagManagerDialog
          tags={board.data.tags}
          boardId={board.data.board.id}
          boardKey={["board", workspaceSlug, boardSlug]}
          participant={participant}
          onClose={() => setTagManagerOpen(false)}
        />
      )}
    </div>
  );
}

function moveCardInSnapshot(
  snapshot: BoardSnapshot,
  cardId: string,
  targetColumnId: string,
  targetPosition: number,
): BoardSnapshot {
  const movedCard = snapshot.columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === cardId);
  if (!movedCard || !snapshot.columns.some((column) => column.id === targetColumnId)) {
    return snapshot;
  }

  const columns = snapshot.columns.map((column) => ({
    ...column,
    cards: column.cards.filter((card) => card.id !== cardId),
  }));
  const target = columns.find((column) => column.id === targetColumnId) as Column;
  target.cards.splice(Math.min(targetPosition, target.cards.length), 0, {
    ...movedCard,
    columnId: targetColumnId,
  });

  return {
    ...snapshot,
    columns: columns.map((column) => ({
      ...column,
      cards: column.cards.map((card, position) => {
        const changed = card.columnId !== column.id || card.position !== position;
        return {
          ...card,
          columnId: column.id,
          position,
          revision: changed ? card.revision + 1 : card.revision,
        };
      }),
    })),
  };
}

function BoardColumn({
  column,
  query,
  onOpen,
}: {
  column: Column;
  query: string;
  onOpen: (card: Card) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: column.id,
    data: { type: "column", columnId: column.id },
  });
  const cards = column.cards.filter(
    (card) =>
      !query ||
      card.title.toLocaleLowerCase().includes(query) ||
      card.description.toLocaleLowerCase().includes(query),
  );

  return (
    <div className={`column ${isOver ? "column--over" : ""}`} ref={setNodeRef}>
      <div className="column-heading">
        <h2>{column.title}</h2>
        <span>{cards.length}</span>
      </div>
      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <div className="card-list">
          {cards.map((card) => (
            <SortableCardTile key={card.id} card={card} onOpen={() => onOpen(card)} />
          ))}
          {cards.length === 0 && <div className="column-empty">No matching cards</div>}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCardTile({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const { attributes, isDragging, listeners, setActivatorNodeRef, setNodeRef, transform } =
    useSortable({ id: card.id, data: { type: "card", columnId: card.columnId } });

  return (
    <article
      className={`card-tile ${isDragging ? "card-tile--dragging" : ""}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform) }}
    >
      <button
        className="card-grab-area"
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Drag ${card.title}`}
        {...attributes}
        {...listeners}
      >
        <GripHorizontal size={16} />
        <span className="sr-only">Drag card</span>
      </button>
      <button className="card-open" type="button" onClick={onOpen}>
        <CardContent card={card} />
      </button>
    </article>
  );
}

function CardContent({ card }: { card: Card }) {
  return (
    <>
      <div className="tag-row">
        {card.tags.map((tag) => (
          <span className="tag" key={tag.id}>
            {tag.name}
          </span>
        ))}
      </div>
      <h3>{card.title}</h3>
    </>
  );
}

function CardPreview({ card }: { card: Card }) {
  return (
    <div className="card-preview">
      <CardContent card={card} />
    </div>
  );
}

function CardDrawer({
  card,
  boardKey,
  tags,
  participant,
  requestEditing,
  onClose,
}: {
  card?: Card;
  boardKey: string[];
  tags: Tag[];
  participant?: Participant;
  requestEditing: () => boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card?.title ?? "");
  const [description, setDescription] = useState(card?.description ?? "");
  const [conflict, setConflict] = useState<Card>();

  useEffect(() => {
    if (!editing) {
      setTitle(card?.title ?? "");
      setDescription(card?.description ?? "");
    }
  }, [card, editing]);

  const save = useMutation<Card, Error, boolean>({
    mutationFn: (force = false) => {
      if (!card || !participant) throw new Error("Select a participant before editing.");
      return api.updateCard(
        card.id,
        { title, description, revision: card.revision, force },
        participant.id,
      );
    },
    onSuccess: () => {
      setConflict(undefined);
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: boardKey });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        const current = (error.body as { current?: Card }).current;
        if (current) setConflict(current);
      }
    },
  });

  if (!card) {
    return (
      <div className="drawer-layer">
        <button className="drawer-scrim" type="button" aria-label="Close card" onClick={onClose} />
        <aside className="card-drawer">
          <div className="drawer-top">
            <span>Card not found</span>
            <Button variant="quiet" size="icon" onClick={onClose} aria-label="Close card">
              <X size={18} />
            </Button>
          </div>
        </aside>
      </div>
    );
  }

  function cancelEditing(currentCard: Card): void {
    setTitle(currentCard.title);
    setDescription(currentCard.description);
    setConflict(undefined);
    save.reset();
    setEditing(false);
  }

  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" type="button" aria-label="Close card" onClick={onClose} />
      <aside className="card-drawer" aria-label="Card details">
        <div className="drawer-top">
          <span>CARD · {card.id.replace("card-", "").toUpperCase()}</span>
          <Button variant="quiet" size="icon" onClick={onClose} aria-label="Close card">
            <X size={18} />
          </Button>
        </div>
        <div className="drawer-content">
          <form
            className="card-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (editing) save.mutate(false);
            }}
          >
            <div className="drawer-title-row">
              {editing ? (
                <input
                  className="drawer-title-input"
                  id="card-title"
                  value={title}
                  maxLength={200}
                  required
                  aria-label="Card title"
                  onChange={(event) => setTitle(event.target.value)}
                />
              ) : (
                <h2>{card.title}</h2>
              )}
              <div className="drawer-edit-actions">
                {editing ? (
                  <>
                    <Button
                      type="button"
                      variant="quiet"
                      size="small"
                      onClick={() => cancelEditing(card)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="small" disabled={save.isPending}>
                      <Check size={15} /> {save.isPending ? "Saving…" : "Save"}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="quiet"
                    size="small"
                    onClick={() => {
                      if (requestEditing()) {
                        save.reset();
                        setEditing(true);
                      }
                    }}
                  >
                    Edit
                  </Button>
                )}
              </div>
            </div>
            <CardTagPicker
              card={card}
              tags={tags}
              boardKey={boardKey}
              participant={participant}
              requestEditing={requestEditing}
            />
            <section className="detail-section">
              <h3>Description</h3>
              {editing ? (
                <textarea
                  className="inline-description-input"
                  id="card-description"
                  value={description}
                  maxLength={50_000}
                  aria-label="Card description in Markdown"
                  onChange={(event) => setDescription(event.target.value)}
                />
              ) : (
                <div className="markdown-body">
                  {card.description ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeSanitize]}
                      components={{
                        img: () => null,
                        a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
                      }}
                    >
                      {card.description}
                    </ReactMarkdown>
                  ) : (
                    <p className="muted">No description yet.</p>
                  )}
                </div>
              )}
            </section>
            {save.error && !conflict && <p className="form-error">{save.error.message}</p>}
            {conflict && (
              <div className="conflict-box" role="alert">
                <strong>This card changed in another session.</strong>
                <p>Use the latest version, or overwrite it with your current draft.</p>
                <div className="dialog-actions">
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      setTitle(conflict.title);
                      setDescription(conflict.description);
                      setConflict(undefined);
                      void queryClient.invalidateQueries({ queryKey: boardKey });
                    }}
                  >
                    Use latest
                  </Button>
                  <Button type="button" onClick={() => save.mutate(true)}>
                    Force save
                  </Button>
                </div>
              </div>
            )}
          </form>
        </div>
      </aside>
    </div>
  );
}

function CardTagPicker({
  card,
  tags,
  boardKey,
  participant,
  requestEditing,
}: {
  card: Card;
  tags: Tag[];
  boardKey: string[];
  participant?: Participant;
  requestEditing: () => boolean;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: boardKey });
  const assign = useMutation({
    mutationFn: (tagIds: string[]) => {
      if (!participant) throw new Error("Select a participant before editing tags.");
      return api.updateCardTags(card.id, { tagIds, revision: card.revision }, participant.id);
    },
    onSuccess: refresh,
  });
  const assigned = new Set(card.tags.map((tag) => tag.id));
  const available = tags.filter(
    (tag) =>
      !assigned.has(tag.id) && tag.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );

  function updateTags(tagIds: string[]): void {
    if (!requestEditing()) return;
    assign.mutate(tagIds);
  }

  return (
    <section className="tag-section">
      <h3>Tags</h3>
      <div className="drawer-tags">
        {card.tags.map((tag) => (
          <span className="tag tag--removable" key={tag.id}>
            {tag.name}
            <button
              type="button"
              aria-label={`Remove ${tag.name}`}
              disabled={assign.isPending}
              onClick={() =>
                updateTags(card.tags.filter((item) => item.id !== tag.id).map((item) => item.id))
              }
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <details className="tag-picker">
          <summary>
            <Plus size={13} /> Add tag
          </summary>
          <div className="tag-picker-menu">
            <input
              value={query}
              placeholder="Search tags"
              aria-label="Search available tags"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
            <div className="tag-picker-options">
              {available.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  disabled={assign.isPending}
                  onClick={(event) => {
                    updateTags([...card.tags.map((item) => item.id), tag.id]);
                    setQuery("");
                    const details = event.currentTarget.closest("details");
                    if (details) details.open = false;
                  }}
                >
                  {tag.name}
                </button>
              ))}
              {available.length === 0 && <span>No matching tags</span>}
            </div>
          </div>
        </details>
      </div>
      {assign.error && <p className="form-error">{assign.error.message}</p>}
    </section>
  );
}

function TagManagerDialog({
  tags,
  boardId,
  boardKey,
  participant,
  onClose,
}: {
  tags: Tag[];
  boardId: string;
  boardKey: string[];
  participant?: Participant;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setDrafts(Object.fromEntries(tags.map((tag) => [tag.id, tag.name])));
  }, [tags]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: boardKey });
  const create = useMutation({
    mutationFn: (name: string) => {
      if (!participant) throw new Error("Select a participant before creating tags.");
      return api.createTag(boardId, name, participant.id);
    },
    onSuccess: () => {
      setNewName("");
      void refresh();
    },
  });
  const rename = useMutation({
    mutationFn: ({ tag, name }: { tag: Tag; name: string }) => {
      if (!participant) throw new Error("Select a participant before renaming tags.");
      return api.updateTag(tag.id, { name, revision: tag.revision }, participant.id);
    },
    onSuccess: refresh,
  });
  const error = create.error ?? rename.error;

  return (
    <Dialog title="Manage board tags" onClose={onClose}>
      <p className="dialog-copy">Create and rename the tags available across this board.</p>
      <div className="tag-manager-list">
        {tags.map((tag) => (
          <form
            className="tag-manager-row"
            key={tag.id}
            onSubmit={(event) => {
              event.preventDefault();
              rename.mutate({ tag, name: drafts[tag.id].trim() });
            }}
          >
            <input
              className="tag-name-input"
              value={drafts[tag.id] ?? tag.name}
              maxLength={40}
              aria-label={`Rename ${tag.name}`}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [tag.id]: event.target.value }))
              }
            />
            <Button
              variant="quiet"
              size="small"
              type="submit"
              disabled={
                rename.isPending || !drafts[tag.id]?.trim() || drafts[tag.id]?.trim() === tag.name
              }
            >
              Rename
            </Button>
          </form>
        ))}
      </div>
      <form
        className="tag-create-row"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(newName.trim());
        }}
      >
        <input
          className="tag-name-input"
          value={newName}
          maxLength={40}
          placeholder="New tag"
          aria-label="New tag name"
          onChange={(event) => setNewName(event.target.value)}
        />
        <Button size="small" type="submit" disabled={!newName.trim() || create.isPending}>
          Add tag
        </Button>
      </form>
      {error && <p className="form-error">{error.message}</p>}
    </Dialog>
  );
}

function UnlockDialog({ onClose, onUnlocked }: { onClose: () => void; onUnlocked: () => void }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const unlock = useMutation({
    mutationFn: api.unlock,
    onSuccess: (data) => {
      queryClient.setQueryData(["session"], data);
      onUnlocked();
    },
  });
  return (
    <Dialog title="Unlock editing" onClose={onClose}>
      <p className="dialog-copy">Enter the shared password configured by this Shale host.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          unlock.mutate(password);
        }}
      >
        <label className="field-label" htmlFor="shared-password">
          Shared password
        </label>
        <input
          className="text-input"
          id="shared-password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {unlock.error && <p className="form-error">{unlock.error.message}</p>}
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!password || unlock.isPending}>
            <UnlockKeyhole size={16} /> {unlock.isPending ? "Unlocking…" : "Unlock"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function IdentityDialog({
  participants,
  onClose,
  onSelect,
}: {
  participants: Participant[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const create = useMutation({
    mutationFn: api.createParticipant,
    onSuccess: (participant) => {
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      onSelect(participant.id);
    },
  });
  return (
    <Dialog title="Who are you editing as?" onClose={onClose}>
      <p className="dialog-copy">
        Display names are attribution, not accounts. Every unlocked editor has the same access.
      </p>
      {participants.length > 0 && (
        <div className="participant-list">
          {participants.map((participant) => (
            <button type="button" key={participant.id} onClick={() => onSelect(participant.id)}>
              <span>{participant.displayName.slice(0, 1).toUpperCase()}</span>
              {participant.displayName}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(displayName);
        }}
      >
        <label className="field-label" htmlFor="display-name">
          {participants.length ? "Or add a display name" : "Create a display name"}
        </label>
        <input
          className="text-input"
          id="display-name"
          value={displayName}
          maxLength={80}
          autoFocus
          onChange={(event) => setDisplayName(event.target.value)}
        />
        {create.error && <p className="form-error">{create.error.message}</p>}
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!displayName.trim() || create.isPending}>
            Add name
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="dialog-layer" role="presentation">
      <button className="dialog-scrim" type="button" onClick={onClose} aria-label="Close dialog" />
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-heading">
          <h2 id="dialog-title">{title}</h2>
          <Button variant="quiet" size="icon" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <img src="/shale-mark.png" alt="" />
      <span>Loading Shale…</span>
    </div>
  );
}

function EmptyState({ message = "No boards yet." }: { message?: string }) {
  return <div className="empty-screen">{message}</div>;
}
