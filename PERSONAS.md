# Personas & Use Cases

This document answers two questions: *who* is nlqdb for in Phase 1, and *what do they actually do with it*. Everything here is deliberate — if a persona isn't listed, we are choosing not to serve them yet.

The personas are ordered by **priority for Phase 1 onboarding**. We optimize the 60-second path for P1 first, then P2. The others should work but we don't tune for them yet.

---

## P1 — The Solo Builder

**Role.** Founder or single engineer building a side-project or early-stage product. Ships alone or on a team of 2–3. Writes code daily.

**Current pain.**
- Spends the first day of every project wiring up Postgres + an ORM + migrations + a schema + an admin panel before the app does anything useful.
- Switches hosting providers every few months chasing free tiers.
- Knows SQL well enough, but begrudges writing it for throwaway internal tools (admin pages, one-off reports, cron jobs that email a number).
- Backups are "I hope Neon is doing it."

**Why they churn off existing DBs.** Provisioning friction + maintenance tax. They don't leave Postgres because Postgres is bad; they leave because running it is a side job.

**What "works" looks like.**
- `nlq db create myapp` from the terminal, a connection string on stdout, and a working chat endpoint — all in one command.
- Drop the connection string into their existing app. Stay there. Use the chat only for ops ("how many signups today").
- Never think about backups.
- Monthly bill is <$10 for a real side project.

**Willingness to pay.** $10–25/mo happily, once the project is real. $0 during the tinkering phase — a card requirement kills them.

**ROI (est.).** ~8–10 hrs/mo saved per active project (skipping initial Postgres setup, writing migrations, building one-off admin pages, worrying about backups). At a $75–100/hr blended builder rate, that's **~$600–1,000/mo** in avoided labor, plus one fewer tool subscription (a Retool/Internal.io hobby seat at $20–50/mo) since the chat replaces the admin UI. Setup time on a new project drops from ~1 day to ~1 minute.

