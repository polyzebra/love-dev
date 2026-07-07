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
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });

// ---------------------------------------------------------------------------
// Explore categories
// ---------------------------------------------------------------------------
type Cat = { slug: string; title: string; group: "LIFESTYLE"|"INTERESTS"|"GOALS"|"TODAY"|"PERSONALITY"|"COMMUNITIES"; description: string; iconKey: string; from: string; to: string; matcher?: object };
const EXPLORE: Cat[] = [
  { slug: "coffee-dates", title: "Coffee dates", group: "LIFESTYLE", description: "People who think the best first date fits in a cup.", iconKey: "coffee", from: "#d9a066", to: "#7a4a21", matcher: { kind: "interests", values: ["coffee-dates"] } },
  { slug: "foodies", title: "Foodies", group: "LIFESTYLE", description: "Menus read like novels. Order for the table.", iconKey: "food", from: "#fb7185", to: "#9f1239", matcher: { kind: "interests", values: ["foodie", "cooking", "baking"] } },
  { slug: "music-lovers", title: "Music lovers", group: "LIFESTYLE", description: "Gig tickets over gym selfies.", iconKey: "music", from: "#a78bfa", to: "#4c1d95", matcher: { kind: "interests", values: ["live-music", "music"] } },
  { slug: "nature-lovers", title: "Nature lovers", group: "LIFESTYLE", description: "Happiest above the treeline or beside the sea.", iconKey: "nature", from: "#4ade80", to: "#14532d", matcher: { kind: "interests", values: ["hiking", "gardening", "sea-swimming"] } },
  { slug: "travelers", title: "Travellers", group: "LIFESTYLE", description: "Passport always within reach.", iconKey: "travel", from: "#38bdf8", to: "#0c4a6e", matcher: { kind: "interests", values: ["travel"] } },
  { slug: "pet-lovers", title: "Pet lovers", group: "LIFESTYLE", description: "Their camera roll is 80% animals.", iconKey: "pets", from: "#fbbf24", to: "#92400e", matcher: { kind: "interests", values: ["dogs", "cats"] } },
  { slug: "gym-lovers", title: "Gym lovers", group: "LIFESTYLE", description: "Endorphins first, everything else after.", iconKey: "gym", from: "#f87171", to: "#7f1d1d", matcher: { kind: "interests", values: ["gym", "running", "cycling"] } },
  { slug: "gamers", title: "Gamers", group: "INTERESTS", description: "Co-op hearts.", iconKey: "gaming", from: "#818cf8", to: "#312e81", matcher: { kind: "interests", values: ["board-games"] } },
  { slug: "creatives", title: "Creatives", group: "INTERESTS", description: "Makers, painters, writers, dreamers.", iconKey: "creative", from: "#f472b6", to: "#831843", matcher: { kind: "interests", values: ["painting", "writing", "crafts", "dancing"] } },
  { slug: "photography", title: "Photography", group: "INTERESTS", description: "Sees the world in golden hour.", iconKey: "photo", from: "#94a3b8", to: "#1e293b", matcher: { kind: "interests", values: ["photography"] } },
  { slug: "reading", title: "Reading", group: "INTERESTS", description: "Will judge you kindly by your bookshelf.", iconKey: "reading", from: "#e7c9a1", to: "#78350f", matcher: { kind: "interests", values: ["reading"] } },
  { slug: "movies", title: "Movies", group: "INTERESTS", description: "Front row of life's best stories.", iconKey: "movies", from: "#fb923c", to: "#7c2d12", matcher: { kind: "interests", values: ["films"] } },
  { slug: "cars", title: "Cars", group: "INTERESTS", description: "Petrol, electric or classic - drives count as dates.", iconKey: "cars", from: "#22d3ee", to: "#164e63", matcher: { kind: "preference" } },
  { slug: "tech", title: "Tech", group: "INTERESTS", description: "Builds things. Breaks things. Fixes them better.", iconKey: "tech", from: "#34d399", to: "#064e3b", matcher: { kind: "preference" } },
  { slug: "long-term-partner", title: "Long-term partner", group: "GOALS", description: "Building something that lasts.", iconKey: "long-term", from: "#fb7185", to: "#881337", matcher: { kind: "goal", values: ["LONG_TERM"] } },
  { slug: "serious-relationship", title: "Serious relationship", group: "GOALS", description: "Done with games. Ready for real.", iconKey: "ring", from: "#f9a8d4", to: "#9d174d", matcher: { kind: "goal", values: ["LONG_TERM", "OPEN_TO_EITHER"] } },
  { slug: "marriage-minded", title: "Marriage-minded", group: "GOALS", description: "Thinking in decades, not weekends.", iconKey: "marriage", from: "#e7c9a1", to: "#854d0e", matcher: { kind: "goal", values: ["LONG_TERM"] } },
  { slug: "new-friends", title: "New friends", group: "GOALS", description: "Connection first - see where it goes.", iconKey: "friends", from: "#fde047", to: "#a16207", matcher: { kind: "goal", values: ["FRIENDSHIP"] } },
  { slug: "casual-dating", title: "Casual dating", group: "GOALS", description: "Good company, no pressure.", iconKey: "casual", from: "#c084fc", to: "#6b21a8", matcher: { kind: "goal", values: ["SHORT_TERM", "OPEN_TO_EITHER"] } },
  { slug: "free-tonight", title: "Free tonight", group: "TODAY", description: "Online now and open to plans.", iconKey: "tonight", from: "#818cf8", to: "#1e1b4b", matcher: { kind: "recentlyActive", hours: 24 } },
  { slug: "weekend-plans", title: "Weekend plans", group: "TODAY", description: "Looking ahead to Saturday.", iconKey: "weekend", from: "#fb7185", to: "#9f1239", matcher: { kind: "recentlyActive", hours: 72 } },
  { slug: "coffee-now", title: "Coffee now", group: "TODAY", description: "Spontaneous flat whites.", iconKey: "coffee-now", from: "#d9a066", to: "#78350f", matcher: { kind: "recentlyActive", hours: 6 } },
  { slug: "walk-together", title: "Walk together", group: "TODAY", description: "Fresh air and good conversation.", iconKey: "walk", from: "#4ade80", to: "#166534", matcher: { kind: "recentlyActive", hours: 48 } },
  { slug: "dinner-tonight", title: "Dinner tonight", group: "TODAY", description: "Table for two, tonight.", iconKey: "dinner", from: "#fbbf24", to: "#92400e", matcher: { kind: "recentlyActive", hours: 24 } },
  { slug: "introverts", title: "Introverts", group: "PERSONALITY", description: "Deep talks over small talk.", iconKey: "introvert", from: "#94a3b8", to: "#334155", matcher: { kind: "preference" } },
  { slug: "extroverts", title: "Extroverts", group: "PERSONALITY", description: "The room gets brighter when they arrive.", iconKey: "extrovert", from: "#fbbf24", to: "#b45309", matcher: { kind: "preference" } },
  { slug: "adventurers", title: "Adventurers", group: "PERSONALITY", description: "Says yes first, plans later.", iconKey: "adventure", from: "#34d399", to: "#065f46", matcher: { kind: "interests", values: ["hiking", "travel"] } },
  { slug: "early-birds", title: "Early birds", group: "PERSONALITY", description: "Sunrise swims and first coffees.", iconKey: "early-bird", from: "#fde047", to: "#ca8a04", matcher: { kind: "preference" } },
  { slug: "night-owls", title: "Night owls", group: "PERSONALITY", description: "Best conversations happen after midnight.", iconKey: "night-owl", from: "#818cf8", to: "#312e81", matcher: { kind: "preference" } },
  { slug: "irish-singles", title: "Irish singles", group: "COMMUNITIES", description: "From Dublin to Dingle.", iconKey: "map-ie", from: "#4ade80", to: "#14532d", matcher: { kind: "country", values: ["IE"] } },
  { slug: "uk-singles", title: "UK singles", group: "COMMUNITIES", description: "London to the Highlands.", iconKey: "map-uk", from: "#60a5fa", to: "#1e3a8a", matcher: { kind: "country", values: ["GB"] } },
  { slug: "expats", title: "Expats", group: "COMMUNITIES", description: "New city, open heart.", iconKey: "expat", from: "#c084fc", to: "#581c87", matcher: { kind: "preference" } },
  { slug: "students", title: "Students", group: "COMMUNITIES", description: "Lectures by day.", iconKey: "student", from: "#38bdf8", to: "#075985", matcher: { kind: "preference" } },
  { slug: "parents", title: "Parents", group: "COMMUNITIES", description: "Kids come first - romance still counts.", iconKey: "parent", from: "#f9a8d4", to: "#9d174d", matcher: { kind: "preference" } },
  { slug: "dog-lovers", title: "Dog lovers", group: "COMMUNITIES", description: "Must love dogs. Non-negotiable.", iconKey: "dog-lover", from: "#fbbf24", to: "#78350f", matcher: { kind: "interests", values: ["dogs"] } },
];
async function seedExplore() {
for (let i = 0; i < EXPLORE.length; i++) {
  const c = EXPLORE[i];
  await db.exploreCategory.upsert({
    where: { slug: c.slug },
    create: { slug: c.slug, title: c.title, group: c.group, description: c.description, iconKey: c.iconKey, gradientFrom: c.from, gradientTo: c.to, matcher: c.matcher, sortOrder: i, isActive: true },
    update: { title: c.title, group: c.group, description: c.description, iconKey: c.iconKey, gradientFrom: c.from, gradientTo: c.to, matcher: c.matcher, sortOrder: i },
  });
}
console.log(`✓ ${EXPLORE.length} explore categories`);
}

