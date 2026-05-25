import { Request, Response, NextFunction } from "express";
import { User } from "../models/User";
import { AuditLog } from "../models/AuditLog";

export const listUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const users = await User.find()
      .select("-refreshTokens -password")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

export const createUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { displayName, email, password, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(409).json({ success: false, message: "البريد الإلكتروني مسجل مسبقاً" });
      return;
    }

    const newUser = await User.create({
      displayName,
      email,
      password,
      role,
      createdBy: req.user?.id,
    });

    await AuditLog.create({
      action: "user_create",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: newUser._id.toString(),
      targetName: newUser.displayName,
      details: `إضافة مستخدم جديد: ${newUser.displayName}`,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    res.status(201).json({ 
      success: true, 
      data: {
        _id: newUser._id,
        displayName: newUser.displayName,
        email: newUser.email,
        role: newUser.role,
        isActive: newUser.isActive,
        createdAt: newUser.createdAt,
        updatedAt: newUser.updatedAt
      } 
    });
  } catch (error) {
    next(error);
  }
};

export const changeRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (id === req.user?.id) {
      res.status(403).json({ success: false, message: "لا يمكنك تغيير صلاحياتك بنفسك" });
      return;
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      res.status(404).json({ success: false, message: "المستخدم غير موجود" });
      return;
    }

    if (targetUser.role === "admin") {
      res.status(403).json({ success: false, message: "لا يمكنك تغيير صلاحيات مدير آخر" });
      return;
    }

    const oldRole = targetUser.role;
    targetUser.role = role;
    await targetUser.save();

    await AuditLog.create({
      action: "user_role_change",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: targetUser._id.toString(),
      targetName: targetUser.displayName,
      details: `تغيير صلاحيات ${targetUser.displayName} من ${oldRole} إلى ${role}`,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    res.status(200).json({ 
      success: true, 
      data: {
        _id: targetUser._id,
        displayName: targetUser.displayName,
        email: targetUser.email,
        role: targetUser.role,
        isActive: targetUser.isActive,
        createdAt: targetUser.createdAt,
        updatedAt: targetUser.updatedAt
      } 
    });
  } catch (error) {
    next(error);
  }
};

export const toggleActive = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    if (id === req.user?.id) {
      res.status(403).json({ success: false, message: "لا يمكنك تعطيل حسابك بنفسك" });
      return;
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      res.status(404).json({ success: false, message: "المستخدم غير موجود" });
      return;
    }

    targetUser.isActive = !targetUser.isActive;
    
    if (!targetUser.isActive) {
      targetUser.refreshTokens = [];
    }

    await targetUser.save();

    await AuditLog.create({
      action: targetUser.isActive ? "user_activate" : "user_deactivate",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: targetUser._id.toString(),
      targetName: targetUser.displayName,
      details: `${targetUser.isActive ? "تفعيل" : "تعطيل"} حساب ${targetUser.displayName}`,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    res.status(200).json({ 
      success: true, 
      data: {
        _id: targetUser._id,
        displayName: targetUser.displayName,
        email: targetUser.email,
        role: targetUser.role,
        isActive: targetUser.isActive,
        createdAt: targetUser.createdAt,
        updatedAt: targetUser.updatedAt
      } 
    });
  } catch (error) {
    next(error);
  }
};

export const hardDeleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    if (id === req.user?.id) {
      res.status(403).json({ success: false, message: "لا يمكنك حذف حسابك بنفسك" });
      return;
    }

    const targetUser = await User.findById(id);
    if (!targetUser) {
      res.status(404).json({ success: false, message: "المستخدم غير موجود" });
      return;
    }

    if (targetUser.role === "admin") {
      res.status(403).json({ success: false, message: "لا يمكنك حذف مدير آخر" });
      return;
    }

    await User.findByIdAndDelete(id);

    await AuditLog.create({
      action: "user_delete",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: targetUser._id.toString(),
      targetName: targetUser.displayName,
      details: `حذف نهائي لحساب ${targetUser.displayName}`,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    res.status(200).json({ success: true, message: "تم حذف المستخدم بنجاح" });
  } catch (error) {
    next(error);
  }
};
