-- The API role needs sequence privileges for BIGSERIAL request-log inserts.
GRANT USAGE, SELECT ON SEQUENCE "publishing_api_requests_id_seq" TO wasfa_api;
