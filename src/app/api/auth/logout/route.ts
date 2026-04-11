import { cookies } from "next/headers";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  cookieStore.delete("braiin_session");
  return Response.redirect(new URL("/", req.url), 302);
}
