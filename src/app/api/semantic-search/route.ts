
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const topK = Number(body.top_k ?? 5);

    if (!query || query.length > 500) {
      return NextResponse.json(
        { success: false, error: "Enter a query between 1 and 500 characters." },
        { status: 400 }
      );
    }

    if (!Number.isInteger(topK) || topK < 1 || topK > 10) {
      return NextResponse.json(
        { success: false, error: "top_k must be an integer between 1 and 10." },
        { status: 400 }
      );
    }

    const apiUrl = process.env.PYTHON_API_URL ?? "http://127.0.0.1:8000";
    const response = await fetch(`${apiUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: topK }),
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.detail ?? "Semantic search failed." },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Semantic search proxy failed:", error);
    return NextResponse.json(
      { success: false, error: "Unable to reach the semantic search service. Check that the Python API is running." },
      { status: 502 }
    );
  }
}
