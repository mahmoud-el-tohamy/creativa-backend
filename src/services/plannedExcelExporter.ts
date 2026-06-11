import XlsxStyle from "xlsx-js-style";
import { TIMETABLE_PROGRAMS } from "../models/TrainingSession";
import { PlannedTimetable, FY_CALENDAR_MONTHS } from "../models/PlannedTimetable";
import { TimetableSnapshot } from "../models/TimetableSnapshot";
import { rebuildTimetableSnapshot } from "./timetableBuilder";
import { computeComparison } from "./timetableComparison";

// ─── Helpers (mirrored from excelExporter.ts) ─────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

const ARABIC_MONTH_NAMES: Record<number, string> = {
  0: "يناير",
  1: "فبراير",
  2: "مارس",
  3: "أبريل",
  4: "مايو",
  5: "يونيو",
  6: "يوليو",
  7: "أغسطس",
  8: "سبتمبر",
  9: "أكتوبر",
  10: "نوفمبر",
  11: "ديسمبر",
};

const ENGLISH_MONTH_NAMES: Record<number, string> = {
  0: "January",
  1: "February",
  2: "March",
  3: "April",
  4: "May",
  5: "June",
  6: "July",
  7: "August",
  8: "September",
  9: "October",
  10: "November",
  11: "December",
};

const HEADER_FILL = "1F4E79";
const GREEN_HEADER_FILL = "70AD47";
const MONTH_HEADER_COLORS = [
  "C8E6C9", "BBDEFB", "C8E6C9", "BBDEFB",
  "C8E6C9", "BBDEFB", "C8E6C9", "BBDEFB",
  "C8E6C9", "BBDEFB", "C8E6C9", "BBDEFB",
];
const WEEKEND_FILL = "D9D9D9";
const HALF_DAY_FILL = "FFF2CC";
const FULL_DAY_FILL = "C6EFCE";

// Diff cell fills
const DIFF_POSITIVE_FILL = "C6EFCE"; // light green
const DIFF_NEGATIVE_FILL = "FFC7CE"; // light red
const DIFF_NEGATIVE_TEXT = "9C0006"; // dark red

const PROGRAM_COLORS: Record<string, { fill: string; text: string; light: string }> = {
  "Entrepreneurship / Technology transfer": { fill: "4CAF50", text: "FFFFFF", light: "E8F5E9" },
  "Awareness events": { fill: "FFC107", text: "000000", light: "FFFDE7" },
  "Acceleration program": { fill: "9E9E9E", text: "FFFFFF", light: "F5F5F5" },
  "Freelancing coaches": { fill: "FF5722", text: "FFFFFF", light: "FBE9E7" },
  "Hackathons / Competitions": { fill: "607D8B", text: "FFFFFF", light: "ECEFF1" },
  "Career development": { fill: "2E7D32", text: "FFFFFF", light: "E8F5E9" },
};

// First 6 programs (excluding Incubation & Consultation)
const MAIN_SIX_PROGRAMS = TIMETABLE_PROGRAMS.slice(0, 6) as string[];

function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getDayOfWeek(year: number, month: number, day: number): number {
  return new Date(year, month, day).getDay();
}

// ─── Parse fiscal year ────────────────────────────────────────────────────────

function parseFiscalYear(fiscalYear: string): { startYear: number; endYear: number } {
  const [startYr, endYr] = fiscalYear.replace("FY", "").split("-");
  return { startYear: parseInt(startYr, 10), endYear: parseInt(endYr, 10) };
}

function getCalendarYear(calMonth: number, startYear: number): number {
  return calMonth >= 4 ? startYear : startYear + 1;
}

// ─── SHEET 1: Percentage ──────────────────────────────────────────────────────

