## ADDED Requirements

### Requirement: Partial results are always delivered
Every line the read step extracted with any text SHALL appear in the result. A later verification verdict
MAY lower the line's certainty or flag it, but MUST NOT remove the line or discard its reading.

#### Scenario: Verification judges a read line unreadable
- **WHEN** the read step extracted text for a line and the verification step answers "unreadable" for it
- **THEN** the line appears in the result with the extracted text and an "unsure / please check" flag

#### Scenario: Verification picks a candidate it was not offered
- **WHEN** the verification answer for a read line names a product that was not offered
- **THEN** no product is shown for that line, and the line keeps its extracted text, flagged as unsure

### Requirement: Unreadable only when nothing was read
An analysis SHALL end as "unreadable image" only when no line with any extracted text exists; if at least
one line has text, the analysis MUST deliver a result.

#### Scenario: One clear line, others illegible
- **WHEN** an analysis yields one line with text and several lines judged illegible
- **THEN** the customer receives a result containing the readable line and the illegible lines flagged,
  and is charged as for a delivered result

#### Scenario: Nothing at all read
- **WHEN** an analysis yields no line with any extracted text
- **THEN** the analysis ends as unreadable image and is refunded
