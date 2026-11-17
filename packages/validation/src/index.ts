import { z } from "zod";
import { avatarConfigSchema } from "@entroworld/avatar";
import { LIMITS, USERNAME_PATTERN, ZONE_IDS } from "@entroworld/shared";

// Request payload schemas shared by the API (validation) and the web client (forms).
// Every external input passes through one of these before reaching business logic.

const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "moderator",
  "mod",
  "support",
  "help",
  "system",
  "root",
  "entroworld",
  "official",
  "staff",
  "security",
  "null",
  "undefined",
]);

/** Removes control/bidi/zero-width characters and trims; keeps newlines for multi-line text. */
const clean = (s: string) => s.replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, "").trim();
const singleLine = (s: string) => clean(s).replace(/\s+/g, " ");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: "Enter a valid email address" }));

export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_PATTERN, "3–24 characters: letters, numbers, dots and underscores, starting with a letter")
  .refine((u) => !RESERVED_USERNAMES.has(u.toLowerCase()), { message: "That username is reserved" });

export const passwordSchema = z
  .string()
  .min(LIMITS.password.min, `Use at least ${LIMITS.password.min} characters`)
  .max(LIMITS.password.max, "Password is too long");

export const displayNameSchema = z
  .string()
  .transform(singleLine)
  .pipe(z.string().min(LIMITS.displayName.min, "Display name is required").max(LIMITS.displayName.max));

export const uuidSchema = z.uuid({ message: "Invalid id" });
export const zoneIdSchema = z.enum(ZONE_IDS);

// --- Auth -------------------------------------------------------------------------------------

export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    password: passwordSchema,
    displayName: displayNameSchema.optional(),
  })
  .strict()
  .refine((v) => !v.password.toLowerCase().includes(v.username.toLowerCase()), {
    message: "Password must not contain your username",
    path: ["password"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    /** Email or username. */
    login: z.string().trim().min(1, "Enter your email or username").max(254),
    password: z.string().min(1, "Enter your password").max(LIMITS.password.max),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(16).max(200) }).strict();
export const resendVerificationSchema = z.object({ email: emailSchema }).strict();

// --- Users ------------------------------------------------------------------------------------

export const updateMeSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    bio: z.string().transform(clean).pipe(z.string().max(LIMITS.bio.max)).optional(),
    privacy: z.enum(["public", "friends", "private"]).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update" });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const updateAvatarSchema = avatarConfigSchema;

export const userSearchSchema = z
  .object({
    q: z.string().transform(singleLine).pipe(z.string().min(1).max(40)),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  })
  .strict();

// --- Pagination -------------------------------------------------------------------------------

export const pageQuerySchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type PageQuery = z.infer<typeof pageQuerySchema>;

// --- Posts ------------------------------------------------------------------------------------

export const worldLocationSchema = z
  .object({
    zoneId: zoneIdSchema,
    x: z.number().finite().min(-1000).max(1000),
    y: z.number().finite().min(-100).max(500),
    z: z.number().finite().min(-1000).max(1000),
  })
  .strict();

export const postVisibilitySchema = z.enum(["public", "friends", "private"]);

const postContent = z.string().transform(clean).pipe(z.string().max(LIMITS.postContent.max));

export const createPostSchema = z
  .object({
    content: postContent.default(""),
    visibility: postVisibilitySchema.default("public"),
    location: worldLocationSchema.optional(),
    sharedPostId: uuidSchema.optional(),
  })
  .strict()
  .refine((v) => v.content.length > 0 || v.sharedPostId !== undefined || v.location !== undefined, {
    message: "Write something to post",
    path: ["content"],
  })
  .refine((v) => !(v.sharedPostId && v.location), { message: "A share cannot also be a location post", path: ["location"] });
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z
  .object({ content: postContent.optional(), visibility: postVisibilitySchema.optional() })
  .strict()
  .refine((v) => v.content !== undefined || v.visibility !== undefined, { message: "Nothing to update" });
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export const reactionSchema = z.object({ type: z.enum(["like", "save"]) }).strict();

export const createCommentSchema = z
  .object({ content: z.string().transform(clean).pipe(z.string().min(1, "Write a comment").max(LIMITS.commentContent.max)) })
  .strict();

export const REPORT_REASONS = ["spam", "harassment", "hate", "violence", "sexual", "self_harm", "impersonation", "other"] as const;
export const reportSchema = z
  .object({
    reason: z.enum(REPORT_REASONS),
    details: z.string().transform(clean).pipe(z.string().max(1000)).default(""),
  })
  .strict();
export type ReportInput = z.infer<typeof reportSchema>;

// --- Friends ----------------------------------------------------------------------------------

export const friendRequestSchema = z.object({ userId: uuidSchema }).strict();

// --- World ------------------------------------------------------------------------------------

export const joinWorldSchema = z.object({ zoneId: zoneIdSchema.optional() }).strict();

// --- Params -----------------------------------------------------------------------------------

export const idParamSchema = z.object({ id: uuidSchema }).strict();
export const usernameParamSchema = z.object({ username: z.string().min(1).max(40) }).strict();
