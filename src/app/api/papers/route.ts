
import { connection, NextResponse } from "next/server";
import type { RowDataPacket, FieldPacket } from "mysql2";
import pool from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import type { ResultSetHeader } from "mysql2/promise";
import { validatePaper, type PaperInput } from "@/lib/paper-validation";

type PaperRow = RowDataPacket & {
  paper_id: number;
  title: string;
  publication_year: number | null;
  venue: string | null;
  DOI: string | null;
};

export async function GET() {
  await connection();
  try {
    const result = await pool.execute<PaperRow[]>(
      `SELECT paper_id, title, publication_year, venue, DOI
       FROM paper
       ORDER BY publication_year DESC, paper_id DESC
       LIMIT 20`
    );
    const rows: PaperRow[] = (result as [PaperRow[], FieldPacket[]])[0];

    return NextResponse.json({
      success: true,
      count: rows.length,
      papers: rows,
    });
  } catch (error) {
    console.error("Failed to fetch papers:", error);

    return NextResponse.json(
      { success: false, error: "Unable to fetch papers from the database." },
      { status: 500 }
    );
  }
}

// Researchers and admins may add papers. Validation is repeated in the API
// and the database guard trigger documented in database/advanced_features.sql.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Sign in to add a paper." }, { status: 401 });
  let body: PaperInput;
  try { body = await request.json() as PaperInput; }
  catch { return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 }); }
  const checked = validatePaper(body);
  if ("error" in checked) return NextResponse.json({ success: false, error: checked.error }, { status: 400 });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO paper (title, abstract, publication_year, venue, doi, source_url) VALUES (?, ?, ?, ?, ?, ?)",
      [checked.value.title, checked.value.abstract, checked.value.year, checked.value.venue, checked.value.doi, checked.value.sourceUrl]
    );
    await connection.commit();
    return NextResponse.json({ success: true, paper_id: result.insertId }, { status: 201 });
  } catch (error) {
    await connection.rollback();
    console.error("Paper insert failed:", error);
    return NextResponse.json({ success: false, error: "Unable to save this paper." }, { status: 500 });
  } finally { connection.release(); }
}
