## Purpose
Simple ads (image with caption, or text with a link) sent by the WhatsApp agent after selected moments,
with admin control of on/off, triggers and frequency, inside the agent's anti-ban and medical-safety rules.

## ADDED Requirements

### Requirement: Admin switch and triggers
WhatsApp ads SHALL be off unless an admin enables them, and SHALL be sent only after the trigger moments the
admin selects (after an analysis result is delivered, after selected commands such as help, balance, report
or schedule).

#### Scenario: Disabled
- **WHEN** WhatsApp ads are disabled in the admin
- **THEN** no ad message is sent in any conversation

#### Scenario: After an analysis
- **WHEN** a paid analysis result and its PDF have been delivered and the trigger "after analysis" is enabled
- **THEN** an ad may follow as a separate message, never before or inside the result

### Requirement: Most of the time, never every time
Each eligible trigger SHALL send an ad with an admin-set probability (default 70 %), and never more than the
admin-set maximum per user per day (default 2), with a minimum gap between two ads to the same user (default
6 hours), and at most one ad per turn.

#### Scenario: Daily cap reached
- **WHEN** a user already received the daily maximum of ads and triggers another eligible moment
- **THEN** no ad is sent

### Requirement: Image or text formats
A WhatsApp ad SHALL be either an image with a caption or a text message, both labelled «إعلان», with a
tracked link; its content is managed in the same admin creatives as web ads, with a WhatsApp channel.

#### Scenario: Image ad
- **WHEN** the selected creative has an image
- **THEN** the user receives the image with the caption, the «إعلان» label and the tracked link

### Requirement: Medical and trust floor in WhatsApp
WhatsApp ads MUST NOT advertise medicines, MUST NOT be chosen from the content of the user's prescriptions,
analyses or messages, and MUST NOT be sent after a failure, an error, a payment or order message, during an
owner takeover pause, or to users on ads-free plans.

#### Scenario: Analysis failed
- **WHEN** an analysis ends with a failure message
- **THEN** no ad follows it

#### Scenario: Prescription with a vitamin
- **WHEN** the analysis listed a vitamin D product
- **THEN** the ad chosen does not depend on that product in any way

### Requirement: Anti-ban limits
Ad messages SHALL only follow a message the user sent (inside the 24-hour window), use the agent's normal
typing and delay pacing, count toward the per-turn message cap, and stop for the day when an admin-set global
daily limit of ad messages for the number is reached (default 300).

#### Scenario: Global daily limit
- **WHEN** the number has sent the global daily limit of ad messages
- **THEN** no further ad is sent that day, and replies continue normally

### Requirement: User opt-out
When the admin allows it (on by default), a user SHALL be able to stop ads by sending «وقف الإعلانات» and
resume with «شغل الإعلانات»; the choice is remembered per user.

#### Scenario: Opted out
- **WHEN** a user sent «وقف الإعلانات»
- **THEN** no ad is sent to them until they resume

### Requirement: Measurement
Sent ads and link clicks SHALL be counted per creative, trigger and day in the same aggregate statistics as
web ads, without storing message content.

#### Scenario: Click from WhatsApp
- **WHEN** a user taps the ad link
- **THEN** the click is counted for the creative under the WhatsApp channel and the user reaches the
  destination
