import type { FieldGuide, GuidePath } from "./types";

/*
 * One field guide per target path. Written for a performance coach moving
 * into these roles: how the work actually flows, what you'll be measured on,
 * and how coaching experience maps across — honestly, without pretending
 * coaching was SaaS. Every `terms` / `term` value is a glossary key.
 */

const customerSuccess: FieldGuide = {
  path: "customer_success",
  title: "Customer success",
  oneLiner: "You own a set of customers after they buy, and your job is to get them to the results they paid for, so they renew and grow.",
  depth: "full",
  dayInTheLife: [
    "Start by checking your accounts' health: usage dips, new support tickets, renewals coming up in the next 90 days.",
    "Two or three customer calls: a check-in with a champion, a training session for new users, a planning call with an executive sponsor.",
    "Prepare a QBR deck: pull usage data, tie it to the goals in their success plan, propose next quarter's priorities.",
    "Chase an internal answer for a customer: a bug with support, a feature request with product, a contract question with the account manager.",
    "Log notes and next steps in the CRM or CS platform. If it isn't logged, it didn't happen.",
    "Work a risk: an account whose usage dropped after their champion left. Find the new stakeholder and re-run onboarding for their team.",
  ],
  workflow: [
    {
      name: "Handoff and kickoff",
      what: "Sales hands over the account. You confirm why they bought, who's involved, what success looks like and the timeline, then run a kickoff call.",
      artifacts: ["Handoff notes", "Kickoff deck", "Stakeholder map"],
      coachingAnalog: "The intake with a new client or team: their goals, history, constraints and who else is involved (manager, medical, family).",
      terms: ["handoff", "kickoff", "stakeholder", "discovery"],
    },
    {
      name: "Onboarding",
      what: "Get the customer set up and to a first real win as fast as possible. Sometimes a separate implementation team does this and you take over after.",
      artifacts: ["Onboarding plan", "Training sessions", "Success plan"],
      coachingAnalog: "The first phase of a program: teach the basics, build the habit and get an early result so they stay bought in.",
      terms: ["onboarding", "ttv", "success-plan", "train-the-trainer"],
    },
    {
      name: "Adoption",
      what: "Drive real usage across the customer's team: training, office hours, best-practice tips, showing champions how to spread it internally.",
      artifacts: ["Usage reports", "Enablement sessions", "Help-center content"],
      coachingAnalog: "Adherence. Getting people to actually do the program between sessions, adjusting when they don't.",
      terms: ["adoption", "dau-mau", "champion", "change-management"],
    },
    {
      name: "Health monitoring and risk",
      what: "Watch health scores and leading indicators. When an account goes red, diagnose why and run a save play.",
      artifacts: ["Health dashboard", "Risk log", "Save plan"],
      coachingAnalog: "Spotting the athlete who's quietly checking out (missed sessions, flat effort) and intervening before they quit.",
      terms: ["health-score", "at-risk", "save-play", "leading-lagging", "escalation"],
    },
    {
      name: "Business reviews",
      what: "Show leaders the value delivered against their goals and agree priorities for next period.",
      artifacts: ["QBR / EBR deck", "Updated success plan"],
      coachingAnalog: "A progress review with a stakeholder: here's where we started, here's what changed, here's the next block.",
      terms: ["qbr", "executive-sponsor", "roi", "kpi"],
    },
    {
      name: "Renewal and expansion",
      what: "Secure the renewal (or support the account manager who owns it) and spot growth: more teams, more seats, another product.",
      artifacts: ["Renewal forecast", "Expansion opportunities (CSQLs)", "Customer references"],
      coachingAnalog: "Re-signing a client for another block, and the referral that brings in their teammates.",
      terms: ["renewal", "expansion", "csql", "nrr", "advocacy"],
    },
  ],
  metrics: [
    { term: "grr", whyItMatters: "The cleanest measure of whether CS is keeping customers. Often the team's top metric." },
    { term: "nrr", whyItMatters: "Retention plus growth. Above 100% means existing customers grow the business on their own." },
    { term: "churn", whyItMatters: "What CS exists to prevent. Know both logo churn and revenue churn." },
    { term: "health-score", whyItMatters: "How you prioritize a book of 30–100 accounts. Interviewers ask what you'd put in one." },
    { term: "adoption", whyItMatters: "The strongest leading indicator of renewal in most products." },
    { term: "ttv", whyItMatters: "Long time-to-value is one of the earliest churn signals." },
    { term: "nps", whyItMatters: "Commonly reported; know its limits (it measures sentiment, not usage)." },
    { term: "csat", whyItMatters: "Measures individual interactions such as trainings and tickets." },
  ],
  tools: [
    { name: "Gainsight, ChurnZero, Totango, Vitally, Planhat", category: "CS platform", note: "Where health scores, playbooks and account timelines live. Gainsight is the most common in enterprise postings." },
    { name: "Salesforce, HubSpot", category: "CRM", note: "The customer record of truth. Expect to log activity and read renewal opportunities here." },
    { name: "Zendesk, Intercom, Freshdesk", category: "Support desk", note: "You won't run tickets, but you'll read them to understand an account's pain." },
    { name: "Pendo, Amplitude, Mixpanel", category: "Product analytics", note: "Where usage data comes from. Being able to pull a usage report is a real edge." },
    { name: "Gong, Zoom, Loom", category: "Calls and video", note: "Call recording and async video updates are standard." },
    { name: "Excel / Google Sheets, slides", category: "Everyday", note: "Pivot tables, VLOOKUP/XLOOKUP, and building a clean QBR deck come up constantly." },
  ],
  interviewLoop: [
    { name: "Recruiter screen (30 min)", what: "Background, why CS, salary expectations, logistics.", tip: "Have a 60-second pivot story ready: coaching → why customers → why this company." },
    { name: "Hiring manager (45–60 min)", what: "Behavioral questions on managing relationships, handling an unhappy client, prioritizing many accounts and using data.", tip: "Use STAR stories with numbers. Translate coaching terms into theirs (adherence → adoption)." },
    { name: "Presentation or case (60 min)", what: "Very common in CS: a mock QBR, a 30-60-90 day plan, an onboarding plan for a sample customer, or a churn-save role-play.", tip: "Structure it like a business review: goals → results → risks → next steps. Ask clarifying questions before solving." },
    { name: "Cross-functional panel", what: "Sales, support or product peers check how you'd collaborate and hand off.", tip: "Show you know where CS ends and support or sales begins." },
    { name: "Final / leadership", what: "Values, motivation and long-term fit.", tip: "Ask about their CS model (segments, book size, who owns renewals) to show you know what to look for." },
  ],
  switcherConcerns: [
    { concern: "\"You've never worked in software.\"", answer: "True, and don't hide it. Point to what transfers directly (owning outcomes for clients, driving adherence, delivering results through other people) and show you've done the homework: you know the metrics, the tools and their product." },
    { concern: "\"Can you handle a commercial conversation like a renewal or upsell?\"", answer: "Use real examples of re-signing clients, expanding programs or justifying value to the person paying. If you don't have them, say so and describe how you'd prepare." },
    { concern: "\"Can you manage 50 accounts, not 15 athletes?\"", answer: "Show how you prioritized when demand exceeded time: group sessions, templates, triage. That's segmentation and tech-touch in coaching form." },
    { concern: "\"Are you data-driven?\"", answer: "Bring a story where you tracked metrics (attendance, performance tests, retention) and changed course because of them." },
  ],
  translation: [
    { coaching: "Client intake and needs assessment", business: "Discovery and success planning" },
    { coaching: "Program adherence", business: "Product adoption" },
    { coaching: "Client retention, re-signing", business: "Retention and renewals" },
    { coaching: "Spotting a disengaged client", business: "Risk identification from health signals" },
    { coaching: "Progress review with a stakeholder", business: "QBR / executive business review" },
    { coaching: "Referrals from happy clients", business: "Expansion and customer advocacy" },
    { coaching: "Group sessions to reach more people", business: "Scaled / tech-touch CS" },
  ],
  firstSteps: [
    "Learn ARR, NRR, GRR and churn until you can explain them in one breath each.",
    "Draft a mock QBR for a coaching client you've had, using their language: goals, results, risks, next quarter.",
    "Do a free CRM basics course (Trailhead or HubSpot Academy) so \"Salesforce\" on a posting isn't a gap.",
    "Talk to two working CSMs. Ask how their health score is built and who owns renewals.",
  ],
};

