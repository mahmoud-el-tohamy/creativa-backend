import mongoose, { Schema, Document, Types, Model } from "mongoose";

export interface IBlacklistEntry extends Document {
  _id: Types.ObjectId;
  name: string;
  nationalId: string;
  addedAt: Date;
  addedBy: Types.ObjectId;
  addedByName: string;
  expiresAt: Date;
  isExpired: boolean;
  notes: string;
  status: "warning" | "blacklisted";
  absences: { track: string; date: Date }[];
  attendedCount: number;
}

interface IBlacklistEntryModel extends Model<IBlacklistEntry> {
  findExpired(): Promise<IBlacklistEntry[]>;
  cleanupExpired(): Promise<number>;
}

const blacklistEntrySchema = new Schema<IBlacklistEntry, IBlacklistEntryModel>(
  {
    name: { type: String, required: true, trim: true },
    nationalId: { 
      type: String, 
      required: true, 
      unique: true, 
      trim: true,
      match: /^[23]\d{13}$/, 
    },
    addedAt: { type: Date, default: Date.now },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    addedByName: { type: String, required: true },
    expiresAt: { type: Date },
    notes: { type: String, default: "" },
    status: { type: String, enum: ["warning", "blacklisted"], default: "blacklisted" },
    absences: [
      {
        track: { type: String, required: true },
        date: { type: Date, default: Date.now }
      }
    ],
    attendedCount: { type: Number, default: 0 },
  },
  { 
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

blacklistEntrySchema.index({ nationalId: 1 }, { unique: true });
blacklistEntrySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
blacklistEntrySchema.index({ addedAt: 1 });

blacklistEntrySchema.virtual("isExpired").get(function() {
  if (!this.expiresAt) return false;
  return this.expiresAt.getTime() < Date.now();
});

blacklistEntrySchema.pre("save", async function () {
  if (this.isNew || this.isModified("addedAt")) {
    const expirationDate = new Date(this.addedAt || Date.now());
    expirationDate.setMonth(expirationDate.getMonth() + 4);
    this.expiresAt = expirationDate;
  }
});

blacklistEntrySchema.statics.findExpired = function() {
  return this.find({ expiresAt: { $lt: new Date() } });
};

blacklistEntrySchema.statics.cleanupExpired = async function() {
  const result = await this.deleteMany({ expiresAt: { $lt: new Date() } });
  return result.deletedCount || 0;
};

export const BlacklistEntry = mongoose.model<IBlacklistEntry, IBlacklistEntryModel>("BlacklistEntry", blacklistEntrySchema);
