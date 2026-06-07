import express, { Express, Request, Response, NextFunction } from "express";
import dotenv from "dotenv";

// Load env vars first before anything else
dotenv.config();

import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { connectDB } from "./config/database";

// Initialize database connection immediately at the top level for Vercel
connectDB().catch((err) => console.error("MongoDB connection error:", err));

// Routes
import authRoutes from "./routes/auth.routes";
import usersRoutes from "./routes/users.routes";
import blacklistRoutes from "./routes/blacklist.routes";
import auditRoutes from "./routes/audit.routes";
import tracksRoutes from "./routes/tracks.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import hoursRoutes from "./routes/hours.routes";
import attendanceSheetRoutes from "./routes/attendanceSheet.routes";
import { errorHandler } from "./middleware/errorHandler";

const app: Express = express();

// Disable ETag so API responses always return fresh 200 (no 304 stale cache)
app.set("etag", false);

// Security and utility middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

// Trust proxy so we get the real client IP on Vercel
app.set("trust proxy", 1);

import mongoose from "mongoose";

// PERF: Keep-alive endpoints for external monitors
// GET /api/ping (Placed before rate-limiter and auth to ensure fast response)
app.get("/api/ping", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    timestamp: Date.now(),
    env: process.env.NODE_ENV,
  });
});

// GET /api/health
app.get("/api/health", async (req: Request, res: Response) => {
  try {
    const state = mongoose.connection.readyState;
    const stateMap = ["disconnected", "connected", "connecting", "disconnecting"];
    res.status(200).json({
      status: state === 1 ? "healthy" : "degraded",
      db: stateMap[state] ?? "unknown",
      uptime: process.uptime(),
    });
  } catch {
    res.status(503).json({ status: "unhealthy" });
  }
});

// Rate limiting (User-based if logged in, IP-based otherwise)
import jwt from "jsonwebtoken";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each user/IP to 1000 requests per 15 minutes
  keyGenerator: (req, res) => {
    // Attempt to extract userId from cookies for user-based rate limiting
    const token = req.cookies?.accessToken || req.cookies?.refreshToken;
    if (token) {
      try {
        const decoded = jwt.decode(token) as any;
        if (decoded && decoded.userId) {
          return decoded.userId;
        }
      } catch (e) {
        // Ignore decode errors, fallback to IP
      }
    }
    // Fallback to IP address if not logged in.
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    return ipKeyGenerator(ip);
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { success: false, message: "تم تجاوز الحد المسموح به من الطلبات، يرجى المحاولة لاحقاً" },
});
app.use("/api", limiter);

// Middleware to ensure DB connection is ready before handling requests 
// (Crucial for Vercel serverless where bufferCommands=false causes immediate crash if not connected)
app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("MongoDB Connection Error in middleware:", error);
    next(error);
  }
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/blacklist", blacklistRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/tracks", tracksRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/hours", hoursRoutes);
app.use("/api/attendance-sheet", attendanceSheetRoutes);



// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "المسار غير موجود" });
});

// Global Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

let server: any;

// Only start the Express server if NOT running in Vercel Serverless environment
if (process.env.VERCEL !== "1") {
  const { initCronJobs } = require("./services/cron.service");
  initCronJobs();

  server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("Graceful shutdown initiated...");
    if (server) {
      server.close(() => {
        console.log("HTTP server closed.");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export default app;
