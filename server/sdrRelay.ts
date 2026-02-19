/**
 * sdrRelay.ts — WebSocket relay for SDR receivers
 *
 * Bridges browser (wss://) ↔ SDR receiver (ws://) to bypass mixed content blocking.
 * The server doesn't parse the SDR protocol — it just pipes bytes bidirectionally.
 * The client-side KiwiSDR/OpenWebRX protocol handler does the actual work.
 *
 * Usage: browser connects to wss://ourserver/api/sdr-relay?target=ws://receiver:8073/kiwi/123/W%2FF
 */

import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";

const MAX_CONCURRENT_RELAYS = 20;
const RELAY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max per session

let activeRelays = 0;

export function setupSdrRelay(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    if (url.pathname !== "/api/sdr-relay") {
      // Not ours — let other upgrade handlers (if any) deal with it,
      // or just ignore (don't destroy — Vite HMR uses WebSockets too)
      return;
    }

    const target = url.searchParams.get("target");
    if (!target) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    // Validate: only allow ws:// targets (the whole point is to relay HTTP receivers)
    try {
      const targetUrl = new URL(target);
      if (targetUrl.protocol !== "ws:" && targetUrl.protocol !== "http:") {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
    } catch {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    if (activeRelays >= MAX_CONCURRENT_RELAYS) {
      socket.write("HTTP/1.1 503 Too Many Relay Connections\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleRelay(ws, target);
    });
  });
}

function handleRelay(clientWs: WebSocket, target: string) {
  activeRelays++;

  // Normalize: if target is http://, convert to ws:// for WebSocket connection
  const wsTarget = target.replace(/^http:\/\//i, "ws://");

  const remoteWs = new WebSocket(wsTarget, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    handshakeTimeout: 10000,
  });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    activeRelays--;
    try { clientWs.close(); } catch {}
    try { remoteWs.close(); } catch {}
  };

  // Auto-close after timeout
  const timer = setTimeout(cleanup, RELAY_TIMEOUT_MS);

  remoteWs.on("open", () => {
    // Relay: remote → client (SDR receiver sends binary waterfall/audio data)
    remoteWs.on("message", (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    });

    // Relay: client → remote (browser sends text commands like SET freq=...)
    clientWs.on("message", (data, isBinary) => {
      if (remoteWs.readyState === WebSocket.OPEN) {
        remoteWs.send(data, { binary: isBinary });
      }
    });
  });

  remoteWs.on("error", () => cleanup());
  remoteWs.on("close", () => cleanup());
  clientWs.on("error", () => cleanup());
  clientWs.on("close", () => {
    clearTimeout(timer);
    cleanup();
  });
}
