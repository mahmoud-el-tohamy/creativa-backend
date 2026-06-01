import { Router } from "express";
import { getChartStats } from "../controllers/dashboard.controller";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";

const router = Router();

router.use(authenticate);
router.use(authorize("admin", "employee"));

router.get("/stats", getChartStats);

export default router;
