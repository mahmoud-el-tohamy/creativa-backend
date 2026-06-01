import mongoose, { Schema, Document, Types } from "mongoose";

export interface IInstructor extends Document {
  _id: Types.ObjectId;
  name: string;
  isActive: boolean;
  createdAt: Date;
  createdBy: Types.ObjectId;
}

const instructorSchema = new Schema<IInstructor>(
  {
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Unique name with case-insensitive collation
instructorSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "ar", strength: 2 } }
);

export const Instructor = mongoose.model<IInstructor>("Instructor", instructorSchema);
