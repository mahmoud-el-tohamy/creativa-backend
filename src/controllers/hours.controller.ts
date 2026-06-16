import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import * as XLSX from "xlsx";
import { Types } from "mongoose";
import {
  TrainingSession,
  getFiscalYear,
  mapProgramToTimetableRow,
  PROGRAM_NAMES,
  ProgramName,
} from "../models/TrainingSession";
import { Instructor } from "../models/Instructor";
import { TimetableSnapshot } from "../models/TimetableSnapshot";
import { AuditLog } from "../models/AuditLog";
import { BlacklistEntry } from "../models/BlacklistEntry";
import { rebuildTimetableSnapshot, rebuildAfterSessionChange } from "../services/timetableBuilder";
import { exportHoursTracking, exportTimetable } from "../services/excelExporter";

/** Safely extract a string IP address from Express 5's req.ip (string | string[]) */
const getIp = (req: Request): string => {
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
  return Array.isArray(ip) ? ip[0] ?? "unknown" : ip;
};

// ─── Joi validation schema ────────────────────────────────────────────────────

const sessionSchema = Joi.object({
  programName: Joi.string()
    .required()
    .when("type", {
      is: "Consultation",
      then: Joi.valid(
        "Career Development",
        "Freelancing",
        "Entrepreneurship",
        "Acceleration program"
      ),
      otherwise: Joi.valid(...PROGRAM_NAMES),
    })
    .messages({ "any.only": "اسم البرنامج غير صالح", "any.required": "اسم البرنامج مطلوب" }),
  sessionName: Joi.string().trim().required().messages({ "any.required": "اسم الجلسة مطلوب" }),
  date: Joi.date().iso().required().messages({ "any.required": "التاريخ مطلوب", "date.base": "التاريخ غير صالح" }),
  hours: Joi.number().min(0.5).max(24).required().messages({
    "number.min": "عدد الساعات يجب أن يكون 0.5 على الأقل",
    "number.max": "عدد الساعات يجب أن لا يتجاوز 24",
    "any.required": "عدد الساعات مطلوب",
  }),
  mode: Joi.string().valid("online", "offline").required().messages({ "any.only": "نمط التدريب يجب أن يكون online أو offline" }),
  // FIXED: FIX 3 — instructor is now optional
  instructorId: Joi.string().optional().allow("", null).messages({}),
  instructorName: Joi.string().trim().optional().allow("", null).messages({}),
  attendeesCount: Joi.number().integer().min(0).default(0),
  type: Joi.string().valid("Training", "Awareness Event", "Incubation", "Consultation").required().messages({ "any.only": "نوع الجلسة غير صالح" }),
  // FIXED: FIX 4 — both URL fields explicitly present and optional
  evaluationReportUrl: Joi.string().uri().optional().allow("", null).default(""),
  trainingReportUrl: Joi.string().uri().optional().allow("", null).default(""),
});

const importSessionSchema = sessionSchema.keys({
  instructorId: Joi.string().optional().allow("", null), // Will be auto-generated during import
});

// ─── LIST SESSIONS ────────────────────────────────────────────────────────────

export const listSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      fiscalYear,
      programName,
      instructorId,
      dateFrom,
      dateTo,
      mode,
      type,
      page = "1",
      limit = "50",
      sort = "newest",
    } = req.query;

    const query: Record<string, unknown> = {};
    if (fiscalYear) query.fiscalYear = fiscalYear;
    if (programName) query.programName = programName;
    if (instructorId) query.instructorId = instructorId;
    if (mode) query.mode = mode;
    if (type) query.type = type;
    if (dateFrom || dateTo) {
      const dateQ: Record<string, Date> = {};
      if (dateFrom) dateQ.$gte = new Date(dateFrom as string);
      if (dateTo) dateQ.$lte = new Date(dateTo as string);
      query.date = dateQ;
    }

    let sortObj: Record<string, 1 | -1> = { date: -1 };
    if (sort === "oldest") sortObj = { date: 1 };
    else if (sort === "name") sortObj = { sessionName: 1 };

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 500);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      TrainingSession.find(query).sort(sortObj).skip(skip).limit(limitNum).lean(),
      TrainingSession.countDocuments(query),
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

// ─── CREATE SESSION ───────────────────────────────────────────────────────────

