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
  { category: "Going out", items: ["Live music", "Pubs", "Comedy", "Theatre", "Festivals", "Foodie", "Coffee dates"] },
  { category: "Staying in", items: ["Cooking", "Baking", "Board games", "Gardening", "Reading", "Films", "Podcasts"] },
  { category: "Sports", items: ["GAA", "Rugby", "Football", "Running", "Gym", "Sea swimming", "Hiking", "Yoga", "Cycling", "Golf"] },
  { category: "Creativity", items: ["Photography", "Writing", "Painting", "Music", "Dancing", "Crafts"] },
  { category: "Values & lifestyle", items: ["Volunteering", "Sustainability", "Politics", "Spirituality", "Travel", "Languages", "Dogs", "Cats"] },
];

const slugify = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const DEMO_PROFILES = [
  { name: "Saoirse", gender: "WOMAN", city: "Dublin", lat: 53.3498, lng: -6.2603, bio: "Sea swims at Forty Foot, gallery wanderer, will beat you at Scrabble.", interests: ["Sea swimming", "Reading", "Live music"], occupation: "Architect" },
  { name: "Cian", gender: "MAN", city: "Galway", lat: 53.2707, lng: -9.0568, bio: "Trad sessions and long cycles along the prom. Looking for my plus-one.", interests: ["Music", "Cycling", "Pubs"], occupation: "Teacher" },
  { name: "Aoife", gender: "WOMAN", city: "Cork", lat: 51.8985, lng: -8.4756, bio: "English market regular. I make a mean sourdough.", interests: ["Baking", "Foodie", "Hiking"], occupation: "Nurse" },
  { name: "Oliver", gender: "MAN", city: "London", lat: 51.5074, lng: -0.1278, bio: "Camden gigs, Sunday roasts, five-a-side on Thursdays.", interests: ["Football", "Live music", "Films"], occupation: "Product designer" },
  { name: "Amelia", gender: "WOMAN", city: "Manchester", lat: 53.4808, lng: -2.2426, bio: "Northern quarter coffee snob. Parkrun most Saturdays.", interests: ["Running", "Coffee dates", "Podcasts"], occupation: "Data analyst" },
  { name: "Rory", gender: "MAN", city: "Belfast", lat: 54.5973, lng: -5.9301, bio: "Hiking the Mournes, then pints. Dog dad to a chaotic collie.", interests: ["Hiking", "Dogs", "Photography"], occupation: "Engineer" },
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
    where: { email: "admin@virelsy.app" },
    create: {
      email: "admin@virelsy.app",
      name: "Virelsy Admin",
      role: "ADMIN",
      emailVerified: new Date(),
      onboardingDone: true,
      subscription: { create: { tier: "PREMIUM" } },
    },
    update: { role: "ADMIN" },
  });
  console.log("✓ admin@virelsy.app app-row (role only; sign-in lives in Supabase Auth)");

  // Demo members
  for (const demo of DEMO_PROFILES) {
    const email = `${demo.name.toLowerCase()}@demo.virelsy.app`;
    const birthDate = new Date(1994 + (demo.name.length % 6), (demo.name.length * 3) % 12, 12);

    const user = await db.user.upsert({
      where: { email },
      create: {
        email,
        name: demo.name,
        emailVerified: new Date(),
        onboardingDone: true,
        subscription: { create: { tier: "FREE" } },
        verifications: {
          create: [
            { type: "EMAIL", status: "APPROVED" },
            { type: "PHOTO", status: "APPROVED", provider: "internal" },
          ],
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
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  });

// ---------------------------------------------------------------------------
// Explore categories
// ---------------------------------------------------------------------------
import { DISCOVERY_TAXONOMY } from "../src/config/discovery-taxonomy";
async function seedExplore() {
for (let i = 0; i < DISCOVERY_TAXONOMY.length; i++) {
  const c = DISCOVERY_TAXONOMY[i];
  await db.exploreCategory.upsert({
    where: { slug: c.id },
    create: { slug: c.id, title: c.label, group: c.group, description: c.description, iconKey: c.icon, gradientFrom: c.gradientFrom, gradientTo: c.gradientTo, matcher: c.matchingRule, sortOrder: i, isActive: true },
    update: { title: c.label, group: c.group, description: c.description, iconKey: c.icon, gradientFrom: c.gradientFrom, gradientTo: c.gradientTo, matcher: c.matchingRule, sortOrder: i },
  });
}
console.log(`✓ ${DISCOVERY_TAXONOMY.length} explore categories (from taxonomy)`);
}

async function seedExtras() {
    // Spread structured tags across demo profiles so every Explore group has people
const TAG_SPREADS = [
  { availabilityTags: ["free-tonight", "coffee-now"], personalityTags: ["extrovert", "night-owl"], communityTags: ["dog-lover"] },
  { availabilityTags: ["weekend-plans"], personalityTags: ["introvert", "early-bird"], communityTags: ["student"] },
  { availabilityTags: ["walk-together", "weekend-plans"], personalityTags: ["adventurer"], communityTags: ["expat"] },
  { availabilityTags: ["dinner-tonight"], personalityTags: ["extrovert"], communityTags: ["parent"] },
  { availabilityTags: ["coffee-now", "free-tonight"], personalityTags: ["night-owl", "adventurer"], communityTags: ["expat", "dog-lover"] },
  { availabilityTags: ["weekend-plans", "dinner-tonight"], personalityTags: ["introvert"], communityTags: ["student", "dog-lover"] },
];
const demoProfiles = await db.profile.findMany({
  where: { user: { email: { endsWith: "@demo.virelsy.app" } } },
  orderBy: { createdAt: "asc" },
});
for (let i = 0; i < demoProfiles.length; i++) {
  await db.profile.update({ where: { id: demoProfiles[i].id }, data: TAG_SPREADS[i % TAG_SPREADS.length] });
}
// Freshen activity so TODAY rows have live members
await db.user.updateMany({
  where: { email: { endsWith: "@demo.virelsy.app" } },
  data: { lastActiveAt: new Date(), status: "ACTIVE" },
});
console.log(`✓ structured tags on ${demoProfiles.length} demo profiles`);
// Expand the demo cast to 12 so every taxonomy circle has people (dev only)
const EXTRA = [
  { name: "Nia", gender: "WOMAN", goal: "SHORT_TERM", country: "GB", city: "Bristol", interests: ["films", "tech"], tags: TAG_SPREADS[0] },
  { name: "Tomas", gender: "MAN", goal: "LONG_TERM", country: "IE", city: "Limerick", interests: ["photography", "hiking"], tags: TAG_SPREADS[1] },
  { name: "Freya", gender: "WOMAN", goal: "FRIENDSHIP", country: "GB", city: "Leeds", interests: ["reading", "crafts"], tags: TAG_SPREADS[2] },
  { name: "Marco", gender: "MAN", goal: "OPEN_TO_EITHER", country: "IE", city: "Waterford", interests: ["cooking", "travel"], tags: TAG_SPREADS[3] },
  { name: "Priya", gender: "WOMAN", goal: "LONG_TERM", country: "GB", city: "Birmingham", interests: ["live-music", "gym"], tags: TAG_SPREADS[4] },
  { name: "Sean", gender: "MAN", goal: "SHORT_TERM", country: "IE", city: "Sligo", interests: ["dogs", "running"], tags: TAG_SPREADS[5] },
] as const;
for (let i = 0; i < EXTRA.length; i++) {
  const e = EXTRA[i];
  const email = `${e.name.toLowerCase()}@demo.virelsy.app`;
  const u = await db.user.upsert({
    where: { email },
    create: { email, name: e.name, emailVerified: new Date(), onboardingDone: true, lastActiveAt: new Date(Date.now() - i * 3 * 3600_000) },
    update: { lastActiveAt: new Date(Date.now() - i * 3 * 3600_000), status: "ACTIVE" },
  });
  const interestRows = await db.interest.findMany({ where: { slug: { in: [...e.interests] } } });
  await db.profile.upsert({
    where: { userId: u.id },
    create: {
      userId: u.id, displayName: e.name, birthDate: new Date(1990 + i, i + 1, 10 + i),
      gender: e.gender, interestedIn: e.gender === "WOMAN" ? ["MAN"] : ["WOMAN"],
      relationshipGoal: e.goal, country: e.country, city: e.city, isVisible: true,
      bio: `${e.name} from ${e.city}. Demo profile.`, completionPct: 70,
      ...e.tags,
      interests: { create: interestRows.map((r) => ({ interestId: r.id })) },
    },
    update: { ...e.tags, relationshipGoal: e.goal },
  });
  if (i % 2 === 0) {
    await db.verification.upsert({
      where: { userId_type: { userId: u.id, type: "PHOTO" } },
      create: { userId: u.id, type: "PHOTO", status: "APPROVED", provider: "internal" },
      update: { status: "APPROVED" },
    });
  }
}
console.log(`✓ ${EXTRA.length} extra demo profiles (12 total)`);
}
