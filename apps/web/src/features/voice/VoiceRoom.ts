import { Room, RoomEvent, Track, type Participant, type RemoteParticipant, type RemoteTrack } from "livekit-client";

export interface VoiceRoomOptions {
  /** Volume for participants without an explicit gain (proximity voice: 0 until in range). */
  defaultGain: number;
  onSpeakingChange?: (speaking: boolean) => void;
  /** The browser blocked audio playback until the next user gesture. */
  onAudioBlocked?: (blocked: boolean) => void;
  /** The connection dropped for good (not a user-requested disconnect). */
  onLost?: () => void;
}

/**
 * One LiveKit audio room: publishes the microphone and plays everyone else, each at its own gain.
 * Audio goes through Web Audio (`webAudioMix`) so per-person volume also works on iOS, where media
 * element volume is ignored. Used for both proximity voice and 1:1 calls.
 */
export class VoiceRoom {
  private room: Room | null = null;
  private readonly gains = new Map<string, number>();
  private readonly elements = new Map<string, HTMLMediaElement>();
  private speaking = false;
  private muted = false;
  private closing = false;

  constructor(private readonly options: VoiceRoomOptions) {}

  get connected(): boolean {
    return this.room !== null;
  }

  /** Identities of the other people in the room. */
  get participants(): string[] {
    return this.room ? [...this.room.remoteParticipants.keys()] : [];
  }

  async connect(url: string, token: string, muted = false): Promise<void> {
    await this.disconnect();
    this.closing = false;
    this.muted = muted;
    const room = new Room({
      webAudioMix: true,
      adaptiveStream: false,
      dynacast: false,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.dataset.voiceIdentity = participant.identity;
        this.elements.set(`${participant.identity}:${track.sid}`, el);
        this.applyGain(participant);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
        for (const el of track.detach()) el.remove();
        this.elements.delete(`${participant.identity}:${track.sid}`);
      })
      .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => this.applyGain(p))
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        const speaking = !this.muted && speakers.some((s) => s.identity === room.localParticipant.identity);
        if (speaking === this.speaking) return;
        this.speaking = speaking;
        this.options.onSpeakingChange?.(speaking);
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => this.options.onAudioBlocked?.(!room.canPlaybackAudio))
      .on(RoomEvent.Disconnected, () => {
        if (this.room !== room) return;
        this.cleanup();
        if (!this.closing) this.options.onLost?.();
      });
    this.room = room;
    try {
      await room.connect(url, token, { autoSubscribe: true });
      await room.localParticipant.setMicrophoneEnabled(!muted);
      // Called from a click/tap, so this also unlocks audio playback where browsers require it.
      await room.startAudio().catch(() => undefined);
      this.options.onAudioBlocked?.(!room.canPlaybackAudio);
      for (const p of room.remoteParticipants.values()) this.applyGain(p);
    } catch (e) {
      if (this.room === room) {
        this.closing = true;
        await room.disconnect().catch(() => undefined);
        this.cleanup();
      }
      throw e;
    }
  }

  async setMuted(muted: boolean): Promise<void> {
    this.muted = muted;
    await this.room?.localParticipant.setMicrophoneEnabled(!muted);
    if (muted && this.speaking) {
      this.speaking = false;
      this.options.onSpeakingChange?.(false);
    }
  }

  /** Sets everyone's gain at once; people not listed fall back to the default gain. */
  setGains(gains: ReadonlyMap<string, number>): void {
    this.gains.clear();
    for (const [id, g] of gains) this.gains.set(id, g);
    if (!this.room) return;
    for (const p of this.room.remoteParticipants.values()) this.applyGain(p);
  }

  async unlockAudio(): Promise<void> {
    await this.room?.startAudio();
    if (this.room) this.options.onAudioBlocked?.(!this.room.canPlaybackAudio);
  }

  private applyGain(p: RemoteParticipant): void {
    const gain = Math.max(0, Math.min(1, this.gains.get(p.identity) ?? this.options.defaultGain));
    p.setVolume(gain);
  }

  async disconnect(): Promise<void> {
    const room = this.room;
    if (!room) return;
    this.closing = true;
    this.cleanup();
    await room.disconnect().catch(() => undefined);
  }

  private cleanup(): void {
    for (const el of this.elements.values()) el.remove();
    this.elements.clear();
    this.room = null;
    if (this.speaking) {
      this.speaking = false;
      this.options.onSpeakingChange?.(false);
    }
  }
}
