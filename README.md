# Research Atlas · Research Network Explorer

A Next.js research discovery application backed by MySQL and Qdrant. Explore the paper, author, topic, method, and citation network through keyword search, paper detail pages, live collection insights, and semantic search.

For the complete Windows PowerShell setup, database, vector-search, and run commands, see [RUN_COMMANDS.md](RUN_COMMANDS.md).

## Run locally

1. Create a MySQL database named `research_network_explorer` and load the project's research tables and data.
2. Copy `.env.example` to `.env.local`, then set the MySQL credentials and a random `AUTH_SECRET` of at least 32 characters. Keep `.env.local` private.
3. Install dependencies and start the Next.js app from this directory:

   ```bash
   npm install
   npm run dev
   ```

4. Open `http://localhost:4000`. The keyword explorer, paper detail pages, and collection statistics use MySQL. If you run Next.js on another port, update `APP_BASE_URL` in `.env.local` to match it.
5. For semantic search, run [`backend/semantic_api.py`](backend/semantic_api.py) and Qdrant, and set `PYTHON_API_URL` if the API is not at `http://127.0.0.1:8000`.

The first administrator account must be seeded directly in the `user` table with a bcrypt password hash. Admins can then create accounts from the Admin Dashboard. Do not expose a public admin-registration route.

Run [`database/tutorial_objects.sql`](database/tutorial_objects.sql) to install the five tutorial views, `GetPaperDetails` procedure, audit table, and title-update trigger. Admins can then open **Admin Dashboard → Database Feature Lab** to inspect table DDL and constraints; run rollback-safe INSERT, UPDATE, and DELETE examples; demonstrate joins, correlated and recursive queries, grouping, and the advanced database objects; and see the SQL plus live results.

## Database operations shown in the app

- **SELECT:** recent papers, paper detail, role lookups, live metrics, and search results.
- **INSERT:** signed-in researchers and admins can add papers; admins can create accounts.
- **UPDATE:** signed-in researchers and admins can edit paper metadata.
- **DELETE:** admins can delete a paper. The API removes citations, paper-author, paper-topic, paper-method, and embedding rows in one transaction before removing the paper.
- **JOIN / subquery:** paper detail pages join author, topic, method, and citation data. Keyword search uses relationship subqueries to match author names and topics.
- **Aggregate / GROUP BY / HAVING / ORDER BY:** live dashboard totals, paper counts by year, and venues with at least three papers.
- **Transactions:** inserts and multi-table paper deletion commit atomically and roll back on error.

## Advanced database features

Run [`database/advanced_features.sql`](database/advanced_features.sql) **once** against the populated MySQL database to add the DBMS demo features:

1. **Indexes:** publication-year and relationship indexes, plus a full-text index over paper titles and abstracts.
2. **View:** `v_research_venue_summary` aggregates venue counts and year range, retaining venues with three or more papers.
3. **Stored procedure:** `sp_search_papers(search_term)` returns full-text matches ranked by relevance.
4. **Triggers:** insert and update triggers reject blank titles and publication years outside 1000–2100. The API also validates fields before writes, so bad input is rejected at both layers.

The project also uses **Qdrant vector similarity search**. `generate_embeddings.py` embeds each paper's title and abstract (or title alone when no abstract exists) with `sentence-transformers/all-MiniLM-L6-v2`, normalizes the vectors, and stores them in the `research_papers` Qdrant collection. Semantic queries are embedded with the same model and ranked by cosine similarity. The Python service maps the returned paper IDs back to current MySQL records, preserving the vector ranking in the UI. The search screen names the data stores and shows similarity scores.

## Roles and validation

- **RESEARCHER:** sign in, search, add papers, and update paper metadata.
- **ADMIN:** all researcher actions, paper deletion, and user account creation / role assignment.

Sessions use a signed, HTTP-only cookie. API routes enforce the role on the server; the UI only reflects those permissions. Email/password checks and paper-field validation happen in the API, while paper title/year integrity is repeated by the MySQL triggers after the SQL setup script is applied. Database credentials and the JWT secret are loaded from environment variables.

## Project map

- `src/app/` — Next.js pages and API routes.
- `src/lib/` — MySQL pool and session/role helpers.
- `backend/semantic_api.py` — FastAPI and Qdrant semantic-search service.
- `backend/generate_embeddings.py` — paper embedding generation.
- `database/advanced_features.sql` — MySQL view, procedure, triggers, and indexes.
