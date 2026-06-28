import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import {
  listInstructors,
  createInstructor,
  getInstructor,
  updateInstructor,
  updateInstructorRates,
  deleteInstructor,
  getDashboard,
  getAccountantDashboard,
  exportSessions,
  exportProfile,
  exportAllSessions,
  exportAllProfiles,
  addInstructorRatePeriod,
  updateInstructorRatePeriod,
} from "../controllers/instructors.controller";

const router = Router();

// All instructor routes require authentication
router.use(authenticate);

// ─── List & Create ────────────────────────────────────────────────────────────
// GET  /api/instructors         → admin, employee, accountant
// POST /api/instructors         → admin, employee (NOT accountant)
router.get("/", authorize("admin", "employee", "accountant"), listInstructors);
router.post("/", authorize("admin", "employee"), createInstructor);

// ─── Accountant Dashboard ───────────────────────────────────────────────────────
// GET    /api/instructors/summary/dashboard   → admin, accountant
router.get("/summary/dashboard", authorize("admin", "accountant"), getAccountantDashboard);

// ─── Single Instructor ────────────────────────────────────────────────────────
// GET    /api/instructors/:id              → admin, employee, accountant
// PUT    /api/instructors/:id              → admin, employee (accountant gets 403 inside handler)
// PATCH  /api/instructors/:id/rates        → admin, accountant (employee gets 403 inside handler)
// DELETE /api/instructors/:id              → admin, employee
router.get("/:id", authorize("admin", "employee", "accountant"), getInstructor);
router.put("/:id", authorize("admin", "employee", "accountant"), updateInstructor);
router.patch("/:id/rates", authorize("admin", "employee", "accountant"), updateInstructorRates);
router.post("/:id/rate-periods", authorize("admin", "accountant"), addInstructorRatePeriod);
router.patch("/:id/rate-periods/:periodId", authorize("admin", "accountant"), updateInstructorRatePeriod);
router.delete("/:id", authorize("admin", "employee"), deleteInstructor);

// ─── Dashboard ────────────────────────────────────────────────────────────────
// GET /api/instructors/:id/dashboard?period=month|3months|6months|year
router.get("/:id/dashboard", authorize("admin", "employee", "accountant"), getDashboard);

// ─── Excel Exports ────────────────────────────────────────────────────────────
// GET /api/instructors/export/sessions?period=...
// GET /api/instructors/export/profiles
router.get("/export/sessions", authorize("admin", "employee", "accountant"), exportAllSessions);
router.get("/export/profiles", authorize("admin", "employee", "accountant"), exportAllProfiles);

// GET /api/instructors/:id/export?period=...
// GET /api/instructors/:id/export-profile
router.get("/:id/export", authorize("admin", "employee", "accountant"), exportSessions);
router.get("/:id/export-profile", authorize("admin", "employee", "accountant"), exportProfile);

export default router;