export const createSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = sessionSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const errors = error.details.map((d) => ({ field: d.path.join("."), message: d.message }));
      res.status(400).json({ success: false, message: "بيانات غير صالحة", errors });
      return;
    }

    // Normalize empty instructorId to null (ObjectId can't cast "")
    if (!value.instructorId) value.instructorId = null;
    if (!value.instructorName) value.instructorName = "";

    const session = new TrainingSession({
      ...value,
      createdBy: req.user?.id,
      createdByName: req.user?.displayName,
    });

    await session.save();

    // Fire-and-forget rebuild
    rebuildAfterSessionChange(session.date, req.user?.displayName ?? "system").catch((err) =>
      console.error("[Hours] rebuildAfterSessionChange error:", err)
    );

    await AuditLog.create({
      action: "training_session_add",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: String(session._id),
      targetName: session.sessionName,
      details: `إضافة جلسة تدريبية: ${session.sessionName} (${session.programName}) بتاريخ ${session.date.toLocaleDateString("ar-EG")}`,
      ipAddress: getIp(req),
    });

    res.status(201).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE SESSION ───────────────────────────────────────────────────────────

export const updateSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { error, value } = sessionSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const errors = error.details.map((d) => ({ field: d.path.join("."), message: d.message }));
      res.status(400).json({ success: false, message: "بيانات غير صالحة", errors });
      return;
    }

    const existing = await TrainingSession.findById(id);
    if (!existing) {
      res.status(404).json({ success: false, message: "الجلسة غير موجودة" });
      return;
    }

    const oldDate = new Date(existing.date);
    const oldFiscalYear = existing.fiscalYear;

    // Normalize empty instructorId to null (ObjectId can't cast "")
    if (!value.instructorId) value.instructorId = null;
    if (!value.instructorName) value.instructorName = "";
    Object.assign(existing, value);
    existing.updatedBy = new Types.ObjectId(String(req.user?.id));
    await existing.save(); // pre-save hook recomputes computed fields

    const newFiscalYear = existing.fiscalYear;

    // Rebuild for old and new fiscal years (in case date crossed a boundary)
    const uniqueFYs = [...new Set([oldFiscalYear, newFiscalYear])];
    for (const fy of uniqueFYs) {
      rebuildTimetableSnapshot(fy, req.user?.displayName ?? "system").catch((err) =>
        console.error(`[Hours] rebuild error for ${fy}:`, err)
      );
    }

    await AuditLog.create({
      action: "training_session_update",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: String(id),
      targetName: existing.sessionName,
      details: `تعديل جلسة تدريبية: ${existing.sessionName}`,
      metadata: { oldFiscalYear, newFiscalYear },
      ipAddress: getIp(req),
    });

    res.status(200).json({ success: true, data: existing });
  } catch (error) {
    next(error);
  }
};

// ─── DELETE SESSION ───────────────────────────────────────────────────────────

export const deleteSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const session = await TrainingSession.findById(id);
    if (!session) {
      res.status(404).json({ success: false, message: "الجلسة غير موجودة" });
      return;
    }

    const { fiscalYear, date } = session;
    await session.deleteOne();

    // Fire-and-forget rebuild
    rebuildAfterSessionChange(date, req.user?.displayName ?? "system").catch((err) =>
      console.error(`[Hours] rebuild error after delete for ${fiscalYear}:`, err)
    );

    await AuditLog.create({
      action: "training_session_delete",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetId: String(id),
      targetName: session.sessionName,
      details: `حذف جلسة تدريبية: ${session.sessionName}`,
      ipAddress: getIp(req),
    });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const bulkDeleteSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, message: "يجب تحديد جلسات للحذف" });
      return;
    }

    const sessions = await TrainingSession.find({ _id: { $in: ids } });
    if (sessions.length === 0) {
      res.status(404).json({ success: false, message: "لم يتم العثور على الجلسات المحددة" });
      return;
    }

    const affectedFiscalYears = new Set<string>();
    sessions.forEach(s => affectedFiscalYears.add(s.fiscalYear));

    await TrainingSession.deleteMany({ _id: { $in: ids } });

    // Fire and forget rebuild
    for (const fy of affectedFiscalYears) {
      rebuildTimetableSnapshot(fy, req.user?.displayName ?? "system").catch(err => 
        console.error(`[Hours] bulk delete rebuild error for ${fy}:`, err)
      );
    }

    await AuditLog.create({
      action: "training_session_delete",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      details: `حذف جماعي لـ ${sessions.length} جلسات تدريبية`,
      ipAddress: getIp(req),
    });

    res.status(200).json({ success: true, message: "تم الحذف بنجاح", deletedCount: sessions.length });
  } catch (error) {
    next(error);
  }
};

// ─── INSTRUCTORS ──────────────────────────────────────────────────────────────

export const listInstructors = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { includeInactive } = req.query;
    const query = includeInactive === "true" ? {} : { isActive: true };
    const instructors = await Instructor.find(query).sort({ name: 1 }).lean();
    res.status(200).json({ success: true, data: instructors });
  } catch (error) {
    next(error);
  }
};

