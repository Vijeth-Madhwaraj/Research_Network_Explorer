# Research Network Explorer — Viva Preparation Guide

This guide is designed to help you explain the project out loud. It covers the database design, the SQL demonstrations in the Admin Dashboard, the application architecture, and semantic search. The Database Feature Lab is available to an Admin at **Admin Dashboard → Database Feature Lab**.

## 1. A short introduction to say first

> “My project is called Research Network Explorer. It helps users find research papers by keyword or by meaning. MySQL stores the structured data, including papers, authors, topics, methods, citations, and user accounts. The Next.js application talks to MySQL through server-side API routes. For semantic search, a Python API creates a vector for the query, searches Qdrant, and then retrieves the matching paper records from MySQL.”

Then briefly name the DBMS concepts you will demonstrate:

> “I demonstrate DDL and constraints, CRUD operations, joins, correlated and recursive queries, grouping and aggregates, views, a stored procedure, a trigger, indexes, and transactions. The project also has semantic search with Qdrant.”

## 2. How to present the live demo

Start the services by following [RUN_COMMANDS.md](RUN_COMMANDS.md). Sign in as an Admin, open the Admin Dashboard, and choose **Database Feature Lab**. The page is Admin-only, and its API checks the role again before it runs a database demonstration.

Enter a paper ID that exists in MySQL. The page starts with ID `6`, but you can check or choose another one:

```sql
SELECT paper_id, title FROM paper ORDER BY paper_id LIMIT 10;
```

For each button, the result panel displays the SQL and the live result returned by the connected database. A practical presentation order is:

1. Table definitions
2. Insert, update, delete
3. Papers and authors join
4. Correlated citation-count query
5. Recursive citation-network query
6. Venue grouping and aggregates
7. One or two views
8. Stored procedure
9. Trigger and rollback
10. Index and `EXPLAIN`
11. Semantic search from the home page

## 3. SQL operations and query demonstrations

### Table definitions — DDL and constraints

The **Table definitions** button runs:

```sql
SHOW CREATE TABLE paper;
SHOW CREATE TABLE paper_author;
```

It displays the live `CREATE TABLE` definitions. Use them to point out the columns, data types, primary keys, foreign keys, unique keys, and constraints that are actually present. `paper_author` is the relationship table connecting papers and authors.

This button is a schema inspection. It does **not** change the database. The setup files also contain DDL: `tutorial_objects.sql` creates the audit table and tutorial views, and recreates the named procedure and trigger. The OpenAlex importer uses `ALTER TABLE` when expected columns are missing. There is no button that runs a destructive `DROP TABLE` against the project data.

If asked about constraints, refer to the output of `SHOW CREATE TABLE` instead of guessing. The exact base schema may vary with the schema file used to initialize the database.

### Insert, update, and delete — DML and transactions

The **Insert, update, delete** button performs this sequence inside one transaction:

1. Insert a temporary paper record.
2. Select it and show the generated `paper_id`.
3. Update its title.
4. Select it again to show the new title.
5. Delete the temporary row and verify that it is absent inside the transaction.
6. Roll back the transaction and verify that the test row is still absent.

The insert uses a harmless test title and no DOI or OpenAlex ID, so it does not collide with a real imported paper. The API checks that `paper` uses InnoDB before running. If any step fails, the handler rolls back and releases the connection.

> “This button demonstrates `INSERT`, `SELECT`, `UPDATE`, and `DELETE`. I wrap the writes in an InnoDB transaction and roll them back so the test leaves no paper or audit event behind.”

The **Roll back an update** button is a smaller transaction example. It displays the original title, changes it temporarily, reads the changed title inside the transaction, rolls back, and reads the title again. The final title should match the original.

### Join query

The **Papers and authors** button joins the paper, linking, and author tables:

```sql
SELECT p.paper_id, p.title, a.name AS author_name, pa.author_order
FROM paper p
JOIN paper_author pa ON pa.paper_id = p.paper_id
JOIN author a ON a.author_id = pa.author_id
ORDER BY p.paper_id DESC, pa.author_order
LIMIT 10;
```

The linking table allows one paper to have multiple authors and one author to appear on multiple papers. The result shows both sides of that relationship.

### Correlated subquery

The **Citation counts** button counts incoming citations for each paper. The inner query refers to `p.paper_id` from the outer query:

```sql
SELECT p.paper_id, p.title,
       (SELECT COUNT(*)
        FROM citation c
        WHERE c.cited_paper_id = p.paper_id) AS incoming_citations
FROM paper p
WHERE (SELECT COUNT(*)
       FROM citation c
       WHERE c.cited_paper_id = p.paper_id) > 0
ORDER BY incoming_citations DESC, p.paper_id
LIMIT 10;
```

> “It is correlated because the subquery uses the current paper’s ID. It calculates the citation count for each outer paper row.”

