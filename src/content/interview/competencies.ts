import type { GuidePath } from "@/content/learn/types";

/*
 * What interviewers for the target roles probe, with classic questions and
 * what a strong answer shows. Story-bank coverage and practice are organized
 * by these keys; Claude may tag questions with them but never adds new ones.
 * Narrative competencies are answered as a short pitch, not a STAR story.
 */

export type Competency = {
  key: string;
  label: string;
  paths: GuidePath[];
  narrative: boolean;
  /** What a strong answer shows. */
  listenFor: string;
  questions: string[];
};

const CS = "customer_success" as const;
const IMPL = "implementation" as const;
const AM = "account_management" as const;
const EW = "employer_wellbeing" as const;
const ALL: GuidePath[] = [CS, IMPL, AM, EW];

export const COMPETENCIES: Competency[] = [
  {
    key: "tell-me-about-yourself",
    label: "Tell me about yourself",
    paths: ALL,
    narrative: true,
    listenFor: "About 60–90 seconds: where you are now, the two or three experiences that matter for this role, and why this role is the logical next step. Not your life story.",
    questions: ["Tell me about yourself.", "Walk me through your background.", "Why don't you take me through your resume?"],
  },
  {
    key: "why-this-path",
    label: "Why this career, why now",
    paths: ALL,
    narrative: true,
    listenFor: "A clear, positive pull toward the work (not just away from coaching), evidence you understand what the job really is, and the homework you've done.",
    questions: ["Why customer success?", "Why implementation?", "Why do you want to work in employer wellbeing?", "What do you think a CSM does day to day?", "Why our company?"],
  },
  {
    key: "why-leave-coaching",
    label: "Why leave coaching",
    paths: ALL,
    narrative: true,
    listenFor: "Honest and forward-looking, with no complaints. Shows what you're keeping from coaching and what you want more of.",
    questions: ["Why are you leaving coaching?", "Won't you miss working with athletes?", "How do you see your coaching experience applying here?"],
  },
  {
    key: "difficult-customer",
    label: "Handling a difficult or unhappy client",
    paths: ALL,
    narrative: false,
    listenFor: "You listened before solving, stayed calm, owned what was yours, followed through, and the relationship ended better than it started.",
    questions: [
      "Tell me about a time you dealt with an unhappy client.",
      "Describe a time someone pushed back hard on your recommendation.",
      "Tell me about a time you had to deliver bad news to a client.",
    ],
  },
  {
    key: "drove-adoption",
    label: "Driving adoption or behavior change",
    paths: [CS, IMPL, EW],
    narrative: false,
    listenFor: "How you got people to actually change what they do: diagnosis, small wins, reinforcement, measuring it, and adjusting when it didn't stick.",
    questions: [
      "Tell me about a time you got a group to adopt something new.",
      "How have you increased engagement or participation in a program?",
      "Describe a time people weren't following the plan. What did you do?",
    ],
  },
  {
    key: "at-risk-save",
    label: "Saving an at-risk relationship",
    paths: [CS, AM, EW],
    narrative: false,
    listenFor: "You spotted the warning signs early, found the real cause, involved the right people, and either saved it or learned something concrete.",
    questions: [
      "Tell me about a time you kept a client who was about to leave.",
      "How would you handle an account whose usage suddenly dropped?",
      "Tell me about a relationship you lost. What would you do differently?",
    ],
  },
  {
    key: "cross-functional",
    label: "Working across teams",
    paths: [CS, IMPL, EW],
    narrative: false,
    listenFor: "You got things done through people you didn't manage: clear asks, shared goals, closing the loop with the customer.",
    questions: [
      "Tell me about a time you needed help from another team to solve a client's problem.",
      "Describe a time you influenced someone without authority.",
      "How do you handle it when another team isn't delivering what your client needs?",
    ],
  },
  {
    key: "data-decision",
    label: "Using data to make a decision",
    paths: ALL,
    narrative: false,
    listenFor: "Which numbers you tracked, what they told you, the decision you made because of them, and the result.",
    questions: [
      "Tell me about a time you used data to change your approach.",
      "What metrics did you track in your last role, and why?",
      "How would you decide which accounts need your attention this week?",
    ],
  },
  {
    key: "prioritization",
    label: "Prioritizing many clients at once",
    paths: [CS, AM, IMPL],
    narrative: false,
    listenFor: "A system, not heroics: how you triaged, what you scaled (groups, templates), what you said no to, and how you kept everyone informed.",
    questions: [
      "How do you manage your time across many clients?",
      "Tell me about a time you had too much on your plate.",
      "How would you handle 60 accounts with very different needs?",
    ],
  },
  {
    key: "project-delivery",
    label: "Delivering a project on time",
    paths: [IMPL, EW, CS],
    narrative: false,
    listenFor: "Scope, plan, owners, dependencies, risks, and what you did when something slipped.",
    questions: [
      "Walk me through a project you led from start to finish.",
      "Tell me about a time a project was falling behind. What did you do?",
      "How do you plan a launch with a fixed date?",
    ],
  },
  {
    key: "scope-boundaries",
    label: "Holding a boundary (scope)",
    paths: [IMPL, CS],
    narrative: false,
    listenFor: "You protected the plan without damaging the relationship: explained the trade-off and offered a path (later phase, change order, alternative).",
    questions: [
      "Tell me about a time a client asked for something outside what you'd agreed.",
      "Describe a time you had to say no to a client.",
      "How do you handle scope creep?",
    ],
  },
  {
    key: "teaching-onboarding",
    label: "Teaching and onboarding",
    paths: [CS, IMPL, EW],
    narrative: false,
    listenFor: "You adapted to the learner, checked understanding, built materials others could reuse, and people became independent.",
    questions: [
      "Tell me about a time you trained someone on something complex.",
      "How would you onboard a new customer's team?",
      "Describe a resource or program you built that others still use.",
    ],
  },
  {
    key: "presenting-to-leaders",
    label: "Presenting results to leaders",
    paths: [CS, AM, EW],
    narrative: false,
    listenFor: "You framed results in the leader's terms (their goals, not your activity), handled tough questions, and agreed next steps.",
    questions: [
      "Tell me about a time you presented results to a senior stakeholder.",
      "How would you structure a quarterly business review?",
      "How do you show the value of a program to the person paying for it?",
    ],
  },
  {
    key: "commercial",
    label: "Commercial conversations",
    paths: [AM, CS, EW],
    narrative: false,
    listenFor: "Comfort talking about money: renewals, pricing, expansion, anchored on value and the client's goals.",
    questions: [
      "Tell me about a time you renewed or expanded a client relationship.",
      "How would you handle a client pushing back on a price increase?",
      "Have you ever sold or upsold something? Walk me through it.",
    ],
  },
  {
    key: "failure-lesson",
    label: "A failure and what you learned",
    paths: ALL,
    narrative: false,
    listenFor: "A real failure, your share of it owned without excuses, and a specific change you made afterwards.",
    questions: ["Tell me about a time you failed.", "Tell me about a mistake you made with a client.", "What's a piece of feedback that changed how you work?"],
  },
];

export const COMPETENCY_KEYS = COMPETENCIES.map((c) => c.key) as [string, ...string[]];

const byKey = new Map(COMPETENCIES.map((c) => [c.key, c]));

export function competency(key: string): Competency | undefined {
  return byKey.get(key);
}
