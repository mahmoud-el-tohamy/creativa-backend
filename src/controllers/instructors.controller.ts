import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { Types } from "mongoose";
import { Instructor } from "../models/Instructor";
import { AuditLog } from "../models/AuditLog";
import { getInstructorDashboard, getDateRange, type DateRangeFilter } from "../services/instructorService";
import {
  exportInstructorProfile,
  exportInstructorSessions,
  exportAllInstructorProfiles,
  exportAllInstructorSessions,
} from "../services/instructorExcelExporter";
import { TrainingSession } from "../models/TrainingSession";
import { calculateSessionPayout } from "../services/payoutCalculator";
import { addRatePeriod, updateRatePeriod } from "../services/ratePeriodService";

/** Safely extract a string IP address from Express 5's req.ip (string | string[]) */
const getIp = (req: Request): string => {
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
  return Array.isArray(ip) ? (ip[0] ?? "unknown") : ip;
};

// ─── Validation ───────────────────────────────────────────────────────────────

const createInstructorSchema = Joi.object({
  name: Joi.string().trim().required().messages({
    "any.required": "اسم المدرب مطلوب",
    "string.empty": "اسم المدرب مطلوب",
  }),
  specializations: Joi.array().items(Joi.string().trim()).optional().default([]),
  graduationYear: Joi.number()
    .integer()
    .min(1970)
    .max(new Date().getFullYear())
    .optional()
    .allow(null)
    .default(null),
  cvLink: Joi.string().uri().optional().allow("", null).default(""),
  dailyTrainingRate: Joi.number().min(0).optional().default(0),
  dailyConsultationRate: Joi.number().min(0).optional().default(0),
});

const updateInstructorSchema = Joi.object({
  name: Joi.string().trim().optional(),
  specializations: Joi.array().items(Joi.string().trim()).optional(),
  isActive: Joi.boolean().optional(),
});

const ratesSchema = Joi.object({
  dailyTrainingRate: Joi.number().min(0).optional(),
  dailyConsultationRate: Joi.number().min(0).optional(),
  graduationYear: Joi.number().integer().min(1970).max(new Date().getFullYear()).optional().allow(null),
  cvLink: Joi.string().uri().optional().allow("", null),
});

const ratePeriodSchema = Joi.object({
  startDate: Joi.date().iso().required().messages({
    "any.required": "تاريخ البداية مطلوب",
  }),
  endDate: Joi.date().iso().allow(null).optional().default(null),
  dailyTrainingRate: Joi.number().min(0).required().messages({
    "any.required": "اليوم التدريبي مطلوب",
  }),
  dailyConsultationRate: Joi.number().min(0).required().messages({
    "any.required": "اليوم الاستشاري مطلوب",
  }),
  note: Joi.string().allow("", null).optional(),
});

// ─── LIST ─────────────────────────────────────────────────────────────────────

