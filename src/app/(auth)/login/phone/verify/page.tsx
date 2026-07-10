import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { phoneLoginEnabled } from "@/lib/auth/phone";
import { PhoneLoginCode } from "@/components/auth/PhoneLoginCode";

export const metadata: Metadata = {
  title: "Enter your code - Tirvea",
};

// The flag is RUNTIME env - never bake it in at build time.
export const dynamic = "force-dynamic";

/**
 * Phone LOGIN, step 2: the SMS code. Flag off = the flow doesn't exist;
 * Suspense boundary for useSearchParams (the ?phone=E164 carrier).
 */
export default function PhoneLoginVerifyPage() {
  if (!phoneLoginEnabled()) redirect("/login");
  return (
    <Suspense>
      <PhoneLoginCode />
    </Suspense>
  );
}
