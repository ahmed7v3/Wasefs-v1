## ADDED Requirements

### Requirement: Recordings hold several samples per case
A corpus recording SHALL capture at least three independent readings of every case, and a case's result
MUST be reported as the mean over its samples, so a configuration is never judged on one lucky or
unlucky reading.

#### Scenario: Comparing two configurations
- **WHEN** hybrid and ai_only modes are compared on the corpus
- **THEN** both are recorded with the same number of samples per case and the report shows each case's
  mean lines correct and its spread

#### Scenario: Replay stays deterministic
- **WHEN** CI replays a multi-sample recording
- **THEN** every sample is replayed and the result is identical on every run
