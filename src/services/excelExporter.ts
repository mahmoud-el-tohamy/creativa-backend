import XlsxStyle from "xlsx-js-style";
import { TrainingSession, TIMETABLE_PROGRAMS } from "../models/TrainingSession";
import { TimetableSnapshot } from "../models/TimetableSnapshot";
import { rebuildTimetableSnapshot } from "./timetableBuilder";

function colLetter(colIndex: number): string {
  let result = '';
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
  return cellAddr(r1, c1) + ':' + cellAddr(r2, c2);
}

const PROGRAM_COLORS: Record<string, { fill: string; text: string; light: string }> = {
  "Entrepreneurship / Technology transfer": { fill: "4CAF50", text: "FFFFFF", light: "E8F5E9" },
  "Awareness events": { fill: "FFC107", text: "000000", light: "FFFDE7" },
  "Acceleration program": { fill: "9E9E9E", text: "FFFFFF", light: "F5F5F5" },
  "Freelancing coaches": { fill: "FF5722", text: "FFFFFF", light: "FBE9E7" },
  "Hackathons / Competitions": { fill: "607D8B", text: "FFFFFF", light: "ECEFF1" },
  "Career development": { fill: "2E7D32", text: "FFFFFF", light: "E8F5E9" },
};

const MONTH_HEADER_COLORS = [
  "C8E6C9", "BBDEFB", "C8E6C9", "BBDEFB",
  "C8E6C9", "BBDEFB", "C8E6C9", "BBDEFB",
  "C8E6C9", "BBDEFB", "C8E6C9", "BBDEFB",
];

const HALF_DAY_FILL  = "FFF2CC";
const FULL_DAY_FILL  = "C6EFCE";
const WEEKEND_FILL   = "D9D9D9";
const HEADER_FILL    = "1F4E79";

const TRACKING_PROGRAM_COLORS: Record<string, string> = {
  "Career Development": "EDE9FE",
  "Tech": "DBEAFE",
  "Freelancing": "FEF3C7",
  "Entrepreneurship": "D1FAE5",
  "Awareness event": "FEF9C3",
  "Hackathons / Competitions": "FFE4E6",
  "Acceleration program": "DCFCE7",
};

