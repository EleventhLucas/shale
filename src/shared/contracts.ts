import { z } from "zod";

export const idSchema = z.string().min(1).max(100);

export const participantSchema = z.object({
  id: idSchema,
  displayName: z.string(),
  active: z.boolean(),
});

export const tagSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(40),
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
});

export const updateTagInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  revision: z.number().int().positive(),
});

export const updateCardTagsInputSchema = z.object({
  tagIds: z
    .array(idSchema)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length),
  revision: z.number().int().positive(),
});

export const invalidationEventSchema = z.object({
  resource: z.enum(["board", "card", "participants", "session"]),
  id: idSchema,
  revision: z.number().int().nonnegative(),
});

export type Participant = z.infer<typeof participantSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type Card = z.infer<typeof cardSchema>;
export type Column = z.infer<typeof columnSchema>;
export type Bootstrap = z.infer<typeof bootstrapSchema>;
export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;
export type SessionState = z.infer<typeof sessionStateSchema>;
export type InvalidationEvent = z.infer<typeof invalidationEventSchema>;
