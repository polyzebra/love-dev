"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTEREST_CATALOGUE, LANGUAGES, BIO_MAX_LENGTH } from "@/lib/constants";
import { calculateAge, cn } from "@/lib/utils";

type WizardData = {
  displayName: string;
  birthDate: string;
  gender: string;
  interestedIn: string[];
  relationshipGoal: string;
  country: "IE" | "GB";
  city: string;
  bio: string;
  heightCm: string;
  occupation: string;
  education: string;
  languages: string[];
  smoking: string;
  drinking: string;
  exercise: string;
  children: string;
  pets: string;
  interests: string[];
};

const GENDERS = [
  { value: "WOMAN", label: "Woman" },
  { value: "MAN", label: "Man" },
  { value: "NON_BINARY", label: "Non-binary" },
  { value: "OTHER", label: "Other" },
] as const;

const GOALS = [
  { value: "LONG_TERM", label: "Long-term relationship", hint: "Something that lasts" },
  { value: "SHORT_TERM", label: "Something casual", hint: "Fun, no pressure" },
  { value: "OPEN_TO_EITHER", label: "Open to either", hint: "See where it goes" },
  { value: "FRIENDSHIP", label: "New friends", hint: "Platonic connections" },
  { value: "FIGURING_OUT", label: "Still figuring it out", hint: "And that's okay" },
] as const;

const LIFESTYLE = [
  { value: "NEVER", label: "Never" },
  { value: "RARELY", label: "Rarely" },
  { value: "SOCIALLY", label: "Socially" },
  { value: "OFTEN", label: "Often" },
  { value: "PREFER_NOT_TO_SAY", label: "Prefer not to say" },
] as const;

const CITIES: Record<"IE" | "GB", string[]> = {
  IE: ["Dublin", "Cork", "Galway", "Limerick", "Waterford", "Kilkenny", "Belfast"],
  GB: ["London", "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Bristol", "Leeds", "Liverpool", "Cardiff", "Newcastle"],
};

