import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { createModuleLogger } from "../lib/logger";
import { TavilySearch } from "@langchain/tavily";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { env } from "../config/env";
import { invokeStructuredLLMWithFallback } from "../providers/llm-with-fallback.provider";
import { z } from "zod";
import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";
import { RunnableLambda } from "@langchain/core/runnables";

const logger = createModuleLogger("careerAgent");

export interface ResearcherParams {
  companyName: string;
  targetRole: string;
  contactName?: string;
  hookType: string;
}

// Zod Validation Schema for the Agent Output Dossier (Highly detailed and premium)
const DossierSchema = z.object({
  intelligenceBrief: z.object({
    recentUpdates: z.array(z.string()),
    businessChallenges: z.array(z.string()),
    competitorAnalysis: z.string(),
    cultureAlignment: z.string(),
    marketPosition: z.string(),
  }),
  techStack: z.object({
    frontend: z.array(z.string()),
    backend: z.array(z.string()),
    devopsInfra: z.array(z.string()),
    inferredFocus: z.string(),
  }),
  outreachDraft: z.object({
    subjectLine: z.string(),
    linkedinDM: z.string(),
    coldEmail: z.string(),
    followUp: z.string(),
  }),
  interviewEdge: z.object({
    resumeGaps: z.array(z.string()),
    questions: z.array(
      z.object({
        question: z.string(),
        strategy: z.string(),
        pitfalls: z.string(),
      })
    ),
  }),
});

export interface ScoutParams {
  companyName: string;
  targetRole: string;
  divisionFilter?: string;
}

// Zod Validation Schema for the Scout Agent Output Dossier (Premium organization map)
const ScoutDossierSchema = z.object({
  organizationOverview: z.object({
    keyDivisions: z.array(z.string()),
    engineeringHubs: z.array(z.string()),
    hiringPace: z.string(),
    strategicFocus: z.array(z.string()),
  }),
  decisionMakers: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      division: z.string(),
      linkedinUrl: z.string(),
      relevanceScore: z.number().min(1).max(10),
      whyTarget: z.string(),
      networkingHook: z.string(),
    })
  ),
  recruiters: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      linkedinUrl: z.string(),
      networkingHook: z.string(),
    })
  ),
  currentEmployees: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      linkedinUrl: z.string(),
    })
  ),
  outreachMatrix: z.object({
    warmColdReferralEmail: z.string(),
    strategicFollowUp: z.string(),
  }),
});

// Helper to format search results from Tavily/DDG into highly readable MD blocks for the LLM
function formatSearchResults(rawResults: any, companyName: string): string {
  if (!rawResults) return "No results found.";

  let parsed = rawResults;
  if (typeof rawResults === "string") {
    try {
      parsed = JSON.parse(rawResults);
    } catch {
      return rawResults;
    }
  }

  // Extract the results array if nested inside the response object (Tavily search returns { results: [...] })
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.results)) {
    parsed = parsed.results;
  }

  if (Array.isArray(parsed)) {
    const cleanedCompany = companyName.toLowerCase().replace(/['"]/g, "").trim();

    // Strict Post-Filtering: Keep only documents that explicitly mention the target company
    const filteredDocs = parsed.filter((item: any) => {
      const title = (item.title || "").toLowerCase();
      const content = (item.content || "").toLowerCase();
      return title.includes(cleanedCompany) || content.includes(cleanedCompany);
    });

    // Fall back to the original list if the filter is too aggressive and leaves us with zero documents
    const activeDocs = filteredDocs.length > 0 ? filteredDocs : parsed;

    return activeDocs
      .map((item: any, idx: number) => {
        const title = item.title || item.name || "Snippet";
        const content = item.content || item.snippet || "";
        const url = item.url || "";
        return `[Doc ${idx + 1}] ${title}\nSource: ${url}\nContent: ${content}`;
      })
      .join("\n\n");
  }

  return String(rawResults);
}

// 100% Free, Keyless Yahoo Search Fallback using LangChain CheerioWebBaseLoader
async function executeFallbackSearchYahoo(query: string, maxResults = 5): Promise<any[]> {
  try {
    logger.info({ query }, "Executing free Yahoo search fallback via LangChain CheerioWebBaseLoader...");
    console.log(`\n[YAHOO FALLBACK] Querying Yahoo Search for: "${query}"`);

    const url = `https://search.yahoo.com/search?q=${encodeURIComponent(query)}`;
    const loader = new CheerioWebBaseLoader(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });

    const $ = await loader.scrape();
    const results: any[] = [];

    // Parse elements using precise selectors matching Yahoo's static structure
    $('.algo').each((idx: number, el: any) => {
      if (results.length >= maxResults) return;

      const titleLink = $(el).find('.compTitle a');
      const title = titleLink.find('h3').text().trim();

      let rawUrl = titleLink.attr('href') || "";
      let cleanUrl = rawUrl;

      // Extract clean destination URL if it's wrapped in a Yahoo redirect parameter
      if (cleanUrl.includes('RU=')) {
        const parts = cleanUrl.split('RU=');
        if (parts[1]) {
          const rawDest = parts[1].split('/RK=')[0];
          cleanUrl = decodeURIComponent(rawDest);
        }
      }

      const content = $(el).find('.compText').text().replace(/<[^>]*>/g, "").trim();

      if (title && cleanUrl) {
        console.log(`  -> [Result ${results.length + 1}] Title: "${title}"`);
        console.log(`     URL: "${cleanUrl}"`);

        results.push({
          title,
          url: cleanUrl,
          content: content || "No snippet available."
        });
      }
    });

    logger.info({ count: results.length }, "Yahoo search fallback completed successfully");
    return results;
  } catch (err: any) {
    logger.error({ err }, "Yahoo search fallback failed");
    console.error(`  [Yahoo Error] Fallback search failed: ${err.message}`);
    return [];
  }
}

