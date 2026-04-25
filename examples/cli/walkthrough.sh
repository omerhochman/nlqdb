#!/usr/bin/env bash
# nlqdb — minimal CLI walkthrough. Four commands, no frontend at all.
#
# Maps to DESIGN §14.3 — every block is what the user types.
# Lines starting with `#` are output you'll see; not part of the input.

set -euo pipefail

# 1. Sign in. Opens the browser; one click; refresh token written to the
#    OS keychain. From this point every `nlq` call works.
nlq login
# → Opening browser to approve this device… (fallback code: ABCD-1234)
# ✓ Signed in as you@example.com.

# 2. Create the DB. The natural-language description IS the schema spec —
#    nlqdb infers `customer`, `drink`, `total` from the prose.
nlq new "an orders tracker — customer, drink, total"
# ✓ Ready. orders-tracker-a4f provisioned.

# 3. Insert a row. Same `nlq` command — no `nlq insert`, no `nlq query`.
#    Writes are auto-detected and routed appropriately.
nlq "add an order: alice, latte, 5.50, just now"
# ✓ Added. orders-tracker-a4f now has 1 row.

# 4. Read. Free-form English; the result renders as a chart in the
#    terminal (sparkline / bar) when the shape fits.
nlq "how many orders today, by drink"
# latte      ████████████  12
# flat-white ██████         6
# mocha      ██             2
