
import getpass
import os
import time

import mysql.connector
import requests


API_URL = "https://api.openalex.org/works"
DATABASE = os.getenv("MYSQL_DATABASE", "research_network_explorer")
MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")

BATCH_SIZE = 40

FIELDS = (
    "id,doi,title,publication_year,authorships,referenced_works,"
    "topics,primary_location,abstract_inverted_index"
)


def get_openalex_id(value):
    if not value:
        return None
    return value.rstrip("/").split("/")[-1]


def normalize_doi(value):
    if not value:
        return None

    value = value.strip().lower().rstrip("/")

    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if value.startswith(prefix):
            value = value[len(prefix):]

    return value or None


def reconstruct_abstract(index):
    if not index:
        return None

    words = {}
    for word, positions in index.items():
        for position in positions:
            words[position] = word

    if not words:
        return None

    return " ".join(words[position] for position in sorted(words))


def request_json(session, url, params=None):
    for attempt in range(5):
        try:
            response = session.get(url, params=params, timeout=60)

            if response.status_code == 429 or response.status_code >= 500:
                time.sleep(2 ** attempt)
                continue

            response.raise_for_status()
            return response.json()

        except requests.RequestException:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)

    raise RuntimeError("OpenAlex request failed after retries.")


def fetch_work(session, work_id, api_key):
    return request_json(
        session,
        f"{API_URL}/{work_id}",
        {"api_key": api_key, "select": FIELDS},
    )


def fetch_works_in_batches(session, work_ids, api_key):
    works = []

    for start in range(0, len(work_ids), BATCH_SIZE):
        batch = work_ids[start:start + BATCH_SIZE]

        # OpenAlex supports pipe-separated OR values for this filter.
        params = {
            "filter": "openalex_id:" + "|".join(batch),
            "per-page": len(batch),
            "select": FIELDS,
            "api_key": api_key,
        }

        data = request_json(session, API_URL, params)
        works.extend(data.get("results", []))

        print(
            f"Fetched referenced works: "
            f"{min(start + len(batch), len(work_ids))}/{len(work_ids)}"
        )

    return works


def load_existing_maps(cursor):
    cursor.execute(
        "SELECT paper_id, openalex_id, doi FROM paper"
    )

    id_to_paper = {}
    doi_to_paper = {}

    for paper_id, work_id, doi in cursor.fetchall():
        if work_id:
            id_to_paper[work_id] = paper_id

        normalized = normalize_doi(doi)
        if normalized:
            doi_to_paper[normalized] = paper_id

    return id_to_paper, doi_to_paper


def insert_or_find_paper(cursor, work, id_to_paper, doi_to_paper):
    work_id = get_openalex_id(work.get("id"))
    doi = work.get("doi")
    normalized = normalize_doi(doi)

    # Prefer exact OpenAlex identity.
    if work_id and work_id in id_to_paper:
        return id_to_paper[work_id], False

    # Reuse an existing DOI record rather than creating a duplicate.
    if normalized and normalized in doi_to_paper:
        paper_id = doi_to_paper[normalized]
        if work_id:
            id_to_paper[work_id] = paper_id
        return paper_id, False

    title = (work.get("title") or "").strip()
    if not title:
        return None, False

    year = work.get("publication_year")
    if year is not None and not 1800 <= int(year) <= 2100:
        year = None

    location = work.get("primary_location") or {}
    source = location.get("source") or {}

    venue = source.get("display_name")
    source_url = (
        location.get("landing_page_url")
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
        (
            title,
            reconstruct_abstract(work.get("abstract_inverted_index")),
            year,
            doi,
            venue,
            source_url,
            work_id,
        ),
    )

    paper_id = cursor.lastrowid

    if work_id:
        id_to_paper[work_id] = paper_id

    if normalized:
        doi_to_paper[normalized] = paper_id

    return paper_id, True


