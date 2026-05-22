import { Router } from "express";
import Joi from "joi";
import * as UsersController from "../controllers/users.controller";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { validate } from "../middleware/validate";

const router = Router();

router.use(authenticate);
router.use(authorize("admin"));

const createUserSchema = Joi.object({
  displayName: Joi.string().min(2).required().messages({
    "string.empty": "الاسم مطلوب",
    "string.min": "الاسم يجب أن يكون حرفين على الأقل"
  }),
  email: Joi.string().email().required().messages({
    "string.empty": "البريد الإلكتروني مطلوب",
    "string.email": "البريد الإلكتروني غير صالح"
  }),
  password: Joi.string().min(8).required().messages({
    "string.empty": "كلمة المرور مطلوبة",
    "string.min": "كلمة المرور يجب أن تكون 8 أحرف على الأقل"
  }),
  role: Joi.string().valid("employee", "viewer").required().messages({
    "any.only": "نوع الحساب غير صالح",
    "string.empty": "نوع الحساب مطلوب"
  })
});

const changeRoleSchema = Joi.object({
  role: Joi.string().valid("employee", "viewer").required().messages({
    "any.only": "نوع الحساب غير صالح",
    "string.empty": "نوع الحساب مطلوب"
  })
});

router.get("/", UsersController.listUsers);
router.post("/", validate(createUserSchema), UsersController.createUser);
router.patch("/:id/role", validate(changeRoleSchema), UsersController.changeRole);
router.patch("/:id/active", UsersController.toggleActive);
router.delete("/:id", UsersController.toggleActive); // Treat DELETE as soft delete (toggle active)

export default router;