const implementation: FieldGuide = {
  path: "implementation",
  title: "Implementation",
  oneLiner: "You run the project that takes a customer from signed contract to live and working, on time and in scope, then hand them off.",
  depth: "full",
  dayInTheLife: [
    "Review the project board: what's due this week, what's blocked, which customer owes you data.",
    "Run a discovery or requirements session: walk the customer through their current process and decide how the product will be set up.",
    "Configure the product in a sandbox: fields, workflows, permissions, templates. Test it.",
    "Work through a data import: clean the customer's spreadsheet, map columns, load it, check the counts match.",
    "Send a weekly status report: on track or not, risks, what you need from them by when.",
    "Lead admin training before go-live, then field questions during hypercare.",
  ],
  workflow: [
    {
      name: "Handoff from sales",
      what: "Read the contract and SOW, meet the solutions engineer or AE, and learn what was promised.",
      artifacts: ["SOW", "Handoff notes", "Risk list"],
      coachingAnalog: "Getting a client from another coach: read their file and confirm what they were told before you start.",
      terms: ["handoff", "sow", "solutions-engineer"],
    },
    {
      name: "Kickoff",
      what: "Align on goals, scope, timeline, roles and how you'll communicate.",
      artifacts: ["Kickoff deck", "Project plan", "RACI"],
      coachingAnalog: "Laying out the season plan with the team and staff: who does what, when the key dates are.",
      terms: ["kickoff", "project-plan", "raci", "milestone"],
    },
    {
      name: "Discovery and requirements",
      what: "Understand their current process and turn needs into specific configuration decisions.",
      artifacts: ["Requirements / design doc", "Process maps", "Data mapping sheet"],
      coachingAnalog: "A thorough assessment before writing a program: baseline, constraints, goals.",
      terms: ["discovery", "requirements", "sme"],
    },
    {
      name: "Configuration, integration and data",
      what: "Set up the product, connect it to their systems (SSO, HRIS, CRM) and migrate their data.",
      artifacts: ["Configured sandbox", "Integration checklist", "Import files"],
      coachingAnalog: "Building the actual program: exercises, progressions, scheduling, equipment.",
      terms: ["configuration", "integration", "sso", "api", "data-migration", "sandbox"],
    },
    {
      name: "Testing and training",
      what: "The customer tests against their requirements (UAT) and you train admins and champions.",
      artifacts: ["UAT script and sign-off", "Training sessions", "Admin guides"],
      coachingAnalog: "A test week before competition, and teaching assistant coaches to run sessions without you.",
      terms: ["uat", "train-the-trainer", "change-management"],
    },
    {
      name: "Go-live, hypercare and handoff",
      what: "Launch to real users, give extra support for a few weeks, then hand the account to CS with full notes.",
      artifacts: ["Go-live checklist", "Hypercare log", "Handoff to CSM"],
      coachingAnalog: "Competition day, close follow-up after, then handing the athlete to the next coach with their history.",
      terms: ["go-live", "hypercare", "handoff"],
    },
  ],
  metrics: [
    { term: "ttv", whyItMatters: "How fast customers go live and see value: the headline implementation metric." },
    { term: "milestone", whyItMatters: "On-time delivery against plan, often tied to payments." },
    { term: "scope-creep", whyItMatters: "Projects that grow unchecked run late and over budget; you're judged on controlling it." },
    { term: "csat", whyItMatters: "Post-implementation survey scores are a common team KPI." },
    { term: "billable-utilization", whyItMatters: "In professional-services teams, the share of your hours that's billable." },
    { term: "adoption", whyItMatters: "Go-live without usage isn't success; strong teams track adoption after launch." },
  ],
  tools: [
    { name: "Rocketlane, GuideCX", category: "Customer onboarding / project tools", note: "Purpose-built implementation project tools with customer-facing plans." },
    { name: "Asana, Monday.com, Smartsheet", category: "Project management", note: "General project tools; Smartsheet shows up in enterprise and healthcare." },
    { name: "Jira, Confluence", category: "Issue tracking and docs", note: "Where you log bugs for engineering and write internal docs." },
    { name: "Salesforce, HubSpot", category: "CRM", note: "Where the deal, SOW and customer record live." },
    { name: "Excel / Google Sheets", category: "Data work", note: "Cleaning and mapping customer data: XLOOKUP, pivot tables, text functions, removing duplicates." },
    { name: "Postman, SQL basics", category: "Technical (bonus)", note: "Not always required, but testing an API call or writing a simple query separates candidates." },
    { name: "Okta, Azure AD / Entra ID", category: "SSO", note: "You'll coordinate SSO setup with the customer's IT team." },
  ],
  interviewLoop: [
    { name: "Recruiter screen", what: "Background, project experience, comfort with technical topics.", tip: "Name the projects you ran end to end, with dates and outcomes." },
    { name: "Hiring manager", what: "How you run a project, handle a customer missing deadlines, manage scope creep and juggle several projects.", tip: "Have a story for each: a slipped deadline, a scope request you said no to, a hard stakeholder." },
    { name: "Scenario or case exercise", what: "Build an implementation plan for a sample customer, walk through a data-mapping task, or role-play a kickoff.", tip: "Show phases, owners, dependencies and risks. Say what you'd confirm before committing to dates." },
    { name: "Technical check (some roles)", what: "Light questions on APIs, SSO, data imports or spreadsheets, sometimes a quick exercise.", tip: "Be honest about your level; show you learn fast with a concrete example." },
    { name: "Panel / final", what: "CS, support and solutions engineering peers check collaboration.", tip: "Show you think about the handoff after you: what does the CSM need from you?" },
  ],
  switcherConcerns: [
    { concern: "\"This role is technical.\"", answer: "Show the basics are already in hand (what an API, SSO and a data import are) and name what you're learning now. Spreadsheet skill is concrete proof." },
    { concern: "\"Have you run real projects?\"", answer: "Programs, camps, onsite launches and facility moves are projects. Describe them with scope, timeline, stakeholders and the outcome." },
    { concern: "\"Can you say no to a customer?\"", answer: "Give an example of holding a boundary with a client or parent while keeping the relationship, which is scope management." },
  ],
  translation: [
    { coaching: "Building a season or program plan", business: "Project plan with milestones" },
    { coaching: "Initial assessment", business: "Discovery and requirements gathering" },
    { coaching: "Training assistant coaches", business: "Train-the-trainer / admin enablement" },
    { coaching: "Program launch day", business: "Go-live" },
    { coaching: "Saying no to off-plan requests", business: "Managing scope creep" },
    { coaching: "Coordinating staff, facility and athletes", business: "Cross-functional project coordination" },
  ],
  firstSteps: [
    "Write a one-page implementation plan for launching a coaching program at a new company: phases, owners, dates, risks.",
    "Do a Jira or project-management fundamentals course so the tools aren't a blocker.",
    "Practice a data import: take a messy spreadsheet, clean and map it to a template, and note what you checked.",
    "Learn to explain SSO, an API and UAT in plain words.",
  ],
};

