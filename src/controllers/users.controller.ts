import { Request, Response, NextFunction } from "express";
import { User } from "../models/User";
import { AuditLog } from "../models/AuditLog";
import fs from "fs";
import path from "path";

export const listUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const users = await User.find()
      .select("-refreshTokens -password")
      .sort({ createdAt: -1 })
      .lean();
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

export const getUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const targetUser = await User.findById(id).select("-refreshTokens -password").lean();
    if (!targetUser) {
      res.status(404).json({ success: false, message: "المستخدم غير موجود" });
      return;
    }
    res.status(200).json({ success: true, data: targetUser });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "غير مصرح" });
      return;
    }
    const targetUser = await User.findById(userId).select("-refreshTokens -password").lean();
    if (!targetUser) {
      res.status(404).json({ success: false, message: "المستخدم غير موجود" });
      return;
    }
    res.status(200).json({ success: true, data: targetUser });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "غير مصرح" });
      return;
    }

    const { displayName, age, address, nationalId, phone, password } = req.body;
    const targetUser = await User.findById(userId);

    if (!targetUser) {
      res.status(404).json({ success: false, message: "المستخدم غير موجود" });
      return;
    }

    if (displayName) targetUser.displayName = displayName;
    if (age !== undefined) targetUser.age = age;
    if (address !== undefined) targetUser.address = address;
    if (nationalId !== undefined) targetUser.nationalId = nationalId;
    if (phone !== undefined) targetUser.phone = phone;
    if (password) targetUser.password = password; // pre-save hook handles hashing

    await targetUser.save();

    await AuditLog.create({
      action: "user_profile_update",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: targetUser._id.toString(),
      targetName: targetUser.displayName,
      details: `قام المستخدم بتحديث بياناته الشخصية`,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    // Return without password
    const userObj = targetUser.toObject() as any;
    delete userObj.password;
    delete userObj.refreshTokens;

    res.status(200).json({ success: true, data: userObj, message: "تم التحديث بنجاح" });
  } catch (error) {
    next(error);
  }
};

export const adminUpdateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { displayName, email, age, address, nationalId, phone, password } = req.body;
    
    const targetUser = await User.findById(id);

    if (!targetUser) {
      res.status(404).json({ success: false, message: "المستخدم غير موجود" });
      return;
    }

    if (email && email !== targetUser.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        res.status(409).json({ success: false, message: "البريد الإلكتروني مستخدم مسبقاً" });
        return;
      }
      targetUser.email = email;
    }

    if (displayName) targetUser.displayName = displayName;
    if (age !== undefined) targetUser.age = age;
    if (address !== undefined) targetUser.address = address;
    if (nationalId !== undefined) targetUser.nationalId = nationalId;
    if (phone !== undefined) targetUser.phone = phone;
    if (password) targetUser.password = password; // pre-save hook handles hashing

    await targetUser.save();

    await AuditLog.create({
      action: "admin_user_update",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: targetUser._id.toString(),
      targetName: targetUser.displayName,
      details: `قام الإدمن بتعديل بيانات المستخدم: ${targetUser.displayName}`,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    const userObj = targetUser.toObject() as any;
    delete userObj.password;
    delete userObj.refreshTokens;

    res.status(200).json({ success: true, data: userObj, message: "تم التحديث بنجاح" });
  } catch (error) {
    next(error);
  }
};

export const uploadProfilePicture = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "غير مصرح" });
      return;
    }

    const { imageBase64 } = req.body;

    if (!imageBase64 || !imageBase64.startsWith("data:image")) {
      res.status(400).json({ success: false, message: "بيانات الصورة غير صالحة" });
      return;
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      res.status(404).json({ success: false, message: "المستخدم غير موجود" });
      return;
    }

    // Optional: Delete old disk file if the user had an old file-based avatar
    if (targetUser.profilePicture && !targetUser.profilePicture.startsWith("data:image")) {
      const oldFilePath = path.join(process.cwd(), "public", targetUser.profilePicture);
      if (fs.existsSync(oldFilePath)) {
        fs.unlink(oldFilePath, () => { /* ignore errors silently */ });
      }
    }

    targetUser.profilePicture = imageBase64;
    await targetUser.save();

    res.status(200).json({ success: true, data: { profilePicture: imageBase64 }, message: "تم تحديث الصورة بنجاح" });
  } catch (error) {
    next(error);
  }
};

export const deleteProfilePicture = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "غير مصرح" });
      return;
    }
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      res.status(404).json({ success: false, message: "المستخدم غير موجود" });
      return;
    }

    // Delete the file from disk if it's not base64
    if (targetUser.profilePicture && !targetUser.profilePicture.startsWith("data:image")) {
      const filePath = path.join(process.cwd(), "public", targetUser.profilePicture);
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, () => { /* ignore errors */ });
      }
    }

    targetUser.profilePicture = undefined;
    await targetUser.save();
    res.status(200).json({ success: true, message: "تم حذف الصورة بنجاح" });
  } catch (error) {
    next(error);
  }
};
