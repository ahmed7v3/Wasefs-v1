## Purpose
Upgrade moments that turn free users into subscribers at the right time, in the right form, with truthful
copy, under admin control and frequency limits that protect the experience.

## ADDED Requirements

### Requirement: Prompt forms
Each prompt SHALL have a form, inline card, banner or modal, set in the admin; a modal is allowed only for
the moments marked as calm (trial ended, credits out) and only on calm surfaces.

#### Scenario: Modal form on a non-calm moment
- **WHEN** an admin tries to set the "credits low" prompt to modal
- **THEN** the admin refuses it and explains that modals are only for calm moments

### Requirement: Trial-ended moment
When a free user's first free trial or welcome credits are used up, the next calm surface they open SHALL
show the trial-ended prompt naming a concrete plan and what it adds (more analyses per month, deeper
analysis mode), with the plan's real price and a one-tap close.

#### Scenario: First trial used up
- **WHEN** a free user has spent their welcome credits and opens the dashboard
- **THEN** a modal names the recommended plan, its monthly analyses and price, and can be closed with one tap

### Requirement: Credits-out moment
When a free user's balance reaches zero, the next calm surface SHALL show the credits-out prompt with the date
their free credits renew first, then the plans and credit packs.

#### Scenario: Analyze start screen with zero credits
- **WHEN** a free user with zero credits opens the analyze start screen
- **THEN** the credits-out prompt is shown before any upload, with the free renewal date and plan options

### Requirement: Calm moments only
A prompt MUST NOT appear during an upload, while an analysis runs, on a result, on an error screen, or during
checkout; calm surfaces are the dashboard and the analyze start screen before any upload.

#### Scenario: Analysis running
- **WHEN** a trigger becomes true while the user waits for an analysis
- **THEN** no prompt is shown until the user next opens a calm surface

### Requirement: Frequency limits
At most one upgrade prompt SHALL be shown per session; a dismissed prompt SHALL wait its cooldown (default 7
days, doubling after each dismissal, at most 60 days) before showing again.

#### Scenario: Dismissed twice
- **WHEN** a user dismisses the trial-ended prompt for the second time
- **THEN** it does not return for 14 days

### Requirement: Truthful copy from real entitlements
Prompt copy SHALL take plan names, prices, monthly analyses and features from the plans and entitlements
data; copy MUST NOT claim health outcomes or accuracy gains that the plan's features do not provide.

#### Scenario: Price change
- **WHEN** an admin changes a plan's price
- **THEN** every prompt naming that plan shows the new price without editing the prompt

### Requirement: Admin control of prompts
Admins SHALL enable or disable each prompt and the whole system, set its form, Arabic and English copy, target
plan, call-to-action destination and cooldown, preview it, and see shown, clicked and dismissed counts.

#### Scenario: Disable a prompt
- **WHEN** an admin disables the credits-low prompt
- **THEN** no user sees it from the next request on
