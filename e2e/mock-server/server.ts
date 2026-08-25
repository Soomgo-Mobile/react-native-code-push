import express from "express";
import { MOCK_DATA_DIR, MOCK_SERVER_PORT } from "../config";
import type { Server } from "http";

let server: Server | null = null;

/** One request the app made to the mock server, in the order it arrived. */
export interface MockServerRequest {
  method: string;
  url: string;
  receivedAt: number;
}

const requestLog: MockServerRequest[] = [];

/**
 * Every request the server has answered since the log was last cleared.
 *
 * The order matters more than the count: an update that is published as both a full and
 * a patch archive installs to the same contents either way, so which archives were asked
 * for, and in which order, is what tells a patch install apart from a fallback to the
 * full archive.
 */
export function getRequestLog(): MockServerRequest[] {
  return [...requestLog];
}

export function clearRequestLog(): void {
  requestLog.length = 0;
}

export function startMockServer(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const app = express();

    app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
      console.log(`[mock-server] ${req.method} ${req.url}`);
      requestLog.push({ method: req.method, url: req.url, receivedAt: Date.now() });
      next();
    });

    // The app reports how a download's update archives went here. The report travels in
    // the query string, so recording the request above is what stores it - this handler
    // only keeps the answer from being a 404.
    app.get("/e2e/update-archive-result", (_req: express.Request, res: express.Response) => {
      res.status(204).end();
    });

    app.use(express.static(MOCK_DATA_DIR));

    app.use((_req: express.Request, res: express.Response) => {
      res.status(404).json({ error: "Not found" });
    });

    const s = app.listen(MOCK_SERVER_PORT, () => {
      console.log(`Mock server started on port ${MOCK_SERVER_PORT}`);
      console.log(`Serving files from: ${MOCK_DATA_DIR}`);
      resolve(s);
    });

    s.on("error", reject);
    server = s;
  });
}

export function stopMockServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        console.log("Mock server stopped");
        server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
