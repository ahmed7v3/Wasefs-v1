## MODIFIED Requirements

### Requirement: A database name is shown only when asserted
The system SHALL show a database product name as the line's answer only when the reading equals that
brand after normalization; otherwise it MUST show the reading as written plus at most three database
brands as "did you mean" suggestions.

#### Scenario: Several similar brands
- **WHEN** a reading is close to two or more database brands and none is confidently identified
- **THEN** the line shows the written reading and the brands only as "did you mean" suggestions

#### Scenario: One letter away from a real brand
- **WHEN** the reading is "Avirocoxib 90" and the database has "Averocoxib 90 mg"
- **THEN** the line's name is "Avirocoxib" and "Averocoxib" is offered as a suggestion, not as the answer

#### Scenario: Exact brand
- **WHEN** the reading equals a database brand after normalization
- **THEN** the database product is shown as the line's answer

### Requirement: Strength from the database only when consistent
A database strength SHALL be shown only when the line has no written strength and the product is
identified; a written strength MUST always be shown as written, whatever the database says.

#### Scenario: Written strength conflicts
- **WHEN** the identified product's strength differs from the strength written on the line
- **THEN** the written strength is shown and the conflict is flagged

#### Scenario: Catalog value cannot be compared
- **WHEN** the line reads "Dixvit 10,000" and the catalog stores the product as "10 iu"
- **THEN** the line shows 10,000 as written

#### Scenario: No strength written
- **WHEN** the line has no strength and the product is identified by an exact match
- **THEN** the database strength may fill it

## ADDED Requirements

### Requirement: Impossible strengths are never shown as certain
When a line's written strength does not exist for its matching brand family or its active ingredient in
the database, the system SHALL re-read the strength once and, if it is still impossible, MUST flag the
line with the strengths that exist instead of presenting the number as certain. It MUST NOT replace it.

#### Scenario: Etoricoxib read as 200 mg
- **WHEN** a line reads "Averocoxib 200" and the family exists only in 30, 60, 90 and 120 mg
- **THEN** the strength is re-read, and if it is still 200 the line is flagged «راجع التركيز» with
  30/60/90/120 listed and no 200 mg shown as certain

#### Scenario: Re-read gives a valid strength
- **WHEN** the re-read of that strength returns 90
- **THEN** the line shows 90 and records that the strength was re-read

### Requirement: Grounding never depends on matching being an answer
The database comparison (suggestions, strength families) SHALL run for every read line whenever the
medications feature is enabled, independent of whether a database name becomes the answer.

#### Scenario: Out-of-vocabulary reading
- **WHEN** a line reads "Mnteplia plus" and the database has "Metapsin plus"
- **THEN** the result keeps "Mnteplia plus", flags it unsure, and offers "Metapsin plus" if it is among
  the candidates (measured on corpus case rx-001)

### Requirement: Suggestions fit the line's form
A database brand SHALL be offered as a suggestion only when its dosage form is compatible with the form
written on the line or implied by its directions; when the line's form is unknown, no form filter applies.

#### Scenario: Capsule line, cream in the database
- **WHEN** a capsule line reads "Relaxan" and the closest database brand is "RELAX CREAM 50 GM"
- **THEN** the cream is not offered as a suggestion
