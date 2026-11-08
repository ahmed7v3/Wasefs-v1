# wa-agent/turn-reliability Specification

## Purpose
Guarantees that every inbound WhatsApp message is answered exactly once, with bounded latency and cost, and
that every failure is observable.

## Requirements

### Requirement: No silent drop
Every inbound customer message SHALL end in a reply, a deferral the customer was told about, or a recorded
and alerted terminal state.

#### Scenario: Model error mid-turn
- **WHEN** the model call fails after retries during a turn
- **THEN** the customer receives a deterministic failure reply and the turn is recorded with a cause class

### Requirement: Exactly-once effects
A retried turn MUST NOT charge twice or create a second analysis, order, coupon or document.

#### Scenario: Turn retried after a crash
- **WHEN** a turn that already started an analysis is retried
- **THEN** no second analysis is created and no second charge is made

### Requirement: Bounded waits and retries
Every model call, download and lock wait SHALL have a timeout, and retries SHALL be capped; timeouts MUST be
retried before any tool has run in the turn.

#### Scenario: Step timeout before any tool
- **WHEN** a model step times out before any tool ran
- **THEN** the step is retried once before a failure reply is sent

### Requirement: Failures are classified, never auto-paused
Failures SHALL be classified (spend cap, AI disabled, provider error, timeout, internal) and MUST NOT pause
the conversation or raise a handoff automatically.

#### Scenario: Provider error
- **WHEN** the AI provider returns an error
- **THEN** the conversation is not paused and the reply matches the provider-error class

### Requirement: Every turn is traceable
Every turn SHALL have a trace with its cause class and an error reference on failure, without message
content in logs.

#### Scenario: Failed turn
- **WHEN** a turn fails
- **THEN** an error reference is stored and shown to the customer and the counter for its class increases
