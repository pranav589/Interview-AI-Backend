import { env } from "./config/env";
import { connectToDB } from "./config/db";
import http from "node:http";
import app from "./app";
import { WebSocketServer } from "ws";
import { setupWebSocket } from "./lib/socket";
import { setupGraph } from "./utils/graph";
import { createModuleLogger } from "./lib/logger";
import mongoose from "mongoose";

const logger = createModuleLogger("server");

let server: http.Server;
let wss: WebSocketServer;

async function startServer() {
  const client = await connectToDB();
  await setupGraph(client as any);

  server = http.createServer(app);
  wss = new WebSocketServer({ server });

  setupWebSocket(wss);

  const port = env.PORT;
  server.listen(port, () => {
    logger.info(`Server is running on ${port}`);
  });
}

async function handleShutdown(signal: string) {
  logger.info(`Shutdown signal received: ${signal}`);

  const timeout = setTimeout(() => {
    logger.warn("Shutdown timed out, forcing exit");
    process.exit(1);
  }, 10000);

  try {
    // 1. Stop accepting new HTTP connections
    if (server) {
      server.close();
    }

    // 2. Close all WebSocket connections with code 1001
    if (wss) {
      wss.clients.forEach((client) => {
        client.close(1001, "Server shutting down");
      });
      wss.close();
    }

    // 3. Disconnect from MongoDB
    await mongoose.disconnect();

    logger.info("Server shut down gracefully");
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Error during graceful shutdown");
    process.exit(1);
  }
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

startServer().catch((err) => {
  logger.error({ err }, "Error while starting server");
  process.exit(1);
});
