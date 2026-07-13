import { cn } from "@/lib/utils";

/**
 * Ambient light field - three slow-drifting blurred orbs plus a radial
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
      <div className="animate-aurora-a absolute top-[6%] left-[8%] size-[42rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--primary)_22%,transparent),transparent_70%)] blur-3xl" />
      <div className="animate-aurora-b absolute top-[28%] right-[4%] size-[36rem] rounded-full bg-[radial-gradient(closest-side,rgba(167,139,250,0.13),transparent_70%)] blur-3xl" />
      <div className="animate-aurora-c absolute bottom-[-10%] left-[30%] size-[40rem] rounded-full bg-[radial-gradient(closest-side,rgba(231,201,161,0.10),transparent_70%)] blur-3xl" />
      {/* Vignette to seat everything into the page surface */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_10%,transparent_50%,color-mix(in_oklab,var(--background)_90%,transparent)_100%)]" />
    </div>
  );
}
