import { Response } from "express";
import { createModuleLogger } from "./logger";

const logger = createModuleLogger("sse");

class SSEManager {
  // Map of userId -> Set of active Response objects
  private connections = new Map<string, Set<Response>>();
  private heartbeatIntervals = new Map<Response, NodeJS.Timeout>();

  /**
   * Registers a new SSE connection for a user.
   */
  register(userId: string, res: Response) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }

    const userStreams = this.connections.get(userId)!;
    userStreams.add(res);

    logger.info({ userId, activeStreams: userStreams.size }, "SSE connection registered");

    // Start a heartbeat interval for this specific response to keep the connection alive
    const intervalId = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": keepalive\n\n");
      }
    }, 30000); // 30 seconds heartbeat

    this.heartbeatIntervals.set(res, intervalId);

    // Handle connection closure
    res.on("close", () => {
      this.unregister(userId, res);
    });

    res.on("finish", () => {
      this.unregister(userId, res);
    });
  }

  /**
   * Unregisters an SSE connection when closed.
   */
  private unregister(userId: string, res: Response) {
    const userStreams = this.connections.get(userId);
    if (userStreams) {
      userStreams.delete(res);
      if (userStreams.size === 0) {
        this.connections.delete(userId);
      }
    }

    const intervalId = this.heartbeatIntervals.get(res);
    if (intervalId) {
      clearInterval(intervalId);
      this.heartbeatIntervals.delete(res);
    }

    logger.info({ userId, remainingStreams: userStreams?.size || 0 }, "SSE connection unregistered");
  }

  /**
   * Pushes real-time JSON payload to all active SSE streams of a specific user.
   */
  sendToUser(userId: string, payload: any) {
    const userStreams = this.connections.get(userId);
    if (!userStreams || userStreams.size === 0) {
      return;
    }

    const message = `data: ${JSON.stringify(payload)}\n\n`;
    userStreams.forEach((res) => {
      try {
        if (!res.writableEnded) {
          res.write(message);
        }
      } catch (err) {
        logger.error({ err, userId }, "Failed to write to SSE stream");
      }
    });
  }

  /**
   * Closes all active connections (used during server shutdown).
   */
  closeAll() {
    logger.info("Closing all active SSE connections");
    this.connections.forEach((streams, userId) => {
      streams.forEach((res) => {
        try {
          if (!res.writableEnded) {
            res.end();
          }
        } catch (err) {
          // Ignore
        }
      });
    });
    this.connections.clear();
    this.heartbeatIntervals.forEach((intervalId) => clearInterval(intervalId));
    this.heartbeatIntervals.clear();
  }
}

export const sseManager = new SSEManager();
