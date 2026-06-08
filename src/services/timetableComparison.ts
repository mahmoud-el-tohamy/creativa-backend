import { PlannedTimetable, FY_CALENDAR_MONTHS } from "../models/PlannedTimetable";
import { TimetableSnapshot } from "../models/TimetableSnapshot";
import { TIMETABLE_PROGRAMS } from "../models/TrainingSession";
import { rebuildTimetableSnapshot } from "./timetableBuilder";

// ─── Arabic month names (calendar index → name) ───────────────────────────────

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

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface ComparisonCell {
  planned: number; // from PlannedTimetable
  actual: number;  // from TimetableSnapshot
  diff: number;    // actual - planned
}

export interface ProgramComparison {
  program: string;
  plannedTotal: number;
  actualTotal: number;
  diffTotal: number;
  completionPct: number; // (actual/planned)*100, 0 if planned=0
  q1Planned: number;
  q1Actual: number;
  q1Diff: number;
  q2Planned: number;
  q2Actual: number;
  q2Diff: number;
  q3Planned: number;
  q3Actual: number;
  q3Diff: number;
  q4Planned: number;
  q4Actual: number;
  q4Diff: number;
}

export interface MonthlyDiffEntry {
  monthIndex: number;
  monthName: string;
  programs: {
    [program: string]: {
      [day: number]: ComparisonCell;
      monthPlanned: number;
      monthActual: number;
      monthDiff: number;
    };
  };
}

export interface TimetableComparison {
  fiscalYear: string;

  /**
   * Per-cell diff for the Difference calendar grid.
   * Ordered May→Apr (12 entries).
   */
  monthlyDiff: MonthlyDiffEntry[];

  /** Per-program summary for Percentage sheet */
  programComparisons: ProgramComparison[];

  grandPlanned: number;
  grandActual: number;
  grandDiff: number;
  overallCompletionPct: number;
}

// ─── Helper: FY position → quarter key ───────────────────────────────────────