export async function exportHoursTracking(fiscalYear: string): Promise<Buffer> {
  const sessions = await TrainingSession.find({ fiscalYear }).sort({ date: 1 }).lean();

  const wb = XlsxStyle.utils.book_new();
  const ws: any = {};
  ws["!merges"] = [];
  ws["!cols"] = [
    { wch: 22 }, // A: Program Name
    { wch: 30 }, // B: Session Name
    { wch: 14 }, // C: Date
    { wch: 10 }, // D: No. of Hrs
    { wch: 14 }, // E: Online/Offline
    { wch: 22 }, // F: Instructor
    { wch: 12 }, // G: No. of Attendees
    { wch: 18 }, // H: Type
    { wch: 35 }, // I: Evaluation Report URL
    { wch: 35 }, // J: Training Report URL
  ];

  // ROW 1 - TITLE ROW
  ws[cellAddr(0, 0)] = {
    v: `Creativa Training Filter — Hours Tracking ${fiscalYear}`,
    t: "s",
    s: {
      font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "1D9E75" } },
      alignment: { horizontal: "center", vertical: "center" },
    },
  };
  ws["!merges"].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } });

  const enHeaders = [
    "Program Name", "Session Name", "Date", "No. of Hrs", "Online/Offline",
    "Instructor", "No. of Attendees", "Type", "Evaluation Report URL", "Training Report URL",
  ];
  const arHeaders = [
    "البرنامج", "اسم الجلسة", "التاريخ", "الساعات", "النوع",
    "المدرب", "الحضور", "النوع", "تقرير التقييم", "تقرير التدريب",
  ];

  for (let c = 0; c < 10; c++) {
    ws[cellAddr(1, c)] = {
      v: enHeaders[c],
      t: "s",
      s: {
        font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "0F4C35" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: {
          top: { style: "thin", color: { rgb: "FFFFFF" } },
          bottom: { style: "thin", color: { rgb: "FFFFFF" } },
          left: { style: "thin", color: { rgb: "FFFFFF" } },
          right: { style: "thin", color: { rgb: "FFFFFF" } },
        },
      },
    };
  }

  for (let c = 0; c < 10; c++) {
    ws[cellAddr(2, c)] = {
      v: arHeaders[c],
      t: "s",
      s: {
        font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "1D9E75" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: {
          top: { style: "thin", color: { rgb: "FFFFFF" } },
          bottom: { style: "thin", color: { rgb: "FFFFFF" } },
          left: { style: "thin", color: { rgb: "FFFFFF" } },
          right: { style: "thin", color: { rgb: "FFFFFF" } },
        },
      },
    };
  }

  let r = 3;
  for (const s of sessions) {
    const isEven = (r - 3) % 2 === 0;
    const fillRgb = isEven ? "F0FFF8" : "FFFFFF";
    const baseStyle = {
      fill: { fgColor: { rgb: fillRgb } },
      border: {
        top: { style: "thin", color: { rgb: "D0D0D0" } },
        bottom: { style: "thin", color: { rgb: "D0D0D0" } },
        left: { style: "thin", color: { rgb: "D0D0D0" } },
        right: { style: "thin", color: { rgb: "D0D0D0" } },
      },
    };

    ws[cellAddr(r, 0)] = {
      v: s.type === "Consultation" ? "Consultation" : s.programName,
      t: "s",
      s: { ...baseStyle, fill: { fgColor: { rgb: TRACKING_PROGRAM_COLORS[s.programName] || fillRgb } } },
    };
    ws[cellAddr(r, 1)] = { v: s.sessionName, t: "s", s: baseStyle };
    ws[cellAddr(r, 2)] = {
      v: new Date(s.date),
      t: "d",
      z: "DD/MM/YYYY",
      s: baseStyle,
    };
    ws[cellAddr(r, 3)] = { v: s.hours, t: "n", z: "0.0##", s: baseStyle };
    ws[cellAddr(r, 4)] = { v: s.mode === "online" ? "Online" : "Offline", t: "s", s: baseStyle };
    ws[cellAddr(r, 5)] = { v: s.instructorName, t: "s", s: baseStyle };
    ws[cellAddr(r, 6)] = { v: s.attendeesCount, t: "n", s: baseStyle };
    ws[cellAddr(r, 7)] = { v: s.type, t: "s", s: baseStyle };

    if (s.evaluationReportUrl) {
      ws[cellAddr(r, 8)] = {
        v: s.evaluationReportUrl,
        t: "s",
        l: { Target: s.evaluationReportUrl },
        s: { ...baseStyle, font: { color: { rgb: "0563C1" }, underline: true } },
      };
    } else {
      ws[cellAddr(r, 8)] = { v: "", t: "s", s: baseStyle };
    }

    if (s.trainingReportUrl) {
      ws[cellAddr(r, 9)] = {
        v: s.trainingReportUrl,
        t: "s",
        l: { Target: s.trainingReportUrl },
        s: { ...baseStyle, font: { color: { rgb: "0563C1" }, underline: true } },
      };
    } else {
      ws[cellAddr(r, 9)] = { v: "", t: "s", s: baseStyle };
    }

    r++;
  }

  const lastDataRow = r > 3 ? r : 4;
  r++;

  ws[cellAddr(r, 0)] = {
    v: "إجمالي التدريبات",
    t: "s",
    s: {
      font: { bold: true },
      fill: { fgColor: { rgb: "E8F5F0" } },
      alignment: { horizontal: "right" }
    }
  };
  ws["!merges"].push({ s: { r, c: 0 }, e: { r, c: 2 } });
  ws[cellAddr(r, 1)] = { v: "", t: "s", s: { fill: { fgColor: { rgb: "E8F5F0" } } } };
  ws[cellAddr(r, 2)] = { v: "", t: "s", s: { fill: { fgColor: { rgb: "E8F5F0" } } } };

  ws[cellAddr(r, 3)] = {
    t: "n",
    f: `COUNTA(D4:D${lastDataRow})`,
    s: { font: { bold: true }, fill: { fgColor: { rgb: "E8F5F0" } } }
  };
  ws[cellAddr(r, 4)] = {
    t: "n",
    f: `SUM(D4:D${lastDataRow})`,
    s: { font: { bold: true }, fill: { fgColor: { rgb: "E8F5F0" } } }
  };

  ws[cellAddr(r, 5)] = { v: "", t: "s", s: { fill: { fgColor: { rgb: "E8F5F0" } } } };

  ws[cellAddr(r, 6)] = {
    t: "n",
    f: `SUM(G4:G${lastDataRow})`,
    s: { font: { bold: true }, fill: { fgColor: { rgb: "E8F5F0" } } }
  };

  ws[cellAddr(r, 7)] = { v: "", t: "s", s: { fill: { fgColor: { rgb: "E8F5F0" } } } };
  ws[cellAddr(r, 8)] = { v: "", t: "s", s: { fill: { fgColor: { rgb: "E8F5F0" } } } };
  ws[cellAddr(r, 9)] = { v: "", t: "s", s: { fill: { fgColor: { rgb: "E8F5F0" } } } };

  ws["!ref"] = rangeAddr(0, 0, r, 9);
  ws["!freeze"] = { xSplit: 0, ySplit: 3, topLeftCell: "A4" };
  ws["!autofilter"] = { ref: rangeAddr(2, 0, 2, 9) };

  ws["!rows"] = [
    { hpx: 28 },
    { hpx: 20 },
    { hpx: 20 },
  ];
  for (let i = 3; i < r; i++) {
    ws["!rows"].push({ hpx: 18 });
  }

  XlsxStyle.utils.book_append_sheet(wb, ws, "Hours Tracking");
  return XlsxStyle.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
}

