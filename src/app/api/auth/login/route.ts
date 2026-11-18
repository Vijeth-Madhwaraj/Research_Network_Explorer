import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { createSession, setSessionCookie, type UserRole } from "@/lib/auth";



type LoginRow = RowDataPacket & {
  user_id: number;
  email: string;
  password_hash: string;
  role: UserRole;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (
      !email ||
      email.length > 320 ||
      !password ||
      password.length > 128
    ) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 400 }
      );
    }

    const [rows] = await pool.execute<LoginRow[]>(
      "SELECT user_id, email, password_hash, role FROM `user` WHERE email = ? LIMIT 1",
      [email]
    );

    if (
      rows.length === 0 ||
      !(await bcrypt.compare(password, rows[0].password_hash))
    ) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const user = rows[0];
    const token = await createSession(Number(user.user_id));
    await setSessionCookie(token);

    return NextResponse.json({
      success: true,
      user: {
        user_id: Number(user.user_id),
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Unable to process login" },
      { status: 500 }
    );
  }
}