function fyPosToQuarter(fyPos: number): "q1" | "q2" | "q3" | "q4" {
  if (fyPos <= 2) return "q1";
  if (fyPos <= 5) return "q2";
  if (fyPos <= 8) return "q3";
  return "q4";
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function computeComparison(fiscalYear: string): Promise<TimetableComparison> {
  // 1. Fetch both documents in parallel
  const [plannedDoc, snapshotDoc] = await Promise.all([
    PlannedTimetable.findOne({ fiscalYear }).lean(),
    TimetableSnapshot.findOne({ fiscalYear }).lean(),
  ]);

  // 2. If snapshot not found, attempt a rebuild then re-fetch
  let snapshot = snapshotDoc;
  if (!snapshot) {
    await rebuildTimetableSnapshot(fiscalYear, "system");
    snapshot = await TimetableSnapshot.findOne({ fiscalYear }).lean();
  }

  // 3. Use zero-filled structure when planned doc doesn't exist
  const plannedData: IPlannedTimetableData =
    (plannedDoc?.data as IPlannedTimetableData | undefined) ?? buildEmptyPlannedData();

  // ── Build lookup: snapshotMonthMap[calMonthIndex] → programs map
  type SnapshotProgramsMap = Record<string, Record<number, number>>;
  const snapshotMonthMap: Record<number, SnapshotProgramsMap> = {};

  if (snapshot && Array.isArray(snapshot.months)) {
    for (const monthData of snapshot.months) {
      const programs: SnapshotProgramsMap = {};
      for (const prog of TIMETABLE_PROGRAMS) {
        const progData = ((monthData.programs as Record<string, Record<number, number>>) || {})[prog] ?? {};
        programs[prog] = progData;
      }
      snapshotMonthMap[monthData.monthIndex] = programs;
    }
  }

  // ── Accumulators for program comparisons
  const progAccum: Record<
    string,
    {
      plannedTotal: number;
      actualTotal: number;
      q1Planned: number; q1Actual: number;
      q2Planned: number; q2Actual: number;
      q3Planned: number; q3Actual: number;
      q4Planned: number; q4Actual: number;
    }
  > = {};

  for (const prog of TIMETABLE_PROGRAMS) {
    progAccum[prog] = {
      plannedTotal: 0, actualTotal: 0,
      q1Planned: 0, q1Actual: 0,
      q2Planned: 0, q2Actual: 0,
      q3Planned: 0, q3Actual: 0,
      q4Planned: 0, q4Actual: 0,
    };
  }

  // 4. Build monthlyDiff — iterate over FY calendar months in order (May→Apr)
  const monthlyDiff: MonthlyDiffEntry[] = FY_CALENDAR_MONTHS.map((calMonth, fyPos) => {
    const quarter = fyPosToQuarter(fyPos);
    const monthPrograms: MonthlyDiffEntry["programs"] = {};

    for (const prog of TIMETABLE_PROGRAMS) {
      const plannedMonth = (plannedData[prog] ?? {})[String(calMonth)] ?? {};
      const actualMonth = snapshotMonthMap[calMonth]?.[prog] ?? {};

      // Collect all days that appear in either map
      const allDays = new Set<number>([
        ...Object.keys(plannedMonth).map(Number),
        ...Object.keys(actualMonth).map(Number),
      ]);

      let monthPlanned = 0;
      let monthActual = 0;
      const dayEntries: { [day: number]: ComparisonCell } = {};

      for (const day of allDays) {
        if (isNaN(day) || day < 1 || day > 31) continue;
        const planned = plannedMonth[String(day)] ?? 0;
        const actual = actualMonth[day] ?? 0;
        const diff = actual - planned;
        dayEntries[day] = { planned, actual, diff };
        monthPlanned += planned;
        monthActual += actual;
      }

      const monthDiff = monthActual - monthPlanned;

      monthPrograms[prog] = {
        ...dayEntries,
        monthPlanned,
        monthActual,
        monthDiff,
      };

      // Accumulate program-level totals
      progAccum[prog].plannedTotal += monthPlanned;
      progAccum[prog].actualTotal += monthActual;
      progAccum[prog][`${quarter}Planned`] += monthPlanned;
      progAccum[prog][`${quarter}Actual`] += monthActual;
    }

    return {
      monthIndex: calMonth,
      monthName: ARABIC_MONTH_NAMES[calMonth],
      programs: monthPrograms,
    };
  });

  // 5. Build programComparisons
  const programComparisons: ProgramComparison[] = TIMETABLE_PROGRAMS.map((prog) => {
    const acc = progAccum[prog];
    const diffTotal = acc.actualTotal - acc.plannedTotal;
    const completionPct = acc.plannedTotal > 0
      ? (acc.actualTotal / acc.plannedTotal) * 100
      : 0;

    return {
      program: prog,
      plannedTotal: acc.plannedTotal,
      actualTotal: acc.actualTotal,
      diffTotal,
      completionPct,
      q1Planned: acc.q1Planned,
      q1Actual: acc.q1Actual,
      q1Diff: acc.q1Actual - acc.q1Planned,
      q2Planned: acc.q2Planned,
      q2Actual: acc.q2Actual,
      q2Diff: acc.q2Actual - acc.q2Planned,
      q3Planned: acc.q3Planned,
      q3Actual: acc.q3Actual,
      q3Diff: acc.q3Actual - acc.q3Planned,
      q4Planned: acc.q4Planned,
      q4Actual: acc.q4Actual,
      q4Diff: acc.q4Actual - acc.q4Planned,
    };
  });

  // 6. Grand totals
  const grandPlanned = programComparisons.reduce((s, p) => s + p.plannedTotal, 0);
  const grandActual = programComparisons.reduce((s, p) => s + p.actualTotal, 0);
  const grandDiff = grandActual - grandPlanned;
  const overallCompletionPct = grandPlanned > 0
    ? (grandActual / grandPlanned) * 100
    : 0;

  return {
    fiscalYear,
    monthlyDiff,
    programComparisons,
    grandPlanned,
    grandActual,
    grandDiff,
    overallCompletionPct,
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

type IPlannedTimetableData = {
  [program: string]: { [monthIndex: string]: { [day: string]: number } };
};

function buildEmptyPlannedData(): IPlannedTimetableData {
  const data: IPlannedTimetableData = {};
  for (const prog of TIMETABLE_PROGRAMS) {
    data[prog] = {};
    for (const calMonth of FY_CALENDAR_MONTHS) {
      data[prog][String(calMonth)] = {};
    }
  }
  return data;
}
