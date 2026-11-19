INSERT INTO users (id, email, password_hash, full_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'a@x.com', 'h', 'User A'),
  ('22222222-2222-2222-2222-222222222222', 'b@x.com', 'h', 'User B');
INSERT INTO candidates (id, email, full_name) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'shared@x.com', 'Shared Candidate'),
  ('c2000000-0000-0000-0000-000000000002', 'orphan@x.com', 'Orphan Candidate'),
  ('c3000000-0000-0000-0000-000000000003', 'only-b@x.com', 'Only B');
INSERT INTO interview_sessions (id, created_by, candidate_id, title, expires_at, created_at) VALUES
  ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'S1', now() + interval '1 day', now() - interval '3 hours'),
  ('52000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'c1000000-0000-0000-0000-000000000001', 'S2', now() + interval '1 day', now() - interval '2 hours'),
  ('53000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-000000000001', 'S3', now() + interval '1 day', now() - interval '1 hours'),
  ('54000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'c3000000-0000-0000-0000-000000000003', 'S4', now() + interval '1 day', now());
