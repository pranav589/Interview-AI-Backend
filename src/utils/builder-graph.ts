import { StateGraph, StateSchema, START, END } from "@langchain/langgraph";
import { z } from "zod";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { invokeStructuredLLMWithFallback, invokeLLMWithFallback } from "../providers/llm-with-fallback.provider";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("builder-graph");

const BuilderState = new StateSchema({
  messages: z.array(z.any()).default([]),
  resumeData: z.object({
    personalInfo: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      location: z.string().optional(),
      links: z.array(z.string()).optional(),
    }).default({}),
    summary: z.string().default(""),
    experience: z.array(z.any()).default([]),
    education: z.array(z.any()).default([]),
    skills: z.array(z.string()).default([]),
    projects: z.array(z.any()).default([]),
    certifications: z.array(z.any()).default([]),
    languages: z.array(z.string()).default([]),
    awards: z.array(z.any()).default([]),
  }),
  currentStep: z.string().default("greeting"),
  skipFlags: z.record(z.string(), z.boolean()).default({}),
  completionMap: z.record(z.string(), z.boolean()).default({}),
  isFinished: z.boolean().default(false),
});

type BuilderStateType = typeof BuilderState.State;

const isSkipIntent = (message: string) => {
  const m = message.toLowerCase().trim();
  return m === "skip" || m === "no" || m === "n" || m.includes("skip this") || m === "none";
};

const greetingNode = async (state: BuilderStateType) => {
  return {
    messages: [new AIMessage("Hello! I'm your AI Resume Architect. I'll guide you through creating a professional, ATS-optimized resume. Let's start with the basics: What is your full name?")],
    currentStep: "personal_name",
  };
};

const personalNameNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  if (!lastMessage.trim()) {
    return {
      messages: [new AIMessage("I didn't get that. Please provide your full name.")],
      currentStep: "personal_name",
    };
  }

  return {
    resumeData: { ...state.resumeData, personalInfo: { ...state.resumeData.personalInfo, name: lastMessage } },
    messages: [new AIMessage(`Nice to meet you, ${lastMessage}. What's your email address?`)],
    currentStep: "personal_email",
    completionMap: { ...state.completionMap, name: true },
  };
};

const personalEmailNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailRegex.test(lastMessage.trim())) {
    return {
      messages: [new AIMessage("That doesn't look like a valid email. Please provide your professional email address.")],
      currentStep: "personal_email",
    };
  }

  return {
    resumeData: { ...state.resumeData, personalInfo: { ...state.resumeData.personalInfo, email: lastMessage.trim() } },
    messages: [new AIMessage("Got it. Now, what's your phone number and location (City, Country)?")],
    currentStep: "personal_contact",
    completionMap: { ...state.completionMap, email: true },
  };
};

const personalContactNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  const schema = z.object({
    phone: z.string(),
    location: z.string(),
  });

  try {
    const info = await invokeStructuredLLMWithFallback(
      schema,
      [new SystemMessage("Extract phone and location from the user message."), new HumanMessage(lastMessage)],
      { timeout: 15000 }
    );

    return {
      resumeData: { 
        ...state.resumeData, 
        personalInfo: { 
          ...state.resumeData.personalInfo, 
          phone: info.phone, 
          location: info.location 
        } 
      },
      messages: [new AIMessage("Perfect. Do you have a LinkedIn profile or portfolio link you'd like to include? (Type 'skip' if none)")],
      currentStep: "personal_links",
      completionMap: { ...state.completionMap, contact: true },
    };
  } catch (e) {
    return {
      messages: [new AIMessage("Could you please provide your phone and location clearly?")],
      currentStep: "personal_contact",
    };
  }
};

const personalLinksNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  if (isSkipIntent(lastMessage)) {
    return {
      messages: [new AIMessage("No problem. Now, write a brief professional summary or tell me your career goals.")],
      currentStep: "summary",
      skipFlags: { ...state.skipFlags, links: true },
    };
  }

  const links = lastMessage.match(/https?:\/\/[^\s]+/g) || [lastMessage];

  return {
    resumeData: { ...state.resumeData, personalInfo: { ...state.resumeData.personalInfo, links } },
    messages: [new AIMessage("Links added. Now, write a brief professional summary or tell me your career goals.")],
    currentStep: "summary",
    completionMap: { ...state.completionMap, links: true },
  };
};

const summaryNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  if (state.currentStep === "summary_confirm") {
    const lowerMsg = lastMessage.toLowerCase();
    if (lowerMsg.includes("good") || lowerMsg.includes("yes") || lowerMsg.includes("correct") || lowerMsg === "y" || lowerMsg.includes("looks good") || lowerMsg.includes("proceed")) {
      return {
        messages: [new AIMessage("Excellent. Now let's talk about your work experience. Tell me about your most recent role: Job Title, Company, and your key achievements there.")],
        currentStep: "experience",
      };
    }

    const refinedSummary = await invokeLLMWithFallback([
      new SystemMessage(`You are a professional resume writer. Refine the professional summary based on the user's feedback.
      Current Summary: ${state.resumeData.summary}
      User Feedback: ${lastMessage}
      
      STRICTLY preserve original facts. Focus on the requested changes (e.g., shorten, more technical, more impact-driven, etc.).`),
      new HumanMessage(lastMessage)
    ]);

    return {
      resumeData: { ...state.resumeData, summary: refinedSummary },
      messages: [new AIMessage(`I've updated it:\n\n${refinedSummary}\n\nHow does this look now? Say "looks good" to proceed or tell me if you want more changes.`)],
      currentStep: "summary_confirm",
    };
  }

  if (lastMessage.length < 20) {
    return {
      messages: [new AIMessage("That summary seems a bit short. Could you provide a bit more detail about your expertise and goals?")],
      currentStep: "summary",
    };
  }

  try {
    const revampedSummary = await invokeLLMWithFallback([
      new SystemMessage(`You are a professional resume writer. Your task is to revamp the user's professional summary for maximum impact and ATS optimization. 
      Guidelines:
      1. Use a professional tone and industry-standard keywords.
      2. Focus on achievements and value proposition.
      3. Keep it concise (3-4 sentences).
      4. STRICTLY preserve the original meaning and facts. Do not invent details.
      5. Ensure it sounds natural and compelling.`),
      new HumanMessage(lastMessage)
    ], { timeout: 15000 });

    return {
      resumeData: { ...state.resumeData, summary: revampedSummary },
      messages: [new AIMessage(`I've revamped your summary for professional impact:\n\n${revampedSummary}\n\nHow does this look? You can ask me to "shorten it", "make it more technical", etc., or simply say "looks good" to proceed.`)],
      currentStep: "summary_confirm",
      completionMap: { ...state.completionMap, summary: true },
    };
  } catch (e) {
    logger.error({ err: e }, "Failed to revamp summary, falling back to original");
    return {
      resumeData: { ...state.resumeData, summary: lastMessage },
      messages: [new AIMessage("Excellent. I've noted your summary. Now let's talk about your work experience. Tell me about your most recent role: Job Title, Company, and your key achievements there.")],
      currentStep: "experience",
      completionMap: { ...state.completionMap, summary: true },
    };
  }
};

const experienceNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  if (state.currentStep === "experience_confirm") {
    const lowerMsg = lastMessage.toLowerCase();
    if (lowerMsg.includes("good") || lowerMsg.includes("yes") || lowerMsg.includes("correct") || lowerMsg === "y" || lowerMsg.includes("looks good") || lowerMsg.includes("proceed")) {
      const lastExp = state.resumeData.experience[state.resumeData.experience.length - 1];
      if (lastExp?.hasMore) {
        return {
          messages: [new AIMessage("Great. Tell me about your next role.")],
          currentStep: "experience",
        };
      }
      return {
        messages: [new AIMessage("Perfect. Now, tell me about your education (Degree, School, and Graduation Year).")],
        currentStep: "education",
        completionMap: { ...state.completionMap, experience: true },
      };
    }

    // Refine last experience
    const lastExp = state.resumeData.experience[state.resumeData.experience.length - 1];
    const refinementSchema = z.object({
      bullets: z.array(z.string()),
    });

    const refined = await invokeStructuredLLMWithFallback(
      refinementSchema,
      [
        new SystemMessage(`Refine the achievement bullets for the role '${lastExp.role}' at '${lastExp.company}' based on user feedback.
        Current Bullets: ${lastExp.bullets.join("\n")}
        User Feedback: ${lastMessage}
        
        STRICTLY preserve facts. Focus on the requested changes (e.g., shorten, more technical, etc.).`),
        new HumanMessage(lastMessage)
      ]
    );

    const updatedExpList = [...state.resumeData.experience];
    updatedExpList[updatedExpList.length - 1] = { ...lastExp, bullets: refined.bullets };

    return {
      resumeData: { ...state.resumeData, experience: updatedExpList },
      messages: [new AIMessage(`I've updated the achievements:\n\n${refined.bullets.map(b => `- ${b}`).join("\n")}\n\nHow is this? Say "looks good" to proceed or tell me what else to change.`)],
      currentStep: "experience_confirm",
    };
  }

  const schema = z.object({
    role: z.string(),
    company: z.string(),
    startDate: z.string(),
    endDate: z.string().optional(),
    bullets: z.array(z.string()),
    hasMore: z.boolean().describe("True if the user mentions they have more experience to add"),
  });

  try {
    const exp = await invokeStructuredLLMWithFallback(
      schema,
      [
        new SystemMessage(`Extract work experience details. 
        CRITICAL: Revamp the achievement bullets for professional impact.
        Guidelines for revamping:
        - Use strong action verbs (e.g., 'Spearheaded', 'Engineered', 'Optimized').
        - Focus on quantifiable results and achievements.
        - ATS optimization: Use relevant industry keywords.
        - STRICTLY preserve the original facts and meaning.
        - If the user mentions another role, set hasMore to true.`), 
        new HumanMessage(lastMessage)
      ],
      { timeout: 20000 }
    );

    const updatedExp = [...state.resumeData.experience, exp];
    
    return {
      resumeData: { ...state.resumeData, experience: updatedExp },
      messages: [new AIMessage(`I've added your role at ${exp.company} and professionalized your achievements:\n\n${exp.bullets.map(b => `- ${b}`).join("\n")}\n\nDoes this look good? You can ask me to refine it or say "yes" to proceed.`)],
      currentStep: "experience_confirm",
    };
  } catch (e) {
    return {
      messages: [new AIMessage("I couldn't extract the details. Please provide the role, company, dates, and some achievements.")],
      currentStep: "experience",
    };
  }
};

const educationNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  const schema = z.object({
    degree: z.string(),
    school: z.string(),
    gradDate: z.string(),
    hasMore: z.boolean(),
  });

  try {
    const edu = await invokeStructuredLLMWithFallback(
      schema,
      [new SystemMessage("Extract education details."), new HumanMessage(lastMessage)],
      { timeout: 15000 }
    );

    const updatedEdu = [...state.resumeData.education, edu];

    if (edu.hasMore) {
      return {
        resumeData: { ...state.resumeData, education: updatedEdu },
        messages: [new AIMessage("Added. Any other degrees?")],
        currentStep: "education",
      };
    }

    return {
      resumeData: { ...state.resumeData, education: updatedEdu },
      messages: [new AIMessage("Almost there! List your top skills (e.g., Python, Project Management, React).")],
      currentStep: "skills",
      completionMap: { ...state.completionMap, education: true },
    };
  } catch (e) {
    return {
      messages: [new AIMessage("Please share your degree, school, and graduation year clearly.")],
      currentStep: "education",
    };
  }
};

const skillsNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  const schema = z.object({
    skills: z.array(z.string()),
  });

  try {
    const { skills } = await invokeStructuredLLMWithFallback(
      schema,
      [new SystemMessage("Extract a list of skills."), new HumanMessage(lastMessage)],
      { timeout: 15000 }
    );

    return {
      resumeData: { ...state.resumeData, skills },
      messages: [new AIMessage("Perfect! Do you have any major projects you'd like to highlight? (Type 'skip' to skip)")],
      currentStep: "projects",
      completionMap: { ...state.completionMap, skills: true },
    };
  } catch (e) {
    return {
      messages: [new AIMessage("Just list a few of your core skills.")],
      currentStep: "skills",
    };
  }
};

const projectsNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  if (state.currentStep === "projects_confirm") {
    const lowerMsg = lastMessage.toLowerCase();
    if (lowerMsg.includes("good") || lowerMsg.includes("yes") || lowerMsg.includes("correct") || lowerMsg === "y" || lowerMsg.includes("looks good") || lowerMsg.includes("proceed")) {
      const lastProj = state.resumeData.projects[state.resumeData.projects.length - 1];
      if (lastProj?.hasMore) {
        return {
          messages: [new AIMessage("Project added! Any others?")],
          currentStep: "projects",
        };
      }
      return {
        messages: [new AIMessage("Nice. Any professional certifications? (Type 'skip' to skip)")],
        currentStep: "certifications",
        completionMap: { ...state.completionMap, projects: true },
      };
    }

    // Refine last project
    const lastProj = state.resumeData.projects[state.resumeData.projects.length - 1];
    const refinementSchema = z.object({
      description: z.string(),
      bullets: z.array(z.string()),
    });

    const refined = await invokeStructuredLLMWithFallback(
      refinementSchema,
      [
        new SystemMessage(`Refine the description and bullets for the project '${lastProj.name}' based on user feedback.
        Current Description: ${lastProj.description}
        Current Bullets: ${lastProj.bullets.join("\n")}
        User Feedback: ${lastMessage}
        
        STRICTLY preserve facts. Focus on the requested changes.`),
        new HumanMessage(lastMessage)
      ]
    );

    const updatedProjectsList = [...state.resumeData.projects];
    updatedProjectsList[updatedProjectsList.length - 1] = { ...lastProj, description: refined.description, bullets: refined.bullets };

    return {
      resumeData: { ...state.resumeData, projects: updatedProjectsList },
      messages: [new AIMessage(`I've updated the project details:\n\nDescription: ${refined.description}\n\nAchievements:\n${refined.bullets.map(b => `- ${b}`).join("\n")}\n\nHow is this? Say "looks good" to proceed or tell me if you need more changes.`)],
      currentStep: "projects_confirm",
    };
  }

  if (isSkipIntent(lastMessage)) {
    return {
      messages: [new AIMessage("Skipped. Any professional certifications or licenses? (Type 'skip' to skip)")],
      currentStep: "certifications",
      skipFlags: { ...state.skipFlags, projects: true },
    };
  }

  const schema = z.object({
    name: z.string(),
    description: z.string(),
    bullets: z.array(z.string()),
    hasMore: z.boolean(),
  });

  try {
    const project = await invokeStructuredLLMWithFallback(
      schema,
      [
        new SystemMessage(`Extract project details. 
        CRITICAL: Revamp the description and achievement bullets for professional impact.
        Guidelines for revamping:
        - Use strong action verbs.
        - Focus on technologies used and the impact of the project.
        - ATS optimization: Use relevant industry keywords.
        - STRICTLY preserve the original facts and meaning.`), 
        new HumanMessage(lastMessage)
      ],
      { timeout: 15000 }
    );

    const updatedProjects = [...state.resumeData.projects, project];
    
    return {
      resumeData: { ...state.resumeData, projects: updatedProjects },
      messages: [new AIMessage(`I've added "${project.name}" and professionalized the details:\n\nDescription: ${project.description}\n\nAchievements:\n${project.bullets.map(b => `- ${b}`).join("\n")}\n\nDoes this look good? You can ask me to refine it or say "yes" to proceed.`)],
      currentStep: "projects_confirm",
    };
  } catch (e) {
    return {
      messages: [new AIMessage("Please share your project name and a brief description.")],
      currentStep: "projects",
    };
  }
};

const certificationsNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  if (isSkipIntent(lastMessage)) {
    return {
      messages: [new AIMessage("Skipped. Finally, any languages you speak or awards you've won? (Type 'skip' to finish)")],
      currentStep: "awards",
      skipFlags: { ...state.skipFlags, certifications: true },
    };
  }

  const schema = z.object({
    name: z.string(),
    issuer: z.string(),
    date: z.string(),
    hasMore: z.boolean(),
  });

  try {
    const cert = await invokeStructuredLLMWithFallback(
      schema,
      [new SystemMessage("Extract certification details."), new HumanMessage(lastMessage)],
      { timeout: 15000 }
    );

    const updatedCerts = [...state.resumeData.certifications, cert];
    
    if (cert.hasMore) {
      return {
        resumeData: { ...state.resumeData, certifications: updatedCerts },
        messages: [new AIMessage("Certification added! Any more?")],
        currentStep: "certifications",
      };
    }

    return {
      resumeData: { ...state.resumeData, certifications: updatedCerts },
      messages: [new AIMessage("Great. Any languages or awards to include? (Type 'skip' to finish)")],
      currentStep: "awards",
      completionMap: { ...state.completionMap, certifications: true },
    };
  } catch (e) {
    return {
      messages: [new AIMessage("Please share the certification name and issuer.")],
      currentStep: "certifications",
    };
  }
};

const awardsNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  
  if (isSkipIntent(lastMessage)) {
    return {
      messages: [new AIMessage("All set! Here's a quick summary of what I've collected. Does everything look correct? If so, I'll generate your templates.")],
      currentStep: "review",
      skipFlags: { ...state.skipFlags, awards: true },
    };
  }

  const schema = z.object({
    languages: z.array(z.string()).optional(),
    awards: z.array(z.object({ name: z.string(), year: z.string() })).optional(),
  });

  try {
    const data = await invokeStructuredLLMWithFallback(
      schema,
      [new SystemMessage("Extract languages and awards."), new HumanMessage(lastMessage)],
      { timeout: 15000 }
    );

    return {
      resumeData: { 
        ...state.resumeData, 
        languages: data.languages || state.resumeData.languages, 
        awards: data.awards || state.resumeData.awards 
      },
      messages: [new AIMessage("Perfect! I've collected everything. Does the data look correct? If so, I'll start generating your templates.")],
      currentStep: "review",
      completionMap: { ...state.completionMap, awards: true },
    };
  } catch (e) {
    return {
      messages: [new AIMessage("I couldn't parse that. Feel free to skip if you don't have languages or awards to add.")],
      currentStep: "awards",
    };
  }
};

const reviewNode = async (state: BuilderStateType) => {
  const lastMessage = state.messages[state.messages.length - 1]?.content?.toLowerCase() || "";
  
  if (lastMessage.includes("yes") || lastMessage.includes("correct") || lastMessage.includes("good") || lastMessage.includes("ok")) {
    return {
      isFinished: true,
      messages: [new AIMessage("Excellent! I'm now generating your 3 premium templates. Hang tight...")],
      currentStep: "finish",
    };
  }

  return {
    messages: [new AIMessage("If something is wrong, tell me which section you'd like to correct. Otherwise, say 'yes' to proceed.")],
    currentStep: "review",
  };
};

const finishNode = async (state: BuilderStateType) => {
  return {
    isFinished: true,
  };
};

const workflow = new StateGraph(BuilderState)
  .addNode("greeting", greetingNode)
  .addNode("personal_name", personalNameNode)
  .addNode("personal_email", personalEmailNode)
  .addNode("personal_contact", personalContactNode)
  .addNode("personal_links", personalLinksNode)
  .addNode("summary", summaryNode)
  .addNode("summary_confirm", summaryNode)
  .addNode("experience", experienceNode)
  .addNode("experience_confirm", experienceNode)
  .addNode("education", educationNode)
  .addNode("skills", skillsNode)
  .addNode("projects", projectsNode)
  .addNode("projects_confirm", projectsNode)
  .addNode("certifications", certificationsNode)
  .addNode("awards", awardsNode)
  .addNode("review", reviewNode)
  .addNode("finish", finishNode)
  .addConditionalEdges(START, (state) => state.currentStep)
  .addEdge("greeting", END)
  .addEdge("personal_name", END)
  .addEdge("personal_email", END)
  .addEdge("personal_contact", END)
  .addEdge("personal_links", END)
  .addEdge("summary", END)
  .addEdge("summary_confirm", END)
  .addEdge("experience", END)
  .addEdge("experience_confirm", END)
  .addEdge("education", END)
  .addEdge("skills", END)
  .addEdge("projects", END)
  .addEdge("projects_confirm", END)
  .addEdge("certifications", END)
  .addEdge("awards", END)
  .addEdge("review", END)
  .addEdge("finish", END);

export const builderGraph = workflow.compile();
