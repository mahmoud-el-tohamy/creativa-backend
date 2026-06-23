import mongoose, { Schema, Document, Types } from "mongoose";
import type { IInstructor } from "./Instructor";
// PERF FIX 4 — static import instead of dynamic import("./Instructor") inside the post-save hook.
// No circular dependency: Instructor.ts does NOT import from TrainingSession.ts.
// Impact: Avoids repeated dynamic module resolution overhead on every session.save() call.
import { Instructor } from "./Instructor";

// ─── Enums & Types ──────────────────────────────────────────────────────────

export const PROGRAM_NAMES = [
  "Career Development",
  "Tech",
  "Freelancing",
  "Entrepreneurship",
  "Awareness event",
  "Hackathons / Competitions",
  "Acceleration program",
  "Incubation",
] as const;

export type ProgramName = (typeof PROGRAM_NAMES)[number];

export const TIMETABLE_PROGRAMS = [
  "Entrepreneurship / Technology transfer",
  "Awareness events",
  "Acceleration program",
  "Freelancing coaches",
  "Hackathons / Competitions",
  "Career development",
] as const;

export type TimetableProgram = (typeof TIMETABLE_PROGRAMS)[number];

// ─── Pure helper functions ───────────────────────────────────────────────────

/**
 * Returns the fiscal year label for a given date.
 * FIXED: FIX 1 — FY starts May 1 of year Y and ends Apr 30 of year Y+1.
 * Example: May 1, 2025 → "FY2025-2026"; Apr 30, 2025 → "FY2024-2025"
 */
export function getFiscalYear(date: Date): string {
  const month = date.getMonth(); // 0-based
  const year = date.getFullYear();
  // May = month 4
  if (month >= 4) {
    // May 1 or later → FY{year}-{year+1}
    return `FY${year}-${year + 1}`;
  } else {
    // Before May → FY{year-1}-{year}
    return `FY${year - 1}-${year}`;
  }
}

/**
 * Maps an input program name to its timetable row label.
 * Both "Tech" and "Entrepreneurship" map to "Entrepreneurship / Technology transfer".
 */
export function mapProgramToTimetableRow(program: string): TimetableProgram {
  const map: Record<string, TimetableProgram> = {
    "Entrepreneurship": "Entrepreneurship / Technology transfer",
    "Tech": "Entrepreneurship / Technology transfer",
    "Awareness event": "Awareness events",
    "Acceleration program": "Acceleration program",
    "Freelancing": "Freelancing coaches",
    "Hackathons / Competitions": "Hackathons / Competitions",
    "Career Development": "Career development",
  };
  return map[program] ?? "Career development";
}

/**
 * Computes the dayValue from the number of training hours.
 * FIXED: FIX 2 — hours < 5 → 0.5 (half day); hours >= 5 → 1.0 (full day)
 * Examples: 4.25 → 0.5, 4.99 → 0.5, 5.0 → 1.0, 5.5 → 1.0
 */
export function computeDayValue(hours: number): number {
  return hours < 5 ? 0.5 : 1.0; // FIXED: FIX 2 — was `hours <= 4`
}

// ─── Interface ───────────────────────────────────────────────────────────────

export interface ITrainingSession extends Document {
  _id: Types.ObjectId;

  // Core fields
  programName: ProgramName;
  sessionName: string;
  date: Date;
  hours: number;
  mode: "online" | "offline";
  instructorId: Types.ObjectId | null; // FIXED: FIX 3 — optional
  instructorName: string; // FIXED: FIX 3 — optional (empty string when no instructor)
  attendeesCount: number;
  type: "Training" | "Awareness Event" | "Incubation" | "Consultation";
  evaluationReportUrl: string;
  trainingReportUrl: string;
  isPaid: boolean;

  // Computed fields (set by pre-save hook)
  dayValue: number;
  timetableProgram: TimetableProgram;
  fiscalYear: string;

