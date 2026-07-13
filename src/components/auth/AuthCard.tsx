/**
 * THE glass auth card. Owned by CONTENT, never by a shared parent:
 * real-device evidence (iPhone Safari, build 83f4616) proved the App
 * Router can commit a layout whose child slot is momentarily NULL
 * during navigation - a Suspense around that slot renders nothing (it
 * only shows its fallback for SUSPENDING subtrees), so a card drawn by
 * the layout painted visibly EMPTY. Every auth surface (step shells,
 * the login entry, route fallbacks, standalone pages) therefore renders
 * its OWN card around its own content: a card without content is
 * impossible by construction.
 */
export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div data-debug="auth-card" className="glass w-full max-w-md rounded-2xl p-7 sm:p-10">
      {children}
    </div>
  );
}