const employerWellbeing: FieldGuide = {
  path: "employer_wellbeing",
  title: "Employer wellbeing",
  oneLiner: "You manage the relationship between a wellbeing vendor (or onsite program) and the employers who buy it: launch it well, drive participation, prove value, renew.",
  depth: "full",
  dayInTheLife: [
    "Check program dashboards: enrollment and utilization by client, upcoming campaigns, open-enrollment dates.",
    "Meet an HR or benefits lead to plan next quarter's campaign around a theme like sleep, stress or movement.",
    "Work with the client's comms team on launch emails, manager talking points and posters.",
    "Prepare an aggregate utilization and outcomes report for a renewal conversation, with no individual data.",
    "Coordinate with the benefits broker, who influences whether the program renews.",
    "Sort out an eligibility-file issue: new hires not showing up in the platform.",
  ],
  workflow: [
    {
      name: "Sale and needs assessment",
      what: "Understand the employer's population, goals (retention, mental health, costs) and existing benefits, often with their broker.",
      artifacts: ["Needs assessment", "Population overview (aggregate)", "Proposal"],
      coachingAnalog: "Assessing a group before designing their program: who they are, what they need, what's already in place.",
      terms: ["discovery", "population-health", "benefits-broker", "total-rewards"],
    },
    {
      name: "Implementation and launch",
      what: "Set up eligibility, SSO and benefits-platform links, build the comms plan, and launch to employees.",
      artifacts: ["Implementation timeline", "Eligibility file spec", "Comms plan and launch kit"],
      coachingAnalog: "Launching a new onsite program: logistics, scheduling, getting the word out so people show up.",
      terms: ["implementation", "eligibility-file", "hris", "sso", "comms-plan", "go-live"],
    },
    {
      name: "Engagement",
      what: "Run campaigns, challenges, events and manager toolkits through the year to keep people participating.",
      artifacts: ["Engagement calendar", "Campaign materials", "Event plans"],
      coachingAnalog: "Keeping a group motivated across a season: challenges, events, recognition, variety.",
      terms: ["engagement-rate", "incentives", "champion", "open-enrollment"],
    },
    {
      name: "Reporting and value",
      what: "Report utilization, engagement and outcomes in aggregate, and connect them to what the employer cares about.",
      artifacts: ["Utilization report", "Annual review deck", "Outcomes or VOI summary"],
      coachingAnalog: "End-of-block testing and a report to the head coach or sponsor showing what changed.",
      terms: ["utilization", "aggregate-reporting", "voi", "roi", "hipaa"],
    },
    {
      name: "Renewal and growth",
      what: "Renew the contract, often through the broker's annual review, and expand to new sites, populations or services.",
      artifacts: ["Renewal deck", "Expansion proposal"],
      coachingAnalog: "Re-signing a corporate client and adding a second location or service.",
      terms: ["renewal", "expansion", "rfp", "pepm"],
    },
  ],
  metrics: [
    { term: "utilization", whyItMatters: "The number buyers watch most: are employees actually using what we pay for?" },
    { term: "engagement-rate", whyItMatters: "Define it precisely; buyers compare vendors on it." },
    { term: "voi", whyItMatters: "Most wellbeing value is hard to prove in dollars, so VOI framing is common." },
    { term: "roi", whyItMatters: "Buyers still ask. Be careful: honest answers beat inflated claims." },
    { term: "nps", whyItMatters: "Member and client NPS are both commonly reported." },
    { term: "renewal", whyItMatters: "Account and client managers are usually measured on retention." },
  ],
  tools: [
    { name: "Personify Health (formerly Virgin Pulse), Wellhub (formerly Gympass), Headspace, Calm Business, Lyra Health, Spring Health, Hinge Health, Omada", category: "Example wellbeing vendors", note: "Companies whose client success and implementation teams hire for these roles; know a few and how they differ." },
    { name: "Workday, ADP, UKG", category: "HRIS", note: "Where eligibility data comes from." },
    { name: "bswift, Businessolver, Benefitfocus", category: "Benefits administration", note: "Where employees enroll and find benefits." },
    { name: "Salesforce, HubSpot", category: "CRM", note: "Client records, renewals and activity." },
    { name: "Excel / Sheets, Tableau / Power BI", category: "Reporting", note: "Utilization reports and renewal decks." },
  ],
  interviewLoop: [
    { name: "Recruiter screen", what: "Background, why wellbeing, why the business side.", tip: "Your coaching background is directly relevant here, so lead with it." },
    { name: "Hiring manager", what: "Client management, driving participation, handling a dissatisfied HR buyer, working with brokers.", tip: "Bring participation numbers from programs you ran, and how you grew them." },
    { name: "Presentation or case", what: "A launch or engagement plan for a sample employer, or a renewal review with low utilization.", tip: "Segment the population, pick channels and set measurable goals. Address low utilization honestly." },
    { name: "Panel / final", what: "Clinical, implementation or sales peers; values fit.", tip: "Show you respect privacy boundaries (aggregate only) and clinical scope." },
  ],
  switcherConcerns: [
    { concern: "\"Coaching is delivery. This is account management.\"", answer: "Point to the account-facing work you did: reporting to the client's HR, planning with their leaders, renewing or growing the program." },
    { concern: "\"Do you understand how employers buy benefits?\"", answer: "Show you know the cycle: brokers, open enrollment, PEPM pricing, self-insured vs fully insured. It's learnable, and you've learned it." },
    { concern: "\"Can you prove value without overclaiming?\"", answer: "Give an example of reporting real participation and outcomes, including what didn't work." },
  ],
  translation: [
    { coaching: "Running an onsite corporate program", business: "Onsite program / client delivery" },
    { coaching: "Class attendance and participation", business: "Utilization and engagement rate" },
    { coaching: "Challenges, events, campaigns", business: "Engagement strategy" },
    { coaching: "Reporting to the client's HR or leadership", business: "Account review / renewal reporting" },
    { coaching: "Keeping client health information private", business: "HIPAA-aware aggregate reporting" },
  ],
  firstSteps: [
    "Learn the benefits calendar: when open enrollment happens and when renewal decisions get made.",
    "Read an employer benefits survey summary so you can talk about cost trends and what employers are adding.",
    "Write a one-page engagement plan for a 2,000-employee company launching a new program.",
    "Put your own participation numbers from programs you ran in your achievement library, marked verified or approximate.",
  ],
};