const RESEARCHER_SYSTEM_TEMPLATE = `You are a highly advanced Autonomous Career Intelligence Agent and Executive Communication Strategist.
Your goal is to synthesize real-time company research and generate a comprehensive, premium Job Hunter Strategic Dossier.

Inputs:
- Target Company: {companyName}
- Target Role: {targetRole}
{contactNameText}
- Hook/Outreach Type: {hookType}

CRITICAL: REAL-TIME SEARCH RESULTS FOUND (USE THESE EXACT FACTS AND URLS FROM {searchProvider}):
{searchResultsStr}

=== STRICT COMPILATION CONSTRAINTS ===
1. WARNING: PREVENT CROSS-COMPANY POLLUTION:
   - The search results may contain comparison articles mentioning other companies or general articles containing noise.
   - You MUST strictly and ONLY extract facts, updates, and metrics that pertain directly to {companyName}.
   - Under no circumstances should you attribute tech stack components, news announcements, or Glassdoor metrics of other companies (like Stripe, OpenAI, Google, etc., if they appear as comparisons in the search segment) to {companyName}.

2. ABSOLUTELY NO HALLUCINATIONS:
   - Do NOT invent recent news headlines, values, or technical details if they are not explicitly present in the search results.
   - If search results are simulated or empty, draw only from highly established, verifiably correct static facts about {companyName}. If you are not 100% sure about a specific tech tool or update, DO NOT include it.

3. PRECISION CITATION LINKS ACROSS ALL DOSSIER CONTENT:
   - For every single bullet point you output in 'recentUpdates' and 'businessChallenges', and within the paragraphs for 'competitorAnalysis', 'cultureAlignment', and 'marketPosition', and in the outreach drafts (linkedinDM or coldEmail), you MUST weave in specific, highly descriptive markdown links [Link Text](URL) pointing to the exact source URLs in the search results where that specific fact, news, tech stack component, or review was observed.
   - For example: "Stripe launched their new [Adaptive Pricing product](https://stripe.com/news/adaptive-pricing) in Q1..." or "Employee feedback on Glassdoor indicates appreciation for the [transparent leadership](https://glassdoor.com/Reviews/Stripe-Reviews-E4893.htm) but notes high work pressure."
   - The link text must be highly descriptive (e.g. naming the exact product, blog release, or review page).
   - You MUST extract the actual URL from the corresponding [Doc X] metadata in the search results.
   - CRITICAL: Never invent a URL. If no exact URL is available in the search results for that topic, write the context or message without placing any link (or fall back to referencing their standard, confirmed homepage URL).

4. GLASSDOOR & EMPLOYEE REVIEWS INTEGRATION:
   - In the 'cultureAlignment' brief, synthesize actual themes, pros, and cons mentioned in the Glassdoor reviews segment (e.g. employee feedback on pace, transparency, work-life balance, or manager styles). Keep it honest and factual.

5. REAL-TIME stack observation:
   - Base the techStack arrays (frontend, backend, devopsInfra) strictly on the concrete technologies discovered in the Segment 4 search results. Banish placeholders.`;

