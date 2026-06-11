import { Router } from "express";
import { CareerAgentController } from "../controllers/careerAgent.controller";
import requireAuth from "../middleware/requireAuth";

const router = Router();

// Define routes (Auth is required for these advanced AI tools)
router.post("/researcher", requireAuth, CareerAgentController.runResearcher);
router.post("/scout", requireAuth, CareerAgentController.runScout);

export default router;
