import express from "express";
import { getMockDataDir, getMockServerPort } from "../config";
import type { Server } from "http";

type Platform = "ios" | "android";

/** One request the app made to the mock server, in the order it arrived. */
export interface MockServerRequest {
  method: string;
  url: string;
  receivedAt: number;
}

interface RunningMockServer {
  server: Server;
  requestLog: MockServerRequest[];
}

/**
 * The server of each platform that is currently running.
 *
 * A run covering both platforms serves two ports out of two data directories, and the
 * assertions over what was downloaded read one platform's requests at a time - so the
 * request log belongs to the server rather than to the module.
 */
const running = new Map<Platform, RunningMockServer>();

function requireRunning(platform: Platform): RunningMockServer {
  const instance = running.get(platform);
  if (!instance) {
    throw new Error(`The ${platform} mock server is not running`);
  }
  return instance;
}

/**
 * Every request the platform's server has answered since its log was last cleared.
 *
 * The order matters more than the count: an update that is published as both a full and
 * a patch archive installs to the same contents either way, so which archives were asked
 * for, and in which order, is what tells a patch install apart from a fallback to the
 * full archive.
 */
export function getRequestLog(platform: Platform): MockServerRequest[] {
  return [...requireRunning(platform).requestLog];
}

export function clearRequestLog(platform: Platform): void {
  requireRunning(platform).requestLog.length = 0;
}

export function startMockServer(platform: Platform): Promise<void> {
  if (running.has(platform)) {
    throw new Error(`The ${platform} mock server is already running`);
  }

  const dataDir = getMockDataDir(platform);
  const port = getMockServerPort(platform);
  const requestLog: MockServerRequest[] = [];

  return new Promise((resolve, reject) => {
    const app = express();

    app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
      console.log(`[mock-server:${platform}] ${req.method} ${req.url}`);
      requestLog.push({ method: req.method, url: req.url, receivedAt: Date.now() });
      next();
    });

    // The app reports how a download's update archives went here. The report travels in
    // the query string, so recording the request above is what stores it - this handler
    // only keeps the answer from being a 404.
    app.get("/e2e/update-archive-result", (_req: express.Request, res: express.Response) => {
      res.status(204).end();
    });

    app.use(express.static(dataDir));

    app.use((_req: express.Request, res: express.Response) => {
      res.status(404).json({ error: "Not found" });
    });

    const server = app.listen(port, () => {
      console.log(`Mock server for ${platform} started on port ${port}`);
      console.log(`Serving files from: ${dataDir}`);
      running.set(platform, { server, requestLog });
      resolve();
    });

    server.on("error", reject);
  });
}

export function stopMockServer(platform: Platform): Promise<void> {
  const instance = running.get(platform);
  if (!instance) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    instance.server.close(() => {
      console.log(`Mock server for ${platform} stopped`);
      running.delete(platform);
      resolve();
    });
  });
}