export const createInstructor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ success: false, message: "اسم المدرب مطلوب" });
      return;
    }

    const instructor = await Instructor.create({
      name: name.trim(),
      createdBy: req.user?.id,
    });

    res.status(201).json({ success: true, data: instructor });
  } catch (error: unknown) {
    const mongoErr = error as { code?: number };
    if (mongoErr.code === 11000) {
      res.status(409).json({ success: false, message: "اسم المدرب موجود بالفعل" });
      return;
    }
    next(error);
  }
};

export const deactivateInstructor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const instructor = await Instructor.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!instructor) {
      res.status(404).json({ success: false, message: "المدرب غير موجود" });
      return;
    }
    res.status(200).json({ success: true, data: instructor });
  } catch (error) {
    next(error);
  }
};

// ─── TIMETABLE ────────────────────────────────────────────────────────────────

export const getTimetable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { fiscalYear } = req.params;

    let snapshot = await TimetableSnapshot.findOne({ fiscalYear }).lean();

    if (!snapshot) {
      // Build on demand
      console.log(`[Hours] Snapshot not found for ${fiscalYear}, building...`);
      await rebuildTimetableSnapshot(String(fiscalYear), "system");
      snapshot = await TimetableSnapshot.findOne({ fiscalYear }).lean();
    }

    if (!snapshot) {
      res.status(404).json({ success: false, message: `لا يوجد بيانات للسنة المالية ${fiscalYear}` });
      return;
    }

    res.status(200).json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
};

export const listFiscalYears = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const fiscalYears = await TrainingSession.distinct("fiscalYear");
    fiscalYears.sort((a, b) => b.localeCompare(a)); // descending
    res.status(200).json({ success: true, data: fiscalYears });
  } catch (error) {
    next(error);
  }
};

export const forceRebuild = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { fiscalYear } = req.params;
    await rebuildTimetableSnapshot(String(fiscalYear), req.user?.displayName ?? "admin");

    await AuditLog.create({
      action: "timetable_rebuild",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      details: `إعادة بناء الجدول الزمني للسنة المالية ${fiscalYear}`,
      metadata: { fiscalYear },
      ipAddress: getIp(req),
    });

    res.status(200).json({ success: true, message: `تم إعادة بناء الجدول الزمني لـ ${fiscalYear}` });
  } catch (error) {
    next(error);
  }
};

// ─── IMPORT FROM EXCEL ────────────────────────────────────────────────────────

interface ImportedRow {
  sourceRow: number;
  programName: ProgramName;
  sessionName: string;
  date: Date;
  hours: number;
  mode: "online" | "offline";
  instructorId: string | null;
  instructorName: string;
  attendeesCount: number;
  type: "Training" | "Awareness Event" | "Incubation" | "Consultation";
  evaluationReportUrl: string;
  trainingReportUrl: string;
  createdBy: Types.ObjectId;
  createdByName: string;
}

interface ErrorRow {
  row: number;
  data: Record<string, unknown>;
  errors: string[];
}

