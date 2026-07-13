/**
 * Deployed build identifier - the git commit SHA on Vercel, "dev"
 * locally. Inlined at build time; used by the auth debug badge so a
 * device can PROVE which commit it is running.
 */
export const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
export const BUILD_ID_SHORT = BUILD_ID.slice(0, 7);
