# Security Policy

## Reporting

Please report a suspected vulnerability privately to `support@symbioai.dev`.
Do not open a public issue containing credentials, personal information, or
reproduction steps that could harm a customer.

Include the affected URL or file, impact, and the smallest reproducible example.
Symbio AI will acknowledge a report as quickly as practical and coordinate a fix
before public disclosure.

## Supported Version

Only the current production deployment and the default branch receive security
updates.

## Secret Handling

Provider credentials belong only in encrypted hosting environment variables.
They must never use browser-exposed prefixes or be committed to source, build
artifacts, screenshots, issue comments, or logs.
