
import argparse
import getpass
import os
import re
import time

import mysql.connector
import requests


API_URL = "https://api.openalex.org/works"
DATABASE = os.getenv("MYSQL_DATABASE", "research_network_explorer")
MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")

TARGET_PAPERS = 200
PAGE_SIZE = 100

METHOD_KEYWORDS = {
    "Transformer": ["transformer", "self-attention"],
    "Convolutional Neural Network": ["convolutional neural network", "cnn"],
    "Recurrent Neural Network": ["recurrent neural network", "lstm", "gru"],
    "Graph Neural Network": ["graph neural network", "gnn"],
    "Generative Adversarial Network": ["generative adversarial network", "gan"],
    "Diffusion Model": ["diffusion model", "denoising diffusion"],
    "Reinforcement Learning": ["reinforcement learning", "q-learning"],
    "Federated Learning": ["federated learning"],
    "Transfer Learning": ["transfer learning", "fine-tuning"],
    "Contrastive Learning": ["contrastive learning"],
    "Support Vector Machine": ["support vector machine", "svm"],
    "Random Forest": ["random forest"],
    "Decision Tree": ["decision tree"],
    "Clustering": ["clustering", "k-means"],
    "Bayesian Method": ["bayesian", "bayes' theorem"],
}


def reconstruct_abstract(inverted_index):
    if not inverted_index:
        return None

    words = {}
    for word, positions in inverted_index.items():
        for position in positions:
            words[position] = word

    if not words:
        return None

    return " ".join(words[position] for position in sorted(words))


def openalex_id(url):
    if not url:
        return None
    return url.rstrip("/").split("/")[-1]


def get_topic_name(topic):
    return (topic.get("display_name") or "").strip()


def fetch_works(api_key):
    session = requests.Session()
    cursor = "*"
    works = []
    seen_ids = set()
    seen_dois = set()

    params = {
        "search": "artificial intelligence machine learning",
        "per-page": PAGE_SIZE,
        "cursor": cursor,
        "api_key": api_key,
        "select": (
            "id,doi,title,publication_year,authorships,"
            "referenced_works,topics,primary_location,"
            "abstract_inverted_index"
        ),
    }

    print(f"Fetching up to {TARGET_PAPERS} works from OpenAlex...")

    while len(works) < TARGET_PAPERS:
        params["cursor"] = cursor

        response = session.get(API_URL, params=params, timeout=60)

        if response.status_code == 429:
            print("Rate limited. Waiting 10 seconds...")
            time.sleep(10)
            continue

        response.raise_for_status()
        data = response.json()

        results = data.get("results", [])
        if not results:
            break

        for work in results:
            work_id = openalex_id(work.get("id"))
            doi = work.get("doi")
            doi_key = doi.lower().rstrip("/") if doi else None

            if not work_id or work_id in seen_ids:
                continue

            if doi_key and doi_key in seen_dois:
                continue

            if not (work.get("title") or "").strip():
                continue

            work["_openalex_id"] = work_id
            works.append(work)
            seen_ids.add(work_id)

            if doi_key:
                seen_dois.add(doi_key)

            if len(works) >= TARGET_PAPERS:
                break

        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break

    print(f"Fetched {len(works)} works.")
    return works


