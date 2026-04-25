# Legal — running checklist

The single source of truth for legal-protection housekeeping. Written
in 2026-04-25; last updated each time a row changes status.

**Standing rule: free-only path.** Anything that costs money is
listed but deferred until revenue exists. When revenue arrives,
revisit the 💰 sections.

Symbols:
- ✅ = done
- 🆓 = free, pending — do this
- 💰 = paid, deferred until revenue
- 📅 = recurring reminder

---

## In-repo scaffolding

| Status | Item | Where |
| :----- | :--- | :---- |
| ✅ | License (FSL-1.1-ALv2)              | [LICENSE](./LICENSE) |
| ✅ | Security policy + safe harbor       | [SECURITY.md](./SECURITY.md) |
| ✅ | RFC 9116 security.txt               | [`apps/coming-soon/.well-known/security.txt`](./apps/coming-soon/.well-known/security.txt) |
| ✅ | Hall of Fame stub (security)        | [`apps/coming-soon/security/hall-of-fame.html`](./apps/coming-soon/security/hall-of-fame.html) |
| ✅ | Code of Conduct (CC 2.1)            | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) |
| ✅ | Contributor License Agreement        | [CLA.md](./CLA.md) + [`.github/workflows/cla.yml`](./.github/workflows/cla.yml) |
| ✅ | Trademark policy                    | [TRADEMARKS.md](./TRADEMARKS.md) |
| ✅ | Sub-processor list                  | [SUBPROCESSORS.md](./SUBPROCESSORS.md) |
| ✅ | Impressum scaffold (Swiss UWG)      | [IMPRESSUM.md](./IMPRESSUM.md) |
| ✅ | Support / help expectations         | [SUPPORT.md](./SUPPORT.md) |
| ✅ | Funding / sponsorship config        | [`.github/FUNDING.yml`](./.github/FUNDING.yml) |
| ✅ | Privacy + Terms (pre-alpha drafts)  | [`apps/coming-soon/privacy.html`](./apps/coming-soon/privacy.html), [`apps/coming-soon/terms.html`](./apps/coming-soon/terms.html) |

---

## GitHub & infrastructure

| Status | Item | Notes |
| :----- | :--- | :---- |
| ✅ | All `*@nlqdb.com` emails forward to founder inbox | Cloudflare Email Routing |
| ✅ | GitHub Private Vulnerability Reporting enabled | Repo Settings → Code security |
| ✅ | `nlqdb/cla-signatures` private repo created | https://github.com/nlqdb/cla-signatures |
| ✅ | `CLA_PAT` fine-grained token generated and added as Actions secret | Founder, 2026-04-25. CLA bot now fully self-serve on next PR. |

---

## Defensive registrations (no fees, name-squatting prevention)

### Done / not available

| Status | Where | Notes |
| :----- | :---- | :---- |
| ✅ | npm `@nlqdb` scope               | Reserved |
| ✅ | GitHub `nlqdb` org               | Reserved |
| ✅ | Homebrew `nlqdb/tap`             | Reserved |
| ✅ | PyPI user + org                  | Founder created 2026-04-25 |
| ❌ | X / Twitter `@nlqdb`             | **Taken by a third party.** Pick a workable alternative when launching X presence — e.g. `@nlqdb_com`, `@usenlqdb`, `@nlqdbhq`. |

### Free, pending

| Status | Where | Notes |
| :----- | :---- | :---- |
| 🆓 | BlueSky `@nlqdb.com`             | Domain-verified handle, free. Set up via DNS TXT once the AT Protocol verifier flow is run. |
| 🆓 | Threads (`@nlqdb`)               | Free, takes 2 minutes |
| 🆓 | Mastodon (`@nlqdb@hachyderm.io` or self-hosted later) | Free |
| 🆓 | LinkedIn company page            | Free |
| 🆓 | YouTube channel `@nlqdb`         | Free |
| 🆓 | HuggingFace org `nlqdb`          | Free; useful when LLM-related artifacts ship |
| 🆓 | Bluesky and Threads can be claimed without posting — reserve only |
| 🆓 | crates.io `nlqdb`                | Free placeholder package |
| 🆓 | RubyGems `nlqdb`                 | Free placeholder gem |
| 🆓 | Maven Central group `io.nlqdb`   | Free; needs DNS TXT proof of `nlqdb.com` ownership |
| 🆓 | NuGet `Nlqdb`                    | Free; relevant only if .NET client ever ships |
| 🆓 | Docker Hub `nlqdb` user account  | Free; the *org* is paid-only since 2024, the user account is free and reserves the namespace |
| 🆓 | Discord vanity URL               | Requires server boost level 3 — defer |