const STEPS = ["Basics", "Intentions", "Location", "About you", "Lifestyle", "Interests"] as const;

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
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        "tap-target rounded-full border px-4 py-2 text-sm font-medium transition-all",
        selected
          ? "border-primary bg-primary text-primary-foreground shadow-card"
          : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function OnboardingWizard({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<WizardData>({
    displayName: initialName,
    birthDate: "",
    gender: "",
    interestedIn: [],
    relationshipGoal: "",
    country: "IE",
    city: "",
    bio: "",
    heightCm: "",
    occupation: "",
    education: "",
    languages: ["English"],
    smoking: "PREFER_NOT_TO_SAY",
    drinking: "PREFER_NOT_TO_SAY",
    exercise: "",
    children: "",
    pets: "",
    interests: [],
  });

  const set = <K extends keyof WizardData>(key: K, value: WizardData[K]) =>
    setData((d) => ({ ...d, [key]: value }));

  const toggleIn = (key: "interestedIn" | "languages" | "interests", value: string, max = 99) =>
    setData((d) => {
      const list = d[key];
      if (list.includes(value)) return { ...d, [key]: list.filter((v) => v !== value) };
      if (list.length >= max) return d;
      return { ...d, [key]: [...list, value] };
    });

  const age = useMemo(
    () => (data.birthDate ? calculateAge(data.birthDate) : null),
    [data.birthDate],
  );

  const stepValid = useMemo(() => {
    switch (step) {
      case 0:
        return data.displayName.trim().length >= 2 && age !== null && age >= 18 && !!data.gender;
      case 1:
        return data.interestedIn.length > 0 && !!data.relationshipGoal;
      case 2:
        return !!data.city;
      case 3:
      case 4:
        return true; // optional enrichment
      case 5:
        return data.interests.length >= 3;
      default:
        return false;
    }
  }, [step, data, age]);

  async function submit() {
    setSubmitting(true);
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
        bio: data.bio.trim(),
        heightCm: data.heightCm ? Number(data.heightCm) : null,
        occupation: data.occupation.trim() || null,
        education: data.education || null,
        languages: data.languages,
        smoking: data.smoking,
        drinking: data.drinking,
        exercise: data.exercise || null,
        children: data.children || null,
        pets: data.pets || null,
        interests: data.interests,
      }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      toast.error(payload?.error?.message ?? "Couldn't save your profile. Please try again.");
      return;
    }
    toast.success("Profile created — welcome to Amora!");
    router.push("/discover");
    router.refresh();
  }

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="space-y-8 pt-4">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <p className="font-medium">{STEPS[step]}</p>
          <p className="text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </p>
        </div>
        <Progress value={progress} aria-label={`Onboarding progress: step ${step + 1} of ${STEPS.length}`} />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="min-h-[50dvh]"
        >
          {step === 0 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  Let&apos;s start with the basics
                </h1>
                <p className="text-muted-foreground">This is how you&apos;ll appear on Amora.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayName">First name</Label>
                <Input
                  id="displayName"
                  value={data.displayName}
                  onChange={(e) => set("displayName", e.target.value)}
                  maxLength={30}
                  placeholder="Your first name"
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
                  className="h-12 rounded-2xl"
                  aria-describedby="age-hint"
                />
                <p id="age-hint" className="text-xs text-muted-foreground">
                  {age !== null && age < 18
                    ? "You must be 18 or older to use Amora."
                    : "Your age is shown on your profile — never your birthday."}
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
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  What are you here for?
                </h1>
                <p className="text-muted-foreground">
                  Honest intentions lead to better matches.
                </p>
              </div>
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
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">I&apos;m looking for…</legend>
                <div className="grid gap-2">
                  {GOALS.map((goal) => (
                    <button
                      key={goal.value}
                      type="button"
                      aria-pressed={data.relationshipGoal === goal.value}
                      onClick={() => set("relationshipGoal", goal.value)}
                      className={cn(
                        "flex items-center justify-between rounded-2xl border px-5 py-4 text-left transition-all",
                        data.relationshipGoal === goal.value
                          ? "border-primary bg-accent shadow-card"
                          : "bg-card hover:border-primary/40",
                      )}
                    >
                      <span>
                        <span className="block font-medium">{goal.label}</span>
                        <span className="block text-sm text-muted-foreground">{goal.hint}</span>
                      </span>
                      <span
                        className={cn(
                          "size-5 rounded-full border-2 transition-colors",
                          data.relationshipGoal === goal.value
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/30",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  Where are you based?
                </h1>
                <p className="text-muted-foreground">
                  We only ever show your city — never your exact location.
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Country</legend>
                <div className="flex gap-2">
                  <ChipToggle selected={data.country === "IE"} onToggle={() => { set("country", "IE"); set("city", ""); }}>
                    🇮🇪 Ireland
                  </ChipToggle>
                  <ChipToggle selected={data.country === "GB"} onToggle={() => { set("country", "GB"); set("city", ""); }}>
                    🇬🇧 United Kingdom
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
                  className="h-12 rounded-2xl"
                  aria-label="Other town or city"
                />
              </fieldset>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  Tell your story
                </h1>
                <p className="text-muted-foreground">
                  All optional — but profiles with a bio get far more matches.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bio">About you</Label>
                <Textarea
                  id="bio"
                  value={data.bio}
                  onChange={(e) => set("bio", e.target.value)}
                  maxLength={BIO_MAX_LENGTH}
                  rows={4}
                  placeholder="What makes you laugh? Where would we find you on a Saturday?"
                  className="rounded-2xl"
                  aria-describedby="bio-count"
                />
                <p id="bio-count" className="text-right text-xs tabular-nums text-muted-foreground">
                  {data.bio.length}/{BIO_MAX_LENGTH}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="height">Height (cm)</Label>
                  <Input
                    id="height"
                    type="number"
                    inputMode="numeric"
                    min={120}
                    max={230}
                    value={data.heightCm}
                    onChange={(e) => set("heightCm", e.target.value)}
                    placeholder="e.g. 175"
                    className="h-12 rounded-2xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="occupation">Occupation</Label>
                  <Input
                    id="occupation"
                    value={data.occupation}
                    onChange={(e) => set("occupation", e.target.value)}
                    maxLength={80}
                    placeholder="What do you do?"
                    className="h-12 rounded-2xl"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Education</Label>
                <Select value={data.education} onValueChange={(v) => set("education", v)}>
                  <SelectTrigger className="h-12 w-full rounded-2xl">
                    <SelectValue placeholder="Select (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SECONDARY">Secondary school</SelectItem>
                    <SelectItem value="UNDERGRADUATE">Undergraduate degree</SelectItem>
                    <SelectItem value="POSTGRADUATE">Postgraduate degree</SelectItem>
                    <SelectItem value="DOCTORATE">Doctorate</SelectItem>
                    <SelectItem value="TRADE_SCHOOL">Trade / apprenticeship</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Languages you speak</legend>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGES.slice(0, 10).map((lang) => (
                    <ChipToggle
                      key={lang}
                      selected={data.languages.includes(lang)}
                      onToggle={() => toggleIn("languages", lang, 8)}
                    >
                      {lang}
                    </ChipToggle>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">Lifestyle</h1>
                <p className="text-muted-foreground">
                  Compatibility lives in the details. All optional.
                </p>
              </div>
              {(
                [
                  ["smoking", "Smoking"],
                  ["drinking", "Drinking"],
                ] as const
              ).map(([key, label]) => (
                <fieldset key={key} className="space-y-2">
                  <legend className="text-sm font-medium">{label}</legend>
                  <div className="flex flex-wrap gap-2">
                    {LIFESTYLE.map((option) => (
                      <ChipToggle
                        key={option.value}
                        selected={data[key] === option.value}
                        onToggle={() => set(key, option.value)}
                      >
                        {option.label}
                      </ChipToggle>
                    ))}
                  </div>
                </fieldset>
              ))}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Exercise</legend>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["NEVER", "Never"],
                    ["SOMETIMES", "Sometimes"],
                    ["REGULARLY", "Regularly"],
                    ["DAILY", "Daily"],
                  ].map(([value, label]) => (
                    <ChipToggle
                      key={value}
                      selected={data.exercise === value}
                      onToggle={() => set("exercise", data.exercise === value ? "" : value)}
                    >
                      {label}
                    </ChipToggle>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Children</legend>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["DONT_HAVE_WANT", "Want kids someday"],
                    ["DONT_HAVE_DONT_WANT", "Don't want kids"],
                    ["HAVE_AND_WANT_MORE", "Have kids, want more"],
                    ["HAVE_AND_DONT_WANT_MORE", "Have kids"],
                    ["NOT_SURE", "Not sure yet"],
                  ].map(([value, label]) => (
                    <ChipToggle
                      key={value}
                      selected={data.children === value}
                      onToggle={() => set("children", data.children === value ? "" : value)}
                    >
                      {label}
                    </ChipToggle>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Pets</legend>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["DOG", "Dog person"],
                    ["CAT", "Cat person"],
                    ["BOTH", "Both"],
                    ["OTHER_PETS", "Other pets"],
                    ["NONE", "No pets"],
                    ["ALLERGIC", "Allergic"],
                  ].map(([value, label]) => (
                    <ChipToggle
                      key={value}
                      selected={data.pets === value}
                      onToggle={() => set("pets", data.pets === value ? "" : value)}
                    >
                      {label}
                    </ChipToggle>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  What are you into?
                </h1>
                <p className="text-muted-foreground" aria-live="polite">
                  Pick at least 3 — you&apos;ve chosen {data.interests.length} of 12.
                </p>
              </div>
              {INTEREST_CATALOGUE.map((group) => (
                <fieldset key={group.category} className="space-y-2">
                  <legend className="text-sm font-semibold">{group.category}</legend>
                  <div className="flex flex-wrap gap-2">
                    {group.items.map((interest) => (
                      <ChipToggle
                        key={interest}
                        selected={data.interests.includes(interest)}
                        onToggle={() => toggleIn("interests", interest, 12)}
                      >
                        {interest}
                      </ChipToggle>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="glass safe-bottom fixed inset-x-0 bottom-0 border-t">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-3">
          <Button
            variant="ghost"
            size="lg"
            className="rounded-full"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || submitting}
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              size="lg"
              className="rounded-full px-8"
              onClick={() => setStep((s) => s + 1)}
              disabled={!stepValid}
            >
              Continue <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              size="lg"
              className="rounded-full px-8"
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
