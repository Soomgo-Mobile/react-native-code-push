import express from "express";
import { MOCK_DATA_DIR, MOCK_SERVER_PORT } from "../config";
import type { Server } from "http";

let server: Server | null = null;

export function startMockServer(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const app = express();

    app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
      console.log(`[mock-server] ${req.method} ${req.url}`);
      next();
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