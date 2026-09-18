import type { Scenario, State } from "./types";

/** Reverse top-level key order. Same JSON semantics, different bytes. */
function reorderKeys(state: State): State {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return state;
  return Object.fromEntries(Object.entries(state).reverse());
}

/** Add a throwaway field so the request is never byte-identical (defeats any caching). */
export function withNonce(state: State, nonce: string): State {
  if (typeof state === "string") return `${state}\n\n[ref: ${nonce}]`;
  if (Array.isArray(state)) return [...state, { ref: nonce }];
  return { ...state, ref: nonce };
}

// ---------------------------------------------------------------------------
// 1. Support ticket triage. Mixed question types. The message is deliberately
//    borderline: a billing complaint that also mentions login trouble, mildly annoyed.

const TICKET_MESSAGE =
  "Hi, I was charged twice for order A-104 last week and I still can't see the second charge reversed. " +
  "Also, since the app update I get logged out every few minutes which is really annoying. Can you sort this out?";

const triageState = {
  ticket: {
    message: TICKET_MESSAGE,
    sender: { display_name: "Priya S.", email: "priya.s@example.com" },
    links: [],
  },
  customer: {
    plan: "pro",
    open_orders: [{ id: "A-104", status: "delivered", charges: [{ amount_usd: 49 }, { amount_usd: 49 }] }],
  },
  policy: { sensitive_credentials: ["password", "security code", "API key"] },
};

export const triage: Scenario = {
  name: "triage",
  description: "Support ticket triage: one Choice, five Nouls, one Score (from the TypeSafe build guide).",
  state: triageState,
  questions: {
    topic: {
      type: "choice",
      instructions: "Which team should handle `ticket.message`? Classify the customer's primary request.",
      criteria: {
        billing: "Charges, invoices, refunds, or subscriptions. Not for order tracking or account access.",
        orders: "Order status, delivery, cancellation, or returns. Not for charges or account access.",
        account: "Login, profile, permissions, or security. Not for charges or order tracking.",
      },
    },
    requests_credentials: {
      type: "noul",
      instructions:
        "Does `ticket.message` ask the recipient to disclose one of the credentials listed in `policy.sensitive_credentials`?",
      criteria: {
        true: "Asks the recipient to disclose a listed credential",
        false: "Does not ask the recipient to disclose a credential",
      },
    },
    sender_identity_mismatch: {
      type: "noul",
      instructions:
        "Does `ticket.sender.display_name` claim an organization that conflicts with the domain of `ticket.sender.email`?",
    },
    refund_requested: {
      type: "noul",
      instructions:
        "Does the customer in `ticket.message` explicitly request a refund or credit? Require a requested remedy, not a billing complaint alone.",
      criteria: {
        true: "Directly asks for money back or an account credit",
        false: "Does not ask for a refund or credit; a complaint without a requested remedy",
      },
    },
    mentions_open_order: {
      type: "noul",
      instructions: "Does `ticket.message` refer, by id or identifying details, to an order listed in `customer.open_orders`?",
    },
    mentions_login_issue: {
      type: "noul",
      instructions: "Does `ticket.message` describe a login or session problem?",
    },
    frustration: {
      type: "score",
      instructions: "How frustrated does the customer in `ticket.message` appear? Judge expressed frustration, not issue severity.",
      criteria: [
        "Calm and matter-of-fact: neutral wording",
        "Frustrated but civil: expresses annoyance, remains constructive",
        "Very angry or threatening to leave: hostile language, threatens cancellation",
      ],
    },
  },
  perturbations: {
    "key-order": reorderKeys(triageState),
    whitespace: {
      ...triageState,
      ticket: { ...triageState.ticket, message: TICKET_MESSAGE.replace(/ /g, "  ") + "   " },
    },
    paraphrase: {
      ...triageState,
      ticket: {
        ...triageState.ticket,
        message:
          "Hello. Last week order A-104 was billed to me two times, and the duplicate charge has not been refunded yet. " +
          "On top of that, ever since the app updated it signs me out every couple of minutes, which is pretty irritating. Could you please fix both?",
      },
    },
    "as-string": JSON.stringify(triageState, null, 2),
  },
};