function buildPercentageSheet(
  fiscalYear: string,
  programComparisons: Array<{
    program: string;
    plannedTotal: number;
    actualTotal: number;
    completionPct: number;
  }>
): Record<string, unknown> {
  const ws: Record<string, unknown> = {};
  ws["!merges"] = [] as unknown[];
  ws["!cols"] = [
    { wch: 40 }, // A: Tracks
    { wch: 12 }, // B: Plan
    { wch: 12 }, // C: Actual
    { wch: 14 }, // D: Percentage
  ];

  const merges = ws["!merges"] as Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;

  const { startYear, endYear } = parseFiscalYear(fiscalYear);
  const titleText = `Annual Calendar From May ${startYear} to April ${endYear}`;

  // Row 0 — Title
  ws[cellAddr(0, 0)] = {
    v: titleText,
    t: "s",
    s: {
      font: { bold: true, sz: 14 },
      alignment: { horizontal: "center", vertical: "center" },
    },
  };
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } });

  // Row 1 — empty
  // Row 2 — Column headers
  const colHeaders = ["Tracks", "Plan", "Actual", "Percentage"];
  for (let c = 0; c < colHeaders.length; c++) {
    ws[cellAddr(2, c)] = {
      v: colHeaders[c],
      t: "s",
      s: {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: GREEN_HEADER_FILL } },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
          top: { style: "thin", color: { rgb: "FFFFFF" } },
          bottom: { style: "thin", color: { rgb: "FFFFFF" } },
          left: { style: "thin", color: { rgb: "FFFFFF" } },
          right: { style: "thin", color: { rgb: "FFFFFF" } },
        },
      },
    };
  }

  // Rows 3-8 — first 6 programs (MAIN_SIX_PROGRAMS)
  let r = 3;
  let totalPlanned6 = 0;
  let totalActual6 = 0;

  for (const prog of MAIN_SIX_PROGRAMS) {
    const comp = programComparisons.find((p) => p.program === prog);
    const planned = comp?.plannedTotal ?? 0;
    const actual = comp?.actualTotal ?? 0;
    totalPlanned6 += planned;
    totalActual6 += actual;

    const pct = planned > 0 ? actual / planned : null;
    const pctDisplay = pct !== null ? `${Math.round(pct * 100)}%` : "—";
    const progStyle = PROGRAM_COLORS[prog];

    ws[cellAddr(r, 0)] = {
      v: prog,
      t: "s",
      s: {
        font: { bold: false },
        fill: { fgColor: { rgb: progStyle?.light ?? "FFFFFF" } },
        border: { left: { style: "thick", color: { rgb: progStyle?.fill ?? "000000" } } },
      },
    };
    ws[cellAddr(r, 1)] = { v: planned, t: "n", s: { alignment: { horizontal: "center" } } };
    ws[cellAddr(r, 2)] = { v: actual, t: "n", s: { alignment: { horizontal: "center" } } };
    ws[cellAddr(r, 3)] = {
      v: pctDisplay,
      t: "s",
      s: {
        alignment: { horizontal: "center" },
        font: { color: { rgb: pct !== null && pct < 1 ? "C00000" : "375623" } },
      },
    };
    r++;
  }

  // Totals row (row after 6 programs)
  const totalPct = totalPlanned6 > 0 ? `${Math.round((totalActual6 / totalPlanned6) * 100)}%` : "—";
  ws[cellAddr(r, 0)] = {
    v: "Total",
    t: "s",
    s: {
      font: { bold: true },
      border: { top: { style: "double", color: { rgb: "000000" } }, bottom: { style: "thin", color: { rgb: "000000" } } },
    },
  };
  ws[cellAddr(r, 1)] = {
    v: totalPlanned6, t: "n",
    s: { font: { bold: true }, alignment: { horizontal: "center" }, border: { top: { style: "double", color: { rgb: "000000" } } } },
  };
  ws[cellAddr(r, 2)] = {
    v: totalActual6, t: "n",
    s: { font: { bold: true }, alignment: { horizontal: "center" }, border: { top: { style: "double", color: { rgb: "000000" } } } },
  };
  ws[cellAddr(r, 3)] = {
    v: totalPct, t: "s",
    s: { font: { bold: true }, alignment: { horizontal: "center" }, border: { top: { style: "double", color: { rgb: "000000" } } } },
  };
  r++;

  // 2 empty rows
  r += 2;

  // Second mini-table header
  for (let c = 0; c < colHeaders.length; c++) {
    ws[cellAddr(r, c)] = {
      v: colHeaders[c],
      t: "s",
      s: {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: GREEN_HEADER_FILL } },
        alignment: { horizontal: "center", vertical: "center" },
      },
    };
  }
  r++;

  // All 8 programs
  let totalPlannedAll = 0;
  let totalActualAll = 0;

  for (const prog of TIMETABLE_PROGRAMS) {
    const comp = programComparisons.find((p) => p.program === prog);
    const planned = comp?.plannedTotal ?? 0;
    const actual = comp?.actualTotal ?? 0;
    totalPlannedAll += planned;
    totalActualAll += actual;

    const pct = planned > 0 ? actual / planned : null;
    const pctDisplay = pct !== null ? `${Math.round(pct * 100)}%` : "—";
    const progStyle = PROGRAM_COLORS[prog];

    ws[cellAddr(r, 0)] = {
      v: prog,
      t: "s",
      s: {
        font: { bold: false },
        fill: { fgColor: { rgb: progStyle?.light ?? "FFFFFF" } },
        border: { left: { style: "thick", color: { rgb: progStyle?.fill ?? "000000" } } },
      },
    };
    ws[cellAddr(r, 1)] = { v: planned, t: "n", s: { alignment: { horizontal: "center" } } };
    ws[cellAddr(r, 2)] = { v: actual, t: "n", s: { alignment: { horizontal: "center" } } };
    ws[cellAddr(r, 3)] = {
      v: pctDisplay,
      t: "s",
      s: {
        alignment: { horizontal: "center" },
        font: { color: { rgb: pct !== null && pct < 1 ? "C00000" : "375623" } },
      },
    };
    r++;
  }

  // Grand totals row
  const grandPctDisplay = totalPlannedAll > 0
    ? `${Math.round((totalActualAll / totalPlannedAll) * 100)}%`
    : "—";
  ws[cellAddr(r, 0)] = {
    v: "Grand Total",
    t: "s",
    s: {
      font: { bold: true },
      border: { top: { style: "double", color: { rgb: "000000" } } },
    },
  };
  ws[cellAddr(r, 1)] = {
    v: totalPlannedAll, t: "n",
    s: { font: { bold: true }, alignment: { horizontal: "center" }, border: { top: { style: "double", color: { rgb: "000000" } } } },
  };
  ws[cellAddr(r, 2)] = {
    v: totalActualAll, t: "n",
    s: { font: { bold: true }, alignment: { horizontal: "center" }, border: { top: { style: "double", color: { rgb: "000000" } } } },
  };
  ws[cellAddr(r, 3)] = {
    v: grandPctDisplay, t: "s",
    s: { font: { bold: true }, alignment: { horizontal: "center" }, border: { top: { style: "double", color: { rgb: "000000" } } } },
  };
  r++;

  // Note about chart
  r += 2;
  ws[cellAddr(r, 0)] = {
    v: "الرسم البياني متاح في النظام فقط",
    t: "s",
    s: { font: { italic: true, color: { rgb: "808080" } } },
  };
  merges.push({ s: { r, c: 0 }, e: { r, c: 3 } });
  r++;

  ws["!ref"] = rangeAddr(0, 0, r, 3);
  ws["!rows"] = [{ hpx: 28 }, { hpx: 8 }, { hpx: 20 }];

  return ws;
}

