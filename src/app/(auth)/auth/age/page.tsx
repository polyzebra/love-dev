import type { Metadata } from "next";
import { AgeConfirmStep } from "@/components/auth/AgeConfirmStep";

export const metadata: Metadata = {
  title: "Confirm your age - Tirvea",
};

export default function AgePage() {
  return <AgeConfirmStep />;
}
