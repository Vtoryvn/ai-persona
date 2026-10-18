/**
 * Page script registered before any navigation. Reduces WebRTC local/srflx leaks
 * when HTTP proxy is used (UDP STUN bypasses --proxy-server).
 */
export const WEBRTC_MITIGATION_SOURCE = String.raw`
(() => {
  try {
    const Native = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!Native) return;

    const stripLeakySdpLines = (sdp) => {
      if (!sdp || typeof sdp !== "string") return sdp;
      return sdp
        .split("\n")
        .filter((line) => {
          const l = line.toLowerCase();
          if (l.includes(" typ host ") || l.includes(" typ srflx ")) return false;
          if (l.startsWith("c=in ip4 ") && !l.includes("0.0.0.0")) return false;
          return true;
        })
        .join("\n");
    };

    const wrap = (pc) => {
      const origSetLocal = pc.setLocalDescription.bind(pc);
      pc.setLocalDescription = async function (desc) {
        if (desc && typeof desc === "object" && desc.sdp) {
          const copy = { type: desc.type, sdp: stripLeakySdpLines(desc.sdp) };
          return origSetLocal(copy);
        }
        return origSetLocal(desc);
      };
      pc.addEventListener(
        "icecandidate",
        (ev) => {
          const c = ev.candidate && ev.candidate.candidate;
          if (c && (/\styp host\s/.test(c) || /\styp srflx\s/.test(c))) {
            ev.stopImmediatePropagation();
          }
        },
        true,
      );
    };

    function Patched(...args) {
      const pc = new Native(...args);
      wrap(pc);
      return pc;
    }
    Patched.prototype = Native.prototype;
    Object.defineProperty(window, "RTCPeerConnection", {
      value: Patched,
      configurable: true,
      writable: true,
    });
    if ("webkitRTCPeerConnection" in window) {
      Object.defineProperty(window, "webkitRTCPeerConnection", {
        value: Patched,
        configurable: true,
        writable: true,
      });
    }
  } catch (e) {}
})();
`;
