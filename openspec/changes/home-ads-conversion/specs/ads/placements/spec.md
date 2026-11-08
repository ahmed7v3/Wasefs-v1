## Purpose
First-party advertising: a catalog of placements, creatives from house offers and direct-sold advertisers,
delivery rules that protect users and search, full admin control, and aggregate measurement.

## ADDED Requirements

### Requirement: Non-configurable safety floor
Ads MUST NOT appear on results, history, chat, checkout, payment, order, account, admin or legal pages;
every ad MUST be labelled «إعلان» / "Sponsored"; medicines MUST NOT be advertised; ad selection MUST NOT use
health data; ad links MUST carry `rel="sponsored noopener"`. No admin setting can change these.

#### Scenario: Admin enables ads everywhere
- **WHEN** an admin enables every placement and page class
- **THEN** analysis result, chat and checkout pages still render no ad

#### Scenario: Medicine creative
- **WHEN** an admin tries to approve a creative whose category is medicine
- **THEN** the approval is refused with the reason

### Requirement: Admin-managed placements
Admins SHALL be able to enable or disable each placement and the whole ad system, set per-page density
limits, choose which page classes and devices a placement serves, and preview it, without a deploy.

#### Scenario: Turn a placement off
- **WHEN** an admin disables the home mid-page placement
- **THEN** the next page render no longer reserves or shows that slot

### Requirement: Admin-managed creatives
Admins SHALL create creatives with image (from the media library, with alt text), title, destination URL,
advertiser or house flag, schedule (start/end), weight, and targeting by placement, page class, device class,
locale and country; a creative is served only while approved, active and inside its schedule.

#### Scenario: Scheduled campaign
- **WHEN** a creative's end date passes
- **THEN** it stops being served without any admin action

### Requirement: Closable bottom banner
A bottom banner placement SHALL be available on page classes the admin selects; it MUST reserve its space so
it never covers content, close with one tap, and stay closed for an admin-set number of days on that device.

#### Scenario: Visitor closes the banner
- **WHEN** a visitor closes the bottom banner
- **THEN** it disappears immediately, the page reflows without covering content, and it does not return on
  that device until the configured period ends

### Requirement: No layout shift and no blocking
Every ad slot SHALL have its box reserved in the server-rendered HTML and SHALL load without blocking the
page; an empty slot MUST collapse without shifting content already shown.

#### Scenario: No creative available
- **WHEN** a placement has no eligible creative
- **THEN** the slot renders nothing and the measured CLS of the page stays within budget

### Requirement: Ad-free plans
Users on plans with the `ads_free` entitlement SHALL see no ads in app pages; the entitlement is editable per
plan in the admin and on by default for paid plans.

#### Scenario: Paid subscriber
- **WHEN** a user with an ads-free plan opens the dashboard
- **THEN** no ad slot is rendered

### Requirement: Aggregate measurement
Impressions (slot at least half visible for one second) and clicks (through a first-party redirect) SHALL be
counted per creative, placement and day, without cookies or user identifiers, and shown in the admin with
click-through rate.

#### Scenario: Click
- **WHEN** a visitor clicks an ad
- **THEN** they reach the destination through the redirect and the creative's click count for that day grows
  by one, with no user id stored
