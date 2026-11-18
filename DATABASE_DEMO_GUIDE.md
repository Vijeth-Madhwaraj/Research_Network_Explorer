# Database Demo and Test Guide

This guide explains the interactive database checks in **Admin Dashboard → Database Feature Lab**, what each one runs, and how to interpret the result. The demonstrations run against the configured MySQL database. Buttons are available to signed-in Admins only; the API checks the role again on the server.

## Before the demo

1. Start MySQL, Qdrant, the semantic-search API, and the Next.js app if you plan to show vector search too. Startup instructions are in [RUN_COMMANDS.md](RUN_COMMANDS.md).
2. Sign in as an Admin and open **Admin Dashboard → Database Feature Lab**.
3. Enter an existing paper ID for the procedure, trigger, transaction, and recursive-query demonstrations. The initial value is `6`.
4. Confirm that the app's MySQL account has `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges on `research_network_explorer`.
5. To call the stored procedure, grant `EXECUTE` once as a MySQL administrator:

   ```sql
   GRANT EXECUTE ON PROCEDURE research_network_explorer.GetPaperDetails
   TO 'research_app'@'localhost';
   ```

   Change the account host if your application uses a different MySQL account host.

The table-changing demos check that the participating tables use InnoDB before starting. That lets the endpoint roll the temporary changes back safely.

## SQL operations and queries

| Button | SQL concept | What it does | How to read the result |
| --- | --- | --- | --- |
| **Table definitions** | DDL and constraints | Runs `SHOW CREATE TABLE paper` and `SHOW CREATE TABLE paper_author`. | The returned `Create Table` definitions show column types, primary keys, unique keys, foreign keys, and table constraints present in the live database. This button inspects the schema; it does not alter it. |
| **Insert, update, delete** | DML and transaction | Starts a transaction, inserts a temporary paper, selects it, updates its title, selects again, deletes it, then rolls the transaction back. | `afterInsert` and `afterUpdate` show the row at each stage; `deleteAffectedRows` should be `1`; `afterDelete` should be `null`. `afterRollback` should also be `null`, confirming the inserted record did not persist. Any trigger audit event caused by the temporary update is rolled back too. |
| **Papers and authors** | `JOIN`, `ORDER BY` | Joins `paper`, `paper_author`, and `author`, then sorts and limits the result. | Each row pairs a paper with one of its authors and their author order. |
| **Citation counts** | Correlated subquery, aggregate | Counts incoming citations for each paper with a subquery that refers to the current paper row. | The highest-citation papers appear first; papers with no incoming citations are filtered out. |
| **Citation network** | Recursive CTE | Starts from the selected paper's outgoing citation links and follows the links for up to three hops. It avoids revisiting IDs already in the current path. | Rows show the depth and paper reached. A paper with no outgoing links may return no rows. |
| **Venue summary** | `GROUP BY`, `HAVING`, aggregates, `ORDER BY` | Counts papers for each non-empty venue and calculates the first and latest publication years. `HAVING` keeps venues with at least three papers. | Each result is one qualifying venue, ordered by paper count. |

The DML demo is intentionally transactional. It demonstrates all three write operations without leaving a demo paper in the database. The paper table must use InnoDB for that rollback guarantee.

## Advanced database feature buttons

| Button | SQL object or concept | What it demonstrates |
| --- | --- | --- |
| **Paper details** | `v_paper_details` view | Reads a small sample of paper metadata through the view. |
| **Paper authors** | `v_paper_authors` view and join | Reads paper-author relationships through the view. |
| **Paper topics** | `v_paper_topics` view and join | Reads paper-topic links and confidence scores through the view. |
| **Citation statistics** | `v_paper_citation_stats` view and subqueries | Reads incoming and outgoing citation counts through the view. |
| **Paper methods** | `v_paper_methods` view and join | Reads linked methods through the view. |
| **Get paper details** | `GetPaperDetails(paper_id)` stored procedure | Calls the procedure with the selected paper ID. It returns separate result sets for the paper, authors, and topics. |
| **Audit a title update** | `trg_paper_title_update` trigger and transaction | Records the current audit ID, changes the selected title to a generated temporary value, reads the newly inserted audit row, and rolls back. The paper title and audit row are both restored by rollback. |
| **Roll back an update** | Transaction | Shows the original title, changes it temporarily, reads the changed title, rolls back, then reads the restored title. |
| **Inspect year lookup** | Index and `EXPLAIN` | Runs `SHOW INDEX FROM paper` and asks MySQL to explain a query filtered on `publication_year`. | The index list shows available indexes. The `EXPLAIN` plan reports possible and selected keys. The optimizer may choose a table scan for a small table; that is still a valid query-plan result. |

The trigger demo requires `paper` and `paper_audit` to use InnoDB. Its audit row is queried before rollback so the UI can show that the trigger fired; the row is not retained after the transaction ends.

The current database demonstrates a stored **procedure**; it does not have a stored function. The DDL inspection button shows the live table definitions and constraints. The tutorial setup script uses `CREATE` / `CREATE OR REPLACE` for its objects and `DROP ... IF EXISTS` before recreating its named procedure and trigger. The OpenAlex importer also uses `ALTER TABLE` when it needs to add expected columns.

## Setting up the tutorial objects

After the base tables exist, install the tutorial views, audit table, procedure, and title-update trigger with:

```powershell
mysql -u root -p research_network_explorer -e "source database/tutorial_objects.sql"
```

The script replaces the named views and recreates `GetPaperDetails` and `trg_paper_title_update`. It uses `CREATE TABLE IF NOT EXISTS` for `paper_audit`, so existing audit rows are preserved. The separate [advanced_features.sql](database/advanced_features.sql) installs additional indexes, full-text search, validation triggers, a summary view, and `sp_search_papers`.

## Semantic / vector search check

Semantic search is a separate backend check from the SQL Feature Lab:

1. Confirm Qdrant is running and has the `research_papers` collection.
2. Check the API health endpoint:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:8000/health
   ```

   A healthy response reports model `sentence-transformers/all-MiniLM-L6-v2` and collection `research_papers`.
3. Search from the app using a research question. The API embeds the query with the same model, requests nearest vectors from Qdrant using cosine distance, and looks up the returned paper IDs in MySQL to produce the displayed records.

Paper titles and abstracts are embedded, with title-only text used when the abstract is missing. The vectors are 384-dimensional and stored in Qdrant. `backend/generate_embeddings.py` creates the embeddings; `backend/transfer_embeddings_to_qdrant.py` loads them into the collection.

## Common issues

- **Procedure permission denied:** grant `EXECUTE` on `GetPaperDetails` to the MySQL account used by the app.
- **A view, procedure, trigger, or audit table is missing:** apply `database/tutorial_objects.sql` after confirming the base tables exist.
- **Rollback-safe demo refuses to run:** verify that `paper` (and `paper_audit` for the trigger demo) uses InnoDB.
- **No paper found:** enter an ID that exists in the `paper` table.
- **Vector search fails while health is healthy:** inspect the FastAPI terminal; health confirms Qdrant and the collection are reachable, while the search also needs working MySQL credentials and query access.