### Paid (deferred until revenue)

| Status | Item | Approx. cost |
| :----- | :--- | :----------- |
| 💰 | `nlqdb.io` domain                  | ~$30-50/yr |
| 💰 | `nlqdb.dev` domain                 | ~$15/yr |
| 💰 | `nlqdb.app` domain                 | ~$15/yr |
| 💰 | `nlqdb.org` domain                 | ~$10/yr |
| 💰 | `nlqdb.co` / `nlqdb.sh`            | ~$30 each/yr |
| 💰 | All other TLDs (`.net`, `.tech`, `.cloud`, …) | Skip — squat-bait, low value, defend via UDRP only after trademark is filed |

---

## Swiss legal entity (free-only path)

The free path: **Einzelfirma** (sole proprietorship). Recommended
until turnover crosses **CHF 100,000** worldwide / year, at which
point Swiss VAT registration becomes mandatory ([MWSTG Art. 10](https://www.fedlex.admin.ch/eli/cc/2009/615/en#art_10))
and the Einzelfirma must be registered with the cantonal commercial
register.

| Status | Path | Cost |
| :----- | :--- | :--- |
| 🆓 | Operate as Einzelfirma without registration         | Free until CHF 100k worldwide turnover |
| 💰 | Voluntary Einzelfirma registration in cantonal commercial register | ~CHF 120 one-off — defer until you want a brand-name `Firma` |
| 💰 | Mandatory Einzelfirma registration                  | ~CHF 120 one-off — required at CHF 100k turnover |
| 💰 | GmbH (limited liability)                            | CHF 20'000 minimum capital + ~CHF 700-1500 setup. Defer until needed (employees, investors, or significant liability exposure). |
| 💰 | AG (joint-stock)                                    | CHF 100'000 minimum capital. Far future. |

When you do form an entity, **update three files** with the formal
legal name:

1. [LICENSE](./LICENSE) — replace `Copyright 2026 nlqdb` with `Copyright 2026 [Entity Name]`.
2. [IMPRESSUM.md](./IMPRESSUM.md) — fill in legal name + postal address + commercial-register number (if registered).
3. [CLA.md](./CLA.md) — Section 9 Governing law currently names Zurich; adjust if your canton differs.

---

## Trademark — free-only path

The free path keeps you defensible until you can afford a real filing.

| Status | Item | Cost |
| :----- | :--- | :--- |
| 🆓 | Run free pre-clearance searches on `nlqdb` (Class 9 + 42) at: WIPO Global Brand DB, USPTO Trademark Search, EUIPO eSearch plus, Swiss Swissreg | Free |
| 🆓 | Use `nlqdb™` consistently in README, marketing site, CLI banner | Free; establishes a documented use date |
| 🆓 | Reserve confusingly-similar package names defensively (see registrations above) | Free |
| 🆓 | Monitor brand-confusion via Google Alerts on `nlqdb` | Free |
| 💰 | **Swiss IGE base application (Class 9 + 42)** | CHF 550 — deferred. This is the cheapest path to actual statutory rights. **Without it, ™ is mostly posturing in Switzerland (first-to-file system).** |
| 💰 | Madrid Protocol extension (US, EU, UK, CA, AU)           | CHF 3'500-4'500 + agent fees — deferred |
| 💰 | National filings outside Madrid                          | Skip — Madrid handles it |

Honest reality: until you file, your `TRADEMARKS.md` is **signaling**, not enforcement. The minute the IGE application is filed (not even granted), your leverage jumps significantly. Consider this the highest-priority paid action once revenue starts.

---

## Privacy & Terms — free generators

Pre-alpha drafts already exist at
[`apps/coming-soon/privacy.html`](./apps/coming-soon/privacy.html) and
[`apps/coming-soon/terms.html`](./apps/coming-soon/terms.html). They
need to be replaced or substantially expanded **before Slice 5
(Better Auth) ships**, because that's when real users start signing up.

### Free generators worth considering

All of these produce starter-quality output. Plan to swap or augment
with a Swiss data-protection lawyer review when revenue allows
(typical one-off review: CHF 500-2'000), but the free generator
output is a defensible starting point for a pre-revenue project.

| Service | URL | Notes |
| :------ | :-- | :---- |
| Termly (free tier) | https://termly.io                        | Free generator, must keep their attribution badge. Covers GDPR, CCPA, CalOPPA, CDPR, LGPD, PIPEDA. Best Swiss support of the free options. |
| GetTerms (free tier) | https://getterms.io                    | Free single-page generator. GDPR + CCPA. Smaller surface than Termly. |
| Iubenda (free tier) | https://www.iubenda.com                 | Free tier with Iubenda branding; pricier than alternatives if upgraded. Has a cookie-banner add-on. |
| PrivacyPolicies.com | https://www.privacypolicies.com         | Ad-supported free generator. Quick. |
| TermsFeed | https://www.termsfeed.com                          | Free single-document generator. |
| a16z OSS legal templates | https://github.com/a16z/legal           | Open-source MIT-licensed legal templates from a16z. SaaS-focused. Editable in markdown. |
| Common Paper SaaS templates | https://commonpaper.com              | Free standardized SaaS contracts (DPA, MSA). Useful when first paying customer asks for a redlined DPA. |

### Recommended pairing for nlqdb

1. **Termly** for the public Privacy Policy + Terms — covers Swiss
   FADP, EU GDPR, US state laws (the new Termly tier-1 templates as
   of 2025 cover Texas TDPSA, MODPA, Oregon, Florida, Tennessee, etc.
   in addition to CCPA/CPRA).
2. **a16z OSS templates** for the underlying contract structure when
   redlining DPAs and MSAs with paying customers later.
3. **Common Paper standardized DPA** when a B2B customer asks for one
   — saves you (and them) lawyer fees on both sides.

### What the generators will NOT capture and you must hand-edit

- The **specific list of sub-processors** — copy from
  [SUBPROCESSORS.md](./SUBPROCESSORS.md).
- **LLM-routing disclosure** — that user prompts may pass to one of
  Groq / Gemini / Cloudflare Workers AI / OpenRouter, with each
  provider's training posture. EU AI Act Art. 50 (effective 2 Aug
  2026) requires this transparency disclosure.
- **The 72-hour breach notification commitment** (Art. 33 GDPR) —
  generators sometimes omit or weaken this.
- **Swiss-specific FADP language** — most generators are GDPR-first;
  Swiss revFADP Art. 19 has slightly different transparency
  requirements. Add a short Swiss section.
- **The 30-day prior-notice mechanism for sub-processor changes** —
  required by SCCs Module 2 Clause 9(a). Already in
  [SUBPROCESSORS.md](./SUBPROCESSORS.md); reference from the privacy
  policy.

📅 **Reminder:** revisit `apps/coming-soon/privacy.html` and
`apps/coming-soon/terms.html` before Slice 5 (Better Auth scaffold +
GitHub OAuth) lands. That's when real users sign up.

---

## DPAs to sign or acknowledge

Sign each one **before the corresponding service starts seeing real
user data**. All of these have a free DPA — none gate on a paid
plan. The "Status" column tracks our action.

| Provider | DPA URL | Cost | Status | Trigger |
| :------- | :------ | :--- | :----- | :------ |
| Cloudflare | https://www.cloudflare.com/cloudflare-customer-dpa/ | Free, auto-applies | Auto | Already in use (Pages, Workers, KV, D1) |
| Stripe (EU) | https://stripe.com/legal/dpa | Free, auto-applies | Auto | Auto on signup |
| Neon | https://neon.tech/dpa | Free | 🆓 Sign before Slice 6 | When Neon DB has real user data |
| Upstash | https://upstash.com/static/trust/UpstashDPA.pdf | Free | 🆓 Sign before Slice 6 | When Redis is exercised |
| Fly.io | https://fly.io/legal/dpa/ | Free | 🆓 Sign before Plausible/Listmonk launch | When self-hosted analytics starts |
| Resend | https://resend.com/legal/dpa | Free | 🆓 Sign before Phase 1 (Slice 5+) | When transactional email starts |
| Sentry | https://sentry.io/legal/dpa/ | Free | 🆓 Sign before any production telemetry | When `apps/api` ships errors to Sentry |
| Grafana Cloud | https://grafana.com/legal/dpa/ | Free | 🆓 Sign before any production OTLP push | When `setupTelemetry` runs against prod |
| GitHub | https://github.com/customer-terms/github-data-protection-agreement | Free | Auto | Already in use |
| Groq | Email `support@groq.com` | Free | 🆓 Request before Slice 6 | When LLM router is wired into a route |
| Google AI Studio | Via Google Cloud DPA | Free | 🆓 Use **paid keys only** before Slice 6 | Free-tier inputs are used to train Gemini; paid-tier are not |
| Cloudflare Workers AI | Master Cloudflare DPA (above) | Free | Auto | Same DPA |
| OpenRouter | https://openrouter.ai/docs/privacy | Free | 🆓 Set `X-OR-Allow-Training: false` per request | Already documented in `packages/llm` |

Track the "signed on YYYY-MM-DD" date here once each is done.

---

## Calendar reminders

Set these in whatever calendar app you use.

| 📅 | Date | Action |
| :- | :--- | :----- |
| 📅 | **2027-04-25**          | Refresh `Expires:` field in `apps/coming-soon/.well-known/security.txt` (RFC 9116 requires ≤ 1 year). |
| 📅 | **First of every quarter** | Audit [SUBPROCESSORS.md](./SUBPROCESSORS.md) — was anything added that month? Notify customers if so (30-day rule). |
| 📅 | **Annually**            | Renew domains (whichever you've registered). |
| 📅 | **6 months after CH trademark filing (when filed)** | File Madrid Protocol extension before priority lapses. |
| 📅 | **Pre-Slice 5 launch**  | Replace pre-alpha privacy/terms drafts with real (generator-output + Swiss section + sub-processor reference). |
| 📅 | **At CHF 100k turnover** | Register Swiss VAT (mandatory). Register Einzelfirma in commercial register. |

---

## Action items left for the founder (everything else is done)

These are things only you can do, by browsing in your account:

1. **Reserve free social handles & package registrations** in a single
   sitting (~30 minutes). Order by likelihood of impersonation:
   BlueSky → LinkedIn company page → YouTube → Threads → Mastodon →
   HuggingFace org → Docker Hub user → crates.io → RubyGems → Maven
   Central groupId.

2. **Cloudflare Email Routing entries** confirmed catch-all-to-founder
   already. Spot-check that `security@`, `conduct@`, `trademarks@`,
   `licensing@`, `legal@`, `dpo@`, `privacy@`, `subprocessors@` all
   resolve.

3. **Run the four free trademark searches** for `nlqdb` — links in the
   Trademark section above. ~10 minutes total. If anything blocks,
   surface it in the next session.

That's everything pre-revenue. After revenue, revisit the 💰 sections.

---

## Things only a lawyer should decide

Don't DIY any of these. Listed for completeness so you know they exist
and what triggers them:

- AG vs GmbH selection.
- Liability cap enforceability against EU consumers (Unfair Terms Directive).
- Whether nlqdb's LLM routing is "automated decision-making with
  significant effect" under GDPR Art. 22 (likely no for read-only
  query use; matters for write/destructive intent).
- HIPAA BAAs / FINMA-regulated customer onboarding.
- Voluntary Swiss VAT registration before threshold to reclaim input
  VAT (depends on cost structure).
- OFAC / Swiss SECO sanctions screening when accepting payments —
  Stripe handles most automatically; the policy itself needs
  lawyer-drafted text when an enterprise customer asks.

---

*Update this file whenever a row changes. Each ✅ should have the
date it was checked off.*