def ensure_openalex_columns(cursor, connection):
    columns = {
        "paper": "openalex_id VARCHAR(64) NULL",
        "author": "openalex_id VARCHAR(64) NULL",
        "topic": "openalex_id VARCHAR(64) NULL",
    }

    for table, definition in columns.items():
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = %s
              AND TABLE_NAME = %s
              AND COLUMN_NAME = 'openalex_id'
            """,
            (DATABASE, table),
        )

        if cursor.fetchone()[0] == 0:
            cursor.execute(
                f"ALTER TABLE `{table}` ADD COLUMN {definition}"
            )
            connection.commit()

        index_name = f"uq_{table}_openalex_id"

        cursor.execute(
            """
            SELECT COUNT(*)
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = %s
              AND TABLE_NAME = %s
              AND INDEX_NAME = %s
            """,
            (DATABASE, table, index_name),
        )

        if cursor.fetchone()[0] == 0:
            cursor.execute(
                f"CREATE UNIQUE INDEX `{index_name}` "
                f"ON `{table}` (`openalex_id`)"
            )
            connection.commit()


def clear_research_data(cursor, connection):
    # Delete dependent rows before deleting their parent records.
    for table in [
        "paper_embedding",
        "citation",
        "paper_author",
        "paper_topic",
        "paper_method",
        "paper",
        "author",
        "topic",
        "method",
    ]:
        cursor.execute(f"DELETE FROM `{table}`")

    connection.commit()
    print("Cleared existing research data. USER accounts were preserved.")


def insert_paper(cursor, work):
    title = (work.get("title") or "").strip()
    abstract = reconstruct_abstract(
        work.get("abstract_inverted_index")
    )
    year = work.get("publication_year")
    doi = work.get("doi")
    work_id = work["_openalex_id"]

    primary_location = work.get("primary_location") or {}
    source = primary_location.get("source") or {}
    venue = source.get("display_name")
    source_url = (
        primary_location.get("landing_page_url")
        or doi
        or work.get("id")
    )

    cursor.execute(
        """
        INSERT INTO paper
            (title, abstract, publication_year, doi, venue,
             source_url, openalex_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (title, abstract, year, doi, venue, source_url, work_id),
    )

    return cursor.lastrowid


def insert_author(cursor, author_data):
    author_id = openalex_id(author_data.get("id"))
    name = (author_data.get("display_name") or "").strip()

    if not author_id or not name:
        return None

    cursor.execute(
        "SELECT author_id FROM author WHERE openalex_id = %s",
        (author_id,),
    )
    row = cursor.fetchone()

    if row:
        return row[0]

    institutions = author_data.get("institutions") or []
    affiliation = (
        institutions[0].get("display_name")
        if institutions
        else None
    )
    country = (
        institutions[0].get("country_code")
        if institutions
        else None
    )

    cursor.execute(
        """
        INSERT INTO author (name, affiliation, country, openalex_id)
        VALUES (%s, %s, %s, %s)
        """,
        (name, affiliation, country, author_id),
    )

    return cursor.lastrowid


def insert_topic(cursor, topic_data):
    topic_id = openalex_id(topic_data.get("id"))
    name = get_topic_name(topic_data)

    if not topic_id or not name:
        return None

    cursor.execute(
        "SELECT topic_id FROM topic WHERE openalex_id = %s",
        (topic_id,),
    )
    row = cursor.fetchone()

    if row:
        return row[0]

    # Reuse an existing topic with the same name if one exists.
    cursor.execute(
        "SELECT topic_id FROM topic WHERE topic_name = %s",
        (name,),
    )
    row = cursor.fetchone()

    if row:
        return row[0]

    cursor.execute(
        """
        INSERT INTO topic (topic_name, description, openalex_id)
        VALUES (%s, %s, %s)
        """,
        (name, topic_data.get("description"), topic_id),
    )

    return cursor.lastrowid


def infer_methods(cursor, paper_id, text):
    text = (text or "").lower()

    for method_name, keywords in METHOD_KEYWORDS.items():
        matched = next(
            (keyword for keyword in keywords if keyword in text),
            None,
        )

        if not matched:
            continue

        cursor.execute(
            """
            INSERT INTO method (method_name, description)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE method_id = LAST_INSERT_ID(method_id)
            """,
            (
                method_name,
                "Method label inferred using title/abstract keyword matching.",
            ),
        )

        method_id = cursor.lastrowid

        cursor.execute(
            """
            INSERT IGNORE INTO paper_method
                (paper_id, method_id, evidence_note)
            VALUES (%s, %s, %s)
            """,
            (
                paper_id,
                method_id,
                f"Keyword match: {matched}",
            ),
        )


