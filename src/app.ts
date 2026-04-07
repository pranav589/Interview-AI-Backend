import express from "express";
import helmet from "helmet";
import { 
  globalRateLimiter, 
  authRateLimiter 
} from "./middleware/rateLimiter";
import { errorHandler } from "./middleware/errorHandler";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth.routes";
import userRouter from "./routes/user.routes";
import adminRouter from "./routes/admin.routes";
import interviewRouter from "./routes/interview.routes";
import requireAuth from "./middleware/requireAuth";
import cors from "cors";

import { env } from "./config/env";
import { requestLogger } from "./middleware/requestLogger";

const app = express();

// Security headers
app.use(helmet());

// Trust proxy for secure cookies
app.set("trust proxy", 1);

// Health check before logging/limits
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(requestLogger);
app.use(globalRateLimiter);
const corsOptions = {
  origin: (origin: string | undefined, callback: any) => {
    const frontendUrl = env.FRONTEND_URL.replace(/\/$/, "");
    const allowedOrigins = [frontendUrl];
    
    if (env.NODE_ENV === "development") {
      allowedOrigins.push("http://localhost:3000", "http://localhost:3001");
    }

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
};

app.use(cors(corsOptions));
app.use(cookieParser());

// Routes
app.use("/api/v1/auth", authRateLimiter, authRouter);
app.use("/api/v1/user", requireAuth, userRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/interview", requireAuth, interviewRouter);

app.use(errorHandler);

export default app;
