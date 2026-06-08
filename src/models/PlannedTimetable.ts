import mongoose, { Schema, Document, Types, Model } from "mongoose";
import { TIMETABLE_PROGRAMS } from "./TrainingSession";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface IProgramMonthData {
  [day: string]: number; // day (1-31) → value (0 | 0.5 | 1)
}

export interface IProgramYearData {
  [monthIndex: string]: IProgramMonthData; // monthIndex (0-11) → day map
}

export interface IProgramTotal {
  total: number;
  monthly: { [monthIndex: string]: number };
  q1: number; // May + Jun + Jul  (FY month positions 0,1,2)
  q2: number; // Aug + Sep + Oct  (FY month positions 3,4,5)
  q3: number; // Nov + Dec + Jan  (FY month positions 6,7,8)
  q4: number; // Feb + Mar + Apr  (FY month positions 9,10,11)
}

export interface IPlannedTimetable extends Document {
  _id: Types.ObjectId;
  fiscalYear: string; // "FY2025-2026"

  /**
   * Nested structure: program → monthIndex(0-11, where 0=May) → day(1-31) → value
   * value: 0 | 0.5 | 1
   */
  data: {
    [program: string]: IProgramYearData;
  };

  /** Computed totals (denormalized for fast reads). Recomputed on every save. */
  programTotals: {
    [program: string]: IProgramTotal;
  };

  grandTotal: number;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  lastEditedBy: string;
  lastEditedByName: string;
}

// ─── Static method interface ──────────────────────────────────────────────────

interface IPlannedTimetableModel extends Model<IPlannedTimetable> {
  createEmpty(fiscalYear: string): Omit<IPlannedTimetable, keyof Document>;
}

// ─── Quarter mapping ──────────────────────────────────────────────────────────
// FY month positions: 0=May,1=Jun,2=Jul,3=Aug,4=Sep,5=Oct,6=Nov,7=Dec,8=Jan,9=Feb,10=Mar,11=Apr
// Calendar month indices: May=4,Jun=5,Jul=6,Aug=7,Sep=8,Oct=9,Nov=10,Dec=11,Jan=0,Feb=1,Mar=2,Apr=3

/**
 * Maps a calendar monthIndex (0-11) to its FY position (0-11, 0=May).
 * Needed because the data keys use calendar monthIndex.
 */
function calendarMonthToFYPosition(calendarMonth: number): number {
  // May(4)→0, Jun(5)→1, Jul(6)→2, Aug(7)→3, Sep(8)→4, Oct(9)→5,
  // Nov(10)→6, Dec(11)→7, Jan(0)→8, Feb(1)→9, Mar(2)→10, Apr(3)→11
  if (calendarMonth >= 4) return calendarMonth - 4;
  return calendarMonth + 8;
}

function getFYPositionQuarter(fyPos: number): "q1" | "q2" | "q3" | "q4" {
  if (fyPos <= 2) return "q1";
  if (fyPos <= 5) return "q2";
  if (fyPos <= 8) return "q3";
  return "q4";
}

// ─── Helper: recompute totals from data ──────────────────────────────────────

function recomputeTotals(data: IPlannedTimetable["data"]): {
  programTotals: IPlannedTimetable["programTotals"];
  grandTotal: number;
} {
  const programTotals: IPlannedTimetable["programTotals"] = {};
  let grandTotal = 0;

  for (const program of TIMETABLE_PROGRAMS) {
    const programData = data[program] ?? {};
    const monthly: { [monthIndex: string]: number } = {};
    let total = 0;
    let q1 = 0;
    let q2 = 0;
    let q3 = 0;
    let q4 = 0;

    // Iterate over all 12 calendar months (0-11) that could appear in data
    for (let calMonth = 0; calMonth <= 11; calMonth++) {
      const monthKey = String(calMonth);
      const monthData = programData[monthKey] ?? {};
      let monthTotal = 0;

      for (const dayKey of Object.keys(monthData)) {
        const val = monthData[dayKey] ?? 0;
        monthTotal += val;
      }

      monthly[monthKey] = monthTotal;
      total += monthTotal;

      const fyPos = calendarMonthToFYPosition(calMonth);
      const quarter = getFYPositionQuarter(fyPos);
      if (quarter === "q1") q1 += monthTotal;
      else if (quarter === "q2") q2 += monthTotal;
      else if (quarter === "q3") q3 += monthTotal;
      else q4 += monthTotal;
    }

    programTotals[program] = { total, monthly, q1, q2, q3, q4 };
    grandTotal += total;
  }

  return { programTotals, grandTotal };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const plannedTimetableSchema = new Schema<IPlannedTimetable>(
  {
    fiscalYear: { type: String, required: true, unique: true },
    data: { type: Schema.Types.Mixed, default: {} },
    programTotals: { type: Schema.Types.Mixed, default: {} },
    grandTotal: { type: Number, default: 0 },
    lastEditedBy: { type: String, default: "system" },
    lastEditedByName: { type: String, default: "System" },
  },
  { timestamps: true }
);

// ─── Pre-save hook: recompute programTotals and grandTotal ───────────────────

plannedTimetableSchema.pre("save", async function () {
  const { programTotals, grandTotal } = recomputeTotals(this.data as IPlannedTimetable["data"]);
  this.programTotals = programTotals;
  this.grandTotal = grandTotal;
});

// ─── Static method: createEmpty ──────────────────────────────────────────────

/**
 * Ordered calendar monthIndex values for a fiscal year (May→Apr).
 * FY position 0=May(4), 1=Jun(5), ..., 7=Dec(11), 8=Jan(0), 9=Feb(1), 10=Mar(2), 11=Apr(3)
 */
const FY_CALENDAR_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3];

plannedTimetableSchema.statics.createEmpty = function (
  fiscalYear: string
): Omit<IPlannedTimetable, keyof Document> {
  const data: IPlannedTimetable["data"] = {};
  const programTotals: IPlannedTimetable["programTotals"] = {};

  for (const program of TIMETABLE_PROGRAMS) {
    data[program] = {};
    const monthly: { [monthIndex: string]: number } = {};

    for (const calMonth of FY_CALENDAR_MONTHS) {
      const monthKey = String(calMonth);
      data[program][monthKey] = {};
      monthly[monthKey] = 0;
    }

    programTotals[program] = { total: 0, monthly, q1: 0, q2: 0, q3: 0, q4: 0 };
  }

  return {
    fiscalYear,
    data,
    programTotals,
    grandTotal: 0,
    lastEditedBy: "system",
    lastEditedByName: "System",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Omit<IPlannedTimetable, keyof Document>;
};

// ─── Index ────────────────────────────────────────────────────────────────────

plannedTimetableSchema.index({ fiscalYear: 1 }, { unique: true });

// ─── Model ────────────────────────────────────────────────────────────────────

export const PlannedTimetable = mongoose.model<IPlannedTimetable, IPlannedTimetableModel>(
  "PlannedTimetable",
  plannedTimetableSchema
);

// Re-export helpers for use in services
export { recomputeTotals, FY_CALENDAR_MONTHS };
