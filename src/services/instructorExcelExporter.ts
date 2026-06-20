import XlsxStyle from "xlsx-js-style";
import { Types } from "mongoose";
import { Instructor } from "../models/Instructor";
import { TrainingSession } from "../models/TrainingSession";
import { getDateRange, DateRangeFilter } from "./instructorService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function colLetter(colIndex: number): string {
  let result = "";
  let n = colIndex;
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

function cellAddr(row: number, col: number): string {
  return colLetter(col) + (row + 1);
}

function rangeAddr(r1: number, c1: number, r2: number, c2: number): string {
  return cellAddr(r1, c1) + ":" + cellAddr(r2, c2);
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ─── Shared Styles ────────────────────────────────────────────────────────────

const TEAL_FILL = "0F4C35";
const TEAL_LIGHT = "F0FFF8";
const HEADER_TEXT = "FFFFFF";
const BORDER_COLOR = "D0D0D0";

const thinBorder = {
  top: { style: "thin" as const, color: { rgb: BORDER_COLOR } },
  bottom: { style: "thin" as const, color: { rgb: BORDER_COLOR } },
  left: { style: "thin" as const, color: { rgb: BORDER_COLOR } },
  right: { style: "thin" as const, color: { rgb: BORDER_COLOR } },
};

// ─── EXPORT 1: Instructor Profile ─────────────────────────────────────────────

/**
 * Generates a profile sheet for an instructor (RTL, Arabic headers).
 * One row per specialization.
 */
export async function exportInstructorProfile(instructorId: string): Promise<Buffer> {
  const instructor = await Instructor.findById(instructorId);
  if (!instructor) throw new Error("المدرب غير موجود");

  const wb = XlsxStyle.utils.book_new();
  const ws: Record<string, unknown> = {};
  ws["!merges"] = [];
  ws["!rows"] = [];

  // RTL direction
  ws["!sheetView"] = [{ rightToLeft: true }];

  // Columns (right to left in RTL):
  // لينك السي في | تاريخ الخبرة | تكلفة اليوم الاستشاري | تكلفة اليوم التدريبي | التخصص | اسم المدرب | اسم التدريب
  const headers = [
    "اسم التدريب",
    "اسم المدرب",
    "التخصص",
    "تكلفة اليوم التدريبي",
    "تكلفة اليوم الاستشاري",
    "تاريخ الخبرة",
    "لينك السي في",
  ];

  ws["!cols"] = [
    { wch: 30 }, // اسم التدريب
    { wch: 22 }, // اسم المدرب
    { wch: 25 }, // التخصص
    { wch: 22 }, // تكلفة اليوم التدريبي
    { wch: 22 }, // تكلفة اليوم الاستشاري
    { wch: 16 }, // تاريخ الخبرة
    { wch: 35 }, // لينك السي في
  ];

  // Header row (row 0)
  for (let c = 0; c < headers.length; c++) {
    ws[cellAddr(0, c)] = {
      v: headers[c],
      t: "s",
      s: {
        font: { bold: true, sz: 11, color: { rgb: HEADER_TEXT } },
        fill: { fgColor: { rgb: TEAL_FILL } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: thinBorder,
      },
    };
  }
  (ws["!rows"] as unknown[])[0] = { hpx: 24 };

  // Data rows — one per specialization (or one blank row if none)
  const specializations =
    instructor.specializations && instructor.specializations.length > 0
      ? instructor.specializations
      : [""];

  for (let i = 0; i < specializations.length; i++) {
    const r = i + 1;
    const spec = specializations[i];
    const fillRgb = i % 2 === 0 ? "FFFFFF" : "F5F5F5";

    const baseStyle = {
      fill: { fgColor: { rgb: fillRgb } },
      border: thinBorder,
      alignment: { vertical: "center", wrapText: true },
    };

    // اسم التدريب — first session matching this specialization (or empty)
    ws[cellAddr(r, 0)] = { v: spec || "", t: "s", s: baseStyle };

    // اسم المدرب
    ws[cellAddr(r, 1)] = { v: instructor.name, t: "s", s: baseStyle };

    // التخصص
    ws[cellAddr(r, 2)] = { v: spec, t: "s", s: baseStyle };

    // تكلفة اليوم التدريبي
    ws[cellAddr(r, 3)] = {
      v: instructor.dailyTrainingRate,
      t: "n",
      z: '#,##0.00"جنيه"',
      s: baseStyle,
    };

    // تكلفة اليوم الاستشاري
    ws[cellAddr(r, 4)] = {
      v: instructor.dailyConsultationRate,
      t: "n",
      z: '#,##0.00"جنيه"',
      s: baseStyle,
    };

    // تاريخ الخبرة
    ws[cellAddr(r, 5)] = {
      v: instructor.graduationYear ?? "",
      t: instructor.graduationYear ? "n" : "s",
      s: { ...baseStyle, alignment: { horizontal: "center", vertical: "center" } },
    };

    // لينك السي في
    if (instructor.cvLink) {
      ws[cellAddr(r, 6)] = {
        v: instructor.cvLink,
        t: "s",
        l: { Target: instructor.cvLink },
        s: {
          ...baseStyle,
          font: { color: { rgb: "0563C1" }, underline: true },
        },
      };
    } else {
      ws[cellAddr(r, 6)] = { v: "", t: "s", s: baseStyle };
    }

    (ws["!rows"] as unknown[])[r] = { hpx: 18 };
  }

  const lastRow = specializations.length;
  ws["!ref"] = rangeAddr(0, 0, lastRow, headers.length - 1);

  XlsxStyle.utils.book_append_sheet(wb, ws, "بيانات المدرب");
  return XlsxStyle.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
}

/**
 * Generates a profile sheet for all active instructors (RTL, Arabic headers).
 * One row per specialization per instructor.
 */
export async function exportAllInstructorProfiles(): Promise<Buffer> {
  const instructors = await Instructor.find({ isActive: true });

  // Fetch all sessions for active instructors to extract dynamic specializations/session names
  const instructorIds = instructors.map(i => i._id.toString());
  const allSessions = await TrainingSession.find({
    instructorId: { $in: instructorIds }
  }).lean();

  const sessionsMap = new Map<string, any[]>();
  for (const session of allSessions) {
    const instId = session.instructorId?.toString();
    if (instId) {
      if (!sessionsMap.has(instId)) sessionsMap.set(instId, []);
      sessionsMap.get(instId)!.push(session);
    }
  }

  const wb = XlsxStyle.utils.book_new();
  const ws: Record<string, unknown> = {};
  ws["!merges"] = [];
  ws["!rows"] = [];

  // RTL direction
  ws["!sheetView"] = [{ rightToLeft: true }];

  // Columns (defined in LTR order, rendering left-to-right exactly as requested):
  const headers = [
    "لينك السي في",
    "تاريخ الخبرة",
    "تكلفة اليوم الاستشاري",
    "تكلفة اليوم التدريبي",
    "التخصص",
    "اسم المدرب",
    "سعر الساعة الاستشارية",
    "سعر الساعة التدريبية",
  ];

  ws["!cols"] = [
    { wch: 35 }, // لينك السي في
    { wch: 16 }, // تاريخ الخبرة
    { wch: 22 }, // تكلفة اليوم الاستشاري
    { wch: 22 }, // تكلفة اليوم التدريبي
    { wch: 25 }, // التخصص
    { wch: 22 }, // اسم المدرب
    { wch: 22 }, // سعر الساعة الاستشارية
    { wch: 22 }, // سعر الساعة التدريبية
  ];

  // Header row (row 0)
  for (let c = 0; c < headers.length; c++) {
    ws[cellAddr(0, c)] = {
      v: headers[c],
      t: "s",
      s: {
        font: { bold: true, sz: 11, color: { rgb: HEADER_TEXT } },
        fill: { fgColor: { rgb: TEAL_FILL } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: thinBorder,
      },
    };
  }
  (ws["!rows"] as unknown[])[0] = { hpx: 24 };

  let currentRow = 1;

  for (const instructor of instructors) {
    const instId = instructor._id.toString();
    const instSessions = sessionsMap.get(instId) || [];

    // Extract dynamic data from sessions
    const sessionPrograms = [...new Set(instSessions.map(s => s.programName).filter(Boolean))];
    
    // Use profile specializations if available, otherwise fallback to session programs
    const specializations = instructor.specializations && instructor.specializations.length > 0
      ? instructor.specializations
      : sessionPrograms;
    
    const spec = specializations.filter(Boolean).join(", ");
    const fillRgb = currentRow % 2 === 0 ? "F5F5F5" : "FFFFFF";

    const baseStyle = {
      fill: { fgColor: { rgb: fillRgb } },
      border: thinBorder,
      alignment: { vertical: "center", wrapText: true },
    };

    if (instructor.cvLink) {
      ws[cellAddr(currentRow, 0)] = {
        v: instructor.cvLink,
        t: "s",
        l: { Target: instructor.cvLink },
        s: {
          ...baseStyle,
          font: { color: { rgb: "0563C1" }, underline: true },
        },
      };
    } else {
      ws[cellAddr(currentRow, 0)] = { v: "", t: "s", s: baseStyle };
    }

    ws[cellAddr(currentRow, 1)] = {
      v: instructor.graduationYear ?? "",
      t: instructor.graduationYear ? "n" : "s",
      s: { ...baseStyle, alignment: { horizontal: "center", vertical: "center" } },
    };
    
    ws[cellAddr(currentRow, 2)] = {
      v: instructor.dailyConsultationRate || 0,
      t: "n",
      z: '#,##0.00"جنيه"',
      s: baseStyle,
    };

    ws[cellAddr(currentRow, 3)] = {
      v: instructor.dailyTrainingRate || 0,
      t: "n",
      z: '#,##0.00"جنيه"',
      s: baseStyle,
    };

    ws[cellAddr(currentRow, 4)] = { v: spec, t: "s", s: baseStyle };
    ws[cellAddr(currentRow, 5)] = { v: instructor.name, t: "s", s: baseStyle };
    
    ws[cellAddr(currentRow, 6)] = {
      v: instructor.hourlyConsultationRate || 0,
      t: "n",
      z: '#,##0.00"جنيه"',
      s: baseStyle,
    };

    ws[cellAddr(currentRow, 7)] = {
      v: instructor.hourlyTrainingRate || 0,
      t: "n",
      z: '#,##0.00"جنيه"',
      s: baseStyle,
    };

    (ws["!rows"] as unknown[])[currentRow] = { hpx: 18 };
    currentRow++;
  }

  const lastRow = currentRow - 1;
  ws["!ref"] = rangeAddr(0, 0, lastRow > 0 ? lastRow : 1, headers.length - 1);

  XlsxStyle.utils.book_append_sheet(wb, ws, "بيانات المدربين");
  return XlsxStyle.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
}

// ─── EXPORT 2: Instructor Sessions ────────────────────────────────────────────

/**
 * Generates the sessions sheet for an instructor for a given period.
 */
export async function exportInstructorSessions(
  instructorId: string,
  filter: DateRangeFilter
): Promise<Buffer> {
  const instructor = await Instructor.findById(instructorId);
  if (!instructor) throw new Error("المدرب غير موجود");

  const { start, end, label } = getDateRange(filter);

  const rawSessions = await TrainingSession.find({
    instructorId: new Types.ObjectId(instructorId),
    date: { $gte: start, $lte: end },
  })
    .sort({ date: 1 })
    .lean();

  const hourlyTrainingRate = instructor.hourlyTrainingRate;
  const hourlyConsultationRate = instructor.hourlyConsultationRate;

  const wb = XlsxStyle.utils.book_new();
  const ws: Record<string, unknown> = {};
  ws["!merges"] = [];
  ws["!rows"] = [];
  ws["!sheetView"] = [{ rightToLeft: true }];

  ws["!cols"] = [
    { wch: 6 },  // رقم
    { wch: 14 }, // تاريخ التدريب من
    { wch: 14 }, // تاريخ التدريب الى
    { wch: 14 }, // عدد الايام التدريبية
    { wch: 18 }, // نوع التدريب
    { wch: 28 }, // اسم التدريب
    { wch: 22 }, // البرنامج التدريبي
    { wch: 14 }, // عدد الحضور
    { wch: 16 }, // تاريخ اول وظيفة
    { wch: 22 }, // اسم المدرب
    { wch: 14 }, // وحدة القياس
    { wch: 22 }, // تكلفة اليوم التدريبي
    { wch: 22 }, // اجمالي اليوم التدريبي
    { wch: 30 }, // لينك السيرة الذاتية
    { wch: 30 }, // لينك تقرير البرنامج التدريبي
  ];

  // ── Title Row ──
  const titleCell = cellAddr(0, 0);
  ws[titleCell] = {
    v: `${instructor.name} — ${label}`,
    t: "s",
    s: {
      font: { bold: true, sz: 13, color: { rgb: HEADER_TEXT } },
      fill: { fgColor: { rgb: TEAL_FILL } },
      alignment: { horizontal: "center", vertical: "center" },
    },
  };
  (ws["!merges"] as unknown[]).push({ s: { r: 0, c: 0 }, e: { r: 0, c: 14 } });
  (ws["!rows"] as unknown[])[0] = { hpx: 28 };

  // ── Headers Row ──
  const sessionHeaders = [
    "رقم",
    "تاريخ التدريب من",
    "تاريخ التدريب الى",
    "عدد الايام التدريبية",
    "نوع التدريب",
    "اسم التدريب",
    "البرنامج التدريبي",
    "عدد الحضور",
    "تاريخ اول وظيفة",
    "اسم المدرب",
    "وحدة القياس",
    "تكلفة اليوم التدريبي",
    "اجمالي اليوم التدريبي",
    "لينك السيرة الذاتية",
    "لينك تقرير البرنامج التدريبي",
  ];

  for (let c = 0; c < sessionHeaders.length; c++) {
    ws[cellAddr(1, c)] = {
      v: sessionHeaders[c],
      t: "s",
      s: {
        font: { bold: true, sz: 10, color: { rgb: HEADER_TEXT } },
        fill: { fgColor: { rgb: TEAL_FILL } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: thinBorder,
      },
    };
  }
  (ws["!rows"] as unknown[])[1] = { hpx: 22 };

  // ── Data Rows ──
  const dataStartRow = 2;
  let r = dataStartRow;

  for (let i = 0; i < rawSessions.length; i++) {
    const s = rawSessions[i];
    const isConsultation = (s.programName as string) === "Consultation & Mentorship";
    const isHackathon = (s.programName as string) === "Hackathons / Competitions";
    const unitRate = isConsultation ? hourlyConsultationRate : hourlyTrainingRate;
    const sessionAmount = Math.round(s.hours * unitRate * 100) / 100;
    const dailyRate = isConsultation ? instructor.dailyConsultationRate : instructor.dailyTrainingRate;
    const dailyTotal = s.dayValue * dailyRate;

    // Row fill color based on type
    let fillRgb = i % 2 === 0 ? "FFFFFF" : TEAL_LIGHT;
    if (isConsultation) fillRgb = "FFF8E1";
    if (isHackathon && sessionAmount === 0) fillRgb = "F5F5F5";

    const baseStyle = {
      fill: { fgColor: { rgb: fillRgb } },
      border: thinBorder,
      alignment: { vertical: "center" },
    };

    const centerStyle = {
      ...baseStyle,
      alignment: { horizontal: "center" as const, vertical: "center" as const },
    };

    ws[cellAddr(r, 0)] = { v: i + 1, t: "n", s: centerStyle };
    ws[cellAddr(r, 1)] = { v: formatDate(new Date(s.date)), t: "s", s: centerStyle };
    ws[cellAddr(r, 2)] = { v: formatDate(new Date(s.date)), t: "s", s: centerStyle };
    ws[cellAddr(r, 3)] = { v: s.dayValue, t: "n", z: "0.0", s: centerStyle };
    ws[cellAddr(r, 4)] = { v: s.type, t: "s", s: baseStyle };
    ws[cellAddr(r, 5)] = { v: s.sessionName, t: "s", s: baseStyle };
    ws[cellAddr(r, 6)] = { v: s.programName, t: "s", s: baseStyle };
    ws[cellAddr(r, 7)] = { v: s.attendeesCount, t: "n", s: centerStyle };
    ws[cellAddr(r, 8)] = {
      v: instructor?.graduationYear ?? "",
      t: instructor?.graduationYear ? "n" : "s",
      s: centerStyle,
    };
    ws[cellAddr(r, 9)] = { v: instructor ? instructor.name : "غير معروف", t: "s", s: baseStyle };
    ws[cellAddr(r, 10)] = { v: s.hours, t: "n", z: "0.0", s: centerStyle };
    ws[cellAddr(r, 11)] = { v: dailyRate, t: "n", z: "#,##0.00", s: centerStyle };
    ws[cellAddr(r, 12)] = { v: sessionAmount, t: "n", z: "#,##0.00", s: centerStyle };

    // لينك السيرة الذاتية
    if (instructor.cvLink) {
      ws[cellAddr(r, 13)] = {
        v: instructor.cvLink,
        t: "s",
        l: { Target: instructor.cvLink },
        s: { ...baseStyle, font: { color: { rgb: "0563C1" }, underline: true } },
      };
    } else {
      ws[cellAddr(r, 13)] = { v: "", t: "s", s: baseStyle };
    }

    // لينك تقرير البرنامج
    const reportUrl = s.trainingReportUrl || s.evaluationReportUrl;
    if (reportUrl) {
      ws[cellAddr(r, 14)] = {
        v: reportUrl,
        t: "s",
        l: { Target: reportUrl },
        s: { ...baseStyle, font: { color: { rgb: "0563C1" }, underline: true } },
      };
    } else {
      ws[cellAddr(r, 14)] = { v: "", t: "s", s: baseStyle };
    }

    (ws["!rows"] as unknown[])[r] = { hpx: 18 };
    r++;
  }

  // ── Totals Row ──
  if (rawSessions.length > 0) {
    const totalsStyle = {
      font: { bold: true },
      fill: { fgColor: { rgb: "E8F5E9" } },
      border: thinBorder,
      alignment: { horizontal: "center" as const, vertical: "center" as const },
    };

    const dataEnd = r; // exclusive
    const dataStartRef = dataStartRow + 1; // 1-based Excel row

    ws[cellAddr(r, 0)] = { v: "الإجمالي", t: "s", s: { ...totalsStyle, alignment: { horizontal: "right" as const, vertical: "center" as const } } };
    ws[cellAddr(r, 1)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 2)] = { v: "", t: "s", s: totalsStyle };

    // SUM عدد الأيام
    ws[cellAddr(r, 3)] = {
      t: "n",
      f: `SUM(${colLetter(3)}${dataStartRef}:${colLetter(3)}${dataEnd})`,
      z: "0.0",
      s: totalsStyle,
    };

    ws[cellAddr(r, 4)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 5)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 6)] = { v: "", t: "s", s: totalsStyle };

    // SUM عدد الحضور
    ws[cellAddr(r, 7)] = {
      t: "n",
      f: `SUM(${colLetter(7)}${dataStartRef}:${colLetter(7)}${dataEnd})`,
      s: totalsStyle,
    };

    ws[cellAddr(r, 8)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 9)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 10)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 11)] = { v: "", t: "s", s: totalsStyle };

    // SUM الإجمالي
    ws[cellAddr(r, 12)] = {
      t: "n",
      f: `SUM(${colLetter(12)}${dataStartRef}:${colLetter(12)}${dataEnd})`,
      z: "#,##0.00",
      s: totalsStyle,
    };

    ws[cellAddr(r, 13)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 14)] = { v: "", t: "s", s: totalsStyle };

    (ws["!rows"] as unknown[])[r] = { hpx: 20 };
    r++;
  }

  ws["!ref"] = rangeAddr(0, 0, Math.max(r - 1, dataStartRow), 14);
  ws["!freeze"] = { xSplit: 0, ySplit: 2, topLeftCell: "A3" };

  XlsxStyle.utils.book_append_sheet(wb, ws, "جلسات المدرب");
  return XlsxStyle.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
}

