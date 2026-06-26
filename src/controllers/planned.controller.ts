import { Request, Response } from "express";
import { PlannedTimetable } from "../models/PlannedTimetable";
import { User } from "../models/User";
import { TIMETABLE_PROGRAMS } from "../models/TrainingSession";
import { computeComparison } from "../services/timetableComparison";
import { exportPlannedTimetable } from "../services/plannedExcelExporter";

// ─── Allowed cell values ──────────────────────────────────────────────────────
const VALID_CELL_VALUES = [0, 0.5, 1] as const;
type CellValue = (typeof VALID_CELL_VALUES)[number];

function isValidCellValue(v: unknown): v is CellValue {
  return v === 0 || v === 0.5 || v === 1;
}

// ─── Helper: recompute totals after a direct $set update ─────────────────────
async function recomputeAndSave(fiscalYear: string): Promise<void> {
  const doc = await PlannedTimetable.findOne({ fiscalYear });
  if (!doc) return;
  // Trigger pre-save hook which recomputes programTotals + grandTotal
  await doc.save();
}

// ─── GET /api/planned ─────────────────────────────────────────────────────────
/**
 * List all fiscal years that have a PlannedTimetable document.
 * Returns string[] sorted descending.
 */
export async function listPlannedFiscalYears(req: Request, res: Response): Promise<void> {
  try {
    const docs = await PlannedTimetable.find({}, { fiscalYear: 1, _id: 0 }).lean();
    const years = docs
      .map((d) => d.fiscalYear)
      .sort()
      .reverse();
    res.json({ success: true, data: years });
  } catch (err) {
    console.error("[planned] listPlannedFiscalYears error:", err);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب السنوات المالية" });
  }
}

// ─── GET /api/planned/:fiscalYear ─────────────────────────────────────────────
/**
 * Returns the PlannedTimetable for a fiscal year.
 * If not found returns an empty structure (NOT 404).
 */
export async function getPlannedTimetable(req: Request, res: Response): Promise<void> {
  try {
    const fiscalYear = req.params.fiscalYear as string;
    let doc = await PlannedTimetable.findOne({ fiscalYear }).lean();

    if (!doc) {
      // Return empty structure without persisting it
      const empty = PlannedTimetable.createEmpty(fiscalYear);
      res.json({ success: true, data: empty, exists: false });
      return;
    }

    res.json({ success: true, data: doc, exists: true });
  } catch (err) {
    console.error("[planned] getPlannedTimetable error:", err);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب الجدول المخطط" });
  }
}

// ─── PUT /api/planned/:fiscalYear ─────────────────────────────────────────────
/**
 * Upsert a full PlannedTimetable document.
 * Body: { data: { [program]: { [monthIndex]: { [day]: value } } } }
 */
export async function upsertPlannedTimetable(req: Request, res: Response): Promise<void> {
  try {
    const fiscalYear = req.params.fiscalYear as string;
    const { data } = req.body as { data?: unknown };

    if (!data || typeof data !== "object") {
      res.status(400).json({ success: false, message: "حقل data مطلوب ويجب أن يكون كائناً" });
      return;
    }

    const userId = req.user?.id?.toString() ?? "unknown";
    const displayName = req.user?.displayName ?? "Unknown";

    // Find or create
    let doc = await PlannedTimetable.findOne({ fiscalYear });
    if (!doc) {
      doc = new PlannedTimetable({ fiscalYear });
    }

    doc.data = data as typeof doc.data;
    doc.lastEditedBy = userId;
    doc.lastEditedByName = displayName;

    // pre-save hook recomputes totals
    await doc.save();

    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("[planned] upsertPlannedTimetable error:", err);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء حفظ الجدول المخطط" });
  }
}

// ─── PATCH /api/planned/:fiscalYear/cell ─────────────────────────────────────
/**
 * Update a single cell using MongoDB $set with dot notation.
 * Body: { program, monthIndex, day, value }
 * value must be 0 | 0.5 | 1
 */
