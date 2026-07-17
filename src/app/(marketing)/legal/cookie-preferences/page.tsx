import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cookie Preferences" };

export default function CookiePreferencesPage() {
  return (
    <>
      <h1>Cookie Preferences</h1>
      <p>
        Manage how Tirvea uses non-essential cookies. Essential cookies are always on because the
        service cannot function without them. The preference controls are being finalised.
      </p>
      <p>
        To understand each category of cookie we use, see the Cookie Policy. For how cookie data fits
        into your wider privacy rights, see the Privacy Policy.
      </p>
    </>
  );
}
