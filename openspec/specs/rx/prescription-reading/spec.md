# rx/prescription-reading Specification

## Purpose
Turns one or more prescription images into a structured list of medication lines (name as written, strength,
form, dose, frequency, duration) with an honest per-line certainty. One engine serves the web app and the
WhatsApp agent.

## Requirements

### Requirement: One reading engine for every surface
The web app and the WhatsApp agent SHALL read prescriptions through the same worker pipeline and produce the
same stored result shape for the same images and settings.

#### Scenario: Same images on web and WhatsApp
- **WHEN** the same prescription images are analyzed once from the web and once from WhatsApp with the same
  engine settings
- **THEN** both analyses produce the same medication lines and the same per-line certainty

### Requirement: Transcribe what is written
The reading step MUST record each drug name as the letters written on the paper, with doubtful letters kept
as alternatives, and MUST NOT replace a written name with a known brand during reading.

#### Scenario: Unknown or misspelled brand
- **WHEN** a line contains a name that matches no known brand exactly
- **THEN** the stored raw reading contains the letters as read, not the closest known brand

### Requirement: Per-line certainty is always visible
Every medication line SHALL carry a certainty outcome, and lines that are not confidently identified MUST be
visibly flagged to the user rather than shown as certain.

#### Scenario: Low-confidence line
- **WHEN** a line's identification does not reach the confident threshold
- **THEN** the result shows that line with an "unsure / please check" marker and the reading that was made

### Requirement: Dosing comes from the prescription
Dose, frequency and duration MUST come from the prescription itself; database data MAY flag a conflict but
MUST NOT overwrite what the doctor wrote.

#### Scenario: Database default differs from the written dose
- **WHEN** the written dose differs from a typical dose for the matched product
- **THEN** the result keeps the written dose

### Requirement: Dosage form agrees with paper and directions
The dosage form shown for a line MUST be consistent with the form written on the paper and with the
directions (for example drops vs chewable tablets).

#### Scenario: Directions imply drops
- **WHEN** the line's directions are given in drops and a candidate product is a tablet
- **THEN** the tablet product is not shown as the identified product for that line

### Requirement: No web grounding
Prescription reading MUST NOT use web search or any external grounding source; only the images, the drug
database and the project's own data are used.

#### Scenario: Reading a prescription
- **WHEN** any prescription is analyzed
- **THEN** no web-search tool or grounding option is enabled on any model call of the analysis

### Requirement: Model outputs are validated
Every model output in the pipeline MUST be schema-validated, with at most one repair attempt; an output that
still fails validation SHALL end the step with a typed failure, never with guessed data.

#### Scenario: Malformed model output
- **WHEN** a model returns output that fails validation twice
- **THEN** the analysis records a typed failure reason and no fabricated lines

### Requirement: No prescription content in logs
Logs and traces MUST contain only codes, timings and counts for analyses, never readings, drug names, image
crops or patient data.

#### Scenario: Analysis log line
- **WHEN** an analysis finishes or fails
- **THEN** its log entries contain no drug names or readings
