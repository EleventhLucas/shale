import { z } from "zod";

export const idSchema = z.string().min(1).max(100);

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Choose a valid six-digit hex color.")
  .transform((color) => color.toLowerCase());

export const avatarDataUrlSchema = z
  .string()
  .max(400_000)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/)
  .nullable();

export const participantSchema = z.object({
  id: idSchema,
  displayName: z.string().trim().min(1).max(80),
  active: z.boolean(),
  avatarDataUrl: avatarDataUrlSchema,
  color: hexColorSchema,
  revision: z.number().int().positive(),
});

export const defaultTagColor = "#6b6b68";
export const tagColorSchema = hexColorSchema;

export const tagSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(40),
  color: tagColorSchema,
  revision: z.number().int().positive(),
});

export const cardSchema = z.object({
  id: idSchema,
  columnId: idSchema,
  title: z.string(),
  description: z.string(),
  position: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  tags: z.array(tagSchema),
  assigneeIds: z.array(idSchema),
});

export const columnSchema = z.object({
  id: idSchema,
  title: z.string(),
  position: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  cards: z.array(cardSchema),
});

export const boardSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  workspaceId: idSchema,
});

export const workspaceSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  isSandbox: z.boolean(),
  boards: z.array(boardSummarySchema),
});

export const bootstrapSchema = z.object({
  workspaces: z.array(workspaceSummarySchema),
  participants: z.array(participantSchema),
});

export const boardSnapshotSchema = z.object({
  workspace: workspaceSummarySchema.omit({ boards: true }),
  board: boardSummarySchema,
  tags: z.array(tagSchema),
  columns: z.array(columnSchema),
});

export const sessionStateSchema = z.object({
  unlocked: z.boolean(),
  expiresAt: z.string().nullable(),
  passwordRequired: z.boolean(),
});

export const unlockInputSchema = z.object({
  password: z.string().min(1).max(4096),
});

export const createParticipantInputSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export const updateParticipantInputSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  avatarDataUrl: avatarDataUrlSchema.optional(),
  color: hexColorSchema.optional(),
  revision: z.number().int().positive(),
});

const exportedCommentSchema = z.object({
  authorParticipantId: idSchema.nullable(),
  authorName: z.string().trim().min(1).max(80),
  body: z.string().max(50_000),
  createdAt: z.string().datetime(),
});

const exportedCardSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(50_000),
  tagIds: z.array(idSchema).max(50),
  assigneeIds: z.array(idSchema).max(50),
  comments: z.array(exportedCommentSchema).max(1_000),
});

export const boardExportSchema = z.object({
  format: z.literal("shale-board"),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  board: z.object({
    name: z.string().trim().min(1).max(200),
    tags: z
      .array(
        z.object({
          id: idSchema,
          name: z.string().trim().min(1).max(40),
          color: tagColorSchema,
        }),
      )
      .max(500),
    people: z
      .array(
        z.object({
          id: idSchema,
          displayName: z.string().trim().min(1).max(80),
          avatarDataUrl: avatarDataUrlSchema,
          color: hexColorSchema,
        }),
      )
      .max(1_000),
    columns: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(200),
          cards: z.array(exportedCardSchema).max(10_000),
        }),
      )
      .max(500),
  }),
});

export const updateCardInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(50_000),
  revision: z.number().int().positive(),
  force: z.boolean().optional().default(false),
});

export const moveCardInputSchema = z.object({
  targetColumnId: idSchema,
  targetPosition: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
});

export const createTagInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: tagColorSchema.optional().default(defaultTagColor),
});

export const updateTagInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: tagColorSchema,
  revision: z.number().int().positive(),
});

export const updateCardTagsInputSchema = z.object({
  tagIds: z
    .array(idSchema)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length),
  revision: z.number().int().positive(),
});

export const updateCardAssigneesInputSchema = z.object({
  assigneeIds: z
    .array(idSchema)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length),
  revision: z.number().int().positive(),
});

export const trashItemTypeSchema = z.enum(["workspace", "board", "column", "card"]);

export const trashItemSchema = z.object({
  id: idSchema,
  type: trashItemTypeSchema,
  name: z.string(),
  context: z.string(),
  trashedAt: z.string(),
});

export const trashSnapshotSchema = z.object({
  items: z.array(trashItemSchema),
});

export const trashTargetSchema = z.object({
  type: trashItemTypeSchema,
  id: idSchema,
});

export const invalidationEventSchema = z.object({
  resource: z.enum(["board", "card", "participants", "session"]),
  id: idSchema,
  revision: z.number().int().nonnegative(),
});

export type Participant = z.infer<typeof participantSchema>;
export type BoardExport = z.infer<typeof boardExportSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type TagColor = z.infer<typeof tagColorSchema>;
export type TrashItem = z.infer<typeof trashItemSchema>;
export type TrashItemType = z.infer<typeof trashItemTypeSchema>;
export type Card = z.infer<typeof cardSchema>;
export type Column = z.infer<typeof columnSchema>;
export type Bootstrap = z.infer<typeof bootstrapSchema>;
export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;
export type SessionState = z.infer<typeof sessionStateSchema>;
export type InvalidationEvent = z.infer<typeof invalidationEventSchema>;