export async function updatePlannedCell(req: Request, res: Response): Promise<void> {
  try {
    const fiscalYear = req.params.fiscalYear as string;
    const { program, monthIndex, day, value } = req.body as {
      program?: string;
      monthIndex?: unknown;
      day?: unknown;
      value?: unknown;
    };

    // Validate program
    if (!program || !TIMETABLE_PROGRAMS.includes(program as never)) {
      res.status(400).json({ success: false, message: "برنامج غير صالح" });
      return;
    }

    // Validate monthIndex (calendar month 0-11)
    const monthNum = Number(monthIndex);
    if (!Number.isInteger(monthNum) || monthNum < 0 || monthNum > 11) {
      res.status(400).json({ success: false, message: "رقم الشهر غير صالح (0-11)" });
      return;
    }

    // Validate day (1-31) or "consultations"
    const isConsultationsCell = day === "consultations";
    if (!isConsultationsCell) {
      const dayNum = Number(day);
      if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
        res.status(400).json({ success: false, message: "رقم اليوم غير صالح (1-31)" });
        return;
      }
    }

    // Validate value
    if (isConsultationsCell) {
      const valNum = Number(value);
      if (isNaN(valNum) || valNum < 0 || valNum > 20 || (valNum * 2) % 1 !== 0) {
        res.status(400).json({ success: false, message: "القيمة غير صالحة للاستشارات (0-20 بزيادة 0.5)" });
        return;
      }
    } else {
      if (!isValidCellValue(value)) {
        res.status(400).json({ success: false, message: "القيمة يجب أن تكون 0 أو 0.5 أو 1" });
        return;
      }
    }

    const userId = req.user?.id?.toString() ?? "unknown";
    const displayName = req.user?.displayName ?? "Unknown";

    // PERFORMANCE: update only the specific cell using dot notation
    const cellPath = `data.${program}.${monthNum}.${day}`;

    await PlannedTimetable.findOneAndUpdate(
      { fiscalYear },
      {
        $set: {
          [cellPath]: value,
          lastEditedBy: userId,
          lastEditedByName: displayName,
        },
      },
      { upsert: true, new: true }
    );

    // Recompute totals (triggers pre-save hook)
    await recomputeAndSave(fiscalYear);

    const updated = await PlannedTimetable.findOne({ fiscalYear }).lean();
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[planned] updatePlannedCell error:", err);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء تحديث الخلية" });
  }
}

// ─── GET /api/planned/:fiscalYear/comparison ─────────────────────────────────
/**
 * Returns the TimetableComparison object for a fiscal year.
 */
export async function getPlannedComparison(req: Request, res: Response): Promise<void> {
  try {
    const fiscalYear = req.params.fiscalYear as string;
    const comparison = await computeComparison(fiscalYear);
    res.json({ success: true, data: comparison });
  } catch (err) {
    console.error("[planned] getPlannedComparison error:", err);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء حساب المقارنة" });
  }
}

// ─── GET /api/planned/:fiscalYear/export ─────────────────────────────────────
/**
 * Returns an Excel buffer with 3 sheets: Percentage, Difference Calendar, Planned Calendar.
 */
export async function downloadPlannedExport(req: Request, res: Response): Promise<void> {
  try {
    const fiscalYear = req.params.fiscalYear as string;
    const buffer = await exportPlannedTimetable(fiscalYear);

    const safeYear = fiscalYear.replace(/[^a-zA-Z0-9_-]/g, "");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="PlannedTimetable_${safeYear}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error("[planned] downloadPlannedExport error:", err);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء تصدير الملف" });
  }
}
// ─── POST /api/planned/:targetFY/copy-from/:sourceFY ─────────────────────────
/**
 * Copy a plan from sourceFY to targetFY.
 * If targetFY already has a plan, the request body must include the user's password.
 * The password is verified using bcrypt before overwriting.
 */
