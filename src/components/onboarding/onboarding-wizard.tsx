"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { emitInteraction } from "@/lib/interaction-events";
import { EASE_LUXE, SPRING } from "@/lib/motion";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Camera,
  Check,
  Clapperboard,
  Clover,
  Coffee,
  Compass,
  Crown,
  CupSoda,
  Dumbbell,
  Footprints,
  Gamepad2,
  Gem,
  Globe,
  Heart,
  Loader2,
  Music,
  Palette,
  PartyPopper,
  Sparkles,
  TreePine,
  Users,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { HeartBurst } from "@/components/fx/heart-burst";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  GROUP_LABELS,
  byId,
  categoriesForOnboardingStep,
  type TaxonomyCategory,
} from "@/lib/discovery/taxonomy";
import { PROFILE_PROMPTS, type PromptKey } from "@/config/prompts";
import { calculateAge, cn } from "@/lib/utils";

const PROMPT_ANSWER_MAX = 280;
const MAX_PROMPTS = 4;

/** The six prompts surfaced during onboarding - the full catalogue stays in src/config/prompts.ts. */
const ONBOARDING_PROMPT_KEYS: readonly PromptKey[] = [
  "typical-saturday",
  "perfect-first-date",
  "green-flags",
  "relationship-style",
  "favourite-place",
  "starter",
];
const ONBOARDING_PROMPTS = PROFILE_PROMPTS.filter((p) => ONBOARDING_PROMPT_KEYS.includes(p.key));

const PROMPT_PLACEHOLDERS: Partial<Record<PromptKey, string>> = {
  "typical-saturday": "Farmers market, sea swim, big breakfast…",
  "perfect-first-date": "Somewhere we can actually talk…",
  "green-flags": "Kind to waiters, texts back, laughs easily…",
  "relationship-style": "Slow burn? All in? Say it your way…",
  "favourite-place": "A beach, a bookshop, your nan's kitchen…",
  starter: "Ask me about… tell me about…",
};

// --------------------------------------------------- taxonomy plumbing

/** Lucide renderers for taxonomy icon names - never emoji. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Sparkles,
  CupSoda,
  Footprints,
  CalendarDays,
  Heart,
  Gem,
  Zap,
  Users,
  Compass,
  Coffee,
  UtensilsCrossed,
  Music,
  TreePine,
  Dumbbell,
  Gamepad2,
  Clapperboard,
  Palette,
  Clover,
  Crown,
  Globe,
};

const TOKEN_STYLES: Record<TaxonomyCategory["colorToken"], string> = {
  rose: "bg-rose-500/10 text-rose-400 light:text-rose-600",
  amber: "bg-amber-500/10 text-amber-400 light:text-amber-600",
  emerald: "bg-emerald-500/10 text-emerald-400 light:text-emerald-600",
  sky: "bg-sky-500/10 text-sky-400 light:text-sky-600",
  violet: "bg-violet-500/10 text-violet-400 light:text-violet-600",
  gold: "bg-gold/10 text-gold",
};

const INTENTION_CATS = categoriesForOnboardingStep("intentions");
const DATE_STYLE_CATS = categoriesForOnboardingStep("date-style");
const RIGHT_NOW_CATS = DATE_STYLE_CATS.filter((c) => c.group === "right-now");
const LIFESTYLE_CATS = DATE_STYLE_CATS.filter((c) => c.group === "lifestyle");
const IC_CATS = categoriesForOnboardingStep("interests-community");
const INTEREST_CATS = IC_CATS.filter((c) => c.group === "interests");
const COMMUNITY_CATS = IC_CATS.filter((c) => c.group === "community");

const LIFESTYLE_IDS = new Set(LIFESTYLE_CATS.map((c) => c.id));
const INTEREST_GROUP_IDS = new Set(INTEREST_CATS.map((c) => c.id));

type WizardData = {
  displayName: string;
  birthDate: string;
  gender: string;
  interestedIn: string[];
  /** RelationshipGoal enum value, set via a category's goalValue. */
  relationshipGoal: string;
  /** Right-now taxonomy category ids -> Profile.availabilityTags. */
  availabilityTags: string[];
  /** Lifestyle + interests taxonomy category ids -> ProfileInterest slugs. */
  interestCategoryIds: string[];
  /** Community taxonomy category ids -> Profile.communityTags. */
  communityTags: string[];
  country: "IE" | "GB";
  city: string;
  prompts: { key: PromptKey; answer: string }[];
};

