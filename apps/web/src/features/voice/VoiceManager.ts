import { CALL_RING_SECONDS, type CallEndReason, type CallEvent, type CallJoinResponse, type CallParty, type CallView } from "@entroworld/game-protocol";
import type { GameEngine } from "../../game/core/GameEngine";
import { Store } from "../../game/core/Store";
import { api, errorMessage } from "../../lib/api";
import { Ringer } from "./ringer";
import { VoiceRoom } from "./VoiceRoom";

export type ProximityStatus = "off" | "connecting" | "on";

export interface CallState {
  id: string;
  /** The other person. */
  peer: CallParty;
  direction: "outgoing" | "incoming";
  phase: "ringing" | "connecting" | "active";
  /** When audio connected (ms since epoch). */
  startedAt: number | null;
}

export interface VoiceState {
  /** The server has voice configured. */
  available: boolean;
  proximity: ProximityStatus;
  muted: boolean;
  /** The browser is blocking audio until the next tap/click. */
  audioBlocked: boolean;
  call: CallState | null;
  /** A short message to show (errors, why a call ended). */
  notice: string | null;
}

const END_NOTICE: Record<CallEndReason, string> = {
  hangup: "Call ended",
  cancelled: "Missed call",
  declined: "Call declined",
  missed: "Missed call",
  busy: "Busy",
  failed: "Call failed",
};
/** What the caller sees when nobody answered. */
const NO_ANSWER = "No answer";

/**
 * Voice for one online game session: proximity voice (everyone nearby, volume by distance) and
 * 1:1 calls with friends. Only one is live at a time: a call pauses proximity voice and it resumes
 * when the call ends. All audio flows through LiveKit; the game server and API only decide who
 * may hear whom.
 */
export class VoiceManager {
  readonly state: Store<VoiceState>;
  private readonly proximity: VoiceRoom;
  private readonly callRoom: VoiceRoom;
  private readonly ringer = new Ringer();
  private wantProximity = false;
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly offs: (() => void)[] = [];
  private lastStatus: string;
  private disposed = false;

  constructor(private readonly engine: GameEngine) {
    this.state = new Store<VoiceState>({
      available: engine.ui.get().voiceAvailable,
      proximity: "off",
      muted: false,
      audioBlocked: false,
      call: null,
      notice: null,
    });
    const onAudioBlocked = (blocked: boolean) => this.state.set({ audioBlocked: blocked });
    this.proximity = new VoiceRoom({
      defaultGain: 0,
      onSpeakingChange: (speaking) => this.engine.setVoiceState(this.state.get().muted, speaking),
      onAudioBlocked,
      onLost: () => {
        if (this.wantProximity && !this.state.get().call) this.rejoinProximity();
      },
    });
    this.callRoom = new VoiceRoom({
      defaultGain: 1,
      onAudioBlocked,
      onLost: () => {
        const call = this.state.get().call;
        if (call) void api.post(`/calls/${call.id}/end`, {}).catch(() => undefined);
        void this.finishCall("Call ended");
      },
    });

    this.lastStatus = engine.ui.get().status;
    this.offs.push(
      engine.ui.subscribe(() => {
        const ui = engine.ui.get();
        this.state.set({ available: ui.voiceAvailable });
        // A new game session (reconnect) needs a fresh voice token.
        if (ui.status === "connected" && this.lastStatus !== "connected" && this.wantProximity && !this.state.get().call) this.rejoinProximity();
        this.lastStatus = ui.status;
      }),
      engine.events.on("zoneChanged", () => {
        if (this.wantProximity && !this.state.get().call) this.rejoinProximity();
      }),
      engine.events.on("toggleVoice", () => void this.toggleProximity()),
      engine.events.on("voiceToken", (t) => {
        if (!this.wantProximity || this.state.get().call) return;
        void this.proximity
          .connect(t.url, t.token, this.state.get().muted)
          .then(() => {
            if (!this.wantProximity || this.state.get().call) return void this.proximity.disconnect();
            this.state.set({ proximity: "on" });
            this.engine.setVoiceState(this.state.get().muted, false);
          })
          .catch((e) => this.proximityFailed(e));
      }),
      engine.events.on("voicePeers", (peers) => this.proximity.setGains(new Map(peers.map((p) => [p.userId, p.gain])))),
      engine.events.on("callEvent", (e) => this.onCallEvent(e)),
    );
    void this.recoverCall();
  }

  // -----------------------------------------------------------------------------------------------
  // Proximity voice
  // -----------------------------------------------------------------------------------------------

  async toggleProximity(): Promise<void> {
    if (this.wantProximity) this.disableProximity();
    else this.enableProximity();
  }

  enableProximity(): void {
    if (!this.state.get().available) {
      this.notify("Voice chat isn't available on this server.");
      return;
    }
    this.wantProximity = true;
    if (this.state.get().call) return; // Joins when the call ends.
    this.state.set({ proximity: "connecting" });
    this.engine.requestVoiceToken();
  }

  disableProximity(): void {
    this.wantProximity = false;
    void this.proximity.disconnect();
    this.state.set({ proximity: "off" });
    this.engine.setVoiceState(true, false);
  }

  private rejoinProximity(): void {
    void this.proximity.disconnect();
    this.state.set({ proximity: "connecting" });
    this.engine.requestVoiceToken();
  }

  private proximityFailed(e: unknown): void {
    this.wantProximity = false;
    this.state.set({ proximity: "off" });
    this.notify(micErrorMessage(e, "Couldn't join voice chat."));
  }

  async setMuted(muted: boolean): Promise<void> {
    this.state.set({ muted });
    await Promise.all([this.proximity.setMuted(muted), this.callRoom.setMuted(muted)]);
    if (this.proximity.connected) this.engine.setVoiceState(muted, false);
  }

