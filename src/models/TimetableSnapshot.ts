import mongoose, { Schema, Document, Types } from "mongoose";
import { TIMETABLE_PROGRAMS, TimetableProgram } from "./TrainingSession";

// ─── Sub-document interfaces ─────────────────────────────────────────────────

export interface IProgramDayMap {
  [day: number]: number; // day-of-month → dayValue
  monthTotal: number;
}

export interface IMonthData {
  monthIndex: number;   // 0-11
  monthName: string;    // Arabic name e.g. "مايو"
  year: number;
  daysInMonth: number;
  monthlyDays: number;  // sum of all program monthTotals for this month
  programs: Record<TimetableProgram, IProgramDayMap>;
}

export interface IAnnualTotal {
  program: TimetableProgram;
  totalDays: number;
  targetDays: number;
  completionPct: number;
  q1: number;
  q2: number;
  q3: number;
  q4: number;
}

export interface IQuarterlyData {
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  months: string[];
  totalDays: number;
  firstHalfDays: number;
  secondHalfDays: number;
}

// ─── Main interface ───────────────────────────────────────────────────────────

export interface ITimetableSnapshot extends Document {
  _id: Types.ObjectId;
  fiscalYear: string;
  months: IMonthData[];
  annualTotals: IAnnualTotal[];
  quarterly: IQuarterlyData[];
  totalDays: number;
  sessionCount: number;
  lastUpdated: Date;
  lastUpdatedBy: string;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const annualTotalSchema = new Schema<IAnnualTotal>(
  {
    program: { type: String, enum: TIMETABLE_PROGRAMS, required: true },
    totalDays: { type: Number, default: 0 },
    targetDays: { type: Number, default: 0 },
    completionPct: { type: Number, default: 0 },
    q1: { type: Number, default: 0 },
    q2: { type: Number, default: 0 },
    q3: { type: Number, default: 0 },
    q4: { type: Number, default: 0 },
  },
  { _id: false }
);

const quarterlyDataSchema = new Schema<IQuarterlyData>(
  {
    quarter: { type: String, enum: ["Q1", "Q2", "Q3", "Q4"], required: true },
    months: [{ type: String }],
    totalDays: { type: Number, default: 0 },
    firstHalfDays: { type: Number, default: 0 },
    secondHalfDays: { type: Number, default: 0 },
  },
  { _id: false }
);

// Month data uses Mixed since programs is a dynamic map
const monthDataSchema = new Schema<IMonthData>(
  {
    monthIndex: { type: Number, required: true },
    monthName: { type: String, required: true },
    year: { type: Number, required: true },
    daysInMonth: { type: Number, required: true },
    monthlyDays: { type: Number, default: 0 },
    programs: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

// ─── Main schema ─────────────────────────────────────────────────────────────

const timetableSnapshotSchema = new Schema<ITimetableSnapshot>(
  {
    fiscalYear: { type: String, required: true, unique: true },
    months: [monthDataSchema],
    annualTotals: [annualTotalSchema],
    quarterly: [quarterlyDataSchema],
    totalDays: { type: Number, default: 0 },
    sessionCount: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now },
    lastUpdatedBy: { type: String, default: "system" },
  },
  { timestamps: false }
);

timetableSnapshotSchema.index({ fiscalYear: 1 }, { unique: true });

// ─── Model ───────────────────────────────────────────────────────────────────

export const TimetableSnapshot = mongoose.model<ITimetableSnapshot>(
  "TimetableSnapshot",
  timetableSnapshotSchema
);
