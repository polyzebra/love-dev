import { cn } from "@/lib/utils";

/**
 * Ambient light field — three slow-drifting blurred orbs plus a radial
 * key light and film grain. Pure CSS transforms (GPU only), fixed or
 * absolute, always behind content and inert to pointers.
 */
export function Aurora({
  className,
  fixed = false,
  intensity = "default",
}: {
  className?: string;
  fixed?: boolean;
  intensity?: "default" | "hero" | "faint";
}) {
  const opacity =
    intensity === "hero" ? "opacity-100" : intensity === "faint" ? "opacity-50" : "opacity-75";

  return (
    <div
      aria-hidden="true"
      className={cn(
        fixed ? "fixed" : "absolute",
        "inset-0 -z-10 overflow-hidden",
        opacity,
        className,
      )}
    >
      {/* Key light from above */}
      <div className="absolute inset-0 bg-[radial-gradient(80rem_50rem_at_50%_-20%,rgba(251,113,133,0.13),transparent_60%)]" />
      {/* Drifting orbs */}
      <div className="absolute left-[8%] top-[6%] size-[42rem] animate-aurora-a rounded-full bg-[radial-gradient(closest-side,rgba(225,29,72,0.22),transparent_70%)] blur-3xl" />
      <div className="absolute right-[4%] top-[28%] size-[36rem] animate-aurora-b rounded-full bg-[radial-gradient(closest-side,rgba(167,139,250,0.13),transparent_70%)] blur-3xl" />
      <div className="absolute bottom-[-10%] left-[30%] size-[40rem] animate-aurora-c rounded-full bg-[radial-gradient(closest-side,rgba(231,201,161,0.10),transparent_70%)] blur-3xl" />
      {/* Vignette to seat everything into the black */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_10%,transparent_50%,rgba(11,7,9,0.9)_100%)]" />
    </div>
  );
}
