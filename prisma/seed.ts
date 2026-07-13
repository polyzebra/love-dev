/**
 * Seed: interest catalogue, an admin account, and a handful of demo
 * profiles so Discover/Matches/Chat have data in development.
 *
 * Run: npx prisma db seed   (or: npx tsx prisma/seed.ts)
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const INTERESTS: { category: string; items: string[] }[] = [
  {
    category: "Going out",
    items: ["Live music", "Pubs", "Comedy", "Theatre", "Festivals", "Foodie", "Coffee dates"],
  },
  {
    category: "Staying in",
    items: [
      "Cooking",
      "Baking",
      "Board games",
      "Gardening",
      "Reading",
      "Films",
      "TV series",
      "Gaming",
      "Podcasts",
    ],
  },
  {
    category: "Sports",
    items: [
      "GAA",
      "Rugby",
      "Football",
      "Running",
      "Gym",
      "Sea swimming",
      "Hiking",
      "Yoga",
      "Cycling",
      "Golf",
    ],
  },
  {
    category: "Creativity",
    items: ["Photography", "Writing", "Painting", "Music", "Dancing", "Crafts"],
  },
  {
    category: "Values & lifestyle",
    items: [
      "Volunteering",
      "Sustainability",
      "Politics",
      "Spirituality",
      "Travel",
      "Languages",
      "Dogs",
      "Cats",
    ],
  },
];

const slugify = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const DEMO_PROFILES = [
  {
    name: "Saoirse",
    gender: "WOMAN",
    city: "Dublin",
    lat: 53.3498,
    lng: -6.2603,
    bio: "Sea swims at Forty Foot, gallery wanderer, will beat you at Scrabble.",
    interests: ["Sea swimming", "Reading", "Live music"],
    occupation: "Architect",
  },
  {
    name: "Cian",
    gender: "MAN",
    city: "Galway",
    lat: 53.2707,
    lng: -9.0568,
    bio: "Trad sessions and long cycles along the prom. Looking for my plus-one.",
    interests: ["Music", "Cycling", "Pubs"],
    occupation: "Teacher",
  },
  {
    name: "Aoife",
    gender: "WOMAN",
    city: "Cork",
    lat: 51.8985,
    lng: -8.4756,
    bio: "English market regular. I make a mean sourdough.",
    interests: ["Baking", "Foodie", "Hiking"],
    occupation: "Nurse",
  },
  {
    name: "Oliver",
    gender: "MAN",
    city: "London",
    lat: 51.5074,
    lng: -0.1278,
    bio: "Camden gigs, Sunday roasts, five-a-side on Thursdays.",
    interests: ["Football", "Live music", "Films"],
    occupation: "Product designer",
  },
  {
    name: "Amelia",
    gender: "WOMAN",
    city: "Manchester",
    lat: 53.4808,
    lng: -2.2426,
    bio: "Northern quarter coffee snob. Parkrun most Saturdays.",
    interests: ["Running", "Coffee dates", "Podcasts"],
    occupation: "Data analyst",
  },
  {
    name: "Rory",
    gender: "MAN",
    city: "Belfast",
    lat: 54.5973,
    lng: -5.9301,
    bio: "Hiking the Mournes, then pints. Dog dad to a chaotic collie.",
    interests: ["Hiking", "Dogs", "Photography"],
    occupation: "Engineer",
  },
] as const;

async function main() {
  // Interests
  for (const group of INTERESTS) {
    for (const label of group.items) {
      await db.interest.upsert({
        where: { slug: slugify(label) },
        create: { slug: slugify(label), label, category: group.category },
        update: { category: group.category },
      });
    }
  }
  console.log("✓ interest catalogue");

  // Admin
  await db.user.upsert({
    where: { email: "admin@tirvea.app" },
    create: {
      email: "admin@tirvea.app",
      name: "Tirvea Admin",
      role: "ADMIN",
      emailVerified: new Date(),
      onboardingDone: true,
      subscription: { create: { tier: "GOLD" } },
    },
    update: { role: "ADMIN" },
  });
  console.log("✓ admin@tirvea.app app-row (role only; sign-in lives in Supabase Auth)");

  // Demo members
  for (const demo of DEMO_PROFILES) {
    const email = `${demo.name.toLowerCase()}@demo.tirvea.app`;
    const birthDate = new Date(1994 + (demo.name.length % 6), (demo.name.length * 3) % 12, 12);

    const user = await db.user.upsert({
      where: { email },
      create: {
        email,
        name: demo.name,
        // Verdicts live on User columns (see src/lib/services/verification.ts);
        // the PHOTO row mirrors the review workflow that produced the verdict.
        emailVerified: new Date(),
        photoVerifiedAt: new Date(),
        onboardingDone: true,
        subscription: { create: { tier: "FREE" } },
        verifications: {
          create: [{ type: "PHOTO", status: "APPROVED", provider: "internal" }],
        },
      },
      update: {},
    });

    const interestIds = await db.interest.findMany({
      where: { slug: { in: demo.interests.map(slugify) } },
      select: { id: true },
    });

    await db.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        displayName: demo.name,
        birthDate,
        gender: demo.gender,
        interestedIn: demo.gender === "WOMAN" ? ["MAN"] : ["WOMAN"],
        relationshipGoal: "LONG_TERM",
        bio: demo.bio,
        city: demo.city,
        country: ["London", "Manchester", "Belfast"].includes(demo.city) ? "GB" : "IE",
        latitude: demo.lat,
        longitude: demo.lng,
        occupation: demo.occupation,
        languages: ["English"],
        completionPct: 85,
        interests: { create: interestIds.map((i) => ({ interestId: i.id })) },
      },
      update: {},
    });
  }
  console.log(`✓ ${DEMO_PROFILES.length} demo profiles (content fixtures; not sign-in accounts)`);
}

main()
  .then(() => seedExplore())
  .then(() => seedExtras())
  .then(() => seedPrompts())
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  });

// ---------------------------------------------------------------------------
// Explore categories - built 1:1 from the canonical discovery taxonomy
// (src/lib/discovery/taxonomy.ts). Exactly the 20 taxonomy categories exist
// as ExploreCategory rows; anything else is deleted. Profile interests and
// tags are never touched here - retired categories live on as secondary
// profile attributes only.
// ---------------------------------------------------------------------------
import { exploreCategories } from "../src/lib/discovery/taxonomy";
import type { TaxonomyCategory, TaxonomyGroup } from "../src/lib/discovery/taxonomy";
import type { ExploreGroup } from "../src/generated/prisma/enums";

const GROUP_TO_ENUM: Record<TaxonomyGroup, ExploreGroup> = {
  "right-now": "TODAY",
  relationship: "GOALS",
  lifestyle: "LIFESTYLE",
  interests: "INTERESTS",
  community: "COMMUNITIES",
};

/** Premium gradient pair for each taxonomy colour token. */
const GRADIENTS: Record<TaxonomyCategory["colorToken"], { from: string; to: string }> = {
  rose: { from: "#fb7185", to: "#be123c" },
  amber: { from: "#fbbf24", to: "#b45309" },
  emerald: { from: "#34d399", to: "#047857" },
  sky: { from: "#38bdf8", to: "#0369a1" },
  violet: { from: "#a78bfa", to: "#6d28d9" },
  gold: { from: "#eac557", to: "#96690e" },
};

