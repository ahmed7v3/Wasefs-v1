import type { arPublic } from "./ar.public.js";

export const enPublic: Partial<Record<keyof typeof arPublic, string>> = {
  "admin.ai.reason.missing_key":
    "An enabled provider needs a key. Add a key or disable the provider first.",
  "admin.ai.reason.key_taken": "That provider id is already used. Choose another.",
  "admin.ai.reason.provider_in_use":
    "A provider with models cannot be deleted. Delete its models first, or disable it instead.",
  "admin.ai.reason.fake_in_production": "The fake provider is not available in production.",
  "admin.ai.reason.insecure_base_url": "The base URL is not safe. Use a public https address.",
  "admin.ai.reason.missing_base_url": "An OpenAI-compatible provider needs a base URL.",
  "admin.ai.reason.model_exists": "This model is already added to this provider.",
  "admin.ai.reason.model_in_use":
    "A model used by a route cannot be deleted. Remove it from the routes first, or disable it.",
  "admin.ai.reason.model_is_primary":
    "This model is the primary of a route. Change the route first, then disable it.",
  "admin.ai.reason.no_price_source":
    "No enabled OpenRouter provider with a key is available to fetch prices from.",
  "admin.ai.reason.sync_expired": "The preview expired. Fetch the prices again.",
  "admin.ai.reason.killswitch_permission":
    "Changing the kill switch needs a permission your account does not have.",
  "admin.routes.reason.stale_version":
    "Someone else changed this route before you. The latest version was loaded.",
  "admin.routes.reason.default_route": "The default route is edited, not removed.",
  "admin.plans.reason.plan_key_exists": "A plan with this key already exists.",
  "admin.plans.reason.plan_in_use":
    "The plan has assignments or subscriptions, so it cannot be deleted.",
  "admin.plans.reason.default_plan_required":
    "There must be a default plan. Make another plan the default first.",
  "admin.plans.reason.assignment_ended": "This assignment has already ended.",
  "admin.credits.reason.insufficient_balance": "The balance is not enough for this deduction.",
  "admin.drugs.reason.alias_exists": "This drug already has that name.",
  "admin.drugs.reason.name_empty": "The name has no letters or digits.",
  "admin.drugs.reason.dry_run_required": "A successful dry run is required before saving.",
  "admin.drugs.reason.file_expired": "The uploaded file expired. Upload it again.",
  "admin.drugs.reason.not_committed": "Only a saved batch can be rolled back.",
  "admin.drugs.reason.already_committed": "This batch was already saved.",
  "admin.drugs.reason.already_rolled_back": "This batch was already rolled back.",
  "admin.drugs.reason.file_required": "Choose a file that is not empty.",
  "admin.drugs.reason.file_too_large": "The file is larger than 20 MB.",
  "admin.drugs.reason.unsupported_file": "Unsupported file type. Upload XLSX or JSON.",
  "admin.drugs.reason.bad_upload": "The file could not be received. Try again.",
  "admin.drugs.reason.not_multipart": "The upload request is not valid.",
  "admin.drugs.reason.one_file_only": "Upload one file only.",
  "admin.reason.self_action": "You cannot do this to your own account.",
  "admin.reason.super_admin_only": "Only a super admin can do this.",
  "admin.reason.not_enough_permissions":
    "You cannot grant a role with permissions you do not have.",
  "admin.reason.last_super_admin": "This role cannot be removed: this is the last super admin.",
  "admin.reason.role_in_use": "The role is still held by users. Remove it from them first.",
  "admin.reason.role_read_only": "The super admin role is read-only and cannot be changed.",
  "admin.reason.system_role": "System roles cannot be deleted.",
  "admin.reason.invalid_status": "This cannot be done to the account in its current state.",
  "admin.reason.role_exists": "A role with this key already exists.",
  "admin.reason.whatsapp_already_linked":
    "A number is already linked. Unlink it first to link another.",
  "admin.reason.bridge_down":
    "The WhatsApp bridge is not answering. Make sure it is running and try again.",
  "admin.reason.queue_unavailable":
    "The command could not be sent to the bridge. Try again shortly.",
  "admin.access.twoFactorRequired.body":
    "The admin area needs two-factor authentication on your account. Turn it on in the security page, then come back.",
  "admin.access.twoFactorSession.body":
    "Your current session started without the two-factor code. Sign out, then sign in again and enter the code.",
  "admin.branding.reason.unsupported_type": "This file type is not supported.",
  "admin.branding.reason.type_mismatch":
    "The file's content does not match its type. Make sure it is a real image with the right extension.",
  "admin.branding.reason.too_large": "The file is larger than 512 KB.",
  "admin.branding.reason.invalid_data": "The file could not be read. Try uploading it again.",
  "admin.branding.reason.invalid_svg":
    "This SVG is not valid. Export it from your design tool as a plain SVG.",
  "admin.branding.reason.unsafe_svg":
    "This SVG contains elements that are not allowed (scripts or external links). Export it as a plain SVG without them.",
  "billing.lead.title": "Ask for a special offer for your organization",
  "billing.lead.lead":
    "Tell us how big your team is and we will get back to you with a fitting offer.",
  "billing.lead.orgName": "Organization name",
  "billing.lead.contactName": "Contact person",
  "billing.lead.seats": "Expected number of members",
  "billing.lead.message": "Your message",
  "billing.lead.seatsHint": "A rough number is enough.",
  "billing.lead.submit": "Send request",
  "billing.lead.success.title": "We got your request",
  "billing.lead.success.body": "We will contact you on the phone or email you entered.",
  "billing.lead.success.close": "Close",
  "org.reason.upgrade": "Upgrade the plan or add seats",
  "org.reason.seat_limit": "The organization reached the seat limit of its plan.",
  "org.reason.slug_taken": "This name is used by another link, choose a different one.",
  "join.pending.both":
    "Verify your email and phone number and we will complete your joining automatically.",
  "org.reason.member_cap_reached":
    "You reached your monthly cap on the organization credits. Contact the organization admin.",
  "org.reason.org_credits_exhausted":
    "The organization credits ran out. Contact the organization admin to top them up.",
  "rewardsPage.reason.vanity_used":
    "You already customized your code once; it cannot be changed again.",
  "rewardsPage.reason.code_taken": "This code is taken, choose another.",
  "rewardsPage.reason.reserved_code": "This code cannot be used, choose another.",
  "rewardsPage.reason.insufficient_points":
    "Your available points are fewer than the amount asked.",
  "rewardsPage.reason.below_minimum": "This amount is too small to give a whole credit.",
  "rewardsPage.reason.open_reward_debt":
    "You cannot convert now because refunded rewards are taken from your points first.",
  "rewardsPage.reason.idempotency_key_reused":
    "We could not confirm this request, please try again.",
};
