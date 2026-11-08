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
The home page SHALL publish Organization, WebSite (with a search action only once a public search page exists), SoftwareApplication and FAQPage
structured data, and every public page SHALL publish a BreadcrumbList, built by the shared builder and valid
against schema.org.

#### Scenario: FAQ answers match the page
- **WHEN** the FAQ section is edited in the admin
- **THEN** the FAQPage structured data contains exactly the questions and answers shown on the page

### Requirement: Performance budgets
The home page SHALL target real-user LCP ≤ 2.5 s, CLS ≤ 0.05 and INP ≤ 200 ms. In CI, on a simulated mid-range
mobile profile, Lighthouse performance MUST be ≥ 0.9, CLS ≤ 0.05, blocking time ≤ 200 ms and simulated LCP
≤ 3.8 s, with SEO and accessibility ≥ 0.95; CI MUST fail when one of these is broken.

#### Scenario: A heavy image is added
- **WHEN** a change makes the home page's simulated LCP exceed 3.8 s or its performance score drop below 0.9
- **THEN** the CI check fails and names the metric

#### Scenario: Why simulated LCP is not 2.5 s
- **WHEN** the framework alone (about 160 KB of JavaScript) puts simulated LCP near 2.9 s while real LCP is under 1 s
- **THEN** the CI gate catches regressions above 3.8 s and the 2.5 s target is checked on real-user data

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