def import_works(cursor, works):
    paper_ids = {}
    author_links = 0
    topic_links = 0
    method_links = 0

    # First insert all papers so citation targets can be resolved.
    for work in works:
        paper_id = insert_paper(cursor, work)
        paper_ids[work["_openalex_id"]] = paper_id

    # Then insert authors, topics, and inferred methods.
    for work in works:
        paper_id = paper_ids[work["_openalex_id"]]

        for order, authorship in enumerate(
            work.get("authorships") or [], start=1
        ):
            author_data = authorship.get("author") or {}
            author_id = insert_author(cursor, author_data)

            if author_id is None:
                continue

            cursor.execute(
                """
                INSERT IGNORE INTO paper_author
                    (paper_id, author_id, author_order)
                VALUES (%s, %s, %s)
                """,
                (paper_id, author_id, order),
            )
            author_links += cursor.rowcount

        for topic_data in work.get("topics") or []:
            topic_id = insert_topic(cursor, topic_data)

            if topic_id is None:
                continue

            score = topic_data.get("score")
            if score is not None:
                score = max(0.0, min(1.0, float(score)))

            cursor.execute(
                """
                INSERT IGNORE INTO paper_topic
                    (paper_id, topic_id, confidence_score)
                VALUES (%s, %s, %s)
                """,
                (paper_id, topic_id, score),
            )
            topic_links += cursor.rowcount

        text = (
            (work.get("title") or "")
            + " "
            + (reconstruct_abstract(
                work.get("abstract_inverted_index")
            ) or "")
        )

        before = cursor.rowcount
        infer_methods(cursor, paper_id, text)

    # Add citation links only when both papers are in this import.
    citation_links = 0

    for work in works:
        citing_id = paper_ids[work["_openalex_id"]]

        for referenced_url in work.get("referenced_works") or []:
            cited_openalex_id = openalex_id(referenced_url)
            cited_id = paper_ids.get(cited_openalex_id)

            if cited_id is None or cited_id == citing_id:
                continue

            cursor.execute(
                """
                INSERT IGNORE INTO citation
                    (citing_paper_id, cited_paper_id, citation_context)
                VALUES (%s, %s, %s)
                """,
                (citing_id, cited_id, None),
            )
            citation_links += cursor.rowcount

    return {
        "papers": len(paper_ids),
        "authors": author_links,
        "topics": topic_links,
        "citations": citation_links,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Import real AI/ML research metadata from OpenAlex."
    )
    parser.add_argument(
        "--replace-existing",
        action="store_true",
        help="Replace existing research data while preserving USER accounts.",
    )
    args = parser.parse_args()

    api_key = os.getenv("OPENALEX_API_KEY")
    if not api_key:
        api_key = getpass.getpass("OpenAlex API key: ").strip()

    if not api_key:
        raise SystemExit("An OpenAlex API key is required.")

    mysql_password = os.getenv("MYSQL_PASSWORD")
    if mysql_password is None:
        mysql_password = getpass.getpass("MySQL password: ")

    works = fetch_works(api_key)
    if not works:
        raise SystemExit("No works were returned. Nothing was imported.")

    connection = mysql.connector.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=mysql_password,
        database=DATABASE,
    )
    cursor = connection.cursor()

    try:
        ensure_openalex_columns(cursor, connection)

        cursor.execute("SELECT COUNT(*) FROM paper")
        existing_papers = cursor.fetchone()[0]

        if existing_papers and not args.replace_existing:
            raise SystemExit(
                f"The database already contains {existing_papers} papers. "
                "Review your data, then rerun with --replace-existing "
                "if you want to replace the existing research dataset. "
                "USER accounts will be preserved."
            )

        if args.replace_existing:
            clear_research_data(cursor, connection)

        try:
            result = import_works(cursor, works)
            connection.commit()
        except Exception:
            connection.rollback()
            raise

        print("\nImport completed successfully.")
        print(f"Papers imported: {result['papers']}")
        print(f"Paper-author links: {result['authors']}")
        print(f"Paper-topic links: {result['topics']}")
        print(f"Citation links: {result['citations']}")
        print(
            "\nNote: Method labels are keyword-based estimates. "
            "Citation context text is not supplied by this import."
        )

    finally:
        cursor.close()
        connection.close()


if __name__ == "__main__":
    main()
