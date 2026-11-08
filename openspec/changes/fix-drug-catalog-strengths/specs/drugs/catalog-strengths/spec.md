## Purpose
Turns catalog strength texts into comparable numeric values that every consumer (matching, strength
checks, search, WhatsApp tools) can trust, including European-style thousands separators.

## ADDED Requirements

### Requirement: Thousands separators in IU and mcg strengths
A catalog strength in IU or mcg written as `N.DDD` (N from 1 to 999, exactly three digits after the dot)
or `N DDD` SHALL be read as N×1000 plus DDD in that unit.

#### Scenario: Vitamin D3 with a dot separator
- **WHEN** a product's strength text is "10.000 i.u."
- **THEN** its stored strength value is 10,000 IU

#### Scenario: Biotin with a dot separator
- **WHEN** a product's strength text is "10.000 mcg"
- **THEN** its stored strength value is 10,000 mcg

#### Scenario: Space separator
- **WHEN** a product's strength text is "10 000 iu"
- **THEN** its stored strength value is 10,000 IU

### Requirement: Decimals stay decimals for other units
A strength in any unit other than IU or mcg written as `N.DDD` SHALL be read as a decimal number.

#### Scenario: Carvedilol 3.125 mg
- **WHEN** a product's strength text is "3.125 mg"
- **THEN** its stored strength value is 3.125 mg

### Requirement: Existing rows are repaired once, safely
Existing catalog rows whose stored value disagrees with the corrected reading SHALL be updated by an
idempotent repair that reports counts only; a row it cannot decide MUST be listed for admin review and
left unchanged.

#### Scenario: Repair run twice
- **WHEN** the repair runs a second time
- **THEN** it changes nothing and reports zero updates

#### Scenario: Ambiguous milligram row
- **WHEN** an mg row reads "1.000 mg" and the brand family also has a 1000 mg product
- **THEN** the row is listed for review and its value is not changed
