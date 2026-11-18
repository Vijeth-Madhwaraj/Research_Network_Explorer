
import json
import os
import getpass
import mysql.connector
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "research_app")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "research_network_explorer")

COLLECTION_NAME = "research_papers"
VECTOR_SIZE = 384
BATCH_SIZE = 100

password = os.getenv("MYSQL_PASSWORD")
if not password:
    password = getpass.getpass("Enter MySQL password: ")

connection = mysql.connector.connect(
    host=MYSQL_HOST,
    port=MYSQL_PORT,
    user=MYSQL_USER,
    password=password,
    database=MYSQL_DATABASE
)

cursor = connection.cursor()
cursor.execute("""
    SELECT paper_id, embedding_json, model_name
    FROM paper_embedding
    ORDER BY paper_id
""")
rows = cursor.fetchall()

print("Embeddings found in MySQL:", len(rows))

if not rows:
    raise RuntimeError("No embeddings found in paper_embedding.")

qdrant = QdrantClient(url="http://localhost:6333")

if qdrant.collection_exists(COLLECTION_NAME):
    response = input(
        "Collection already exists. Recreate it? Type YES to replace it: "
    )
    if response == "YES":
        qdrant.delete_collection(COLLECTION_NAME)
    else:
        print("Keeping existing collection. Uploading/updating points.")

if not qdrant.collection_exists(COLLECTION_NAME):
    qdrant.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(
            size=VECTOR_SIZE,
            distance=Distance.COSINE
        )
    )

points = []
uploaded = 0

for paper_id, embedding_json, model_name in rows:
    vector = (
        json.loads(embedding_json)
        if isinstance(embedding_json, str)
        else embedding_json
    )

    if len(vector) != VECTOR_SIZE:
        raise ValueError(
            "Paper {} has {} dimensions, expected {}.".format(
                paper_id, len(vector), VECTOR_SIZE
            )
        )

    points.append(
        PointStruct(
            id=int(paper_id),
            vector=vector,
            payload={
                "paper_id": int(paper_id),
                "model_name": model_name
            }
        )
    )

    if len(points) >= BATCH_SIZE:
        qdrant.upsert(
            collection_name=COLLECTION_NAME,
            points=points,
            wait=True
        )
        uploaded += len(points)
        print("Uploaded:", uploaded)
        points = []

if points:
    qdrant.upsert(
        collection_name=COLLECTION_NAME,
        points=points,
        wait=True
    )
    uploaded += len(points)

info = qdrant.get_collection(COLLECTION_NAME)

print("\nTransfer completed.")
print("Points processed:", uploaded)
print("Qdrant collection:", COLLECTION_NAME)
print("Points reported by Qdrant:", info.points_count)
print("Vector configuration:", info.config.params.vectors)

cursor.close()
connection.close()
