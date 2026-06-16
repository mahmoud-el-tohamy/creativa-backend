import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { rebuildTimetableSnapshot } from "./src/services/timetableBuilder";
import { TrainingSession } from "./src/models/TrainingSession";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const fiscalYears = await TrainingSession.distinct("fiscalYear");
  console.log("Rebuilding for fiscal years:", fiscalYears);
  for (const fy of fiscalYears) {
    await rebuildTimetableSnapshot(fy, "system-script");
  }
  console.log("Done");
  process.exit(0);
}
main();
