import { Router } from "express";
import * as AuditController from "../controllers/audit.controller";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";

const router = Router();

router.use(authenticate);
router.use(authorize("admin"));

router.get("/", AuditController.listLogs);

export default router;
