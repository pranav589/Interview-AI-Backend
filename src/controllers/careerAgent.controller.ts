import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { CareerAgentService } from "../services/careerAgent.service";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("careerAgentController");

// Validation Schema for Autonomous Researcher Agent
const ResearcherSchema = z.object({
  companyName: z.string().min(2, "Company name must be at least 2 characters long."),
  targetRole: z.string().min(2, "Target role must be at least 2 characters long."),
  contactName: z.string().optional(),
  hookType: z.string().default("Product Launch Hook"),
});

// Validation Schema for Autonomous Scout Agent
const ScoutSchema = z.object({
  companyName: z.string().min(2, "Company name must be at least 2 characters long."),
  targetRole: z.string().min(2, "Target role must be at least 2 characters long."),
  divisionFilter: z.string().optional(),
});

export class CareerAgentController {
  public static async runResearcher(req: Request, res: Response, next: NextFunction) {
    try {
      const validatedData = ResearcherSchema.parse(req.body);
      
      const result = await CareerAgentService.runAutonomousResearcher(validatedData);
      
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: "Validation error", errors: error.issues });
      } else {
        logger.error({ error }, "Error in runResearcher controller");
        next(error);
      }
    }
  }

  public static async runScout(req: Request, res: Response, next: NextFunction) {
    try {
      const validatedData = ScoutSchema.parse(req.body);
      
      const result = await CareerAgentService.runAutonomousScout(validatedData);
      
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: "Validation error", errors: error.issues });
      } else {
        logger.error({ error }, "Error in runScout controller");
        next(error);
      }
    }
  }
}
