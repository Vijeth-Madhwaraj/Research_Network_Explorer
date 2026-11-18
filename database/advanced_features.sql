-- Research Network Explorer · MySQL 8.0+
-- Run once against the research_network_explorer database after the base
-- tables (paper, author, paper_author, citation, paper_topic, paper_method,
-- paper_embedding) have been created by the project data importer.

-- Common joins, grouped insights and citation lookups stay selective as the
-- research network grows.
CREATE INDEX idx_paper_year_id ON paper (publication_year, paper_id);
CREATE INDEX idx_paper_author_author_paper ON paper_author (author_id, paper_id);
CREATE INDEX idx_citation_cited_citing ON citation (cited_paper_id, citing_paper_id);
CREATE FULLTEXT INDEX ft_paper_title_abstract ON paper (title, abstract);

-- Database-level input integrity for both API writes and direct SQL writes.
DELIMITER $$
CREATE TRIGGER bi_paper_validate BEFORE INSERT ON paper
FOR EACH ROW
BEGIN
  IF NEW.title IS NULL OR CHAR_LENGTH(TRIM(NEW.title)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Paper title is required.';
  END IF;
  IF NEW.publication_year IS NOT NULL AND (NEW.publication_year < 1000 OR NEW.publication_year > 2100) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Publication year must be between 1000 and 2100.';
  END IF;
END$$

CREATE TRIGGER bu_paper_validate BEFORE UPDATE ON paper
FOR EACH ROW
BEGIN
  IF NEW.title IS NULL OR CHAR_LENGTH(TRIM(NEW.title)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Paper title is required.';
  END IF;
  IF NEW.publication_year IS NOT NULL AND (NEW.publication_year < 1000 OR NEW.publication_year > 2100) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Publication year must be between 1000 and 2100.';
  END IF;
END$$

-- Aggregated read model: GROUP BY plus HAVING filters for meaningful venues.
CREATE VIEW v_research_venue_summary AS
SELECT venue, COUNT(*) AS paper_count,
       MIN(publication_year) AS first_year,
       MAX(publication_year) AS latest_year
FROM paper
WHERE venue IS NOT NULL AND TRIM(venue) <> ''
GROUP BY venue
HAVING COUNT(*) >= 3$$

-- Reusable parameterized full-text query; the UI uses prepared SQL queries
-- through its API, while this procedure is available for the DBMS demo.
CREATE PROCEDURE sp_search_papers(IN search_term VARCHAR(200))
READS SQL DATA
BEGIN
  SELECT paper_id, title, abstract, publication_year, venue, doi,
         MATCH(title, abstract) AGAINST(search_term IN NATURAL LANGUAGE MODE) AS relevance
  FROM paper
  WHERE MATCH(title, abstract) AGAINST(search_term IN NATURAL LANGUAGE MODE)
  ORDER BY relevance DESC, publication_year DESC, paper_id DESC
  LIMIT 50;
END$$
DELIMITER ;
