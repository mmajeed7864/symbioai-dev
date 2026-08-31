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

FitCoach purchase tokens, App Store transaction identifiers, social-provider
revocation tokens, Supabase service-role keys, USDA keys, and account-state
encryption keys are server-only secrets. Store receipts never directly unlock
premium: the server must verify the store response, product, signed-in account
binding, and event status before applying an idempotent entitlement transition.

FitCoach data classifications must describe actual provenance and purpose. User-provided coach
text, user-provided food lookups, and generated coach replies use separate exact allow-listed
labels. A classification is never a substitute for payload minimization, private-data interception,
provider review, consent, or retention controls. Raw prompts, replies, purchase credentials, and
food queries must not be written to application logs.
