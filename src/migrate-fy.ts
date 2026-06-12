import dotenv from "dotenv";
import mongoose from "mongoose";
import { TrainingSession } from "./models/TrainingSession";
import { rebuildTimetableSnapshot } from "./services/timetableBuilder";
import { getFiscalYear } from "./models/TrainingSession";

dotenv.config();

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.error("MONGODB_URI is not defined in environment variables");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected successfully.");

  console.log("Fetching all training sessions...");
  const sessions = await TrainingSession.find({});
  console.log(`Found ${sessions.length} sessions.`);

  let updatedCount = 0;
  const affectedFiscalYears = new Set<string>();

  for (const session of sessions) {
    const currentFY = session.fiscalYear;
    const correctFY = getFiscalYear(session.date);

    if (currentFY !== correctFY) {
      console.log(`Session: ${session.sessionName} (${session.date.toISOString().split('T')[0]}) -> Changing FY from ${currentFY} to ${correctFY}`);
      
      session.fiscalYear = correctFY;
      
      await session.save();
      updatedCount++;
      
      if (currentFY) affectedFiscalYears.add(currentFY);
      if (correctFY) affectedFiscalYears.add(correctFY);
    }
  }

  console.log(`Updated ${updatedCount} sessions.`);

  // Rebuild all distinct fiscal years in the database to be absolutely sure snapshots are correct
  const allFiscalYears = await TrainingSession.distinct("fiscalYear");
  console.log(`Rebuilding snapshots for all distinct fiscal years: ${allFiscalYears.join(", ")}...`);
  
  for (const fy of allFiscalYears) {
    if (fy) {
      await rebuildTimetableSnapshot(fy, "migration");
    }
  }
  
  console.log("Snapshots rebuilt successfully.");
  console.log("Migration completed successfully.");
  await mongoose.disconnect();
  console.log("Disconnected from MongoDB.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
