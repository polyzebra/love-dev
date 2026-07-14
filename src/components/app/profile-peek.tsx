"use client";

import { BadgeCheck, MapPin, Sparkles } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { OnlineDot } from "@/components/shared/online-dot";
import { initialsOf } from "@/lib/utils";

export type PeekProfile = {
  displayName: string;
  age: number | null;
  city: string | null;
  bio: string | null;
  interests: string[];
  sharedInterests: string[];
  isVerified: boolean;
  isOnline: boolean;
  photoUrl?: string | null;
  sameCity?: string | null;
};

/**
 * Bottom-sheet profile preview inside a conversation - tap the header
 * to remember who you're talking to without leaving the thread.
 */
export function ProfilePeek({
  profile,
  children,
}: {
  profile: PeekProfile;
  children: React.ReactNode;
}) {
  return (
    <Drawer>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent className="border-border bg-popover/95 backdrop-blur-2xl">
        <DrawerHeader className="items-center text-center">
          <div className="relative mx-auto mb-2">
            <Avatar className="border-border shadow-float size-24 border-2">
              <AvatarImage src={profile.photoUrl ?? undefined} alt="" />
              <AvatarFallback className="text-2xl">
                {initialsOf(profile.displayName)}
              </AvatarFallback>
            </Avatar>
            <OnlineDot online={profile.isOnline} className="absolute right-1 bottom-1" />
          </div>
          <DrawerTitle className="font-display flex items-center justify-center gap-2 text-2xl font-medium">
            {profile.displayName}
            {profile.age ? `, ${profile.age}` : ""}
            {profile.isVerified && (
              <BadgeCheck
                className="text-popover size-5 fill-sky-400"
                aria-label="Photo verified"
              />
            )}
          </DrawerTitle>
          {profile.city && (
            <DrawerDescription className="flex items-center justify-center gap-1">
              <MapPin className="size-3.5" aria-hidden="true" />
              {profile.city}
            </DrawerDescription>
          )}
        </DrawerHeader>

        <div className="space-y-6 px-6 pb-10">
          {profile.bio && (
            <p className="font-display text-foreground/90 text-center text-lg leading-relaxed whitespace-pre-wrap italic">
              &ldquo;{profile.bio}&rdquo;
            </p>
          )}

          {/* About you two - only real, shared ground */}
          {(profile.sharedInterests.length > 0 || profile.sameCity || profile.isVerified) && (
            <div className="glass rounded-3xl p-5 text-center">
              <p className="text-gold mb-3 flex items-center justify-center gap-1.5 text-xs font-semibold tracking-[0.2em] uppercase">
                <Sparkles className="size-3.5" aria-hidden="true" /> About you two
              </p>
              <ul className="text-foreground/90 space-y-2 text-sm">
                {profile.sameCity && (
                  <li>
                    You&apos;re both in <span className="font-medium">{profile.sameCity}</span>
                  </li>
                )}
                {profile.sharedInterests.length > 0 && (
                  <li className="flex flex-wrap items-center justify-center gap-1.5">
                    <span>You both love</span>
                    {profile.sharedInterests.map((interest) => (
                      <span
                        key={interest}
                        className="bg-primary/15 text-primary-soft rounded-full px-3 py-1 text-xs font-medium"
                      >
                        {interest}
                      </span>
                    ))}
                  </li>
                )}
                {profile.isVerified && (
                  <li className="text-muted-foreground">
                    {/* Explicit string: the compiler strips the leading space
                        of JSX text following an expression at a line end. */}
                    {profile.displayName}
                    {" passed photo verification"}
                  </li>
                )}
              </ul>
            </div>
          )}

          {profile.interests.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {profile.interests.map((interest) => (
                <span
                  key={interest}
                  className="glass-chip text-foreground/85 rounded-full px-3 py-1 text-xs"
                >
                  {interest}
                </span>
              ))}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
