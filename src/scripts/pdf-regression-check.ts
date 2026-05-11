import { pdfExportService } from "../services/pdf-export.service";

const shortResume = {
  personalInfo: {
    name: "Aarav Sharma",
    email: "aarav@example.com",
    phone: "+91 9876543210",
    location: "Bengaluru, India",
    links: ["linkedin.com/in/aarav", "github.com/aarav"],
  },
  summary: "Software engineer with strong backend experience and product ownership.",
  experience: [
    {
      role: "Software Engineer",
      company: "Acme Inc",
      location: "Remote",
      startDate: "2022",
      endDate: "Present",
      bullets: [
        "Built scalable APIs serving 1M+ requests/day.",
        "Improved latency by 35% through cache and query tuning.",
      ],
    },
  ],
  education: [{ degree: "B.Tech CSE", school: "NIT", gradDate: "2022" }],
  skills: ["Node.js", "TypeScript", "MongoDB"],
  projects: [{ name: "Resume Optimizer", description: "AI-assisted resume rewrite workflow." }],
  certifications: [{ name: "AWS Developer Associate", issuer: "AWS", date: "2024" }],
};

const longResume = {
  ...shortResume,
  summary:
    "Senior software engineer focused on distributed systems, developer tooling, and AI-assisted workflows.\n" +
    "Experienced in cross-functional collaboration, hiring loops, and architecture leadership across multi-team programs.",
  experience: [
    ...shortResume.experience,
    {
      role: "Senior Engineer",
      company: "Globex",
      location: "Bengaluru",
      startDate: "2020",
      endDate: "2022",
      bullets: Array.from({ length: 10 }).map(
        (_, idx) => `Delivered measurable engineering impact item ${idx + 1} with quantifiable outcomes.`
      ),
    },
  ],
  projects: [
    ...shortResume.projects,
    {
      name: "Realtime Collaboration Platform",
      bullets: [
        "Implemented CRDT-based sync for collaborative editing.",
        "Reduced conflict resolution failure rate by 80%.",
      ],
    },
  ],
};

const jdStyledResume = {
  personalInfo: { name: "JD Matched Resume" },
  summary: [
    "Role: Senior Backend Engineer",
    "Company: Contoso",
    "Match Score: 86%",
    "",
    "Optimized Highlights",
    "1. Improved: Built resilient event-driven architecture for order processing.",
    "   Original: Worked on backend services.",
    "2. Improved: Led observability rollout reducing MTTR by 42%.",
    "   Original: Added monitoring dashboards.",
  ].join("\n"),
  experience: [],
  education: [],
  skills: ["Node.js", "Kafka", "PostgreSQL", "System Design"],
  projects: [],
  certifications: [],
};

async function run() {
  const templates: Array<"modern" | "classic" | "minimalist"> = ["modern", "classic", "minimalist"];
  const datasets = [
    { name: "short", data: shortResume },
    { name: "long", data: longResume },
    { name: "jd", data: jdStyledResume },
  ];

  for (const template of templates) {
    for (const dataset of datasets) {
      const buffer = await pdfExportService.generateResumePdf(dataset.data, template);
      if (!buffer || buffer.length < 1000) {
        throw new Error(`PDF regression check failed for ${template}/${dataset.name}: buffer too small`);
      }
      console.log(`[pdf-check] ${template}/${dataset.name}: ${buffer.length} bytes`);
    }
  }
}

run()
  .then(() => {
    console.log("[pdf-check] All PDF regression checks passed.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[pdf-check] Failed:", err);
    process.exit(1);
  });
