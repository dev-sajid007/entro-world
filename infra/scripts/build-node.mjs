#!/usr/bin/env node
// Bundles a Node service for production: `node ../../infra/scripts/build-node.mjs src/server.ts [more entries]`
// (run from the app directory). Workspace packages (@entroworld/*) ship as TypeScript source, so they
// are bundled. The app's own third-party dependencies stay external (installed next to dist/ in the
// runtime image); dependencies that only workspace packages declare are bundled, because pnpm does
// not link them into the app's node_modules.
import { build } from "esbuild";
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const entries = process.argv.slice(2);
if (entries.length === 0) {
  console.error("usage: build-node.mjs <entry.ts> [entry.ts...]");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
const external = new Set(Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@entroworld/")));
const builtins = new Set(builtinModules);

/** "@scope/name/sub/path" -> "@scope/name", "name/sub" -> "name". */
const packageName = (specifier) => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

const externalizeDependencies = {
  name: "externalize-dependencies",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("node:") || builtins.has(args.path)) return { path: args.path, external: true };
      if (external.has(packageName(args.path))) return { path: args.path, external: true };
      return undefined;
    });
  },
};

const started = Date.now();
await build({
  entryPoints: entries,
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  legalComments: "none",
  logLevel: "warning",
  plugins: [externalizeDependencies],
  // Some dependencies still call require(); give the ESM bundle one.
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
console.log(`built ${pkg.name}: ${entries.join(", ")} -> dist/ in ${Date.now() - started}ms`);
