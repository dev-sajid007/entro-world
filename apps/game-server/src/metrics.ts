/** Process-wide counters for /health and Prometheus /metrics. */
export class GameMetrics {
  readonly startedAt = Date.now();
  private readonly rooms = new Map<string, { zoneId: string; clients: () => number }>();
  private tickSamples: number[] = [];
  private tickMax = 0;
  ticks = 0;
  slowTicks = 0;
  joins = 0;
  leaves = 0;
  rejectedJoins = 0;
  rejectedInputs = 0;
  rejectedSteps = 0;
  kicks = 0;
  chatMessages = 0;
  transfers = 0;

  registerRoom(roomId: string, zoneId: string, clients: () => number): void {
    this.rooms.set(roomId, { zoneId, clients });
  }

  unregisterRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  recordTick(ms: number, budgetMs: number): void {
    this.ticks++;
    if (ms > budgetMs * 0.5) this.slowTicks++;
    this.tickSamples.push(ms);
    if (this.tickSamples.length > 600) this.tickSamples.shift();
    if (ms > this.tickMax) this.tickMax = ms;
  }

  snapshot() {
    const samples = [...this.tickSamples].sort((a, b) => a - b);
    const pct = (p: number) => (samples.length ? samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]! : 0);
    const byZone: Record<string, { rooms: number; clients: number }> = {};
    let clients = 0;
    for (const r of this.rooms.values()) {
      const n = r.clients();
      clients += n;
      const z = (byZone[r.zoneId] ??= { rooms: 0, clients: 0 });
      z.rooms++;
      z.clients += n;
    }
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      rooms: this.rooms.size,
      clients,
      zones: byZone,
      tick: {
        count: this.ticks,
        slow: this.slowTicks,
        p50Ms: round(pct(0.5)),
        p95Ms: round(pct(0.95)),
        maxMs: round(this.tickMax),
      },
      counters: {
        joins: this.joins,
        leaves: this.leaves,
        rejectedJoins: this.rejectedJoins,
        rejectedInputs: this.rejectedInputs,
        rejectedSteps: this.rejectedSteps,
        kicks: this.kicks,
        chatMessages: this.chatMessages,
        transfers: this.transfers,
      },
      memory: process.memoryUsage(),
    };
  }

  /** Prometheus text exposition format. */
  prometheus(serverId: string): string {
    const s = this.snapshot();
    const label = `server="${escapeLabel(serverId)}"`;
    const lines: string[] = [];
    const metric = (name: string, type: "gauge" | "counter", help: string, values: [string, number][]) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      for (const [labels, v] of values) lines.push(`${name}{${labels}} ${v}`);
    };
    metric("entroworld_game_rooms", "gauge", "Active zone rooms.", [[label, s.rooms]]);
    metric("entroworld_game_clients", "gauge", "Connected clients.", [[label, s.clients]]);
    metric(
      "entroworld_game_zone_clients",
      "gauge",
      "Connected clients per zone.",
      Object.entries(s.zones).map(([zone, z]) => [`${label},zone="${escapeLabel(zone)}"`, z.clients]),
    );
    metric("entroworld_game_tick_duration_ms", "gauge", "Server tick duration percentiles over the last 600 ticks.", [
      [`${label},quantile="0.5"`, s.tick.p50Ms],
      [`${label},quantile="0.95"`, s.tick.p95Ms],
      [`${label},quantile="1"`, s.tick.maxMs],
    ]);
    metric("entroworld_game_ticks_total", "counter", "Simulation ticks run.", [[label, s.tick.count]]);
    metric("entroworld_game_slow_ticks_total", "counter", "Ticks that used more than half of the tick budget.", [[label, s.tick.slow]]);
    for (const [k, v] of Object.entries(s.counters)) {
      metric(`entroworld_game_${snake(k)}_total`, "counter", `Total ${snake(k).replace(/_/g, " ")}.`, [[label, v]]);
    }
    metric("entroworld_game_heap_used_bytes", "gauge", "V8 heap used.", [[label, s.memory.heapUsed]]);
    metric("entroworld_game_rss_bytes", "gauge", "Resident set size.", [[label, s.memory.rss]]);
    return lines.join("\n") + "\n";
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const escapeLabel = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