const SCOUT_SYSTEM_TEMPLATE = `You are a highly advanced Autonomous Network Scout, Org Mapper, and Executive Referral Strategist.
Your goal is to analyze real-time search results, construct a high-relevance organizational chart/map of the engineering department at the target company, identify key leaders/recruiters, and script hyper-personalized outreach campaigns.

Inputs:
- Target Company: {companyName}
- Target Role: {targetRole}
{divisionFilterText}

CRITICAL: REAL-TIME SEARCH RESULTS FOUND (USE THESE EXACT FACTS AND URLS FROM {searchProvider}):
{searchResultsStr}

=== STRICT COMPILATION CONSTRAINTS ===
1. WARNING: PREVENT CROSS-COMPANY POLLUTION:
   - Only extract divisions, office hubs, and personnel that pertain strictly and directly to {companyName}.
   - Never attribute engineering structures, recruiters, or office locations of other companies to {companyName}.

2. STRICT ANTI-HALLUCINATION GUARDRAILS:
   - Do NOT invent specific names of executives, engineers, or recruiters if they are not explicitly and verifiably present in the search results.
   - If search results are simulated, empty, or do not contain specific real names, you MUST use highly accurate generic strategic target profiles (e.g. "Platform Engineering Manager", "Technical Recruiting Lead for Infrastructure") rather than fabricating specific individuals. 
   - Never fabricate LinkedIn URL paths or email addresses.

3. PRECISION CITATION LINKS & REDIRECT SEARCH LINKS:
   - For every single bullet point in 'strategicFocus', 'hiringPace', and the reasons in 'whyTarget', and in the cold email, you MUST weave in specific markdown links [Link Text](URL) pointing to the exact source URLs in the search results.
   - For personal profiles (LinkedIn links): If the exact personal LinkedIn URL is not verifiably present in the search results, you MUST NOT fabricate it. Instead, generate a highly functional LinkedIn search redirect URL using the exact pattern:
     https://www.linkedin.com/search/results/people/?keywords=[Encoded_Keywords]
     Where [Encoded_Keywords] is a clean, URL-encoded string containing their Name, Title, and Company (e.g., "https://www.linkedin.com/search/results/people/?keywords=Jane%20Doe%20Engineering%20Manager%20Stripe").
     This guarantees that every profile link clicked by the user dynamically redirects to the correct LinkedIn profile search page without broken links or placeholders!

4. LINKEDIN CONNECTION INVITE SIZE (<300 CHARACTERS):
   - The 'networkingHook' field for all 'decisionMakers' and 'recruiters' MUST be strictly under 300 characters (aim for 250-280 characters to be absolutely safe).
   - These are sent in the default "Add a note to your connection request" on LinkedIn. They must be highly compelling, contextualized with target-specific variables, and brief. Do not include placeholders.
   - **CRITICAL: Do NOT mention any employee name, recruiter name, or decision-maker name anywhere in the 'networkingHook' message.** Reference only the team, department, company, or role (e.g. "I came across {companyName}'s engineering team...") to keep the message universally professional.

5. WARM COLD-REFERRAL EMAIL DESIGN:
   - The cold email draft ('warmColdReferralEmail') and all other outreach content in this dossier MUST be crafted specifically and solely for the target role: '{targetRole}'. Ensure the pitch, value propositions, and professional reference variables relate directly to this title.
   - **CRITICAL: Do NOT reference or mention any specific employee, recruiter, or decision-maker by name anywhere in the outreach email or follow-up messages.** The message must remain fully professional, anonymous, and role-focused. Instead of naming individuals, reference the team, department, or company initiative (e.g. "I came across {companyName}'s {targetRole} team and your recent expansion...").
   - Ensure the email flow is premium, elegant, and references verified company parameters, team structure, and office divisions discovered in search.

6. CURRENT ACTIVE EMPLOYEES REQUIREMENT:
   - You MUST ensure that every single listed person (in 'decisionMakers', 'recruiters', and 'currentEmployees') is verifiably CURRENTLY employed at {companyName}. Under no circumstances should you include former employees, or anyone who has left the company (whose details list 'Former', 'ex-', 'former employee', or indicate they previously worked there).
   - In the 'currentEmployees' array, list exactly 5 to 6 current employees currently working at {companyName}.
   - **PRIORITIZATION**: First, identify and list employees who are currently working in the exact same or highly similar target role: '{targetRole}' at {companyName}. Only if there are not enough search matches for the exact role, fall back to listing other current active technical/engineering employees (e.g. software engineers, frontend/backend developers, product managers, designers).
   - For the 'linkedinUrl' property of each current employee, generate a correctly formatted, functional LinkedIn search redirect link: https://www.linkedin.com/search/results/people/?keywords=[Encoded_Keywords] utilizing clean, URL-encoded keywords containing their Name, Title, and Company, ensuring zero broken links or placeholders.`;

