import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { setupSdrRelay } from "../sdrRelay";
import { proxyResultFile } from "../tdoaService";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // WebSocket relay for SDR receivers (bridges ws:// through wss://)
  setupSdrRelay(server);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // TDoA heatmap proxy — serves PNG images from tdoa.kiwisdr.com
  app.get("/api/tdoa/heatmap/:key/:filename", async (req, res) => {
    try {
      const { key, filename } = req.params;
      // Only allow image files for security
      if (!filename.endsWith(".png") && !filename.endsWith(".jpg")) {
        return res.status(400).json({ error: "Only image files allowed" });
      }
      const result = await proxyResultFile(key, filename);
      if (!result) {
        return res.status(404).json({ error: "File not found" });
      }
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Cache-Control", "public, max-age=86400"); // cache 24h
      res.send(result.data);
    } catch {
      res.status(500).json({ error: "Proxy error" });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);

    // Start the conflict zone sweep scheduler after a delay
    // to allow the UCDP cache to populate first
    setTimeout(async () => {
      try {
        const { startConflictSweepScheduler } = await import("../conflictSweepScheduler");
        startConflictSweepScheduler();
      } catch (err) {
        console.warn("[Server] Failed to start conflict sweep scheduler:", err);
      }
    }, 60_000); // Wait 60s for UCDP cache to populate
  });
}

startServer().catch(console.error);
