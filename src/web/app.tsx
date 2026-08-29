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
  Check,
  ChevronLeft,
  CircleUserRound,
  Download,
  ImagePlus,
  LockKeyhole,
  Menu,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Trash2,
  UnlockKeyhole,
  Upload,
  X,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type {
  BoardExport,
  BoardSnapshot,
  Card,
  Column,
  Participant,
  Tag,
  TagColor,
  TrashItem,
} from "../shared/contracts";
import { boardExportSchema, defaultTagColor } from "../shared/contracts";
import { ApiError, api } from "./api";
import { Button } from "./components/button";

const participantStorageKey = "shale.participant";
const themeStorageKey = "shale.theme";
const tagColorOptions: Array<{ value: TagColor; label: string }> = [
  { value: defaultTagColor, label: "Gray" },
  { value: "#c15b53", label: "Red" },
  { value: "#b87d26", label: "Amber" },
  { value: "#4f8a62", label: "Green" },
  { value: "#4f78b8", label: "Blue" },
  { value: "#8064b2", label: "Violet" },
];

function tagColorStyle(color: TagColor): CSSProperties {
  return { "--tag-color": color } as CSSProperties;
}

function personColorStyle(color: TagColor): CSSProperties {
  return { "--person-color": color } as CSSProperties;
}

