import {
  byId,
  pickTemplate,
  type TaxonomyCategory,
} from "@/lib/discovery/taxonomy";

/**
 * Conversation assistant - rule-based today, LLM-swappable tomorrow.
 *
 * Every suggestion is derived ONLY from real context data (taxonomy
 * categories both people actually belong to, prompt answers the other
 * person actually wrote, real message timestamps). Nothing is invented,
 * and the interface is deliberately narrow so a future LLM-backed
 * implementation can slot in behind `assistant` without touching the UI.
 */

export type AssistantContext = {
  /** Taxonomy category ids BOTH people belong to (see categoriesForProfile). */
  sharedCategoryIds: string[];
  /** Interest labels both people selected - generic fallback only. */
  sharedInterests: string[];
  theirName: string;
  /** The other person's real profile prompt answers. */
  theirPrompts: { key: string; label: string; answer: string }[];
  lastMessageAt: Date | null;
  lastMessageFromMe: boolean | null;
  messageCount: number;
  theyAreOnline: boolean;
};

export type Suggestion = {
  kind: "opener" | "follow-up" | "next-step";
  /** What the chip says to the user. */
  text: string;
  /** Ready-to-send message inserted into the composer on tap. */
  send?: string;
};

export interface ConversationAssistant {
  suggest(ctx: AssistantContext): Suggestion[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_SUGGESTIONS = 3;
const PRIORITY: Record<Suggestion["kind"], number> = {
  "next-step": 0,
  "follow-up": 1,
  opener: 2,
};

/** Trim an answer to a short, single-line excerpt. */
function excerptOf(answer: string, max = 56): string {
  const clean = answer.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}...`;
}

/**
 * Rephrase a first-person prompt label ("My perfect first date") as a
 * third-person topic ("their perfect first date") for suggestion copy.
 */
function topicOf(label: string): string {
  const s = label
    .replace(/^My\b/, "their")
    .replace(/^I'm\b/, "what they're")
    .replace(/\bI\b/g, "they")
    .replace(/\bme\b/g, "them")
    .replace(/\bmy\b/g, "their");
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Rewrite a coach-voice taxonomy template ("Ask about their favourite
 * cafe.") in the second person ("my profile" fix runs first so "your
 * profile" in a template means the sender's own profile).
 */
function toSecondPerson(s: string): string {
  return s
    .replace(/\byour\b/g, "my")
    .replace(/\btheir\b/g, "your")
    .replace(/\bthey're\b/g, "you're")
    .replace(/\bthey've\b/g, "you've")
    .replace(/\bthey'd\b/g, "you'd")
    .replace(/\bthey\b/g, "you")
    .replace(/\bthem\b/g, "you");
}

/**
 * Turn a taxonomy chatPromptTemplate (coach voice, e.g. "Ask about
 * their favourite cafe.") into a ready-to-send message ("What's your
 * favourite cafe?"). Deterministic string rules - no invention.
 */
export function messageFromTemplate(template: string): string {
  const t = template.trim().replace(/\.$/, "");
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^Ask (?:about|for) (.+)$/)))
    return `What's ${toSecondPerson(m[1])}?`;
  if ((m = t.match(/^Ask if they (.+)$/)))
    return `Do you ${toSecondPerson(m[1])}?`;
  if ((m = t.match(/^Ask (what|where|which|when|how|who) (.+)$/)))
    return `Tell me ${m[1]} ${toSecondPerson(m[2])}.`;
  if ((m = t.match(/^Suggest (.+)$/)))
    return `How about ${toSecondPerson(m[1])}?`;
  return `${toSecondPerson(t)}.`;
}

/**
 * Cold-open openers from the taxonomy: one per SHARED category,
 * strongest first, template picked deterministically per pair.
 */
function taxonomyOpeners(sharedCategoryIds: string[], name: string): Suggestion[] {
  return sharedCategoryIds
    .map((id) => byId.get(id))
    .filter((c): c is TaxonomyCategory => c != null)
    .sort((a, b) => b.scoringWeight - a.scoringWeight)
    .map((cat): Suggestion | null => {
      const template = pickTemplate(cat.chatPromptTemplates, `${name}:${cat.id}`);
      if (!template) return null;
      return {
        kind: "opener",
        text: template.replace(/^Ask /, `Ask ${name} `).replace(/\.$/, ""),
        send: messageFromTemplate(template),
      };
    })
    .filter((s): s is Suggestion => s != null);
}

/** ONE honest generic fallback when no taxonomy category is shared. */
function genericOpener(shared: string[], name: string): Suggestion[] {
  const interest = shared[0];
  if (!interest) return [];
  const lower = interest.toLowerCase();
  return [
    {
      kind: "opener" as const,
      text: `You both like ${lower} - ask ${name} about it`,
      send: `I noticed we both like ${lower} - what got you into it?`,
    },
  ];
}

function promptOpeners(
  prompts: AssistantContext["theirPrompts"],
  name: string,
): Suggestion[] {
  return prompts
    .filter((p) => p.answer.trim().length > 0)
    .map((p) => {
      const topic = topicOf(p.label);
      const ex = excerptOf(p.answer);
      return {
        kind: "opener" as const,
        text: `Ask ${name} about ${topic} - they said: "${ex}"`,
        send: `You wrote "${ex}" - I need to hear more about that.`,
      };
    });
}

/** Alternate two lists a, b: a0, b0, a1, b1... */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

export const ruleBasedAssistant: ConversationAssistant = {
  suggest(ctx: AssistantContext): Suggestion[] {
    const name = ctx.theirName.split(" ")[0] || ctx.theirName;
    const ageMs = ctx.lastMessageAt ? Date.now() - ctx.lastMessageAt.getTime() : null;
    const suggestions: Suggestion[] = [];

    // Rule 1 - fresh match, nothing said yet: openers built from the
    // taxonomy categories both people actually share and the other
    // person's real prompt answers, interleaved.
    if (ctx.messageCount === 0) {
      const fromTaxonomy = taxonomyOpeners(ctx.sharedCategoryIds, name);
      const cold =
        fromTaxonomy.length > 0 ? fromTaxonomy : genericOpener(ctx.sharedInterests, name);
      suggestions.push(...interleave(cold, promptOpeners(ctx.theirPrompts, name)));
    }

    // Rule 2 - going well: a real back-and-forth that's still warm.
    if (ctx.messageCount >= 12 && ageMs !== null && ageMs < DAY_MS) {
      suggestions.push({
        kind: "next-step",
        text: "This is flowing - suggest coffee this week?",
        send: "Fancy grabbing a coffee this week?",
      });
    }

    // Rule 3 - their message has sat unanswered for over a day: the
    // move is yours, so we point at the composer rather than a canned line.
    if (ctx.lastMessageFromMe === false && ageMs !== null && ageMs > DAY_MS) {
      suggestions.push({
        kind: "follow-up",
        text: `${name} is waiting on your reply`,
      });
    }

    // Rule 4 - stale from my side: I spoke last, two-plus days of silence.
    if (ctx.lastMessageFromMe === true && ageMs !== null && ageMs > 2 * DAY_MS) {
      suggestions.push({
        kind: "follow-up",
        text: "You haven't heard back in a couple of days - a light follow-up sometimes lands",
        send: "How was your weekend?",
      });
    }

    // Rule 5 - they're online right now and spoke last: a good moment.
    if (ctx.theyAreOnline && ctx.messageCount > 0 && ctx.lastMessageFromMe === false) {
      suggestions.push({
        kind: "opener",
        text: `${name} is online now - a good moment to reply`,
      });
    }

    return suggestions
      .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])
      .slice(0, MAX_SUGGESTIONS);
  },
};

/** Swap this export for an LLM-backed implementation later - same interface. */
export const assistant: ConversationAssistant = ruleBasedAssistant;