  // Audit
  createdBy: Types.ObjectId;
  createdByName: string;
  updatedBy: Types.ObjectId | null;
  updatedAt: Date;
  createdAt: Date;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const trainingSessionSchema = new Schema<ITrainingSession>(
  {
    programName: { type: String, enum: PROGRAM_NAMES, required: true },
    sessionName: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    hours: { type: Number, required: true, min: 0.5, max: 24 },
    mode: { type: String, enum: ["online", "offline"], required: true },
    instructorId: { type: Schema.Types.ObjectId, ref: "Instructor", required: false, default: null }, // FIXED: FIX 3
    instructorName: { type: String, required: false, default: "", trim: true }, // FIXED: FIX 3
    attendeesCount: { type: Number, required: true, min: 0, default: 0 },
    type: { type: String, enum: ["Training", "Awareness Event", "Incubation", "Consultation"], required: true },
    evaluationReportUrl: { type: String, default: "" },
    trainingReportUrl: { type: String, default: "" },
    isPaid: { type: Boolean, default: true },

    // Computed — auto-populated by pre-save hook
    dayValue: { type: Number, default: 0.5 },
    timetableProgram: { type: String, default: "Career development" },
    fiscalYear: { type: String, default: "" },

    // Audit
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdByName: { type: String, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// ─── Pre-save hook ───────────────────────────────────────────────────────────

trainingSessionSchema.pre("save", async function () {
  this.dayValue = computeDayValue(this.hours);
  this.timetableProgram = mapProgramToTimetableRow(this.programName);
  this.fiscalYear = getFiscalYear(this.date);
});

// ─── Post-save hook — auto-sync instructor specializations ────────────────────

const SPECIALIZATION_EXCLUDED_PROGRAMS = [
  "Hackathons / Competitions",
  "Consultation & Mentorship",
  "Awareness event",
] as const;

trainingSessionSchema.post("save", async function () {
  // PERF FIX 4 — Skip the instructor specialization sync when neither programName nor
  // instructorId was actually modified. Previously this extra findByIdAndUpdate fired on
  // EVERY session.save(), including partial updates (e.g. hours-only edits).
  // Impact: Eliminates the redundant DB write for the common partial-update case.
  const programOrInstructorChanged =
    this.isNew ||
    this.isModified("programName") ||
    this.isModified("instructorId");

  if (!programOrInstructorChanged) return;

  if (
    this.instructorId &&
    this.programName &&
    !(SPECIALIZATION_EXCLUDED_PROGRAMS as readonly string[]).includes(this.programName)
  ) {
    // Static Instructor import used here (no circular dependency — see import at top of file)
    await (Instructor as mongoose.Model<IInstructor>).findByIdAndUpdate(
      this.instructorId,
      { $addToSet: { specializations: this.programName } },
      { new: false }
    );
  }
});

// ─── Indexes ─────────────────────────────────────────────────────────────────

trainingSessionSchema.index({ date: 1 });
trainingSessionSchema.index({ fiscalYear: 1, timetableProgram: 1 });
trainingSessionSchema.index({ fiscalYear: 1, date: 1 });
trainingSessionSchema.index({ programName: 1 });
// Used by per-instructor dashboard (getInstructorDashboard): instructorId is the leading filter
trainingSessionSchema.index({ instructorId: 1, date: 1 });
// PERF FIX 3 — Used by getAccountantDashboard: queries { date:{$gte,$lte}, instructorId:{$exists,$ne:null} }
// date-range is the leading filter so date must lead the index. The existing instructorId-first
// index above handles per-instructor queries; this handles the date-range-first pattern.
// Impact: Allows the accountant dashboard to use a date-range prefix scan instead of a collection scan.
trainingSessionSchema.index({ date: 1, instructorId: 1 });
// PERF FIX 5 — Used by bulk import deduplication $or query: { sessionName, date, instructorId }.
// date leads because it has the highest cardinality in the triple (most entries eliminated per day match).
// Impact: Replaces a full collection scan per import with an indexed lookup bounded per date.
trainingSessionSchema.index({ date: 1, sessionName: 1, instructorId: 1 });


// ─── Model ───────────────────────────────────────────────────────────────────

export const TrainingSession = mongoose.model<ITrainingSession>(
  "TrainingSession",
  trainingSessionSchema
);