export const listInstructors = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      search,
      specialization,
      page = "1",
      limit = "20",
      includeInactive,
    } = req.query;

    const query: Record<string, unknown> = {};

    if (includeInactive !== "true") {
      query.isActive = true;
    }

    if (search && typeof search === "string") {
      query.$or = [
        { name: { $regex: search.trim(), $options: "i" } },
      ];
    }

    if (specialization && typeof specialization === "string") {
      query.specializations = specialization;
    }

    const pageNum = Math.max(parseInt(page as string, 10) || 1, 1);
    const limitNum = Math.min(parseInt(limit as string, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Instructor.find(query).sort({ name: 1 }).skip(skip).limit(limitNum),
      Instructor.countDocuments(query),
    ]);

    // Normalize: ensure specializations is always an array (old docs may be missing it)
    const normalized = data.map((doc) => {
      const obj = doc.toObject({ virtuals: true });
      return {
        ...obj,
        specializations: Array.isArray(obj.specializations) ? obj.specializations : [],
      };
    });

    res.status(200).json({
      success: true,
      data: normalized,
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

// ─── CREATE ───────────────────────────────────────────────────────────────────

export const createInstructor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = createInstructorSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message,
      }));
      res
        .status(400)
        .json({ success: false, message: "بيانات غير صالحة", errors });
      return;
    }

    // Check name uniqueness (case-insensitive)
    const existing = await Instructor.findOne({
      name: { $regex: `^${value.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    });
    if (existing) {
      res
        .status(409)
        .json({ success: false, message: "اسم المدرب موجود بالفعل" });
      return;
    }

    const instructor = await Instructor.create({
      ...value,
      createdBy: req.user?.id ? new Types.ObjectId(String(req.user.id)) : null,
      createdByName: req.user?.displayName ?? "",
    });

    await AuditLog.create({
      action: "instructor_create",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: String(instructor._id),
      targetName: instructor.name,
      details: `إضافة مدرب جديد: ${instructor.name}`,
      ipAddress: getIp(req),
    });

    res.status(201).json({
      success: true,
      data: instructor.toObject({ virtuals: true }),
    });
  } catch (error: unknown) {
    const mongoErr = error as { code?: number };
    if (mongoErr.code === 11000) {
      res
        .status(409)
        .json({ success: false, message: "اسم المدرب موجود بالفعل" });
      return;
    }
    next(error);
  }
};

// ─── GET ONE ──────────────────────────────────────────────────────────────────

export const getInstructor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const instructor = await Instructor.findById(id);
    if (!instructor) {
      res
        .status(404)
        .json({ success: false, message: "المدرب غير موجود" });
      return;
    }
    const obj = instructor.toObject({ virtuals: true });
    // Normalize: ensure specializations is always an array for old documents
    if (!Array.isArray(obj.specializations)) {
      obj.specializations = [];
    }
    res.status(200).json({
      success: true,
      data: obj,
    });
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE (admin + employee — NOT rates fields) ─────────────────────────────

export const updateInstructor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const role = req.user?.role;

    if (role === "accountant") {
      res
        .status(403)
        .json({ success: false, message: "ليس لديك صلاحية تعديل بيانات المدرب" });
      return;
    }

    const { error, value } = updateInstructorSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message,
      }));
      res
        .status(400)
        .json({ success: false, message: "بيانات غير صالحة", errors });
      return;
    }

    // Strip rate/profile-only fields — those go through PATCH /rates
    const { dailyTrainingRate, dailyConsultationRate, graduationYear, cvLink, ...safeUpdate } = value as Record<string, unknown>;
    void dailyTrainingRate; void dailyConsultationRate; void graduationYear; void cvLink;

    const instructor = await Instructor.findByIdAndUpdate(
      id,
      { $set: safeUpdate },
      { new: true, runValidators: true }
    );

    if (!instructor) {
      res
        .status(404)
        .json({ success: false, message: "المدرب غير موجود" });
      return;
    }

    await AuditLog.create({
      action: "instructor_update",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: String(instructor._id),
      targetName: instructor.name,
      details: `تعديل بيانات المدرب: ${instructor.name}`,
      ipAddress: getIp(req),
    });

    res.status(200).json({
      success: true,
      data: instructor.toObject({ virtuals: true }),
    });
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE RATES (admin + accountant ONLY) ───────────────────────────────────

export const updateInstructorRates = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const role = req.user?.role;

    if (role === "employee") {
      res
        .status(403)
        .json({ success: false, message: "ليس لديك صلاحية تعديل الأسعار" });
      return;
    }

    const { error, value } = ratesSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message,
      }));
      res
        .status(400)
        .json({ success: false, message: "بيانات غير صالحة", errors });
      return;
    }

    // Build update with only the provided fields
    const updateFields: Record<string, unknown> = {};
    if (value.dailyTrainingRate !== undefined)
      updateFields.dailyTrainingRate = value.dailyTrainingRate;
    if (value.dailyConsultationRate !== undefined)
      updateFields.dailyConsultationRate = value.dailyConsultationRate;
    if (value.graduationYear !== undefined)
      updateFields.graduationYear = value.graduationYear;
    if (value.cvLink !== undefined) updateFields.cvLink = value.cvLink;

    if (Object.keys(updateFields).length === 0) {
      res
        .status(400)
        .json({ success: false, message: "لم يتم توفير أي بيانات للتعديل" });
      return;
    }

    const instructor = await Instructor.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!instructor) {
      res
        .status(404)
        .json({ success: false, message: "المدرب غير موجود" });
      return;
    }

    const changesAr = Object.entries(updateFields)
      .map(([k, v]) => {
        const labels: Record<string, string> = {
          dailyTrainingRate: "سعر اليوم التدريبي",
          dailyConsultationRate: "سعر اليوم الاستشاري",
          graduationYear: "تاريخ الخبرة",
          cvLink: "لينك السي في",
        };
        return `${labels[k] ?? k}: ${v}`;
      })
      .join("، ");

    await AuditLog.create({
      action: "instructor_rates_update",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: String(instructor._id),
      targetName: instructor.name,
      details: `تعديل بيانات الأسعار للمدرب ${instructor.name}: ${changesAr}`,
      metadata: updateFields,
      ipAddress: getIp(req),
    });

    res.status(200).json({
      success: true,
      data: instructor.toObject({ virtuals: true }),
    });
  } catch (error) {
    next(error);
  }
};

// ─── SOFT DELETE ──────────────────────────────────────────────────────────────

export const deleteInstructor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const instructor = await Instructor.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!instructor) {
      res
        .status(404)
        .json({ success: false, message: "المدرب غير موجود" });
      return;
    }

    await AuditLog.create({
      action: "instructor_delete",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: String(instructor._id),
      targetName: instructor.name,
      details: `إلغاء تفعيل المدرب: ${instructor.name}`,
      ipAddress: getIp(req),
    });

    res.status(200).json({ success: true, message: "تم إلغاء تفعيل المدرب" });
  } catch (error) {
    next(error);
  }
};

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

export const getDashboard = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const rawPeriod = req.query.period;
    const validPeriods: DateRangeFilter["period"][] = [
      "month",
      "3months",
      "6months",
      "year",
    ];
    const period: DateRangeFilter["period"] =
      typeof rawPeriod === "string" &&
      validPeriods.includes(rawPeriod as DateRangeFilter["period"])
        ? (rawPeriod as DateRangeFilter["period"])
        : "month";

    const data = await getInstructorDashboard(String(id), period);
    res.status(200).json({ success: true, data });
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message === "المدرب غير موجود") {
      res.status(404).json({ success: false, message: err.message });
      return;
    }
    next(error);
  }
};

// ─── ACCOUNTANT DASHBOARD ─────────────────────────────────────────────────────

interface InstructorSummaryAccumulator {
  instructorId: string;
  instructorName: string;
  totalHours: number;
  totalSessions: number;
  totalDays: number;
  totalAmount: number;
  trainingAmount: number;
  consultationAmount: number;
  hasRates: boolean;
}

interface ProgramAccumulator {
  program: string;
  totalHours: number;
  totalSessions: number;
  totalAmount: number;
}

interface MonthAccumulator {
  month: string;
  totalHours: number;
  totalAmount: number;
  sessionCount: number;
}

export const getAccountantDashboard = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawPeriod = req.query.period;
    const rawStartDate = req.query.startDate as string | undefined;
    const rawEndDate = req.query.endDate as string | undefined;
    
    const validPeriods: DateRangeFilter["period"][] = ["month", "3months", "6months", "year", "custom"];
    const period: DateRangeFilter["period"] =
      typeof rawPeriod === "string" && validPeriods.includes(rawPeriod as DateRangeFilter["period"])
        ? (rawPeriod as DateRangeFilter["period"])
        : "month";

    const { start, end, label } = getDateRange({ period, startDate: rawStartDate, endDate: rawEndDate });

    // 1 & 2. Get all active instructors (with ratePeriods for historical lookup) and sessions concurrently
    const [instructors, sessions] = await Promise.all([
      Instructor.find({ isActive: true })
        .select("_id name dailyTrainingRate dailyConsultationRate ratePeriods")
        .lean(),
      TrainingSession.find({
        date: { $gte: start, $lte: end },
        instructorId: { $exists: true, $ne: null },
      })
        .select("instructorId instructorName programName hours dayValue mode type sessionName date attendeesCount isPaid")
        .lean(),
    ]);

    // 3. Build instructor document lookup map (full doc needed for per-session rate resolution)
    //    rateMap is intentionally removed: rate selection must happen inside the session loop
    //    because different sessions for the same instructor may fall under different rate periods.
    const instructorDocMap = new Map(
      instructors.map((i) => [
        i._id.toString(),
        {
          name: i.name,
          dailyTrainingRate: i.dailyTrainingRate || 0,
          dailyConsultationRate: i.dailyConsultationRate || 0,
          ratePeriods: i.ratePeriods ?? [],
          hasRates:
            (i.dailyTrainingRate || 0) > 0 || (i.dailyConsultationRate || 0) > 0,
        },
      ])
    );

    // 4. Compute per-instructor summaries (amounts = post-attendance-discount, as the accountant
    //    dashboard should reflect what instructors will ACTUALLY be paid, not the undiscounted total)
    const instructorMap = new Map<string, InstructorSummaryAccumulator>();

    for (const session of sessions) {
      const instrId = session.instructorId?.toString();
      if (!instrId) continue;

      const instrDoc = instructorDocMap.get(instrId);
      if (!instrDoc) continue;

      const isConsultation = session.type === "Consultation";

      const payout = calculateSessionPayout({
        sessionDate: new Date(session.date),
        hours: session.hours ?? 0,
        attendeesCount: session.attendeesCount ?? 0,
        isConsultation,
        isPaid: session.isPaid,
        instructor: {
          ratePeriods: instrDoc.ratePeriods,
          dailyTrainingRate: instrDoc.dailyTrainingRate,
          dailyConsultationRate: instrDoc.dailyConsultationRate,
        },
      });

      const amount = payout.finalAmount;

      if (!instructorMap.has(instrId)) {
        instructorMap.set(instrId, {
          instructorId: instrId,
          instructorName: instrDoc.name,
          totalHours: 0,
          totalSessions: 0,
          totalDays: 0,
          totalAmount: 0,
          trainingAmount: 0,
          consultationAmount: 0,
          hasRates: instrDoc.hasRates,
        });
      }

      const acc = instructorMap.get(instrId)!;
      acc.totalHours += session.hours;
      acc.totalSessions += 1;
      acc.totalDays += session.dayValue || 0;
      acc.totalAmount += amount;
      if (isConsultation) acc.consultationAmount += amount;
      else acc.trainingAmount += amount;
    }

    // 5. Program breakdown (using finalAmount — post-attendance-discount)
    const programMap = new Map<string, ProgramAccumulator>();
    for (const session of sessions) {
      const instrId = session.instructorId?.toString();
      const instrDoc = instrId ? instructorDocMap.get(instrId) : null;
      const isConsultation = session.type === "Consultation";

      let amount = 0;
      if (instrDoc) {
        const payout = calculateSessionPayout({
          sessionDate: new Date(session.date),
          hours: session.hours ?? 0,
          attendeesCount: session.attendeesCount ?? 0,
          isConsultation,
          isPaid: session.isPaid,
          instructor: {
            ratePeriods: instrDoc.ratePeriods,
            dailyTrainingRate: instrDoc.dailyTrainingRate,
            dailyConsultationRate: instrDoc.dailyConsultationRate,
          },
        });
        amount = payout.finalAmount;
      }

      const progName = session.programName || "Unknown";

      if (!programMap.has(progName)) {
        programMap.set(progName, {
          program: progName,
          totalHours: 0,
          totalSessions: 0,
          totalAmount: 0,
        });
      }
      const prog = programMap.get(progName)!;
      prog.totalHours += session.hours;
      prog.totalSessions += 1;
      prog.totalAmount += amount;
    }

    // 6. Monthly trend (using finalAmount — post-attendance-discount)
    const monthMap = new Map<string, MonthAccumulator>();
    const ARABIC_MONTHS = [
      "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
      "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
    ];

    for (const session of sessions) {
      const d = new Date(session.date);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      const mLabel = `${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;

      if (!monthMap.has(key)) {
        monthMap.set(key, {
          month: mLabel,
          totalHours: 0,
          totalAmount: 0,
          sessionCount: 0,
        });
      }

      const instrId = session.instructorId?.toString();
      const instrDoc = instrId ? instructorDocMap.get(instrId) : null;
      const isConsultation = session.type === "Consultation";

      let amount = 0;
      if (instrDoc) {
        const payout = calculateSessionPayout({
          sessionDate: new Date(session.date),
          hours: session.hours ?? 0,
          attendeesCount: session.attendeesCount ?? 0,
          isConsultation,
          isPaid: session.isPaid,
          instructor: {
            ratePeriods: instrDoc.ratePeriods,
            dailyTrainingRate: instrDoc.dailyTrainingRate,
            dailyConsultationRate: instrDoc.dailyConsultationRate,
          },
        });
        amount = payout.finalAmount;
      }

      const m = monthMap.get(key)!;
      m.totalHours += session.hours;
      m.totalAmount += amount;
      m.sessionCount += 1;
    }

    // 7. Assemble response
    const instructorSummaries = Array.from(instructorMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);
    const totalPayable = instructorSummaries.reduce((sum, i) => sum + i.totalAmount, 0);

    const instructorsWithoutRates = instructors
      .filter((i) => (i.dailyTrainingRate || 0) === 0 && (i.dailyConsultationRate || 0) === 0)
      .map((i) => ({ id: i._id.toString(), name: i.name }));

    const onlineCount = sessions.filter((s) => s.mode === "online").length;
    const offlineCount = sessions.filter((s) => s.mode === "offline").length;
    const totalHours = sessions.reduce((s, sess) => s + sess.hours, 0);

    res.json({
      success: true,
      data: {
        period: { start, end, label },
        totalPayable,
        trainingPayable: instructorSummaries.reduce((s, i) => s + i.trainingAmount, 0),
        consultationPayable: instructorSummaries.reduce((s, i) => s + i.consultationAmount, 0),
        instructorSummaries,
        programBreakdown: Array.from(programMap.values()).sort((a, b) => b.totalHours - a.totalHours),
        monthlyTrend: Array.from(monthMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, v]) => v),
        onlineCount,
        offlineCount,
        totalSessions: sessions.length,
        totalHours,
        avgHoursPerSession: sessions.length > 0 ? Math.round((totalHours / sessions.length) * 10) / 10 : 0,
        instructorsWithoutRates,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── EXPORT SESSIONS ──────────────────────────────────────────────────────────

export const exportSessions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const rawPeriod = req.query.period;
    const rawStartDate = req.query.startDate as string | undefined;
    const rawEndDate = req.query.endDate as string | undefined;
    const validPeriods: DateRangeFilter["period"][] = [
      "month",
      "3months",
      "6months",
      "year",
      "custom"
    ];
    const period: DateRangeFilter["period"] =
      typeof rawPeriod === "string" &&
      validPeriods.includes(rawPeriod as DateRangeFilter["period"])
        ? (rawPeriod as DateRangeFilter["period"])
        : "month";

    const instructor = await Instructor.findById(id).lean();
    if (!instructor) {
      res.status(404).json({ success: false, message: "المدرب غير موجود" });
      return;
    }

    const filter: DateRangeFilter = { period, startDate: rawStartDate, endDate: rawEndDate };
    const buf = await exportInstructorSessions(String(id), filter);

    const safeName = instructor.name.replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, "").trim();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Instructor_${safeName}_${period}.xlsx"`
    );
    res.status(200).send(buf);
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message === "المدرب غير موجود") {
      res.status(404).json({ success: false, message: err.message });
      return;
    }
    next(error);
  }
};

