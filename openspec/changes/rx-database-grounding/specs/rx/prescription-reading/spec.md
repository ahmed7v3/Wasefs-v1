## ADDED Requirements

### Requirement: Directions are re-read on unclear lines
For every line whose legibility is not clear, the verification step SHALL re-read the meal relation and
bedtime instruction. A disagreement with the first reading MUST flag the line and show both readings,
never pick one silently.

#### Scenario: Before meals read as before bedtime
- **WHEN** the first reading says "before bedtime" and the re-read says "before meals"
- **THEN** the line is flagged and both readings are visible to the user

### Requirement: Duration only when written or calculated from the paper
A line's duration SHALL come from a duration written on the prescription, or be calculated from a written
quantity and the read frequency and labelled as calculated. No default duration MUST be invented.

#### Scenario: Pack of 20, five days a week
- **WHEN** a line says one tablet five days a week and the quantity 20 tablets is written
- **THEN** the duration is shown as about 4 weeks, labelled as calculated from 20 tablets

#### Scenario: Nothing written
- **WHEN** a line has neither a duration nor a quantity on the paper
- **THEN** no duration is shown and no 30-day default appears in the result, PDF or WhatsApp message

### Requirement: Suggested times follow the written timing
Suggested dose times SHALL follow the timing written on the line (meal relation, morning/evening,
bedtime); without written timing the existing default convention applies, always labelled as suggested.

#### Scenario: Written before meals
- **WHEN** a once-daily line says «قبل الأكل»
- **THEN** the suggested time is placed before a meal and is not a bedtime slot

### Requirement: A second reading never replaces the first name
When the verification step reads a line's name differently from the first reading, the line SHALL keep
the first reading as its name and MUST show the second reading next to it, flagged; neither is chosen.

#### Scenario: Re-read turns into another drug
- **WHEN** the first reading is "Gabiimash 5" and the verification re-read says "Glibimet 5"
- **THEN** the line's name stays "Gabiimash" with «قراءة ثانية: Glibimet 5» shown and the line flagged unsure

### Requirement: Verification failure never loses the reading
When the verification call fails (provider error, timeout, invalid answer), the analysis SHALL still be
delivered with every line's first reading, marked as not re-checked; only the overall time budget
running out may end the analysis.

#### Scenario: Verify provider rejects the key
- **WHEN** the verification provider answers 403 for an analysis whose read step succeeded
- **THEN** the analysis is delivered with the read lines marked not re-checked and is charged as delivered