  async unlockAudio(): Promise<void> {
    await Promise.all([this.proximity.unlockAudio(), this.callRoom.unlockAudio()]);
  }

  // -----------------------------------------------------------------------------------------------
  // 1:1 calls
  // -----------------------------------------------------------------------------------------------

  async call(peer: CallParty): Promise<void> {
    if (this.state.get().call) return;
    if (!this.state.get().available) {
      this.notify("Voice calls aren't available on this server.");
      return;
    }
    try {
      const { call } = await api.post<{ call: CallView }>("/calls", { calleeId: peer.id });
      this.state.set({ call: { id: call.id, peer: call.callee, direction: "outgoing", phase: "ringing", startedAt: null } });
      this.ringer.start("outgoing");
      this.ringTimer = setTimeout(() => {
        if (this.state.get().call?.phase !== "ringing") return;
        void api.post(`/calls/${call.id}/end`, { reason: "missed" }).catch(() => undefined);
        void this.finishCall(NO_ANSWER);
      }, CALL_RING_SECONDS * 1000);
    } catch (e) {
      this.notify(errorMessage(e));
    }
  }

  async accept(): Promise<void> {
    const call = this.state.get().call;
    if (!call || call.direction !== "incoming" || call.phase !== "ringing") return;
    this.ringer.stop();
    this.state.set({ call: { ...call, phase: "connecting" } });
    try {
      const joined = await api.post<CallJoinResponse>(`/calls/${call.id}/accept`, {});
      await this.connectCall(joined);
    } catch (e) {
      void api.post(`/calls/${call.id}/end`, {}).catch(() => undefined);
      await this.finishCall(micErrorMessage(e, "Couldn't connect the call."));
    }
  }

  /** Declines a ringing call, cancels an outgoing one, or hangs up. */
  async hangUp(): Promise<void> {
    const call = this.state.get().call;
    if (!call) return;
    void api.post(`/calls/${call.id}/end`, {}).catch(() => undefined);
    await this.finishCall(null);
  }

  private onCallEvent(e: CallEvent): void {
    const current = this.state.get().call;
    switch (e.kind) {
      case "incoming":
        if (current) return; // The API already refuses calls to busy users.
        this.state.set({ call: { id: e.call.id, peer: e.call.caller, direction: "incoming", phase: "ringing", startedAt: null } });
        this.ringer.start("incoming");
        this.ringTimer = setTimeout(() => {
          if (this.state.get().call?.id === e.call.id && this.state.get().call?.phase === "ringing") void this.finishCall("Missed call");
        }, (CALL_RING_SECONDS + 5) * 1000);
        break;
      case "accepted":
        if (current?.id !== e.callId || current.direction !== "outgoing") return;
        this.ringer.stop();
        this.state.set({ call: { ...current, phase: "connecting" } });
        void api
          .post<CallJoinResponse>(`/calls/${e.callId}/join`, {})
          .then((joined) => this.connectCall(joined))
          .catch((err) => {
            void api.post(`/calls/${e.callId}/end`, {}).catch(() => undefined);
            void this.finishCall(micErrorMessage(err, "Couldn't connect the call."));
          });
        break;
      case "ended":
        if (current?.id !== e.callId) return;
        void this.finishCall(current.direction === "outgoing" && e.reason === "declined" ? "Call declined" : END_NOTICE[e.reason]);
        break;
    }
  }

  private async connectCall(joined: CallJoinResponse): Promise<void> {
    const call = this.state.get().call;
    if (!call || call.id !== joined.call.id) return;
    this.clearRingTimer();
    // Proximity voice pauses for the call (one microphone, one conversation).
    await this.proximity.disconnect();
    if (this.state.get().proximity !== "off") {
      this.state.set({ proximity: "off" });
      this.engine.setVoiceState(true, false);
    }
    await this.callRoom.connect(joined.voice.url, joined.voice.token, this.state.get().muted);
    if (this.state.get().call?.id !== call.id) return void this.callRoom.disconnect();
    this.state.set({ call: { ...call, phase: "active", startedAt: Date.now() } });
  }

  private async finishCall(notice: string | null): Promise<void> {
    this.clearRingTimer();
    this.ringer.stop();
    if (this.state.get().call?.phase === "active" || this.callRoom.connected) this.ringer.hangupTone();
    await this.callRoom.disconnect();
    this.state.set({ call: null });
    if (notice) this.notify(notice);
    if (this.wantProximity && !this.disposed) this.enableProximity();
  }

  /** After a page reload the API may still have our call; end it so nobody is stuck "busy". */
  private async recoverCall(): Promise<void> {
    try {
      const { call } = await api.get<{ call: CallView | null }>("/calls/current");
      if (call && !this.state.get().call) await api.post(`/calls/${call.id}/end`, {});
    } catch {
      // Not critical.
    }
  }

  private clearRingTimer(): void {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
  }

  private notify(text: string): void {
    this.state.set({ notice: text });
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.state.set({ notice: null }), 4000);
  }

  dispose(): void {
    this.disposed = true;
    const call = this.state.get().call;
    if (call) void api.post(`/calls/${call.id}/end`, {}).catch(() => undefined);
    this.clearRingTimer();
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.ringer.stop();
    for (const off of this.offs) off();
    void this.proximity.disconnect();
    void this.callRoom.disconnect();
  }
}

function micErrorMessage(e: unknown, fallback: string): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "Microphone access was blocked. Allow it in your browser to talk.";
  if (name === "NotFoundError") return "No microphone found.";
  if (e instanceof Error && "code" in e && typeof (e as { code: unknown }).code === "string") return e.message;
  return fallback;
}
