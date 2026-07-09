import type { Metadata } from "next";
import { PhoneInputStep } from "@/components/auth/PhoneInputStep";

export const metadata: Metadata = {
  title: "Verify your number - Tirvea",
};

export default function PhonePage() {
  return <PhoneInputStep />;
}
