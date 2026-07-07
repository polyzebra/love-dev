"use client";

import { signOutEverywhere } from "@/components/auth/sign-out";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button
      variant="outline"
      size="lg"
      className="h-12 w-full rounded-3xl"
      onClick={() => void signOutEverywhere("/")}
    >
      <LogOut className="size-4" aria-hidden="true" />
      Sign out
    </Button>
  );
}
