# AI cost runbook

Written for the person who runs the money side of Wasfa AI, with no coding needed. Everything below is done in the admin panel under **AI** (`/admin/ai`) unless it says otherwise.

## 1. The controls, in plain words

| Control | Where | What it does |
|---|---|---|
| **Providers** | AI > Providers | The companies we call (Gemini, OpenRouter, any OpenAI-compatible service). Each has an API key (stored encrypted, shown as `••••abcd`, never readable again), an on/off switch and a data policy. "Test connection" makes the cheapest possible call. A provider with no key or switched off is never called. |
| **Models** | AI > Models | The model names we may use, with prices (USD per 1M tokens) and a **credit multiplier**. You can pick a discovered model or type any model id by hand. A yellow badge means the price is older than 30 days or the model is a "preview" (previews can disappear). |
| **Routes** | AI > Routes | For each task (read prescription, verify, chat, deep thinking, titles...) and mode (fast, balanced, deep): the main model, the backups in order, thinking level, image detail, max output and search. Saving creates a new version. Backups are used only when the main model is down, slow or rate-limited, never for a bad request. |
| **Plans** | Plans | How many credits a plan gets each month, which tasks and modes it may use, daily caps per task, and how many pages a prescription may have. |
| **Credits** | Credits | Look up any wallet and its history. Adjusting a wallet needs a written reason and is recorded forever. |
| **Daily spend cap** | AI > Overview / settings | The most we are willing to pay providers in one UTC day. At the alert percent (default 80%) a warning is logged once; at 100% new AI work is refused with the friendly "الخدمة مزدحمة الآن" message until the next UTC day or until you raise the cap. |
| **Kill switch** | AI > Overview | Stops one task (prescription, chat, search) or everything at once, instantly. Users see the same friendly message. Needs your password again and a typed confirmation. |

How a user is charged: a prescription costs a fixed number of credits per page (setting `rx.creditsPerPage`, shown before they press Analyze). Chat is metered by what the model actually used, rounded up, at least 1 credit per message. Credits are **reserved first** and settled after; if anything fails the reserve is given back. A prescription we cannot read at all is refunded in full. The value of one credit in dollars is `creditValueUsdMicros` (default 10,000 = $0.01).

**Prescription reading switches** (Admin > Settings > `rx`): `drugMatching` (off by default) makes the reading rely on the model alone; switch it on only after the drug database is imported and you have checked, on the evaluation set, that matching helps. `details` (on by default) adds the per-drug information and the overview with one extra short text-only call per analysis (medicine names only, about 400-1,500 output tokens); switch it off to save that cost.

## 2. Changing a model safely

1. Add the new model in **Models** (type its id, set its prices from the provider's pricing page, leave it enabled but unused).
2. Run the evaluation (**AI > Evals**) on your labelled prescriptions with the new model against the current one. Look at drug-name accuracy, **fabrication rate** (must stay near zero) and cost per analysis.
3. Only if it is as good (within 1 point) and cheaper or faster, edit the **Route** and put it first. If it scores more than 1 point lower the panel asks for a written reason; do not skip it.
4. Watch **Overview** for a day: error rate, fallback rate, average and p95 cost per analysis.
5. To go back, edit the route again: every change is versioned and audited.

Never switch a medical task to a provider whose data policy is `free_tier`; the system refuses it, and so should you.

## 3. When spend spikes

1. Open **AI > Overview**. Look at "today vs cap" and the per-task, per-model bars.
2. If it is climbing fast and you do not know why: **flip the kill switch for the task** (or all). This is always safe; users just see the busy message.
3. Open **Usage** and filter by today and by outcome. One user or organization with thousands of calls is abuse: suspend them (Users > Suspend ends their sessions at once).
4. If a model got more expensive or a backup is looping, open **Routes** and fix the order, or disable the model.
5. Lower **dailyCapUsdMicros** so the damage is bounded, then switch the task back on.
6. Afterwards: check the ledger of the affected wallets (**Credits**) and adjust any wrongful charges with a reason.

If spend is high but users report nothing wrong, compare **cost per analysis** with last week; a jump usually means a price change or a route that now always falls back to a pricier model.

## 4. Reading cost per analysis

On Overview: **average cost per analysis** and **p95** (the expensive 5%). Cost is what providers charged us (from token counts times the model prices; OpenRouter reports its own cost). Compare it with the credits users pay: one page = `creditsPerPage` credits x `creditValueUsdMicros`. If the average cost is above the price, raise `creditsPerPage` or move to a cheaper route (after an evaluation). Cache hits cost us nothing, so a high cache-hit rate is good news.

## 5. Monthly price check (10 minutes, first working day)

1. Open each provider's pricing page and compare with **Models**. Gemini prices change; OpenRouter prices can be synced: **Models > Sync prices from OpenRouter**, read the diff, apply.
2. Update any model whose price differs; this stamps "price checked" and clears the yellow badge.
3. Check **Overview** for models with calls but price 0 (a model at price 0 records zero cost, which hides real spend).
4. Look at the last 30 days of cost per analysis. Decide if `creditsPerPage` still covers it.
5. Confirm backups still exist: a preview model with no stable alternative is a risk.

## 6. Rotating the encryption key (rare)

If the server's `ENCRYPTION_KEY` may have leaked: generate a new one (`openssl rand -base64 32`), run `ENCRYPTION_KEY_OLD=<old> ENCRYPTION_KEY=<new> pnpm --filter @wasfa/api key:rotate --dry-run`, then again without `--dry-run`, put the new key in `.env.prod` and redeploy. Because the old key may be known, also create new API keys at each provider and enter them in **Providers**. Details: `SECURITY.md` section 6.

## 7. Alerts you should expect

Logged today (a chat alert channel arrives later): spend reached the alert percent (`ai.spend_alert`), spend cap reached, a model's circuit breaker opened (5 failures in 60 seconds, skipped for 60 seconds), wallet balance drift found by the nightly check (`credits.drift`, should always be zero), and an evaluation score regression (`eval.regression`).
