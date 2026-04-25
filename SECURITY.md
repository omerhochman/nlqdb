# Security Policy

Thank you for helping keep nlqdb and our users safe. This document
describes how to report security vulnerabilities and what to expect
from us in return.

## Supported Versions

nlqdb is a hosted SaaS at https://nlqdb.com. We support the
**currently deployed version** of the service. We do not maintain
long-term branches.

For the open-source CLI and SDKs (`@nlqdb/*` on npm, `nlqdb/tap` on
Homebrew, `ghcr.io/nlqdb/*` images), only the **latest minor release**
receives security fixes. Older versions are end-of-life on release of
the next minor.

| Component                     | Supported              |
| :---------------------------- | :--------------------- |
| `nlqdb.com` (hosted service)  | Yes (current deploy)   |
| `@nlqdb/*` npm packages       | Latest minor only      |
| `nlqdb` Homebrew formula      | Latest minor only      |
| `ghcr.io/nlqdb/*` containers  | Latest minor only      |

## Reporting a Vulnerability

**Please report security issues privately. Do not open a public
GitHub issue, discussion, pull request, or social-media post.**

Preferred channels, in order:

1. **GitHub Private Vulnerability Reporting** (preferred):
   https://github.com/nlqdb/nlqdb/security/advisories/new
2. **Email**: `security@nlqdb.com`. For encrypted email, send from a
   Proton Mail or Tutanota address and we will reply in kind. We do
   not currently maintain a PGP key; if you require one, ask in your
   first message and we will provide one.
3. **Signal**: username available on request via `security@nlqdb.com`.

Please include, where possible:

- A description of the issue and its impact.
- Steps to reproduce, or a proof-of-concept.
- Affected component, version, URL, or commit SHA.
- Whether the issue is already public or known to other parties.
- Whether you wish to be credited, and the name/handle to use.

## Scope

**In scope:**

- `nlqdb.com` and all `*.nlqdb.com` subdomains under our control.
- `api.nlqdb.com` and the Cloudflare Worker behind it.
- Source code in https://github.com/nlqdb/nlqdb.
- Published packages: `@nlqdb/*` (npm), `nlqdb` (Homebrew),
  `ghcr.io/nlqdb/*`.

**Out of scope** (please do not report):

- Findings from automated scanners without a working proof-of-concept
  (e.g. `npm audit` output, generic header advisories, TLS-config
  scores, missing CSP nice-to-haves on static pages).
- Rate-limit, brute-force, or DoS findings against unauthenticated
  endpoints. We rely on Cloudflare for layer-3/4 and edge rate-limiting.
- Social engineering of nlqdb staff, customers, or vendors.
- Physical attacks against our infrastructure providers.
- Vulnerabilities in third-party services we depend on (Cloudflare,
  Neon, Upstash, Fly.io, Stripe, LLM providers) — please report those
  upstream. We will gladly coordinate if the issue affects nlqdb users
  specifically.
- Self-XSS, clickjacking on pages without sensitive actions, missing
  security headers without a demonstrated exploit.
- Reports requiring root or a malicious browser extension on the
  victim's device.

## Our Commitments

We follow [coordinated vulnerability disclosure][cvd] aligned with
NIST SP 800-216 and CERT/CC guidance.

- **Acknowledgement**: within **72 hours** of receiving your report.
- **Initial triage and severity assessment**: within **10 business days**.
- **Status updates**: at least every **14 days** until the report is closed.
- **Fix target**: **90 days** from triage for confirmed vulnerabilities,
  with a **14-day grace period** if a fix is in active development. We
  may request an extension for issues with deep architectural impact
  and will explain why.
- **Customer notification**: for High or Critical issues with confirmed
  customer-data impact, we will notify affected customers without undue
  delay and within **72 hours** of confirmation, consistent with Swiss
  revFADP and EU GDPR Article 33.
- **Public disclosure**: coordinated with you. We prefer to publish a
  GitHub Security Advisory (which mints a CVE through GitHub's CNA)
  within 30 days of fix deployment. We will not name reporters without
  consent.

If we cannot reach a fix within the timeline, we will tell you, explain
why, and agree on a revised plan with you before disclosure.

## Safe Harbor

We will not pursue or support legal action against researchers who:

- Make a good-faith effort to comply with this policy.
- Avoid privacy violations, service degradation, and destruction or
  modification of data belonging to others.
- Stop testing and notify us as soon as a vulnerability is identified.
- Do not exploit the vulnerability beyond what is necessary to confirm it.
- Do not disclose the issue publicly before we have agreed on a timeline.

This safe harbor extends to good-faith research consistent with this
policy. It does not authorise activity that violates Swiss law or the
laws of your own jurisdiction.

## Recognition

nlqdb is **pre-revenue and does not currently operate a paid bug bounty
program.** We will not deceive researchers about future bounties.

What we offer instead:

- A public **Hall of Fame** at `https://nlqdb.com/security/hall-of-fame`
  (opt-in; we will only list you with your consent).
- Credit in the published Security Advisory and CVE record.
- Where appropriate, swag once we have any.

We may, at our sole discretion, offer a token of thanks for exceptional
reports, but this is not a contractual obligation. We cannot offer
monetary compensation; credit-only acknowledgements are unrestricted by
jurisdiction.

If sanctions or export-control rules in your jurisdiction or ours
prevent us from offering recognition, we will still triage and fix
the report.

## CVE Issuance

For confirmed vulnerabilities affecting our open-source components, we
request a CVE through GitHub Security Advisories. GitHub is a CVE
Numbering Authority (CNA) and assigns CVE IDs directly. We are not
currently a CNA ourselves.

## Questions

Anything not covered here, ask: `security@nlqdb.com`.

[cvd]: https://csrc.nist.gov/pubs/sp/800-216/final
