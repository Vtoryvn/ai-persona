/**
 * Native engine mode: WebRTC UDP blocking and loopback port-scan isolation
 * are enforced at the OS / libc / Chrome Enterprise Policy layer
 * (libpersona_engine.so + persona_policy.json + --webrtc-ip-handling-policy),
 * so no JS prototype overrides are injected onto window.RTCPeerConnection or window.fetch.
 */
export async function injectWebRtcMitigation(): Promise<void> {
  // Handled natively at the C / policy layer.
}
