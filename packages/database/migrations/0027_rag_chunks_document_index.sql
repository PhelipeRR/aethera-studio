-- Without it every removal of a document scans all the chunks, which froze the app on large indexes.
CREATE INDEX rag_chunks_document_idx ON rag_chunks (document_id);
