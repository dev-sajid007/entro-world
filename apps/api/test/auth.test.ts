import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sessions } from "@entroworld/database";
import { TEST_PASSWORD, call, createHarness, refreshCookie, register, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

describe("registration", () => {
  it("creates an account, signs in, and sets an httpOnly refresh cookie", async () => {
    const res = await call(h, "POST", "/auth/register", {
      body: { email: "Ada@Example.test", username: "ada_l", password: TEST_PASSWORD, displayName: "  Ada   Lovelace " },
    });
    expect(res.statusCode).toBe(201);
    expect(res.data.verificationRequired).toBe(false);
    expect(res.data.session.user).toMatchObject({ username: "ada_l", displayName: "Ada Lovelace", email: "ada@example.test", emailVerified: false, role: "user" });
    const cookie = res.cookies.find((c) => c.name === "ew_refresh")!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/api/v1/auth" });
    expect(h.mail.outbox).toHaveLength(1);
    expect(h.mail.outbox[0]!.text).toContain("/verify-email?token=");

    const me = await call(h, "GET", "/auth/me", { as: res.data.session });
    expect(me.statusCode).toBe(200);
    expect(me.data.username).toBe("ada_l");
  });

  it("rejects duplicate emails and usernames case-insensitively", async () => {
    await register(h, "taken");
    const sameName = await call(h, "POST", "/auth/register", { body: { email: "other@example.test", username: "TAKEN", password: TEST_PASSWORD } });
    expect(sameName.statusCode).toBe(409);
    expect(sameName.data.error.code).toBe("username_taken");
    const sameEmail = await call(h, "POST", "/auth/register", { body: { email: "TAKEN@example.test", username: "fresh", password: TEST_PASSWORD } });
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.data.error.code).toBe("email_taken");
  });

  it("validates input with field-level messages", async () => {
    const res = await call(h, "POST", "/auth/register", { body: { email: "nope", username: "1abc", password: "short" } });
    expect(res.statusCode).toBe(400);
    expect(res.data.error.code).toBe("validation_error");
    expect(Object.keys(res.data.error.details.fields).sort()).toEqual(["email", "password", "username"]);
    const reserved = await call(h, "POST", "/auth/register", { body: { email: "a@example.test", username: "admin", password: TEST_PASSWORD } });
    expect(reserved.data.error.details.fields.username).toMatch(/reserved/);
    const extra = await call(h, "POST", "/auth/register", { body: { email: "a@example.test", username: "abcd", password: TEST_PASSWORD, role: "admin" } });
    expect(extra.statusCode).toBe(400);
  });

  it("holds the session until the email is verified when verification is required", async () => {
    const strict = await createHarness({ REQUIRE_EMAIL_VERIFICATION: "true" });
    try {
      const res = await call(strict, "POST", "/auth/register", { body: { email: "v@example.test", username: "verifyme", password: TEST_PASSWORD } });
      expect(res.statusCode).toBe(201);
      expect(res.data).toEqual({ session: null, verificationRequired: true });
      const early = await call(strict, "POST", "/auth/login", { body: { login: "verifyme", password: TEST_PASSWORD } });
      expect(early.data.error.code).toBe("email_not_verified");

      const token = new URL(/http\S+/.exec(strict.mail.outbox[0]!.text)![0]).searchParams.get("token")!;
      expect((await call(strict, "POST", "/auth/verify-email", { body: { token } })).statusCode).toBe(204);
      expect((await call(strict, "POST", "/auth/verify-email", { body: { token } })).statusCode).toBe(400); // single use
      const login = await call(strict, "POST", "/auth/login", { body: { login: "verifyme", password: TEST_PASSWORD } });
      expect(login.statusCode).toBe(200);
      expect(login.data.user.emailVerified).toBe(true);
    } finally {
      await strict.close();
    }
  });
});

