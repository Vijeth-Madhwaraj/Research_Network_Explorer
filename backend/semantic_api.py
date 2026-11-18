
import os
import logging
from contextlib import closing

import mysql.connector
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
COLLECTION_NAME = "research_papers"
QDRANT_URL = "http://127.0.0.1:6333"

app = FastAPI(title="Research Network Explorer Semantic API")

model = None
qdrant = None


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(5, ge=1, le=10)


@app.on_event("startup")
def startup():
    global model, qdrant

    model = SentenceTransformer(MODEL_NAME)
    qdrant = QdrantClient(url=QDRANT_URL)


@app.on_event("shutdown")
def shutdown():
    global qdrant

    if qdrant is not None:
        qdrant.close()


@app.get("/health")
def health():
    try:
        qdrant.get_collection(COLLECTION_NAME)
        return {
            "status": "ok",
            "model": MODEL_NAME,
            "collection": COLLECTION_NAME
        }
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Qdrant collection is unavailable."
        )


@app.post("/search")
def semantic_search(request: SearchRequest):
    query_text = request.query.strip()

    if not query_text:
        raise HTTPException(
            status_code=400,
            detail="Please enter a non-empty research query."
        )

    if model is None or qdrant is None:
        raise HTTPException(
            status_code=503,
            detail="Semantic search is still starting."
        )

    try:
        query_vector = model.encode(
            query_text,
            normalize_embeddings=True
        ).tolist()

        results = qdrant.query_points(
            collection_name=COLLECTION_NAME,
            query=query_vector,
            limit=request.top_k,
            with_payload=True
        ).points

        if not results:
            return {
                "success": True,
                "query": query_text,
                "count": 0,
                "papers": []
            }

        paper_ids = [int(result.id) for result in results]
        placeholders = ", ".join(["%s"] * len(paper_ids))

        sql = """
            SELECT
                paper_id,
                title,
                abstract,
                publication_year,
                doi,
                venue
            FROM paper
            WHERE paper_id IN ({})
        """.format(placeholders)

        db_config = {
            "host": os.getenv("MYSQL_HOST", "127.0.0.1"),
            "port": int(os.getenv("MYSQL_PORT", "3306")),
            "user": os.getenv("MYSQL_USER", "research_app"),
            "password": os.getenv("MYSQL_PASSWORD"),
            "database": os.getenv(
                "MYSQL_DATABASE",
                "research_network_explorer"
            )
        }

        if not db_config["password"]:
            raise HTTPException(
                status_code=500,
                detail="MYSQL_PASSWORD environment variable is missing."
            )

        with closing(mysql.connector.connect(**db_config)) as connection:
            with closing(connection.cursor(dictionary=True)) as cursor:
                cursor.execute(sql, paper_ids)
                papers = cursor.fetchall()

        papers_by_id = {
            int(paper["paper_id"]): paper for paper in papers
        }

        ordered_papers = []

        for rank, result in enumerate(results, start=1):
            paper = papers_by_id.get(int(result.id))

            if paper is None:
                continue

            ordered_papers.append({
                "rank": rank,
                "paper_id": int(paper["paper_id"]),
                "title": paper["title"],
                "abstract": paper["abstract"],
                "publication_year": paper["publication_year"],
                "doi": paper["doi"],
                "venue": paper["venue"],
                "similarity_score": round(float(result.score), 4)
            })

        return {
            "success": True,
            "query": query_text,
            "count": len(ordered_papers),
            "papers": ordered_papers
        }

    except HTTPException:
        raise
    except Exception:
        logging.exception("Semantic search failed")
        raise HTTPException(
            status_code=500,
            detail="Semantic search failed. Check the API terminal logs."
        )