const GENDERS = [
  { value: "WOMAN", label: "Woman" },
  { value: "MAN", label: "Man" },
  { value: "NON_BINARY", label: "Non-binary" },
  { value: "OTHER", label: "Other" },
] as const;

const CITIES: Record<"IE" | "GB", string[]> = {
  IE: ["Dublin", "Cork", "Galway", "Limerick", "Waterford", "Kilkenny", "Belfast"],
  GB: [
    "London",
    "Manchester",
    "Birmingham",
    "Edinburgh",
    "Glasgow",
    "Bristol",
    "Leeds",
    "Liverpool",
    "Cardiff",
    "Newcastle",
  ],
};

const STEPS = [
  "Basics",
  "Intentions",
  "Date style",
  "Interests & community",
  "Prompts",
  "Finish",
] as const;

/** Honest value, shown after each completed step - explanation, not pressure. */
const STEP_VALUE: Record<number, string> = {
  0: "Nice to meet you. Real names and real ages build real trust.",
  1: "Clear intentions get more replies - people know where they stand with you.",
  2: "Your date style powers real plans - we introduce you to people who'd say yes.",
  3: "Shared interests give people an easy way to say hello.",
  4: "Your answers become conversation starters in chat.",
};

/** Milestones worth pausing for. */
const MILESTONES: { at: number; message: string }[] = [
  { at: 25, message: "Your profile is taking shape." },
  { at: 50, message: "Halfway - your profile is now visible to more people." },
  { at: 75, message: "Looking great. Complete profiles get noticeably more matches." },
];

function ChipToggle({
  selected,
  onToggle,
  children,
}: {
  selected: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      whileTap={{ scale: 0.92 }}
      animate={selected ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "tap-target inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
        selected
          ? "from-brand-bright to-brand-hover text-primary-foreground border-transparent bg-linear-160 shadow-[0_4px_18px_color-mix(in_srgb,var(--primary)_35%,transparent)]"
          : "glass-chip text-muted-foreground hover:text-foreground",
      )}
    >
      {selected && (
        <motion.span
          initial={{ scale: 0, rotate: -60 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 20 }}
          aria-hidden="true"
        >
          <Check className="size-3.5" />
        </motion.span>
      )}
      {children}
    </motion.button>
  );
}

/**
 * Premium selectable card for a taxonomy category - icon, label, one-line
 * description. Selection state is the house calm pattern: subtle brand
 * tint (bg-accent) + filled check indicator + a subtle transform scale
 * (no layout shift). The border stays neutral - selection is carried by
 * the fill and the check, never by a rose border (rose borders read as
 * validation errors).
 */
function CategoryCard({
  category,
  selected,
  onToggle,
  index,
}: {
  category: TaxonomyCategory;
  selected: boolean;
  onToggle: () => void;
  index: number;
}) {
  const Icon = CATEGORY_ICONS[category.icon] ?? Sparkles;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_LUXE, delay: index * 0.04 }}
    >
      <motion.button
        type="button"
        aria-pressed={selected}
        onClick={onToggle}
        whileTap={{ scale: 0.98 }}
        animate={{ scale: selected ? 1.015 : 1 }}
        transition={SPRING.snappy}
        className={cn(
          "tap-target flex min-h-[68px] w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors",
          selected ? "border-border bg-accent shadow-card" : "bg-card hover:border-foreground/25",
        )}
      >
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            TOKEN_STYLES[category.colorToken],
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block leading-tight font-medium">{category.label}</span>
          <span className="text-muted-foreground mt-0.5 block truncate text-sm">
            {category.description}
          </span>
        </span>
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            selected ? "border-primary bg-primary" : "border-muted-foreground/30",
          )}
          aria-hidden="true"
        >
          {selected && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING.snappy}>
              <Check className="text-primary-foreground size-3" strokeWidth={3} />
            </motion.span>
          )}
        </span>
      </motion.button>
    </motion.div>
  );
}

