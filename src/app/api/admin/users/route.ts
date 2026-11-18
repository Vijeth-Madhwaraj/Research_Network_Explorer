import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { RowDataPacket, FieldPacket, ResultSetHeader } from "mysql2";
import pool from "@/lib/db";
import { requireRole } from "@/lib/auth";



type EmailCheckRow = RowDataPacket & { cnt: number };

// POST /api/admin/users  — Admin creates a new user account
export async function POST(request: Request) {
  // ── Auth: Admin only ──────────────────────────────────────────────────────
  const access = await requireRole("ADMIN");

  if (!access.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }
  if (access.status === 403) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  // ── Parse & validate body ─────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("email" in body) ||
    !("password" in body)
  ) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  const raw = body as Record<string, unknown>;

  const email =
    typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const password = typeof raw.password === "string" ? raw.password : "";
  const role =
    raw.role === "ADMIN" || raw.role === "RESEARCHER" ? raw.role : "RESEARCHER";

  // Email format validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return NextResponse.json(
      { error: "A valid email address (max 320 chars) is required" },
      { status: 400 }
    );
  }

  // Password strength validation
  if (!password || password.length < 8 || password.length > 128) {
    return NextResponse.json(
      { error: "Password must be 8–128 characters" },
      { status: 400 }
    );
  }

  // ── Duplicate email check ─────────────────────────────────────────────────
  const checkResult = await pool.execute<EmailCheckRow[]>(
    "SELECT COUNT(*) AS cnt FROM `user` WHERE email = ?",
    [email]
  );
  const checkRows = (checkResult as [EmailCheckRow[], FieldPacket[]])[0];
  if (Number(checkRows[0].cnt) > 0) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 }
    );
  }

  // ── Hash password & insert ────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(password, 12);

  const insertResult = await pool.execute<ResultSetHeader>(
    "INSERT INTO `user` (email, password_hash, role) VALUES (?, ?, ?)",
    [email, passwordHash, role]
  );
  const insertHeader = (insertResult as [ResultSetHeader, FieldPacket[]])[0];

  return NextResponse.json(
    {
      success: true,
      user: {
        user_id: insertHeader.insertId,
        email,
        role,
      },
    },
    { status: 201 }
  );
}
