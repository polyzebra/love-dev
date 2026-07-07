/**
 * Conversation assistant - rule-based today, LLM-swappable tomorrow.
 *
 * Every suggestion is derived ONLY from real context data (shared
 * interests both people actually picked, prompt answers the other
 * person actually wrote, real message timestamps). Nothing is invented,
 * and the interface is deliberately narrow so a future LLM-backed
 * implementation can slot in behind `assistant` without touching the UI.
 */

export type AssistantContext = {
  /** Interest labels both people selected. */
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

/** Interest-specific openers - matched against real shared interests. */
const INTEREST_OPENERS: {
  match: RegExp;
  text: (name: string) => string;
  send: string;
}[] = [
  {
    match: /coffee/i,
    text: (n) => `You both like coffee - ask ${n} for their go-to cafe`,
    send: "Important question first: what's your go-to cafe?",
  },
  {
    match: /hik/i,
    text: (n) => `You both love hiking - ask ${n} about a favourite trail`,
    send: "I saw you're into hiking too - what's the best trail you've done?",
  },
  {
    match: /travel/i,
    text: (n) => `You both love travelling - ask ${n} their dream destination`,
    send: "Fellow traveller - where's next on your list?",
  },
  {
    match: /dog/i,
    text: (n) => `You're both dog people - ask ${n} about that`,
    send: "Dog person too, I see - do you have one?",
  },
  {
    match: /run/i,
    text: (n) => `You both run - ask ${n} about their route`,
    send: "A fellow runner - where do you usually run?",
  },
  {
    match: /swim/i,
    text: (n) => `You both swim - ask ${n} where they brave the water`,
    send: "Where do you swim - pool, or braving the open water?",
  },
  {
    match: /read|book/i,
    text: (n) => `You both read - ask ${n} what they'd recommend`,
    send: "Book person too - what should I read next?",
  },
  {
    match: /music/i,
    text: (n) => `You both love live music - ask ${n} about the best gig they've seen`,
    send: "Best gig you've ever been to - go.",
  },
  {
    match: /cook|bak/i,
    text: (n) => `You both cook - ask ${n} their signature dish`,
    send: "What's your signature dish? Asking for research purposes.",
  },
  {
    match: /film|cinema|movie/i,
    text: (n) => `You both love films - ask ${n} for a favourite`,
    send: "Film person too - what's one you could rewatch forever?",
  },
];

function interestOpeners(shared: string[], name: string): Suggestion[] {
  return shared.map((interest) => {
    const hit = INTEREST_OPENERS.find((t) => t.match.test(interest));
    if (hit) return { kind: "opener" as const, text: hit.text(name), send: hit.send };
    const lower = interest.toLowerCase();
    return {
      kind: "opener" as const,
      text: `You both like ${lower} - ask ${name} about it`,
      send: `I noticed we both like ${lower} - what got you into it?`,
    };
  });
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

    // Rule 1 - fresh match, nothing said yet: openers built from real
    // shared interests and their real prompt answers, interleaved.
    if (ctx.messageCount === 0) {
      suggestions.push(
        ...interleave(
          interestOpeners(ctx.sharedInterests, name),
          promptOpeners(ctx.theirPrompts, name),
        ),
      );
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
