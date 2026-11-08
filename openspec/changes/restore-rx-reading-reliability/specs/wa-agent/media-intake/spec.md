## ADDED Requirements

### Requirement: Content decides the image type, not the label
An attachment whose content is a supported image type SHALL be processed even when its declared MIME type
differs; content that is not a supported type MUST still be rejected as unsupported.

#### Scenario: WebP photo labelled as JPEG
- **WHEN** WhatsApp delivers a WebP photo declared as image/jpeg
- **THEN** the photo is processed and can be analyzed

#### Scenario: Non-image content labelled as JPEG
- **WHEN** an attachment declared as image/jpeg contains no supported image format
- **THEN** it is rejected as an unsupported type and the customer is told so