/** Matcher JSON consumed by membershipWhere() in src/lib/services/explore.ts. */
function matcherFor(c: TaxonomyCategory): { kind: string; values: string[] } {
  switch (c.profileFieldMapping) {
    case "availabilityTags":
      return { kind: "availability", values: [c.id] };
    case "relationshipGoal":
      return { kind: "goal", values: [c.goalValue!] };
    case "interests":
      return { kind: "interests", values: c.interestSlugs ?? [] };
    case "communityTags":
      return { kind: "community", values: [c.id] };
  }
}

async function seedExplore() {
  const cats = exploreCategories();
  // Stale categories (old taxonomy) disappear from Explore entirely.
  // UserExplorePreference rows cascade with the category (onDelete: Cascade).
  const { count: removed } = await db.exploreCategory.deleteMany({
    where: { slug: { notIn: cats.map((c) => c.slug) } },
  });
  for (let i = 0; i < cats.length; i++) {
    const c = cats[i];
    const data = {
      title: c.label,
      description: c.description,
      group: GROUP_TO_ENUM[c.group],
      iconKey: c.icon,
      gradientFrom: GRADIENTS[c.colorToken].from,
      gradientTo: GRADIENTS[c.colorToken].to,
      matcher: matcherFor(c),
      sortOrder: i,
      isActive: true,
    };
    await db.exploreCategory.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, ...data },
      update: data,
    });
  }
  const total = await db.exploreCategory.count();
  console.log(
    `✓ ${cats.length} explore categories from taxonomy (${removed} stale removed, ${total} total)`,
  );
}

