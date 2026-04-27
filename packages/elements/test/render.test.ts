import { describe, expect, it } from "vitest";
import type { AskSuccess } from "../src/fetch.ts";
import { errorHtml, renderState } from "../src/render.ts";

const success: AskSuccess = {
  status: "ok",
  cached: false,
  sql: "SELECT * FROM orders",
  rows: [
    { customer: "Maya", drink: "latte" },
    { customer: "Jordan", drink: "flat white" },
  ],
  rowCount: 2,
};

describe("renderState — idle", () => {
  it("prompts for the missing goal when no goal attribute is set", () => {
    const html = renderState({ kind: "idle", reason: "no-goal" }, "table");
    expect(html).toContain("nlq-pending");
    expect(html).toContain("<code>goal</code>");
  });

  it("prompts for the missing db when goal is set but db isn't", () => {
    const html = renderState({ kind: "idle", reason: "no-db" }, "table");
    expect(html).toContain("nlq-pending");
    expect(html).toContain("<code>db</code>");
  });
});

describe("renderState — loading", () => {
  it("renders a pending placeholder", () => {
    expect(renderState({ kind: "loading" }, "table")).toContain("nlq-pending");
  });
});

describe("renderState — success", () => {
  it("renders rows through the chosen template", () => {
    const html = renderState({ kind: "success", data: success }, "table");
    expect(html).toContain("<table");
    expect(html).toContain("<th>customer</th>");
    expect(html).toContain("<td>Maya</td>");
    expect(html).toContain("<td>flat white</td>");
  });

  it("dispatches by template name", () => {
    expect(renderState({ kind: "success", data: success }, "list")).toContain("<ul");
    expect(renderState({ kind: "success", data: success }, "kv")).toContain("<dl");
  });

  it("renders an empty placeholder when the API returns zero rows", () => {
    const empty: AskSuccess = { ...success, rows: [], rowCount: 0 };
    const html = renderState({ kind: "success", data: empty }, "table");
    expect(html).toContain("nlq-empty");
    expect(html).not.toContain("<td>");
  });
});

describe("renderState — error", () => {
  it("renders network errors with kind=network and the message", () => {
    const html = renderState(
      { kind: "error", failure: { kind: "network", message: "Failed to fetch" } },
      "table",
    );
    expect(html).toContain('class="nlq-error"');
    expect(html).toContain('data-kind="network"');
    expect(html).toContain("Network error: Failed to fetch");
  });

  it("renders auth errors with a generic 'authentication required' message", () => {
    const html = renderState({ kind: "error", failure: { kind: "auth", status: 401 } }, "table");
    expect(html).toContain('data-kind="auth"');
    expect(html).toContain("Authentication required.");
    // The status code is in the dispatched event detail, not the
    // visible text — ensures generic styling matches both 401 and 403.
    expect(html).not.toContain("401");
  });

  it("renders structured 4xx api errors with status + slug", () => {
    const html = renderState(
      {
        kind: "error",
        failure: {
          kind: "api",
          status: 429,
          error: { status: "rate_limited", limit: 10, count: 11 },
        },
      },
      "table",
    );
    expect(html).toContain('data-kind="api"');
    expect(html).toContain("Error 429: rate_limited");
  });

  it("renders structured 5xx api errors (db_unreachable) with status + slug", () => {
    const html = renderState(
      {
        kind: "error",
        failure: {
          kind: "api",
          status: 502,
          error: { status: "db_unreachable", message: "connect ECONNREFUSED" },
        },
      },
      "table",
    );
    expect(html).toContain('data-kind="api"');
    expect(html).toContain("Error 502: db_unreachable");
  });

  it("renders bare-string api errors with status + slug", () => {
    const html = renderState(
      { kind: "error", failure: { kind: "api", status: 400, error: "goal_required" } },
      "table",
    );
    expect(html).toContain("Error 400: goal_required");
  });

  it("escapes hostile error messages structurally", () => {
    const html = errorHtml({ kind: "network", message: '<img src=x onerror="x">' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
