
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { validatePaper } from "@/lib/paper-validation";
import type { ResultSetHeader } from "mysql2/promise";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;

  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) {
    return NextResponse.json(
      { success: false, error: "Invalid paper ID." },
      { status: 400 }
    );
  }

  try {
    const [paperRows] = await pool.execute(
      `SELECT
         paper_id,
         title,
         abstract,
         publication_year,
         venue,
         doi,
         source_url,
         openalex_id,
         created_at,
         updated_at
       FROM paper
       WHERE paper_id = ?`,
      [id]
    );

    const papers = paperRows as Record<string, unknown>[];

    if (papers.length === 0) {
      return NextResponse.json(
        { success: false, error: "Paper not found." },
        { status: 404 }
      );
    }

    const [authorRows] = await pool.execute(
      `SELECT a.author_id, a.name, a.affiliation, a.country, pa.author_order
       FROM paper_author pa
       JOIN author a ON a.author_id = pa.author_id
       WHERE pa.paper_id = ?
       ORDER BY pa.author_order, a.name`,
      [id]
    );

    const [topicRows] = await pool.execute(
      `SELECT t.topic_id, t.topic_name, pt.confidence_score
       FROM paper_topic pt
       JOIN topic t ON t.topic_id = pt.topic_id
       WHERE pt.paper_id = ?
       ORDER BY pt.confidence_score DESC, t.topic_name`,
      [id]
    );

    const [methodRows] = await pool.execute(
      `SELECT m.method_id, m.method_name, m.description, pm.evidence_note
       FROM paper_method pm
       JOIN method m ON m.method_id = pm.method_id
       WHERE pm.paper_id = ?
       ORDER BY m.method_name`,
      [id]
    );

    const [citationRows] = await pool.execute(
      `SELECT
         (SELECT COUNT(*)
          FROM citation c
          WHERE c.cited_paper_id = p.paper_id) AS incoming_citations,
         (SELECT COUNT(*)
          FROM citation c
          WHERE c.citing_paper_id = p.paper_id) AS outgoing_citations
       FROM paper p
       WHERE p.paper_id = ?`,
      [id]
    );

    const [citedByRows] = await pool.execute(
      `SELECT p.paper_id, p.title, p.publication_year
       FROM citation c
       JOIN paper p ON p.paper_id = c.citing_paper_id
       WHERE c.cited_paper_id = ?
       ORDER BY p.publication_year DESC, p.paper_id DESC
       LIMIT 50`,
      [id]
    );

    const [referencesRows] = await pool.execute(
      `SELECT p.paper_id, p.title, p.publication_year
       FROM citation c
       JOIN paper p ON p.paper_id = c.cited_paper_id
       WHERE c.citing_paper_id = ?
       ORDER BY p.publication_year DESC, p.paper_id DESC
       LIMIT 50`,
      [id]
    );

    return NextResponse.json({
      success: true,
      paper: papers[0],
      authors: authorRows,
      topics: topicRows,
      methods: methodRows,
      citation_stats: (citationRows as Record<string, unknown>[])[0],
      cited_by: citedByRows,
      references: referencesRows,
    });
  } catch (error) {
    console.error("Failed to fetch paper details:", error);

    return NextResponse.json(
      { success: false, error: "Unable to fetch paper details." },
      { status: 500 }
    );
  }
}

async function validId(context: RouteContext) {
  const { id } = await context.params;
  return /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Sign in to edit a paper." }, { status: 401 });
  const paperId = await validId(context);
  if (!paperId) return NextResponse.json({ success: false, error: "Invalid paper ID." }, { status: 400 });
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 }); }
  const checked = validatePaper(body);
  if ("error" in checked) return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
  try {
    const [result] = await pool.execute<ResultSetHeader>(
      "UPDATE paper SET title = ?, abstract = ?, publication_year = ?, venue = ?, doi = ?, source_url = ? WHERE paper_id = ?",
      [checked.value.title, checked.value.abstract, checked.value.year, checked.value.venue, checked.value.doi, checked.value.sourceUrl, paperId]
    );
    if (!result.affectedRows) return NextResponse.json({ success: false, error: "Paper not found." }, { status: 404 });
    return NextResponse.json({ success: true, paper_id: paperId });
  } catch (error) {
    console.error("Paper update failed:", error);
    return NextResponse.json({ success: false, error: "Unable to update this paper." }, { status: 500 });
  }
}

// Only admins may remove shared research records. Child rows are deleted in a
// transaction so a failure never leaves a partly removed research network.
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Sign in to remove a paper." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ success: false, error: "Admin access is required to remove papers." }, { status: 403 });
  const paperId = await validId(context);
  if (!paperId) return NextResponse.json({ success: false, error: "Invalid paper ID." }, { status: 400 });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("DELETE FROM citation WHERE citing_paper_id = ? OR cited_paper_id = ?", [paperId, paperId]);
    await connection.execute("DELETE FROM paper_author WHERE paper_id = ?", [paperId]);
    await connection.execute("DELETE FROM paper_topic WHERE paper_id = ?", [paperId]);
    await connection.execute("DELETE FROM paper_method WHERE paper_id = ?", [paperId]);
    await connection.execute("DELETE FROM paper_embedding WHERE paper_id = ?", [paperId]);
    const [result] = await connection.execute<ResultSetHeader>("DELETE FROM paper WHERE paper_id = ?", [paperId]);
    if (!result.affectedRows) {
      await connection.rollback();
      return NextResponse.json({ success: false, error: "Paper not found." }, { status: 404 });
    }
    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error("Paper delete failed:", error);
    return NextResponse.json({ success: false, error: "Unable to remove this paper." }, { status: 500 });
  } finally { connection.release(); }
}
