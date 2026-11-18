import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { requireRole } from "@/lib/auth";

const viewQueries = {
  view_details: {
    title: "v_paper_details",
    sql: "SELECT * FROM v_paper_details ORDER BY paper_id DESC LIMIT 5",
  },
  view_authors: {
    title: "v_paper_authors",
    sql: "SELECT * FROM v_paper_authors ORDER BY paper_id DESC, author_order LIMIT 5",
  },
  view_topics: {
    title: "v_paper_topics",
    sql: "SELECT * FROM v_paper_topics ORDER BY paper_id DESC LIMIT 5",
  },
  view_citations: {
    title: "v_paper_citation_stats",
    sql: "SELECT * FROM v_paper_citation_stats ORDER BY incoming_citations DESC LIMIT 5",
  },
  view_methods: {
    title: "v_paper_methods",
    sql: "SELECT * FROM v_paper_methods ORDER BY paper_id DESC LIMIT 5",
  },
} as const;

type ViewAction = keyof typeof viewQueries;
type DemoAction = ViewAction | "procedure" | "trigger" | "transaction" | "index";
type DemoRow = RowDataPacket & Record<string, unknown>;

function isDemoAction(value: unknown): value is DemoAction {
  return typeof value === "string" && (
    Object.prototype.hasOwnProperty.call(viewQueries, value) ||
    value === "procedure" ||
    value === "trigger" ||
    value === "transaction" ||
    value === "index"
  );
}

function validPaperId(value: unknown): number | null {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function POST(request: Request) {
  const access = await requireRole("ADMIN");
  if (!access.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (access.status === 403) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("action" in body)) {
    return NextResponse.json({ error: "Choose a database demonstration." }, { status: 400 });
  }

  const requestBody = body as { action: unknown; paperId?: unknown };
  if (!isDemoAction(requestBody.action)) {
    return NextResponse.json({ error: "Unknown database demonstration." }, { status: 400 });
  }

  const action = requestBody.action;
  const needsPaper = action === "procedure" || action === "trigger" || action === "transaction";
  const paperId = needsPaper ? validPaperId(requestBody.paperId) : null;
  if (needsPaper && paperId === null) {
    return NextResponse.json({ error: "Enter a valid paper ID." }, { status: 400 });
  }

  try {
    if (action in viewQueries) {
      const view = viewQueries[action as ViewAction];
      const [rows] = await pool.execute<DemoRow[]>(view.sql);
      return NextResponse.json({
        success: true,
        title: view.title,
        sql: view.sql,
        result: rows,
      });
    }

    if (action === "procedure") {
      const sql = "CALL GetPaperDetails(?)";
      const [rows] = await pool.query(sql, [paperId]);
      return NextResponse.json({
        success: true,
        title: "GetPaperDetails",
        sql: "CALL GetPaperDetails(?)  -- paper ID: " + paperId,
        result: JSON.parse(JSON.stringify(rows)),
      });
    }

    if (action === "index") {
      const sql = "EXPLAIN SELECT paper_id, title, publication_year FROM paper WHERE publication_year = ?";
      const [rows] = await pool.execute<DemoRow[]>(sql, [2020]);
      const [indexes] = await pool.query<DemoRow[]>("SHOW INDEX FROM paper");
      return NextResponse.json({
        success: true,
        title: "Publication year index · EXPLAIN",
        sql: "SHOW INDEX FROM paper;\n" + sql.replace("?", "2020"),
        result: { indexes, queryPlan: rows },
      });
    }

    if (action === "trigger" || action === "transaction") {
      const connection = await pool.getConnection();
      let transactionOpen = false;
      try {
        await connection.beginTransaction();
        transactionOpen = true;

        const [beforeRows] = await connection.execute<DemoRow[]>(
          "SELECT paper_id, title FROM paper WHERE paper_id = ? FOR UPDATE",
          [paperId]
        );
        if (!beforeRows.length) {
          await connection.rollback();
          transactionOpen = false;
          return NextResponse.json({ error: "Paper ID not found." }, { status: 404 });
        }

        let auditBaseline = 0;
        if (action === "trigger") {
          const [baselineRows] = await connection.execute<DemoRow[]>(
            "SELECT COALESCE(MAX(audit_id), 0) AS last_audit_id FROM paper_audit WHERE paper_id = ?",
            [paperId]
          );
          auditBaseline = Number(baselineRows[0]?.last_audit_id ?? 0);
        }

        await connection.execute(
          "UPDATE paper SET title = CONCAT('DBMS demo ', UUID(), ': ', LEFT(title, 950)) WHERE paper_id = ?",
          [paperId]
        );
        const [duringRows] = await connection.execute<DemoRow[]>(
          "SELECT paper_id, title FROM paper WHERE paper_id = ?",
          [paperId]
        );

        let auditRows: DemoRow[] = [];
        if (action === "trigger") {
          const [rows] = await connection.execute<DemoRow[]>(
            `SELECT audit_id, paper_id, old_title, new_title, changed_at, action_type
             FROM paper_audit WHERE paper_id = ? AND audit_id > ? ORDER BY audit_id DESC LIMIT 1`,
            [paperId, auditBaseline]
          );
          auditRows = rows;
        }

        await connection.rollback();
        transactionOpen = false;

        const [afterRows] = await connection.execute<DemoRow[]>(
          "SELECT paper_id, title FROM paper WHERE paper_id = ?",
          [paperId]
        );

        return NextResponse.json({
          success: true,
          title: action === "trigger" ? "Title update trigger · rolled back safely" : "Transaction rollback · rolled back safely",
          sql: action === "trigger"
            ? "START TRANSACTION; UPDATE paper ...; SELECT * FROM paper_audit ...; ROLLBACK;"
            : "START TRANSACTION; UPDATE paper ...; SELECT title ...; ROLLBACK; SELECT title ...;",
          result: {
            before: beforeRows[0],
            duringTransaction: duringRows[0],
            auditEvent: action === "trigger" ? auditRows[0] ?? null : undefined,
            afterRollback: afterRows[0],
            note: action === "trigger"
              ? auditRows.length
                ? "The audit trigger ran inside the transaction. The paper update and audit row were both rolled back, so the database remains unchanged."
                : "The update was rolled back safely, but no audit event was found. Check that trg_paper_title_update is installed and that the app account can read paper_audit."
              : "The temporary title was visible inside the transaction, then the rollback restored the original title.",
          },
        });
      } catch (error) {
        if (transactionOpen) await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    return NextResponse.json({ error: "Unsupported demonstration." }, { status: 400 });
  } catch (error) {
    console.error("Database demonstration failed:", error);
    return NextResponse.json({
      error: "This demonstration could not run. Check that its MySQL object exists and the app database user has permission to use it.",
    }, { status: 500 });
  }
}
