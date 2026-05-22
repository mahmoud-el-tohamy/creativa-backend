import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface DecodedToken {
  userId: string;
  role: string;
  displayName: string;
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  try {
    let token = "";

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      res.status(401).json({ success: false, message: "غير مصرح بالوصول" });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as DecodedToken;
    
    req.user = {
      id: decoded.userId,
      role: decoded.role,
      displayName: decoded.displayName,
    };

    next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      res.status(401).json({ success: false, message: "انتهت صلاحية الجلسة", code: "TOKEN_EXPIRED" });
      return;
    }
    res.status(401).json({ success: false, message: "رمز غير صالح" });
    return;
  }
};
