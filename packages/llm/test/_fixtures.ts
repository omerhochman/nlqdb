// Shared test fixtures — keep providers / router tests symmetric.

export type FetchHandler = (input: Request) => Response | Promise<Response>;

export function mockFetch(routes: Array<{ match: RegExp; respond: FetchHandler }>) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input.toString(), init);
    for (const { match, respond } of routes) {
      if (match.test(req.url)) return respond(req);
    }
    throw new Error(`mockFetch: no handler matched ${req.url}`);
  };
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

export function openAIChatResponse(content: string): Response {
  return jsonResponse({
    id: "test",
    choices: [{ message: { role: "assistant", content } }],
  });
}

export function geminiResponse(text: string): Response {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text }] } }],
  });
}

export function workersAIResponse(text: string): Response {
  return jsonResponse({ result: { response: text }, success: true });
}
