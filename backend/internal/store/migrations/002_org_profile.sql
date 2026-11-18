-- Free-text facts about the business that the owner wants the assistant to know
-- (what the company does, entities, fiscal year, naming conventions).
ALTER TABLE orgs ADD COLUMN profile text NOT NULL DEFAULT '';

-- Figures in an answer that were not found in the material the assistant read.
ALTER TABLE messages ADD COLUMN unverified text[] NOT NULL DEFAULT '{}';
