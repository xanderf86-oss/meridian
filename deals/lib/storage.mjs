// Where the price history file lives. Two backends:
//  - a local file (needs a persistent disk to survive restarts)
//  - a branch of a GitHub repo (survives restarts on hosts with no disk)
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FILE_NAME = "price-history.json";

export function memoryStorage() {
  return { name: "memory", saveDelayMs: 0, durable: false, async read() { return null; }, async write() {} };
}

export function fileStorage(dir) {
  const file = join(dir, FILE_NAME);
  return {
    name: `file ${file}`,
    saveDelayMs: 1500,
    durable: false,
    async read() {
      try {
        return await readFile(file, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async write(text) {
      await mkdir(dir, { recursive: true });
      await writeFile(`${file}.tmp`, text);
      await rename(`${file}.tmp`, file);
    },
  };
}

// Stores the history as one JSON file on its own branch, via the GitHub
// Contents API. Needs a token with Contents read/write on that one repo.
export function githubStorage({ http, token, repo, branch = "deal-desk-data", path = FILE_NAME }) {
  const api = `https://api.github.com/repos/${repo}`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
  };
  const fileUrl = `${api}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  let sha = null;

  async function ensureBranch() {
    try {
      await http.json(`${api}/git/ref/heads/${branch}`, { headers });
      return;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    const info = await http.json(api, { headers });
    const base = await http.json(`${api}/git/ref/heads/${info.default_branch}`, { headers });
    await http.json(`${api}/git/refs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }),
    });
  }

  async function fetchMeta() {
    try {
      return await http.json(`${fileUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function put(text) {
    const body = { message: "Update tracked prices", branch, content: Buffer.from(text).toString("base64") };
    if (sha) body.sha = sha;
    const result = await http.json(fileUrl, { method: "PUT", headers, body: JSON.stringify(body), timeoutMs: 20000 });
    sha = result.content?.sha || sha;
  }

  return {
    name: `github ${repo}@${branch}`,
    saveDelayMs: 30_000,
    durable: true,
    async read() {
      const meta = await fetchMeta();
      if (!meta) return null;
      sha = meta.sha;
      if (meta.content) return Buffer.from(meta.content, "base64").toString("utf8");
      // Files over 1 MB come back without inline content.
      return http.text(`${fileUrl}?ref=${encodeURIComponent(branch)}`, { headers: { ...headers, accept: "application/vnd.github.raw+json" }, timeoutMs: 20000 });
    },
    async write(text) {
      try {
        await put(text);
      } catch (error) {
        if (error.status === 404 && !sha) {
          await ensureBranch();
        } else if (error.status === 409 || error.status === 422) {
          sha = (await fetchMeta())?.sha || null;
        } else {
          throw error;
        }
        await put(text);
      }
    },
  };
}

export function storageFromEnv(env, http, defaultDir) {
  if (env.HISTORY_GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(env.HISTORY_GITHUB_REPO || "")) {
    return githubStorage({
      http,
      token: env.HISTORY_GITHUB_TOKEN,
      repo: env.HISTORY_GITHUB_REPO,
      branch: env.HISTORY_GITHUB_BRANCH || "deal-desk-data",
    });
  }
  return fileStorage(env.DATA_DIR || defaultDir);
}
