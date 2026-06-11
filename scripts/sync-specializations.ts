import mongoose from "mongoose";
import dotenv from "dotenv";
import { Instructor } from "../src/models/Instructor";
import { TrainingSession } from "../src/models/TrainingSession";

dotenv.config({ path: ".env" });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/creativa";

async function run() {
  await mongoose.connect(MONGODB_URI, { dbName: "test" });
  console.log("Connected to DB");

  const sessions = await TrainingSession.find().lean();
  
  const SPECIALIZATION_EXCLUDED = [
    "Hackathons / Competitions",
    "Consultation & Mentorship",
    "Awareness event",
  ];

  const instructorTracks: Record<string, Set<string>> = {};

  for (const session of sessions) {
    if (!session.instructorId || !session.programName) continue;
    if (SPECIALIZATION_EXCLUDED.includes(session.programName)) continue;
    
    // Normalize to match ALL_PROGRAMS nicely if possible
    let prog = session.programName.trim();
    if (prog.toLowerCase() === "career development") prog = "Career Development";
    if (prog.toLowerCase() === "tech") prog = "Tech";
    if (prog.toLowerCase() === "freelancing") prog = "Freelancing";
    if (prog.toLowerCase() === "entrepreneurship") prog = "Entrepreneurship";
    if (prog.toLowerCase() === "acceleration program") prog = "Acceleration program";
    if (prog.toLowerCase() === "incubation") prog = "Incubation";

    const instId = session.instructorId.toString();
    if (!instructorTracks[instId]) instructorTracks[instId] = new Set();
    instructorTracks[instId].add(prog);
  }

  let updated = 0;
  for (const [instId, tracksSet] of Object.entries(instructorTracks)) {
    const tracks = Array.from(tracksSet);
    await Instructor.findByIdAndUpdate(instId, {
      $addToSet: { specializations: { $each: tracks } }
    });
    updated++;
  }

  console.log(`Updated ${updated} instructors with their tracks from existing sessions. Found ${sessions.length} sessions.`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
