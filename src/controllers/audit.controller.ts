import { Request, Response, NextFunction } from "express";
import { AuditLog } from "../models/AuditLog";

export const listLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { action, performedBy, search, dateFrom, dateTo, page = "1", limit = "25" } = req.query;

    const query: any = {};

    if (action) {
      query.action = action;
    }

    if (performedBy) {
      query.performedBy = performedBy;
    }

    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      query.$or = [{ details: searchRegex }, { performedByName: searchRegex }];
    }

    if (dateFrom || dateTo) {
      query.timestamp = {};
      if (dateFrom) query.timestamp.$gte = new Date(dateFrom as string);
      if (dateTo) query.timestamp.$lte = new Date(dateTo as string);
    }

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 25, 100);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      AuditLog.find(query).sort({ timestamp: -1 }).skip(skip).limit(limitNum),
      AuditLog.countDocuments(query),
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