// ─── EXPORT PROFILE ───────────────────────────────────────────────────────────

export const exportProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const instructor = await Instructor.findById(id).lean();
    if (!instructor) {
      res.status(404).json({ success: false, message: "المدرب غير موجود" });
      return;
    }

    const buf = await exportInstructorProfile(String(id));

    const safeName = instructor.name.replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, "").trim();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Profile_${safeName}.xlsx"`
    );
    res.status(200).send(buf);
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message === "المدرب غير موجود") {
      res.status(404).json({ success: false, message: err.message });
      return;
    }
    next(error);
  }
};

// ─── EXPORT ALL SESSIONS ──────────────────────────────────────────────────────

export const exportAllSessions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawPeriod = req.query.period;
    const rawStartDate = req.query.startDate as string | undefined;
    const rawEndDate = req.query.endDate as string | undefined;
    const validPeriods: DateRangeFilter["period"][] = [
      "month",
      "3months",
      "6months",
      "year",
      "custom"
    ];
    const period: DateRangeFilter["period"] =
      typeof rawPeriod === "string" &&
      validPeriods.includes(rawPeriod as DateRangeFilter["period"])
        ? (rawPeriod as DateRangeFilter["period"])
        : "month";

    const filter: DateRangeFilter = { period, startDate: rawStartDate, endDate: rawEndDate };
    const buf = await exportAllInstructorSessions(filter);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="All_Instructors_${period}.xlsx"`
    );
    res.status(200).send(buf);
  } catch (error: unknown) {
    next(error);
  }
};

// ─── EXPORT ALL PROFILES ──────────────────────────────────────────────────────

export const exportAllProfiles = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const buf = await exportAllInstructorProfiles();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="All_Profiles.xlsx"`
    );
    res.status(200).send(buf);
  } catch (error: unknown) {
    next(error);
  }
}