### Recursive CTE

The **Citation network** button starts with the selected paper’s references and follows citation links for up to three hops. A recursive CTE has an initial query (the starting papers) and a recursive query (the next hop).

The query keeps a path of visited paper IDs. Before following a link, it checks that the next ID is not already in that path. This prevents loops from cycling indefinitely. The depth limit also bounds the work.

> “The result shows papers referenced directly and papers reached through later hops. A paper with no outgoing reference links can return no rows; that is a valid result.”

### Grouping, `HAVING`, and aggregates

The **Venue summary** button groups papers by venue and calculates the number of papers, earliest year, and latest year. It excludes empty venues, then uses `HAVING` to retain venues with at least three papers.

> “`WHERE` filters input rows before grouping. `HAVING` filters the groups after `GROUP BY` has formed them.”

The query also sorts the qualifying venues and limits the displayed result to ten rows.

## 4. Advanced SQL feature demonstrations

### Views

A view is a saved query that can be read like a virtual table. The Feature Lab has buttons for these five views:

- `v_paper_details` — paper metadata
- `v_paper_authors` — paper-author relationships
- `v_paper_topics` — paper-topic relationships and confidence scores
- `v_paper_citation_stats` — incoming and outgoing citation counts
- `v_paper_methods` — paper-method relationships

Each button selects a small sample from its view. The views keep reusable joins or calculations in the database and make the results easier to query consistently.

### Stored procedure

The **Get paper details** button runs:

```sql
CALL GetPaperDetails(paper_id);
```

The procedure takes a paper ID as an input parameter and returns three result sets: the paper, its authors, and its topics. It demonstrates how a database can package several related queries behind one reusable call.

The application’s MySQL account needs the `EXECUTE` privilege on this procedure. An administrator can grant it with:

```sql
GRANT EXECUTE ON PROCEDURE research_network_explorer.GetPaperDetails
TO 'research_app'@'localhost';
```

The account host may need to match the host configured for the application. This is a MySQL account privilege; it is separate from the application’s `ADMIN` and `RESEARCHER` roles.

### Trigger and audit table

The `trg_paper_title_update` trigger runs after a paper update. If the title changed, it inserts the old title, new title, paper ID, timestamp, and action type into `paper_audit`.

The **Audit a title update** button records the latest audit ID, changes a selected title to a generated temporary value, and reads the new audit record. It then rolls back the transaction.

> “The trigger fires automatically because the `UPDATE` statement changes the title. The demo reads the audit record before rollback to prove the trigger ran. Because the update and audit insert are in the same InnoDB transaction, rollback removes both changes.”

In normal application updates that are committed, the audit record persists. This demonstration intentionally rolls back instead.

### Index and query plan

The **Inspect year lookup** button runs `SHOW INDEX FROM paper` and asks MySQL to explain a publication-year lookup:

```sql
EXPLAIN
SELECT paper_id, title, publication_year
FROM paper
WHERE publication_year = 2020;
```

The index listing shows the available indexes. `EXPLAIN` reports the possible keys and the key the optimizer chose, along with its access plan. MySQL may choose a table scan when it estimates that is cheaper, especially for a small table; that does not mean `EXPLAIN` failed.

> “An index can make reads faster, but it uses storage and makes inserts or updates more expensive because the index also has to be maintained.”

### Setup scripts and other advanced objects

The project has two SQL setup files with complementary objects:

- [`database/tutorial_objects.sql`](database/tutorial_objects.sql) creates the audit table and five tutorial views, and recreates `GetPaperDetails` and `trg_paper_title_update` used by the Feature Lab.
- [`database/advanced_features.sql`](database/advanced_features.sql) adds indexes, a full-text index, title/year validation triggers, `v_research_venue_summary`, and `sp_search_papers`.

Run the scripts only after the base tables exist. The tutorial script replaces the named views, procedure, and trigger; its `CREATE TABLE IF NOT EXISTS` keeps existing `paper_audit` rows. Follow [RUN_COMMANDS.md](RUN_COMMANDS.md) for setup order and procedure permissions.

The current database demonstrates a stored procedure; it does not currently have a stored function. If asked, say that the procedure is the routine demonstrated in this project.

## 5. Authentication and database integration

The browser does not connect directly to MySQL. It calls Next.js API routes. Those routes use the server-side connection pool configured with environment variables. The semantic-search UI calls the Next.js API, which forwards the query to the Python API.

The Feature Lab page checks for an Admin session, and the demo API repeats that role check. This is why a Researcher cannot run the database demonstrations even if they try to call the API directly. Application roles are stored in the MySQL `user` table, but they are not separate MySQL accounts: the server connects using its configured database user.

Paper data is also validated by the API before writes. When the validation triggers from `advanced_features.sql` are installed, MySQL checks title and publication-year rules as a second line of integrity protection, including for writes that do not come through the web form.

