
import os
import json
import hashlib
import getpass
import mysql.connector
from sentence_transformers import SentenceTransformer

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
BATCH_SIZE = 32

DB_CONFIG = {
    "host": os.getenv("MYSQL_HOST", "localhost"),
    "port": int(os.getenv("MYSQL_PORT", "3306")),
    "user": os.getenv("MYSQL_USER", "root"),
    "password": os.getenv("MYSQL_PASSWORD") or getpass.getpass(
        "Enter MySQL password: "
    ),
    "database": os.getenv(
        "MYSQL_DATABASE", "research_network_explorer"
    ),
}

def main():
    print("=" * 65)
    print("RESEARCH NETWORK EXPLORER - EMBEDDING GENERATION")
    print("=" * 65)

    connection = mysql.connector.connect(**DB_CONFIG)
    cursor = connection.cursor()

    cursor.execute("""
        SELECT paper_id, title, abstract
        FROM paper
        WHERE title IS NOT NULL AND TRIM(title) <> ''
        ORDER BY paper_id
    """)

    papers = cursor.fetchall()
    print(f"Paper records loaded: {len(papers)}")

    model = SentenceTransformer(MODEL_NAME)
    print("Embedding model loaded.")

    insert_sql = """
        INSERT INTO paper_embedding
            (paper_id, embedding_json, model_name, text_hash)
        VALUES (%s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            embedding_json = VALUES(embedding_json),
            model_name = VALUES(model_name),
            text_hash = VALUES(text_hash)
    """

    processed = 0

    try:
        for start in range(0, len(papers), BATCH_SIZE):
            batch = papers[start:start + BATCH_SIZE]

            texts = []
            metadata = []

            for paper_id, title, abstract in batch:
                title = title.strip()
                abstract = (abstract or "").strip()

                if abstract:
                    text = f"{title}. {abstract}"
                else:
                    text = title

                text_hash = hashlib.sha256(
                    text.encode("utf-8")
                ).hexdigest()

                texts.append(text)
                metadata.append((paper_id, text_hash))

            vectors = model.encode(
                texts,
                batch_size=BATCH_SIZE,
                show_progress_bar=False,
                normalize_embeddings=True,
                convert_to_numpy=True
            )

            rows = []

            for (paper_id, text_hash), vector in zip(
                metadata, vectors
            ):
                embedding_json = json.dumps(
                    vector.tolist(),
                    separators=(",", ":")
                )

                rows.append((
                    paper_id,
                    embedding_json,
                    MODEL_NAME,
                    text_hash
                ))

            cursor.executemany(insert_sql, rows)
            connection.commit()

            processed += len(batch)
            print(f"Processed {processed}/{len(papers)} papers")

        print("\nEmbedding generation completed successfully.")

        cursor.execute("SELECT COUNT(*) FROM paper_embedding")
        total_embeddings = cursor.fetchone()[0]

        print(f"Total stored embeddings: {total_embeddings}")

        cursor.execute("""
            SELECT paper_id, model_name,
                   JSON_LENGTH(embedding_json) AS dimensions
            FROM paper_embedding
            LIMIT 5
        """)

        print("\nSample verification:")
        for row in cursor.fetchall():
            print(row)

    finally:
        cursor.close()
        connection.close()


if __name__ == "__main__":
    main()