**Representative queries.**
- `"create a users table with email, name, signup date"` (even though we never say "create a table" — they'll type it anyway)
- `"show me the last 10 signups"`
- `"who signed up this week but hasn't logged in"`
- `"export all orders from last month as CSV"`
- `"add a field called 'plan' to users, default 'free'"`

**Real-life use case.** Maya is building a meal-planning side project on a Friday night. She runs `nlq db create mealplan`, drops the connection string into her Next.js app, and by Sunday has real users signing up. Monday morning she types `"how many signups this weekend, grouped by referrer"` into the chat instead of opening psql. Two weeks in she needs a `trial_ends_at` column — says so in chat, reviews the diff, approves. She never writes a migration file, never runs `pg_dump`, never logs into a cloud console.

**Phase 1 success for this persona.** They deploy something real with nlqdb as its actual DB, not just the admin layer.

---

## P2 — The Agent Builder

**Role.** Engineer building LLM-powered agents, assistants, or autonomous workflows. Writes glue code around Claude / GPT / local models. Uses MCP, LangChain, or custom tool-use loops.

**Current pain.**
- Every agent needs memory and state. Giving an agent a real DB requires schema design the agent can't be trusted to do, or hand-rolling a JSON blob store.
- Existing vector DBs are either over-provisioned (Pinecone/Weaviate) or under-featured (raw pgvector with no mgmt).
- They want to hand the LLM a tool called `remember_this` and `recall_that` and be done.

**Why they churn off existing DBs.** The schema + credential + provisioning ceremony is fundamentally hostile to an agent. An agent can't click through AWS IAM.

**What "works" looks like.**
- Install the MCP server. The agent itself creates databases and queries them via natural language. No schema up front.
- Per-agent isolation — each agent gets its own DB handle, same API key.
- Cheap: an agent firing 100 queries/hour during testing shouldn't cost $50/day.

**Willingness to pay.** Usage-based is perfect for them. Will pay per-query if the unit cost is predictable.

**ROI (est.).** ~10–15 hrs/mo of engineering saved by not hand-rolling per-agent memory (vector DB + metadata + schema-design glue + session lifecycle). At a $100–125/hr engineer rate, that's **~$1,000–1,800/mo** in development time, plus replacing a Pinecone Starter (~$70/mo) and whatever metadata store they'd bolt on. Bigger but fuzzier win: shipping the agent two weeks earlier.

**Representative queries.**
- Agent does: `nlqdb_query("memory", "remember that the user's name is Sam and they prefer metric units")`
- Agent does: `nlqdb_query("kb", "find articles mentioning shipping delays in the last 30 days")`
- Agent does: `nlqdb_create_database("session_abc123")` at session start, drops it at session end.
- Developer does: `"show me every query the agent ran today that returned zero rows"` (agent debugging)

**Real-life use case.** Jordan is building a personal research agent that browses the web and drafts memos. Before nlqdb the agent dumped facts into a messy `notes.json` and forgot things between sessions. Now at session start the agent calls `nlqdb_create_database("session_<id>")` and stores claims, sources, and user corrections as structured rows it designs itself. At session end the agent either persists the DB (if the user liked the output) or drops it. Jordan's entire memory layer is ~40 lines of glue code instead of a bespoke vector store + metadata service.

**Phase 1 success for this persona.** The MCP server is installed in 3+ agent products (Claude Desktop, Cursor, Zed, homegrown) and the #1 use case in our logs is "agent giving itself memory."

---

## P3 — The Data-Curious Analyst / PM / Ops

**Role.** Not an engineer by title. PM, data analyst, founder's-first-ops-hire, customer success lead. Can write a SQL query if forced, but resents it. Lives in Metabase / Retool / Excel.

**Current pain.**
- The engineering team is the bottleneck for every ad-hoc question.
- Metabase dashboards cover yesterday's questions, not today's.
- They have a CSV from a vendor and want to answer "which of these overlap with our users" *right now*.
- They can't get credentials to prod anyway.

**Why they churn off existing DBs.** They're not on one. They're on spreadsheets.

**What "works" looks like.**
- Upload a CSV via the chat ("here's a vendor list, load it as a table called `vendor_dump`"). Ask questions of it.
- Join their uploaded data with engineering's prod data (read-only, scoped) via the same chat.
- Share a query result as a link. No "install this BI tool."

**Willingness to pay.** Team subscription, $20–50/seat, if their company already pays for similar tools.

**ROI (est.).** ~6–10 hrs/mo reclaimed from waiting on data tickets, pinging engineers, and re-doing analyses in Excel. At a $60–80/hr PM/ops rate, that's **~$400–800/mo** in their own time. The larger (and harder-to-quantify) gain: the 3–5 analyses per month that simply wouldn't have gotten prioritized at all now happen same-day.

**Representative queries.**
- `"load this CSV as 'leads_q2'"` (with a file drop)
- `"how many of these leads are already customers"` (join across datasets)
- `"churn rate by acquisition channel, last 6 months"`
- `"send me this as a weekly email every Monday"` (scheduled queries — Phase 2 feature)

**Real-life use case.** Priya is a growth PM at a 30-person SaaS. Thursday afternoon a conference vendor emails a 12k-row CSV of leads. She drops it in the chat: `"load this as conference_leads_q2"`. Then: `"how many of these are already in our users table, and which plan are they on"` — the chat joins her upload with a read-only mirror of prod. She has the numbers for her 4pm exec sync without opening a data-request ticket, and shares a result link in Slack.

**Phase 1 success for this persona.** A non-engineer completes a real analysis that would have required a 3-day engineering ticket, using only chat + CSV upload. We do need CSV upload in Phase 1 for this to work.

**Note.** This persona stretches Phase 1 scope. If we must cut something, CSV upload is the first thing on the chopping block — but it's cheap to ship and opens this whole segment. Keep it in.

---

## P4 — The Backend Engineer at a Small Startup

**Role.** One of 5–15 engineers at a seed/Series A startup. Runs their own Postgres on RDS or Supabase. Owns the database among other things.

**Current pain.**
- Not provisioning — they're fine with Postgres. The pain is the **internal admin UI** they keep being asked to build: "can you add a page to bulk-refund these orders," "can you show me which users are on the old plan," etc.
- Retool / internal tools cost $50/dev/month and require building forms.

**Why they might adopt nlqdb.** Not as the primary DB (yet). As the **NL layer over their existing Postgres**.

**What "works" looks like.**
- Point nlqdb at their existing Postgres connection string. nlqdb becomes the chat interface without owning the data.
- Team gets a shared workspace with permissioning (who can run destructive queries).
- Auditable query log.

**Willingness to pay.** $100–300/mo for the team, happily, if it kills their Retool bill.

**ROI (est.).** ~10–20 engineering hrs/mo saved across the team by not building and maintaining one-off internal admin pages. At a $125/hr fully-loaded rate, that's **~$1,250–2,500/mo** in reclaimed dev capacity, plus killing a 5-seat Retool subscription (~$250/mo) and cutting the on-call "can you run this query for me" interrupt tax. Realistic blended total: **~$1,500–2,750/mo** per team.

**Representative queries.**
- `"refund orders in state 'pending-dispute' older than 60 days, but preview first"`
- `"users who signed up via the iOS promo link in March"`
- `"migrate users from plan 'starter' to 'basic'"` (with diff preview, per §1.2 of PLAN.md)

**Real-life use case.** Dmitri is on-call at a 20-person startup. Support escalates: a pricing bug double-charged ~180 customers between 11pm and midnight. Instead of writing a one-off refund script, he opens the team workspace pointed at their existing Postgres, types the refund in plain English, and reviews the generated diff (183 rows, $2,104 total) before approving. The audit log captures who ran it, and the Retool page he would've had to build doesn't need to exist. *(Requires Phase 2 "bring your own Postgres" mode — aspirational for this persona in Phase 1.)*

**Phase 1 treatment.** This persona needs "bring your own Postgres" mode, which is explicitly a Phase 2 feature (it punches a hole in the auto-migration story). **Park for Phase 1.** Tell them "we'll email you" and we will.

---

## P5 — The Student / First-Timer

**Role.** Learning to code. Building a portfolio project. First-time backend exposure.

**Current pain.**
- Setting up Postgres locally is day 1's biggest blocker.
- Doesn't know the difference between a row and a document. Shouldn't have to.

**Why they matter.** They become P1 in two years. Also: a great free-tier audience that doesn't cost us much.

**What "works" looks like.**
- Free forever for small projects.
- The chat teaches them as they go ("I added a `users` table with columns `id`, `email`, `name` — here's the SQL I ran, if you're curious").

**Willingness to pay.** $0 now. Graduates to P1 when their project gets real.

**ROI (est.).** Not a dollar story — ~4–8 hrs of day-1 setup pain eliminated at the start of each project, and a non-zero number of students who would have quit the course on day 2 stay in it. The value here is retention and eventual graduation into P1, not monthly revenue.

**Real-life use case.** Aarav is doing the CS50 web track. Instead of spending day one fighting `brew install postgresql` and password errors, he runs `nlq db create cs50_final` and types `"i need a table for blog posts with title, body, and author"`. The chat creates it and shows him the SQL it ran, which he pastes into his notes for the write-up. He ships the assignment by Wednesday and actually understands what a foreign key is by the end of it.

**Phase 1 treatment.** Served by the free tier. No special product work.

---

## Anti-Personas (who we explicitly do NOT serve in Phase 1)

Being clear about this prevents scope creep and bad-fit support tickets.

### A1 — The Regulated Enterprise

Finance, healthcare, anyone with HIPAA/SOC2/GDPR-DPA requirements today. We are not compliant yet, our LLM providers make data-handling a hard conversation, and "an LLM might look at my PII" is a non-starter. Point them at a roadmap page; revisit in Phase 3.

### A2 — High-Volume OLTP at Scale

Payment processors, ad-tech, real-time bidding, anyone doing >10k writes/sec. Our abstraction tax (§2.5 of PLAN.md: "within 1.3× of hand-written queries") means we're not for the top of that curve yet. They should run Postgres / CockroachDB / Scylla directly.

### A3 — Strict-Schema Shops Built Around dbt / Great Expectations / Flyway

Their whole workflow is about pinning schema. Our whole workflow is about inferring it. Fundamental mismatch. We will never convince them and shouldn't try.

### A4 — Users Who Want a BI Tool

If someone wants dashboards, charts, scheduled reports, embedded analytics — that is Metabase / Hex / Mode / Superset. We can be the *data* layer underneath one of those eventually, but we are not building the visualization product.

### A5 — Users Who Want an ORM

Prisma / Drizzle / SQLAlchemy are not what we are. If they want codegen from a schema they control, we're the wrong tool.

---

## Use Case → Feature Priority

Ranked by how much of Phase 1 capacity they deserve.

| Use case | Persona | Priority | Notes |
|---|---|---|---|
| Solo dev prototyping a new app's DB | P1 | **P0** | The flagship journey. Optimize onboarding for this. |
| Agent giving itself memory via MCP | P2 | **P0** | MCP server must ship in Phase 1, not Phase 2. |
| Non-engineer answering a one-off question from a CSV | P3 | **P1** | Requires CSV upload. Ship it. |
| Solo dev using chat as an admin UI over their own nlqdb | P1 | **P1** | Falls out of P0 naturally. |
| Startup team using chat as admin UI over *their own* PG | P4 | **Phase 2** | Needs BYO-connection. Park. |
| Scheduled/recurring queries ("email me this weekly") | P3 | **Phase 2** | Useful but not foundational. |
| Destructive ops with NL-diff preview | P1, P4 | **P0** | Trust-building. Ship in Phase 1. |
| Sharing a query result by link | P3, P1 | **P1** | Cheap to build, high word-of-mouth. |
| Team workspaces with roles | P4 | **Phase 2** | Solo product first. |
| Embedded NL-query widget in user's own app | — | **Phase 3** | Tempting but dilutes the message. |

**P0 = must ship in Phase 1. P1 = ship in Phase 1 if capacity allows. Phase 2+ = explicitly deferred.**

---

## Validation plan

For each P0 persona, before we declare Phase 1 done:

- **P1 Solo Builder:** 5 design partners each ship a real project using nlqdb as the primary DB. At least 2 convert to paid Hobby.
- **P2 Agent Builder:** MCP server installed in 3 distinct agent frameworks in the wild. At least 1 agent product publicly integrates nlqdb as its memory layer.
- **P3 Analyst:** 3 non-engineers complete a real analysis end-to-end in under 10 minutes, unassisted, in user tests.

If any of these don't hit, we don't ship Phase 2 — we iterate.