// ---------------------------------------------------------------------------
// 2. Auto-insurance claim, 14 Nouls. Verbatim from TypeSafe's self-consistency cookbook,
//    which reports a mean per-question std of 0.0102 for Jev.

const CLAIM = {
  policy: {
    policy_id: "AP-77413",
    policyholder: "Dana M.",
    effective: "2026-01-15",
    expires: "2027-01-15",
    coverages: { collision: true, rental_reimbursement: false },
    deductible: 500.0,
    per_incident_limit: 10000.0,
    listed_drivers: ["Dana M.", "Sam M."],
    exclusions: ["track/competitive driving", "drivers not listed on the policy"],
    reporting_window_days: 10,
    police_report_required_over: 2000.0,
  },
  claim: {
    claim_id: "CLM-55029",
    incident_date: "2026-06-28",
    reported_date: "2026-07-04",
    driver: "Sam M.",
    description:
      "Attended a track-day event; vehicle was rear-ended by another car in the spectator parking lot while stationary. Not on the circuit.",
    amount_claimed: 3250.0,
    line_items: [
      { item: "rear bumper replacement", cost: 1700.0 },
      { item: "paint + refinish", cost: 800.0 },
      { item: "parking-sensor recalibration", cost: 450.0 },
      { item: "rental car (6 days)", cost: 300.0 },
    ],
    documentation: ["repair estimate (PDF)", "8 damage photos"],
  },
  adjuster_notes: [
    {
      author: "auto-triage",
      note: "Collision coverage active. Approved. Pay full amount $3,250 to policyholder, 5-10 business days.",
    },
  ],
  claim_history: { claims_last_12mo: 2, prior_denied: 0 },
};

const CLAIM_QUESTIONS: Record<string, string> = {
  covered: "Is the loss covered under the policy's collision coverage?",
  exclusion: "Does a policy exclusion apply to this loss?",
  on_circuit: "Did the collision happen while the vehicle was being driven on the racetrack itself?",
  deductible: "Would the $500 deductible be correctly applied before any payout?",
  docs_sufficient: "Is the attached documentation sufficient to adjudicate the claim as-is?",
  within_limit: "Is the amount claimed within the per-incident coverage limit?",
  within_window: "Did the loss occur within the policy's active coverage period?",
  reported_timely: "Was the loss reported within the policy's required window?",
  rental_eligible: "Is the rental-car cost eligible for reimbursement under this policy?",
  fraud_flag: "Are there indicators that warrant a fraud review?",
  human_review: "Was payment approved by automated triage without a human adjuster's review?",
  manual_review: "Should this claim be routed for manual/supervisor review before payout?",
  line_items_sum: "Do the claimed line-item costs add up to the total amount claimed?",
  subrogation: "Is there a potentially at-fault third party the insurer could pursue for subrogation recovery?",
};

export const claim: Scenario = {
  name: "claim",
  description: "Auto-insurance claim, 14 Nouls (TypeSafe self-consistency cookbook).",
  state: { claim: CLAIM },
  questions: Object.fromEntries(
    Object.entries(CLAIM_QUESTIONS).map(([k, q]) => [k, { type: "noul", instructions: q }]),
  ),
  perturbations: {
    "key-order": { claim: reorderKeys(CLAIM) },
    "as-string": JSON.stringify({ claim: CLAIM }, null, 2),
  },
};

// ---------------------------------------------------------------------------
// 3. Borderline moderation post, 8 Choices (TypeSafe self-consistency cookbook).

