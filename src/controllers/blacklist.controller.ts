import { Request, Response, NextFunction } from "express";
import { BlacklistEntry } from "../models/BlacklistEntry";
import { AuditLog } from "../models/AuditLog";
import { DailyStat } from "../models/DailyStat";

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

export const getIds = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const entries = await BlacklistEntry.find({}).select("nationalId");
    const ids = entries.map(e => e.nationalId);
    res.status(200).json(ids);
  } catch (error) {
    next(error);
  }
};


export const addSingle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, nationalId, notes, trackName = "إضافة يدوية" } = req.body;

    const existing = await BlacklistEntry.findOne({ nationalId });
    if (existing) {
      if (existing.status === "warning") {
        existing.absences.push({ track: trackName, date: new Date() });
        if (existing.absences.length >= 3) {
          existing.status = "blacklisted";
          const addedAt = new Date();
          existing.addedAt = addedAt;
          const expiresAt = new Date(addedAt);
          expiresAt.setMonth(expiresAt.getMonth() + 4);
          existing.expiresAt = expiresAt;
        }
        await existing.save();
        res.status(200).json({ success: true, data: existing, message: "تمت زيادة عدد الإنذارات بنجاح" });
        return;
      } else {
        res.status(409).json({ success: false, message: "الرقم القومي موجود في القائمة السوداء مسبقاً" });
        return;
      }
    }

    const addedAt = new Date();
    const expiresAt = new Date(addedAt);
    expiresAt.setMonth(expiresAt.getMonth() + 4);

    const entry = await BlacklistEntry.create({
      name,
      nationalId,
      notes,
      status: "warning",
      absences: [{ track: trackName, date: addedAt }],
      attendedCount: 0,
      addedBy: req.user?.id,
      addedByName: req.user?.displayName,
      addedAt,
      expiresAt,
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

    await DailyStat.recordAddition(1, addedAt);

    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
};

export const bulkAdd = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { absentees = [], attendeesNationalIds = [], trackName = "غير محدد" } = req.body;

    // Backward compatibility if frontend still sends `entries` instead of `absentees`
    const absenteesList = req.body.entries ? req.body.entries : absentees;

    let clearedCount = 0;
    // 1. Handle attendees (clearing warnings)
    if (attendeesNationalIds.length > 0) {
      const attendeesInWarning = await BlacklistEntry.find({
        nationalId: { $in: attendeesNationalIds },
        status: "warning"
      });

      const bulkOps = [];

      for (const entry of attendeesInWarning) {
        const newAttendedCount = (entry.attendedCount || 0) + 1;
        if (newAttendedCount >= 2) {
          bulkOps.push({
            deleteOne: {
              filter: { _id: entry._id }
            }
          });
          clearedCount++;
        } else {
          bulkOps.push({
            updateOne: {
              filter: { _id: entry._id },
              update: { $set: { attendedCount: newAttendedCount } }
            }
          });
        }
      }

      if (bulkOps.length > 0) {
        await BlacklistEntry.bulkWrite(bulkOps);
      }
    }

    // 2. Handle absentees (adding warnings / blacklisting)
    let addedCount = 0;
    let upgradedCount = 0;
    
    if (absenteesList.length > 0) {
      const absenteeIds = absenteesList.map((e: any) => e.nationalId);
      const existingAbsentees = await BlacklistEntry.find({
        nationalId: { $in: absenteeIds }
      });
      const existingMap = new Map(existingAbsentees.map(e => [e.nationalId, e]));

      const bulkOps = [];

      for (const p of absenteesList) {
        const existing = existingMap.get(p.nationalId);
        if (!existing) {
          // New warning
          const addedAt = new Date();
          const expiresAt = new Date(addedAt);
          expiresAt.setMonth(expiresAt.getMonth() + 4);
          
          bulkOps.push({
            insertOne: {
              document: {
                name: p.name,
                nationalId: p.nationalId,
                status: "warning",
                absences: [{ track: trackName, date: addedAt }],
                attendedCount: 0,
                addedBy: req.user?.id,
                addedByName: req.user?.displayName,
                addedAt,
                expiresAt,
                notes: p.notes || ""
              }
            }
          });
          addedCount++;
        } else {
          // Existing record
          if (existing.status === "warning") {
            const newAbsences = [...existing.absences, { track: trackName, date: new Date() }];
            
            if (newAbsences.length >= 3) {
              const addedAt = new Date();
              const expiresAt = new Date(addedAt);
              expiresAt.setMonth(expiresAt.getMonth() + 4);
              
              bulkOps.push({
                updateOne: {
                  filter: { _id: existing._id },
                  update: {
                    $set: {
                      status: "blacklisted",
                      addedAt: addedAt,
                      expiresAt: expiresAt,
                      absences: newAbsences
                    }
                  }
                }
              });
              upgradedCount++;
            } else {
              bulkOps.push({
                updateOne: {
                  filter: { _id: existing._id },
                  update: {
                    $set: { absences: newAbsences }
                  }
                }
              });
            }
          } else {
            // Already blacklisted, just push absence
            const newAbsences = [...existing.absences, { track: trackName, date: new Date() }];
            bulkOps.push({
              updateOne: {
                filter: { _id: existing._id },
                update: {
                  $set: { absences: newAbsences }
                }
              }
            });
          }
        }
      }

      if (bulkOps.length > 0) {
        await BlacklistEntry.bulkWrite(bulkOps);
      }
    }

    await AuditLog.create({
      action: "blacklist_bulk_add",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      details: `حضور وغياب: مسح ${clearedCount} إنذارات، إضافة ${addedCount} إنذارات جديدة، وتحويل ${upgradedCount} للقائمة السوداء.`,
      metadata: { addedCount, clearedCount, upgradedCount, trackName },
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    if (addedCount > 0 || upgradedCount > 0) {
      await DailyStat.recordAddition(addedCount + upgradedCount);
    }
    if (clearedCount > 0) {
      await DailyStat.recordRemoval(clearedCount);
    }

    res.status(201).json({
      success: true,
      added: addedCount,
      cleared: clearedCount,
      upgraded: upgradedCount,
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

    await DailyStat.recordRemoval(1);

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const cleanup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const deletedCount = await BlacklistEntry.cleanupExpired();

    if (deletedCount > 0) {
      await AuditLog.create({
        action: "blacklist_bulk_cleanup",
        performedBy: req.user?.id,
        performedByName: req.user?.displayName,
        performedByRole: req.user?.role,
        details: `تنظيف القائمة السوداء: إزالة ${deletedCount} سجل منتهي الصلاحية`,
        metadata: { count: deletedCount },
        ipAddress: req.ip || req.socket.remoteAddress || "unknown",
      });
      await DailyStat.recordRemoval(deletedCount);
    }

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

export const bulkCheck = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { nationalIds } = req.body;

    if (!Array.isArray(nationalIds) || nationalIds.length === 0) {
      res.status(400).json({ success: false, message: "مصفوفة الأرقام القومية مطلوبة" });
      return;
    }

    const entries = await BlacklistEntry.find({ nationalId: { $in: nationalIds } });
    
    const results: Record<string, { status: string; warningsCount: number }> = {};
    
    for (const id of nationalIds) {
      results[id] = { status: "none", warningsCount: 0 };
    }

    for (const entry of entries) {
      if (!entry.isExpired) {
        results[entry.nationalId] = {
          status: entry.status,
          warningsCount: entry.absences?.length || 0
        };
      }
    }

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    next(error);
  }
};