async function seedExtras() {
  // Spread structured tags across demo profiles so every Explore group has people
  const TAG_SPREADS = [
    {
      availabilityTags: ["free-tonight", "coffee-now"],
      personalityTags: ["extrovert", "night-owl"],
      communityTags: ["irish"],
    },
    {
      availabilityTags: ["weekend-plans"],
      personalityTags: ["introvert", "early-bird"],
      communityTags: ["uk"],
    },
    {
      availabilityTags: ["walk-together", "weekend-plans"],
      personalityTags: ["adventurer"],
      communityTags: ["international"],
    },
    {
      availabilityTags: ["free-tonight"],
      personalityTags: ["extrovert"],
      communityTags: ["irish"],
    },
    {
      availabilityTags: ["coffee-now", "free-tonight"],
      personalityTags: ["night-owl", "adventurer"],
      communityTags: ["uk", "international"],
    },
    {
      availabilityTags: ["weekend-plans", "coffee-now"],
      personalityTags: ["introvert"],
      communityTags: ["irish", "international"],
    },
  ];
  const demoProfiles = await db.profile.findMany({
    where: { user: { email: { endsWith: "@demo.tirvea.app" } } },
    orderBy: { createdAt: "asc" },
  });
  for (let i = 0; i < demoProfiles.length; i++) {
    await db.profile.update({
      where: { id: demoProfiles[i].id },
      data: TAG_SPREADS[i % TAG_SPREADS.length],
    });
  }
  // Freshen activity so TODAY rows have live members
  await db.user.updateMany({
    where: { email: { endsWith: "@demo.tirvea.app" } },
    data: { lastActiveAt: new Date(), status: "ACTIVE" },
  });
  console.log(`✓ structured tags on ${demoProfiles.length} demo profiles`);
  // Expand the demo cast to 12 so every taxonomy circle has people (dev only)
  const EXTRA = [
    {
      name: "Nia",
      gender: "WOMAN",
      goal: "SHORT_TERM",
      country: "GB",
      city: "Bristol",
      interests: ["films", "gaming"],
      tags: TAG_SPREADS[0],
    },
    {
      name: "Tomas",
      gender: "MAN",
      goal: "MARRIAGE_MINDED",
      country: "IE",
      city: "Limerick",
      interests: ["photography", "hiking"],
      tags: TAG_SPREADS[1],
    },
    {
      name: "Freya",
      gender: "WOMAN",
      goal: "FRIENDSHIP",
      country: "GB",
      city: "Leeds",
      interests: ["reading", "crafts"],
      tags: TAG_SPREADS[2],
    },
    {
      name: "Marco",
      gender: "MAN",
      goal: "OPEN_TO_EITHER",
      country: "IE",
      city: "Waterford",
      interests: ["cooking", "travel"],
      tags: TAG_SPREADS[3],
    },
    {
      name: "Priya",
      gender: "WOMAN",
      goal: "LONG_TERM",
      country: "GB",
      city: "Birmingham",
      interests: ["live-music", "gym"],
      tags: TAG_SPREADS[4],
    },
    {
      name: "Sean",
      gender: "MAN",
      goal: "SHORT_TERM",
      country: "IE",
      city: "Sligo",
      interests: ["dogs", "running"],
      tags: TAG_SPREADS[5],
    },
  ] as const;
  for (let i = 0; i < EXTRA.length; i++) {
    const e = EXTRA[i];
    const email = `${e.name.toLowerCase()}@demo.tirvea.app`;
    const u = await db.user.upsert({
      where: { email },
      create: {
        email,
        name: e.name,
        emailVerified: new Date(),
        onboardingDone: true,
        lastActiveAt: new Date(Date.now() - i * 3 * 3600_000),
      },
      update: { lastActiveAt: new Date(Date.now() - i * 3 * 3600_000), status: "ACTIVE" },
    });
    const interestRows = await db.interest.findMany({ where: { slug: { in: [...e.interests] } } });
    await db.profile.upsert({
      where: { userId: u.id },
      create: {
        userId: u.id,
        displayName: e.name,
        birthDate: new Date(1990 + i, i + 1, 10 + i),
        gender: e.gender,
        interestedIn: e.gender === "WOMAN" ? ["MAN"] : ["WOMAN"],
        relationshipGoal: e.goal,
        country: e.country,
        city: e.city,
        isVisible: true,
        bio: `${e.name} from ${e.city}. Demo profile.`,
        completionPct: 70,
        ...e.tags,
        interests: { create: interestRows.map((r) => ({ interestId: r.id })) },
      },
      update: { ...e.tags, relationshipGoal: e.goal },
    });
    if (i % 2 === 0) {
      // Verdict on the User column + workflow row, exactly like a real
      // approved review (see src/lib/services/verification.ts).
      await db.verification.upsert({
        where: { userId_type: { userId: u.id, type: "PHOTO" } },
        create: { userId: u.id, type: "PHOTO", status: "APPROVED", provider: "internal" },
        update: { status: "APPROVED" },
      });
      await db.user.update({
        where: { id: u.id },
        data: { photoVerifiedAt: new Date() },
      });
    }
  }
  console.log(`✓ ${EXTRA.length} extra demo profiles (12 total)`);
}

