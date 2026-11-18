import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2";
import pool from "./db";

export type UserRole = "ADMIN" | "RESEARCHER";

export type AuthUser = {
  user_id: number;
  email: string;
  role: UserRole;
};

type UserRow = RowDataPacket & AuthUser & {
  password_hash?: string;
};

const COOKIE_NAME = "rne_session";
const SESSION_DURATION = 60 * 60 * 24 * 7;

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is missing or too short");
  }

  return new TextEncoder().encode(secret);
}

export async function createSession(userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) return null;

  let userId: number;

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });

    userId = Number(payload.sub);

    if (!Number.isSafeInteger(userId) || userId < 1) {
      return null;
    }
  } catch {
    return null;
  }

  const [rows] = await pool.execute<UserRow[]>(
    "SELECT user_id, email, role FROM `user` WHERE user_id = ? LIMIT 1",
    [userId]
  );

  if (rows.length === 0) return null;

  return {
    user_id: Number(rows[0].user_id),
    email: rows[0].email,
    role: rows[0].role,
  };
}

export async function requireRole(
  requiredRole: UserRole
): Promise<{ user: AuthUser | null; status: 401 | 403 | null }> {
  const user = await getCurrentUser();

  if (!user) return { user: null, status: 401 };
  if (user.role !== requiredRole) return { user, status: 403 };

  return { user, status: null };
}
