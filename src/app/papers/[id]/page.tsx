import Link from "next/link";

type Paper = {
  paper_id: number;
  title: string;
  abstract: string | null;
  publication_year: number | null;
  venue: string | null;
  doi: string | null;
  source_url: string | null;
};

type Author = { author_id: number; name: string; affiliation: string | null };
type Topic = { topic_id: number; topic_name: string; confidence_score: number | null };
type RelatedPaper = { paper_id: number; title: string; publication_year: number | null };
type PaperResponse = {
  paper: Paper;
  authors: Author[];
  topics: Topic[];
  methods: { method_id: number; method_name: string }[];
  citation_stats: { incoming_citations: number; outgoing_citations: number };
  cited_by: RelatedPaper[];
  references: RelatedPaper[];
};

// This page uses the requested paper ID and live database data at request time.
export const instant = false;

async function getPaper(id: string): Promise<PaperResponse | null> {
  const appBaseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:4000";
  const response = await fetch(
    `${appBaseUrl.replace(/\/$/, "")}/api/papers/${encodeURIComponent(id)}`,
    { cache: "no-store" }
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data.success && data.paper ? data as PaperResponse : null;
}

export default async function PaperDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return <main className="p-8">Invalid paper ID.</main>;

  let data: PaperResponse | null;
  try {
    data = await getPaper(id);
  } catch (error) {
    console.error("Failed to load paper details:", error);
    throw error;
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <Link href="/" className="text-blue-700 hover:underline">← Back to research explorer</Link>
        <h1 className="mt-6 text-2xl font-bold">Paper not found</h1>
        <p className="mt-2 text-slate-600">Unable to load this paper. Check that the Next.js server and MySQL database are running.</p>
      </main>
    );
  }

  const { paper, authors, topics, methods, citation_stats, cited_by, references } = data;
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="text-sm font-medium text-blue-700 hover:underline">← Back to research explorer</Link>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-medium text-blue-700">{paper.publication_year ?? "Year unavailable"}{paper.venue ? ` · ${paper.venue}` : ""}</p>
          <h1 className="mt-3 text-3xl font-bold leading-tight">{paper.title}</h1>
          <p className="mt-4 text-slate-600">{authors.length ? authors.map((author) => author.name).join(", ") : "No author information available"}</p>

          {paper.abstract && <div className="mt-8">
            <h2 className="text-lg font-semibold">Abstract</h2>
            {paper.abstract.length > 1200 ? <>
              <p className="mt-2 whitespace-pre-line leading-7 text-slate-700">{paper.abstract.slice(0, 1200).trimEnd()}…</p>
              <details className="abstract-more mt-2">
                <summary>Show more</summary>
                <p className="mt-3 whitespace-pre-line leading-7 text-slate-700">{paper.abstract.slice(1200).trimStart()}</p>
              </details>
            </> : <p className="mt-2 whitespace-pre-line leading-7 text-slate-700">{paper.abstract}</p>}
          </div>}

          <div className="mt-6 flex flex-wrap gap-3">
            {paper.doi && <a href={paper.doi.startsWith("http") ? paper.doi : `https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer" className="rounded-lg bg-blue-50 px-4 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100">View DOI</a>}
            {paper.source_url && <a href={paper.source_url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50">Source paper</a>}
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">Cited by in this dataset</p><p className="mt-2 text-3xl font-bold">{citation_stats.incoming_citations}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">References in this dataset</p><p className="mt-2 text-3xl font-bold">{citation_stats.outgoing_citations}</p></div>
        </section>

        <section className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">Research topics</h2>
            {topics.length ? <ul className="mt-4 space-y-3">{topics.map((topic) => <li key={topic.topic_id} className="flex justify-between gap-4"><span>{topic.topic_name}</span><span className="shrink-0 text-sm text-slate-500">{topic.confidence_score == null ? "—" : `${(Number(topic.confidence_score) * 100).toFixed(1)}%`}</span></li>)}</ul> : <p className="mt-3 text-slate-500">No topics linked.</p>}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">Methods</h2>
            {methods.length ? <ul className="mt-4 list-inside list-disc space-y-2">{methods.map((method) => <li key={method.method_id}>{method.method_name}</li>)}</ul> : <p className="mt-3 text-slate-500">No methods linked.</p>}
          </div>
        </section>

        <section className="mt-6 grid gap-6 md:grid-cols-2">
          {[{ title: "Cited by", papers: cited_by }, { title: "References", papers: references }].map(({ title, papers }) => <div key={title} className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">{title}</h2>
            {papers.length ? <ul className="mt-4 space-y-4">{papers.map((related) => <li key={related.paper_id}><Link href={`/papers/${related.paper_id}`} className="font-medium text-blue-700 hover:underline">{related.title}</Link><p className="mt-1 text-sm text-slate-500">{related.publication_year ?? "Year unavailable"} · Paper ID {related.paper_id}</p></li>)}</ul> : <p className="mt-3 text-slate-500">No papers listed.</p>}
          </div>)}
        </section>
      </div>
    </main>
  );
}
