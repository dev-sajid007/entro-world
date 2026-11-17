import { AccessToken } from "livekit-server-sdk";
import type { VoicePeer, VoiceTokenPayload } from "@entroworld/game-protocol";
import { NETWORK } from "@entroworld/shared";

export interface VoiceConfig {
  url: string;
  publicUrl: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Issues LiveKit tokens for proximity voice. Audio never flows through the game server; the
 * server only decides who may hear whom (see `computeVoicePeers`) from authoritative positions.
 */
export class VoiceService {
  constructor(private readonly config: VoiceConfig) {}

  static roomName(gameRoomId: string): string {
    return `ew-voice-${gameRoomId}`;
  }

  async token(gameRoomId: string, identity: string, name: string): Promise<VoiceTokenPayload> {
    const room = VoiceService.roomName(gameRoomId);
    const at = new AccessToken(this.config.apiKey, this.config.apiSecret, { identity, name, ttl: "2h" });
    // Clients may publish their microphone and subscribe; per-peer volume is driven by the
    // VoicePeers list the game server sends, so players outside the radius are muted.
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: false });
    return { url: this.config.publicUrl, token: await at.toJwt(), room, identity };
  }
}

interface VoiceParticipant {
  userId: string;
  x: number;
  z: number;
}

/** Full volume within this distance; fades linearly to zero at the voice radius. */
const FULL_VOLUME_DISTANCE = 3;

/** Peers audible to `self`, with a 0..1 gain from authoritative distance. */
export function computeVoicePeers(self: VoiceParticipant, others: Iterable<VoiceParticipant>, radius: number = NETWORK.voiceRadius): VoicePeer[] {
  const peers: VoicePeer[] = [];
  for (const o of others) {
    if (o.userId === self.userId) continue;
    const d = Math.hypot(o.x - self.x, o.z - self.z);
    if (d >= radius) continue;
    const gain = d <= FULL_VOLUME_DISTANCE ? 1 : 1 - (d - FULL_VOLUME_DISTANCE) / (radius - FULL_VOLUME_DISTANCE);
    peers.push({ userId: o.userId, gain: Math.round(gain * 100) / 100 });
  }
  return peers.sort((a, b) => b.gain - a.gain);
}
