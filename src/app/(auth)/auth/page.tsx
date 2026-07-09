import type { Metadata } from "next";
import { EmailInputStep } from "@/components/auth/EmailInputStep";

export const metadata: Metadata = {
  title: "Sign in - Tirvea",
  description: "Sign in or create your Tirvea account with just your email.",
};

export default function AuthPage() {
  return <EmailInputStep />;
}
