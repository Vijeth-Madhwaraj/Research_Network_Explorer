import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2";
import type { FieldPacket } from "mysql2";
import LogoutButton from "./LogoutButton";
import CreateUserForm from "./CreateUserForm";

// The admin screen depends on the session cookie and live database records.
export const instant = false;

type UserRow = RowDataPacket & {
  user_id: number;
  email: string;
  role: "ADMIN" | "RESEARCHER";
  created_at: string;
};

async function getUsers(): Promise<UserRow[]> {
  const result = await pool.execute<UserRow[]>(
    "SELECT user_id, email, role, created_at FROM `user` ORDER BY user_id"
  );
  return (result as [UserRow[], FieldPacket[]])[0];
}

export default async function AdminPage() {
  const user = await getCurrentUser();

  // Only ADMINs may view this page
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "ADMIN") {
    redirect("/");
  }

  const users = await getUsers();

  return (
    <main className="admin-page min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <Link
              href="/"
              className="text-sm font-medium text-blue-700 hover:underline"
            >
              ← Back to Explorer
            </Link>
            <h1 className="mt-2 text-3xl font-bold">Admin Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">
              Signed in as <span className="font-medium">{user.email}</span>{" "}
              (Admin)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/admin/database-demo" className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
              Database Feature Lab
            </Link>
            <LogoutButton />
          </div>
        </div>

        {/* Stats */}
        <section className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            {
              label: "Total users",
              value: users.length,
              detail: "All registered accounts",
            },
            {
              label: "Admins",
              value: users.filter((u) => u.role === "ADMIN").length,
              detail: "Administrator accounts",
            },
            {
              label: "Researchers",
              value: users.filter((u) => u.role === "RESEARCHER").length,
              detail: "Researcher accounts",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-slate-200 bg-white p-5"
            >
              <p className="text-sm text-slate-500">{stat.label}</p>
              <p className="mt-2 text-3xl font-bold">{stat.value}</p>
              <p className="mt-1 text-sm text-slate-500">{stat.detail}</p>
            </div>
          ))}
        </section>

        <CreateUserForm />

        {/* User Table */}
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-6">
            <h2 className="text-lg font-semibold">Registered Users</h2>
            <p className="mt-1 text-sm text-slate-500">
              All accounts in the system with their roles.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-6 py-3">ID</th>
                  <th className="px-6 py-3">Email</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr
                    key={u.user_id}
                    className="transition hover:bg-slate-50"
                  >
                    <td className="px-6 py-4 text-slate-400">{u.user_id}</td>
                    <td className="px-6 py-4 font-medium">{u.email}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          u.role === "ADMIN"
                            ? "bg-red-50 text-red-700"
                            : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
