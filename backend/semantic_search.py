
import json
import os
import getpass
import mysql.connector
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
COLLECTION_NAME = "research_papers"
QDRANT_URL = "http://localhost:6333"
TOP_K = 5

def main():
    query_text = input("\nEnter your research query: ").strip()

    if not query_text:
        print("Please enter a non-empty query.")
        return

    print("\nLoading embedding model...")
    model = SentenceTransformer(MODEL_NAME)

    print("Generating query embedding...")
    query_vector = model.encode(
        query_text,
        normalize_embeddings=True
    ).tolist()

    qdrant = QdrantClient(url=QDRANT_URL)

    print("Searching Qdrant...")
    results = qdrant.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=TOP_K,
        with_payload=True
    ).points

    if not results:
        print("No matching papers found.")
        return

    password = os.getenv("MYSQL_PASSWORD")
    if not password:
        password = getpass.getpass("Enter MySQL password: ")

    connection = mysql.connector.connect(
        host=os.getenv("MYSQL_HOST", "127.0.0.1"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "research_app"),
        password=password,
        database=os.getenv("MYSQL_DATABASE", "research_network_explorer")
    )

    cursor = connection.cursor(dictionary=True)

    paper_ids = [int(result.id) for result in results]
    placeholders = ", ".join(["%s"] * len(paper_ids))

    sql = f"""
        SELECT paper_id, title, abstract, publication_year, DOI, venue
        FROM paper
        WHERE paper_id IN ({placeholders})
    """

    cursor.execute(sql, paper_ids)
    papers = cursor.fetchall()
    papers_by_id = {paper["paper_id"]: paper for paper in papers}

    print("\n" + "=" * 75)
    print("SEMANTIC SEARCH RESULTS")
    print("=" * 75)

    for rank, result in enumerate(results, start=1):
        paper = papers_by_id.get(int(result.id))

        if paper is None:
            continue

        print("\n{}. {}".format(rank, paper["title"]))
        print("   Paper ID:", paper["paper_id"])
        print("   Publication year:", paper["publication_year"])
        print("   Similarity score: {:.4f}".format(result.score))
        print("   Venue:", paper["venue"])
        print("   DOI:", paper["DOI"])

        abstract = paper["abstract"]
        if abstract:
            preview = abstract[:400]
            if len(abstract) > 400:
                preview += "..."
            print("   Abstract:", preview)
        else:
            print("   Abstract: Not available")

    cursor.close()
    connection.close()
    qdrant.close()

if __name__ == "__main__":
    main()
