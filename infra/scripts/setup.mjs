#!/usr/bin/env node
// Creates a local .env from .env.example, replacing every `__generate__` placeholder with a random
// secret. Never overwrites an existing .env; run with --force to regenerate it.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const examplePath = path.join(root, ".env.example");
const envPath = path.join(root, ".env");
const force = process.argv.includes("--force");

if (existsSync(envPath) && !force) {
  console.log(".env already exists; leaving it unchanged (use --force to regenerate).");
  process.exit(0);
}

let generated = 0;
const content = readFileSync(examplePath, "utf8").replace(/__generate__/g, () => {
  generated++;
  return randomBytes(36).toString("base64url");
});
writeFileSync(envPath, content, { mode: 0o600 });
console.log(`Wrote .env with ${generated} generated secret(s).`);
