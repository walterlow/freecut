/**
 * Scope local server: WebRTC connection management.
 * Unlike Daydream Cloud (WHIP/WHEP), Scope uses direct WebRTC offer/answer.
 *
 * Flow:
 *   1. Create RTCPeerConnection with ICE servers
 *   2. Add webcam MediaStream tracks
 *   3. Create data channel for parameter updates
 *   4. POST SDP offer to /api/v1/webrtc/offer
 *   5. Set remote SDP answer
 *   6. Receive AI-processed video on incoming track
 */

import { getScopeBaseUrl } from './scope-health';
import { getScopeIceServers } from './scope-pipeline';

export interface ScopeSessionData {
  sessionId: string;
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  remoteStream: MediaStream;
}

export interface ScopeInitialParameters {
  prompts?: Array<{ text: string; weight: number }>;
  denoising_step_list?: number[];
  manage_cache?: boolean;
  [key: string]: unknown;
}

/**
 * Establish a WebRTC session with the local Scope server.
 * Returns the peer connection, data channel, and remote stream for AI video output.
 */
export async function connectToScope(
  localStream: MediaStream,
  initialParameters: ScopeInitialParameters = {},
  onRemoteTrack?: (stream: MediaStream) => void,
  onDataMessage?: (data: unknown) => void,
  onDisconnect?: (reason: string) => void,
): Promise<ScopeSessionData> {
  const iceServers = await getScopeIceServers();

  const pc = new RTCPeerConnection({
    iceServers: iceServers.length > 0 ? iceServers : undefined,
  });

  const remoteStream = new MediaStream();

  // Add local webcam tracks (video + audio)
  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  // Listen for AI video output on incoming tracks
  pc.ontrack = (event) => {
    const tracks = event.streams[0]?.getTracks() ?? [event.track];
    for (const track of tracks) {
      remoteStream.addTrack(track);
    }
    onRemoteTrack?.(remoteStream);
  };

  // Create data channel for sending parameter updates
  const dataChannel = pc.createDataChannel('parameters', { ordered: true });

  dataChannel.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data as string) as unknown;
      onDataMessage?.(parsed);

      // Handle stream_stopped events
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'type' in parsed &&
        (parsed as Record<string, unknown>).type === 'stream_stopped'
      ) {
        const reason =
          typeof (parsed as Record<string, unknown>).error === 'string'
            ? ((parsed as Record<string, unknown>).error as string)
            : 'Stream stopped';
        onDisconnect?.(reason);
      }
    } catch {
      // Non-JSON messages are ignored
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      onDisconnect?.(pc.connectionState);
    }
  };

  // Create and send SDP offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering to complete (or timeout after 5s)
  await waitForIceGathering(pc, 5000);

  const finalOffer = pc.localDescription;
  if (!finalOffer) throw new Error('Failed to create local SDP offer');

  const baseUrl = getScopeBaseUrl();
  const response = await fetch(`${baseUrl}/api/v1/webrtc/offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sdp: finalOffer.sdp,
      type: finalOffer.type,
      initialParameters,
    }),
  });

  if (!response.ok) {
    pc.close();
    const text = await response.text();
    let message = `Scope WebRTC offer failed (${response.status})`;
    try {
      const json = JSON.parse(text) as { message?: string; error?: string };
      message = json.message ?? json.error ?? message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  const answer = (await response.json()) as { sdp: string; type: string; session_id: string };

  await pc.setRemoteDescription(
    new RTCSessionDescription({ sdp: answer.sdp, type: answer.type as RTCSdpType }),
  );

  return {
    sessionId: answer.session_id,
    peerConnection: pc,
    dataChannel,
    remoteStream,
  };
}

/**
 * Send trickle ICE candidate to Scope server.
 */
export async function sendIceCandidate(
  sessionId: string,
  candidate: RTCIceCandidate,
): Promise<void> {
  const baseUrl = getScopeBaseUrl();
  await fetch(`${baseUrl}/api/v1/webrtc/offer/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
    }),
  });
}

/**
 * Disconnect from Scope and clean up WebRTC resources.
 */
export function disconnectFromScope(session: ScopeSessionData): void {
  try {
    session.dataChannel.close();
  } catch {
    // ignore
  }
  try {
    session.peerConnection.close();
  } catch {
    // ignore
  }
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', handleStateChange);
      resolve();
    }, timeoutMs);

    function handleStateChange() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', handleStateChange);
        resolve();
      }
    }

    pc.addEventListener('icegatheringstatechange', handleStateChange);
  });
}
