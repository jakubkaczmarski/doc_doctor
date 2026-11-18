-- What a document relates to, beyond its type:
--   category = business area (purchases, premises, taxes, ...)
--   subject  = one short line saying what it is about
ALTER TABLE documents ADD COLUMN category text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN subject  text NOT NULL DEFAULT '';
CREATE INDEX documents_org_category ON documents (org_id, category);