// ─── Rate Periods ─────────────────────────────────────────────────────────────

export const addInstructorRatePeriod = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const role = req.user?.role;

    if (role === "employee") {
      res.status(403).json({ success: false, message: "ليس لديك صلاحية تعديل الأسعار" });
      return;
    }

    const { error, value } = ratePeriodSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message,
      }));
      res.status(400).json({ success: false, message: "بيانات غير صالحة", errors });
      return;
    }

    const instructor = await Instructor.findById(id);
    if (!instructor) {
      res.status(404).json({ success: false, message: "المدرب غير موجود" });
      return;
    }

    // Call the service to add the rate period. It handles overlap checks and throws if invalid.
    const addResult = addRatePeriod(instructor, {
      startDate: new Date(value.startDate),
      endDate: value.endDate ? new Date(value.endDate) : null,
      dailyTrainingRate: value.dailyTrainingRate,
      dailyConsultationRate: value.dailyConsultationRate,
      createdBy: String(req.user?.id || ""),
      createdByName: req.user?.displayName || "Admin",
      note: value.note || "",
    });

    if (!addResult.success) {
      res.status(400).json({ success: false, message: addResult.error });
      return;
    }

    // Caller MUST save() after using ratePeriodService
    await instructor.save();

    await AuditLog.create({
      action: "instructor_rates_update",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: String(instructor._id),
      targetName: instructor.name,
      details: `أضاف فترة تسعير جديدة للمدرب: ${instructor.name}`,
      ipAddress: getIp(req),
    });

    res.json({ success: true, data: instructor });
  } catch (error: any) {
    if (error.message && error.message.includes("تتعارض")) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
};

