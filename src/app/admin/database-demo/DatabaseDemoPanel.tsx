"use client";

import { useState } from "react";

type DemoAction = "ddl" | "dml" | "join" | "correlated" | "recursive" | "aggregate" | "view_details" | "view_authors" | "view_topics" | "view_citations" | "view_methods" | "procedure" | "trigger" | "transaction" | "index";
type DemoCard = { action: DemoAction; category: string; title: string; detail: string };

const coreDemos: DemoCard[] = [
  { action: "ddl", category: "DDL · CONSTRAINTS", title: "Table definitions", detail: "Inspect table DDL, keys, and constraints" },
  { action: "dml", category: "DML · TRANSACTION", title: "Insert, update, delete", detail: "Run all three on a temporary row, then roll back" },
  { action: "join", category: "JOIN · ORDER BY", title: "Papers and authors", detail: "Join related tables and sort the results" },
  { action: "correlated", category: "CORRELATED SUBQUERY", title: "Citation counts", detail: "Count citations for each paper row" },
  { action: "recursive", category: "RECURSIVE CTE", title: "Citation network", detail: "Follow citations up to three levels" },
  { action: "aggregate", category: "GROUP BY · HAVING", title: "Venue summary", detail: "Aggregate papers and filter groups" },
];

const advancedDemos: DemoCard[] = [
  { action: "view_details", category: "VIEW", title: "Paper details", detail: "Read from v_paper_details" },
  { action: "view_authors", category: "VIEW + JOIN", title: "Paper authors", detail: "Read from v_paper_authors" },
  { action: "view_topics", category: "VIEW + JOIN", title: "Paper topics", detail: "Read from v_paper_topics" },
  { action: "view_citations", category: "VIEW + SUBQUERY", title: "Citation statistics", detail: "Read from v_paper_citation_stats" },
  { action: "view_methods", category: "VIEW + JOIN", title: "Paper methods", detail: "Read from v_paper_methods" },
  { action: "procedure", category: "STORED PROCEDURE", title: "Get paper details", detail: "Call GetPaperDetails(paper_id)" },
  { action: "trigger", category: "TRIGGER + TRANSACTION", title: "Audit a title update", detail: "Show the audit event, then roll back" },
  { action: "transaction", category: "TRANSACTION", title: "Roll back an update", detail: "Compare the title before, during, and after" },
  { action: "index", category: "INDEX + EXPLAIN", title: "Inspect year lookup", detail: "Show the query plan for publication_year" },
];

export default function DatabaseDemoPanel() {
  const [paperId, setPaperId] = useState("6");
  const [busy, setBusy] = useState<DemoAction | null>(null);
  const [output, setOutput] = useState<{ title: string; sql?: string; result?: unknown; error?: string } | null>(null);

  function renderDemos(items: DemoCard[]) {
    return <div className="grid gap-3 sm:grid-cols-2">{items.map((demo) => {
      const requiresPaperId = ["procedure", "trigger", "transaction", "recursive"].includes(demo.action);
      const invalidPaperId = !Number.isSafeInteger(Number(paperId)) || Number(paperId) < 1;
      return (
        <article key={demo.action} className="rounded border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-bold tracking-[.14em] text-emerald-800">{demo.category}</p>
          <h2 className="mt-2 text-base font-semibold text-slate-900">{demo.title}</h2>
          <p className="mt-1 min-h-8 text-xs leading-5 text-slate-500">{demo.detail}</p>
          <button type="button" onClick={() => run(demo.action)} disabled={busy !== null || (requiresPaperId && invalidPaperId)} className="mt-3 rounded bg-emerald-900 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-50">
            {busy === demo.action ? "Running…" : "Run demo"}
          </button>
        </article>
      );
    })}</div>;
  }

  async function run(action: DemoAction) {
    setBusy(action);
    setOutput(null);
    try {
      const response = await fetch("/api/admin/database-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, paperId: Number(paperId) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The demonstration failed.");
      setOutput({ title: data.title, sql: data.sql, result: data.result });
    } catch (error) {
      setOutput({
        title: "Could not run demonstration",
        error: error instanceof Error ? error.message : "The demonstration failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(290px,.78fr)]">
      <section className="space-y-4">
        <div className="rounded border border-slate-200 bg-white p-5">
          <label htmlFor="demo-paper-id" className="block text-sm font-semibold text-slate-800">Paper ID for procedure and paper-network demos</label>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input id="demo-paper-id" type="number" min="1" value={paperId} onChange={(event) => setPaperId(event.target.value)} className="h-10 w-32 rounded border border-slate-300 px-3 text-sm" />
            <span className="text-xs text-slate-500">The update demos always roll back.</span>
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">SQL operations & queries</h2>
          {renderDemos(coreDemos)}
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Advanced database features</h2>
          {renderDemos(advancedDemos)}
        </div>
      </section>

      <aside className="min-w-0 rounded border border-slate-200 bg-white p-5" aria-live="polite">
        <p className="text-[10px] font-bold tracking-[.14em] text-slate-500">LIVE RESULT</p>
        {!output ? (
          <div className="mt-5 text-sm leading-6 text-slate-500">Choose a feature to run it against the connected MySQL database. Results and the example SQL will appear here.</div>
        ) : (
          <>
            <h2 className="mt-3 text-lg font-semibold text-slate-900">{output.title}</h2>
            {output.sql && <pre className="mt-4 overflow-x-auto rounded bg-slate-950 p-3 text-[11px] leading-5 text-emerald-100"><code>{output.sql}</code></pre>}
            {output.error ? <p className="mt-4 rounded bg-red-50 p-3 text-sm leading-6 text-red-800">{output.error}</p> : <pre className="mt-4 max-h-[520px] overflow-auto rounded bg-slate-50 p-3 text-[11px] leading-5 text-slate-700"><code>{JSON.stringify(output.result, null, 2)}</code></pre>}
          </>
        )}
        <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">Procedure access may require an <code>EXECUTE</code> grant for the app’s MySQL account. Demo update actions use a transaction and do not leave paper or audit changes behind.</p>
      </aside>
    </div>
  );
}
