import { Client, type Room } from "@colyseus/sdk";
import {
  ACADEMY_ROOM,
  SessionClientMessage,
  SessionServerMessage,
  type BattleVerdictPayload,
  type RobotAction,
  type SessionProgramPayload,
  type SessionRunPayload,
  type SessionStateView,
} from "@entroworld/robot-api";
import { Emitter } from "../../../game/core/Emitter";

export interface SessionEvents extends Record<string, unknown> {
  state: SessionStateView;
  program: SessionProgramPayload;
  run: SessionRunPayload;
  verdict: BattleVerdictPayload;
  error: { code: string; message: string };
  /** The connection is gone for good (left, kicked, or reconnection failed). */
  closed: { code: number };
  reconnecting: boolean;
}

function resolveEndpoint(url: string): string {
  if (/^wss?:|^https?:/.test(url)) return url;
  return new URL(url, window.location.href).toString().replace(/\/$/, "");
}

/** One member's connection to a pair-programming or battle room on the game server. */
export class SessionConnection extends Emitter<SessionEvents> {
  private leaving = false;

  private constructor(private readonly room: Room) {
    super();
  }

  static async connect(gameServerUrl: string, sessionId: string, ticket: string): Promise<SessionConnection> {
    const room = await new Client(resolveEndpoint(gameServerUrl)).joinOrCreate(ACADEMY_ROOM, { sessionId, ticket });
    const connection = new SessionConnection(room);
    connection.bind();
    return connection;
  }

  private bind(): void {
    const room = this.room;
    room.reconnection.maxRetries = 6;
    room.onMessage(SessionServerMessage.State, (m: SessionStateView) => this.emit("state", m));
    room.onMessage(SessionServerMessage.Program, (m: SessionProgramPayload) => this.emit("program", m));
    room.onMessage(SessionServerMessage.Run, (m: SessionRunPayload) => this.emit("run", m));
    room.onMessage(SessionServerMessage.Verdict, (m: BattleVerdictPayload) => this.emit("verdict", m));
    room.onMessage(SessionServerMessage.Error, (m: { code: string; message: string }) => this.emit("error", m));
    room.onDrop(() => this.emit("reconnecting", true));
    room.onReconnect(() => {
      this.emit("reconnecting", false);
      this.send(SessionClientMessage.Sync, {});
    });
    room.onLeave((code: number) => {
      if (!this.leaving) this.emit("closed", { code });
    });
    // Handlers are attached: ask for the current state (messages sent while joining may be missed).
    this.send(SessionClientMessage.Sync, {});
  }

  private send(type: string, payload: unknown): void {
    try {
      this.room.send(type, payload);
    } catch {
      // Not connected right now; the next state sync tells the UI what happened.
    }
  }

  edit(program: string): void {
    this.send(SessionClientMessage.Edit, { program });
  }

  swap(): void {
    this.send(SessionClientMessage.Swap, {});
  }

  run(actions: RobotAction[]): void {
    this.send(SessionClientMessage.Run, { actions });
  }

  ready(): void {
    this.send(SessionClientMessage.Ready, {});
  }

  submit(actions: RobotAction[]): void {
    this.send(SessionClientMessage.Submit, { actions });
  }

  rematch(): void {
    this.send(SessionClientMessage.Rematch, {});
  }

  async leave(): Promise<void> {
    this.leaving = true;
    this.clear();
    await this.room.leave().catch(() => undefined);
  }
}
