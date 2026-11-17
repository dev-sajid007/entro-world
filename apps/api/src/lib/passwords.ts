import { hash, verify } from "@node-rs/argon2";

// Argon2id (the library default) with OWASP-recommended parameters: 19 MiB memory, 2 passes.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

/** Hash of a random password, verified against when the account doesn't exist (equalizes timing). */
let dummyHash: Promise<string> | null = null;

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (passwordHash === null) {
    dummyHash ??= hashPassword(`no-such-user-${Math.random()}`);
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
