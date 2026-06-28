import mongoose, { Schema, Document, Types } from "mongoose";

// ─── IRatePeriod Interface ────────────────────────────────────────────────────

export interface IRatePeriod {
  _id: Types.ObjectId;
  startDate: Date;            // inclusive
  endDate: Date | null;       // inclusive; null = currently open-ended
  isCurrent: boolean;         // true for exactly one period at a time
  dailyTrainingRate: number;  // min 0
  dailyConsultationRate: number; // min 0
  createdAt: Date;
  createdBy: Types.ObjectId;
  createdByName: string;
  note: string;               // optional free text, e.g. "تعديل بعد مراجعة العقد"
}

// ─── IInstructor Interface ────────────────────────────────────────────────────

export interface IInstructor extends Document {
  _id: Types.ObjectId;

  // Basic info
  name: string;
  isActive: boolean;

  // Profile fields
  specializations: string[];
  graduationYear: number | null;
  cvLink: string;

  // Historical rate periods (new system)
  ratePeriods: Types.DocumentArray<IRatePeriod & Document>;

  // DEPRECATED: superseded by ratePeriods[]. Kept temporarily for
  // backward-compat during migration. The CURRENT period's rates
  // should always be kept in sync with these fields via the
  // pre-save hook below, so any old code reading these fields
  // directly still gets a reasonable (current) value until all 6
  // calculation call sites are migrated to use ratePeriods.
  dailyTrainingRate: number;
  dailyConsultationRate: number;

  // Computed virtuals (NOT stored)
  hourlyTrainingRate: number;
  hourlyConsultationRate: number;

  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: Types.ObjectId | null;
  createdByName: string;
}

// ─── RatePeriod Sub-Schema ────────────────────────────────────────────────────

const RatePeriodSchema = new Schema<IRatePeriod & Document>(
  {
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    isCurrent: { type: Boolean, required: true, default: false },
    dailyTrainingRate: { type: Number, required: true, min: 0, default: 0 },
    dailyConsultationRate: { type: Number, required: true, min: 0, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdByName: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// ─── Instructor Schema ────────────────────────────────────────────────────────

const instructorSchema = new Schema<IInstructor>(
  {
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },

    // Profile
    specializations: { type: [String], default: [] },
    graduationYear: { type: Number, default: null },
    cvLink: { type: String, default: "" },

    // Historical rate periods
    ratePeriods: { type: [RatePeriodSchema], default: [] },

    // DEPRECATED: superseded by ratePeriods[]. Kept temporarily for
    // backward-compat during migration. The CURRENT period's rates
    // should always be kept in sync with these fields via the
    // pre-save hook below, so any old code reading these fields
    // directly still gets a reasonable (current) value until all 6
    // calculation call sites are migrated to use ratePeriods.
    dailyTrainingRate: { type: Number, default: 0, min: 0 },
    dailyConsultationRate: { type: Number, default: 0, min: 0 },

    // Audit
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdByName: { type: String, default: "" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Pre-Save Hook: sync deprecated flat fields from current rate period ──────

instructorSchema.pre("save", async function () {
  if (this.ratePeriods && this.ratePeriods.length > 0) {
    const current = this.ratePeriods.find((p) => p.isCurrent);
    if (current) {
      this.dailyTrainingRate = current.dailyTrainingRate;
      this.dailyConsultationRate = current.dailyConsultationRate;
    }
  }
});

// ─── Virtuals ─────────────────────────────────────────────────────────────────

instructorSchema.virtual("hourlyTrainingRate").get(function () {
  return this.dailyTrainingRate > 0
    ? Math.round((this.dailyTrainingRate / 7) * 100) / 100
    : 0;
});

instructorSchema.virtual("hourlyConsultationRate").get(function () {
  return this.dailyConsultationRate > 0
    ? Math.round((this.dailyConsultationRate / 7) * 100) / 100
    : 0;
});

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Unique name with case-insensitive collation (preserved from original)
instructorSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "ar", strength: 2 } }
);
// Text index for search
instructorSchema.index({ name: "text" });
instructorSchema.index({ isActive: 1 });
instructorSchema.index({ specializations: 1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export const Instructor = mongoose.model<IInstructor>("Instructor", instructorSchema);
