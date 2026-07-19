import { ok, requireActiveAccount } from "@/lib/api";
import { listConversations } from "@/lib/services/chat";

export async function GET() {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const conversations = await listConversations(user.id);
  return ok(conversations);
}