function CategoryGroup({
  title,
  categories,
  startIndex,
  isSelected,
  onToggle,
}: {
  title?: string;
  categories: TaxonomyCategory[];
  startIndex?: number;
  isSelected: (cat: TaxonomyCategory) => boolean;
  onToggle: (cat: TaxonomyCategory) => void;
}) {
  return (
    <fieldset className="space-y-2.5">
      {title && (
        <legend className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
          {title}
        </legend>
      )}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {categories.map((cat, i) => (
          <CategoryCard
            key={cat.id}
            category={cat}
            selected={isSelected(cat)}
            onToggle={() => onToggle(cat)}
            index={(startIndex ?? 0) + i}
          />
        ))}
      </div>
    </fieldset>
  );
}

export function OnboardingWizard({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [valueNote, setValueNote] = useState<string | null>(null);
  const milestonesShown = useRef(new Set<number>());
  /** The one prompt whose answer editor is currently open. */
  const [activePromptKey, setActivePromptKey] = useState<PromptKey | null>(null);
  const [data, setData] = useState<WizardData>({
    displayName: initialName,
    birthDate: "",
    gender: "",
    interestedIn: [],
    relationshipGoal: "",
    availabilityTags: [],
    interestCategoryIds: [],
    communityTags: [],
    country: "IE",
    city: "",
    prompts: [],
  });

  const set = <K extends keyof WizardData>(key: K, value: WizardData[K]) =>
    setData((d) => ({ ...d, [key]: value }));

  const toggleIn = (
    key: "interestedIn" | "availabilityTags" | "interestCategoryIds" | "communityTags",
    value: string,
  ) =>
    setData((d) => {
      const list = d[key];
      return list.includes(value)
        ? { ...d, [key]: list.filter((v) => v !== value) }
        : { ...d, [key]: [...list, value] };
    });

  /** Selecting a category routes its signal to the right profile field. */
  const toggleCategory = (cat: TaxonomyCategory) => {
    switch (cat.profileFieldMapping) {
      case "relationshipGoal":
        set("relationshipGoal", cat.goalValue ?? "");
        return;
      case "availabilityTags":
        toggleIn("availabilityTags", cat.id);
        return;
      case "communityTags":
        toggleIn("communityTags", cat.id);
        return;
      case "interests":
        toggleIn("interestCategoryIds", cat.id);
        return;
    }
  };

  const categorySelected = (cat: TaxonomyCategory) => {
    switch (cat.profileFieldMapping) {
      case "relationshipGoal":
        return data.relationshipGoal !== "" && data.relationshipGoal === cat.goalValue;
      case "availabilityTags":
        return data.availabilityTags.includes(cat.id);
      case "communityTags":
        return data.communityTags.includes(cat.id);
      case "interests":
        return data.interestCategoryIds.includes(cat.id);
    }
  };

  /**
   * Selection order is preserved - it becomes sortOrder on the profile.
   * Only ONE answer editor is open at a time (activePromptKey); picking
   * another prompt collapses the previous editor while earlier selections
   * stay selected and keep their answers. Tapping a collapsed selected
   * prompt re-opens its editor; tapping the open one deselects it.
   */
  const togglePrompt = (key: PromptKey) => {
    const isSelected = data.prompts.some((p) => p.key === key);
    if (!isSelected) {
      if (data.prompts.length >= MAX_PROMPTS) return;
      setData((d) =>
        d.prompts.some((p) => p.key === key) || d.prompts.length >= MAX_PROMPTS
          ? d
          : { ...d, prompts: [...d.prompts, { key, answer: "" }] },
      );
      setActivePromptKey(key);
      return;
    }
    if (activePromptKey === key) {
      setData((d) => ({ ...d, prompts: d.prompts.filter((p) => p.key !== key) }));
      setActivePromptKey(null);
    } else {
      setActivePromptKey(key);
    }
  };

  const setPromptAnswer = (key: PromptKey, answer: string) =>
    setData((d) => ({
      ...d,
      prompts: d.prompts.map((p) => (p.key === key ? { ...p, answer } : p)),
    }));

  const answeredPrompts = useMemo(
    () => data.prompts.filter((p) => p.answer.trim().length > 0).length,
    [data.prompts],
  );

  const age = useMemo(
    () => (data.birthDate ? calculateAge(data.birthDate) : null),
    [data.birthDate],
  );

  const dateStyleCount =
    data.availabilityTags.length +
    data.interestCategoryIds.filter((id) => LIFESTYLE_IDS.has(id)).length;
  const interestsCommunityCount =
    data.communityTags.length +
    data.interestCategoryIds.filter((id) => INTEREST_GROUP_IDS.has(id)).length;

  /** Live WIZARD glow over in-progress form data - a UX motivation
   *  device, deliberately NOT the canonical completion score. The saved
   *  profile's completionPct is computed exclusively by
   *  computeCompletion (lib/services/profile.ts) at write time; this
   *  number scores required-onboarding inputs the canonical function
   *  collapses into its base-30 and never persists anywhere. */
  const profileScore = useMemo(() => {
    let score = 0;
    if (data.displayName.trim().length >= 2) score += 10;
    if (age !== null && age >= 18) score += 10;
    if (data.gender) score += 8;
    if (data.interestedIn.length) score += 8;
    if (data.relationshipGoal) score += 12;
    score += Math.min(14, dateStyleCount * 4);
    score += Math.min(8, interestsCommunityCount * 3);
    score += Math.min(18, answeredPrompts * 6);
    if (data.city) score += 12;
    return Math.min(100, score);
  }, [data, age, answeredPrompts, dateStyleCount, interestsCommunityCount]);

  // Celebrate genuine milestones once each - explanation, not manipulation
  useEffect(() => {
    for (const { at, message } of MILESTONES) {
      if (profileScore >= at && !milestonesShown.current.has(at)) {
        milestonesShown.current.add(at);
        if (profileScore < 100) {
          toast.success(message, { duration: 2600 });
          emitInteraction("milestone");
        }
      }
    }
  }, [profileScore]);

  const stepValid = useMemo(() => {
    switch (step) {
      case 0:
        return (
          data.displayName.trim().length >= 2 &&
          age !== null &&
          age >= 18 &&
          !!data.gender &&
          data.interestedIn.length > 0
        );
      case 1:
        return !!data.relationshipGoal;
      case 2:
        return dateStyleCount >= 1;
      case 3:
        return interestsCommunityCount >= 1;
      case 4:
        return true; // prompts encouraged, never required
      case 5:
        return !!data.city;
      default:
        return false;
    }
  }, [step, data, age, dateStyleCount, interestsCommunityCount]);

  async function submit() {
    setSubmitting(true);
    // Lifestyle + interest categories persist as their canonical interest slug
    const interests = [
      ...new Set(
        data.interestCategoryIds
          .map((id) => byId.get(id)?.interestSlugs?.[0])
          .filter((slug): slug is string => Boolean(slug)),
      ),
    ];
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: data.displayName.trim(),
        birthDate: data.birthDate,
        gender: data.gender,
        interestedIn: data.interestedIn,
        relationshipGoal: data.relationshipGoal,
        country: data.country,
        city: data.city,
        interests,
        availabilityTags: data.availabilityTags,
        communityTags: data.communityTags,
        prompts: data.prompts
          .map((p) => ({ key: p.key, answer: p.answer.trim() }))
          .filter((p) => p.answer.length > 0),
      }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      toast.error(payload?.error?.message ?? "Couldn't save your profile. Please try again.");
      return;
    }
    // A breath of celebration before the product opens
    emitInteraction("celebration");
    setCelebrating(true);
    window.setTimeout(() => {
      router.push("/discover");
      router.refresh();
    }, 1900);
  }

  const progress = ((step + 1) / STEPS.length) * 100;

  if (celebrating) {
    return (
      <div className="relative flex min-h-[70dvh] flex-col items-center justify-center gap-5 text-center">
        <HeartBurst count={18} />
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={SPRING.bounce}
          className="bg-accent flex size-20 items-center justify-center rounded-full shadow-[0_0_60px_color-mix(in_srgb,var(--primary)_40%,transparent)]"
        >
          <Heart className="fill-primary text-primary size-9" aria-hidden="true" />
        </motion.span>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.7, ease: EASE_LUXE }}
          className="font-display max-w-full px-5 text-4xl font-medium tracking-tight break-words"
        >
          You&apos;re in, {data.displayName.split(" ")[0]}.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6, ease: EASE_LUXE }}
          className="text-muted-foreground max-w-xs"
        >
          Your profile is live. Let&apos;s find someone worth your evening.
        </motion.p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pt-4">
      {/* Progress + live profile glow */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <AnimatePresence mode="wait">
            <motion.p
              key={STEPS[step]}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="font-medium"
            >
              <span className="text-muted-foreground mr-2 tabular-nums">
                {step + 1}/{STEPS.length}
              </span>
              {STEPS[step]}
            </motion.p>
          </AnimatePresence>
          <span
            className="glass-chip flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
            aria-label={`Profile score ${profileScore} percent`}
          >
            <Heart
              className={cn(
                "size-3.5 transition-colors",
                profileScore >= 70 ? "fill-rose-500 text-rose-500" : "text-muted-foreground",
              )}
              aria-hidden="true"
            />
            <span className="tabular-nums">{profileScore}%</span>
          </span>
        </div>
        <Progress
          value={progress}
          aria-label={`Onboarding progress: step ${step + 1} of ${STEPS.length}`}
        />
        <AnimatePresence>
          {valueNote && (
            <motion.p
              key={valueNote}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: EASE_LUXE }}
              className="text-gold text-xs"
              aria-live="polite"
            >
              {valueNote}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 36, scale: 0.985, filter: "blur(6px)" }}
          animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: -36, scale: 0.985, filter: "blur(6px)" }}
          transition={{ duration: 0.38, ease: EASE_LUXE }}
          className="min-h-[50dvh]"
        >
          {/* ------------------------------------------------ 1. Basics */}
          {step === 0 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  Let&apos;s start with the basics
                </h1>
                <p className="text-muted-foreground">This is how you&apos;ll appear on Tirvea.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayName">First name</Label>
                <Input
                  id="displayName"
                  value={data.displayName}
                  onChange={(e) => set("displayName", e.target.value)}
                  maxLength={30}
                  placeholder="Your first name"
                  autoComplete="given-name"
                  enterKeyHint="next"
                  className="h-12 rounded-2xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="birthDate">Date of birth</Label>
                <Input
                  id="birthDate"
                  type="date"
                  value={data.birthDate}
                  onChange={(e) => set("birthDate", e.target.value)}
                  autoComplete="bday"
                  className="h-12 rounded-2xl"
                  aria-invalid={age !== null && age < 18 ? true : undefined}
                  aria-describedby="age-hint"
                />
                <p
                  id="age-hint"
                  className={cn(
                    "text-xs",
                    age !== null && age < 18 ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {age !== null && age < 18
                    ? "You must be 18 or older to use Tirvea."
                    : "Your age is shown on your profile - never your birthday."}
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">I am a…</legend>
                <div className="flex flex-wrap gap-2">
                  {GENDERS.map((g) => (
                    <ChipToggle
                      key={g.value}
                      selected={data.gender === g.value}
                      onToggle={() => set("gender", g.value)}
                    >
                      {g.label}
                    </ChipToggle>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Show me…</legend>
                <div className="flex flex-wrap gap-2">
                  {GENDERS.map((g) => (
                    <ChipToggle
                      key={g.value}
                      selected={data.interestedIn.includes(g.value)}
                      onToggle={() => toggleIn("interestedIn", g.value)}
                    >
                      {g.label === "Woman" ? "Women" : g.label === "Man" ? "Men" : g.label}
                    </ChipToggle>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {/* -------------------------------------------- 2. Intentions */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  What are you here for?
                </h1>
                <p className="text-muted-foreground">
                  One honest answer - it leads to better matches.
                </p>
              </div>
              {/* The cards are aria-pressed toggle buttons, so no
                  radiogroup role here - it would announce contradictory
                  semantics. Group + label carry the context instead. */}
              <div className="grid gap-2.5" role="group" aria-label="I'm looking for">
                {INTENTION_CATS.map((cat, i) => (
                  <CategoryCard
                    key={cat.id}
                    category={cat}
                    selected={categorySelected(cat)}
                    onToggle={() => toggleCategory(cat)}
                    index={i}
                  />
                ))}
              </div>
            </div>
          )}

          {/* -------------------------------------------- 3. Date style */}
          {step === 2 && (
            <div className="space-y-7">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  How do you like to meet?
                </h1>
                <p className="text-muted-foreground">
                  Pick everything that sounds like you - it shapes who we introduce you to.
                </p>
              </div>
              <CategoryGroup
                title={GROUP_LABELS["right-now"]}
                categories={RIGHT_NOW_CATS}
                isSelected={categorySelected}
                onToggle={toggleCategory}
              />
              <CategoryGroup
                title={GROUP_LABELS.lifestyle}
                categories={LIFESTYLE_CATS}
                startIndex={RIGHT_NOW_CATS.length}
                isSelected={categorySelected}
                onToggle={toggleCategory}
              />
            </div>
          )}

          {/* ------------------------------- 4. Interests & community */}
          {step === 3 && (
            <div className="space-y-7">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  What are you into?
                </h1>
                <p className="text-muted-foreground">
                  Shared ground gives people an easy way to say hello.
                </p>
              </div>
              <CategoryGroup
                title={GROUP_LABELS.interests}
                categories={INTEREST_CATS}
                isSelected={categorySelected}
                onToggle={toggleCategory}
              />
              <CategoryGroup
                title={GROUP_LABELS.community}
                categories={COMMUNITY_CATS}
                startIndex={INTEREST_CATS.length}
                isSelected={categorySelected}
                onToggle={toggleCategory}
              />
            </div>
          )}

          {/* ------------------------------------------------ 5. Prompts */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  A few words in your voice
                </h1>
                <p className="text-muted-foreground">
                  Your answers become conversation starters. Three is the sweet spot - but you can
                  always add them later.
                </p>
              </div>
              <p className="text-muted-foreground text-sm" aria-live="polite">
                {answeredPrompts === 0
                  ? `Pick up to ${MAX_PROMPTS} prompts that sound like you.`
                  : `${answeredPrompts} answered${answeredPrompts < 3 ? " - a couple more and your profile really talks" : ". Lovely."}`}
              </p>
              <div className="grid gap-2">
                {ONBOARDING_PROMPTS.map((prompt) => {
                  const entry = data.prompts.find((p) => p.key === prompt.key);
                  const selected = Boolean(entry);
                  const expanded = selected && activePromptKey === prompt.key;
                  const atLimit = !selected && data.prompts.length >= MAX_PROMPTS;
                  return (
                    <div
                      key={prompt.key}
                      className={cn(
                        "rounded-2xl border transition-all",
                        // Calm selected state - accent tint + check on a
                        // neutral border. Selection is the fill, never a
                        // rose border.
                        selected ? "border-border bg-accent shadow-card" : "bg-card",
                        !selected && !atLimit && "hover:border-foreground/25",
                        atLimit && "opacity-45",
                      )}
                    >
                      <button
                        type="button"
                        aria-expanded={expanded}
                        disabled={atLimit}
                        onClick={() => togglePrompt(prompt.key)}
                        className="tap-target flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                      >
                        <span className="font-medium">{prompt.label}</span>
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                            selected ? "border-primary bg-primary" : "border-muted-foreground/30",
                          )}
                          aria-hidden="true"
                        >
                          {selected && (
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={SPRING.snappy}
                            >
                              <Check className="text-primary-foreground size-3" strokeWidth={3} />
                            </motion.span>
                          )}
                        </span>
                      </button>
                      <AnimatePresence initial={false}>
                        {expanded && entry && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.32, ease: EASE_LUXE }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-1 px-5 pb-4">
                              <Textarea
                                autoFocus
                                value={entry.answer}
                                onChange={(e) => setPromptAnswer(prompt.key, e.target.value)}
                                maxLength={PROMPT_ANSWER_MAX}
                                rows={3}
                                placeholder={PROMPT_PLACEHOLDERS[prompt.key] ?? ""}
                                className="rounded-2xl"
                                aria-label={prompt.label}
                              />
                              <p className="text-muted-foreground text-right text-xs tabular-nums">
                                {entry.answer.length}/{PROMPT_ANSWER_MAX}
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ------------------------------------------------- 6. Finish */}
          {step === 5 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  Last thing - where are you based?
                </h1>
                <p className="text-muted-foreground">
                  We only ever show your city - never your exact location.
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Country</legend>
                <div className="flex gap-2">
                  <ChipToggle
                    selected={data.country === "IE"}
                    onToggle={() => {
                      set("country", "IE");
                      set("city", "");
                    }}
                  >
                    Ireland
                  </ChipToggle>
                  <ChipToggle
                    selected={data.country === "GB"}
                    onToggle={() => {
                      set("country", "GB");
                      set("city", "");
                    }}
                  >
                    United Kingdom
                  </ChipToggle>
                </div>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">City</legend>
                <div className="flex flex-wrap gap-2">
                  {CITIES[data.country].map((city) => (
                    <ChipToggle
                      key={city}
                      selected={data.city === city}
                      onToggle={() => set("city", city)}
                    >
                      {city}
                    </ChipToggle>
                  ))}
                </div>
                <Input
                  value={CITIES[data.country].includes(data.city) ? "" : data.city}
                  onChange={(e) => set("city", e.target.value)}
                  placeholder="Or type your town…"
                  maxLength={80}
                  autoComplete="address-level2"
                  enterKeyHint="done"
                  className="h-12 rounded-2xl"
                  aria-label="Other town or city"
                />
              </fieldset>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE_LUXE, delay: 0.08 }}
                className="bg-card space-y-3 rounded-2xl border p-5"
              >
                <p className="font-medium">After this, two quick wins</p>
                <div className="flex items-start gap-3">
                  <span className="light:text-rose-600 flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400">
                    <Camera className="size-5" aria-hidden="true" />
                  </span>
                  <p className="text-muted-foreground text-sm">
                    Add your photos from your profile - profiles with photos get seen first.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="light:text-sky-600 flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400">
                    <BadgeCheck className="size-5" aria-hidden="true" />
                  </span>
                  <p className="text-muted-foreground text-sm">
                    Get verified - a verified badge builds instant trust.
                  </p>
                </div>
              </motion.div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="glass safe-bottom fixed inset-x-0 bottom-0 border-t">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-3">
          {/* h-12: step navigation is a primary flow control - it must
              clear the 44px touch target (size="lg" alone is 40px). */}
          <Button
            variant="ghost"
            size="lg"
            className="h-12 rounded-full"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || submitting}
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              size="lg"
              className="h-12 rounded-full px-8"
              onClick={() => {
                setValueNote(STEP_VALUE[step] ?? null);
                emitInteraction("step-complete");
                setStep((s) => s + 1);
              }}
              disabled={!stepValid}
            >
              Continue <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              size="lg"
              className="h-12 rounded-full px-8"
              onClick={submit}
              disabled={!stepValid || submitting}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <PartyPopper className="size-4" aria-hidden="true" />
              )}
              Finish
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
