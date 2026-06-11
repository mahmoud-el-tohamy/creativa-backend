import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { User, IUser } from "../models/User";
import { AuditLog } from "../models/AuditLog";

const generateTokens = (user: IUser) => {
  const accessToken = jwt.sign(
    { userId: user._id, role: user.role, displayName: user.displayName },
    process.env.JWT_SECRET as string,
    { expiresIn: (process.env.JWT_EXPIRES_IN || "15m") as jwt.SignOptions["expiresIn"] }
  );

  const refreshToken = jwt.sign(
    { userId: user._id },
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || "7d") as jwt.SignOptions["expiresIn"] }
  );

  return { accessToken, refreshToken };
};

const hashToken = (token: string) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      res.status(401).json({ success: false, message: "بيانات الدخول غير صحيحة" });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ success: false, message: "تم تعطيل حسابك" });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({ success: false, message: "بيانات الدخول غير صحيحة" });
      return;
    }

    const { accessToken, refreshToken } = generateTokens(user);
    const hashedRefreshToken = hashToken(refreshToken);

    user.refreshTokens.push(hashedRefreshToken);
    if (user.refreshTokens.length > 5) {
      user.refreshTokens.shift();
    }
    
    user.lastLoginAt = new Date();
    await user.save();

    await AuditLog.create({
      action: "login",
      performedBy: user._id,
      performedByName: user.displayName,
      performedByRole: user.role,
      details: "تسجيل الدخول للنظام",
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    const isProd = process.env.NODE_ENV === "production";
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? "none" : "lax") as "none" | "lax",
      maxAge: 15 * 60 * 1000, // 15 mins
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? "none" : "lax") as "none" | "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.cookie("user-role", user.role, {
      httpOnly: false, // must be readable by Next.js middleware
      secure: isProd,
      sameSite: (isProd ? "none" : "lax") as "none" | "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refreshToken } = req.cookies;
    
    if (req.user && refreshToken) {
      const hashedToken = hashToken(refreshToken);
      await User.findByIdAndUpdate(req.user.id, {
        $pull: { refreshTokens: hashedToken }
      });
    }

    if (req.user) {
      await AuditLog.create({
        action: "logout",
        performedBy: req.user.id,
        performedByName: req.user.displayName,
        performedByRole: req.user.role,
        details: "تسجيل الخروج من النظام",
        ipAddress: req.ip || req.socket.remoteAddress || "unknown",
      });
    }

    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    res.clearCookie("user-role");
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refreshToken } = req.cookies;

    if (!refreshToken) {
      res.status(401).json({ success: false, message: "غير مصرح بالوصول" });
      return;
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET as string) as { userId: string };
    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: "غير مصرح بالوصول" });
      return;
    }

    const hashedToken = hashToken(refreshToken);
    if (!user.refreshTokens.includes(hashedToken)) {
      res.status(401).json({ success: false, message: "غير مصرح بالوصول" });
      return;
    }

    const accessToken = jwt.sign(
      { userId: user._id, role: user.role, displayName: user.displayName },
      process.env.JWT_SECRET as string,
      { expiresIn: (process.env.JWT_EXPIRES_IN || "15m") as jwt.SignOptions["expiresIn"] }
    );

    const isProd = process.env.NODE_ENV === "production";
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? "none" : "lax") as "none" | "lax",
      maxAge: 15 * 60 * 1000,
    });

    res.cookie("user-role", user.role, {
      httpOnly: false, // must be readable by Next.js middleware
      secure: isProd,
      sameSite: (isProd ? "none" : "lax") as "none" | "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, matches refresh token logic
    });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(401).json({ success: false, message: "انتهت صلاحية الجلسة", code: "TOKEN_EXPIRED" });
  }
};

export const me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "غير مصرح بالوصول" });
      return;
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: "غير مصرح بالوصول" });
      return;
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};
