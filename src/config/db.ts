import mongoose from "mongoose";
import { env } from "./env";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("db");

export async function connectToDB() {
  try {
    const conn = await mongoose.connect(env.MONGO_URI);
    logger.info("Mongo connection is successful");
    
    // Return the underlying MongoClient to be shared
    return conn.connection.getClient();
  } catch (error) {
    logger.error({ err: error }, "Mongo connection error");
    throw error;
  }
}
