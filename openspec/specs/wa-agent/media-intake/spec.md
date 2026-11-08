# wa-agent/media-intake Specification

## Purpose
Receives images, documents and voice notes from WhatsApp, stores them safely and makes every usable
attachment available to the agent, with an explicit reason for any attachment that cannot be used.

## Requirements

### Requirement: Accepted media types
The agent SHALL accept JPEG, PNG, WebP, HEIC and HEIF images (sent as image or document), PDF documents and
voice notes, within the shared file limits.

#### Scenario: iPhone photo sent as a document
- **WHEN** a customer sends a HEIC photo as a WhatsApp document
- **THEN** the attachment is stored and usable for prescription reading

### Requirement: Bounded download with retries
Media download MUST time out, retry a bounded number of times and request a re-upload once when the media
link has expired.

#### Scenario: Expired media link
- **WHEN** the first download fails because the media link expired
- **THEN** a re-upload is requested once and the download is retried

### Requirement: Every unusable attachment has a stated reason
An attachment that cannot be used SHALL record one reason (too large, unsupported type, download failed,
storage unavailable, expired); the customer MUST receive a message matching that reason and the agent MUST
see the reason.

#### Scenario: Download failed
- **WHEN** an image cannot be downloaded after retries
- **THEN** the customer is asked to send it again because it did not arrive, not told it is unclear

### Requirement: Every usable attachment is addressable
All usable attachments of the conversation SHALL be listed to the agent with stable handles, including
images older than the current turn and pages beyond the per-turn image limit.

#### Scenario: Second attempt on an earlier photo
- **WHEN** the customer asks to analyze a photo sent in an earlier turn
- **THEN** the agent can reference that photo by its handle and start the analysis
