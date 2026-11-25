// Small fetch wrapper: per-request timeout, size cap, JSON/text helpers.

const MAX_BYTES = 4 * 1024 * 1024;

export const USER_AGENT = process.env.DEALS_USER_AGENT || "web:meridian-deals:1.0 (price comparison; no ads)";

export function makeHttp(fetchImpl = globalThis.fetch) {
  async function request(url, { timeoutMs = 9000, headers = {}, method = "GET", body } = {}) {
    const response = await fetchImpl(url, {
      method,
      body,
      headers: { "user-agent": USER_AGENT, accept: "application/json, application/xml;q=0.9, */*;q=0.5", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error("response too large");
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return text;
  }
  return {
    text: request,
    async json(url, options) {
      return JSON.parse(await request(url, options));
    },
  };
}

// Caches an OAuth client-credentials token until shortly before it expires.
export function tokenCache() {
  let token = null;
  let expires = 0;
  let flight = null;
  return async function get(fetchToken) {
    if (token && Date.now() < expires) return token;
    if (!flight) {
      flight = fetchToken()
        .then(({ access_token, expires_in }) => {
          token = access_token;
          expires = Date.now() + Math.max(60, Number(expires_in || 3600) - 120) * 1000;
          return token;
        })
        .finally(() => {
          flight = null;
        });
    }
    return flight;
  };
}
