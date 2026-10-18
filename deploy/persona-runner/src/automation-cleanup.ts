/** Strip common CDP/automation artifacts before any page script runs. */
export const AUTOMATION_CLEANUP_SOURCE = String.raw`
(() => {
  try {
    if (navigator.webdriver) {
      Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", {
        get: () => false,
        configurable: true,
      });
    }
  } catch (e) {}
  try {
    const re = /^(cdc_|\\$cdc_|__webdriver|__driver|__selenium|callPhantom|_phantom|webdriver)/i;
    for (const key of Object.keys(window)) {
      if (re.test(key)) {
        try {
          delete window[key];
        } catch (e) {}
      }
    }
  } catch (e) {}
  try {
    const isLocalHost = (url) => {
      const s = String(url);
      if (/^(ws|wss|http|https):\\/\\/(127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0|\\[::1\\])(:\\d+)?/i.test(s)) {
        return true;
      }
      if (/^(ws|wss|http|https):\\/\\/(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/i.test(s)) {
        return true;
      }
      return false;
    };
    const delayReject = () =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new TypeError("Failed to fetch")), 1200 + Math.random() * 600),
      );
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : input?.url;
        if (url && isLocalHost(url)) return delayReject();
        return origFetch.call(this, input, init);
      };
    }
    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR) {
      const origOpen = OrigXHR.prototype.open;
      const origSend = OrigXHR.prototype.send;
      OrigXHR.prototype.open = function (method, url, ...rest) {
        this.__blockLocal = isLocalHost(url);
        return origOpen.call(this, method, url, ...rest);
      };
      OrigXHR.prototype.send = function (body) {
        if (this.__blockLocal) {
          setTimeout(() => {
            try {
              this.dispatchEvent(new Event("error"));
            } catch (e) {}
          }, 1200);
          return;
        }
        return origSend.call(this, body);
      };
    }
    const OrigWS = window.WebSocket;
    if (OrigWS) {
      function PatchedWS(url, protocols) {
        if (isLocalHost(url)) {
          const ws = new OrigWS("ws://127.0.0.1:59999");
          return ws;
        }
        return protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
      }
      PatchedWS.prototype = OrigWS.prototype;
      PatchedWS.CONNECTING = OrigWS.CONNECTING;
      PatchedWS.OPEN = OrigWS.OPEN;
      PatchedWS.CLOSING = OrigWS.CLOSING;
      PatchedWS.CLOSED = OrigWS.CLOSED;
      window.WebSocket = PatchedWS;
    }
  } catch (e) {}
})();
`;