## 6. Semantic / vector search

Semantic search handles meaning-based queries, which exact keyword matching can miss. The project embeds each paper’s title and abstract; if an abstract is unavailable, it embeds the title. It uses `sentence-transformers/all-MiniLM-L6-v2`, which produces 384-dimensional vectors.

The vectors are stored in the Qdrant collection `research_papers` with paper ID and model metadata. Search works like this:

1. The user enters a research question in the app.
2. The Next.js API sends it to the FastAPI semantic endpoint.
3. The Python API embeds the query with the same model.
4. Qdrant returns the nearest vectors using cosine similarity.
5. The Python API looks up the returned paper IDs in MySQL and returns the paper details and similarity scores.

> “Qdrant finds semantically similar paper vectors; MySQL remains the source for the structured paper records shown to the user.”

The Qdrant service listens on port `6333`; the Python API listens on port `8000`. A successful `/health` response confirms that the API can access the collection. A search also needs working MySQL credentials and read access to the paper table.

## 7. Likely viva questions and suggested answers

### Why did you choose MySQL?

“The project has structured entities and relationships, such as papers, authors, and citations. MySQL supports primary and foreign keys, constraints, joins, transactions, views, procedures, triggers, and indexes for that data.”

### Why did you add a linking table between papers and authors?

“A paper can have multiple authors and an author can work on multiple papers. `paper_author` represents that many-to-many relationship and can store the author’s order on a paper.”

### What is the difference between a view and a procedure?

“A view is a saved query that I can select from like a virtual table. A procedure is a stored routine that I call, can pass parameters to, and can use to return multiple result sets.”

### What is the difference between a procedure and a function?

“A function is designed to return a value and can be used in expressions. A procedure is invoked with `CALL` and can return result sets or use output parameters. This project demonstrates `GetPaperDetails` as a procedure; it does not currently install a stored function.”

### Why use a trigger for auditing?

“The trigger runs automatically when a title update occurs, regardless of whether the update came from the web app or direct SQL. It records the old and new titles in the audit table.”

### Why does the trigger demo roll back?

“The button is a repeatable demonstration, so it should not change a real paper. It reads the audit row inside the transaction to show that the trigger fired, then rolls back both the paper update and audit insert.”

### What does ACID mean in your transaction example?

“Atomicity means the steps succeed or roll back together. Consistency means constraints remain satisfied. Isolation keeps an in-progress transaction separate from other transactions according to the database isolation level. Durability means committed changes persist. My demo focuses on atomicity by rolling all temporary writes back.”

### What makes a subquery correlated?

“The inner query refers to a value from the outer query. Here, the citation count subquery uses the current outer paper’s `paper_id`.”

### What is the purpose of the recursive CTE?

“It follows citation relationships across multiple levels. The base query finds the first hop; the recursive part finds later hops. A depth bound and visited-path check prevent unbounded traversal and cycles.”

### What do `GROUP BY` and `HAVING` do?

“`GROUP BY` forms groups, such as one group per venue. Aggregate functions calculate values for each group. `HAVING` filters those groups, for example to keep venues with at least three papers.”

### What is an index, and what trade-off does it have?

“An index is an additional structure MySQL can use to find rows faster. It consumes storage and adds work to inserts, updates, and deletes.”

### What does `EXPLAIN` show?

“It shows the query plan MySQL expects to use, including candidate and selected indexes. It helps evaluate how a query may run; it does not itself return the matching paper rows.”

### Why do you use Qdrant as well as MySQL?

“MySQL stores structured relational records. Qdrant searches vector embeddings by similarity. The API connects the two by taking matching vector IDs and retrieving their structured paper records from MySQL.”

### What does cosine similarity mean here?

“It compares the direction of two vectors to estimate how similar their meanings are. The query and paper text use the same embedding model so their vectors can be compared.”

### How do you reduce SQL injection risk?

“User-provided values such as paper IDs are sent as query parameters to prepared statements. The demo action is also checked against a fixed allowlist; the browser cannot submit arbitrary SQL.”

### How are Admin and Researcher different?

“They are application roles. The backend checks the signed-in user’s role before privileged operations. Admins can manage accounts and delete papers; Researchers can contribute and edit paper records. The MySQL connection itself uses the server’s database account.”

## 8. Details to state accurately

- The **Table definitions** button inspects DDL; it does not create or alter the live project tables.
- The **DML** button demonstrates a temporary insert, update, and delete, then rolls them back.
- The trigger audit event appears in the demo response before rollback; it does not remain in `paper_audit` afterward.
- The **stored procedure** demo requires MySQL `EXECUTE` permission.
- The app roles `ADMIN` and `RESEARCHER` are separate from MySQL account grants.
- The project has a stored procedure, not a stored function.
- A vector similarity score indicates closeness under the embedding model; it is not a guarantee that two papers are scientifically equivalent.
