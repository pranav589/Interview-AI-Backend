import { Router } from "express";
import {
  createJob,
  listJobs,
  getJobDetails,
  updateJob,
} from "../controllers/interview/job.controller";
import requireAuth from "../middleware/requireAuth";
import multer from "multer";

const router = Router();

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Apply auth middleware to all job routes
router.use(requireAuth);

router.post("/", upload.single("questionBankFile"), createJob);
router.get("/", listJobs);
router.get("/:id", getJobDetails);
router.patch("/:id", upload.single("questionBankFile"), updateJob);

export default router;