export const importSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "ملف Excel مطلوب" });
      return;
    }

    const consultationsMapStr = req.body.consultationsMap;
    const consultationsMap: Record<number, string> = consultationsMapStr ? JSON.parse(consultationsMapStr) : {};

    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true, cellHTML: false, cellFormula: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // ── Step 1: Find the header row by scanning the first 5 rows ────────────
    const sheetRange = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
    
    // All possible column aliases (flat list, lower-cased, for header detection)
    const COLUMN_ALIASES: Record<string, string[]> = {
      programName: ["program name", "program"],
      sessionName: ["session name", "session"],
      date: ["date"],
      hours: ["no. of hrs", "no. of hrs.", "hours", "no. of hours"],
      mode: ["online/offline", "online/offlin"],
      instructorName: ["instructor"],
      attendeesCount: ["no. of attendees", "no. of attendants"],
      type: ["type"],
      evaluationReportUrl: [
        "evaluation report url", 
        "تقرير التقييم", 
        "تقرير التقيم", 
        "تقرير التقديم"
      ],
      trainingReportUrl: [
        "training report url",
        "تقرير التدريب و الاستشارات",
        "تقرير التدريب والاستشارات",
        "لينك تقرير البرنامج التدريبي (1)",
        "لينك تقرير البرنامج التدريبي",
      ],
    };

    const allAliasesFlat = new Set(Object.values(COLUMN_ALIASES).flat().map(a => a.trim().toLowerCase()));

    // Scan up to first 5 rows to find which row has the most matching aliases
    let headerRowIndex = -1;
    let bestMatchCount = 0;
    for (let r = sheetRange.s.r; r <= Math.min(sheetRange.s.r + 4, sheetRange.e.r); r++) {
      let matchCount = 0;
      for (let c = sheetRange.s.c; c <= sheetRange.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v && allAliasesFlat.has(String(cell.v).trim().toLowerCase())) {
          matchCount++;
        }
      }
      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        headerRowIndex = r;
      }
    }

    if (headerRowIndex === -1) {
      res.status(400).json({ success: false, message: "لا يمكن إيجاد صف العناوين في الملف" });
      return;
    }

    // ── Step 2: Build column map from header row ─────────────────────────────
    // Maps lowercased header text → column index (0-based)
    const headerToColIndex: Record<string, number> = {};
    for (let c = sheetRange.s.c; c <= sheetRange.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: headerRowIndex, c })];
      if (cell && cell.v) {
        headerToColIndex[String(cell.v).trim().toLowerCase()] = c;
      }
    }

    // ── Step 3: Helper to get cell address from field for a given data row ───
    const getFieldColIndex = (field: string): number => {
      for (const alias of COLUMN_ALIASES[field] || []) {
        const idx = headerToColIndex[alias.trim().toLowerCase()];
        if (idx !== undefined) return idx;
      }
      return -1;
    };

    // ── Step 4: Helper to get value from a cell, preferring hyperlink target for URL fields
    const getCellValue = (rowIdx: number, colIdx: number, isUrlField: boolean): unknown => {
      if (colIdx < 0) return "";
      const addr = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
      const cell = sheet[addr];
      if (!cell) return "";

      if (isUrlField) {
        // 1. Relationship-based hyperlink (standard .xlsx links)
        if (cell.l && cell.l.Target) {
          return cell.l.Target;
        }
        // 2. Formula-based hyperlink: =HYPERLINK("url","display text") — common in Google Sheets exports
        if (cell.f) {
          const match = String(cell.f).match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
          if (match) return match[1];
        }
        // 3. Cell value is already a direct URL
        const directVal = String(cell.v ?? "").trim();
        if (directVal.startsWith("http")) return directVal;
        // None of the above — not a valid URL
        return "";
      }

      return cell.v ?? "";
    };

    // ── Step 5: Pre-compute column indices for each field ───────────────────
    const fieldColMap: Record<string, number> = {};
    for (const field of Object.keys(COLUMN_ALIASES)) {
      fieldColMap[field] = getFieldColIndex(field);
    }

    const urlFields = new Set(["evaluationReportUrl", "trainingReportUrl"]);

    // ── Step 6: Parse data rows ──────────────────────────────────────────────
    const firstDataRow = headerRowIndex + 1;

    // Log for debugging
    console.log("Header row index:", headerRowIndex, "Headers found:", headerToColIndex);
    
    // Dump the raw cell for URL columns in the first data row
    const evalColIdx = fieldColMap["evaluationReportUrl"];
    const trainColIdx = fieldColMap["trainingReportUrl"];
    const firstDataRowForDebug = headerRowIndex + 1;
    if (evalColIdx >= 0) {
      const addr = XLSX.utils.encode_cell({ r: firstDataRowForDebug, c: evalColIdx });
      const cell = sheet[addr];
      console.log("[DEBUG] evaluationReportUrl cell @", addr, JSON.stringify(cell));
    }
    if (trainColIdx >= 0) {
      const addr = XLSX.utils.encode_cell({ r: firstDataRowForDebug, c: trainColIdx });
      const cell = sheet[addr];
      console.log("[DEBUG] trainingReportUrl cell @", addr, JSON.stringify(cell));
    }



    // Pre-load instructors to resolve name → id
    const instructors = await Instructor.find({ isActive: true }).lean();
    const instructorMap = new Map(instructors.map((i) => [i.name.trim().toLowerCase(), i]));

    const validRows: ImportedRow[] = [];
    const errorRows: ErrorRow[] = [];
    const affectedFiscalYears = new Set<string>();


    for (let rowIdx = firstDataRow; rowIdx <= sheetRange.e.r; rowIdx++) {
      const rowNum = rowIdx + 1; // 1-based for display

      // Build normalized from direct cell access
      const normalized: Record<string, unknown> = {};
      let hasAnyValue = false;
      for (const field of Object.keys(COLUMN_ALIASES)) {
        const colIdx = fieldColMap[field];
        const isUrlField = urlFields.has(field);
        const val = getCellValue(rowIdx, colIdx, isUrlField);
        normalized[field] = val;
        if (val !== "" && val !== undefined && val !== null) hasAnyValue = true;
      }

      // Skip completely empty rows
      if (!hasAnyValue) continue;

      // Apply consultation overrides if any
      if (consultationsMap[rowIdx]) {
        normalized.programName = consultationsMap[rowIdx];
        normalized.type = "Consultation";
      }

      // getCellValue already handles all URL extraction (cell.l, HYPERLINK formula, direct URL)
      // Nothing to do here — all URL fields are already correctly set above

      // Normalize Date to strict UTC midnight (fixes Localhost vs Vercel timezone drift)
      if (normalized.date instanceof Date) {
        normalized.date = new Date(Date.UTC(
          normalized.date.getFullYear(),
          normalized.date.getMonth(),
          normalized.date.getDate()
        ));
      } else if (typeof normalized.date === "string" && normalized.date.trim() !== "") {
        const parsed = new Date(normalized.date);
        if (!isNaN(parsed.getTime())) {
          normalized.date = new Date(Date.UTC(
            parsed.getFullYear(),
            parsed.getMonth(),
            parsed.getDate()
          ));
        }
      }

      // Handle custom program names (e.g. Awareness event participant)
      let progName = String(normalized.programName ?? "").trim();
      if (progName.toLowerCase().includes("awareness event")) {
        progName = "Awareness event";
      } else if (progName.toLowerCase().includes("accelerated entrepreneur")) {
        progName = "Acceleration program";
      } else if (
        progName.toLowerCase().includes("hackathon") ||
        progName.toLowerCase().includes("competition")
      ) {
        progName = "Hackathons / Competitions";
      }
      normalized.programName = progName;

      // Normalize Type
      let sessionType = String(normalized.type ?? "").trim();
      if (
        sessionType.toLowerCase().includes("awar") ||
        sessionType.toLowerCase().includes("awern") ||
        progName === "Awareness event"
      ) {
        sessionType = "Awareness Event";
      } else if (
        sessionType.toLowerCase().includes("train") ||
        sessionType.toLowerCase().includes("hackathon") ||
        sessionType.toLowerCase().includes("competition") ||
        progName === "Hackathons / Competitions"
      ) {
        sessionType = "Training";
      } else if (sessionType.toLowerCase().includes("consult") || progName.toLowerCase().includes("consult") || sessionType.includes("استشارة") || progName.includes("استشارة")) {
        sessionType = "Consultation";
      } else if (sessionType.toLowerCase().includes("incub") || progName === "Incubation") {
        sessionType = "Incubation";
      }
      normalized.type = sessionType;

      // Normalize sessionName
      if (!normalized.sessionName || String(normalized.sessionName).trim() === "") {
        normalized.sessionName = "غير محدد"; // Default if missing
      }

      // Normalize mode
      const modeRaw = String(normalized.mode ?? "").toLowerCase().trim();
      if (modeRaw === "online") normalized.mode = "online";
      else if (modeRaw === "offline") normalized.mode = "offline";

      // Normalize hours
      if (normalized.hours !== undefined && normalized.hours !== "") {
        let hrsVal = normalized.hours as any;
        if (hrsVal instanceof Date) {
          // Note: SheetJS creates Dates where the *local* time matches the Excel cell.
          // Because Excel epoch is 1899, LMT timezone offsets (like +02:05:09) cause getUTCHours to be completely wrong!
          // We MUST use the local getHours() and getMinutes().
          normalized.hours = hrsVal.getHours() + hrsVal.getMinutes() / 60;
        } else if (typeof hrsVal === "number" && hrsVal > 0 && hrsVal < 1) {
          // If Excel parsed it as a time fraction (fraction of 24h day)
          normalized.hours = hrsVal * 24;
        } else {
          const strVal = String(hrsVal).trim();
          if (strVal.includes(":")) {
            const timeMatch = strVal.match(/(\d+):(\d+)/);
            if (timeMatch) {
              const parsedH = parseInt(timeMatch[1], 10) || 0;
              const parsedM = parseInt(timeMatch[2], 10) || 0;
              normalized.hours = parsedH + parsedM / 60;
            } else {
              normalized.hours = parseFloat(strVal) || 0;
            }
          } else {
            normalized.hours = parseFloat(strVal) || 0;
          }
        }
      }
      // Normalize attendees
      if (normalized.attendeesCount !== undefined && normalized.attendeesCount !== "") {
        normalized.attendeesCount = parseInt(String(normalized.attendeesCount), 10) || 0;
      } else {
        normalized.attendeesCount = 0;
      }

      // Validate using the import schema which allows missing instructorId
      const { error, value } = importSessionSchema.validate(normalized, { abortEarly: false });
      if (error) {
        errorRows.push({
          row: rowNum,
          data: normalized,
          errors: error.details.map((d) => d.message),
        });
        continue;
      }

      // Debug: log URLs in first valid row
      if (validRows.length === 0) {
        console.log("[DEBUG] First valid row URLs:", {
          evaluationReportUrl: value.evaluationReportUrl,
          trainingReportUrl: value.trainingReportUrl,
          normalizedEval: normalized.evaluationReportUrl,
          normalizedTrain: normalized.trainingReportUrl,
        });
      }

      // Resolve instructor
      const instrNameRaw = String(value.instructorName ?? "").trim();
      let instructorId: string | null = null;
      if (instrNameRaw !== "") {
        const instructorLookup = instructorMap.get(instrNameRaw.toLowerCase());
        if (instructorLookup) {
          instructorId = String(instructorLookup._id);
        } else {
          // Create instructor on-the-fly
          const newInstructor = await Instructor.create({
            name: instrNameRaw,
            createdBy: req.user?.id,
          });
          instructorMap.set(instrNameRaw.toLowerCase(), newInstructor);
          instructorId = String(newInstructor._id);
        }
      }

      const fiscalYear = getFiscalYear(new Date(value.date));
      affectedFiscalYears.add(fiscalYear);

      validRows.push({
        ...value,
        sourceRow: rowNum,
        instructorId,
        createdBy: new Types.ObjectId(String(req.user?.id)),
        createdByName: req.user?.displayName ?? "",
        instructorName: instrNameRaw,
      });
    }

    // Bulk insert (or update existing)
    let importedCount = 0;
    let updatedCount = 0;
    const updatedDetails: Array<{
      row: number;
      sessionName: string;
      date: string;
      instructorName: string;
      changes: Array<{ field: string; old: any; new: any }>;
    }> = [];

    const unchangedDuplicates: Array<{
      row: number;
      sessionName: string;
      date: string;
      instructorName: string;
    }> = [];

    if (validRows.length > 0) {
      // Find existing sessions to update instead of failing as duplicates
      const existingSessions = await TrainingSession.find({
        $or: validRows.map((r) => ({
          sessionName: r.sessionName,
          date: new Date(r.date),
          instructorId: r.instructorId ? new Types.ObjectId(String(r.instructorId)) : null,
        })),
      });

      const existingMap = new Map<string, any>();
      for (const s of existingSessions) {
        const key = `${String(s.sessionName).trim().toLowerCase()}_${
          new Date(s.date).toISOString().split("T")[0]
        }_${s.instructorId ? String(s.instructorId) : "null"}`;
        existingMap.set(key, s);
      }

      const bulkOps: any[] = [];
      const newRowsToInsert: any[] = [];

      for (const r of validRows) {
        const key = `${String(r.sessionName).trim().toLowerCase()}_${
          new Date(r.date).toISOString().split("T")[0]
        }_${r.instructorId ? String(r.instructorId) : "null"}`;

        const existingDoc = existingMap.get(key);
        if (existingDoc) {
          const updateFields: Record<string, any> = {};
          const changes: Array<{ field: string; old: any; new: any }> = [];

          if (r.programName && r.programName !== existingDoc.programName) {
            updateFields.programName = r.programName;
            updateFields.timetableProgram = mapProgramToTimetableRow(r.programName);
            changes.push({ field: "programName", old: existingDoc.programName, new: r.programName });
          }
          if (r.hours !== undefined && r.hours !== existingDoc.hours) {
            updateFields.hours = r.hours;
            updateFields.dayValue = r.hours < 5 ? 0.5 : 1.0;
            changes.push({ field: "hours", old: existingDoc.hours, new: r.hours });
          }
          if (r.mode && r.mode !== existingDoc.mode) {
            updateFields.mode = r.mode;
            changes.push({ field: "mode", old: existingDoc.mode, new: r.mode });
          }
          if (r.attendeesCount !== undefined && r.attendeesCount !== existingDoc.attendeesCount) {
            updateFields.attendeesCount = r.attendeesCount;
            changes.push({ field: "attendeesCount", old: existingDoc.attendeesCount, new: r.attendeesCount });
          }
          if (r.type && r.type !== existingDoc.type) {
            updateFields.type = r.type;
            changes.push({ field: "type", old: existingDoc.type, new: r.type });
          }
          if (r.evaluationReportUrl !== undefined && r.evaluationReportUrl !== existingDoc.evaluationReportUrl) {
            updateFields.evaluationReportUrl = r.evaluationReportUrl;
            changes.push({ field: "evaluationReportUrl", old: existingDoc.evaluationReportUrl, new: r.evaluationReportUrl });
          }
          if (r.trainingReportUrl !== undefined && r.trainingReportUrl !== existingDoc.trainingReportUrl) {
            updateFields.trainingReportUrl = r.trainingReportUrl;
            changes.push({ field: "trainingReportUrl", old: existingDoc.trainingReportUrl, new: r.trainingReportUrl });
          }

          if (changes.length > 0) {
            updateFields.updatedBy = new Types.ObjectId(String(req.user?.id));
            bulkOps.push({
              updateOne: {
                filter: { _id: existingDoc._id },
                update: { $set: updateFields },
              },
            });
            updatedCount++;
            updatedDetails.push({
              row: r.sourceRow,
              sessionName: r.sessionName,
              date: r.date.toISOString(),
              instructorName: r.instructorName || "بدون مدرب",
              changes,
            });
          } else {
            unchangedDuplicates.push({
              row: r.sourceRow,
              sessionName: r.sessionName,
              date: r.date.toISOString(),
              instructorName: r.instructorName || "بدون مدرب",
            });
          }
        } else {
          newRowsToInsert.push(r);
        }
      }

      if (bulkOps.length > 0) {
        await TrainingSession.bulkWrite(bulkOps);
      }

      if (newRowsToInsert.length > 0) {
        const enriched = newRowsToInsert.map((r) => ({
          ...r,
          instructorId: r.instructorId ? new Types.ObjectId(String(r.instructorId)) : null,
          dayValue: r.hours < 5 ? 0.5 : 1.0,
          timetableProgram: mapProgramToTimetableRow(r.programName),
          fiscalYear: getFiscalYear(new Date(r.date)),
        }));

        await TrainingSession.insertMany(enriched, { ordered: false });
        importedCount = newRowsToInsert.length;
      }

      // ── Auto-sync specializations for all valid sessions ──────────────
      const SPECIALIZATION_EXCLUDED = [
        "Hackathons / Competitions",
        "Consultation & Mentorship",
        "Awareness event",
      ];
      await Promise.all(
        validRows
          .filter(
            (row) =>
              row.instructorId &&
              row.programName &&
              !SPECIALIZATION_EXCLUDED.includes(row.programName)
          )
          .map((row) =>
            Instructor.findByIdAndUpdate(
              row.instructorId,
              { $addToSet: { specializations: row.programName } },
              { new: false }
            ).catch((err: unknown) =>
              console.error(
                "[Hours] specialization sync error for instructor",
                row.instructorId,
                err
              )
            )
          )
      );
    }

    // Rebuild all affected fiscal years (fire-and-forget)
    for (const fy of affectedFiscalYears) {
      rebuildTimetableSnapshot(fy, req.user?.displayName ?? "system").catch((err) =>
        console.error(`[Hours] import rebuild error for ${fy}:`, err)
      );
    }

    await AuditLog.create({
      action: "training_session_import",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      details: `استيراد ${importedCount} جلسات جديدة وتحديث ${updatedCount} جلسات، تجاهل ${errorRows.length} سجل`,
      metadata: { importedCount, updatedCount, skippedCount: errorRows.length, affectedFiscalYears: [...affectedFiscalYears] },
      ipAddress: getIp(req),
    });

    res.status(200).json({
      success: true,
      imported: importedCount,
      updated: updatedCount,
      skipped: errorRows.length,
      errors: errorRows,
      updatedDetails,
      unchangedDuplicates,
    });
  } catch (error) {
    next(error);
  }
};

