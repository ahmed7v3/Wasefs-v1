# wa-agent/prescription-flow Specification

## Purpose
Runs a prescription analysis end to end inside a WhatsApp conversation: start, progress, paid result
delivery, failure texts and follow-up questions.

## Requirements

### Requirement: Explicit start with progress
When an analysis starts, the customer SHALL receive one short progress message that states the number of
pages being read.

#### Scenario: Two-page prescription
- **WHEN** the customer sends two prescription photos and asks for analysis
- **THEN** one progress message mentions two pages and the analysis starts once

### Requirement: Results are deterministic and complete
The analysis result SHALL be delivered as a code-generated summary (not model prose) plus the PDF report,
sent only after the full result is ready.

#### Scenario: Analysis done
- **WHEN** an analysis finishes with readable lines
- **THEN** the customer receives the complete summary message and the PDF, with no partial streamed text

### Requirement: Paid results are always delivered
The result of a paid analysis MUST reach the customer even if the turn that started it failed or the owner
paused the chat, unless the chat is blocked or the agent is disabled.

#### Scenario: Owner takeover pause
- **WHEN** a paid analysis finishes while the owner has paused the agent in that chat
- **THEN** the result is still delivered

### Requirement: Failure texts follow the typed reason
A failed analysis SHALL produce the deterministic text for its typed reason and MUST NOT use a generic
"pipeline error" or "server busy" text.

#### Scenario: Model unavailable
- **WHEN** an analysis fails because the model did not answer
- **THEN** the customer receives the model-unavailable text, not an unclear-image text

### Requirement: Medicines in replies are grounded
A drug name, strength or price in an agent reply MUST come from this conversation's analysis or tool results
or the database; ungrounded names SHALL be repaired or removed before sending.

#### Scenario: Model invents a brand
- **WHEN** the model's draft reply contains a brand not present in any tool result or the database
- **THEN** the sent reply does not contain that brand
