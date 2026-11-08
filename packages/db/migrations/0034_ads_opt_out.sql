ALTER TABLE "wa_conversations" ADD COLUMN "ads_opt_out" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO "ad_placements" ("key", "page_classes", "max_per_page", "format", "size_desktop", "size_mobile", "closable", "dismiss_days", "allow_paid", "sort") VALUES
	('whatsapp.after_rx_done', ARRAY['marketing']::text[], 1, 'native', 'native', 'native', false, 7, true, 200),
	('whatsapp.after_command.help', ARRAY['marketing']::text[], 1, 'native', 'native', 'native', false, 7, true, 210),
	('whatsapp.after_command.balance', ARRAY['marketing']::text[], 1, 'native', 'native', 'native', false, 7, true, 220),
	('whatsapp.after_command.report', ARRAY['marketing']::text[], 1, 'native', 'native', 'native', false, 7, true, 230),
	('whatsapp.after_command.schedule', ARRAY['marketing']::text[], 1, 'native', 'native', 'native', false, 7, true, 240)
ON CONFLICT ("key") DO NOTHING;
