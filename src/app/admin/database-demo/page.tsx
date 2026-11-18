import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import DatabaseDemoPanel from "./DatabaseDemoPanel";

export const instant = false;

export default async function DatabaseDemoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");

  return (
    <main className="admin-page min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <Link href="/admin" className="text-sm font-medium text-blue-700 hover:underline">← Back to Admin Dashboard</Link>
          <p className="admin-eyebrow mt-5">DBMS LEVEL 3 · INTERACTIVE WALKTHROUGH</p>
          <h1 className="mt-2">Database Feature Lab</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Run the installed MySQL views, procedure, trigger, transaction, and index examples. Temporary paper changes are rolled back automatically.
          </p>
        </div>
        <DatabaseDemoPanel />
      </div>
    </main>
  );
}
