"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

type SearchMode = "keyword" | "semantic";
type Paper = {
  paper_id: number; title: string; abstract?: string | null;
  publication_year: number | null; venue: string | null;
  DOI?: string | null; doi?: string | null; similarity_score?: number;
};
type User = { email: string; role: "ADMIN" | "RESEARCHER" };
type Insights = {
  totals: { papers: number; authors: number; citations: number };
  years: { year: number; papers: number }[];
  venues: { venue: string; papers: number }[];
};
type FormValues = { title: string; abstract: string; publication_year: string; venue: string; doi: string; source_url: string };
const emptyForm: FormValues = { title: "", abstract: "", publication_year: "", venue: "", doi: "", source_url: "" };

export default function Home() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<SearchMode>("keyword");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data?.user) setUser(data.user); }).catch(() => undefined);
    fetch("/api/insights").then((response) => response.json())
      .then((data) => { if (data.success) setInsights(data); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (mode !== "keyword") return;
    const controller = new AbortController();
    async function loadPapers() {
      setLoading(true); setError("");
      try {
        const endpoint = search.trim() ? `/api/search?q=${encodeURIComponent(search.trim())}` : "/api/papers";
        const response = await fetch(endpoint, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "Unable to load papers.");
        setPapers(data.papers);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Could not load papers. Please try again."); setPapers([]);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    const timer = setTimeout(loadPapers, search.trim() ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, mode]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "keyword") return;
    if (!search.trim()) { setError("Enter a research query to find semantically related papers."); setPapers([]); setHasSearched(false); return; }
    setLoading(true); setError(""); setHasSearched(true);
    try {
      const response = await fetch("/api/semantic-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: search.trim(), top_k: 5 }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Semantic search failed.");
      setPapers(data.papers);
    } catch (err) { setPapers([]); setError(err instanceof Error ? err.message : "Unable to reach semantic search."); }
    finally { setLoading(false); }
  }

  function changeMode(next: SearchMode) { setMode(next); setPapers([]); setError(""); setHasSearched(false); setLoading(next === "keyword"); }
  function openCreate() { setEditingId(null); setForm(emptyForm); setNotice(""); setFormOpen(true); }
  async function openEdit(paper: Paper) {
    const response = await fetch(`/api/papers/${paper.paper_id}`);
    const data = await response.json();
    if (!response.ok || !data.paper) { setError(data.error || "Could not load the paper for editing."); return; }
    const fullPaper = data.paper as Paper & { source_url?: string | null };
    setEditingId(paper.paper_id);
    setForm({ title: fullPaper.title, abstract: fullPaper.abstract ?? "", publication_year: fullPaper.publication_year?.toString() ?? "", venue: fullPaper.venue ?? "", doi: fullPaper.doi ?? fullPaper.DOI ?? "", source_url: fullPaper.source_url ?? "" });
    setNotice(""); setFormOpen(true);
  }
  async function savePaper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setNotice("");
    try {
      const response = await fetch(editingId ? `/api/papers/${editingId}` : "/api/papers", {
        method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, publication_year: form.publication_year || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the paper.");
      setNotice(editingId ? "Paper updated." : "Paper added."); setForm(emptyForm); setEditingId(null);
      setFormOpen(false);
      setMode("keyword"); setSearch("");
      const [paperResponse, insightResponse] = await Promise.all([fetch("/api/papers"), fetch("/api/insights")]);
      const paperData = await paperResponse.json(); const insightData = await insightResponse.json();
      if (paperData.success) setPapers(paperData.papers);
      if (insightData.success) setInsights(insightData);
    } catch (err) { setNotice(err instanceof Error ? err.message : "Could not save the paper."); }
    finally { setSaving(false); }
  }
  async function deletePaper(paper: Paper) {
    if (!window.confirm(`Remove “${paper.title}” and its linked citation, author, topic, method, and embedding records?`)) return;
    const response = await fetch(`/api/papers/${paper.paper_id}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) { setError(data.error || "Could not delete this paper."); return; }
    setPapers((current) => current.filter((item) => item.paper_id !== paper.paper_id));
    setInsights((current) => current ? { ...current, totals: { ...current.totals, papers: Math.max(0, current.totals.papers - 1) } } : current);
  }
  async function signOut() {
    setSigningOut(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); setUser(null); }
    finally { setSigningOut(false); }
  }

  const maxYearCount = Math.max(1, ...(insights?.years.map((item) => item.papers) ?? [1]));
  return (
    <main className="atlas-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Research Atlas home"><span className="brand-mark">R<span>.</span></span><span><strong>Research Atlas</strong><small>Research network explorer</small></span></Link>
        <nav className="top-nav" aria-label="Main navigation"><a href="#explore">Explore</a><a href="#insights">Insights</a><a href="#database">Database</a>
          {user?.role === "ADMIN" && <Link href="/admin">Admin</Link>}
          {user ? <><span className="user-pill"><span className="status-dot" />{user.email}<span className="role-tag">{user.role}</span></span><button className="sign-out" type="button" disabled={signingOut} onClick={signOut}>{signingOut ? "Signing out…" : "Sign out"}</button></> : <Link className="sign-in" href="/login">Sign in <span aria-hidden="true">↗</span></Link>}
        </nav>
      </header>

      <section className="hero">
        <div className="hero-grain" />
        <div className="hero-copy"><div className="eyebrow light"><span className="eyebrow-dot" /> RESEARCH, CONNECTED</div>
          <h1>Every paper is<br />part of a <em>bigger</em> idea.</h1>
          <p>Explore publications, follow citation paths, and uncover ideas that connect across the research landscape.</p>
          <a className="hero-cta" href="#explore">Explore the collection <span>↓</span></a>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/><i className="node node-a"/><i className="node node-b"/><i className="node node-c"/><i className="node node-d"/><i className="node node-e"/><i className="node node-f"/><i className="node node-g"/><span className="orbit-label label-a">AI &amp; systems</span><span className="orbit-label label-b">new connections</span><span className="orbit-label label-c">ideas in motion</span><span className="orbit-center">R</span></div>
        <div className="hero-index">01 <span /> DISCOVER</div>
      </section>

      <section id="insights" className="metrics-wrap content-width"><div className="section-intro"><div><div className="eyebrow"><span className="eyebrow-dot" /> THE COLLECTION</div><h2>A living map of research.</h2></div><p>Live totals from the connected MySQL research dataset.</p></div>
        <div className="metrics-grid">{[
          { label: "Papers indexed", value: insights?.totals.papers, icon: "▤", note: "Research publications" },
          { label: "Researchers", value: insights?.totals.authors, icon: "◎", note: "Linked author profiles" },
          { label: "Citation links", value: insights?.totals.citations, icon: "↗", note: "Relationships mapped" },
        ].map((metric, index) => <article className="metric-card" key={metric.label}><div className="metric-top"><span className={`metric-icon icon-${index}`}>{metric.icon}</span><span className="metric-live"><i /> LIVE DATABASE</span></div><strong>{metric.value?.toLocaleString() ?? "—"}</strong><span className="metric-label">{metric.label}</span><span className="metric-note">{metric.note}</span></article>)}</div>
      </section>

      <section id="explore" className="explore-section content-width"><div className="section-intro explore-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> FIND YOUR NEXT CONNECTION</div><h2>Explore the literature.</h2></div><span className="section-count">01 / SEARCH</span></div>
        <div className="explorer-panel"><div className="search-side"><div className="mode-switch" role="group" aria-label="Search type"><button type="button" className={mode === "keyword" ? "selected" : ""} onClick={() => changeMode("keyword")} aria-pressed={mode === "keyword"}><span>⌕</span> Keyword</button><button type="button" className={mode === "semantic" ? "selected" : ""} onClick={() => changeMode("semantic")} aria-pressed={mode === "semantic"}><span>✳</span> Semantic <small>AI</small></button></div>
          <h3>{mode === "keyword" ? "What are you looking for?" : "Describe the idea."}</h3><p>{mode === "keyword" ? "Search titles, abstracts, authors and research topics." : "Find related work by meaning, even when the wording differs."}</p>
          <form onSubmit={handleSearch} className="search-form"><label className="search-input"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={mode === "semantic" ? 500 : 200} placeholder={mode === "keyword" ? "e.g. neural networks, climate..." : "e.g. How can AI support early diagnosis?"} aria-label="Research search query"/><kbd>↵</kbd></label>{mode === "semantic" && <button className="search-submit" type="submit" disabled={loading}>{loading ? "Searching…" : "Find connections →"}</button>}</form>
          <div className="search-hint"><span>⌘</span> {mode === "keyword" ? "Results update as you type" : "Powered by vector similarity"}<span className="hint-sep">·</span> Up to {mode === "keyword" ? "50" : "5"} results</div>
        </div>
        <aside className="search-aside"><div className="aside-mark">✳</div><span className="aside-kicker">SEARCH NOTE</span><h4>{mode === "keyword" ? "Words find papers." : "Ideas find each other."}</h4><p>{mode === "keyword" ? "Keyword search checks publication details and follows author and topic relationships." : "The model converts your query into a vector and retrieves nearby paper embeddings using cosine similarity."}</p><div className="aside-bottom"><span className="aside-pulse" /> {mode === "keyword" ? "MYSQL · RELATIONAL SEARCH" : "QDRANT · VECTOR SEARCH"}</div></aside></div>
      </section>

      <section className="results-section content-width"><div className="results-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> {mode === "semantic" ? "SEMANTIC MATCHES" : search.trim() ? "SEARCH RESULTS" : "RECENTLY ADDED"}</div><h2>{loading ? "Searching the collection…" : error ? "Search needs attention" : `${papers.length} ${papers.length === 1 ? "paper" : "papers"} ${search.trim() || hasSearched ? "found" : "to explore"}`}</h2></div><div className="results-tools">{user && <button className="add-paper" type="button" onClick={openCreate}><span>＋</span> Add paper</button>}<span className="sort-caption">SORTED BY <strong>{mode === "semantic" ? "RELEVANCE" : "RECENT"}</strong></span></div></div>
        {notice && <p className="inline-notice" role="status">{notice}</p>}{error && <p className="inline-error" role="alert">{error}</p>}
        {loading ? <div className="empty-state"><span className="loading-ring"/> Loading publications…</div> : papers.length === 0 ? <div className="empty-state"><span className="empty-icon">⌕</span><strong>{mode === "semantic" && !hasSearched ? "Your next connection starts with a question." : "No publications found."}</strong><span>{mode === "semantic" && !hasSearched ? "Describe a topic above and we’ll look for related work." : "Try another phrase or broaden your search."}</span></div> : <div className="paper-list">{papers.map((paper, index) => { const doi = paper.doi ?? paper.DOI; return <article className="paper-card" key={paper.paper_id}><div className="paper-number">{String(index + 1).padStart(2, "0")}</div><div className="paper-main"><div className="paper-meta"><span>{paper.publication_year ?? "YEAR N/A"}</span><i />{paper.venue || "Publication venue unavailable"}{mode === "semantic" && paper.similarity_score !== undefined && <span className="similarity">SIMILARITY {paper.similarity_score.toFixed(3)}</span>}</div><Link href={`/papers/${paper.paper_id}`} className="paper-title">{paper.title}</Link>{paper.abstract && <p className="paper-abstract">{paper.abstract}</p>}<div className="paper-actions"><Link href={`/papers/${paper.paper_id}`} className="detail-link">Explore paper <span>↗</span></Link>{doi && <a className="doi-link" href={doi.startsWith("http") ? doi : `https://doi.org/${doi}`} target="_blank" rel="noreferrer">DOI ↗</a>}</div></div><div className="paper-admin">{user && <button type="button" onClick={() => openEdit(paper)} aria-label={`Edit ${paper.title}`} title="Edit paper">Edit</button>}{user?.role === "ADMIN" && <button type="button" className="delete-action" onClick={() => deletePaper(paper)} aria-label={`Delete ${paper.title}`} title="Delete paper">Delete</button>}</div></article>; })}</div>}
        {!loading && papers.length > 0 && <div className="results-foot"><span>Showing {papers.length} {papers.length === 1 ? "result" : "results"}</span><span>RESEARCH ATLAS <i /> DATASET</span></div>}
      </section>

      <section id="database" className="database-section"><div className="content-width database-inner"><div className="database-copy"><div className="eyebrow light"><span className="eyebrow-dot" /> BUILT FOR DISCOVERY</div><h2>Connected data.<br /><em>Better questions.</em></h2><p>Research Atlas brings relational records and semantic retrieval together, so a publication can be explored through its people, topics, methods and citations.</p><Link href={user ? "#explore" : "/login"} className="database-link">{user ? "Manage the collection" : "Sign in to contribute"} <span>↗</span></Link></div><div className="database-visual"><div className="db-row"><span className="db-key">01</span><span className="db-icon">▤</span><strong>Paper</strong><span className="db-detail">title · abstract · year</span><span className="db-arrow">↔</span></div><div className="db-row"><span className="db-key">02</span><span className="db-icon">◎</span><strong>Author</strong><span className="db-detail">profiles · affiliations</span><span className="db-arrow">↔</span></div><div className="db-row"><span className="db-key">03</span><span className="db-icon">⌘</span><strong>Citation</strong><span className="db-detail">paper-to-paper links</span><span className="db-arrow">↔</span></div><div className="db-row vector-row"><span className="db-key">04</span><span className="db-icon">✳</span><strong>Vector index</strong><span className="db-detail">meaning · similarity</span><span className="db-arrow">↗</span></div><div className="db-caption"><span><i/> MySQL · TRANSACTIONS · JOINS</span><span>QDRANT · VECTOR SEARCH</span></div></div></div></section>

      <section className="trend-section content-width"><div className="section-intro"><div><div className="eyebrow"><span className="eyebrow-dot" /> COLLECTION PULSE</div><h2>Research, year by year.</h2></div><p>Publication counts grouped from the live collection.</p></div><div className="trend-card"><div className="trend-chart">{insights?.years.slice().reverse().map((item) => <div className="bar-column" key={item.year}><span className="bar-value">{item.papers}</span><div className="bar-track"><div className="bar-fill" style={{ height: `${Math.max(8, item.papers / maxYearCount * 100)}%` }}/></div><span className="bar-year">{item.year}</span></div>) ?? <div className="empty-chart">Connect MySQL to see yearly publication counts.</div>}</div><div className="trend-aside"><span className="trend-aside-icon">↗</span><strong>{insights?.years[0]?.year ?? "—"}</strong><span>Most recent year in the indexed collection</span><div className="top-venues"><span className="top-venues-label">TOP VENUES · 3+ PAPERS</span>{insights?.venues.slice(0, 3).map((venue, i) => <div key={venue.venue}><span>{String(i + 1).padStart(2, "0")}</span>{venue.venue}<strong>{venue.papers}</strong></div>) ?? <p>Venue insights will appear when data is available.</p>}</div></div></div></section>

      <footer className="site-footer"><Link className="brand footer-brand" href="/"><span className="brand-mark">R<span>.</span></span><span><strong>Research Atlas</strong><small>Ideas are connected.</small></span></Link><span>MYSQL <i/> QDRANT <i/> NEXT.JS</span><span>RESEARCH NETWORK EXPLORER <b>·</b> 2026</span></footer>

      {formOpen && user && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setFormOpen(false); setEditingId(null); setForm(emptyForm); } }}><section className="paper-modal" aria-labelledby="paper-form-title"><button type="button" className="modal-close" onClick={() => { setFormOpen(false); setEditingId(null); setForm(emptyForm); }} aria-label="Close form">×</button><div className="eyebrow"><span className="eyebrow-dot"/> {editingId ? "UPDATE RECORD" : "CONTRIBUTE"}</div><h2 id="paper-form-title">{editingId ? "Edit this paper." : "Add to the collection."}</h2><p>Required fields and publication year are validated before the database transaction.</p><form onSubmit={savePaper} className="paper-form"><label>Paper title<input required maxLength={1000} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Abstract<textarea rows={5} maxLength={50000} value={form.abstract} onChange={(event) => setForm({ ...form, abstract: event.target.value })}/></label><div className="form-row"><label>Year<input type="number" min={1000} max={2100} value={form.publication_year} onChange={(event) => setForm({ ...form, publication_year: event.target.value })} /></label><label>Venue<input maxLength={500} value={form.venue} onChange={(event) => setForm({ ...form, venue: event.target.value })}/></label></div><div className="form-row"><label>DOI<input maxLength={500} value={form.doi} onChange={(event) => setForm({ ...form, doi: event.target.value })}/></label><label>Source URL<input type="url" maxLength={2000} value={form.source_url} onChange={(event) => setForm({ ...form, source_url: event.target.value })}/></label></div><div className="form-footer"><span>SQL · TRANSACTIONAL WRITE</span><button className="search-submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes →" : "Add paper →"}</button></div></form></section></div>}
    </main>
  );
}
