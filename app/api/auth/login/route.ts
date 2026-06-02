import { NextRequest, NextResponse } from "next/server";
import { checkCredentials, createSession, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const username = String(body?.username ?? "");
  const password = String(body?.password ?? "");

  if (!checkCredentials(username, password)) {
    return NextResponse.json(
      { error: "Login yoki parol noto'g'ri" },
      { status: 401 },
    );
  }

  const token = await createSession({ username, role: "admin" });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
