# rx/drug-name-resolution Specification

## Purpose
Maps a read drug name (from a prescription line or typed text) to entries in the medication database without
ever substituting a different product for what was written.

## Requirements

### Requirement: A database name is shown only when asserted
The system SHALL show a database product name as the line's answer only when the identification is
confident; otherwise it MUST show the reading as written plus at most three suggestions.

#### Scenario: Several similar brands
- **WHEN** a reading is close to two or more database brands and none is confidently identified
- **THEN** the line shows the written reading and the brands only as "did you mean" suggestions

### Requirement: Never substitute a different brand
The system MUST NOT present a database brand whose name differs from the written name as the identified
product merely because it shares an ingredient or a similar spelling.

#### Scenario: Same ingredient, different brand
- **WHEN** the written name is not in the database but another brand with the same ingredient is
- **THEN** the other brand is not shown as the line's answer

### Requirement: Model choices are restricted to offered candidates
When a model is asked to choose among database candidates, a choice that is not one of the offered
candidates MUST be discarded and MUST NOT become the line's answer.

#### Scenario: Model returns an id it was not offered
- **WHEN** the verification answer names a product id outside the offered list
- **THEN** that product is not shown for the line

### Requirement: Strength from the database only when consistent
A database strength SHALL be shown only when the product is identified and the written strength agrees or
is absent; a conflicting written strength MUST stay visible.

#### Scenario: Written strength conflicts
- **WHEN** the identified product's strength differs from the strength written on the line
- **THEN** the written strength is shown and the conflict is flagged
