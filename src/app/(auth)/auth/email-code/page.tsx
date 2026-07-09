import { Suspense } from "react";
import type { Metadata } from "next";
import { EmailCodeStep } from "@/components/auth/EmailCodeStep";

export const metadata: Metadata = {
  title: "Enter your code - Tirvea",
};

export default function EmailCodePage() {
  // Suspense boundary for useSearchParams (the ?email=... carrier).
  return (
    <Suspense>
      <EmailCodeStep />
    </Suspense>
  );
}
