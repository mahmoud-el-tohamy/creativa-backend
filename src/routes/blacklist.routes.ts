import { Router } from "express";
import Joi from "joi";
import * as BlacklistController from "../controllers/blacklist.controller";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { validate } from "../middleware/validate";

const router = Router();

router.use(authenticate);

const singleEntrySchema = Joi.object({
  name: Joi.string().trim().required().messages({
    "string.empty": "الاسم مطلوب",
  }),
  nationalId: Joi.string().pattern(/^[23]\d{13}$/).required().messages({
    "string.empty": "الرقم القومي مطلوب",
    "string.pattern.base": "الرقم القومي غير صالح"
  }),
  notes: Joi.string().optional().allow(""),
});

const bulkEntrySchema = Joi.object({
  entries: Joi.array().items(singleEntrySchema).min(1).required().messages({
    "array.min": "يجب إرسال سجل واحد على الأقل",
  })
});

// All roles
router.get("/", BlacklistController.list);
router.get("/check", BlacklistController.check);

// Admin & Employee only
router.post("/", authorize("admin", "employee"), validate(singleEntrySchema), BlacklistController.addSingle);
router.post("/bulk", authorize("admin", "employee"), validate(bulkEntrySchema), BlacklistController.bulkAdd);
router.delete("/:id", authorize("admin", "employee"), BlacklistController.remove);
router.post("/cleanup", authorize("admin", "employee"), BlacklistController.cleanup);

export default router;
