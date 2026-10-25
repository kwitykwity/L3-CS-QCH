# Task C: current Program information

Status: implementation scope and reconciliation record.
Baseline: main at e3fd11e.
Evidence: Task C instructions supplied by Christina, describing the October 23 midpoint feedback. No Program Directory or original midpoint transcript was provided for this work.

## Requirement reconciliation

The October 14 Final Technical PRD remains authoritative. Task C extends the information authorized staff can maintain and makes it available through a storage-independent interface.

This work does not introduce new participant matching inputs, eligibility filters, ranking, AI interpretation, or external services. Using availability, schedules or enrollment details to change matching results requires separate explicit reconciliation.

## Reuse existing capabilities

- Description, eligibility, schedule, cost and primary site use existing common Program information.
- Age limits, service-area ZIPs and need categories use existing structured matching facts.
- Availability, wait-list status and wait-time notes, additional locations, primary contact details, current information and enrollment/cycle details use the flexible Program-field design where appropriate.
- Primary Program contacts are distinct from server-only notification routing.
- Wait-list information describes a Program; no participant waitlist records are introduced.
- Multiple locations must remain associated with the existing Program identity unless QCH explicitly defines separate Programs.

## Interface requirements

Expose maintained Program information through an explicit service/store contract. Include stable field IDs, types, option identities and current values. Do not infer field meaning from editable labels or parse free text into eligibility rules.

Only operationally active information is offered as current information. Preserve discontinued/replaced/retired definitions and values as history through existing management boundaries.

Use an allowlisted projection: do not expose notification routing, permission records or participant/referral data. A staff-facing discovery response requires an explicit decision about which Program contact information is appropriate to display.

## Verification

Demonstrate authorized maintenance and reload, permission refusal, stale-write protection, audit rollback, independent values for shared fields, lifecycle/history preservation, and current information reaching the read interface after edits.

Use synthetic Programs and synthetic contacts only. No real directory is committed.

## Architecture boundary

Preserve service/store separation. Add no Azure SQL runtime integration, SharePoint adapter or production provisioning while QCH IT decisions remain unresolved.
