// Pure state → HTML. Kept separate from `element.ts` so unit tests
// can verify markup without spinning up a DOM (the CDN bundle has no
// happy-dom / jsdom dep — see `packages/elements/README.md`).

import type { AskFailure, AskSuccess } from "./fetch.ts";
import { escapeHtml, renderTemplate } from "./templates.ts";

export type NlqState =
  | { kind: "idle"; reason: "no-goal" | "no-db" }
  | { kind: "loading" }
  | { kind: "success"; data: AskSuccess }
  | { kind: "error"; failure: AskFailure };

const IDLE_NO_GOAL = '<div class="nlq-pending">nlq-data: set a <code>goal</code> attribute.</div>';
const IDLE_NO_DB = '<div class="nlq-pending">nlq-data: set a <code>db</code> attribute.</div>';
const LOADING_HTML = '<div class="nlq-pending">Loading…</div>';

export function renderState(state: NlqState, template: string): string {
  switch (state.kind) {
    case "idle":
      return state.reason === "no-goal" ? IDLE_NO_GOAL : IDLE_NO_DB;
    case "loading":
      return LOADING_HTML;
    case "success":
      return renderTemplate(template, state.data.rows);
    case "error":
      return errorHtml(state.failure);
  }
}

// Error HTML carries `data-kind` so consumers can style auth /
// network / api differently without parsing the message text.
// Message is always escaped — API messages can echo user-supplied SQL.
export function errorHtml(failure: AskFailure): string {
  const message = errorMessage(failure);
  return `<div class="nlq-error" data-kind="${failure.kind}">${escapeHtml(message)}</div>`;
}

function errorMessage(failure: AskFailure): string {
  if (failure.kind === "network") return `Network error: ${failure.message}`;
  if (failure.kind === "auth") return "Authentication required.";
  // api: include the HTTP status + the API's `status` slug
  // (db_not_found, rate_limited, …) so the embedding page can branch
  // on either; full structured detail is on the `nlq-data:error` event.
  const slug = typeof failure.error === "string" ? failure.error : failure.error.status;
  return `Error ${failure.status}: ${slug}`;
}
