import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import {
  listPlannedFiscalYears,
  getPlannedTimetable,
  upsertPlannedTimetable,
  updatePlannedCell,
  getPlannedComparison,
  downloadPlannedExport,
  copyPlannedTimetable,
  resetPlannedMonth,
  createPlannedTimetable,
} from "../controllers/planned.controller";

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── List fiscal years ────────────────────────────────────────────────────────
// GET /api/planned
// Returns string[] of fiscal years that have PlannedTimetable docs, sorted descending
router.get("/", listPlannedFiscalYears);

// ─── Get planned timetable ────────────────────────────────────────────────────
// GET /api/planned/:fiscalYear
// All roles. Returns empty structure if not found (not 404).
router.get("/:fiscalYear", getPlannedTimetable);

// ─── Upsert full planned timetable ───────────────────────────────────────────
// PUT /api/planned/:fiscalYear
// admin + employee only
router.put("/:fiscalYear", authorize("admin", "employee"), upsertPlannedTimetable);

// ─── Create empty planned timetable ──────────────────────────────────────────
// POST /api/planned/:fiscalYear
// admin + employee only
router.post("/:fiscalYear", authorize("admin", "employee"), createPlannedTimetable);

// ─── Update single cell ───────────────────────────────────────────────────────
// PATCH /api/planned/:fiscalYear/cell
// admin + employee only. Uses MongoDB $set dot-notation for performance.
router.patch("/:fiscalYear/cell", authorize("admin", "employee"), updatePlannedCell);

// ─── Reset month ─────────────────────────────────────────────────────────────
// PATCH /api/planned/:fiscalYear/reset-month
// admin + employee only. Requires password in body.
router.patch("/:fiscalYear/reset-month", authorize("admin", "employee"), resetPlannedMonth);

// ─── Copy plan ────────────────────────────────────────────────────────────────
// POST /api/planned/:targetFY/copy-from/:sourceFY
// admin + employee only. Requires password in body when target already has a plan.
router.post("/:targetFY/copy-from/:sourceFY", authorize("admin", "employee"), copyPlannedTimetable);

// ─── Comparison ───────────────────────────────────────────────────────────────
// GET /api/planned/:fiscalYear/comparison
// All roles
router.get("/:fiscalYear/comparison", getPlannedComparison);

// ─── Export ───────────────────────────────────────────────────────────────────
// GET /api/planned/:fiscalYear/export
// All roles. Returns Excel buffer.
router.get("/:fiscalYear/export", downloadPlannedExport);

export default router;