/**
 * Generates the sessions sheet for all instructors for a given period.
 */
export async function exportAllInstructorSessions(
  filter: DateRangeFilter
): Promise<Buffer> {
  const { start, end, label } = getDateRange(filter);

  const rawSessions = await TrainingSession.find({
    instructorId: { $exists: true, $ne: null },
    date: { $gte: start, $lte: end },
  })
    .sort({ date: 1 })
    .lean();

  const instructorIds = [...new Set(rawSessions.map(s => s.instructorId?.toString()))].filter(Boolean) as string[];
  const instructors = await Instructor.find({ _id: { $in: instructorIds } });
  
  const instructorMap = new Map();
  for (const inst of instructors) {
    instructorMap.set(inst._id.toString(), inst);
  }

  const wb = XlsxStyle.utils.book_new();
  const ws: Record<string, unknown> = {};
  ws["!merges"] = [];
  ws["!rows"] = [];
  ws["!sheetView"] = [{ rightToLeft: true }];

  ws["!cols"] = [
    { wch: 6 },  // رقم
    { wch: 14 }, // تاريخ التدريب من
    { wch: 14 }, // تاريخ التدريب الى
    { wch: 14 }, // عدد الايام التدريبية
    { wch: 18 }, // نوع التدريب
    { wch: 28 }, // اسم التدريب
    { wch: 22 }, // البرنامج التدريبي
    { wch: 14 }, // عدد الحضور
    { wch: 16 }, // تاريخ اول وظيفة
    { wch: 22 }, // اسم المدرب
    { wch: 14 }, // وحدة القياس
    { wch: 22 }, // تكلفة اليوم التدريبي
    { wch: 22 }, // اجمالي اليوم التدريبي
    { wch: 30 }, // لينك السيرة الذاتية
    { wch: 30 }, // لينك تقرير البرنامج التدريبي
  ];

  // ── Title Row ──
  const titleCell = cellAddr(0, 0);
  ws[titleCell] = {
    v: `جميع المدربين — ${label}`,
    t: "s",
    s: {
      font: { bold: true, sz: 13, color: { rgb: HEADER_TEXT } },
      fill: { fgColor: { rgb: TEAL_FILL } },
      alignment: { horizontal: "center", vertical: "center" },
    },
  };
  (ws["!merges"] as unknown[]).push({ s: { r: 0, c: 0 }, e: { r: 0, c: 14 } });
  (ws["!rows"] as unknown[])[0] = { hpx: 28 };

  // ── Headers Row ──
  const sessionHeaders = [
    "رقم",
    "تاريخ التدريب من",
    "تاريخ التدريب الى",
    "عدد الايام التدريبية",
    "نوع التدريب",
    "اسم التدريب",
    "البرنامج التدريبي",
    "عدد الحضور",
    "تاريخ اول وظيفة",
    "اسم المدرب",
    "وحدة القياس",
    "تكلفة اليوم التدريبي",
    "اجمالي اليوم التدريبي",
    "لينك السيرة الذاتية",
    "لينك تقرير البرنامج التدريبي",
  ];

  for (let c = 0; c < sessionHeaders.length; c++) {
    ws[cellAddr(1, c)] = {
      v: sessionHeaders[c],
      t: "s",
      s: {
        font: { bold: true, sz: 10, color: { rgb: HEADER_TEXT } },
        fill: { fgColor: { rgb: TEAL_FILL } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: thinBorder,
      },
    };
  }
  (ws["!rows"] as unknown[])[1] = { hpx: 22 };

  // ── Data Rows ──
  const dataStartRow = 2;
  let r = dataStartRow;

  for (let i = 0; i < rawSessions.length; i++) {
    const s = rawSessions[i];
    const instId = s.instructorId?.toString();
    const instructor = instId ? instructorMap.get(instId) : null;
    
    const hourlyTrainingRate = instructor?.hourlyTrainingRate || 0;
    const hourlyConsultationRate = instructor?.hourlyConsultationRate || 0;
    const dailyTrainingRate = instructor?.dailyTrainingRate || 0;
    const dailyConsultationRate = instructor?.dailyConsultationRate || 0;

    const isConsultation = (s.programName as string) === "Consultation & Mentorship";
    const isHackathon = (s.programName as string) === "Hackathons / Competitions";
    const unitRate = isConsultation ? hourlyConsultationRate : hourlyTrainingRate;
    const sessionAmount = Math.round(s.hours * unitRate * 100) / 100;
    const dailyRate = isConsultation ? dailyConsultationRate : dailyTrainingRate;

    // Row fill color based on type
    let fillRgb = i % 2 === 0 ? "FFFFFF" : TEAL_LIGHT;
    if (isConsultation) fillRgb = "FFF8E1";
    if (isHackathon && sessionAmount === 0) fillRgb = "F5F5F5";

    const baseStyle = {
      fill: { fgColor: { rgb: fillRgb } },
      border: thinBorder,
      alignment: { vertical: "center" },
    };

    const centerStyle = {
      ...baseStyle,
      alignment: { horizontal: "center" as const, vertical: "center" as const },
    };

    ws[cellAddr(r, 0)] = { v: i + 1, t: "n", s: centerStyle };
    ws[cellAddr(r, 1)] = { v: formatDate(new Date(s.date)), t: "s", s: centerStyle };
    ws[cellAddr(r, 2)] = { v: formatDate(new Date(s.date)), t: "s", s: centerStyle };
    ws[cellAddr(r, 3)] = { v: s.dayValue, t: "n", z: "0.0", s: centerStyle };
    ws[cellAddr(r, 4)] = { v: s.type, t: "s", s: baseStyle };
    ws[cellAddr(r, 5)] = { v: s.sessionName, t: "s", s: baseStyle };
    ws[cellAddr(r, 6)] = { v: s.programName, t: "s", s: baseStyle };
    ws[cellAddr(r, 7)] = { v: s.attendeesCount, t: "n", s: centerStyle };
    ws[cellAddr(r, 8)] = {
      v: instructor?.graduationYear ?? "",
      t: instructor?.graduationYear ? "n" : "s",
      s: centerStyle,
    };
    ws[cellAddr(r, 9)] = { v: instructor ? instructor.name : "غير معروف", t: "s", s: baseStyle };
    ws[cellAddr(r, 10)] = { v: s.hours, t: "n", z: "0.0", s: centerStyle };
    ws[cellAddr(r, 11)] = { v: dailyRate, t: "n", z: "#,##0.00", s: centerStyle };
    ws[cellAddr(r, 12)] = { v: sessionAmount, t: "n", z: "#,##0.00", s: centerStyle };

    // لينك السيرة الذاتية
    if (instructor?.cvLink) {
      ws[cellAddr(r, 13)] = {
        v: instructor.cvLink,
        t: "s",
        l: { Target: instructor.cvLink },
        s: { ...baseStyle, font: { color: { rgb: "0563C1" }, underline: true } },
      };
    } else {
      ws[cellAddr(r, 13)] = { v: "", t: "s", s: baseStyle };
    }

    // لينك تقرير البرنامج
    const reportUrl = s.trainingReportUrl || s.evaluationReportUrl;
    if (reportUrl) {
      ws[cellAddr(r, 14)] = {
        v: reportUrl,
        t: "s",
        l: { Target: reportUrl },
        s: { ...baseStyle, font: { color: { rgb: "0563C1" }, underline: true } },
      };
    } else {
      ws[cellAddr(r, 14)] = { v: "", t: "s", s: baseStyle };
    }

    (ws["!rows"] as unknown[])[r] = { hpx: 18 };
    r++;
  }

  // ── Totals Row ──
  if (rawSessions.length > 0) {
    const totalsStyle = {
      font: { bold: true },
      fill: { fgColor: { rgb: "E8F5E9" } },
      border: thinBorder,
      alignment: { horizontal: "center" as const, vertical: "center" as const },
    };

    const dataEnd = r; // exclusive
    const dataStartRef = dataStartRow + 1; // 1-based Excel row

    ws[cellAddr(r, 0)] = { v: "الإجمالي", t: "s", s: { ...totalsStyle, alignment: { horizontal: "right" as const, vertical: "center" as const } } };
    ws[cellAddr(r, 1)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 2)] = { v: "", t: "s", s: totalsStyle };

    // SUM عدد الأيام
    ws[cellAddr(r, 3)] = {
      t: "n",
      f: `SUM(${colLetter(3)}${dataStartRef}:${colLetter(3)}${dataEnd})`,
      z: "0.0",
      s: totalsStyle,
    };

    ws[cellAddr(r, 4)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 5)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 6)] = { v: "", t: "s", s: totalsStyle };

    // SUM عدد الحضور
    ws[cellAddr(r, 7)] = {
      t: "n",
      f: `SUM(${colLetter(7)}${dataStartRef}:${colLetter(7)}${dataEnd})`,
      s: totalsStyle,
    };

    ws[cellAddr(r, 8)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 9)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 10)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 11)] = { v: "", t: "s", s: totalsStyle };

    // SUM الإجمالي
    ws[cellAddr(r, 12)] = {
      t: "n",
      f: `SUM(${colLetter(12)}${dataStartRef}:${colLetter(12)}${dataEnd})`,
      z: "#,##0.00",
      s: totalsStyle,
    };

    ws[cellAddr(r, 13)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 14)] = { v: "", t: "s", s: totalsStyle };

    (ws["!rows"] as unknown[])[r] = { hpx: 20 };
    r++;
  }

  ws["!ref"] = rangeAddr(0, 0, Math.max(r - 1, dataStartRow), 14);
  ws["!freeze"] = { xSplit: 0, ySplit: 2, topLeftCell: "A3" };

  XlsxStyle.utils.book_append_sheet(wb, ws, "جلسات المدربين");
  return XlsxStyle.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
}

