import { getMessages, getMyMentions, createMessage, parseMentions } from "@/services/messages";
import { messageSchema, apiResponse, apiError, validationError } from "@/lib/validation";
import { getSession } from "@/lib/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const context_type = url.searchParams.get("context_type") || undefined;
  const context_id = url.searchParams.get("context_id") || undefined;
  const mentions = url.searchParams.get("mentions") || undefined;

  try {
    if (mentions) {
      const messages = await getMyMentions(mentions);
      return apiResponse({ messages });
    }
    const messages = await getMessages({ context_type, context_id });
    return apiResponse({ messages });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const body = await req.json();
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  // Auto-parse mentions from content if not provided
  const mentions = parsed.data.mentions?.length
    ? parsed.data.mentions
    : parseMentions(parsed.data.content);

  try {
    const message = await createMessage({
      author_email: session.email,
      author_name: session.name || session.email.split("@")[0],
      content: parsed.data.content,
      context_type: parsed.data.context_type,
      context_id: parsed.data.context_id,
      context_summary: parsed.data.context_summary,
      context_url: parsed.data.context_url,
      parent_id: parsed.data.parent_id,
      mentions,
    });
    return apiResponse({ message }, 201);
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}
