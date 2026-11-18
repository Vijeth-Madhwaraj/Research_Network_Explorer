import { connection, NextResponse } from "next/server";
import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2";

type CountRow = RowDataPacket & { total: number | string };
type YearRow = RowDataPacket & { year: number | null; papers: number | string };
type VenueRow = RowDataPacket & { venue: string; papers: number | string };

export async function GET() {
  await connection();
  try {
    const [[paperRows], [authorRows], [citationRows], [yearRows], [venueRows]] = await Promise.all([
      pool.execute<CountRow[]>("SELECT COUNT(*) AS total FROM paper"),
      pool.execute<CountRow[]>("SELECT COUNT(*) AS total FROM author"),
      pool.execute<CountRow[]>("SELECT COUNT(*) AS total FROM citation"),
      pool.execute<YearRow[]>("SELECT publication_year AS year, COUNT(*) AS papers FROM paper WHERE publication_year IS NOT NULL GROUP BY publication_year ORDER BY publication_year DESC LIMIT 8"),
      pool.execute<VenueRow[]>("SELECT venue, COUNT(*) AS papers FROM paper WHERE venue IS NOT NULL AND TRIM(venue) <> '' GROUP BY venue HAVING COUNT(*) >= 3 ORDER BY papers DESC, venue ASC LIMIT 5"),
    ]);
    return NextResponse.json({
      success: true,
      totals: { papers: Number(paperRows[0]?.total ?? 0), authors: Number(authorRows[0]?.total ?? 0), citations: Number(citationRows[0]?.total ?? 0) },
      years: yearRows.map((row) => ({ year: row.year, papers: Number(row.papers) })),
      venues: venueRows.map((row) => ({ venue: row.venue, papers: Number(row.papers) })),
    });
  } catch (error) {
    console.error("Research insights failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load research insights." }, { status: 500 });
  }
}
