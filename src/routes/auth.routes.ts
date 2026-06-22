import { Router } from "express";
import Joi from "joi";
import * as AuthController from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();

const loginSchema = Joi.object({
  identifier: Joi.string().min(2).required().messages({
    "string.empty": "البريد الإلكتروني أو اسم المستخدم مطلوب",
    "string.min": "البريد الإلكتروني أو اسم المستخدم قصير جداً",
    "any.required": "البريد الإلكتروني أو اسم المستخدم مطلوب"
  }),
  password: Joi.string().required().messages({
    "string.empty": "كلمة المرور مطلوبة"
  })
});

router.post("/login", validate(loginSchema), AuthController.login);
router.post("/logout", authenticate, AuthController.logout);
router.post("/refresh", AuthController.refresh);
router.get("/me", authenticate, AuthController.me);

export default router;
