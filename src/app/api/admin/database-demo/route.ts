import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import type { ResultSetHeader } from "mysql2/promise";
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
type DemoAction = ViewAction | "ddl" | "dml" | "join" | "correlated" | "recursive" | "aggregate" | "procedure" | "trigger" | "transaction" | "index";
type DemoRow = RowDataPacket & Record<string, unknown>;

function isDemoAction(value: unknown): value is DemoAction {
  return typeof value === "string" && (
    Object.prototype.hasOwnProperty.call(viewQueries, value) ||
    value === "procedure" ||
    value === "ddl" ||
    value === "dml" ||
    value === "join" ||
    value === "correlated" ||
    value === "recursive" ||
    value === "aggregate" ||
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
  const needsPaper = action === "procedure" || action === "trigger" || action === "transaction" || action === "recursive";
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

    if (action === "ddl") {
      const [paperRows] = await pool.query<DemoRow[]>("SHOW CREATE TABLE paper");
      const [relationshipRows] = await pool.query<DemoRow[]>("SHOW CREATE TABLE paper_author");
      return NextResponse.json({
        success: true,
        title: "DDL · table definitions and constraints",
        sql: "SHOW CREATE TABLE paper;\nSHOW CREATE TABLE paper_author;",
        result: { paper: paperRows[0], paper_author: relationshipRows[0] },
      });
    }

    if (action === "dml") {
      const connection = await pool.getConnection();
      let transactionOpen = false;
      try {
        const [engineRows] = await connection.execute<DemoRow[]>(
          `SELECT ENGINE AS engine FROM information_schema.tables
           WHERE table_schema = DATABASE() AND table_name = 'paper'`
        );
        if (String(engineRows[0]?.engine).toLowerCase() !== "innodb") {
          return NextResponse.json({
            error: "The DML demonstration requires the paper table to use InnoDB so its changes can be rolled back safely.",
          }, { status: 409 });
        }

        await connection.beginTransaction();
        transactionOpen = true;
        const [insertResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO paper (title, abstract, publication_year, venue, doi, source_url)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ["DBMS SQL demo record", "Temporary record for the interactive DML demonstration.", 2020, "DBMS Demo", null, null]
        );
        const demoPaperId = insertResult.insertId;
        const [insertRows] = await connection.execute<DemoRow[]>(
          "SELECT paper_id, title FROM paper WHERE paper_id = ?",
          [demoPaperId]
        );

        await connection.execute(
          "UPDATE paper SET title = ? WHERE paper_id = ?",
          ["DBMS SQL demo record · updated", demoPaperId]
        );
        const [updateRows] = await connection.execute<DemoRow[]>(
          "SELECT paper_id, title FROM paper WHERE paper_id = ?",
          [demoPaperId]
        );

        const [deleteResult] = await connection.execute<ResultSetHeader>(
          "DELETE FROM paper WHERE paper_id = ?",
          [demoPaperId]
        );
        const [deleteRows] = await connection.execute<DemoRow[]>(
          "SELECT paper_id, title FROM paper WHERE paper_id = ?",
          [demoPaperId]
        );

        await connection.rollback();
        transactionOpen = false;
        const [finalRows] = await connection.execute<DemoRow[]>(
          "SELECT paper_id, title FROM paper WHERE paper_id = ?",
          [demoPaperId]
        );

        return NextResponse.json({
          success: true,
          title: "INSERT · UPDATE · DELETE · rollback",
          sql: `START TRANSACTION;\nINSERT INTO paper (title, abstract, publication_year, venue, doi, source_url)\nVALUES ('DBMS SQL demo record', 'Temporary record for the interactive DML demonstration.', 2020, 'DBMS Demo', NULL, NULL);\nSELECT paper_id, title FROM paper WHERE paper_id = ${demoPaperId};\nUPDATE paper SET title = 'DBMS SQL demo record · updated' WHERE paper_id = ${demoPaperId};\nSELECT paper_id, title FROM paper WHERE paper_id = ${demoPaperId};\nDELETE FROM paper WHERE paper_id = ${demoPaperId};\nSELECT paper_id, title FROM paper WHERE paper_id = ${demoPaperId};\nROLLBACK;`,
          result: {
            afterInsert: insertRows[0],
            afterUpdate: updateRows[0],
            deleteAffectedRows: deleteResult.affectedRows,
            afterDelete: deleteRows[0] ?? null,
            afterRollback: finalRows[0] ?? null,
            note: "The temporary row was inserted, updated, and deleted inside a transaction. The final rollback removed the demo row and its audit event.",
          },
        });
      } catch (error) {
        if (transactionOpen) await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    if (action === "join") {
      const sql = `SELECT p.paper_id, p.title, a.name AS author_name, pa.author_order
FROM paper p
JOIN paper_author pa ON pa.paper_id = p.paper_id
JOIN author a ON a.author_id = pa.author_id
ORDER BY p.paper_id DESC, pa.author_order
LIMIT 10`;
      const [rows] = await pool.execute<DemoRow[]>(sql);
      return NextResponse.json({ success: true, title: "JOIN · papers and authors", sql, result: rows });
    }

    if (action === "correlated") {
      const sql = `SELECT p.paper_id, p.title,
       (SELECT COUNT(*) FROM citation c WHERE c.cited_paper_id = p.paper_id) AS incoming_citations
FROM paper p
WHERE (SELECT COUNT(*) FROM citation c WHERE c.cited_paper_id = p.paper_id) > 0
ORDER BY incoming_citations DESC, p.paper_id
LIMIT 10`;
      const [rows] = await pool.execute<DemoRow[]>(sql);
      return NextResponse.json({ success: true, title: "Correlated subquery · citation counts", sql, result: rows });
    }

    if (action === "recursive") {
      const sql = `WITH RECURSIVE citation_walk AS (
  SELECT c.citing_paper_id AS root_paper_id,
         c.cited_paper_id AS paper_id,
         1 AS depth,
         CAST(CONCAT(',', c.citing_paper_id, ',', c.cited_paper_id, ',') AS CHAR(2000)) AS visited
  FROM citation c
  WHERE c.citing_paper_id = ?
  UNION ALL
  SELECT cw.root_paper_id,
         c.cited_paper_id,
         cw.depth + 1,
         CONCAT(cw.visited, c.cited_paper_id, ',')
  FROM citation_walk cw
  JOIN citation c ON c.citing_paper_id = cw.paper_id
  WHERE cw.depth < 3
    AND LOCATE(CONCAT(',', c.cited_paper_id, ','), cw.visited) = 0
)
SELECT cw.depth, p.paper_id, p.title, p.publication_year
FROM citation_walk cw
JOIN paper p ON p.paper_id = cw.paper_id
ORDER BY cw.depth, p.publication_year DESC, p.paper_id
LIMIT 25`;
      const [rows] = await pool.execute<DemoRow[]>(sql, [paperId]);
      return NextResponse.json({
        success: true,
        title: "Recursive CTE · citation network up to 3 hops",
        sql: sql.replace("?", String(paperId)),
        result: rows,
      });
    }

    if (action === "aggregate") {
      const sql = `SELECT venue, COUNT(*) AS paper_count,
       MIN(publication_year) AS first_year,
       MAX(publication_year) AS latest_year
FROM paper
WHERE venue IS NOT NULL AND TRIM(venue) <> ''
GROUP BY venue
HAVING COUNT(*) >= 3
ORDER BY paper_count DESC, venue
LIMIT 10`;
      const [rows] = await pool.execute<DemoRow[]>(sql);
      return NextResponse.json({ success: true, title: "GROUP BY · HAVING · aggregates · ORDER BY", sql, result: rows });
    }

    if (action === "procedure") {
      const sql = "CALL GetPaperDetails(?)";
      const [rows] = await pool.query(sql, [paperId]);
      return NextResponse.json({
        success: true,
        title: "GetPaperDetails",
        sql: `CALL GetPaperDetails(${paperId});`,
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
        const requiredTables = action === "trigger" ? ["paper", "paper_audit"] : ["paper"];
        const [engineRows] = await connection.execute<DemoRow[]>(
          `SELECT table_name, ENGINE AS engine FROM information_schema.tables
           WHERE table_schema = DATABASE() AND table_name IN (${requiredTables.map(() => "?").join(", ")})`,
          requiredTables
        );
        const transactionalTables = new Set(
          engineRows.filter((row) => String(row.engine).toLowerCase() === "innodb").map((row) => String(row.table_name))
        );
        if (requiredTables.some((table) => !transactionalTables.has(table))) {
          return NextResponse.json({
            error: "This rollback-safe demonstration requires its participating tables to use InnoDB.",
          }, { status: 409 });
        }

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
            ? `START TRANSACTION;\nUPDATE paper SET title = CONCAT('DBMS demo ', UUID(), ': ', LEFT(title, 950)) WHERE paper_id = ${paperId};\nSELECT audit_id, old_title, new_title, action_type FROM paper_audit WHERE paper_id = ${paperId} ORDER BY audit_id DESC LIMIT 1;\nROLLBACK;`
            : `START TRANSACTION;\nUPDATE paper SET title = CONCAT('DBMS demo ', UUID(), ': ', LEFT(title, 950)) WHERE paper_id = ${paperId};\nSELECT paper_id, title FROM paper WHERE paper_id = ${paperId};\nROLLBACK;\nSELECT paper_id, title FROM paper WHERE paper_id = ${paperId};`,
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