def insert_authors(cursor, work, paper_id, author_map):
    for order, authorship in enumerate(
        work.get("authorships") or [], start=1
    ):
        author_data = authorship.get("author") or {}
        author_openalex_id = get_openalex_id(author_data.get("id"))
        name = (author_data.get("display_name") or "").strip()

        if not author_openalex_id or not name:
            continue

        if author_openalex_id in author_map:
            author_id = author_map[author_openalex_id]
        else:
            cursor.execute(
                "SELECT author_id FROM author WHERE openalex_id = %s",
                (author_openalex_id,),
            )
            row = cursor.fetchone()

            if row:
                author_id = row[0]
            else:
                institutions = author_data.get("institutions") or []
                affiliation = (
                    institutions[0].get("display_name")
                    if institutions else None
                )
                country = (
                    institutions[0].get("country_code")
                    if institutions else None
                )

                cursor.execute(
                    """
                    INSERT INTO author
                        (name, affiliation, country, openalex_id)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (name, affiliation, country, author_openalex_id),
                )
                author_id = cursor.lastrowid

            author_map[author_openalex_id] = author_id

        cursor.execute(
            """
            INSERT IGNORE INTO paper_author
                (paper_id, author_id, author_order)
            VALUES (%s, %s, %s)
            """,
            (paper_id, author_id, order),
        )


def insert_topics(cursor, work, paper_id, topic_map):
    for topic_data in work.get("topics") or []:
        topic_openalex_id = get_openalex_id(topic_data.get("id"))
        name = (topic_data.get("display_name") or "").strip()

        if not name:
            continue

        if topic_openalex_id and topic_openalex_id in topic_map:
            topic_id = topic_map[topic_openalex_id]
        else:
            topic_id = None

            if topic_openalex_id:
                cursor.execute(
                    "SELECT topic_id FROM topic WHERE openalex_id = %s",
                    (topic_openalex_id,),
                )
                row = cursor.fetchone()
                if row:
                    topic_id = row[0]

            if topic_id is None:
                cursor.execute(
                    "SELECT topic_id FROM topic WHERE topic_name = %s",
                    (name,),
                )
                row = cursor.fetchone()

                if row:
                    topic_id = row[0]
                else:
                    cursor.execute(
                        """
                        INSERT INTO topic
                            (topic_name, description, openalex_id)
                        VALUES (%s, %s, %s)
                        """,
                        (
                            name,
                            topic_data.get("description"),
                            topic_openalex_id,
                        ),
                    )
                    topic_id = cursor.lastrowid

            if topic_openalex_id:
                topic_map[topic_openalex_id] = topic_id

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


def main():
    api_key = os.getenv("OPENALEX_API_KEY")
    if not api_key:
        api_key = getpass.getpass("OpenAlex API key: ").strip()

    if not api_key:
        raise SystemExit("OpenAlex API key is required.")

    mysql_password = os.getenv("MYSQL_PASSWORD")
    if mysql_password is None:
        mysql_password = getpass.getpass("MySQL password: ")

    connection = mysql.connector.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=mysql_password,
        database=DATABASE,
    )
    cursor = connection.cursor()
    session = requests.Session()

    try:
        cursor.execute(
            "SELECT paper_id, openalex_id FROM paper "
            "WHERE openalex_id IS NOT NULL"
        )
        seed_rows = cursor.fetchall()

        if not seed_rows:
            raise SystemExit(
                "No papers with OpenAlex IDs were found in the database."
            )

        print(f"Starting with {len(seed_rows)} existing papers.")

        # Fetch each seed's reference list.
        seed_works = []
        for number, (_, work_id) in enumerate(seed_rows, start=1):
            seed_works.append(fetch_work(session, work_id, api_key))

            if number % 25 == 0:
                print(f"Read references from {number}/{len(seed_rows)} seeds.")

        # Collect unique referenced OpenAlex IDs.
        referenced_ids = set()

        for work in seed_works:
            for reference in work.get("referenced_works") or []:
                reference_id = get_openalex_id(reference)
                if reference_id:
                    referenced_ids.add(reference_id)

        print(f"Unique referenced works found: {len(referenced_ids)}")

        id_to_paper, doi_to_paper = load_existing_maps(cursor)

        # Fetch referenced works to obtain metadata and DOI aliases.
        referenced_ids = sorted(referenced_ids)
        referenced_works = fetch_works_in_batches(
            session, referenced_ids, api_key
        )

        works_by_id = {
            get_openalex_id(work.get("id")): work
            for work in seed_works + referenced_works
            if get_openalex_id(work.get("id"))
        }

        # One transaction for the database changes.
        added_papers = 0
        skipped_without_metadata = 0
        author_map = {}
        topic_map = {}

        try:
            # Add missing referenced works.
            for work in referenced_works:
                paper_id, inserted = insert_or_find_paper(
                    cursor, work, id_to_paper, doi_to_paper
                )

                if paper_id is None:
                    skipped_without_metadata += 1
                    continue

                if inserted:
                    added_papers += 1

                insert_authors(cursor, work, paper_id, author_map)
                insert_topics(cursor, work, paper_id, topic_map)

            # Build citation edges for seeds and fetched referenced works.
            added_citations = 0

            for work in works_by_id.values():
                citing_openalex_id = get_openalex_id(work.get("id"))
                citing_paper_id = id_to_paper.get(citing_openalex_id)

                if citing_paper_id is None:
                    continue

                for reference in work.get("referenced_works") or []:
                    cited_openalex_id = get_openalex_id(reference)
                    cited_paper_id = id_to_paper.get(cited_openalex_id)

                    if cited_paper_id is None:
                        continue

                    if citing_paper_id == cited_paper_id:
                        continue

                    cursor.execute(
                        """
                        INSERT IGNORE INTO citation
                            (citing_paper_id, cited_paper_id, citation_context)
                        VALUES (%s, %s, NULL)
                        """,
                        (citing_paper_id, cited_paper_id),
                    )
                    added_citations += cursor.rowcount

            connection.commit()

        except Exception:
            connection.rollback()
            raise

        cursor.execute("SELECT COUNT(*) FROM paper")
        total_papers = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM citation")
        total_citations = cursor.fetchone()[0]

        cursor.execute(
            """
            SELECT COUNT(*)
            FROM (
                SELECT citing_paper_id AS paper_id FROM citation
                UNION
                SELECT cited_paper_id AS paper_id FROM citation
            ) AS connected
            """
        )
        connected_papers = cursor.fetchone()[0]

        print("\nExpansion completed.")
        print(f"New papers inserted: {added_papers}")
        print(f"Records skipped without usable titles: {skipped_without_metadata}")
        print(f"New citation links added: {added_citations}")
        print(f"Total papers now: {total_papers}")
        print(f"Total citation links now: {total_citations}")
        print(f"Papers in citation network: {connected_papers}")
        print(
            "\nNote: this is a one-hop expansion. Citation context remains NULL "
            "because OpenAlex reference metadata does not provide the citing text."
        )

    finally:
        cursor.close()
        connection.close()
        session.close()


if __name__ == "__main__":
    main()