// ─── SHEET 2 & 3: Calendar sheets (Difference / Planned) ─────────────────────

interface CalendarSheetOptions {
  fiscalYear: string;
  sheetTitle: string;
  /** For each program+month: { [day]: value } */
  getCellValue: (prog: string, calMonth: number, day: number) => number | null;
  /** Style for a non-zero cell */
  getCellStyle: (value: number) => Record<string, unknown>;
}

function buildCalendarSheet(opts: CalendarSheetOptions): Record<string, unknown> {
  const { fiscalYear, sheetTitle, getCellValue, getCellStyle } = opts;
  const ws: Record<string, unknown> = {};
  ws["!merges"] = [] as unknown[];
  const merges = ws["!merges"] as Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;

  ws["!cols"] = [
    { wch: 6 },
    { wch: 22 },
    ...Array(31).fill({ wch: 3.5 }),
    { wch: 10 },
  ];

  const { startYear } = parseFiscalYear(fiscalYear);

  let currentRow = 0;

  // Title row
  ws[cellAddr(currentRow, 0)] = {
    v: sheetTitle,
    t: "s",
    s: {
      font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: HEADER_FILL } },
      alignment: { horizontal: "center", vertical: "center" },
    },
  };
  merges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 33 } });
  ws["!rows"] = [{ hpx: 22 }] as unknown[];
  const rows = ws["!rows"] as Array<{ hpx: number }>;
  currentRow++;

  // Day-name header row (based on first month = May)
  const firstCalMonth = FY_CALENDAR_MONTHS[0]; // May = 4
  const firstCalYear = getCalendarYear(firstCalMonth, startYear);
  ws[cellAddr(currentRow, 0)] = { v: "", t: "s" };
  ws[cellAddr(currentRow, 1)] = { v: "", t: "s" };
  const dayNames = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];
  for (let d = 1; d <= 31; d++) {
    const colIndex = 1 + d;
    const date = new Date(firstCalYear, firstCalMonth, d);
    ws[cellAddr(currentRow, colIndex)] = {
      v: dayNames[date.getDay()],
      t: "s",
      s: {
        font: { bold: true, sz: 9, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4472C4" } },
        alignment: { horizontal: "center" },
      },
    };
  }
  ws[cellAddr(currentRow, 33)] = {
    v: "Total Days",
    t: "s",
    s: {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: HEADER_FILL } },
      alignment: { horizontal: "center" },
    },
  };
  rows[currentRow] = { hpx: 14 };
  currentRow++;

  let globalWeekCounter = 1;

  for (let fyPos = 0; fyPos < FY_CALENDAR_MONTHS.length; fyPos++) {
    const calMonth = FY_CALENDAR_MONTHS[fyPos];
    const calYear = getCalendarYear(calMonth, startYear);
    const daysInMonth = getDaysInMonth(calYear, calMonth);

    // Month label
    const monthLabel = `${ARABIC_MONTH_NAMES[calMonth]} ${String(calYear).slice(-2)}`;
    ws[cellAddr(currentRow, 0)] = {
      v: monthLabel,
      t: "s",
      s: {
        font: { bold: true, sz: 10 },
        alignment: { horizontal: "center", vertical: "center", textRotation: 90 },
      },
    };
    merges.push({
      s: { r: currentRow, c: 0 },
      e: { r: currentRow + TIMETABLE_PROGRAMS.length + 1, c: 0 },
    });

    const headerFill = MONTH_HEADER_COLORS[fyPos % 12];
    for (let d = 1; d <= 31; d++) {
      const colIndex = 1 + d;
      const isValid = d <= daysInMonth;
      ws[cellAddr(currentRow, colIndex)] = {
        v: isValid ? d : "",
        t: isValid ? "n" : "s",
        s: {
          font: { bold: true, sz: 8 },
          fill: { fgColor: { rgb: headerFill } },
          alignment: { horizontal: "center" },
        },
      };
    }
    ws[cellAddr(currentRow, 33)] = {
      v: "Total Days",
      t: "s",
      s: { alignment: { horizontal: "center" }, font: { bold: true, sz: 8 } },
    };
    rows[currentRow] = { hpx: 14 };
    currentRow++;

    // Week row
    for (let d = 1; d <= 31; d += 7) {
      if (d > daysInMonth) break;
      const startCol = 1 + d;
      const endCol = Math.min(1 + d + 6, 1 + daysInMonth);
      ws[cellAddr(currentRow, startCol)] = {
        v: `Week# ${String(globalWeekCounter).padStart(2, "0")}`,
        t: "s",
        s: {
          font: { sz: 8 },
          fill: { fgColor: { rgb: "BDD7EE" } },
          alignment: { horizontal: "center" },
        },
      };
      if (endCol > startCol) {
        merges.push({
          s: { r: currentRow, c: startCol },
          e: { r: currentRow, c: endCol },
        });
      }
      globalWeekCounter++;
    }
    rows[currentRow] = { hpx: 12 };
    currentRow++;

    // Program rows
    for (const prog of TIMETABLE_PROGRAMS) {
      const progRow = currentRow;
      const progStyle = PROGRAM_COLORS[prog];

      ws[cellAddr(progRow, 1)] = {
        v: prog,
        t: "s",
        s: {
          font: { bold: true, sz: 9 },
          fill: { fgColor: { rgb: progStyle?.light ?? "FFFFFF" } },
          alignment: { horizontal: "right" },
          border: {
            left: { style: "thick", color: { rgb: progStyle?.fill ?? "000000" } },
            top: { style: "thin", color: { rgb: "E0E0E0" } },
            bottom: { style: "thin", color: { rgb: "E0E0E0" } },
          },
        },
      };

      for (let d = 1; d <= 31; d++) {
        const colIndex = 1 + d;
        const isValid = d <= daysInMonth;
        const dow = isValid ? getDayOfWeek(calYear, calMonth, d) : null;
        const isWeekend = dow === 5 || dow === 6;

        let fillRgb = "FFFFFF";
        if (isWeekend || !isValid) fillRgb = WEEKEND_FILL;

        let cellObj: Record<string, unknown>;

        if (isValid && !isWeekend) {
          const val = getCellValue(prog, calMonth, d);
          if (val !== null && val !== 0) {
            const customStyle = getCellStyle(val);
            cellObj = {
              v: val,
              t: "n",
              s: {
                font: { sz: 8, ...(customStyle.font ?? {}) },
                fill: { fgColor: { rgb: (customStyle.fill as { rgb: string })?.rgb ?? FULL_DAY_FILL } },
                alignment: { horizontal: "center" },
                border: {
                  top: { style: "thin", color: { rgb: "E0E0E0" } },
                  bottom: { style: "thin", color: { rgb: "E0E0E0" } },
                  left: { style: "thin", color: { rgb: "E0E0E0" } },
                  right: { style: "thin", color: { rgb: "E0E0E0" } },
                },
              },
            };
          } else {
            cellObj = {
              v: "",
              t: "s",
              s: {
                font: { sz: 8 },
                fill: { fgColor: { rgb: fillRgb } },
                alignment: { horizontal: "center" },
                border: {
                  top: { style: "thin", color: { rgb: "E0E0E0" } },
                  bottom: { style: "thin", color: { rgb: "E0E0E0" } },
                  left: { style: "thin", color: { rgb: "E0E0E0" } },
                  right: { style: "thin", color: { rgb: "E0E0E0" } },
                },
              },
            };
          }
        } else {
          cellObj = {
            v: "",
            t: "s",
            s: { fill: { fgColor: { rgb: fillRgb } } },
          };
        }

        ws[cellAddr(progRow, colIndex)] = cellObj;
      }

      // Total Days formula
      ws[cellAddr(progRow, 33)] = {
        t: "n",
        f: `SUM(C${progRow + 1}:AG${progRow + 1})`,
        s: {
          font: { bold: true, sz: 9 },
          fill: { fgColor: { rgb: progStyle?.light ?? "FFFFFF" } },
          alignment: { horizontal: "right" },
        },
      };

      rows[currentRow] = { hpx: 16 };
      currentRow++;
    }

    // Sub-total row
    const subRow = currentRow;
    const progCount = TIMETABLE_PROGRAMS.length;
    for (let d = 1; d <= 31; d++) {
      const colIndex = 1 + d;
      const isValid = d <= daysInMonth;
      if (isValid) {
        ws[cellAddr(subRow, colIndex)] = {
          t: "n",
          f: `SUM(${colLetter(colIndex)}${subRow - progCount + 1}:${colLetter(colIndex)}${subRow})`,
          s: {
            font: { bold: true, sz: 8 },
            fill: { fgColor: { rgb: "E2EFDA" } },
            alignment: { horizontal: "center" },
          },
        };
      } else {
        ws[cellAddr(subRow, colIndex)] = {
          v: "",
          t: "s",
          s: { fill: { fgColor: { rgb: WEEKEND_FILL } } },
        };
      }
    }
    ws[cellAddr(subRow, 33)] = {
      t: "n",
      f: `SUM(AH${subRow - progCount + 1}:AH${subRow})`,
      s: {
        font: { bold: true },
        fill: { fgColor: { rgb: "C6EFCE" } },
        alignment: { horizontal: "right" },
      },
    };
    rows[currentRow] = { hpx: 14 };
    currentRow++;

    // Separator row
    for (let c = 0; c <= 33; c++) {
      ws[cellAddr(currentRow, c)] = {
        v: "",
        t: "s",
        s: { fill: { fgColor: { rgb: "F0F0F0" } } },
      };
    }
    rows[currentRow] = { hpx: 4 };
    currentRow++;
  }

  ws["!ref"] = rangeAddr(0, 0, currentRow, 33);
  ws["!freeze"] = { xSplit: 2, ySplit: 2, topLeftCell: "C3" };

  return ws;
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportPlannedTimetable(fiscalYear: string): Promise<Buffer> {
  // Fetch both documents in parallel
  const [plannedDoc, snapshotDoc] = await Promise.all([
    PlannedTimetable.findOne({ fiscalYear }).lean(),
    TimetableSnapshot.findOne({ fiscalYear }).lean(),
  ]);

  // Rebuild snapshot if missing
  let snapshot = snapshotDoc;
  if (!snapshot) {
    await rebuildTimetableSnapshot(fiscalYear, "system");
    snapshot = await TimetableSnapshot.findOne({ fiscalYear }).lean();
  }

  // Compute comparison for Percentage sheet
  const comparison = await computeComparison(fiscalYear);

  const { startYear, endYear } = parseFiscalYear(fiscalYear);

  // ── Build snapshot actual data lookup ─────────────────────────────────────
  // actualMap[calMonth][prog][day] → value
  type ActualMap = Record<number, Record<string, Record<number, number>>>;
  const actualMap: ActualMap = {};

  if (snapshot && Array.isArray(snapshot.months)) {
    for (const monthData of snapshot.months) {
      actualMap[monthData.monthIndex] = {};
      for (const prog of TIMETABLE_PROGRAMS) {
        const progData = ((monthData.programs as Record<string, Record<number, number>>) || {})[prog] ?? {};
        actualMap[monthData.monthIndex][prog] = progData;
      }
    }
  }

  // ── Build planned data lookup ─────────────────────────────────────────────
  // plannedMap[calMonth][prog][day] → value
  type PlannedMap = Record<number, Record<string, Record<number, number>>>;
  const plannedMap: PlannedMap = {};

  for (const calMonth of FY_CALENDAR_MONTHS) {
    plannedMap[calMonth] = {};
    for (const prog of TIMETABLE_PROGRAMS) {
      const monthData = (plannedDoc?.data?.[prog] ?? {})[String(calMonth)] ?? {};
      const dayMap: Record<number, number> = {};
      for (const [dayKey, val] of Object.entries(monthData)) {
        dayMap[Number(dayKey)] = val as number;
      }
      plannedMap[calMonth][prog] = dayMap;
    }
  }

  // ── SHEET 1: Percentage ───────────────────────────────────────────────────
  const ws1 = buildPercentageSheet(fiscalYear, comparison.programComparisons);

  // ── SHEET 2: Difference Calendar ─────────────────────────────────────────
  const ws2 = buildCalendarSheet({
    fiscalYear,
    sheetTitle: `Timetable for CHIs Training Plan Year ${startYear} - ${endYear} — Difference`,
    getCellValue: (prog, calMonth, day) => {
      const actual = actualMap[calMonth]?.[prog]?.[day] ?? 0;
      const planned = plannedMap[calMonth]?.[prog]?.[day] ?? 0;
      return actual - planned;
    },
    getCellStyle: (value) => {
      if (value > 0) {
        return { fill: { rgb: DIFF_POSITIVE_FILL }, font: {} };
      } else if (value < 0) {
        return {
          fill: { rgb: DIFF_NEGATIVE_FILL },
          font: { color: { rgb: DIFF_NEGATIVE_TEXT } },
        };
      }
      return { fill: { rgb: "FFFFFF" }, font: {} };
    },
  });

  // ── SHEET 3: Planned Calendar ─────────────────────────────────────────────
  const ws3 = buildCalendarSheet({
    fiscalYear,
    sheetTitle: `Timetable for CHIs Training Plan Year ${startYear} - ${endYear} — Planned`,
    getCellValue: (prog, calMonth, day) => {
      return plannedMap[calMonth]?.[prog]?.[day] ?? 0;
    },
    getCellStyle: (value) => {
      if (value === 0.5) {
        return { fill: { rgb: HALF_DAY_FILL }, font: {} };
      }
      return { fill: { rgb: FULL_DAY_FILL }, font: {} };
    },
  });

  // ── Assemble workbook ─────────────────────────────────────────────────────
  const wb = XlsxStyle.utils.book_new();
  XlsxStyle.utils.book_append_sheet(wb, ws1 as never, "Percentage");
  XlsxStyle.utils.book_append_sheet(wb, ws2 as never, "Difference Calendar");
  XlsxStyle.utils.book_append_sheet(wb, ws3 as never, "Planned Calendar");

  return XlsxStyle.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
}
