import { Router } from "express";
import Joi from "joi";
import * as AuthController from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();

const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.empty": "البريد الإلكتروني مطلوب",
    "string.email": "البريد الإلكتروني غير صالح"
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
