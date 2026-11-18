-- Tutorial objects used by the Admin Dashboard's Database Feature Lab.
-- Run after the base tables exist. Views are replaced; the audit table/data
-- are preserved; the named procedure and trigger are recreated.

CREATE TABLE IF NOT EXISTS paper_audit (
    audit_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    paper_id BIGINT NOT NULL,
    old_title VARCHAR(1000),
    new_title VARCHAR(1000),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    action_type VARCHAR(20) NOT NULL
) ENGINE=InnoDB;

CREATE OR REPLACE VIEW v_paper_details AS
SELECT
    p.paper_id,
    p.title,
    p.abstract,
    p.publication_year,
    p.doi,
    p.venue,
    p.source_url,
    p.openalex_id
FROM paper p;

CREATE OR REPLACE VIEW v_paper_authors AS
SELECT
    pa.paper_id,
    a.author_id,
    a.name AS author_name,
    a.affiliation,
    a.country,
    pa.author_order
FROM paper_author pa
JOIN author a ON a.author_id = pa.author_id;

CREATE OR REPLACE VIEW v_paper_topics AS
SELECT
    pt.paper_id,
    t.topic_id,
    t.topic_name,
    pt.confidence_score
FROM paper_topic pt
JOIN topic t ON t.topic_id = pt.topic_id;

CREATE OR REPLACE VIEW v_paper_citation_stats AS
SELECT
    p.paper_id,
    p.title,
    (SELECT COUNT(*) FROM citation c WHERE c.cited_paper_id = p.paper_id) AS incoming_citations,
    (SELECT COUNT(*) FROM citation c WHERE c.citing_paper_id = p.paper_id) AS outgoing_citations
FROM paper p;

CREATE OR REPLACE VIEW v_paper_methods AS
SELECT
    pm.paper_id,
    m.method_id,
    m.method_name,
    m.description,
    pm.evidence_note
FROM paper_method pm
JOIN method m ON m.method_id = pm.method_id;

DROP PROCEDURE IF EXISTS GetPaperDetails;
DROP TRIGGER IF EXISTS trg_paper_title_update;

DELIMITER $$

CREATE PROCEDURE GetPaperDetails(IN p_paper_id BIGINT)
BEGIN
    SELECT
        p.paper_id,
        p.title,
        p.abstract,
        p.publication_year,
        p.doi,
        p.venue,
        p.source_url
    FROM paper p
    WHERE p.paper_id = p_paper_id;

    SELECT
        a.author_id,
        a.name,
        a.affiliation,
        pa.author_order
    FROM paper_author pa
    JOIN author a ON a.author_id = pa.author_id
    WHERE pa.paper_id = p_paper_id
    ORDER BY pa.author_order, a.name;

    SELECT
        t.topic_id,
        t.topic_name,
        pt.confidence_score
    FROM paper_topic pt
    JOIN topic t ON t.topic_id = pt.topic_id
    WHERE pt.paper_id = p_paper_id
    ORDER BY pt.confidence_score DESC, t.topic_name;
END$$

CREATE TRIGGER trg_paper_title_update
AFTER UPDATE ON paper
FOR EACH ROW
BEGIN
    IF NOT (OLD.title <=> NEW.title) THEN
        INSERT INTO paper_audit (paper_id, old_title, new_title, action_type)
        VALUES (OLD.paper_id, OLD.title, NEW.title, 'TITLE_UPDATE');
    END IF;
END$$

DELIMITER ;
