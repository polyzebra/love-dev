/**
 * The quiet one-line note under a settings card - used for honest
 * transport status ("delivery will activate when...") so the UI
 * never claims more than the product does.
 */
export function SettingsNote({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground/80 mt-3 px-1 text-xs leading-relaxed">{children}</p>;
}
