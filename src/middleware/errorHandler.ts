import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";

// PERF: Optimized error handler that prevents hanging on network drops
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err);

  // Already sent a response — can't send another
  if (res.headersSent) return;

  // Mongoose validation error
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      success: false,
      message: "بيانات غير صالحة",
      errors: Object.values(err.errors).map((e) => e.message),
    });
    return;
  }

  // Mongoose duplicate key
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: number }).code === 11000
  ) {
    res.status(409).json({
      success: false,
      message: "البيانات موجودة مسبقاً",
    });
    return;
  }

  // JWT errors
  if (err instanceof Error && err.name === "JsonWebTokenError") {
    res.status(401).json({ success: false, message: "رمز غير صالح" });
    return;
  }

  if (err instanceof Error && err.name === "TokenExpiredError") {
    res.status(401).json({
      success: false,
      message: "انتهت صلاحية الجلسة",
      code: "TOKEN_EXPIRED",
    });
    return;
  }

  // MongoDB timeout / network errors
  if (
    err instanceof Error &&
    (err.message.includes("ECONNREFUSED") ||
      err.message.includes("ETIMEDOUT") ||
      err.message.includes("MongoNetworkError"))
  ) {
    res.status(503).json({
      success: false,
      message: "تعذّر الاتصال بقاعدة البيانات، يرجى المحاولة مرة أخرى",
    });
    return;
  }

  // Default
  const isDev = process.env.NODE_ENV === "development";
  res.status(500).json({
    success: false,
    message: "حدث خطأ في الخادم",
    ...(isDev && err instanceof Error ? { stack: err.stack } : {}),
  });
}
