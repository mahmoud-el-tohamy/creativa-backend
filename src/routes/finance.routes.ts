import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { getInstructorFinancials } from "../controllers/finance.controller";

const router = Router();

// Apply protect middleware to all routes
router.use(authenticate);

// GET /api/finance/instructor-sessions
router.get(
  "/instructor-sessions",
  authorize("admin", "accountant"),
  getInstructorFinancials
);

export default router;
