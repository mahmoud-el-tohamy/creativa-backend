/**
 * One-time migration script: create an initial rate period for every
 * instructor that has non-zero rates but an empty ratePeriods array.
 *
 * Run manually (once) via:
 *   npx ts-node -r tsconfig-paths/register scripts/migrateInstructorRatePeriods.ts
 *
 * NEVER auto-run this on server start — it is intentionally manual.
 */

import mongoose, { Types } from "mongoose";
import dotenv from "dotenv";
import { Instructor } from "../src/models/Instructor";

dotenv.config({ path: ".env" });

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/creativa";

// ─── Script Entry Point ───────────────────────────────────────────────────────

async function run(): Promise<void> {
  await mongoose.connect(MONGODB_URI, { dbName: "test" });
  console.log("[migration] Connected to DB");

  const allInstructors = await Instructor.find({}).lean();
  console.log(`[migration] Total instructors found: ${allInstructors.length}`);

  let migrated = 0;
  let skippedAlreadyHasPeriods = 0;
  let skippedZeroRates = 0;
  let flaggedMissingCreatedAt = 0;

  for (const doc of allInstructors) {
    // Skip if already has rate periods (migration already ran or manually seeded)
    if (doc.ratePeriods && doc.ratePeriods.length > 0) {
      skippedAlreadyHasPeriods++;
      continue;
    }

    // Skip if both rates are zero (no financial data to migrate)
    const hasRates =
      (doc.dailyTrainingRate ?? 0) > 0 ||
      (doc.dailyConsultationRate ?? 0) > 0;

    if (!hasRates) {
      skippedZeroRates++;
      continue;
    }

    // Determine the start date for the initial period
    let startDate: Date;
    if (doc.createdAt) {
      startDate = new Date(doc.createdAt);
      // Normalize to start of that day for clean date-range boundaries
      startDate.setHours(0, 0, 0, 0);
    } else {
      // Fallback: use a far-past sentinel date and flag this case
      startDate = new Date("2020-01-01T00:00:00.000Z");
      console.warn(
        `[migration] WARNING: instructor "${doc.name}" (${String(doc._id)}) ` +
          "has no createdAt — using 2020-01-01 as fallback startDate. " +
          "Please verify this is acceptable for this instructor."
      );
      flaggedMissingCreatedAt++;
    }

    // Build the initial rate period
    const initialPeriod = {
      _id: new Types.ObjectId(),
      startDate,
      endDate: null,
      isCurrent: true,
      dailyTrainingRate: doc.dailyTrainingRate ?? 0,
      dailyConsultationRate: doc.dailyConsultationRate ?? 0,
      createdAt: new Date(),
      createdBy: doc.createdBy ?? new Types.ObjectId(),
      createdByName: "النظام (ترحيل تلقائي)",
      note: "تم إنشاؤه تلقائياً عند الترقية لنظام الأسعار التاريخية",
    };

    // Use updateOne with $set to avoid triggering the pre-save virtual sync hook
    // (flat fields are already correct, no need to recalculate here)
    await Instructor.updateOne(
      { _id: doc._id },
      { $push: { ratePeriods: initialPeriod } }
    );

    console.log(
      `[migration] Migrated: "${doc.name}" (${String(doc._id)}) ` +
        `— training: ${doc.dailyTrainingRate}, consultation: ${doc.dailyConsultationRate}, ` +
        `startDate: ${startDate.toISOString().slice(0, 10)}`
    );
    migrated++;
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════");
  console.log("[migration] SUMMARY");
  console.log(`  Migrated successfully:        ${migrated}`);
  console.log(`  Skipped (already has periods): ${skippedAlreadyHasPeriods}`);
  console.log(`  Skipped (zero rates):          ${skippedZeroRates}`);
  if (flaggedMissingCreatedAt > 0) {
    console.warn(
      `  ⚠️  Flagged (missing createdAt, used 2020-01-01): ${flaggedMissingCreatedAt}`
    );
  }
  console.log("════════════════════════════════════════\n");

  await mongoose.disconnect();
  console.log("[migration] Disconnected. Done.");
}

run().catch((err) => {
  console.error("[migration] FATAL ERROR:", err);
  process.exit(1);
});
