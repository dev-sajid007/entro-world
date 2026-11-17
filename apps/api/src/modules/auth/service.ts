import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { generateAvatar } from "@entroworld/avatar";
import { emailTokens, isUniqueViolation, profiles, saveAvatar, sessions, users, type DbExecutor } from "@entroworld/database";
import type { AuthTokenResponse, CurrentUser, RegisterResponse, SessionView } from "@entroworld/shared";
import type { LoginInput, RegisterInput } from "@entroworld/validation";
import type { AppContext } from "../../context";
import { AppError, conflict, forbidden, notFound, tooManyRequests, unauthorized } from "../../lib/errors";
import { hashPassword, verifyPassword } from "../../lib/passwords";
import { randomToken, sha256 } from "../../lib/tokens";
import { revokedSessionKey } from "../../plugins/auth";

export const REFRESH_COOKIE = "ew_refresh";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";
/** A rotated token presented again within this window is a concurrent refresh, not theft. */
const ROTATION_GRACE_MS = 15_000;
const VERIFY_TOKEN_TTL_MS = 48 * 3600 * 1000;
const LOGIN_FAILURE_LIMIT = 10;
const LOGIN_FAILURE_WINDOW_S = 15 * 60;

export async function loadCurrentUser(db: DbExecutor, userId: string): Promise<CurrentUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export class AuthService {
  constructor(private readonly ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }

  async register(input: RegisterInput, request: FastifyRequest, reply: FastifyReply): Promise<RegisterResponse> {
    const passwordHash = await hashPassword(input.password);
    let userId: string;
    let verifyToken: string;
    try {
      ({ userId, verifyToken } = await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email: input.email, username: input.username, passwordHash, displayName: input.displayName ?? input.username })
          .returning({ id: users.id });
        await tx.insert(profiles).values({ userId: user!.id });
        await saveAvatar(tx, user!.id, generateAvatar(input.username));
        const token = await this.createEmailToken(tx, user!.id);
        return { userId: user!.id, verifyToken: token };
      }));
    } catch (e) {
      if (isUniqueViolation(e, "users_email_lower_unique")) throw conflict("An account with this email already exists", "email_taken", { fields: { email: "Already registered" } });
      if (isUniqueViolation(e, "users_username_lower_unique")) throw conflict("That username is taken", "username_taken", { fields: { username: "Already taken" } });
      throw e;
    }
    request.log.info({ audit: "auth.register", userId }, "account created");
    await this.sendVerification(input.email, verifyToken);

    if (this.ctx.env.REQUIRE_EMAIL_VERIFICATION) return { session: null, verificationRequired: true };
    return { session: await this.startSession(userId, request, reply), verificationRequired: false };
  }

  async login(input: LoginInput, request: FastifyRequest, reply: FastifyReply): Promise<AuthTokenResponse> {
    const failKey = `ew:login-fail:${sha256(input.login.toLowerCase())}`;
    const failures = Number((await this.ctx.redis.get(failKey)) ?? 0);
    if (failures >= LOGIN_FAILURE_LIMIT) throw tooManyRequests("Too many failed sign-in attempts. Try again in a few minutes.");

    const login = input.login.toLowerCase();
    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash, status: users.status, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(and(isNull(users.deletedAt), login.includes("@") ? sql`lower(${users.email}) = ${login}` : sql`lower(${users.username}) = ${login}`))
      .limit(1);

    const ok = await verifyPassword(user?.passwordHash ?? null, input.password);
    if (!user || !ok) {
      await this.ctx.redis.multi().incr(failKey).expire(failKey, LOGIN_FAILURE_WINDOW_S).exec();
      request.log.info({ audit: "auth.login_failed", userId: user?.id ?? null }, "sign-in failed");
      throw unauthorized("Incorrect email/username or password", "invalid_credentials");
    }
    if (user.status !== "active") throw forbidden("This account is suspended", "account_suspended");
    if (this.ctx.env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) throw forbidden("Verify your email address first", "email_not_verified");

    await this.ctx.redis.del(failKey);
    request.log.info({ audit: "auth.login", userId: user.id }, "signed in");
    return this.startSession(user.id, request, reply);
  }

  /** Rotates the refresh token from the cookie and issues a new access token. */
  async refresh(request: FastifyRequest, reply: FastifyReply): Promise<AuthTokenResponse> {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized("No active session", "no_session");
    const [row] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, sha256(token))).limit(1);
    if (!row) {
      this.clearCookie(reply);
      throw unauthorized("No active session", "no_session");
    }
    if (row.revokedAt) {
      if (row.replacedById && Date.now() - row.revokedAt.getTime() < ROTATION_GRACE_MS) {
        // Another tab refreshed with the same cookie a moment ago; the browser now holds the new one.
        throw new AppError(409, "refresh_in_progress", "Session is being refreshed; retry");
      }
      if (row.replacedById) {
        // A rotated-out token came back: assume it was stolen and end the whole session.
        await this.revokeFamily(row.familyId);
        request.log.warn({ audit: "auth.refresh_reuse", userId: row.userId, sessionId: row.familyId }, "refresh token reuse detected");
      }
      this.clearCookie(reply);
      throw unauthorized("This session was signed out", "session_revoked");
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      this.clearCookie(reply);
      throw unauthorized("Your session expired", "session_expired");
    }
    const user = await loadCurrentUser(this.db, row.userId);
    if (!user || user.status !== "active") {
      await this.revokeFamily(row.familyId);
      this.clearCookie(reply);
      throw forbidden("This account is suspended", "account_suspended");
    }

    const next = randomToken();
    const nextId = randomUUID();
    const rotated = await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(sessions)
        .set({ revokedAt: new Date(), replacedById: nextId })
        .where(and(eq(sessions.id, row.id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      if (updated.length === 0) return false; // lost a race with a concurrent refresh
      await tx.insert(sessions).values({
        id: nextId,
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: sha256(next),
        userAgent: row.userAgent,
        ip: request.ip.slice(0, 64),
        expiresAt: this.refreshExpiry(),
      });
      return true;
    });
    if (!rotated) throw new AppError(409, "refresh_in_progress", "Session is being refreshed; retry");
    this.setCookie(reply, next);
    return this.issueAccess(user, row.familyId);
  }

  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies[REFRESH_COOKIE];
    let familyId = request.auth?.sessionId ?? null;
    if (!familyId && token) {
      const [row] = await this.db.select({ familyId: sessions.familyId }).from(sessions).where(eq(sessions.tokenHash, sha256(token))).limit(1);
      familyId = row?.familyId ?? null;
    }
    if (familyId) await this.revokeFamily(familyId);
    this.clearCookie(reply);
  }

  async listSessions(userId: string, currentFamilyId: string): Promise<SessionView[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
    return rows
      .map((r) => ({
        id: r.familyId,
        userAgent: r.userAgent,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt.toISOString(),
        current: r.familyId === currentFamilyId,
      }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }

  async revokeSession(userId: string, familyId: string): Promise<void> {
    const [row] = await this.db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, userId), eq(sessions.familyId, familyId))).limit(1);
    if (!row) throw notFound("Session");
    await this.revokeFamily(familyId);
  }

  async verifyEmail(token: string): Promise<void> {
    const now = new Date();
    const verified = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(emailTokens)
        .set({ usedAt: now })
        .where(and(eq(emailTokens.tokenHash, sha256(token)), eq(emailTokens.purpose, "verify_email"), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now)))
        .returning({ userId: emailTokens.userId });
      if (!row) return false;
      await tx.update(users).set({ emailVerifiedAt: now }).where(and(eq(users.id, row.userId), isNull(users.emailVerifiedAt)));
      return true;
    });
    if (!verified) throw new AppError(400, "invalid_token", "This verification link is invalid or has expired");
  }

  /** Always succeeds from the caller's point of view, so it can't be used to probe for accounts. */
  async resendVerification(email: string): Promise<void> {
    const [user] = await this.db
      .select({ id: users.id, email: users.email, verified: users.emailVerifiedAt })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email.toLowerCase()}`, isNull(users.deletedAt)))
      .limit(1);
    if (!user || user.verified) return;
    const token = await this.createEmailToken(this.db, user.id);
    await this.sendVerification(user.email, token);
  }

  /** Ends every device session of a family: refresh tokens in the DB, access tokens via Redis. */
  async revokeFamily(familyId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
    await this.ctx.redis.set(revokedSessionKey(familyId), "1", "EX", this.ctx.env.ACCESS_TOKEN_TTL_SECONDS + 60);
  }

  private async startSession(userId: string, request: FastifyRequest, reply: FastifyReply): Promise<AuthTokenResponse> {
    const user = await loadCurrentUser(this.db, userId);
    if (!user) throw unauthorized();
    const familyId = randomUUID();
    const token = randomToken();
    await this.db.insert(sessions).values({
      userId,
      familyId,
      tokenHash: sha256(token),
      userAgent: (request.headers["user-agent"] ?? "").slice(0, 300) || null,
      ip: request.ip.slice(0, 64),
      expiresAt: this.refreshExpiry(),
    });
    this.setCookie(reply, token);
    return this.issueAccess(user, familyId);
  }

  private async issueAccess(user: CurrentUser, familyId: string): Promise<AuthTokenResponse> {
    const { token, expiresAt } = await this.ctx.accessTokens.sign({ userId: user.id, sessionId: familyId, role: user.role });
    await this.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
    return { accessToken: token, accessTokenExpiresAt: expiresAt.toISOString(), user };
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.ctx.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }

  private setCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.ctx.env.COOKIE_SECURE,
      sameSite: "strict",
      path: REFRESH_COOKIE_PATH,
      maxAge: this.ctx.env.REFRESH_TOKEN_TTL_DAYS * 86_400,
    });
  }

  private clearCookie(reply: FastifyReply): void {
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, httpOnly: true, secure: this.ctx.env.COOKIE_SECURE, sameSite: "strict" });
  }

  private async createEmailToken(db: DbExecutor, userId: string): Promise<string> {
    const token = randomToken();
    await db.insert(emailTokens).values({ userId, purpose: "verify_email", tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS) });
    return token;
  }

  private async sendVerification(email: string, token: string): Promise<void> {
    const url = `${this.ctx.env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    await this.ctx.mailer.send({
      to: email,
      subject: "Confirm your EntroWorld email address",
      text: `Welcome to EntroWorld!\n\nConfirm your email address by opening this link:\n${url}\n\nThe link expires in 48 hours. If you didn't create an account, ignore this message.`,
    });
  }
}
