# rx/failure-reasons Specification

## Purpose
Gives every analysis that ends without a result one typed reason, so the customer receives a truthful,
deterministic explanation and an accurate statement about their credits.

## Requirements

### Requirement: Every failed analysis has one typed reason
An analysis that ends without a deliverable result SHALL record exactly one reason from a closed set
(unreadable image, not a prescription, too many pages, insufficient credits, model unavailable, internal).

#### Scenario: Worker step throws
- **WHEN** a pipeline step fails with an unexpected error
- **THEN** the analysis records the reason "internal" with an error reference

### Requirement: Credit statements are truthful
A failure text MUST state that credits were returned only when the ledger shows a refund for that analysis.

#### Scenario: Nothing was charged
- **WHEN** an analysis fails before any charge was settled
- **THEN** the customer text does not claim a refund

### Requirement: No result means no charge
An analysis that produces no readable line SHALL be fully refunded through the ledger.

#### Scenario: Nothing readable
- **WHEN** an analysis finishes with zero readable lines
- **THEN** the charge is refunded and the analysis is marked refunded
