import { type AskFailure, fetchAsk } from "./fetch.ts";
import { parseRefresh } from "./parse.ts";
import { type NlqState, renderState } from "./render.ts";

// Production endpoint for the public hosted API. Override with the
// `endpoint` attribute when self-hosting or for preview deploys.
const DEFAULT_ENDPOINT = "https://app.nlqdb.com/v1/ask";

// Floor on the polling interval. Background tabs throttle to ~1s
// already; `refresh="1ms"` in the foreground is pure CPU burn with no
// upside. Anything below this clamps + warns once.
const MIN_REFRESH_MS = 250;

export type NlqDataLoadDetail = {
  rows: number;
  cached: boolean;
};

export type NlqDataErrorDetail = AskFailure;

// Fetch-relevant attributes — a change to any of these triggers a
// new `update()`. `refresh` is observed too but only re-arms the
// polling timer (handled in `attributeChangedCallback`).
const FETCH_ATTRS = new Set(["goal", "db", "query", "api-key", "endpoint", "template"]);

export class NlqDataElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["goal", "db", "query", "api-key", "endpoint", "template", "refresh"];
  }

  private refreshHandle: number | null = null;
  private updateScheduled = false;
  private inflight: AbortController | null = null;
  // Tracks the last *rendered* state — drives the no-flicker rule
  // (suppress loading on refresh only when the previous render was a
  // success). String-matching on `innerHTML` would couple this layer
  // to render-class spelling.
  private lastKind: NlqState["kind"] | null = null;
  private lastHtml = "";

  connectedCallback(): void {
    // Status-region default: lets screen readers announce idle →
    // loading → success/error transitions without authors having to
    // remember to wire it up. Skipped if the page has set its own.
    if (!this.hasAttribute("aria-live")) this.setAttribute("aria-live", "polite");

    this.scheduleUpdate();
    this.setupRefresh();
  }

  disconnectedCallback(): void {
    this.teardownRefresh();
    this.cancelInflight();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (!this.isConnected) return;
    if (oldValue === newValue) return;
    if (name === "refresh") {
      this.setupRefresh();
      return;
    }
    if (FETCH_ATTRS.has(name)) this.scheduleUpdate();
  }

  // Public: imperatively re-fetch with current attributes. Useful
  // after an external event (button click, route change) without
  // resorting to attribute thrash to force a re-render.
  refresh(): void {
    this.scheduleUpdate();
  }

  // Coalesces multiple synchronous attribute changes into one fetch.
  // Without this, setting `goal`, `db`, `template` in sequence would
  // trigger three POSTs in flight.
  private scheduleUpdate(): void {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    queueMicrotask(() => {
      this.updateScheduled = false;
      void this.update();
    });
  }

  private cancelInflight(): void {
    if (this.inflight) {
      this.inflight.abort();
      this.inflight = null;
    }
  }

  private async update(): Promise<void> {
    const goal = (this.getAttribute("goal") ?? this.getAttribute("query") ?? "").trim();
    const dbId = (this.getAttribute("db") ?? "").trim();
    const apiKey = this.getAttribute("api-key") ?? undefined;
    const endpoint = this.getAttribute("endpoint") ?? DEFAULT_ENDPOINT;
    const template = this.getAttribute("template") ?? "table";

    if (!goal) {
      this.cancelInflight();
      this.commit({ kind: "idle", reason: "no-goal" }, template);
      return;
    }
    if (!dbId) {
      this.cancelInflight();
      this.commit({ kind: "idle", reason: "no-db" }, template);
      return;
    }

    // Stale request from a previous attribute set wouldn't change the
    // outcome but would race the new render — cancel it.
    this.cancelInflight();
    const controller = new AbortController();
    this.inflight = controller;

    // Refresh-after-success keeps the previous rows visible until the
    // next render lands (no flicker on poll). Every other transition
    // (initial, idle, error) shows loading so the user sees activity.
    if (this.lastKind !== "success") this.commit({ kind: "loading" }, template);

    let outcome: Awaited<ReturnType<typeof fetchAsk>>;
    try {
      outcome = await fetchAsk({ endpoint, goal, dbId, apiKey, signal: controller.signal });
    } catch (err) {
      // AbortError = our own `cancelInflight()` raced this fetch. Drop
      // the result silently; the new request owns the next render.
      if (err instanceof Error && err.name === "AbortError") return;
      throw err;
    }
    if (controller.signal.aborted) return;
    this.inflight = null;

    if (outcome.ok) {
      this.commit({ kind: "success", data: outcome.data }, template);
      this.dispatchEvent(
        new CustomEvent<NlqDataLoadDetail>("nlq-data:load", {
          detail: { rows: outcome.data.rowCount, cached: outcome.data.cached },
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this.commit({ kind: "error", failure: outcome.failure }, template);
      this.dispatchEvent(
        new CustomEvent<NlqDataErrorDetail>("nlq-data:error", {
          detail: outcome.failure,
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  // Render + state-track in one step. Skips the DOM swap when nothing
  // changed — preserves text selection, focus, and any third-party
  // listeners attached to descendants. Critical at sub-second refresh.
  private commit(state: NlqState, template: string): void {
    const html = renderState(state, template);
    this.lastKind = state.kind;
    if (html !== this.lastHtml) {
      this.innerHTML = html;
      this.lastHtml = html;
    }
  }

  // Self-rescheduling timeout — awaits `update()` so a slow API
  // doesn't queue parallel polls (each one cancels the last and
  // wastes a request). Re-armed only when the `refresh` attribute
  // changes or when the previous tick completes.
  private setupRefresh(): void {
    this.teardownRefresh();
    const raw = this.getAttribute("refresh");
    if (raw === null) return;

    const ms = parseRefresh(raw);
    if (ms === null) {
      console.warn(
        `[nlq-data] refresh="${raw}" is not parseable; expected "60s", "5m", "500ms", or a plain integer.`,
      );
      return;
    }
    if (ms < MIN_REFRESH_MS) {
      console.warn(
        `[nlq-data] refresh="${raw}" clamped to ${MIN_REFRESH_MS}ms (minimum to avoid CPU burn).`,
      );
    }
    const effective = Math.max(ms, MIN_REFRESH_MS);
    this.refreshHandle = window.setTimeout(async () => {
      this.refreshHandle = null;
      await this.update();
      if (this.isConnected) this.setupRefresh();
    }, effective);
  }

  private teardownRefresh(): void {
    if (this.refreshHandle !== null) {
      window.clearTimeout(this.refreshHandle);
      this.refreshHandle = null;
    }
  }
}
