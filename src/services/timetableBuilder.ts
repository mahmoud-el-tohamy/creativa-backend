import { TrainingSession, getFiscalYear, TIMETABLE_PROGRAMS, TimetableProgram } from "../models/TrainingSession";
import { TimetableSnapshot, IMonthData, IAnnualTotal, IQuarterlyData } from "../models/TimetableSnapshot";
import { PlannedTimetable } from "../models/PlannedTimetable";

// ─── Arabic month names in fiscal-year order ─────────────────────────────────
// Fiscal year: May(Y), Jun(Y), Jul(Y), Aug(Y), Sep(Y), Oct(Y), Nov(Y), Dec(Y),
//              Jan(Y+1), Feb(Y+1), Mar(Y+1), Apr(Y+1)

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

/**
 * Returns the ordered list of {monthIndex, year} for a given fiscal year.
 * Fiscal year "FY2025-2026" → May 2025 ... Apr 2026
 */
function getFiscalYearMonths(fiscalYear: string): Array<{ monthIndex: number; year: number }> {
  // Parse "FY2025-2026" → startYear = 2025
  const startYear = parseInt(fiscalYear.slice(2, 6), 10);
  const months: Array<{ monthIndex: number; year: number }> = [];

  // May (4) → Dec (11) of startYear
  for (let m = 4; m <= 11; m++) {
    months.push({ monthIndex: m, year: startYear });
  }
  // Jan (0) → Apr (3) of startYear+1
  for (let m = 0; m <= 3; m++) {
    months.push({ monthIndex: m, year: startYear + 1 });
  }
  return months;
}

/** Returns the number of days in a given month/year */
function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Maps a fiscal-year month position (0=May, 1=Jun, ...) to its quarter.
 * Q1: May-Jul (indices 0-2)
 * Q2: Aug-Oct (indices 3-5)
 * Q3: Nov-Jan (indices 6-8)
 * Q4: Feb-Apr (indices 9-11)
 */
function getQuarterForFYMonthIndex(fyMonthPos: number): "Q1" | "Q2" | "Q3" | "Q4" {
  if (fyMonthPos <= 2) return "Q1";
  if (fyMonthPos <= 5) return "Q2";
  if (fyMonthPos <= 8) return "Q3";
  return "Q4";
}

// ─── Core rebuild function ────────────────────────────────────────────────────

/**
 * Rebuilds the TimetableSnapshot for the given fiscal year by aggregating
 * all TrainingSession documents. Upserts the result into TimetableSnapshot.
 */
