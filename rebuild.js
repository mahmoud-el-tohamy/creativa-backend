const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const { TimetableSnapshot } = require("./dist/models/TimetableSnapshot");
const { TrainingSession } = require("./dist/models/TrainingSession");
const { rebuildTimetableSnapshot } = require("./dist/services/timetableBuilder");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");
  const sessions = await TrainingSession.find({});
  const fyears = new Set(sessions.map(s => s.fiscalYear));
  for (const fy of fyears) {
    if (fy) {
      await rebuildTimetableSnapshot(fy);
      console.log("Rebuilt", fy);
    }
  }
  
  // print a snapshot to see if consultations is there
  const snap = await TimetableSnapshot.findOne();
  if (snap) {
    console.log("Snap month 0 consultations:", snap.months[0].consultations);
    console.log("Snap month 1 consultations:", snap.months[1].consultations);
  }
  
  await mongoose.disconnect();
}
run();
