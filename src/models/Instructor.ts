import mongoose, { Schema, Document, Types } from "mongoose";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IInstructor extends Document {
  _id: Types.ObjectId;

  // Basic info
  name: string;
  isActive: boolean;

  // Profile fields
  specializations: string[];
  graduationYear: number | null;
  cvLink: string;

  // Rate fields (edited by accountant or admin ONLY)
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

// ─── Schema ───────────────────────────────────────────────────────────────────

const instructorSchema = new Schema<IInstructor>(
  {
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },

    // Profile
    specializations: { type: [String], default: [] },
    graduationYear: { type: Number, default: null },
    cvLink: { type: String, default: "" },

    // Rates
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