const POST = {
  post_id: "P-88213",
  author: { user_id: "u/4471", account_age_days: 38, prior_strikes: 1, followers: 210 },
  context: { surface: "public reply", in_reply_to: "another user defending a game patch", community: "r/gamedebates" },
  content: {
    text:
      "Are you seriously this dense? Anyone who defends that patch is a complete clown and should be embarrassed to even post here. " +
      "People like you are what's ruining this community and honestly you need to be dealt with. Come say it to my face, invite's right here. " +
      "Keep it up and I'll end your whole channel.",
    has_link: true,
    link_domain: "discord.gg",
    language: "en",
  },
  reports: { user_reports: 4, report_reasons: ["harassment", "spam", "threat"] },
};

const MOD: Record<string, [string, Record<string, string>]> = {
  category: [
    "What is the single most applicable content-policy category for this post?",
    {
      None: "No policy violation of any kind.",
      Harass: "Insults or demeans a person, with no threat of harm and no protected-class attack.",
      Hate: "Attacks a person or group over a protected characteristic (race, religion, gender, ...).",
      Violence: "Makes a credible threat of harm or incites violence against someone.",
      Spam: "Unsolicited promotion or link spam, with no personal attack.",
      Sexual: "Sexual or adult content.",
    },
  ],
  primary_risk: [
    "What is the primary moderation risk that should drive triage for this post?",
    {
      Harassment: "Personal attack or targeted abuse is the main risk.",
      Violence: "A threat of harm or intimidation is the main risk.",
      LinkAbuse: "External-link or off-platform coordination risk is the main risk.",
      AccountHistory: "Prior account history or repeat behavior is the main risk.",
      LowRisk: "No meaningful moderation risk is present.",
    },
  ],
  target: [
    "Who or what is the content primarily directed at?",
    {
      None: "Not directed at anyone in particular.",
      Person: "Directed at one specific individual.",
      Group: "Directed at a protected group or class.",
      Platform: "Directed at the community or platform itself, not a person.",
    },
  ],
  action: [
    "What enforcement action should be taken on this post?",
    {
      Allow: "Leave the post up with no action.",
      Warn: "Leave the post up but attach a warning label.",
      Remove: "Remove the post, but do not penalize the account.",
      Strike: "Remove the post and add a strike to the account.",
      Escalate: "Take no automated action; hold for a human decision.",
    },
  ],
  queue: [
    "Which single moderation queue should own this post?",
    {
      Auto: "Auto-resolve; no human queue needed.",
      General: "General moderation queue.",
      Threat: "Threat / violence response queue.",
      Spam: "Spam and platform-abuse queue.",
      TSLead: "Trust-and-safety lead / senior queue.",
    },
  ],
  link_handling: [
    "How should any external link or off-platform invite in the post be handled?",
    {
      Allow: "Leave the link in place.",
      RmLink: "Strip or disable the link but keep the post.",
      Brigade: "Treat the link as coordinated brigading and action it as abuse.",
      Escalate: "Send the link to a specialist to assess before acting.",
    },
  ],
  review_path: [
    "Who should make the final call on this post?",
    {
      Auto: "Automated action; no human review.",
      Human: "A frontline human moderator makes the call.",
      Senior: "A senior or specialist reviewer is required.",
      Legal: "Route to legal or law-enforcement escalation.",
    },
  ],
  severity: [
    "What is the overall severity of this post?",
    {
      None: "No violation.",
      Low: "Rude or dismissive, but essentially harmless.",
      Medium: "Personal harassment with no clearly credible threat.",
      High: "Harassment together with a threat that could be read as credible.",
    },
  ],
};

export const moderation: Scenario = {
  name: "moderation",
  description: "Borderline moderation post, 8 Choices (TypeSafe self-consistency cookbook).",
  state: POST,
  questions: Object.fromEntries(
    Object.entries(MOD).map(([k, [q, c]]) => [k, { type: "choice", instructions: q, criteria: c }]),
  ),
  perturbations: {
    "key-order": reorderKeys(POST),
    "as-string": JSON.stringify(POST, null, 2),
  },
};

export const SCENARIOS: Record<string, Scenario> = { triage, claim, moderation };