describe("login", () => {
  it("accepts email or username, case-insensitively", async () => {
    await register(h, "loginuser");
    for (const login of ["loginuser", "LoginUser", "LOGINUSER@example.test"]) {
      const res = await call(h, "POST", "/auth/login", { body: { login, password: TEST_PASSWORD } });
      expect(res.statusCode, login).toBe(200);
      expect(res.data.accessToken).toBeTypeOf("string");
    }
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    await register(h, "someone");
    const wrong = await call(h, "POST", "/auth/login", { body: { login: "someone", password: "not the password" } });
    const unknown = await call(h, "POST", "/auth/login", { body: { login: "nobody", password: "not the password" } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.data).toEqual(unknown.data);
  });

  it("locks an account name out after repeated failures", async () => {
    await register(h, "bruteme");
    for (let i = 0; i < 10; i++) await call(h, "POST", "/auth/login", { body: { login: "bruteme", password: "wrong password!" } });
    const res = await call(h, "POST", "/auth/login", { body: { login: "bruteme", password: TEST_PASSWORD } });
    expect(res.statusCode).toBe(429);
  });

  it("refuses suspended accounts", async () => {
    const u = await register(h, "suspended");
    await h.db.execute(`update users set status = 'suspended' where id = '${u.user.id}'`);
    const res = await call(h, "POST", "/auth/login", { body: { login: "suspended", password: TEST_PASSWORD } });
    expect(res.statusCode).toBe(403);
    const refresh = await call(h, "POST", "/auth/refresh", { cookie: u.cookie });
    expect(refresh.data.error.code).toBe("account_suspended");
  });
});

describe("sessions", () => {
  it("rotates the refresh token on every refresh", async () => {
    const u = await register(h);
    const first = await call(h, "POST", "/auth/refresh", { cookie: u.cookie });
    expect(first.statusCode).toBe(200);
    const nextCookie = refreshCookie(first);
    expect(nextCookie).not.toBe(u.cookie);
    expect((await call(h, "GET", "/auth/me", { as: first.data })).statusCode).toBe(200);
    const second = await call(h, "POST", "/auth/refresh", { cookie: nextCookie });
    expect(second.statusCode).toBe(200);
  });

  it("treats a quickly repeated old token as a concurrent refresh, not theft", async () => {
    const u = await register(h);
    const first = await call(h, "POST", "/auth/refresh", { cookie: u.cookie });
    const again = await call(h, "POST", "/auth/refresh", { cookie: u.cookie });
    expect(again.statusCode).toBe(409);
    expect(again.data.error.code).toBe("refresh_in_progress");
    expect((await call(h, "POST", "/auth/refresh", { cookie: refreshCookie(first) })).statusCode).toBe(200);
  });

  it("revokes the whole session when a rotated-out token is reused later", async () => {
    const u = await register(h);
    const first = await call(h, "POST", "/auth/refresh", { cookie: u.cookie });
    // Pretend the rotation happened long ago, outside the grace window.
    await h.db.update(sessions).set({ revokedAt: new Date(Date.now() - 60_000) });
    const reuse = await call(h, "POST", "/auth/refresh", { cookie: u.cookie });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.data.error.code).toBe("session_revoked");
    // The legitimate holder of the newer token is signed out too, and so is its access token.
    expect((await call(h, "POST", "/auth/refresh", { cookie: refreshCookie(first) })).statusCode).toBe(401);
    const me = await call(h, "GET", "/auth/me", { as: first.data });
    expect(me.data.error.code).toBe("session_revoked");
  });

  it("logout ends the session immediately, including its access token", async () => {
    const u = await register(h);
    const out = await call(h, "POST", "/auth/logout", { as: u, cookie: u.cookie });
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((c) => c.name === "ew_refresh")?.value).toBe("");
    expect((await call(h, "GET", "/auth/me", { as: u })).statusCode).toBe(401);
    expect((await call(h, "POST", "/auth/refresh", { cookie: u.cookie })).statusCode).toBe(401);
  });

  it("lists devices and signs one out remotely", async () => {
    const u = await register(h, "multidevice");
    const other = await call(h, "POST", "/auth/login", { body: { login: "multidevice", password: TEST_PASSWORD }, headers: { "user-agent": "Phone" } });
    const list = await call(h, "GET", "/auth/sessions", { as: u });
    expect(list.data).toHaveLength(2);
    const phone = list.data.find((s: { current: boolean }) => !s.current);
    expect(phone.userAgent).toBe("Phone");
    expect((await call(h, "DELETE", `/auth/sessions/${phone.id}`, { as: u })).statusCode).toBe(204);
    expect((await call(h, "GET", "/auth/me", { as: other.data })).statusCode).toBe(401);
    expect((await call(h, "GET", "/auth/me", { as: u })).statusCode).toBe(200);
  });

  it("rejects tampered, expired and missing access tokens with distinct codes", async () => {
    const u = await register(h);
    const tampered = u.accessToken.slice(0, -4) + (u.accessToken.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect((await call(h, "GET", "/auth/me", { as: { accessToken: tampered } })).data.error.code).toBe("invalid_token");
    expect((await call(h, "GET", "/auth/me")).data.error.code).toBe("unauthorized");
    const shortLived = await createHarness({ ACCESS_TOKEN_TTL_SECONDS: "1" });
    try {
      const v = await register(shortLived);
      await new Promise((r) => setTimeout(r, 2100));
      expect((await call(shortLived, "GET", "/auth/me", { as: v })).data.error.code).toBe("token_expired");
    } finally {
      await shortLived.close();
    }
  });

  it("refuses cookie endpoints from foreign origins", async () => {
    const u = await register(h);
    const res = await call(h, "POST", "/auth/refresh", { cookie: u.cookie, headers: { origin: "https://evil.example" } });
    expect(res.statusCode).toBe(403);
    expect(res.data.error.code).toBe("bad_origin");
  });
});

describe("rate limiting", () => {
  it("limits registrations per address", async () => {
    const limited = await createHarness({}, { rateLimit: true });
    try {
      await limited.reset();
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await call(limited, "POST", "/auth/register", { body: { email: `rl${i}@example.test`, username: `ratelimit${i}`, password: TEST_PASSWORD } });
        codes.push(res.statusCode);
      }
      expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
      expect(codes[10]).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
