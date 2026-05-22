import express, { Express, Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { connectDB } from "./config/database";

// Routes
import authRoutes from "./routes/auth.routes";
import usersRoutes from "./routes/users.routes";
import blacklistRoutes from "./routes/blacklist.routes";
import auditRoutes from "./routes/audit.routes";
import { errorHandler } from "./middleware/errorHandler";

dotenv.config();

const app: Express = express();

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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { success: false, message: "تم تجاوز الحد المسموح به من الطلبات، يرجى المحاولة لاحقاً" },
});
app.use("/api", limiter);

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/blacklist", blacklistRoutes);
app.use("/api/audit", auditRoutes);

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "UP", timestamp: new Date() });
});

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "المسار غير موجود" });
});

// Global Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

let server: any;

// Connect to database
// Mongoose buffers queries, so it's safe to call this without awaiting before the first request
connectDB().catch((err) => console.error("MongoDB connection error:", err));

// Only start the Express server if NOT running in Vercel Serverless environment
if (process.env.VERCEL !== "1") {
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
