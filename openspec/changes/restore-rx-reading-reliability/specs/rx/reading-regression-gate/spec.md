## Purpose
Keeps prescription reading from silently regressing: a corpus of owner-verified real prescriptions with
expected lines is replayed against every change to the reading engine, its media intake or its prompts.

## ADDED Requirements

### Requirement: Owner-verified regression corpus
The project SHALL maintain a corpus of real, de-identified prescriptions, each with expected medication
lines confirmed by the owner, including every case reported as misread or refused.

#### Scenario: A misreading is reported
- **WHEN** the owner reports a prescription that was misread or refused
- **THEN** that prescription is added to the corpus with its expected lines before the fix is merged

### Requirement: Deterministic replay at zero provider cost
The corpus SHALL run in CI by replaying recorded model responses, so code-only changes are checked
deterministically with no provider calls.

#### Scenario: Code-only change in CI
- **WHEN** a pull request changes rx pipeline, matcher or media code but not prompts or model routes
- **THEN** CI replays the corpus with recorded responses and makes no provider call

### Requirement: Prompt and model changes re-record
A change to a prompt, skill text, model route or model parameters MUST be accompanied by a fresh live run
of the corpus whose recordings replace the old ones.

#### Scenario: Prompt edited
- **WHEN** a change edits the prescription-reading prompt
- **THEN** the change includes a new live corpus run and its updated recordings

### Requirement: No regression is accepted
A change SHALL NOT be merged if any corpus case that passed before now fails, or if the share of corpus
lines read correctly decreases.

#### Scenario: One case breaks
- **WHEN** a change makes a previously passing corpus case produce a refusal or a wrong name
- **THEN** the regression check fails and names the case and the line

### Requirement: Corpus data stays private
Corpus images MUST be de-identified (patient and doctor names and phones masked) and MUST NOT be committed
to the repository if they contain any personal data.

#### Scenario: Adding an image
- **WHEN** a new prescription image is added to the corpus
- **THEN** personal identifiers are masked and the image is stored outside git, referenced by hash