export async function rebuildTimetableSnapshot(
  fiscalYear: string,
  updatedBy = "system"
): Promise<void> {
  console.log(`[TimetableBuilder] Rebuilding snapshot for ${fiscalYear}...`);

  // 1. Fetch all sessions for this fiscal year
  const sessions = await TrainingSession.find({ fiscalYear }).lean();

  // 2. Generate the 12 fiscal-year months in order
  const fyMonths = getFiscalYearMonths(fiscalYear);

  // 3. Build a lookup: "YYYY-MM" → { timetableProgram → day → dayValue }
  type DayMap = Record<number, number>;
  type ProgramMap = Partial<Record<TimetableProgram, DayMap>>;
  const monthSessionMap: Record<string, ProgramMap> = {};
  const monthConsultationMap: Record<string, Record<string, Set<number>>> = {};
  const monthConsultationTotalMap: Record<string, Record<string, number>> = {};

  // Fetch the planned timetable for this fiscal year to populate targetDays
  const plan = await PlannedTimetable.findOne({ fiscalYear }).lean();

  for (const session of sessions) {
    if (session.programName === "Incubation") continue;
    const d = new Date(session.date);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    const day = d.getDate();
    const prog = session.timetableProgram as TimetableProgram;

    if (session.type === "Consultation") {
      if (!monthConsultationMap[key]) monthConsultationMap[key] = {};
      if (!monthConsultationMap[key][prog]) monthConsultationMap[key][prog] = new Set();
      monthConsultationMap[key][prog].add(day);

      if (!monthConsultationTotalMap[key]) monthConsultationTotalMap[key] = {};
      if (!monthConsultationTotalMap[key][prog]) monthConsultationTotalMap[key][prog] = 0;
      monthConsultationTotalMap[key][prog] += session.dayValue;
    } else {
      if (!monthSessionMap[key]) monthSessionMap[key] = {};
      if (!monthSessionMap[key][prog]) monthSessionMap[key][prog] = {};

      const existing = monthSessionMap[key][prog]![day] ?? 0;
      monthSessionMap[key][prog]![day] = existing + session.dayValue;
    }
  }

  // 4. Build IMonthData array
  type ProgramDayMapObj = { monthTotal: number; consultationTotal?: number } & Record<number, number>;
  type ProgramsObj = Record<TimetableProgram, ProgramDayMapObj>;

  const monthsData: IMonthData[] = fyMonths.map(({ monthIndex, year }, fyPos) => {
    const key = `${year}-${String(monthIndex).padStart(2, "0")}`;
    const programLookup = monthSessionMap[key] ?? {};
    const daysInMonth = getDaysInMonth(year, monthIndex);

    const programs = {} as ProgramsObj;
    let monthlyDays = 0;

    for (const prog of TIMETABLE_PROGRAMS) {
      const dayMap = programLookup[prog] ?? {};
      let monthTotal = 0;
      const progEntry: ProgramDayMapObj = { monthTotal: 0, consultationTotal: 0 };

      for (let day = 1; day <= daysInMonth; day++) {
        if (dayMap[day] !== undefined && dayMap[day] > 0) {
          progEntry[day] = dayMap[day];
          monthTotal += dayMap[day];
        }
      }

      const consTotalLookup = monthConsultationTotalMap[key] ?? {};
      const consultationTotal = consTotalLookup[prog] ?? 0;

      progEntry.consultationTotal = consultationTotal;
      progEntry.monthTotal = monthTotal + consultationTotal;
      monthlyDays += progEntry.monthTotal;
      programs[prog] = progEntry;
    }

    const consLookup = monthConsultationMap[key] ?? {};
    const consultations: Record<string, number[]> = {};
    for (const [p, daysSet] of Object.entries(consLookup)) {
      consultations[p] = Array.from(daysSet).sort((a, b) => a - b);
    }

    return {
      monthIndex,
      monthName: ARABIC_MONTH_NAMES[monthIndex],
      year,
      daysInMonth,
      monthlyDays,
      programs,
      consultations,
    } as IMonthData;
  });

  // 5. Build annualTotals and quarterly breakdown
  const quarterMap: Record<"Q1" | "Q2" | "Q3" | "Q4", Record<TimetableProgram, number>> = {
    Q1: {} as Record<TimetableProgram, number>,
    Q2: {} as Record<TimetableProgram, number>,
    Q3: {} as Record<TimetableProgram, number>,
    Q4: {} as Record<TimetableProgram, number>,
  };

  // Initialize
  for (const q of ["Q1", "Q2", "Q3", "Q4"] as const) {
    for (const prog of TIMETABLE_PROGRAMS) {
      quarterMap[q][prog] = 0;
    }
  }

  // Accumulate
  fyMonths.forEach(({ monthIndex, year }, fyPos) => {
    const quarter = getQuarterForFYMonthIndex(fyPos);
    const monthData = monthsData[fyPos];
    for (const prog of TIMETABLE_PROGRAMS) {
      quarterMap[quarter][prog] += monthData.programs[prog]?.monthTotal ?? 0;
    }
  });

  const annualTotals: IAnnualTotal[] = TIMETABLE_PROGRAMS.map((prog) => {
    const q1 = quarterMap.Q1[prog];
    const q2 = quarterMap.Q2[prog];
    const q3 = quarterMap.Q3[prog];
    const q4 = quarterMap.Q4[prog];
    const totalDays = q1 + q2 + q3 + q4;
    const targetDays = plan?.programTotals?.[prog]?.total ?? 0;
    const completionPct = targetDays > 0 ? (totalDays / targetDays) * 100 : 0;
    return {
      program: prog,
      totalDays,
      targetDays,
      completionPct,
      q1,
      q2,
      q3,
      q4,
    };
  });

  // 6. Build quarterly summary
  const quarterlyData: IQuarterlyData[] = (["Q1", "Q2", "Q3", "Q4"] as const).map((q, qi) => {
    const qMonths = fyMonths.slice(qi * 3, qi * 3 + 3).map(({ monthIndex }) => ARABIC_MONTH_NAMES[monthIndex]);
    const totalDays = TIMETABLE_PROGRAMS.reduce((sum, prog) => sum + quarterMap[q][prog], 0);
    return {
      quarter: q,
      months: qMonths,
      totalDays,
      // firstHalf = Q1+Q2, secondHalf = Q3+Q4 — computed in aggregate at the snapshot level
      firstHalfDays: 0,
      secondHalfDays: 0,
    };
  });

  // Compute half-totals
  const firstHalfDays = quarterlyData[0].totalDays + quarterlyData[1].totalDays;
  const secondHalfDays = quarterlyData[2].totalDays + quarterlyData[3].totalDays;
  quarterlyData.forEach((q) => {
    q.firstHalfDays = firstHalfDays;
    q.secondHalfDays = secondHalfDays;
  });

  // 7. Compute totals
  const totalDays = annualTotals.reduce((sum, a) => sum + a.totalDays, 0);

  // 8. Upsert the snapshot
  await TimetableSnapshot.findOneAndUpdate(
    { fiscalYear },
    {
      $set: {
        fiscalYear,
        months: monthsData,
        annualTotals,
        quarterly: quarterlyData,
        totalDays,
        sessionCount: sessions.length,
        lastUpdated: new Date(),
        lastUpdatedBy: updatedBy,
      },
    },
    { upsert: true, new: true }
  );

  console.log(`[TimetableBuilder] Snapshot for ${fiscalYear} rebuilt. Sessions: ${sessions.length}, Total Days: ${totalDays}`);
}

/**
 * Fire-and-forget wrapper: determines the fiscal year from the session date
 * and calls rebuildTimetableSnapshot. Errors are logged but not re-thrown.
 */
export async function rebuildAfterSessionChange(
  sessionDate: Date,
  updatedBy = "system"
): Promise<void> {
  const fiscalYear = getFiscalYear(sessionDate);
  try {
    await rebuildTimetableSnapshot(fiscalYear, updatedBy);
  } catch (err) {
    console.error(`[TimetableBuilder] Error rebuilding snapshot for ${fiscalYear}:`, err);
  }
}
