import { Request, Response, NextFunction } from "express";

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
  console.error("Error Handler:", err);

  // Mongoose Duplicate Key Error
  if (err.code === 11000) {
    res.status(409).json({ success: false, message: "البيانات موجودة مسبقاً" });
    return;
  }

  // Mongoose Validation Error
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((val: any) => ({
      field: val.path,
      message: val.message,
    }));
    res.status(400).json({ success: false, message: "بيانات غير صالحة", errors });
    return;
  }

  // JWT Errors
  if (err.name === "JsonWebTokenError") {
    res.status(401).json({ success: false, message: "رمز غير صالح" });
    return;
  }
  
  if (err.name === "TokenExpiredError") {
    res.status(401).json({ success: false, message: "انتهت صلاحية الجلسة", code: "TOKEN_EXPIRED" });
    return;
  }

  // Default Error
  const response: Record<string, any> = { success: false, message: "حدث خطأ في السيرفر" };
  if (process.env.NODE_ENV === "development") {
    response.stack = err.stack;
  }

  res.status(500).json(response);
};
