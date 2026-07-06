/**
 * Seed: interest catalogue, an admin account, and a handful of demo
 * profiles so Discover/Matches/Chat have data in development.
 *
 * Run: npx prisma db seed   (or: npx tsx prisma/seed.ts)
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
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
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin-virelsy-2026";
  await db.user.upsert({
    where: { email: "admin@virelsy.app" },
    create: {
      email: "admin@virelsy.app",
      name: "Virelsy Admin",
      role: "ADMIN",
      emailVerified: new Date(),
      onboardingDone: true,
      passwordHash: await bcrypt.hash(adminPassword, 12),
      subscription: { create: { tier: "PREMIUM" } },
    },
    update: { role: "ADMIN" },
  });
  console.log(`✓ admin@virelsy.app (password: ${adminPassword})`);

  // Demo members
  const demoPassword = await bcrypt.hash("demo-virelsy-2026", 12);
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
        passwordHash: demoPassword,
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
  console.log(`✓ ${DEMO_PROFILES.length} demo profiles (password: demo-virelsy-2026)`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