function PersonAvatar({ person, className = "" }: { person: Participant; className?: string }) {
  return (
    <span
      className={`person-avatar ${className}`.trim()}
      style={personColorStyle(person.color)}
      aria-hidden="true"
    >
      {person.avatarDataUrl ? (
        <img src={person.avatarDataUrl} alt="" />
      ) : (
        person.displayName.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

async function preparePersonAvatar(
  file: File,
): Promise<{ avatarDataUrl: string; color: TagColor }> {
  if (!(["image/png", "image/jpeg", "image/webp"] as string[]).includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  if (file.size > 5_000_000) throw new Error("Profile pictures must be smaller than 5 MB.");

  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    image.close();
    throw new Error("This browser could not prepare the profile picture.");
  }
  const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  image.close();

  const buckets = new Map<string, { count: number; red: number; green: number; blue: number }>();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 0; index < pixels.length; index += 16) {
    if (pixels[index + 3] < 128) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = `${red >> 5}-${green >> 5}-${blue >> 5}`;
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    buckets.set(key, bucket);
  }
  const dominant = [...buckets.values()].sort((left, right) => right.count - left.count)[0];
  const channel = (value: number) =>
    Math.round(value / dominant.count)
      .toString(16)
      .padStart(2, "0");
  const color = dominant
    ? (`#${channel(dominant.red)}${channel(dominant.green)}${channel(dominant.blue)}` as TagColor)
    : defaultTagColor;
  const avatarDataUrl = canvas.toDataURL("image/webp", 0.82);
  if (avatarDataUrl.length > 400_000) throw new Error("The prepared profile picture is too large.");
  return { avatarDataUrl, color };
}

function TagColorField({
  color,
  label,
  onChange,
}: {
  color: TagColor;
  label: string;
  onChange: (color: TagColor) => void;
}) {
  const preset = tagColorOptions.some((option) => option.value === color) ? color : "custom";

  return (
    <div className="tag-color-field">
      <input
        className="tag-color-input"
        type="color"
        value={color}
        aria-label={`${label}: custom color`}
        title="Choose any color"
        onChange={(event) => onChange(event.target.value as TagColor)}
      />
      <select
        value={preset}
        aria-label={`${label}: color preset`}
        onChange={(event) => {
          if (event.target.value !== "custom") onChange(event.target.value as TagColor);
        }}
      >
        <option value="custom">Custom</option>
        {tagColorOptions.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

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
  const boards = bootstrap.data?.workspaces.flatMap((workspace) => workspace.boards) ?? [];

  function requestEditing(): boolean {
    if (!session.data?.unlocked) {
      setUnlockOpen(true);
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
            ) : boards[0] ? (
              <Navigate replace to={`/b/${encodeURIComponent(boards[0].id)}`} />
            ) : (
              <EmptyState />
            )
          }
        />
        <Route
          path="/b/:boardId"
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
          path="/b/:boardId/c/:cardId"
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
        <Route path="/w/*" element={<Navigate replace to="/" />} />
      </Routes>
      {unlockOpen && (
        <UnlockDialog
          onClose={() => setUnlockOpen(false)}
          onUnlocked={() => {
            setUnlockOpen(false);
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
  const { boardId = "", cardId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [navOpen, setNavOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [createBoardOpen, setCreateBoardOpen] = useState(false);
  const [createCardColumn, setCreateCardColumn] = useState<Column>();
  const [pendingImport, setPendingImport] = useState<{ fileName: string; data: BoardExport }>();
  const [boardFileError, setBoardFileError] = useState<string>();
  const importInput = useRef<HTMLInputElement>(null);
  const [activeCardId, setActiveCardId] = useState<string>();
  const [moveError, setMoveError] = useState<string>();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const session = useQuery({ queryKey: ["session"], queryFn: api.session });
  const bootstrap = useQuery({ queryKey: ["bootstrap"], queryFn: api.bootstrap });
  const board = useQuery({
    queryKey: ["board", boardId],
    queryFn: () => api.board(boardId),
  });
  const lock = useMutation({
    mutationFn: api.lock,
    onSuccess: (data) => queryClient.setQueryData(["session"], data),
  });
  const boardKey = ["board", boardId] as const;
  const exportFile = useMutation({
    mutationFn: () => api.exportBoard(board.data?.board.id ?? ""),
    onSuccess: (data) => {
      setBoardFileError(undefined);
      const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${
        data.board.name
          .toLocaleLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "shale-board"
      }.shale.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: (error) => setBoardFileError(error.message),
  });
  const importFile = useMutation({
    mutationFn: (data: BoardExport) => api.importBoard(board.data?.board.id ?? "", data),
    onSuccess: async () => {
      setPendingImport(undefined);
      setBoardFileError(undefined);
      navigate(`/b/${encodeURIComponent(boardId)}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: boardKey }),
        queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
      ]);
    },
  });
  const move = useMutation<
    Card,
    Error,
    { card: Card; targetColumnId: string; targetPosition: number },
    { previous?: BoardSnapshot }
  >({
    mutationFn: ({ card, targetColumnId, targetPosition }) => {
      return api.moveCard(card.id, {
        targetColumnId,
        targetPosition,
        revision: card.revision,
      });
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
  const people = bootstrap.data?.participants.filter((person) => person.active) ?? [];
  const boards = bootstrap.data?.workspaces.flatMap((workspace) => workspace.boards) ?? [];
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

  async function chooseImportFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setBoardFileError(undefined);
    try {
      if (file.size > 10_000_000) throw new Error("Board files must be smaller than 10 MB.");
      const data = boardExportSchema.parse(JSON.parse(await file.text()));
      setPendingImport({ fileName: file.name, data });
    } catch (error) {
      setBoardFileError(
        error instanceof Error ? error.message : "That is not a valid Shale board file.",
      );
    }
  }

  if (board.isLoading || bootstrap.isLoading) return <LoadingScreen />;
  if (board.error || !board.data) return <EmptyState message="That board could not be found." />;

  return (
    <div className={`app-shell ${navOpen ? "app-shell--nav" : ""}`}>
      <aside className="sidebar" aria-label="Board navigation">
        <div className="brand-row">
          <img className="brand-mark" src="/shale-mark.svg" alt="" />
          <span>SHALE</span>
        </div>
        <div className="board-nav-heading">
          <span>Boards</span>
          <button
            type="button"
            aria-label="Create board"
            title="Create board"
            onClick={() => {
              if (requestEditing()) setCreateBoardOpen(true);
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav className="board-list">
          {boards.map((item) => (
            <a
              className={item.id === boardId ? "board-link board-link--active" : "board-link"}
              href={`/b/${encodeURIComponent(item.id)}`}
              key={item.id}
            >
              <span className="board-dot" />
              {item.name}
            </a>
          ))}
        </nav>
      </aside>

      <input
        ref={importInput}
        className="sr-only"
        type="file"
        accept=".json,.shale.json,application/json"
        aria-label="Choose a Shale board file to import"
        onChange={(event) => {
          void chooseImportFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

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
            <strong>{board.data.board.name}</strong>
          </div>
          <div className="topbar-actions">
            <Button
              variant="quiet"
              size="icon"
              aria-label="Open settings"
              title="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={17} />
            </Button>
            {session.data?.unlocked ? (
              <>
                <Button variant="quiet" size="small" onClick={openIdentity}>
                  {participant ? (
                    <PersonAvatar person={participant} />
                  ) : (
                    <CircleUserRound size={16} />
                  )}
                  {participant?.displayName ?? "Choose person"}
                </Button>
                {session.data.passwordRequired ? (
                  <Button variant="quiet" size="small" onClick={() => lock.mutate()}>
                    <LockKeyhole size={15} /> Lock
                  </Button>
                ) : null}
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
                people={people}
                query={query}
                onOpen={(card) =>
                  navigate(`/b/${encodeURIComponent(boardId)}/c/${encodeURIComponent(card.id)}`)
                }
                onCreate={() => {
                  if (requestEditing()) setCreateCardColumn(column);
                }}
              />
            ))}
          </section>
          <DragOverlay dropAnimation={null}>
            {activeCard ? <CardPreview card={activeCard} people={people} /> : null}
          </DragOverlay>
        </DndContext>
      </main>

      {cardId && (
        <CardDrawer
          key={cardId}
          card={selectedCard}
          boardKey={["board", boardId]}
          tags={board.data.tags}
          people={people}
          participant={participant}
          requestEditing={requestEditing}
          openIdentity={openIdentity}
          onClose={() => navigate(`/b/${encodeURIComponent(boardId)}`)}
          onTrashed={() => navigate(`/b/${encodeURIComponent(boardId)}`)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          board={board.data.board}
          tags={board.data.tags}
          boardId={board.data.board.id}
          boardKey={["board", boardId]}
          people={people}
          requestEditing={requestEditing}
          theme={theme}
          setTheme={setTheme}
          boardFileError={boardFileError}
          exportPending={exportFile.isPending}
          onImport={() => {
            setSettingsOpen(false);
            importInput.current?.click();
          }}
          onExport={() => exportFile.mutate()}
          onOpenArchive={() => {
            setSettingsOpen(false);
            setTrashOpen(true);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {trashOpen && (
        <TrashDialog boardKey={["board", boardId]} onClose={() => setTrashOpen(false)} />
      )}
      {createBoardOpen && (
        <CreateBoardDialog
          onClose={() => setCreateBoardOpen(false)}
          onCreated={(createdBoardId) => {
            setCreateBoardOpen(false);
            navigate(`/b/${encodeURIComponent(createdBoardId)}`);
          }}
        />
      )}
      {createCardColumn && (
        <CreateCardDialog
          column={createCardColumn}
          boardKey={["board", boardId]}
          onClose={() => setCreateCardColumn(undefined)}
          onCreated={(card) => {
            setCreateCardColumn(undefined);
            navigate(`/b/${encodeURIComponent(boardId)}/c/${encodeURIComponent(card.id)}`);
          }}
        />
      )}
      {pendingImport && (
        <ImportBoardDialog
          currentBoardName={board.data.board.name}
          fileName={pendingImport.fileName}
          importedBoardName={pendingImport.data.board.name}
          isPending={importFile.isPending}
          error={importFile.error?.message}
          onClose={() => {
            if (!importFile.isPending) setPendingImport(undefined);
          }}
          onConfirm={() => importFile.mutate(pendingImport.data)}
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
  people,
  query,
  onOpen,
  onCreate,
}: {
  column: Column;
  people: Participant[];
  query: string;
  onOpen: (card: Card) => void;
  onCreate: () => void;
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
        <div className="column-heading-actions">
          <span>{cards.length}</span>
          <button type="button" aria-label={`Add card to ${column.title}`} onClick={onCreate}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <div className="card-list">
          {cards.map((card) => (
            <SortableCardTile
              key={card.id}
              card={card}
              people={people}
              onOpen={() => onOpen(card)}
            />
          ))}
          {cards.length === 0 && <div className="column-empty">No matching cards</div>}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCardTile({
  card,
  people,
  onOpen,
}: {
  card: Card;
  people: Participant[];
  onOpen: () => void;
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform } = useSortable({
    id: card.id,
    data: { type: "card", columnId: card.columnId },
  });
  const sortableAttributes = { ...attributes, role: undefined };

  return (
    <article
      className={`card-tile ${isDragging ? "card-tile--dragging" : ""}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform) }}
      {...sortableAttributes}
      {...listeners}
      aria-label={`${card.title}. Press Space to pick up and move this card.`}
    >
      <button className="card-open" type="button" onClick={onOpen}>
        <CardContent card={card} people={people} />
      </button>
    </article>
  );
}

function CardContent({ card, people }: { card: Card; people: Participant[] }) {
  const assignees = card.assigneeIds
    .map((id) => people.find((person) => person.id === id))
    .filter((person): person is Participant => Boolean(person));
  return (
    <>
      <div className="tag-row">
        {card.tags.map((tag) => (
          <span className="tag" style={tagColorStyle(tag.color)} key={tag.id}>
            {tag.name}
          </span>
        ))}
      </div>
      <h3>{card.title}</h3>
      {assignees.length > 0 && (
        <div className="card-assignees">
          {assignees.map((person) => (
            <span className="card-assignee" title={person.displayName} key={person.id}>
              <PersonAvatar person={person} />
              <span>{person.displayName}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function CardPreview({ card, people }: { card: Card; people: Participant[] }) {
  return (
    <div className="card-preview">
      <CardContent card={card} people={people} />
    </div>
  );
}

function CardDrawer({
  card,
  boardKey,
  tags,
  people,
  participant,
  requestEditing,
  openIdentity,
  onClose,
  onTrashed,
}: {
  card?: Card;
  boardKey: string[];
  tags: Tag[];
  people: Participant[];
  participant?: Participant;
  requestEditing: () => boolean;
  openIdentity: () => void;
  onClose: () => void;
  onTrashed: () => void;
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
      if (!card) throw new Error("Card not found.");
      return api.updateCard(card.id, { title, description, revision: card.revision, force });
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
  const trashCard = useMutation({
    mutationFn: () => {
      if (!card) throw new Error("Card not found.");
      return api.moveToTrash("card", card.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardKey });
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      onTrashed();
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
              requestEditing={requestEditing}
            />
            <CardAssigneePicker
              card={card}
              people={people}
              participant={participant}
              boardKey={boardKey}
              requestEditing={requestEditing}
              openIdentity={openIdentity}
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
          <div className="drawer-danger-row">
            <Button
              type="button"
              variant="quiet"
              size="small"
              disabled={trashCard.isPending}
              onClick={() => {
                if (requestEditing()) trashCard.mutate();
              }}
            >
              <Trash2 size={15} /> {trashCard.isPending ? "Moving…" : "Move card to Trash"}
            </Button>
            {trashCard.error && <p className="form-error">{trashCard.error.message}</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}

function CardTagPicker({
  card,
  tags,
  boardKey,
  requestEditing,
}: {
  card: Card;
  tags: Tag[];
  boardKey: string[];
  requestEditing: () => boolean;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: boardKey });
  const assign = useMutation({
    mutationFn: (tagIds: string[]) =>
      api.updateCardTags(card.id, { tagIds, revision: card.revision }),
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
          <span className="tag tag--removable" style={tagColorStyle(tag.color)} key={tag.id}>
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
                  <i
                    className="tag-color-dot"
                    style={tagColorStyle(tag.color)}
                    aria-hidden="true"
                  />
                  {tag.name}
                </button>
              ))}
              {available.length === 0 && <span className="tag-picker-empty">No matching tags</span>}
            </div>
          </div>
        </details>
      </div>
      {assign.error && <p className="form-error">{assign.error.message}</p>}
    </section>
  );
}

function CardAssigneePicker({
  card,
  people,
  participant,
  boardKey,
  requestEditing,
  openIdentity,
}: {
  card: Card;
  people: Participant[];
  participant?: Participant;
  boardKey: string[];
  requestEditing: () => boolean;
  openIdentity: () => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: boardKey });
  const assign = useMutation({
    mutationFn: (assigneeIds: string[]) =>
      api.updateCardAssignees(card.id, { assigneeIds, revision: card.revision }),
    onSuccess: refresh,
  });
  const assigned = new Set(card.assigneeIds);
  const assignedPeople = card.assigneeIds
    .map((id) => people.find((person) => person.id === id))
    .filter((person): person is Participant => Boolean(person));
  const available = people.filter(
    (person) =>
      !assigned.has(person.id) &&
      person.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );

  function updateAssignees(assigneeIds: string[]): void {
    if (!requestEditing()) return;
    assign.mutate(assigneeIds);
  }

  function assignToMe(): void {
    if (!participant) {
      openIdentity();
      return;
    }
    if (!assigned.has(participant.id)) {
      updateAssignees([...card.assigneeIds, participant.id]);
    }
  }

  return (
    <section className="assignee-section">
      <h3>People</h3>
      <div className="drawer-assignees">
        {assignedPeople.map((person) => (
          <span className="person-badge person-badge--removable" key={person.id}>
            <PersonAvatar person={person} />
            {person.displayName}
            <button
              type="button"
              aria-label={`Unassign ${person.displayName}`}
              disabled={assign.isPending}
              onClick={() =>
                updateAssignees(card.assigneeIds.filter((personId) => personId !== person.id))
              }
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {(!participant || !assigned.has(participant.id)) && (
          <Button
            variant="quiet"
            size="small"
            type="button"
            disabled={assign.isPending}
            onClick={assignToMe}
          >
            <CircleUserRound size={14} /> Add me
          </Button>
        )}
        <details className="tag-picker">
          <summary>
            <Plus size={13} /> Add person
          </summary>
          <div className="tag-picker-menu">
            <input
              value={query}
              placeholder="Search people"
              aria-label="Search available people"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
            <div className="tag-picker-options">
              {available.map((person) => (
                <button
                  type="button"
                  key={person.id}
                  disabled={assign.isPending}
                  onClick={(event) => {
                    updateAssignees([...card.assigneeIds, person.id]);
                    setQuery("");
                    const details = event.currentTarget.closest("details");
                    if (details) details.open = false;
                  }}
                >
                  <PersonAvatar person={person} className="person-dot" />
                  {person.displayName}
                </button>
              ))}
              {available.length === 0 && (
                <span className="tag-picker-empty">No matching people</span>
              )}
            </div>
          </div>
        </details>
      </div>
      {assign.error && <p className="form-error">{assign.error.message}</p>}
    </section>
  );
}

function TagManagerRow({ tag, boardKey }: { tag: Tag; boardKey: string[] }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<TagColor>(tag.color);
  const [failedSignature, setFailedSignature] = useState<string>();
  const previousTag = useRef(tag);
  const update = useMutation({
    mutationFn: ({
      name: nextName,
      color: nextColor,
      revision,
    }: {
      name: string;
      color: TagColor;
      revision: number;
      signature: string;
    }) => {
      return api.updateTag(tag.id, { name: nextName, color: nextColor, revision });
    },
    onSuccess: async () => {
      setFailedSignature(undefined);
      await queryClient.invalidateQueries({ queryKey: boardKey });
    },
    onError: async (_error, variables) => {
      setFailedSignature(variables.signature);
      await queryClient.invalidateQueries({ queryKey: boardKey });
    },
  });
  const { isPending, mutate, reset } = update;
  const remove = useMutation({
    mutationFn: () => api.deleteTag(tag.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardKey }),
  });

  useEffect(() => {
    const previous = previousTag.current;
    setName((current) => (current.trim() === previous.name ? tag.name : current));
    setColor((current) => (current === previous.color ? tag.color : current));
    previousTag.current = tag;
  }, [tag]);

  const persist = useCallback(() => {
    const nextName = name.trim();
    const signature = `${nextName}\u0000${color}\u0000${tag.revision}`;
    if (
      !nextName ||
      isPending ||
      (nextName === tag.name && color === tag.color) ||
      failedSignature === signature
    ) {
      return;
    }

    mutate({ name: nextName, color, revision: tag.revision, signature });
  }, [color, failedSignature, isPending, mutate, name, tag]);

  useEffect(() => {
    const nextName = name.trim();
    const delay = nextName === tag.name && color !== tag.color ? 0 : 400;
    const timeout = window.setTimeout(persist, delay);
    return () => window.clearTimeout(timeout);
  }, [color, name, persist, tag.color, tag.name]);

  return (
    <div className="tag-manager-row">
      <input
        className="tag-name-input"
        value={name}
        maxLength={40}
        aria-label={`Rename ${tag.name}`}
        onBlur={persist}
        onChange={(event) => {
          if (!isPending) reset();
          setFailedSignature(undefined);
          setName(event.target.value);
        }}
      />
      <TagColorField
        color={color}
        label={`Color for ${tag.name}`}
        onChange={(nextColor) => {
          if (!isPending) reset();
          setFailedSignature(undefined);
          setColor(nextColor);
        }}
      />
      <Button
        variant="quiet"
        size="icon"
        type="button"
        aria-label={`Delete ${tag.name}`}
        title={`Delete ${tag.name}`}
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        <Trash2 size={15} />
      </Button>
    </div>
  );
}

function PersonManagerRow({ person, boardKey }: { person: Participant; boardKey: string[] }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(person.displayName);
  const [failedSignature, setFailedSignature] = useState<string>();
  const [avatarError, setAvatarError] = useState<string>();
  const previousPerson = useRef(person);
  const update = useMutation({
    mutationFn: ({
      name,
      revision,
      avatarDataUrl,
      color,
    }: {
      name: string;
      revision: number;
      signature: string;
      avatarDataUrl?: string | null;
      color?: TagColor;
    }) => api.updateParticipant(person.id, { displayName: name, avatarDataUrl, color, revision }),
    onSuccess: async () => {
      setFailedSignature(undefined);
      setAvatarError(undefined);
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    },
    onError: async (_error, variables) => {
      setFailedSignature(variables.signature);
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    },
  });
  const { isPending, mutate, reset } = update;
  const remove = useMutation({
    mutationFn: () => api.deleteParticipant(person.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
        queryClient.invalidateQueries({ queryKey: boardKey }),
      ]);
    },
  });

  useEffect(() => {
    const previous = previousPerson.current;
    setDisplayName((current) =>
      current.trim() === previous.displayName ? person.displayName : current,
    );
    previousPerson.current = person;
  }, [person]);

  const persist = useCallback(() => {
    const name = displayName.trim();
    const signature = `${name}\u0000${person.revision}`;
    if (!name || isPending || name === person.displayName || failedSignature === signature) {
      return;
    }
    mutate({ name, revision: person.revision, signature });
  }, [displayName, failedSignature, isPending, mutate, person]);

  useEffect(() => {
    const timeout = window.setTimeout(persist, 400);
    return () => window.clearTimeout(timeout);
  }, [persist]);

  async function selectAvatar(file: File | undefined): Promise<void> {
    if (!file || isPending) return;
    setAvatarError(undefined);
    try {
      const profile = await preparePersonAvatar(file);
      mutate({
        name: displayName.trim() || person.displayName,
        revision: person.revision,
        signature: `avatar-${file.name}-${file.lastModified}`,
        ...profile,
      });
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Could not prepare that image.");
    }
  }

  return (
    <div className="person-manager-entry">
      <div className="person-manager-row">
        <div className="person-avatar-controls">
          <label
            className="person-avatar-upload"
            title={`Upload a picture for ${person.displayName}`}
          >
            <PersonAvatar person={person} />
            <ImagePlus size={12} />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={`Upload a profile picture for ${person.displayName}`}
              disabled={isPending}
              onChange={(event) => {
                void selectAvatar(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {person.avatarDataUrl && (
            <button
              className="person-avatar-remove"
              type="button"
              aria-label={`Remove ${person.displayName}'s profile picture`}
              title="Remove profile picture"
              disabled={isPending}
              onClick={() =>
                mutate({
                  name: displayName.trim() || person.displayName,
                  avatarDataUrl: null,
                  color: defaultTagColor,
                  revision: person.revision,
                  signature: `remove-avatar-${person.revision}`,
                })
              }
            >
              <X size={10} />
            </button>
          )}
        </div>
        <input
          className="tag-name-input"
          value={displayName}
          maxLength={80}
          aria-label={`Rename ${person.displayName}`}
          onBlur={persist}
          onChange={(event) => {
            if (!isPending) reset();
            setFailedSignature(undefined);
            setDisplayName(event.target.value);
          }}
        />
        <Button
          variant="quiet"
          size="icon"
          type="button"
          aria-label={`Delete ${person.displayName}`}
          title={`Delete ${person.displayName}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash2 size={15} />
        </Button>
      </div>
      {avatarError && <p className="person-avatar-error">{avatarError}</p>}
    </div>
  );
}

function CreateBoardDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (boardId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.createBoard(name.trim()),
    onSuccess: async (board) => {
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      onCreated(board.id);
    },
  });
  return (
    <Dialog title="Create board" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className="field-label" htmlFor="new-board-name">
          Board name
        </label>
        <input
          className="text-input"
          id="new-board-name"
          value={name}
          maxLength={200}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        {create.error && <p className="form-error">{create.error.message}</p>}
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            <Plus size={15} /> {create.isPending ? "Creating…" : "Create board"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CreateCardDialog({
  column,
  boardKey,
  onClose,
  onCreated,
}: {
  column: Column;
  boardKey: string[];
  onClose: () => void;
  onCreated: (card: Card) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: () => api.createCard(column.id, title.trim()),
    onSuccess: async (card) => {
      await queryClient.invalidateQueries({ queryKey: boardKey });
      onCreated(card);
    },
  });
  return (
    <Dialog title={`Add card to ${column.title}`} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className="field-label" htmlFor="new-card-title">
          Card title
        </label>
        <input
          className="text-input"
          id="new-card-title"
          value={title}
          maxLength={200}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
        {create.error && <p className="form-error">{create.error.message}</p>}
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!title.trim() || create.isPending}>
            <Plus size={15} /> {create.isPending ? "Adding…" : "Add card"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function BoardNameField({
  board,
  boardKey,
}: {
  board: BoardSnapshot["board"];
  boardKey: string[];
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(board.name);
  const previousBoard = useRef(board);
  const update = useMutation({
    mutationFn: ({ nextName, revision }: { nextName: string; revision: number }) =>
      api.updateBoard(board.id, { name: nextName, revision }),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: boardKey }),
        queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
      ]);
    },
  });
  useEffect(() => {
    const previous = previousBoard.current;
    setName((current) => (current.trim() === previous.name ? board.name : current));
    previousBoard.current = board;
  }, [board]);
  const persist = useCallback(() => {
    const nextName = name.trim();
    if (!nextName || nextName === board.name || update.isPending) return;
    update.mutate({ nextName, revision: board.revision });
  }, [board, name, update]);
  useEffect(() => {
    const timeout = window.setTimeout(persist, 400);
    return () => window.clearTimeout(timeout);
  }, [persist]);
  return (
    <label className="misc-board-name">
      <span>Board name</span>
      <input
        className="text-input"
        value={name}
        maxLength={200}
        onBlur={persist}
        onChange={(event) => setName(event.target.value)}
      />
    </label>
  );
}

function SettingsDialog({
  board,
  tags,
  people,
  boardId,
  boardKey,
  requestEditing,
  theme,
  setTheme,
  boardFileError,
  exportPending,
  onImport,
  onExport,
  onOpenArchive,
  onClose,
}: {
  board: BoardSnapshot["board"];
  tags: Tag[];
  people: Participant[];
  boardId: string;
  boardKey: string[];
  requestEditing: () => boolean;
  theme: "light" | "dark";
  setTheme: (value: "light" | "dark") => void;
  boardFileError?: string;
  exportPending: boolean;
  onImport: () => void;
  onExport: () => void;
  onOpenArchive: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<"appearance" | "tags" | "people" | "misc">("appearance");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<TagColor>(defaultTagColor);
  const [newPersonName, setNewPersonName] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: boardKey });
  const create = useMutation({
    mutationFn: ({ name, color }: { name: string; color: TagColor }) =>
      api.createTag(boardId, name, color),
    onSuccess: () => {
      setNewName("");
      setNewColor(defaultTagColor);
      void refresh();
    },
  });
  const createPerson = useMutation({
    mutationFn: api.createParticipant,
    onSuccess: () => {
      setNewPersonName("");
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    },
  });

  return (
    <Dialog title="Settings" onClose={onClose} alignTop>
      <div className="settings-tabs" role="tablist" aria-label="Settings categories">
        <button
          id="settings-appearance-tab"
          className={
            section === "appearance" ? "settings-tab settings-tab--active" : "settings-tab"
          }
          type="button"
          role="tab"
          aria-selected={section === "appearance"}
          aria-controls="settings-appearance-panel"
          onClick={() => setSection("appearance")}
        >
          Appearance
        </button>
        <button
          id="settings-tags-tab"
          className={section === "tags" ? "settings-tab settings-tab--active" : "settings-tab"}
          type="button"
          role="tab"
          aria-selected={section === "tags"}
          aria-controls="settings-tags-panel"
          onClick={() => {
            if (requestEditing()) setSection("tags");
          }}
        >
          Tags
        </button>
        <button
          id="settings-people-tab"
          className={section === "people" ? "settings-tab settings-tab--active" : "settings-tab"}
          type="button"
          role="tab"
          aria-selected={section === "people"}
          aria-controls="settings-people-panel"
          onClick={() => {
            if (requestEditing()) setSection("people");
          }}
        >
          Persons
        </button>
        <button
          id="settings-misc-tab"
          className={section === "misc" ? "settings-tab settings-tab--active" : "settings-tab"}
          type="button"
          role="tab"
          aria-selected={section === "misc"}
          aria-controls="settings-misc-panel"
          onClick={() => {
            if (requestEditing()) setSection("misc");
          }}
        >
          Misc.
        </button>
      </div>

      {section === "appearance" ? (
        <section
          className="settings-section settings-panel"
          id="settings-appearance-panel"
          role="tabpanel"
          aria-labelledby="settings-appearance-tab"
        >
          <h3>Theme</h3>
          <Button
            className="theme-toggle"
            variant="quiet"
            type="button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Moon size={17} /> : <Sun size={17} />}
            <span>{theme === "dark" ? "Dark mode" : "Light mode"}</span>
          </Button>
        </section>
      ) : section === "tags" ? (
        <section
          className="settings-section settings-panel"
          id="settings-tags-panel"
          role="tabpanel"
          aria-labelledby="settings-tags-tab"
        >
          <p className="dialog-copy">Edit the tags available across this board.</p>
          <div className="tag-manager-list">
            {tags.map((tag) => (
              <TagManagerRow tag={tag} boardKey={boardKey} key={tag.id} />
            ))}
          </div>
          <form
            className="tag-create-row"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate({ name: newName.trim(), color: newColor });
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
            <TagColorField color={newColor} label="New tag color" onChange={setNewColor} />
            <Button size="small" type="submit" disabled={!newName.trim() || create.isPending}>
              Add tag
            </Button>
          </form>
          {create.error && <p className="form-error">{create.error.message}</p>}
        </section>
      ) : section === "people" ? (
        <section
          className="settings-section settings-panel"
          id="settings-people-panel"
          role="tabpanel"
          aria-labelledby="settings-people-tab"
        >
          <p className="dialog-copy">Manage the people available for card assignments.</p>
          <div className="person-manager-list">
            {people.map((person) => (
              <PersonManagerRow person={person} boardKey={boardKey} key={person.id} />
            ))}
          </div>
          <form
            className="person-create-row"
            onSubmit={(event) => {
              event.preventDefault();
              createPerson.mutate(newPersonName.trim());
            }}
          >
            <input
              className="tag-name-input"
              value={newPersonName}
              maxLength={80}
              placeholder="New person"
              aria-label="New person name"
              onChange={(event) => setNewPersonName(event.target.value)}
            />
            <Button
              size="small"
              type="submit"
              disabled={!newPersonName.trim() || createPerson.isPending}
            >
              Add person
            </Button>
          </form>
          {createPerson.error && <p className="form-error">{createPerson.error.message}</p>}
        </section>
      ) : (
        <section
          className="settings-section settings-panel"
          id="settings-misc-panel"
          role="tabpanel"
          aria-labelledby="settings-misc-tab"
        >
          <p className="dialog-copy">Transfer this board or open the recoverable archive.</p>
          <BoardNameField board={board} boardKey={boardKey} />
          <div className="misc-actions">
            <Button type="button" variant="quiet" onClick={onImport}>
              <Upload size={16} /> Import board
            </Button>
            <Button type="button" variant="quiet" disabled={exportPending} onClick={onExport}>
              <Download size={16} /> {exportPending ? "Exporting…" : "Export board"}
            </Button>
            <Button type="button" variant="quiet" onClick={onOpenArchive}>
              <Trash2 size={16} /> Archive
            </Button>
          </div>
          {boardFileError && <p className="form-error">{boardFileError}</p>}
        </section>
      )}
    </Dialog>
  );
}

function ImportBoardDialog({
  currentBoardName,
  importedBoardName,
  fileName,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  currentBoardName: string;
  importedBoardName: string;
  fileName: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog title="Replace this board?" onClose={onClose}>
      <div className="import-warning">
        <strong>This import cannot be undone.</strong>
        <p>
          <b>{fileName}</b> will replace every column, card, tag, assignment, and comment on
          {` ${currentBoardName}`}. The board will be renamed to {importedBoardName}.
        </p>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="dialog-actions">
        <Button type="button" variant="quiet" disabled={isPending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={isPending} onClick={onConfirm}>
          <Upload size={15} /> {isPending ? "Replacing…" : "Replace board"}
        </Button>
      </div>
    </Dialog>
  );
}

function TrashDialog({ boardKey, onClose }: { boardKey: string[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string>();
  const trash = useQuery({ queryKey: ["trash"], queryFn: api.trash });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["trash"] });
    void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    void queryClient.invalidateQueries({ queryKey: boardKey });
  };
  const restore = useMutation({
    mutationFn: (item: TrashItem) => api.restoreFromTrash(item.type, item.id),
    onSuccess: refresh,
  });
  const purge = useMutation({
    mutationFn: (item: TrashItem) => api.permanentlyDelete(item.type, item.id),
    onSuccess: () => {
      setConfirming(undefined);
      refresh();
    },
  });
  const error = restore.error ?? purge.error;

  return (
    <Dialog title="Archive" onClose={onClose}>
      <p className="dialog-copy">
        Restore recoverable items or permanently delete them. Items stay here until you choose.
      </p>
      {trash.isLoading ? (
        <div className="trash-empty">Loading archive…</div>
      ) : trash.error ? (
        <p className="form-error">{trash.error.message}</p>
      ) : trash.data?.items.length ? (
        <div className="trash-list">
          {trash.data.items.map((item) => {
            const itemKey = `${item.type}:${item.id}`;
            return (
              <article className="trash-item" key={itemKey}>
                <div className="trash-item-heading">
                  <span>{item.type}</span>
                  <strong>{item.name}</strong>
                </div>
                <p>{item.context}</p>
                <time dateTime={item.trashedAt}>{formatTrashDate(item.trashedAt)}</time>
                {confirming === itemKey ? (
                  <div className="trash-confirm" role="alert">
                    <span>Delete permanently? This cannot be undone.</span>
                    <div>
                      <Button
                        type="button"
                        variant="quiet"
                        size="small"
                        onClick={() => setConfirming(undefined)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="small"
                        disabled={purge.isPending}
                        onClick={() => purge.mutate(item)}
                      >
                        Delete forever
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="trash-actions">
                    <Button
                      type="button"
                      variant="quiet"
                      size="small"
                      disabled={restore.isPending || purge.isPending}
                      onClick={() => restore.mutate(item)}
                    >
                      <RotateCcw size={14} /> Restore
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      size="small"
                      disabled={restore.isPending || purge.isPending}
                      onClick={() => setConfirming(itemKey)}
                    >
                      <Trash2 size={14} /> Delete forever
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="trash-empty">
          <Trash2 size={22} />
          <span>Archive is empty.</span>
        </div>
      )}
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
  const [query, setQuery] = useState("");
  const matching = participants.filter((participant) =>
    participant.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <Dialog title="Choose yourself" onClose={onClose}>
      <p className="dialog-copy">
        This is optional and only powers shortcuts such as Add me. It does not change edit access.
      </p>
      <details className="identity-picker">
        <summary>
          <CircleUserRound size={16} /> Select a person
        </summary>
        <div className="identity-picker-menu">
          <label className="search-box identity-search">
            <Search size={15} />
            <span className="sr-only">Search people</span>
            <input
              value={query}
              placeholder="Search people"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="participant-list">
            {matching.map((participant) => (
              <button type="button" key={participant.id} onClick={() => onSelect(participant.id)}>
                <PersonAvatar person={participant} />
                {participant.displayName}
              </button>
            ))}
            {participants.length === 0 && (
              <span className="identity-empty">Add people from Settings first.</span>
            )}
            {participants.length > 0 && matching.length === 0 && (
              <span className="identity-empty">No matching people.</span>
            )}
          </div>
        </div>
      </details>
      <div className="dialog-actions">
        <Button type="button" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

function Dialog({
  title,
  onClose,
  alignTop = false,
  children,
}: {
  title: string;
  onClose: () => void;
  alignTop?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={alignTop ? "dialog-layer dialog-layer--top" : "dialog-layer"}
      role="presentation"
    >
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
      <img src="/shale-mark.svg" alt="" />
      <span>Loading Shale…</span>
    </div>
  );
}

function EmptyState({ message = "No boards yet." }: { message?: string }) {
  return <div className="empty-screen">{message}</div>;
}

function formatTrashDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