export const updateInstructorRatePeriod = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, periodId } = req.params;
    const role = req.user?.role;

    if (role === "employee") {
      res.status(403).json({ success: false, message: "ليس لديك صلاحية تعديل الأسعار" });
      return;
    }

    const { error, value } = ratePeriodSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message,
      }));
      res.status(400).json({ success: false, message: "بيانات غير صالحة", errors });
      return;
    }

    const instructor = await Instructor.findById(id);
    if (!instructor) {
      res.status(404).json({ success: false, message: "المدرب غير موجود" });
      return;
    }

    const updateResult = updateRatePeriod(instructor, periodId as string, {
      startDate: new Date(value.startDate),
      endDate: value.endDate ? new Date(value.endDate) : null,
      dailyTrainingRate: value.dailyTrainingRate,
      dailyConsultationRate: value.dailyConsultationRate,
      note: value.note || "",
    });

    if (!updateResult.success) {
      res.status(400).json({ success: false, message: updateResult.error });
      return;
    }

    // Caller MUST save() after using ratePeriodService
    await instructor.save();

    await AuditLog.create({
      action: "instructor_rates_update",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: String(instructor._id),
      targetName: instructor.name,
      details: `عَدَّل فترة تسعير للمدرب: ${instructor.name}`,
      ipAddress: getIp(req),
    });

    res.json({ success: true, data: instructor });
  } catch (error: any) {
    if (error.message && error.message.includes("تتعارض")) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
};
