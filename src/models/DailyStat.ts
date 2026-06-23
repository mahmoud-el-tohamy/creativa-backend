import mongoose, { Schema, Document, Model } from "mongoose";

export interface IDailyStat extends Document {
  date: string; // Format: "YYYY-MM-DD"
  additions: number;
  removals: number;
}

interface IDailyStatModel extends Model<IDailyStat> {
  recordAddition(count?: number, date?: Date): Promise<void>;
  recordRemoval(count?: number, date?: Date): Promise<void>;
}

const dailyStatSchema = new Schema<IDailyStat, IDailyStatModel>(
  {
    date: { type: String, required: true, unique: true },
    additions: { type: Number, default: 0 },
    removals: { type: Number, default: 0 },
  }
);

// PERF FIX 1 \u2014 Index on date (stored as "YYYY-MM-DD" string, which sorts lexicographically).
// Enables $gte range queries in getChartStats to perform a bounded index scan instead of COLLSCAN.
// The unique: true constraint above creates an index, but an explicit ascending index is added
// here for clarity and to ensure the query planner prefers it for range queries.
// Impact: getChartStats date-bounded query now uses IXSCAN instead of COLLSCAN.
dailyStatSchema.index({ date: 1 });

dailyStatSchema.statics.recordAddition = async function(count: number = 1, date: Date = new Date()) {
  const dateString = date.toISOString().split('T')[0];
  await this.updateOne(
    { date: dateString },
    { $inc: { additions: count } },
    { upsert: true }
  );
};

dailyStatSchema.statics.recordRemoval = async function(count: number = 1, date: Date = new Date()) {
  const dateString = date.toISOString().split('T')[0];
  await this.updateOne(
    { date: dateString },
    { $inc: { removals: count } },
    { upsert: true }
  );
};

export const DailyStat = mongoose.model<IDailyStat, IDailyStatModel>("DailyStat", dailyStatSchema);
