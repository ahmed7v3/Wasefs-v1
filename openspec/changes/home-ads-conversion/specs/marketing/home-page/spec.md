## Purpose
The public landing page that presents Wasfa in the early-access visual style, explains every feature, and
turns visitors into signed-up users through standard sign-up and sign-in entry points.

## ADDED Requirements

### Requirement: Early-access visual style
The home page SHALL use the early-access visual system (mascot character, glass surfaces, halo backdrop,
reveal motion, isometric illustrations, WhatsApp chat mock) from one shared component set, so the home page
and `/early` stay visually identical.

#### Scenario: Shared primitives
- **WHEN** a visual primitive is changed in the shared set
- **THEN** both the home page and `/early` render the change without separate edits

### Requirement: Complete product story
The home page SHALL include every current home section (WhatsApp, skills, precision walkthrough, how it
works, audiences, trust, FAQ, apps, final call to action), rebuilt in the early style, with copy and order
editable from the admin homepage settings.

#### Scenario: Admin hides a section
- **WHEN** an admin disables the audiences section in the homepage settings
- **THEN** the home page no longer renders it and no empty gap remains

### Requirement: Sign-up and sign-in instead of the waitlist
Where the early page collects a phone number for the waitlist, the home page SHALL offer sign-up and
sign-in (email, social providers, WhatsApp); a signed-in visitor SHALL see a link to their dashboard instead.

#### Scenario: Visitor starts free
- **WHEN** a signed-out visitor taps the hero's primary button
- **THEN** they reach the registration page with the free plan explained

#### Scenario: Returning user
- **WHEN** a signed-in user opens the home page
- **THEN** the hero's primary button opens their dashboard

### Requirement: Responsive and accessible on every device
The home page SHALL render without horizontal scrolling and with touch targets of at least 44 px from 320 px
wide phones to wide desktops, in RTL Arabic and LTR English, and pass automated accessibility checks.

#### Scenario: Small phone
- **WHEN** the page is opened at 320×640
- **THEN** no element overflows horizontally and every interactive element is at least 44 px tall

### Requirement: Motion respects user settings
Animations SHALL be disabled or reduced when the visitor prefers reduced motion, and no animation SHALL block
reading or input.

#### Scenario: Reduced motion
- **WHEN** the operating system requests reduced motion
- **THEN** reveal and mascot animations do not play and all content is visible immediately