// ─── EXCEL EXPORTS ────────────────────────────────────────────────────────────

export const downloadHoursTracking = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { fiscalYear } = req.query;
    const fy = typeof fiscalYear === 'string' ? fiscalYear : getFiscalYear(new Date());
    const buf = await exportHoursTracking(fy);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="HoursTracking_${fy}.xlsx"`);
    res.status(200).send(buf);
  } catch (error) {
    next(error);
  }
};

export const downloadTimetable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { fiscalYear } = req.query;
    const fy = typeof fiscalYear === 'string' ? fiscalYear : getFiscalYear(new Date());
    const buf = await exportTimetable(fy);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Timetable_${fy}.xlsx"`);
    res.status(200).send(buf);
  } catch (error) {
    next(error);
  }
};

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────────

export const getDashboardStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { fiscalYear: fyQuery, quarter: qQuery } = req.query;
    const fiscalYear = typeof fyQuery === "string" && fyQuery ? fyQuery : getFiscalYear(new Date());
    const quarter = typeof qQuery === "string" ? qQuery : "all";

    const baseMatch: Record<string, any> = {};
    
    if (fiscalYear !== "all") {
      baseMatch.fiscalYear = fiscalYear;
    }

    if (quarter !== "all") {
      const qMap: Record<string, number[]> = {
        "Q1": [5, 6, 7],
        "Q2": [8, 9, 10],
        "Q3": [11, 12, 1],
        "Q4": [2, 3, 4]
      };
      const allowedMonths = qMap[quarter];
      if (allowedMonths) {
        baseMatch.$expr = { $in: [{ $month: "$date" }, allowedMonths] };
      }
    }

    // 1. Overall stats
    const overallStats = await TrainingSession.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalTrainingDays: { $sum: "$dayValue" },
          totalSessions: { $sum: 1 },
          totalAttendees: { $sum: "$attendeesCount" },
          totalHours: { $sum: "$hours" },
        },
      },
    ]);

    const stats = overallStats[0] || {
      totalTrainingDays: 0,
      totalSessions: 0,
      totalAttendees: 0,
      totalHours: 0,
    };

    // 2. Program Performance
    const programDaysRaw = await TrainingSession.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            $cond: {
              if: { $eq: ["$type", "Consultation"] },
              then: "Consultation",
              else: {
                $cond: {
                  if: { $eq: ["$programName", "Incubation"] },
                  then: "Incubation",
                  else: "$timetableProgram",
                },
              },
            },
          },
          totalDays: { $sum: "$dayValue" },
          sessionCount: { $sum: 1 },
          attendeesCount: { $sum: "$attendeesCount" },
          totalHours: { $sum: "$hours" },
        },
      },
      { $sort: { totalDays: -1 } },
    ]);
    const programDays = programDaysRaw.map((p) => ({
      program: String(p._id),
      totalDays: p.totalDays,
      sessionCount: p.sessionCount,
      attendeesCount: p.attendeesCount,
      totalHours: p.totalHours,
    }));

    // 3. Monthly Activity
    const monthlyActivityRaw = await TrainingSession.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            year: { $year: "$date" },
            month: { $month: "$date" },
          },
          sessions: { $sum: 1 },
          days: { $sum: "$dayValue" },
          attendees: { $sum: "$attendeesCount" },
          hours: { $sum: "$hours" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    const monthNamesArabic = [
      "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
      "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
    ];

    const monthlyActivity = monthlyActivityRaw.map((m) => ({
      month: `${monthNamesArabic[m._id.month - 1]} ${m._id.year}`,
      monthIndex: m._id.year * 100 + m._id.month,
      sessions: m.sessions,
      days: m.days,
      attendees: m.attendees,
      hours: m.hours,
    }));
    
    // Daily Activity (for time range control frontend calculation)
    const dailyActivityRaw = await TrainingSession.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          sessions: { $sum: 1 },
          days: { $sum: "$dayValue" },
          attendees: { $sum: "$attendeesCount" },
          hours: { $sum: "$hours" },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const dailyActivity = dailyActivityRaw.map((d) => ({
      date: String(d._id),
      sessions: d.sessions,
      days: d.days,
      attendees: d.attendees,
      hours: d.hours,
    }));

    // 4. Mode Breakdown
    const modeRaw = await TrainingSession.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: "$mode",
          count: { $sum: 1 },
        },
      },
    ]);
    let online = 0, offline = 0;
    modeRaw.forEach((m) => {
      if (m._id === "online") online = m.count;
      if (m._id === "offline") offline = m.count;
    });
    const totalMode = online + offline;
    const modeBreakdown = {
      online,
      offline,
      onlinePct: totalMode ? Number(((online / totalMode) * 100).toFixed(1)) : 0,
      offlinePct: totalMode ? Number(((offline / totalMode) * 100).toFixed(1)) : 0,
    };

    // 5. Top Instructors
    const topInstructorsRaw = await TrainingSession.aggregate([
      { $match: { ...baseMatch, instructorName: { $ne: "" }, instructorId: { $ne: null } } },
      {
        $group: {
          _id: "$instructorName",
          sessions: { $sum: 1 },
          totalHours: { $sum: "$hours" },
          totalAttendees: { $sum: "$attendeesCount" },
        },
      },
      { $sort: { sessions: -1 } },
      { $limit: 5 },
    ]);
    const topInstructors = topInstructorsRaw.map((t) => ({
      name: String(t._id),
      sessions: t.sessions,
      totalHours: t.totalHours,
      totalAttendees: t.totalAttendees,
    }));

    // 6. Type Breakdown
    const typeRaw = await TrainingSession.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } }
    ]);
    const totalTypes = typeRaw.reduce((sum, t) => sum + t.count, 0);
    const typeBreakdown = typeRaw.map((t) => ({
      type: String(t._id),
      count: t.count,
      pct: totalTypes ? Number(((t.count / totalTypes) * 100).toFixed(1)) : 0,
    }));

    // 7. Warning Stats
    const totalWarnings = await BlacklistEntry.countDocuments({ status: "warning" });
    
    const warning1 = await BlacklistEntry.countDocuments({ 
      status: "warning", 
      $expr: { $eq: [{ $size: "$absences" }, 1] } 
    });
    
    const warning2 = await BlacklistEntry.countDocuments({ 
      status: "warning", 
      $expr: { $gte: [{ $size: "$absences" }, 2] } 
    });

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const startOfMonth = new Date(currentYear, currentMonth, 1);
    
    const blacklistedThisMonth = await BlacklistEntry.countDocuments({
      status: "blacklisted",
      addedAt: { $gte: startOfMonth }
    });

    const warningStats = {
      total: totalWarnings,
      warning1,
      warning2,
      blacklistedThisMonth,
      clearedThisMonth: 0, // Placeholder
    };

    res.status(200).json({
      fiscalYear,
      ...stats,
      programDays,
      monthlyActivity,
      dailyActivity,
      modeBreakdown,
      topInstructors,
      typeBreakdown,
      warningStats,
      attendanceRate: [],
    });
  } catch (error) {
    next(error);
  }
};
