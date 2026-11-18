
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (q.length > 200) {
    return NextResponse.json(
      { success: false, error: "Search query is too long." },
      { status: 400 }
    );
  }

  try {
    const term = `%${q}%`;

    const [rows] = await pool.execute(
      `SELECT
         p.paper_id,
         p.title,
         p.abstract,
         p.publication_year,
         p.venue,
         p.doi AS DOI
       FROM paper p
       WHERE (
         ? = ''
         OR p.title LIKE ?
         OR p.abstract LIKE ?
         OR EXISTS (
           SELECT 1
           FROM paper_author pa
           JOIN author a ON a.author_id = pa.author_id
           WHERE pa.paper_id = p.paper_id
             AND a.name LIKE ?
         )
         OR EXISTS (
           SELECT 1
           FROM paper_topic pt
           JOIN topic t ON t.topic_id = pt.topic_id
           WHERE pt.paper_id = p.paper_id
             AND t.topic_name LIKE ?
         )
       )
       ORDER BY p.publication_year DESC, p.paper_id DESC
       LIMIT 50`,
      [q, term, term, term, term]
    );

    return NextResponse.json({
      success: true,
      count: (rows as unknown[]).length,
      papers: rows,
    });
  } catch (error) {
    console.error("Research search failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to search the research database." },
      { status: 500 }
    );
  }
}
