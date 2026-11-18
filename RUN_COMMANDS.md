# Research Network Explorer — Run Commands

Use **PowerShell**. Keep each long-running service in its own terminal window. The repository root contains the Next.js app and a `backend` folder with the Python scripts.

## 1. Prepare the MySQL database

Check the installed MySQL service name, start it if needed, then create the database. If your service name differs from `MySQL80`, use the name shown by `Get-Service`:

```powershell
Get-Service *MySQL*
Start-Service MySQL80
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS research_network_explorer CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Load the project's **base table schema** into that database before continuing. The base schema is not included in this folder; use the schema supplied with your course/project setup. The importer expects tables for `paper`, `author`, `topic`, `method`, `paper_author`, `paper_topic`, `paper_method`, `citation`, `paper_embedding`, and `user`.

## 2. Set up Python and import research data

Open a PowerShell terminal at the repository root:

```powershell
cd C:\Users\Madhw\Downloads\DBMS\ResearchNetworkExplorer\frontend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
```

Set the database connection for the Python scripts. The password prompt is masked; these values apply only to this terminal session:

```powershell
$env:MYSQL_HOST = "127.0.0.1"
$env:MYSQL_PORT = "3306"
$env:MYSQL_USER = "root"
$env:MYSQL_DATABASE = "research_network_explorer"
$secure = Read-Host "MySQL password" -AsSecureString
$env:MYSQL_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
```

Import up to 200 AI/ML research works from OpenAlex. The script prompts for the OpenAlex API key if `OPENALEX_API_KEY` is not set:

```powershell
python .\backend\import_openalex.py
```

Only if you intentionally want to replace existing research data, use `python .\backend\import_openalex.py --replace-existing`. This clears the research tables while preserving user accounts.

Optional: expand the citation network by one hop using the OpenAlex references already linked to the dataset:

```powershell
python .\backend\expand_openalex_network.py
```

## 3. Install the advanced MySQL features

Run this **once, after the base tables and research data exist**. The script adds indexes, a full-text index, validation triggers, a summary view, and a stored procedure:

```powershell
cd C:\Users\Madhw\Downloads\DBMS\ResearchNetworkExplorer\frontend
mysql -u root -p research_network_explorer -e "source database/advanced_features.sql"
```

The SQL file creates named indexes and triggers, so do not rerun it unless you first check/remove the existing objects.

Install the five tutorial views, `GetPaperDetails`, and title-audit trigger used by the Database Feature Lab:

```powershell
mysql -u root -p research_network_explorer -e "source database/tutorial_objects.sql"
```

This script replaces those named views, procedure, and trigger. It preserves rows already in `paper_audit`.

To let the app account call the tutorial procedure, run this once as a MySQL administrator. Adjust the account host if your app's MySQL user uses a different host:

```sql
GRANT EXECUTE ON PROCEDURE research_network_explorer.GetPaperDetails TO 'research_app'@'localhost';
```

The Admin Dashboard's **Database Feature Lab** runs the existing tutorial views, procedure, audit trigger, index plan, and safe rollback examples. The paper-update demos roll back their changes automatically.

## 4. Create vectors and start Qdrant

Generate normalized title/abstract embeddings and store them in MySQL:

```powershell
cd C:\Users\Madhw\Downloads\DBMS\ResearchNetworkExplorer\frontend
python .\backend\generate_embeddings.py
```

Start Qdrant in Docker (first time):

```powershell
docker info
docker run -d --name research-qdrant -p 6333:6333 -p 6334:6334 -v research_qdrant_data:/qdrant/storage qdrant/qdrant
```

If the container already exists, start it instead:

```powershell
docker start research-qdrant
```

Transfer the embeddings from MySQL into the Qdrant collection. If asked whether to recreate an existing collection, answer `NO` to keep its current data:

```powershell
python .\backend\transfer_embeddings_to_qdrant.py
```

## 5. Start the semantic-search API

Run in a new PowerShell terminal. Set the MySQL variables in this terminal too:

```powershell
$env:MYSQL_HOST = "127.0.0.1"
$env:MYSQL_PORT = "3306"
$env:MYSQL_USER = "root"
$env:MYSQL_DATABASE = "research_network_explorer"
$secure = Read-Host "MySQL password" -AsSecureString
$env:MYSQL_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
```

Then start the API:

```powershell
cd C:\Users\Madhw\Downloads\DBMS\ResearchNetworkExplorer\frontend
.\.venv\Scripts\Activate.ps1
cd backend
uvicorn semantic_api:app --host 127.0.0.1 --port 8000
```

Optional health check in another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

## 6. Configure and run Next.js

Run in another PowerShell terminal:

```powershell
cd C:\Users\Madhw\Downloads\DBMS\ResearchNetworkExplorer\frontend
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Edit `.env.local` with your local values. It needs `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PYTHON_API_URL`, and an `AUTH_SECRET` with at least 32 random characters. Generate a secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Install the app dependencies:

```powershell
npm install
```

Create a bcrypt hash for the initial administrator password. Enter the password at the hidden prompt and keep the printed hash for the SQL insert below:

```powershell
$secure = Read-Host "Initial admin password" -AsSecureString
$env:INITIAL_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
$hash = node -e "require('bcryptjs').hash(process.env.INITIAL_ADMIN_PASSWORD, 12).then(console.log)"
Remove-Item Env:INITIAL_ADMIN_PASSWORD
$hash
```

Insert the first administrator using your email and the printed bcrypt hash. If your supplied base schema requires additional fields, include them here:

```sql
INSERT INTO `user` (email, password_hash, role)
VALUES ('your-admin-email@example.com', 'PASTE_BCRYPT_HASH_HERE', 'ADMIN');
```

Run that SQL in MySQL Workbench or the MySQL prompt, then start the app:

```powershell
npm run dev
```

Open `http://localhost:4000`. Keyword search and paper pages use MySQL; semantic search also needs Qdrant and the FastAPI service running. Admins can create further accounts in the app.

## Other useful commands

Run the linter:

```powershell
npm run lint
```

Create a production build and serve it:

```powershell
npm run build
npm start
```

Stop Qdrant when finished:

```powershell
docker stop research-qdrant
```
