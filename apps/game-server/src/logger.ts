/** Minimal structured JSON logger (one line per record on stdout/stderr). */
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

const ORDER: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: 100 };

export interface Logger {
  error(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function serializeError(e: unknown): unknown {
  return e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e;
}

export function createLogger(level: LogLevel = "info", bindings: Record<string, unknown> = {}): Logger {
  const threshold = ORDER[level];
  const write = (lvl: Exclude<LogLevel, "silent">, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < threshold) return;
    const record: Record<string, unknown> = { level: lvl, time: new Date().toISOString(), ...bindings, msg };
    if (fields) for (const [k, v] of Object.entries(fields)) record[k] = k === "err" ? serializeError(v) : v;
    const line = JSON.stringify(record);
    if (ORDER[lvl] >= ORDER.warn) process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  };
  return {
    error: (m, f) => write("error", m, f),
    warn: (m, f) => write("warn", m, f),
    info: (m, f) => write("info", m, f),
    debug: (m, f) => write("debug", m, f),
    child: (b) => createLogger(level, { ...bindings, ...b }),
  };
}
