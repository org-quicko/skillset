export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export interface RecordedCall {
  url: string;
  init?: RequestInit;
}

/** A hand-written fetch stub — no HTTP mocking library needed. Records every call it sees. */
export function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}