// ---------------------------------------------------------------------------
// Profile prompts - the human voice on every demo profile. Keys come from
// src/config/prompts.ts; delete-then-create keeps the seed idempotent.
// ---------------------------------------------------------------------------
const DEMO_PROMPTS: Record<string, { key: string; answer: string }[]> = {
  saoirse: [
    {
      key: "typical-saturday",
      answer:
        "Forty Foot swim before the crowds, flat white on the walk back, then an afternoon lost in the Hugh Lane.",
    },
    {
      key: "green-flags",
      answer: "You have a library card and you are not afraid to lose at Scrabble gracefully.",
    },
    {
      key: "favourite-place",
      answer: "The Great South Wall at low tide. Half the city behind you, all that sky in front.",
    },
    { key: "starter", answer: "Tell me the last book you pressed into someone's hands." },
  ],
  cian: [
    {
      key: "typical-saturday",
      answer:
        "Long cycle out to Spiddal, back for a toastie, then a trad session in the Crane Bar until they turn the lights on.",
    },
    {
      key: "perfect-first-date",
      answer:
        "Pints and a corner seat near the music. If you can sit through a slow air without checking your phone, we are grand.",
    },
    { key: "small-happy", answer: "When the whole pub goes quiet for the sean nos singer." },
  ],
  aoife: [
    {
      key: "typical-saturday",
      answer:
        "English Market first thing for cheese and good bread, then up a hill somewhere with the leftovers.",
    },
    {
      key: "small-happy",
      answer:
        "The crackle a proper sourdough crust makes when it is cooling. Twelve hour shifts melt away.",
    },
    {
      key: "looking-for",
      answer: "Someone patient, a bit soft, and honest about wanting the long thing.",
    },
    {
      key: "starter",
      answer: "Bring me a bake you are proud of and I will give you an honest review.",
    },
  ],
  oliver: [
    {
      key: "typical-saturday",
      answer:
        "Five-a-side in the morning, record shopping in Camden after, and whoever wins the group chat picks the gig.",
    },
    {
      key: "perfect-first-date",
      answer: "A matinee at the Prince Charles, then arguing about the film over a Sunday roast.",
    },
    {
      key: "green-flags",
      answer:
        "You rate the support act. You tip properly. You have one film you defend against all critics.",
    },
  ],
  amelia: [
    {
      key: "typical-saturday",
      answer:
        "Parkrun at 9, Northern Quarter coffee by 11, and I will absolutely judge the latte art.",
    },
    {
      key: "relationship-style",
      answer: "Steady and curious. I like plans, but I like being talked into better ones more.",
    },
    {
      key: "small-happy",
      answer: "A new PB and a podcast episode that makes me miss my tram stop.",
    },
    {
      key: "starter",
      answer: "Recommend me a podcast and I will actually listen to it before we meet.",
    },
  ],
  rory: [
    {
      key: "typical-saturday",
      answer:
        "Up the Mournes with Murphy the collie, camera in the bag, pints in the Crown after to earn it.",
    },
    {
      key: "green-flags",
      answer:
        "The dog likes you. Honestly that is most of it. Bonus points if you carry your own snacks uphill.",
    },
    {
      key: "favourite-place",
      answer: "The saddle below Slieve Donard just as the cloud lifts. Best office in Ireland.",
    },
  ],
  nia: [
    {
      key: "perfect-first-date",
      answer: "Watershed screening, then cider by the harbourside while we pull the plot apart.",
    },
    {
      key: "small-happy",
      answer: "Shipping something on a Friday and closing the laptop like a car door.",
    },
    {
      key: "looking-for",
      answer: "Fun, honestly. Good company, good chat, no five year plan required.",
    },
  ],
  tomas: [
    {
      key: "typical-saturday",
      answer:
        "Golden hour on the Clare hills with the camera, then chips on the drive home while the shots back up.",
    },
    {
      key: "favourite-place",
      answer:
        "Lough Gur just after sunrise, mist still on the water. I have a hundred photos and none of them do it justice.",
    },
    {
      key: "looking-for",
      answer: "Someone to share the quiet moments with. The loud ones sort themselves out.",
    },
    {
      key: "green-flags",
      answer: "You do not mind waiting twenty minutes for the light to be right.",
    },
  ],
  freya: [
    {
      key: "typical-saturday",
      answer:
        "Charity bookshops in the morning, knitting group in the afternoon, and a stack of library holds to collect in between.",
    },
    {
      key: "small-happy",
      answer: "Finishing a jumper and realising the sleeves actually match this time.",
    },
    {
      key: "starter",
      answer:
        "Tell me a book that changed your mind about something. I am here for new friends and good recommendations.",
    },
  ],
  marco: [
    {
      key: "typical-saturday",
      answer:
        "Farmers market haul, then an afternoon cooking something from wherever I travelled last. Neighbours get the leftovers.",
    },
    {
      key: "perfect-first-date",
      answer:
        "You bring the wine, I cook. If that feels like too much, the Greenway and an ice cream works too.",
    },
    {
      key: "favourite-place",
      answer: "A tiny trattoria in Lecce where the nonna decided my order for me. She was right.",
    },
    {
      key: "relationship-style",
      answer: "Easy going. I am open to casual or serious, mostly I just want it to feel natural.",
    },
  ],
  priya: [
    {
      key: "typical-saturday",
      answer:
        "Heavy leg day, massive brunch, then queueing early for whoever is playing the O2 Institute.",
    },
    {
      key: "green-flags",
      answer:
        "You sing along wrong and do not care. You re-rack your weights. You text when you say you will.",
    },
    {
      key: "looking-for",
      answer: "Something real. I am done auditioning people who are just passing time.",
    },
  ],
  sean: [
    {
      key: "typical-saturday",
      answer:
        "Beach run at Strandhill with the dog going absolutely feral in the dunes, then a chicken fillet roll each. He earned his.",
    },
    {
      key: "small-happy",
      answer: "That first stretch of a run when the rain holds off and the tunes hit right.",
    },
    { key: "starter", answer: "Dog photos first, questions later." },
  ],
};

async function seedPrompts() {
  let total = 0;
  for (const [handle, prompts] of Object.entries(DEMO_PROMPTS)) {
    const profile = await db.profile.findFirst({
      where: { user: { email: `${handle}@demo.tirvea.app` } },
      select: { id: true },
    });
    if (!profile) {
      console.warn(`  ! no profile for ${handle}, skipping prompts`);
      continue;
    }
    await db.profilePrompt.deleteMany({ where: { profileId: profile.id } });
    await db.profilePrompt.createMany({
      data: prompts.map((p, index) => ({
        profileId: profile.id,
        promptKey: p.key,
        answer: p.answer,
        sortOrder: index,
      })),
      skipDuplicates: true,
    });
    total += prompts.length;
  }
  console.log(
    `✓ ${total} profile prompts across ${Object.keys(DEMO_PROMPTS).length} demo profiles`,
  );
}
