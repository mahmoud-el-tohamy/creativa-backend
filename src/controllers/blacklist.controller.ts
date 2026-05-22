import { Request, Response, NextFunction } from "express";
import { BlacklistEntry } from "../models/BlacklistEntry";
import { AuditLog } from "../models/AuditLog";

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, status, dateFrom, dateTo, sort, page = "1", limit = "50" } = req.query;

    const query: any = {};

    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      query.$or = [{ name: searchRegex }, { nationalId: searchRegex }];
    }

    if (status === "active") {
      query.expiresAt = { $gte: new Date() };
    } else if (status === "expiring") {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      query.expiresAt = { $gte: new Date(), $lte: thirtyDaysFromNow };
    } else if (status !== "all") {
      // Default to non-expired if not specified
      query.expiresAt = { $gte: new Date() };
    }

    if (dateFrom || dateTo) {
      query.addedAt = {};
      if (dateFrom) query.addedAt.$gte = new Date(dateFrom as string);
      if (dateTo) query.addedAt.$lte = new Date(dateTo as string);
    }

    let sortObj: any = { addedAt: -1 }; // newest
    if (sort === "oldest") sortObj = { addedAt: 1 };
    else if (sort === "name") sortObj = { name: 1 };

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 5000);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      BlacklistEntry.find(query).sort(sortObj).skip(skip).limit(limitNum),
      BlacklistEntry.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const addSingle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, nationalId, notes } = req.body;

    const existing = await BlacklistEntry.findOne({ nationalId });
    if (existing) {
      res.status(409).json({ success: false, message: "الرقم القومي موجود في القائمة السوداء مسبقاً" });
      return;
    }

    const entry = await BlacklistEntry.create({
      name,
      nationalId,
      notes,
      addedBy: req.user?.id,
      addedByName: req.user?.displayName,
    });

    await AuditLog.create({
      action: "blacklist_add",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: nationalId,
      targetName: name,
      details: `إضافة ${name} إلى القائمة السوداء`,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
};

export const bulkAdd = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { entries } = req.body;

    const existingEntries = await BlacklistEntry.find({
      nationalId: { $in: entries.map((e: any) => e.nationalId) }
    }).select("nationalId");
    
    const existingIds = new Set(existingEntries.map((e) => e.nationalId));

    const toInsert = entries
      .filter((e: any) => !existingIds.has(e.nationalId))
      .map((e: any) => {
        const addedAt = new Date();
        const expiresAt = new Date(addedAt);
        expiresAt.setMonth(expiresAt.getMonth() + 4);
        return {
          ...e,
          addedBy: req.user?.id,
          addedByName: req.user?.displayName,
          addedAt,
          expiresAt,
        };
      });

    if (toInsert.length > 0) {
      await BlacklistEntry.insertMany(toInsert);
    }

    await AuditLog.create({
      action: "blacklist_bulk_add",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      details: `إضافة جماعية للقائمة السوداء: تم إضافة ${toInsert.length} وتخطي ${existingIds.size}`,
      metadata: { count: toInsert.length, skipped: existingIds.size },
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    res.status(201).json({
      success: true,
      added: toInsert.length,
      skipped: existingIds.size,
      skippedIds: Array.from(existingIds),
    });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const entry = await BlacklistEntry.findById(id);
    if (!entry) {
      res.status(404).json({ success: false, message: "لم يتم العثور على السجل" });
      return;
    }

    await entry.deleteOne();

    await AuditLog.create({
      action: "blacklist_remove",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: entry.nationalId,
      targetName: entry.name,
      details: `إزالة ${entry.name} من القائمة السوداء`,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const cleanup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const deletedCount = await BlacklistEntry.cleanupExpired();

    await AuditLog.create({
      action: "blacklist_bulk_cleanup",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      details: `تنظيف القائمة السوداء: إزالة ${deletedCount} سجل منتهي الصلاحية`,
      metadata: { count: deletedCount },
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    res.status(200).json({ success: true, deleted: deletedCount });
  } catch (error) {
    next(error);
  }
};

export const check = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { nationalId } = req.query;

    if (!nationalId) {
      res.status(400).json({ success: false, message: "الرقم القومي مطلوب" });
      return;
    }

    const entry = await BlacklistEntry.findOne({ nationalId: nationalId as string });

    if (!entry) {
      res.status(200).json({ success: true, isBlacklisted: false });
      return;
    }

    res.status(200).json({
      success: true,
      isBlacklisted: !entry.isExpired,
      entry,
    });
  } catch (error) {
    next(error);
  }
};
