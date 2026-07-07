/** Curated profile prompts - the product's human voice. */
export const PROFILE_PROMPTS = [
  { key: "typical-saturday", label: "A typical Saturday" },
  { key: "perfect-first-date", label: "My perfect first date" },
  { key: "green-flags", label: "Green flags I look for" },
  { key: "relationship-style", label: "My relationship style" },
  { key: "favourite-place", label: "My favourite place" },
  { key: "small-happy", label: "A small thing that makes me happy" },
  { key: "looking-for", label: "I'm looking for" },
  { key: "starter", label: "Best way to start a conversation with me" },
] as const;
export type PromptKey = (typeof PROFILE_PROMPTS)[number]["key"];
export const promptLabel = (key: string) =>
  PROFILE_PROMPTS.find((p) => p.key === key)?.label ?? key;