// ─── EXPORT 3: Financial Tracking (Filtered) ───────────────────────────────────

export async function exportFilteredFinancials(query: any, label: string): Promise<Buffer> {
  const rawSessions = await TrainingSession.find(query)
    .sort({ date: 1 })
    .lean();

  const instructorIds = [...new Set(rawSessions.map(s => s.instructorId?.toString()))].filter(Boolean) as string[];
  const instructors = await Instructor.find({ _id: { $in: instructorIds } });
  
  const instructorMap = new Map();
  for (const inst of instructors) {
    instructorMap.set(inst._id.toString(), inst);
  }

  const wb = XlsxStyle.utils.book_new();
  const ws: Record<string, unknown> = {};
  ws["!merges"] = [];
  ws["!rows"] = [];
  ws["!sheetView"] = [{ rightToLeft: true }];

  ws["!cols"] = [
    { wch: 6 },  // رقم
    { wch: 14 }, // تاريخ التدريب من
    { wch: 14 }, // تاريخ التدريب الى
    { wch: 14 }, // عدد الايام التدريبية
    { wch: 18 }, // نوع التدريب
    { wch: 28 }, // اسم التدريب
    { wch: 22 }, // البرنامج التدريبي
    { wch: 14 }, // عدد الحضور
    { wch: 16 }, // تاريخ اول وظيفة
    { wch: 22 }, // اسم المدرب
    { wch: 14 }, // وحدة القياس
    { wch: 22 }, // تكلفة اليوم التدريبي
    { wch: 22 }, // اجمالي اليوم التدريبي
    { wch: 30 }, // لينك السيرة الذاتية
    { wch: 30 }, // لينك تقرير البرنامج التدريبي
  ];

  // ── Title Row ──
  const titleCell = cellAddr(0, 0);
  ws[titleCell] = {
    v: `جلسات الفترة — ${label}`,
    t: "s",
    s: {
      font: { bold: true, sz: 13, color: { rgb: HEADER_TEXT } },
      fill: { fgColor: { rgb: TEAL_FILL } },
      alignment: { horizontal: "center", vertical: "center" },
    },
  };
  (ws["!merges"] as unknown[]).push({ s: { r: 0, c: 0 }, e: { r: 0, c: 14 } });
  (ws["!rows"] as unknown[])[0] = { hpx: 28 };

  // ── Headers Row ──
  const sessionHeaders = [
    "رقم",
    "تاريخ التدريب من",
    "تاريخ التدريب الى",
    "عدد الايام التدريبية",
    "نوع التدريب",
    "اسم التدريب",
    "البرنامج التدريبي",
    "عدد الحضور",
    "تاريخ اول وظيفة",
    "اسم المدرب",
    "وحدة القياس",
    "تكلفة اليوم التدريبي",
    "اجمالي اليوم التدريبي",
    "لينك السيرة الذاتية",
    "لينك تقرير البرنامج التدريبي",
  ];

  for (let c = 0; c < sessionHeaders.length; c++) {
    ws[cellAddr(1, c)] = {
      v: sessionHeaders[c],
      t: "s",
      s: {
        font: { bold: true, sz: 10, color: { rgb: HEADER_TEXT } },
        fill: { fgColor: { rgb: TEAL_FILL } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: thinBorder,
      },
    };
  }
  (ws["!rows"] as unknown[])[1] = { hpx: 22 };

  // ── Data Rows ──
  const dataStartRow = 2;
  let r = dataStartRow;

  for (let i = 0; i < rawSessions.length; i++) {
    const s = rawSessions[i];
    const instId = s.instructorId?.toString();
    const instructor = instId ? instructorMap.get(instId) : null;
    
    const hourlyTrainingRate = instructor?.hourlyTrainingRate || 0;
    const hourlyConsultationRate = instructor?.hourlyConsultationRate || 0;
    const dailyTrainingRate = instructor?.dailyTrainingRate || 0;
    const dailyConsultationRate = instructor?.dailyConsultationRate || 0;

    const isConsultation = (s.programName as string) === "Consultation & Mentorship" || s.type === "Consultation";
    const isHackathon = (s.programName as string) === "Hackathons / Competitions";
    const unitRate = isConsultation ? hourlyConsultationRate : hourlyTrainingRate;
    const sessionAmount = Math.round(s.hours * unitRate * 100) / 100;
    const dailyRate = isConsultation ? dailyConsultationRate : dailyTrainingRate;
    const dailyTotal = s.dayValue * dailyRate;

    // Row fill color based on type
    let fillRgb = i % 2 === 0 ? "FFFFFF" : TEAL_LIGHT;
    if (isConsultation) fillRgb = "FFF8E1";
    if (isHackathon && sessionAmount === 0) fillRgb = "F5F5F5";

    const baseStyle = {
      fill: { fgColor: { rgb: fillRgb } },
      border: thinBorder,
      alignment: { vertical: "center" },
    };

    const centerStyle = {
      ...baseStyle,
      alignment: { horizontal: "center" as const, vertical: "center" as const },
    };

    ws[cellAddr(r, 0)] = { v: i + 1, t: "n", s: centerStyle };
    ws[cellAddr(r, 1)] = { v: formatDate(new Date(s.date)), t: "s", s: centerStyle };
    ws[cellAddr(r, 2)] = { v: formatDate(new Date(s.date)), t: "s", s: centerStyle };
    ws[cellAddr(r, 3)] = { v: s.dayValue, t: "n", z: "0.0", s: centerStyle };
    ws[cellAddr(r, 4)] = { v: s.type, t: "s", s: baseStyle };
    ws[cellAddr(r, 5)] = { v: s.sessionName, t: "s", s: baseStyle };
    ws[cellAddr(r, 6)] = { v: s.programName, t: "s", s: baseStyle };
    ws[cellAddr(r, 7)] = { v: s.attendeesCount, t: "n", s: centerStyle };
    ws[cellAddr(r, 8)] = {
      v: instructor?.graduationYear ?? "",
      t: instructor?.graduationYear ? "n" : "s",
      s: centerStyle,
    };
    ws[cellAddr(r, 9)] = { v: instructor ? instructor.name : (s.instructorName || "غير معروف"), t: "s", s: baseStyle };
    ws[cellAddr(r, 10)] = { v: s.hours, t: "n", z: "0.0", s: centerStyle };
    ws[cellAddr(r, 11)] = { v: dailyRate, t: "n", z: "#,##0.00", s: centerStyle };
    ws[cellAddr(r, 12)] = { v: dailyTotal, t: "n", z: "#,##0.00", s: centerStyle };

    // لينك السيرة الذاتية
    if (instructor?.cvLink) {
      ws[cellAddr(r, 13)] = {
        v: instructor.cvLink,
        t: "s",
        l: { Target: instructor.cvLink },
        s: { ...baseStyle, font: { color: { rgb: "0563C1" }, underline: true } },
      };
    } else {
      ws[cellAddr(r, 13)] = { v: "", t: "s", s: baseStyle };
    }

    // لينك تقرير البرنامج
    const reportUrl = s.trainingReportUrl || s.evaluationReportUrl;
    if (reportUrl) {
      ws[cellAddr(r, 14)] = {
        v: reportUrl,
        t: "s",
        l: { Target: reportUrl },
        s: { ...baseStyle, font: { color: { rgb: "0563C1" }, underline: true } },
      };
    } else {
      ws[cellAddr(r, 14)] = { v: "", t: "s", s: baseStyle };
    }

    (ws["!rows"] as unknown[])[r] = { hpx: 18 };
    r++;
  }

  // ── Totals Row ──
  if (rawSessions.length > 0) {
    const totalsStyle = {
      font: { bold: true },
      fill: { fgColor: { rgb: "E8F5E9" } },
      border: thinBorder,
      alignment: { horizontal: "center" as const, vertical: "center" as const },
    };

    const dataEnd = r; // exclusive
    const dataStartRef = dataStartRow + 1; // 1-based Excel row

    ws[cellAddr(r, 0)] = { v: "الإجمالي", t: "s", s: { ...totalsStyle, alignment: { horizontal: "right" as const, vertical: "center" as const } } };
    ws[cellAddr(r, 1)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 2)] = { v: "", t: "s", s: totalsStyle };

    // SUM عدد الأيام
    ws[cellAddr(r, 3)] = {
      t: "n",
      f: `SUM(${colLetter(3)}${dataStartRef}:${colLetter(3)}${dataEnd})`,
      z: "0.0",
      s: totalsStyle,
    };

    ws[cellAddr(r, 4)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 5)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 6)] = { v: "", t: "s", s: totalsStyle };

    // SUM عدد الحضور
    ws[cellAddr(r, 7)] = {
      t: "n",
      f: `SUM(${colLetter(7)}${dataStartRef}:${colLetter(7)}${dataEnd})`,
      s: totalsStyle,
    };

    ws[cellAddr(r, 8)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 9)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 10)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 11)] = { v: "", t: "s", s: totalsStyle };

    // SUM الإجمالي (اجمالي اليوم)
    ws[cellAddr(r, 12)] = {
      t: "n",
      f: `SUM(${colLetter(12)}${dataStartRef}:${colLetter(12)}${dataEnd})`,
      z: "#,##0.00",
      s: totalsStyle,
    };

    ws[cellAddr(r, 13)] = { v: "", t: "s", s: totalsStyle };
    ws[cellAddr(r, 14)] = { v: "", t: "s", s: totalsStyle };

    (ws["!rows"] as unknown[])[r] = { hpx: 20 };
    r++;
  }

  ws["!ref"] = rangeAddr(0, 0, Math.max(r - 1, dataStartRow), 14);
  ws["!freeze"] = { xSplit: 0, ySplit: 2, topLeftCell: "A3" };

  XlsxStyle.utils.book_append_sheet(wb, ws, "جلسات المدربين");
  return XlsxStyle.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
}
