import { Router } from "express";
import { getFeatureFlags } from "../controllers/config.controller";

const router = Router();

router.get("/features", getFeatureFlags);

export default router;
