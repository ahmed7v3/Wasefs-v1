-- Append to the generated migration that widens the AI_TASKS CHECK constraints with 'telegram_agent'
-- (it must run AFTER those constraints are replaced). Idempotent: safe to run twice.
-- Existing installs: seeds are insert-only, so give the new task the same routes and plan
-- entitlements wa_agent already has (an admin tunes them afterwards under AI > Routes / Plans).

-- ai_task_routes: unique on (task, coalesce(plan_id, nil-uuid), mode) -> ON CONFLICT DO NOTHING without a target.
INSERT INTO ai_task_routes (task, plan_id, mode, models, version)
SELECT 'telegram_agent', plan_id, mode, models, 1
FROM ai_task_routes
WHERE task = 'wa_agent'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- plan_entitlements: primary key (plan_id, task).
INSERT INTO plan_entitlements (plan_id, task, allowed, modes, daily_cap, monthly_cap, max_pages_per_rx, web_search)
SELECT plan_id, 'telegram_agent', allowed, modes, daily_cap, monthly_cap, max_pages_per_rx, web_search
FROM plan_entitlements
WHERE task = 'wa_agent'
ON CONFLICT DO NOTHING;
