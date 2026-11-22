INSERT INTO settings (id, paid) VALUES (1, 0) ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, role, created_at) VALUES (1, 'Head Admin', 'admin', 0) ON CONFLICT DO NOTHING;
