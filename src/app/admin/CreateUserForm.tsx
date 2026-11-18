"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateUserForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"RESEARCHER" | "ADMIN">("RESEARCHER");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create this account.");
      setEmail(""); setPassword(""); setRole("RESEARCHER");
      setMessage(`Created ${data.user.email} as ${data.user.role}.`); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create this account."); }
    finally { setSaving(false); }
  }

  return <section className="admin-create-card"><div><span className="admin-eyebrow">ACCOUNT MANAGEMENT</span><h2>Create an account</h2><p>Choose a role with access appropriate to the research workspace.</p></div>
    <form onSubmit={submit} className="admin-user-form"><label>Email<input type="email" required maxLength={320} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="researcher@university.edu"/></label><label>Temporary password<input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters"/></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value as "RESEARCHER" | "ADMIN")}><option value="RESEARCHER">Researcher</option><option value="ADMIN">Admin</option></select></label><button disabled={saving}>{saving ? "Creating…" : "Create account →"}</button></form>
    {message && <p className="admin-form-message" role="status">{message}</p>}
  </section>;
}
