-- The ads console (home-ads-conversion) needs ads.read / ads.write. Seeds only grant permissions to roles
-- they create, so existing installations give them to the existing marketing and admin system roles here.
-- super_admin holds every permission through the catalog; custom roles are granted by an admin as usual.
INSERT INTO "role_permissions" ("role_key", "permission")
SELECT r."key", p.permission
FROM "roles" r
CROSS JOIN (VALUES ('ads.read'), ('ads.write')) AS p(permission)
WHERE r."key" IN ('marketing', 'admin')
ON CONFLICT DO NOTHING;
