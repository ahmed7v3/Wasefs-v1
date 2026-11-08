## ADDED Requirements

### Requirement: Unreadable image is reserved for decoded, read images
The "unreadable image" reason SHALL be used only when the images were decoded and analyzed and nothing was
read. An upload rejected before analysis (unsupported type, too large, corrupt, unsupported PDF) MUST be
reported with its own rejection reason.

#### Scenario: Multi-page PDF rejected
- **WHEN** a customer's PDF is rejected because multi-page PDFs are not supported
- **THEN** the customer is told the PDF format is the problem and how to send it instead, not that the image
  is unclear

#### Scenario: Corrupt file
- **WHEN** an uploaded image cannot be decoded
- **THEN** the customer is asked to send the photo again because the file is damaged, not told it is unclear
