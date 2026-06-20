import { Router } from "express";
import Joi from "joi";
import * as UsersController from "../controllers/users.controller";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { upload } from "../middleware/upload";

const router = Router();

// All routes require authentication
router.use(authenticate);

// ==========================================
// User Profile Routes (Any authenticated user)
// ==========================================
const updateProfileSchema = Joi.object({
  displayName: Joi.string().min(2).optional(),
  age: Joi.number().optional(),
  address: Joi.string().optional(),
  nationalId: Joi.string().optional(),
  phone: Joi.string().optional(),
  password: Joi.string().min(8).optional()
});

router.get("/profile", UsersController.getProfile);
router.put("/profile", validate(updateProfileSchema), UsersController.updateProfile);
router.post("/profile-picture", upload.single("profilePicture"), UsersController.uploadProfilePicture);
router.delete("/profile-picture", UsersController.deleteProfilePicture);

// ==========================================
// Admin Only Routes
// ==========================================
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
  role: Joi.string().valid("admin", "employee", "viewer", "accountant").required().messages({
    "any.only": "نوع الحساب غير صالح",
    "string.empty": "نوع الحساب مطلوب"
  })
});

const changeRoleSchema = Joi.object({
  role: Joi.string().valid("admin", "employee", "viewer", "accountant").required().messages({
    "any.only": "نوع الحساب غير صالح",
    "string.empty": "نوع الحساب مطلوب"
  })
});

const adminUpdateProfileSchema = Joi.object({
  displayName: Joi.string().min(2).optional(),
  email: Joi.string().email().optional(),
  age: Joi.number().optional(),
  address: Joi.string().optional(),
  nationalId: Joi.string().optional(),
  phone: Joi.string().optional(),
  password: Joi.string().min(8).optional()
});

router.get("/", UsersController.listUsers);
router.post("/", validate(createUserSchema), UsersController.createUser);
router.get("/:id", UsersController.getUser);
router.put("/:id/profile", validate(adminUpdateProfileSchema), UsersController.adminUpdateProfile);
router.patch("/:id/role", validate(changeRoleSchema), UsersController.changeRole);
router.patch("/:id/active", UsersController.toggleActive);
router.delete("/:id", UsersController.toggleActive); // Treat DELETE as soft delete (toggle active)
router.delete("/:id/hard", UsersController.hardDeleteUser);

export default router;
