import { Suspense } from "react";
import { AuthStepFallback } from "@/components/auth/AuthStepFallback";
import type { Metadata } from "next";
import { PhoneCodeStep } from "@/components/auth/PhoneCodeStep";

export const metadata: Metadata = {
  title: "Enter your code - Tirvea",
};

export default function PhoneCodePage() {
  // Suspense boundary for useSearchParams (the ?phone=... carrier).
  return (
    <Suspense fallback={<AuthStepFallback />}>
      <PhoneCodeStep />
    </Suspense>
  );
}
