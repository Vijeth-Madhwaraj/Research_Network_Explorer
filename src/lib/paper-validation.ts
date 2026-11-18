export type PaperInput = {
  title?: unknown;
  abstract?: unknown;
  publication_year?: unknown;
  venue?: unknown;
  doi?: unknown;
  source_url?: unknown;
};

export function validatePaper(body: PaperInput) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const abstract = typeof body.abstract === "string" ? body.abstract.trim() : "";
  const venue = typeof body.venue === "string" ? body.venue.trim() : "";
  const doi = typeof body.doi === "string" ? body.doi.trim() : "";
  const sourceUrl = typeof body.source_url === "string" ? body.source_url.trim() : "";
  const year = body.publication_year === "" || body.publication_year == null
    ? null
    : Number(body.publication_year);

  if (!title || title.length > 1000) return { error: "Title is required and must be 1,000 characters or fewer." };
  if (abstract.length > 50000 || venue.length > 500 || doi.length > 500 || sourceUrl.length > 2000) {
    return { error: "One or more fields exceed the allowed length." };
  }
  if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 2100)) {
    return { error: "Publication year must be between 1000 and 2100." };
  }
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return { error: "Source URL must start with http:// or https://." };

  return { value: { title, abstract: abstract || null, year, venue: venue || null, doi: doi || null, sourceUrl: sourceUrl || null } };
}
