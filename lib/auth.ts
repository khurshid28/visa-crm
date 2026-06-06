import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "visa_crm_session";
const ALG = "HS256";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export type SessionPayload = {
  username: string;
  role: "admin";
};

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { username: String(payload.username), role: "admin" };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  return verifySession(token);
}

export function checkCredentials(username: string, password: string): boolean {
  const u = process.env.ADMIN_USERNAME ?? "admin";
  const p = process.env.ADMIN_PASSWORD ?? "admin123";
  return username === u && password === p;
}

/**
 * Slot yaratish uchun alohida super-login/parol (admin paroldan farqli).
 * Faqat slot ochish/qo'shish bunday himoyalanadi.
 */
export function checkSlotSuper(username: string, password: string): boolean {
  const u = process.env.SLOT_SUPER_USERNAME ?? "superadmin";
  const p = process.env.SLOT_SUPER_PASSWORD ?? "super123";
  return username === u && password === p;
}

export const SESSION_COOKIE = COOKIE_NAME;
