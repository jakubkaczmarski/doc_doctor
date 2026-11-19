-- What the user said about a document, and how sure automatic detection was.
--   user_set   names the fields the user set by hand (doc_type, category, title, subject).
--              Those are never overwritten when the document is read again.
--   user_note  the user's own words about what the document is.
--   type_sure  false when detection was unsure, so the interface asks the user.
ALTER TABLE documents ADD COLUMN user_set  text[]  NOT NULL DEFAULT '{}';
ALTER TABLE documents ADD COLUMN user_note text    NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN type_sure boolean NOT NULL DEFAULT true;