export async function copyPlannedTimetable(req: Request, res: Response): Promise<void> {
  try {
    const { targetFY, sourceFY } = req.params as { targetFY: string; sourceFY: string };
    const { password } = req.body as { password?: string };

    // Check if source exists
    const sourceDoc = await PlannedTimetable.findOne({ fiscalYear: sourceFY }).lean();
    if (!sourceDoc) {
      res.status(404).json({ success: false, message: "السنة المالية المصدر غير موجودة" });
      return;
    }

    // Check if target already has a plan
    const existingTarget = await PlannedTimetable.findOne({ fiscalYear: targetFY }).lean();
    if (existingTarget) {
      // Password required to overwrite
      if (!password) {
        res.status(403).json({ success: false, message: "كلمة المرور مطلوبة لاستبدال خطة موجودة" });
        return;
      }
      // Verify password
      const userId = req.user?.id?.toString();
      const userDoc = await User.findById(userId).select("+password");
      if (!userDoc) {
        res.status(401).json({ success: false, message: "المستخدم غير موجود" });
        return;
      }
      const passwordMatch = await userDoc.comparePassword(password);
      if (!passwordMatch) {
        res.status(401).json({ success: false, message: "كلمة المرور غير صحيحة" });
        return;
      }
    }

    const userId = req.user?.id?.toString() ?? "unknown";
    const displayName = req.user?.displayName ?? "Unknown";

    // Perform the copy — upsert target with source data
    let targetDoc = await PlannedTimetable.findOne({ fiscalYear: targetFY });
    if (!targetDoc) {
      targetDoc = new PlannedTimetable({ fiscalYear: targetFY });
    }
    targetDoc.data = sourceDoc.data as typeof targetDoc.data;
    targetDoc.lastEditedBy = userId;
    targetDoc.lastEditedByName = displayName;
    await targetDoc.save(); // pre-save hook recomputes totals

    const saved = await PlannedTimetable.findOne({ fiscalYear: targetFY }).lean();
    res.json({ success: true, data: saved });
  } catch (err) {
    console.error("[planned] copyPlannedTimetable error:", err);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء نسخ الخطة" });
  }
}

// ─── PATCH /api/planned/:fiscalYear/reset-month ───────────────────────────────
/**
 * Zero out all cells for a specific calendar month across all programs.
 * Password required — verified via bcrypt before any mutation.
 */
export async function resetPlannedMonth(req: Request, res: Response): Promise<void> {
  try {
    const fiscalYear = req.params.fiscalYear as string;
    const { monthIndex, password } = req.body as { monthIndex?: unknown; password?: string };

    // Validate monthIndex
    const monthNum = Number(monthIndex);
    if (!Number.isInteger(monthNum) || monthNum < 0 || monthNum > 11) {
      res.status(400).json({ success: false, message: "رقم الشهر غير صالح (0-11)" });
      return;
    }

    // Password always required for reset
    if (!password) {
      res.status(403).json({ success: false, message: "كلمة المرور مطلوبة" });
      return;
    }

    // Verify password
    const userId = req.user?.id?.toString();
    const userDoc = await User.findById(userId).select("+password");
    if (!userDoc) {
      res.status(401).json({ success: false, message: "المستخدم غير موجود" });
      return;
    }
    const passwordMatch = await userDoc.comparePassword(password);
    if (!passwordMatch) {
      res.status(401).json({ success: false, message: "كلمة المرور غير صحيحة" });
      return;
    }

    const doc = await PlannedTimetable.findOne({ fiscalYear });
    if (!doc) {
      res.status(404).json({ success: false, message: "لا توجد خطة لهذه السنة المالية" });
      return;
    }

    // Zero out the month across all programs using $unset / $set
    const unsetFields: Record<string, "" > = {};
    for (const prog of TIMETABLE_PROGRAMS) {
      const progKey = `data.${prog}.${monthNum}`;
      unsetFields[progKey] = "";
    }

    await PlannedTimetable.updateOne({ fiscalYear }, { $unset: unsetFields });
    await recomputeAndSave(fiscalYear);

    const updated = await PlannedTimetable.findOne({ fiscalYear }).lean();
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("[planned] resetPlannedMonth error:", err);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء تصفير الشهر" });
  }
}

// ─── POST /api/planned/:fiscalYear ───────────────────────────────────────────
/**
 * Create a new empty PlannedTimetable document for a fiscal year.
 */
export async function createPlannedTimetable(req: Request, res: Response): Promise<void> {
  try {
    const fiscalYear = req.params.fiscalYear as string;

    // Validate format (e.g. FY2026-2027)
    if (!/^FY\d{4}-\d{4}$/.test(fiscalYear)) {
      res.status(400).json({ success: false, message: "صيغة السنة المالية غير صالحة. يجب أن تكون مثل FY2026-2027" });
      return;
    }

    const existing = await PlannedTimetable.findOne({ fiscalYear });
    if (existing) {
      res.status(400).json({ success: false, message: "الخطة لهذه السنة المالية موجودة بالفعل" });
      return;
    }

    const empty = PlannedTimetable.createEmpty(fiscalYear);
    const doc = new PlannedTimetable({
      ...empty,
      lastEditedBy: req.user?.id?.toString() ?? "unknown",
      lastEditedByName: req.user?.displayName ?? "Unknown",
    });

    await doc.save();
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error("[planned] createPlannedTimetable error:", err);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء إنشاء خطة سنة جديدة" });
  }
}
