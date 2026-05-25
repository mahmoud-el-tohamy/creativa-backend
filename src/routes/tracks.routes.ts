import express from "express";
import { getTracks, addTrack, removeTrack } from "../controllers/tracks.controller";
import { authenticate } from "../middleware/auth";
import { authorize } from "../middleware/authorize";

const router = express.Router();

router.use(authenticate);

router.get("/", getTracks);
// Only admins and employees can manage tracks
router.post("/", authorize("admin", "employee"), addTrack);
router.delete("/:id", authorize("admin", "employee"), removeTrack);

export default router;
