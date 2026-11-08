## Purpose
Search-engine and AI-assistant discoverability of the public site: metadata, structured data, crawlability,
performance and the checks that keep them from regressing.

## ADDED Requirements

### Requirement: Complete page metadata
Every public page SHALL have a unique title and description, a canonical URL, Open Graph and Twitter card
data with an image, and language alternates for every available locale, all built by the shared metadata
helper.

#### Scenario: Home page metadata
- **WHEN** the home page HTML is fetched
- **THEN** it contains one title, one meta description, one canonical link, og:image and hreflang alternates

### Requirement: Structured data
The home page SHALL publish Organization, WebSite (with search action), SoftwareApplication and FAQPage
structured data, and every public page SHALL publish a BreadcrumbList, built by the shared builder and valid
against schema.org.

#### Scenario: FAQ answers match the page
- **WHEN** the FAQ section is edited in the admin
- **THEN** the FAQPage structured data contains exactly the questions and answers shown on the page

### Requirement: Performance budgets
On a mid-range mobile profile the home page SHALL meet LCP ≤ 2.5 s, CLS ≤ 0.05 and INP ≤ 200 ms, and its
Lighthouse SEO and accessibility scores SHALL be at least 95; CI MUST fail when a budget is broken.

#### Scenario: A heavy image is added
- **WHEN** a change makes the home page LCP exceed 2.5 s in the CI Lighthouse run
- **THEN** the CI check fails and names the metric

### Requirement: Crawl and index hygiene
Public pages SHALL be listed in the sitemap with last-modified dates, private and app pages SHALL be
`noindex` and disallowed in robots, and ad click redirects SHALL never be crawlable.

#### Scenario: Ad redirect
- **WHEN** a crawler requests an ad click URL
- **THEN** robots disallows it and the response carries `X-Robots-Tag: noindex`

### Requirement: AI assistant discoverability
The site SHALL publish an up-to-date `llms.txt` and answer-first content blocks on the home page so AI
assistants can describe the product accurately.

#### Scenario: Product facts change
- **WHEN** the free plan's monthly credits change in the admin
- **THEN** `llms.txt` and the home page show the new value without a code change
