import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import {
  listSessions,
  createSession,
  updateSession,
  deleteSession,
  listInstructors,
  createInstructor,
  deactivateInstructor,
  getTimetable,
  listFiscalYears,
  forceRebuild,
  importSessions,
  downloadHoursTracking,
  downloadTimetable,
  bulkDeleteSessions,
} from "../controllers/hours.controller";

const router = Router();

// Multer: in-memory storage for Excel uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("يجب أن يكون الملف بصيغة Excel (.xlsx أو .xls)"));
    }
  },
});

// All routes require authentication
router.use(authenticate);

// ─── Training Sessions ────────────────────────────────────────────────────────
router.get("/sessions", listSessions);
router.post("/sessions", authorize("admin", "employee"), createSession);
router.put("/sessions/:id", authorize("admin", "employee"), updateSession);
router.delete("/sessions/bulk", authorize("admin", "employee"), bulkDeleteSessions);
router.delete("/sessions/:id", authorize("admin", "employee"), deleteSession);

// ─── Instructors ──────────────────────────────────────────────────────────────
router.get("/instructors", listInstructors);
router.post("/instructors", authorize("admin", "employee"), createInstructor);
router.delete("/instructors/:id", authorize("admin"), deactivateInstructor);

// ─── Timetable ────────────────────────────────────────────────────────────────
router.get("/timetable", listFiscalYears);
router.get("/timetable/:fiscalYear", getTimetable);
router.post("/timetable/:fiscalYear/rebuild", authorize("admin"), forceRebuild);

// ─── Excel Export ─────────────────────────────────────────────────────────────
router.get("/export/tracking", downloadHoursTracking);
router.get("/export/timetable", downloadTimetable);

// ─── Bulk Import ──────────────────────────────────────────────────────────────
router.post("/import", authorize("admin", "employee"), upload.single("file"), importSessions);

export default router;
