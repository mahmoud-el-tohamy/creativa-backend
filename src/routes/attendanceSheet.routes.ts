import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { buildAttendanceSheetHandler } from "../controllers/attendanceSheet.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post(
  "/build",
  authenticate,
  authorize("admin", "employee"),
  upload.single("file"),
  buildAttendanceSheetHandler
);

export default router;