export class CareerAgentService {
  public static async runAutonomousResearcher(params: ResearcherParams) {
    logger.info({ companyName: params.companyName, targetRole: params.targetRole }, "Running Autonomous Career Researcher");

    let searchResultsStr = "";
    let isSimulated = true;
    let searchProvider = "Simulated";

    // Clean API Key from double quotes if present in env loader
    const cleanApiKey = env.TAVILY_API_KEY ? env.TAVILY_API_KEY.replace(/['"]/g, "") : "";

    // 1. DYNAMIC TIME RANGE: Calculate 45 days ago in YYYY-MM-DD format
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 45);
    const startDateStr = dateLimit.toISOString().split("T")[0];

    // MAPPED QUERIES
    const query1 = `${params.companyName} official website main products services`;
    const query2 = `${params.companyName} recent news announcements 2026 engineering blog`;
    const query3 = `${params.companyName} Glassdoor reviews culture values work environment`;
    const query4 = `${params.companyName} engineering tech stack frontend backend devops`;

    let res1: any = null;
    let res2: any = null;
    let res3: any = null;
    let res4: any = null;

    // FORCE FALLBACK TESTING FLAG
    // Set to 'true' to explicitly bypass Tavily and force testing of the keyless DuckDuckGo scraper.
    // Set to 'false' to use Tavily as primary.
    const FORCE_FALLBACK = false;

    // TRY PRIMARY SEARCH (Tavily API)
    if (cleanApiKey && !FORCE_FALLBACK) {
      try {
        logger.info("Initializing primary Tavily Web Search...");
        const searchTool = new TavilySearch({
          tavilyApiKey: cleanApiKey,
          maxResults: 5,
        });

        logger.info({ startDateStr }, "Invoking Tavily Search in parallel with 45 days limit (allSettled)");
        const settled = await Promise.allSettled([
          searchTool.invoke({ query: query1, start_date: startDateStr }),
          searchTool.invoke({ query: query2, start_date: startDateStr }),
          searchTool.invoke({ query: query3, start_date: startDateStr }),
          searchTool.invoke({ query: query4, start_date: startDateStr })
        ]);

        res1 = settled[0].status === "fulfilled" ? settled[0].value : null;
        res2 = settled[1].status === "fulfilled" ? settled[1].value : null;
        res3 = settled[2].status === "fulfilled" ? settled[2].value : null;
        res4 = settled[3].status === "fulfilled" ? settled[3].value : null;

        // Log any queries that failed for diagnostics
        settled.forEach((result, idx) => {
          if (result.status === "rejected") {
            logger.error({ err: result.reason, idx }, `Primary Search Query ${idx + 1} failed`);
          }
        });

        // Resolve status based on successful query results
        if (res1 || res2 || res3 || res4) {
          isSimulated = false;
          searchProvider = "Tavily Search";
          logger.info("Primary search completed successfully with partial or full results.");
        }
      } catch (err) {
        logger.error({ err }, "Primary Search completely failed. Falling back to DuckDuckGo/Yahoo...");
      }
    }

    // TRY FALLBACK SEARCH (100% Free Yahoo Scraper using LangChain CheerioWebBaseLoader)
    if (isSimulated) {
      try {
        logger.info("Triggering Yahoo Search fallback searches in parallel (allSettled)...");
        const settled = await Promise.allSettled([
          executeFallbackSearchYahoo(query1),
          executeFallbackSearchYahoo(query2),
          executeFallbackSearchYahoo(query3),
          executeFallbackSearchYahoo(query4)
        ]);

        res1 = settled[0].status === "fulfilled" ? settled[0].value : [];
        res2 = settled[1].status === "fulfilled" ? settled[1].value : [];
        res3 = settled[2].status === "fulfilled" ? settled[2].value : [];
        res4 = settled[3].status === "fulfilled" ? settled[3].value : [];

        // Log any queries that failed for diagnostics
        settled.forEach((result, idx) => {
          if (result.status === "rejected") {
            logger.error({ err: result.reason, idx }, `Yahoo Search Fallback Query ${idx + 1} failed`);
          }
        });

        const hasResults =
          (Array.isArray(res1) && res1.length > 0) ||
          (Array.isArray(res2) && res2.length > 0) ||
          (Array.isArray(res3) && res3.length > 0) ||
          (Array.isArray(res4) && res4.length > 0);

        if (hasResults) {
          isSimulated = false;
          searchProvider = "Yahoo Search (Keyless)";
          logger.info("Yahoo Search fallback search succeeded with partial or full results!");
        }
      } catch (yahooErr) {
        logger.error({ yahooErr }, "Yahoo Search fallback search completely failed.");
      }
    }

    // FORMAT AND COMPILE RESULTS
    if (isSimulated) {
      throw new Error("Search failed. Both Tavily search and Cheerio search fallback returned no results. Real-time search is required.");
    }

    const formattedRes1 = formatSearchResults(res1, params.companyName);
    const formattedRes2 = formatSearchResults(res2, params.companyName);
    const formattedRes3 = formatSearchResults(res3, params.companyName);
    const formattedRes4 = formatSearchResults(res4, params.companyName);

    // Print search results directly to the backend terminal console for transparency
    console.log("\n========================================================");
    console.log(`🔍 [AGENT RECON] AUTONOMOUS WEB SEARCH VIA: ${searchProvider.toUpperCase()}`);
    console.log(`TARGET COMPANY: ${params.companyName.toUpperCase()} (Past 45 Days Limit)`);
    console.log("========================================================");
    console.log(`\n[QUERY 1] ${query1}`);
    console.log("--------------------------------------------------------");
    console.log(formattedRes1 || "No results.");

    console.log(`\n[QUERY 2] ${query2}`);
    console.log("--------------------------------------------------------");
    console.log(formattedRes2 || "No results.");

    console.log(`\n[QUERY 3] ${query3}`);
    console.log("--------------------------------------------------------");
    console.log(formattedRes3 || "No results.");

    console.log(`\n[QUERY 4] ${query4}`);
    console.log("--------------------------------------------------------");
    console.log(formattedRes4 || "No results.");
    console.log("========================================================\n");

    searchResultsStr = `
--- SEGMENT 1: COMPANY WEBSITE INDEX & PRODUCTS ---
${formattedRes1}

--- SEGMENT 2: RECENT BUSINESS & PRODUCT NEWS / BLOG RELEASES ---
${formattedRes2}

--- SEGMENT 3: GLASSDOOR REVIEWS & EMPLOYEE CULTURE ---
${formattedRes3}

--- SEGMENT 4: ENGINEERING & TECHNOLOGY STACK ---
${formattedRes4}
`;

    const prompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(RESEARCHER_SYSTEM_TEMPLATE),
      HumanMessagePromptTemplate.fromTemplate("{humanPrompt}"),
    ]);

