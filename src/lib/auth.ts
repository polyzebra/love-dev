import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { verifyPassword } from "@/lib/passwords";
import { loginSchema } from "@/lib/validators/auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  providers: [
    ...authConfig.providers,
    Credentials({
      name: "Email & password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // Brute-force protection per account identifier
        const rl = await rateLimit(`login:${email}`, RATE_LIMITS.login);
        if (!rl.ok) return null;

        const user = await db.user.findUnique({
          where: { email },
          include: { profile: { select: { id: true } } },
        });
        if (!user?.passwordHash) return null;
        if (user.status === "SUSPENDED" || user.status === "DELETED") return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        await db.user.update({
          where: { id: user.id },
          data: { lastActiveAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          onboardingDone: user.onboardingDone,
        };
      },
    }),
  ],
  events: {
    async signIn({ user }) {
      if (user.id) {
        await db.user
          .update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
          .catch(() => {});
      }
    },
  },
});

/** Server-side helper: current user or null. */
export async function currentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/** Server-side helper: throws a redirect-friendly error when unauthenticated. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
