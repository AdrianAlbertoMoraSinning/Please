# CAL 1.5 — Disclaimer & Signature Procedure

Agreement version: `CAL-LEGAL-1.0-2026-09-05`  
Effective date: 2026-09-05

## Mandatory onboarding rule

CAL access is conditional on acceptance of the current legal agreement.

1. The Customer Owner / Authorized Representative reviews and signs the full Disclaimer, Data Ownership, Authorized Access & Limitation of Liability Agreement.
2. Signature may be electronic inside CAL or physical. If physical, print the agreement, sign it, scan it, and retain the signed copy in the Customer's own private document storage.
3. Every additional CAL user must accept the current agreement version before accessing accounting modules.
4. A material agreement change receives a new `agreement_version`. Users must accept the new version before access resumes.
5. Production acceptance evidence is stored in `accounting_legal_acceptances` inside the CUSTOMER'S OWN database.
6. The signed agreement remains part of the Customer's records. Lottus may retain an executed contractual copy for its corporate records where appropriate, but does not centralize the Customer's accounting database.

## Evidence captured

- CAL user ID
- agreement version and effective date
- legal company name
- signer full legal name
- title / position
- signer email
- signature text or physical-copy-on-file method
- acceptance timestamp
- optional path to the signed document in Customer-controlled private storage

## Physical signature workflow

Use `Disclaimer & Data Custody > Print / Sign Physically`, obtain signatures, scan the signed copy, and store it in the Customer-owned private document vault. Production administrators may then record `PHYSICAL_COPY_ON_FILE` together with the signed document storage path.

## Data custody principle

Customer data remains Customer-owned and Customer-custodied. Lottus is authorized only for the implementation, configuration, integration, maintenance, security and support activities described in the agreement.

## Legal maintenance

The agreement is operationally designed for Canadian deployments but should be reviewed by Canadian counsel before broad commercial rollout and whenever material functionality, data practices, jurisdictions or applicable laws change.
