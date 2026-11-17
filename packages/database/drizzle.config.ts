import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://entroworld:entroworld@127.0.0.1:5432/entroworld" },
  strict: true,
  verbose: true,
});