    const structuredLLMRunnable = new RunnableLambda({
      func: async (messages: any) => {
        return invokeStructuredLLMWithFallback(
          DossierSchema,
          messages,
          { timeout: 15000 }
        );
      }
    });

    const chain = prompt.pipe(structuredLLMRunnable);

    const contactNameText = params.contactName ? `- Target Contact: ${params.contactName}` : "";

    const humanPrompt = `Compile an extremely specific, factual, and verified strategic dossier for ${params.companyName} - ${params.targetRole}.`;

    try {
      const parsedOutput = await chain.invoke({
        companyName: params.companyName,
        targetRole: params.targetRole,
        contactNameText,
        hookType: params.hookType,
        searchProvider,
        searchResultsStr,
        humanPrompt,
      });

      return {
        isSimulated: false,
        ...parsedOutput,
      };
    } catch (error) {
      logger.error({ error }, "Error invoking structured LLM for researcher dossier");
      throw error;
    }
  }

  public static async runAutonomousScout(params: ScoutParams) {
    logger.info({ companyName: params.companyName, targetRole: params.targetRole, divisionFilter: params.divisionFilter }, "Running Autonomous Network Scout Agent");

    let searchResultsStr = "";
    let isSimulated = true;
    let searchProvider = "Simulated";

    // Clean API Key from double quotes if present in env loader
    const cleanApiKey = env.TAVILY_API_KEY ? env.TAVILY_API_KEY.replace(/['"]/g, "") : "";

    // Calculate 45 days ago in YYYY-MM-DD format
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 45);
    const startDateStr = dateLimit.toISOString().split("T")[0];

    // CONSTRUCT SCOUT SEARCH QUERIES
    const query1 = `"${params.companyName}" engineering leadership managers director vp ${params.divisionFilter || ""}`;
    const query2 = `"${params.companyName}" technical recruiter talent acquisition hiring manager`;
    const query3 = `"${params.companyName}" office locations corporate headquarters engineering divisions org structure`;
    const query4 = `"${params.companyName}" recent hiring announcements engineering growth 2026`;
    const query5 = `"${params.companyName}" "${params.targetRole}" current active employees profiles developers`;

    let res1: any = null;
    let res2: any = null;
    let res3: any = null;
    let res4: any = null;
    let res5: any = null;

    const FORCE_FALLBACK = false;

    // TRY PRIMARY SEARCH (Tavily API)
    if (cleanApiKey && !FORCE_FALLBACK) {
      try {
        logger.info("Initializing primary Tavily Web Search for Network Scout...");
        const searchTool = new TavilySearch({
          tavilyApiKey: cleanApiKey,
          maxResults: 5,
        });

        logger.info({ startDateStr }, "Invoking Tavily Search for Scout in parallel (allSettled)");
        const settled = await Promise.allSettled([
          searchTool.invoke({ query: query1, start_date: startDateStr }),
          searchTool.invoke({ query: query2, start_date: startDateStr }),
          searchTool.invoke({ query: query3, start_date: startDateStr }),
          searchTool.invoke({ query: query4, start_date: startDateStr }),
          searchTool.invoke({ query: query5, start_date: startDateStr })
        ]);

        res1 = settled[0].status === "fulfilled" ? settled[0].value : null;
        res2 = settled[1].status === "fulfilled" ? settled[1].value : null;
        res3 = settled[2].status === "fulfilled" ? settled[2].value : null;
        res4 = settled[3].status === "fulfilled" ? settled[3].value : null;
        res5 = settled[4].status === "fulfilled" ? settled[4].value : null;

        // Log any queries that failed for diagnostics
        settled.forEach((result, idx) => {
          if (result.status === "rejected") {
            logger.error({ err: result.reason, idx }, `Primary Scout Search Query ${idx + 1} failed`);
          }
        });

        if (res1 || res2 || res3 || res4 || res5) {
          isSimulated = false;
          searchProvider = "Tavily Search";
          logger.info("Primary Scout search completed successfully with partial or full results.");
        }
      } catch (err) {
        logger.error({ err }, "Primary Scout Search completely failed. Falling back to Yahoo...");
      }
    }

    // TRY FALLBACK SEARCH (Yahoo Scraper using CheerioWebBaseLoader)
    if (isSimulated) {
      try {
        logger.info("Triggering Yahoo Search fallback searches for Scout in parallel (allSettled)...");
        const settled = await Promise.allSettled([
          executeFallbackSearchYahoo(query1),
          executeFallbackSearchYahoo(query2),
          executeFallbackSearchYahoo(query3),
          executeFallbackSearchYahoo(query4),
          executeFallbackSearchYahoo(query5)
        ]);

        res1 = settled[0].status === "fulfilled" ? settled[0].value : [];
        res2 = settled[1].status === "fulfilled" ? settled[1].value : [];
        res3 = settled[2].status === "fulfilled" ? settled[2].value : [];
        res4 = settled[3].status === "fulfilled" ? settled[3].value : [];
        res5 = settled[4].status === "fulfilled" ? settled[4].value : [];

        // Log any queries that failed for diagnostics
        settled.forEach((result, idx) => {
          if (result.status === "rejected") {
            logger.error({ err: result.reason, idx }, `Yahoo Search Scout Fallback Query ${idx + 1} failed`);
          }
        });

        const hasResults =
          (Array.isArray(res1) && res1.length > 0) ||
          (Array.isArray(res2) && res2.length > 0) ||
          (Array.isArray(res3) && res3.length > 0) ||
          (Array.isArray(res4) && res4.length > 0) ||
          (Array.isArray(res5) && res5.length > 0);

        if (hasResults) {
          isSimulated = false;
          searchProvider = "Yahoo Search (Keyless)";
          logger.info("Yahoo Search fallback search for Scout succeeded!");
        }
      } catch (yahooErr) {
        logger.error({ yahooErr }, "Yahoo Search fallback search for Scout completely failed.");
      }
    }

    // FORMAT AND COMPILE RESULTS
    if (isSimulated) {
      throw new Error("Search failed. Both Tavily search and Cheerio search fallback returned no results. Real-time search is required.");
    }

    const formattedRes1 = formatSearchResults(res1, params.companyName);
    const formattedRes2 = formatSearchResults(res2, params.companyName);
    const formattedRes3 = formatSearchResults(res3, params.companyName);
    const formattedRes4 = formatSearchResults(res4, params.companyName);
    const formattedRes5 = formatSearchResults(res5, params.companyName);

    console.log("\n========================================================");
    console.log(`🔍 [SCOUT RECON] AUTONOMOUS NETWORK SEARCH VIA: ${searchProvider.toUpperCase()}`);
    console.log(`TARGET COMPANY: ${params.companyName.toUpperCase()} (Past 45 Days Limit)`);
    console.log("========================================================");
    console.log(`\n[QUERY 1] ${query1}`);
    console.log("--------------------------------------------------------");
    console.log(formattedRes1 || "No results.");

    console.log(`\n[QUERY 2] ${query2}`);
    console.log("--------------------------------------------------------");
    console.log(formattedRes2 || "No results.");

    console.log(`\n[QUERY 3] ${query3}`);
    console.log("--------------------------------------------------------");
    console.log(formattedRes3 || "No results.");

    console.log(`\n[QUERY 4] ${query4}`);
    console.log("--------------------------------------------------------");
    console.log(formattedRes4 || "No results.");

    console.log(`\n[QUERY 5] ${query5}`);
    console.log("--------------------------------------------------------");
    console.log(formattedRes5 || "No results.");
    console.log("========================================================\n");

    searchResultsStr = `
--- SEGMENT 1: ENGINEERING LEADERS & MANAGERS ---
${formattedRes1}

--- SEGMENT 2: RECRUITERS & TALENT ACQUISITION ---
${formattedRes2}

--- SEGMENT 3: OFFICE LOCATIONS & CORPORATE DIVISIONS ---
${formattedRes3}

--- SEGMENT 4: RECENT HIRING & ENGINEERING ANNOUNCEMENTS ---
${formattedRes4}

--- SEGMENT 5: ACTIVE CURRENT DEVELOPERS & STAFF PROFILES ---
${formattedRes5}
`;

    const prompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(SCOUT_SYSTEM_TEMPLATE),
      HumanMessagePromptTemplate.fromTemplate("{humanPrompt}"),
    ]);

    const structuredLLMRunnable = new RunnableLambda({
      func: async (messages: any) => {
        return invokeStructuredLLMWithFallback(
          ScoutDossierSchema,
          messages,
          { timeout: 15000 }
        );
      }
    });

    const chain = prompt.pipe(structuredLLMRunnable);

    const divisionFilterText = params.divisionFilter ? `- Division/Department Filter: ${params.divisionFilter}` : "";

    const humanPrompt = `Compile an extremely specific, verified, and premium network scout brief and networking matrix for ${params.companyName} - ${params.targetRole}.`;

    try {
      const parsedOutput = await chain.invoke({
        companyName: params.companyName,
        targetRole: params.targetRole,
        divisionFilterText,
        searchProvider,
        searchResultsStr,
        humanPrompt,
      });

      return {
        isSimulated: false,
        ...parsedOutput,
      };
    } catch (error) {
      logger.error({ error }, "Error invoking structured LLM for scout dossier");
      throw error;
    }
  }
}
