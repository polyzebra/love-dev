import { redirect } from "next/navigation";

/** Registration now happens in the step auth flow. */
export default function RegisterPage() {
  redirect("/login");
}