function getDayOfWeek(year: number, month: number, day: number): number {
  return new Date(year, month, day).getDay();
}

export async function exportTimetable(fiscalYear: string): Promise<Buffer> {
  let snapshot = await TimetableSnapshot.findOne({ fiscalYear }).lean();
  if (!snapshot) {
    await rebuildTimetableSnapshot(fiscalYear, "system");
    snapshot = await TimetableSnapshot.findOne({ fiscalYear }).lean();
    if (!snapshot) throw new Error("Could not rebuild timetable snapshot");
  }

  const wb = XlsxStyle.utils.book_new();
  const ws: any = {};
  ws["!merges"] = [];
  
  ws["!cols"] = [
    { wch: 6 },
    { wch: 22 },
    ...Array(31).fill({ wch: 3.5 }),
    { wch: 12 }, // Consultations
    { wch: 10 }, // Total Days
    { wch: 24 },
    { wch: 3 },
    { wch: 14 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 6 },
    { wch: 6 },
    { wch: 6 },
    { wch: 6 },
    { wch: 8 },
    { wch: 8 },
  ];

  const cellMap: Record<string, string> = {};
  const monthTotalMap: Record<string, string> = {};
  const annualTotalMap: Record<string, string> = {};

  let currentRow = 0;

  const [startYr, endYr] = fiscalYear.replace("FY", "").split("-");
  ws[cellAddr(currentRow, 0)] = {
    v: `Timetable  for CHIs Training Plan Year ${startYr} - ${endYr}`,
    t: "s",
    s: {
      font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: HEADER_FILL } },
      alignment: { horizontal: "center", vertical: "center" }
    }
  };
  ws["!merges"].push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 35 } });
  ws["!rows"] = [];
  ws["!rows"][currentRow] = { hpx: 22 };
  currentRow++;
  const firstMonth = (snapshot.months && snapshot.months.length > 0) ? snapshot.months[0] : null;
  ws[cellAddr(currentRow, 0)] = { v: "", t: "s" };
  ws[cellAddr(currentRow, 1)] = { v: "", t: "s" };
  
  const dayNames = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];
  for (let d = 1; d <= 31; d++) {
    const colIndex = 1 + d;
    const date = firstMonth ? new Date(firstMonth.year, firstMonth.monthIndex, d) : new Date();
    ws[cellAddr(currentRow, colIndex)] = {
      v: dayNames[date.getDay()],
      t: "s",
      s: {
        font: { bold: true, sz: 9, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4472C4" } },
        alignment: { horizontal: "center" }
      }
    };
  }
  
  ws[cellAddr(currentRow, 33)] = {
    v: "Consultations",
    t: "s",
    s: {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: HEADER_FILL } },
      alignment: { horizontal: "center" }
    }
  };
  ws[cellAddr(currentRow, 34)] = {
    v: "Total Days",
    t: "s",
    s: {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: HEADER_FILL } },
      alignment: { horizontal: "center" }
    }
  };
  ws["!rows"][currentRow] = { hpx: 14 };
  currentRow++;

  let globalWeekCounter = 1;

  const monthsArray = Array.isArray(snapshot.months) ? snapshot.months : [];
  for (let mIdx = 0; mIdx < monthsArray.length; mIdx++) {
    const monthData = monthsArray[mIdx];
    
    ws[cellAddr(currentRow, 0)] = {
      v: `${monthData.monthName} ${String(monthData.year).slice(-2)}`,
      t: "s",
      s: {
        font: { bold: true, sz: 10 },
        alignment: { horizontal: "center", vertical: "center", textRotation: 90 }
      }
    };
    ws["!merges"].push({
      s: { r: currentRow, c: 0 },
      // FIXED: FIX 5 — span = 1 header row + 1 week row + N program rows = N+1
      e: { r: currentRow + TIMETABLE_PROGRAMS.length + 1, c: 0 }
    });

    const headerFill = MONTH_HEADER_COLORS[mIdx % 12];

    for (let d = 1; d <= 31; d++) {
      const colIndex = 1 + d;
      const isValid = d <= monthData.daysInMonth;
      ws[cellAddr(currentRow, colIndex)] = {
        v: isValid ? d : "",
        t: isValid ? "n" : "s",
        s: {
          font: { bold: true, sz: 8 },
          fill: { fgColor: { rgb: headerFill } },
          alignment: { horizontal: "center" }
        }
      };
    }
    ws[cellAddr(currentRow, 33)] = { v: "Consultations", t: "s", s: { alignment: { horizontal: "center" }, font: { bold: true, sz: 8 } } };
    ws[cellAddr(currentRow, 34)] = { v: "Total Days", t: "s", s: { alignment: { horizontal: "center" }, font: { bold: true, sz: 8 } } };
    ws["!rows"][currentRow] = { hpx: 14 };
    currentRow++;

    for (let d = 1; d <= 31; d += 7) {
      if (d > monthData.daysInMonth) break;
      const startCol = 1 + d;
      const endCol = Math.min(1 + d + 6, 1 + monthData.daysInMonth);
      ws[cellAddr(currentRow, startCol)] = {
        v: `Week# ${String(globalWeekCounter).padStart(2, "0")}`,
        t: "s",
        s: {
          font: { sz: 8 },
          fill: { fgColor: { rgb: "BDD7EE" } },
          alignment: { horizontal: "center" }
        }
      };
      if (endCol > startCol) {
        ws["!merges"].push({
          s: { r: currentRow, c: startCol },
          e: { r: currentRow, c: endCol }
        });
      }
      globalWeekCounter++;
    }
    ws["!rows"][currentRow] = { hpx: 12 };
    currentRow++;

    for (let pIdx = 0; pIdx < TIMETABLE_PROGRAMS.length; pIdx++) {
      const prog = TIMETABLE_PROGRAMS[pIdx];
      const progRow = currentRow;
      const progStyle = PROGRAM_COLORS[prog];

      ws[cellAddr(progRow, 1)] = {
        v: prog,
        t: "s",
        s: {
          font: { bold: true, sz: 9 },
          fill: { fgColor: { rgb: progStyle.light } },
          alignment: { horizontal: "right" },
          border: {
            left: { style: "thick", color: { rgb: progStyle.fill } },
            top: { style: "thin", color: { rgb: "E0E0E0" } },
            bottom: { style: "thin", color: { rgb: "E0E0E0" } }
          }
        }
      };

      for (let d = 1; d <= 31; d++) {
        const colIndex = 1 + d;
        const isValid = d <= monthData.daysInMonth;
        const dow = isValid ? getDayOfWeek(monthData.year, monthData.monthIndex, d) : null;
        const isWeekend = dow === 5 || dow === 6;

        const cellA = cellAddr(progRow, colIndex);
        cellMap[`${prog}_${mIdx}_${d}`] = cellA;

        let fillRgb = "FFFFFF";
        if (isWeekend || !isValid) fillRgb = WEEKEND_FILL;

        const progData = monthData.programs[prog] as any;
        const val = progData ? (progData[d] || 0) : 0;

        let v: any = "";
        let t = "s";
        let z = undefined;

        if (isValid && val > 0) {
          v = val;
          t = "n";
          if (val === 0.5) {
            z = "0.#";
            fillRgb = HALF_DAY_FILL;
          } else {
            z = "0";
            fillRgb = FULL_DAY_FILL;
          }
        }

        ws[cellA] = {
          v, t, z,
          s: {
            font: { sz: 8 },
            fill: { fgColor: { rgb: fillRgb } },
            alignment: { horizontal: "center" },
            border: {
              top: { style: "thin", color: { rgb: "E0E0E0" } },
              bottom: { style: "thin", color: { rgb: "E0E0E0" } },
              left: { style: "thin", color: { rgb: "E0E0E0" } },
              right: { style: "thin", color: { rgb: "E0E0E0" } },
            }
          }
        };
      }

      const progData = monthData.programs[prog] as any;
      const consultationTotal = progData ? (progData.consultationTotal || 0) : 0;
      ws[cellAddr(progRow, 33)] = {
        v: consultationTotal > 0 ? consultationTotal : "",
        t: consultationTotal > 0 ? "n" : "s",
        s: {
          font: { bold: true, sz: 8 },
          fill: { fgColor: { rgb: consultationTotal > 0 ? "E8D5F5" : "FFFFFF" } },
          alignment: { horizontal: "center" },
          border: {
            top: { style: "thin", color: { rgb: "E0E0E0" } },
            bottom: { style: "thin", color: { rgb: "E0E0E0" } },
            left: { style: "thin", color: { rgb: "E0E0E0" } },
            right: { style: "thin", color: { rgb: "E0E0E0" } },
          }
        }
      };

      const totalCellAddr = cellAddr(progRow, 34);
      monthTotalMap[`${prog}_${mIdx}`] = totalCellAddr;
      ws[totalCellAddr] = {
        t: "n",
        f: `SUM(C${progRow + 1}:AH${progRow + 1})`,
        s: {
          font: { bold: true, sz: 9 },
          fill: { fgColor: { rgb: progStyle.light } },
          alignment: { horizontal: "right" }
        }
      };

      ws["!rows"][currentRow] = { hpx: 16 };
      currentRow++;
    }

    const subRow = currentRow;
    const progCount = TIMETABLE_PROGRAMS.length;
    for (let d = 1; d <= 31; d++) {
      const colIndex = 1 + d;
      const isValid = d <= monthData.daysInMonth;
      if (isValid) {
        ws[cellAddr(subRow, colIndex)] = {
          t: "n",
          f: `SUM(${colLetter(colIndex)}${subRow - progCount + 1}:${colLetter(colIndex)}${subRow})`,
          s: {
            font: { bold: true, sz: 8 },
            fill: { fgColor: { rgb: "E2EFDA" } },
            alignment: { horizontal: "center" }
          }
        };
      } else {
        ws[cellAddr(subRow, colIndex)] = { v: "", t: "s", s: { fill: { fgColor: { rgb: WEEKEND_FILL } } } };
      }
    }
    
    ws[cellAddr(subRow, 33)] = {
      t: "n",
      f: `SUM(AH${subRow - progCount + 1}:AH${subRow})`,
      s: { font: { bold: true }, fill: { fgColor: { rgb: "C6EFCE" } }, alignment: { horizontal: "center" } }
    };
    ws[cellAddr(subRow, 34)] = {
      t: "n",
      f: `SUM(AI${subRow - progCount + 1}:AI${subRow})`,
      s: { font: { bold: true }, fill: { fgColor: { rgb: "C6EFCE" } }, alignment: { horizontal: "right" } }
    };
    ws["!rows"][currentRow] = { hpx: 14 };
    currentRow++;

    for (let c = 0; c <= 34; c++) {
      ws[cellAddr(currentRow, c)] = { v: "", t: "s", s: { fill: { fgColor: { rgb: "F0F0F0" } } } };
    }
    ws["!rows"][currentRow] = { hpx: 4 };
    currentRow++;
  }

  ws[cellAddr(currentRow, 1)] = {
    v: "TOTAL", t: "s",
    s: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: HEADER_FILL } } }
  };
  
  const allMonthlyTotals = [];
  for (const prog of TIMETABLE_PROGRAMS) {
    for (let m = 0; m < 12; m++) {
      allMonthlyTotals.push(monthTotalMap[`${prog}_${m}`]);
    }
  }
  ws[cellAddr(currentRow, 34)] = {
    t: "n",
    f: `SUM(${allMonthlyTotals.join(",")})`,
    s: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: HEADER_FILL } }, alignment: { horizontal: "right" } }
  };
  ws["!rows"][currentRow] = { hpx: 18 };
  currentRow++;

  for (let pIdx = 0; pIdx < TIMETABLE_PROGRAMS.length; pIdx++) {
    const prog = TIMETABLE_PROGRAMS[pIdx];
    const progRow = currentRow;
    const progStyle = PROGRAM_COLORS[prog];

    ws[cellAddr(progRow, 1)] = {
      v: prog, t: "s",
      s: {
        font: { bold: true, sz: 9 },
        fill: { fgColor: { rgb: progStyle.light } },
        alignment: { horizontal: "right" },
        border: { left: { style: "thick", color: { rgb: progStyle.fill } } }
      }
    };

    const monthlyCellList = [];
    for (let m = 0; m < 12; m++) {
      monthlyCellList.push(monthTotalMap[`${prog}_${m}`]);
    }
    const annualTotalCellAddr = cellAddr(progRow, 34);
    annualTotalMap[prog] = annualTotalCellAddr;

    ws[annualTotalCellAddr] = {
      t: "n",
      f: `SUM(${monthlyCellList.join(",")})`,
      s: { font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: progStyle.light } }, alignment: { horizontal: "right" } }
    };
    currentRow++;
  }

  currentRow += 2;

  const summaryStartRow = currentRow;
  const sumHeaders = [
    { c: 3, v: "Total Days" },
    { c: 4, v: "Year" },
    { c: 5, v: "Quarter" },
    { c: 6, v: "Target" },
    { c: 7, v: "Completion %" },
    { c: 8, v: "Q1" },
    { c: 9, v: "Q2" },
    { c: 10, v: "Q3" },
    { c: 11, v: "Q4" },
    { c: 12, v: "Remaining" },
  ];
  for (const h of sumHeaders) {
    ws[cellAddr(summaryStartRow, h.c)] = {
      v: h.v, t: "s",
      s: { font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: HEADER_FILL } }, alignment: { horizontal: "center", vertical: "center" } }
    };
  }
  currentRow++;

  for (const prog of TIMETABLE_PROGRAMS) {
    const r = currentRow;
    const progStyle = PROGRAM_COLORS[prog];

    ws[cellAddr(r, 0)] = { v: "", t: "s", s: { fill: { fgColor: { rgb: progStyle.fill } } } };
    ws[cellAddr(r, 1)] = { v: "", t: "s", s: { fill: { fgColor: { rgb: progStyle.fill } } } };
    ws[cellAddr(r, 2)] = { v: "→", t: "s", s: { font: { bold: true }, alignment: { horizontal: "center", vertical: "center" } } };
    ws[cellAddr(r, 3)] = { v: prog, t: "s", s: { font: { bold: true }, alignment: { vertical: "center" } } };

    const annualCell = annualTotalMap[prog];
    ws[cellAddr(r, 4)] = { t: "n", f: annualCell, s: { alignment: { horizontal: "center", vertical: "center" } } };
    ws[cellAddr(r, 5)] = { t: "n", f: `${annualCell}/4`, s: { alignment: { horizontal: "center", vertical: "center" }, numFmt: "0.0" } };

    const annualData = snapshot.annualTotals.find(a => a.program === prog);
    const target = annualData?.targetDays || 0;
    ws[cellAddr(r, 6)] = { v: target, t: "n", s: { alignment: { horizontal: "center", vertical: "center" } } };

    ws[cellAddr(r, 7)] = {
      t: "n",
      f: `IF(${cellAddr(r, 6)}=0,"N/A",${annualCell}/${cellAddr(r, 6)})`,
      s: { alignment: { horizontal: "center", vertical: "center" }, numFmt: "0.0%" }
    };

    const buildQuarterFormula = (prog: string, mIndices: number[]) => {
      const cells = mIndices.map(m => monthTotalMap[`${prog}_${m}`]);
      return `SUM(${cells.join(",")})`;
    };
    ws[cellAddr(r, 8)] = { t: "n", f: buildQuarterFormula(prog, [0, 1, 2]), s: { alignment: { horizontal: "center", vertical: "center" } } };
    ws[cellAddr(r, 9)] = { t: "n", f: buildQuarterFormula(prog, [3, 4, 5]), s: { alignment: { horizontal: "center", vertical: "center" } } };
    ws[cellAddr(r, 10)] = { t: "n", f: buildQuarterFormula(prog, [6, 7, 8]), s: { alignment: { horizontal: "center", vertical: "center" } } };
    ws[cellAddr(r, 11)] = { t: "n", f: buildQuarterFormula(prog, [9, 10, 11]), s: { alignment: { horizontal: "center", vertical: "center" } } };

    ws[cellAddr(r, 12)] = {
      t: "n",
      f: `MAX(0, ${cellAddr(r, 6)}-${annualCell})`,
      s: { alignment: { horizontal: "center", vertical: "center" } }
    };

    currentRow++;
  }

  const grandTotalRow = currentRow;
  ws[cellAddr(grandTotalRow, 3)] = {
    v: "Total Days", t: "s",
    s: { font: { bold: true }, border: { top: { style: "double", color: { rgb: "000000" } } }, alignment: { vertical: "center" } }
  };
  // FIXED: FIX 5 — use TIMETABLE_PROGRAMS.length instead of hardcoded 6
  const eCells = Array.from({ length: TIMETABLE_PROGRAMS.length }, (_, i) => cellAddr(summaryStartRow + 1 + i, 4));
  ws[cellAddr(grandTotalRow, 4)] = {
    t: "n", f: `SUM(${eCells.join(",")})`,
    s: { font: { bold: true }, border: { top: { style: "double", color: { rgb: "000000" } } }, alignment: { horizontal: "center", vertical: "center" } }
  };
  ws[cellAddr(grandTotalRow, 5)] = {
    t: "n", f: `${cellAddr(grandTotalRow, 4)}/4`,
    s: { font: { bold: true }, border: { top: { style: "double", color: { rgb: "000000" } } }, alignment: { horizontal: "center", vertical: "center" }, numFmt: "0.0" }
  };
  ws[cellAddr(grandTotalRow, 6)] = {
    v: "", t: "s",
    s: { font: { bold: true }, border: { top: { style: "double", color: { rgb: "000000" } } } }
  };
  ws[cellAddr(grandTotalRow, 7)] = {
    v: "", t: "s",
    s: { font: { bold: true }, border: { top: { style: "double", color: { rgb: "000000" } } } }
  };
  for (let c = 8; c <= 11; c++) {
    const qCells = Array.from({ length: TIMETABLE_PROGRAMS.length }, (_, i) => cellAddr(summaryStartRow + 1 + i, c));
    ws[cellAddr(grandTotalRow, c)] = {
      t: "n", f: `SUM(${qCells.join(",")})`,
      s: { font: { bold: true }, border: { top: { style: "double", color: { rgb: "000000" } } }, alignment: { horizontal: "center", vertical: "center" } }
    };
  }
  ws[cellAddr(grandTotalRow, 12)] = {
    v: "", t: "s",
    s: { font: { bold: true }, border: { top: { style: "double", color: { rgb: "000000" } } } }
  };
  currentRow++;

  ws[cellAddr(currentRow, 3)] = { v: "Training days 1st Half annual", t: "s" };
  ws[cellAddr(currentRow, 4)] = { t: "n", f: `${cellAddr(grandTotalRow, 8)}+${cellAddr(grandTotalRow, 9)}`, s: { alignment: { horizontal: "center" } } };
  const firstHalfCell = cellAddr(currentRow, 4);
  currentRow++;

  ws[cellAddr(currentRow, 3)] = { v: "Training days 2nd Half annual", t: "s" };
  ws[cellAddr(currentRow, 4)] = { t: "n", f: `${cellAddr(grandTotalRow, 10)}+${cellAddr(grandTotalRow, 11)}`, s: { alignment: { horizontal: "center" } } };
  const secondHalfCell = cellAddr(currentRow, 4);
  currentRow++;

  ws[cellAddr(currentRow, 3)] = { v: "Total Days", t: "s", s: { font: { bold: true } } };
  ws[cellAddr(currentRow, 4)] = { t: "n", f: `${firstHalfCell}+${secondHalfCell}`, s: { font: { bold: true }, alignment: { horizontal: "center" } } };
  const finalTotalCell = cellAddr(currentRow, 4);
  currentRow++;

  ws[cellAddr(currentRow, 4)] = { t: "n", f: `${firstHalfCell}/${finalTotalCell}`, s: { numFmt: "0.00%", alignment: { horizontal: "center" } } };
  ws[cellAddr(currentRow, 5)] = { t: "n", f: `${secondHalfCell}/${finalTotalCell}`, s: { numFmt: "0.00%", alignment: { horizontal: "center" } } };
  currentRow++;

  const rMonthStart = summaryStartRow;
  ws[cellAddr(rMonthStart, 38)] = { v: "Month", t: "s", s: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: HEADER_FILL } }, alignment: { horizontal: "center" } } };
  ws[cellAddr(rMonthStart, 39)] = { v: "Days", t: "s", s: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: HEADER_FILL } }, alignment: { horizontal: "center" } } };
  
  let monthCursor = rMonthStart + 1;
  const allMonthTotals = [];
  ws["!rows"] = [];

  const allMonthsArray = Array.isArray(snapshot.months) ? snapshot.months : [];
  for (let m = 0; m < allMonthsArray.length; m++) {
    const monthName = allMonthsArray[m].monthName;
    ws[cellAddr(monthCursor, 38)] = { v: monthName, t: "s", s: { alignment: { horizontal: "center" } } };
    const monthProgCells = TIMETABLE_PROGRAMS.map(prog => monthTotalMap[`${prog}_${m}`]);
    ws[cellAddr(monthCursor, 39)] = { t: "n", f: `SUM(${monthProgCells.join(",")})`, s: { alignment: { horizontal: "center" } } };
    allMonthTotals.push(cellAddr(monthCursor, 39));
    monthCursor++;
  }
  ws[cellAddr(monthCursor, 38)] = { v: "Total", t: "s", s: { font: { bold: true }, alignment: { horizontal: "center" } } };
  ws[cellAddr(monthCursor, 39)] = { t: "n", f: `SUM(${allMonthTotals.join(",")})`, s: { font: { bold: true }, alignment: { horizontal: "center" } } };

  ws["!ref"] = rangeAddr(0, 0, Math.max(currentRow, monthCursor), 39);
  ws["!freeze"] = { xSplit: 2, ySplit: 2, topLeftCell: "C3" };

  XlsxStyle.utils.book_append_sheet(wb, ws, "Timetable");
  return XlsxStyle.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
}