const accountManagement: FieldGuide = {
  path: "account_management",
  title: "Account management",
  oneLiner: "You own the commercial relationship with existing customers: renewals, pricing, upsells and growth, usually with a number to hit.",
  depth: "brief",
  dayInTheLife: [
    "Review the renewal pipeline and forecast: what closes this quarter and what's at risk.",
    "Call a customer about an upcoming renewal and price increase.",
    "Work with the CSM on an account plan: health, stakeholders, growth opportunities.",
    "Update opportunities in the CRM and send a proposal.",
  ],
  workflow: [
    {
      name: "Account planning",
      what: "Map stakeholders, goals and whitespace for each key account.",
      artifacts: ["Account plan", "Stakeholder map"],
      coachingAnalog: "Planning a client's year and spotting what else would help them.",
      terms: ["account-plan", "whitespace", "stakeholder"],
    },
    {
      name: "Renewals",
      what: "Start early, confirm value, handle pricing and procurement, close on time.",
      artifacts: ["Renewal opportunity", "Proposal / order form"],
      coachingAnalog: "Re-signing a client, including when the price goes up.",
      terms: ["renewal", "price-uplift", "procurement", "forecast"],
    },
    {
      name: "Expansion",
      what: "Sell more seats, products or teams where the customer is getting value.",
      artifacts: ["Expansion proposal", "Pipeline"],
      coachingAnalog: "Adding a second team or service for a happy client.",
      terms: ["upsell", "cross-sell", "pipeline", "quota"],
    },
  ],
  metrics: [
    { term: "nrr", whyItMatters: "The AM's core outcome: keep and grow revenue." },
    { term: "quota", whyItMatters: "Most AM roles carry one; know whether it's on renewals, expansion or both." },
    { term: "forecast", whyItMatters: "Forecast accuracy is how leaders trust you." },
  ],
  tools: [
    { name: "Salesforce, HubSpot", category: "CRM", note: "Opportunities, forecasting and activity live here." },
    { name: "Gong, Outreach, Salesloft", category: "Sales tools", note: "Call recording and email sequences." },
  ],
  interviewLoop: [
    { name: "Recruiter and hiring manager", what: "Commercial experience, how you handle price objections, your forecasting.", tip: "Bring any revenue you influenced: re-signs, upsells, sponsorships." },
    { name: "Role-play", what: "Often a renewal with a price increase, or a customer threatening to leave.", tip: "Listen first, restate their concern, anchor on value, and know your walk-away." },
  ],
  switcherConcerns: [
    { concern: "\"Have you carried a number?\"", answer: "Be honest. Show revenue you've influenced and how you'd ramp. CS roles with partial renewal ownership can be a bridge." },
  ],
  translation: [
    { coaching: "Re-signing clients and selling packages", business: "Renewals and upsells" },
    { coaching: "Handling a client pushing back on price", business: "Objection handling" },
  ],
  firstSteps: [
    "Decide whether you want a quota now, or a CS role with renewal exposure first.",
    "Practice a renewal-with-price-increase role-play out loud.",
  ],
};

export const GUIDES: Record<GuidePath, FieldGuide> = {
  customer_success: customerSuccess,
  implementation,
  employer_wellbeing: employerWellbeing,
  account_management: accountManagement,
};

/** Display order: deepest guides first. */
export const GUIDE_ORDER: GuidePath[] = ["customer_success", "implementation", "employer_wellbeing", "account_management"];

export function isGuidePath(value: string): value is GuidePath {
  return (GUIDE_ORDER as string[]).includes(value);
}
