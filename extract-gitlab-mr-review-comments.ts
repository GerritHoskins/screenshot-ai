#!/usr/bin/env tsx
/**
 * Extract unresolved reviewer comments/suggestions/change requests from a GitLab MR (IID from URL),
 * using a local git repo path to auto-detect the GitLab project.
 *
 * HARD FILTERS (as requested):
 *  - Keep only: item.resolvable === true && item.resolved === false
 *  - Exclude MR author's own notes
 *
 * Usage:
 *  GITLAB_TOKEN=... GITLAB_BASE_URL=https://gitlab.example.com \
 *    pnpm dlx tsx scripts/extract-gitlab-mr-review-comments.from-repo.ts \
 *      --repo /path/to/your/repository --mr 2244
 *
 * Outputs:
 *  - ./mr-2244-review-comments.json
 *  - ./mr-2244-review-comments.md
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

type Args = {
  repo?: string;          // local repo path
  mr?: string;            // MR IID from URL
  outDir?: string;
  includeBots?: boolean;  // optional; default false
  remote?: string;        // default origin
};

type GitLabUser = { id: number; username: string; name: string };

type GitLabNote = {
  id: number;
  body: string;
  author: GitLabUser;
  created_at: string;
  updated_at: string;
  system: boolean;
  resolvable?: boolean;
  resolved?: boolean;
  url?: string;
  position?: any;
};

type GitLabDiscussion = { id: string; individual_note: boolean; notes: GitLabNote[] };

type NormalizedItem = {
  kind: "discussion" | "note";
  discussionId?: string;
  noteId: number;
  createdAt: string;
  updatedAt: string;
  author: { id: number; username: string; name: string };
  body: string;
  url?: string;

  isSystem: boolean;
  isBotLikely: boolean;

  resolvable?: boolean;
  resolved?: boolean;

  isInline: boolean;
  positionSummary?: string;

  suggestions: string[];
};

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    const takeValue = () => {
      if (!next || next.startsWith("--")) return undefined;
      i++;
      return next;
    };

    if (a === "--repo") out.repo = takeValue();
    else if (a === "--mr") out.mr = takeValue();
    else if (a === "--outDir") out.outDir = takeValue();
    else if (a === "--includeBots") out.includeBots = true;
    else if (a === "--remote") out.remote = takeValue();
  }
  return out;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
}

/**
 * Supports:
 *  - https://gitlab.com/group/sub/repo.git
 *  - git@gitlab.com:group/sub/repo.git
 *  - ssh://git@gitlab.com/group/sub/repo.git
 */
function parseProjectFromRemoteUrl(remoteUrl: string): { host: string; projectPath: string } {
  const url = remoteUrl.trim();

  // SSH scp-like: git@host:group/sub/repo.git
  const scpLike = url.match(/^[^@]+@([^:]+):(.+)$/);
  if (scpLike) {
    const host = scpLike[1];
    const path = scpLike[2].replace(/\.git$/, "");
    return { host, projectPath: path };
  }

  // ssh://...
  if (url.startsWith("ssh://")) {
    const u = new URL(url);
    const host = u.host;
    const path = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
    return { host, projectPath: path };
  }

  // http(s)://...
  if (url.startsWith("http://") || url.startsWith("https://")) {
    const u = new URL(url);
    const host = u.host;
    const path = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
    return { host, projectPath: path };
  }

  throw new Error(`Unsupported remote URL format: ${remoteUrl}`);
}

async function glFetch<T>(baseUrl: string, token: string, path: string): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v4${path}`;
  const res = await fetch(url, {
    headers: { "PRIVATE-TOKEN": token, "Accept": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitLab API ${res.status} ${res.statusText} for ${path}\n${text}`);
  }
  return (await res.json()) as T;
}

async function glFetchPaged<T extends any[]>(
  baseUrl: string,
  token: string,
  path: string,
  perPage = 100
): Promise<T> {
  const all: any[] = [];
  let page = 1;

  while (true) {
    const joiner = path.includes("?") ? "&" : "?";
    const p = `${path}${joiner}per_page=${perPage}&page=${page}`;
    const url = `${baseUrl.replace(/\/$/, "")}/api/v4${p}`;
    const res = await fetch(url, {
      headers: { "PRIVATE-TOKEN": token, "Accept": "application/json" },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitLab API ${res.status} ${res.statusText} for ${p}\n${text}`);
    }

    const chunk = (await res.json()) as any[];
    all.push(...chunk);

    const nextPage = res.headers.get("x-next-page");
    if (!nextPage) break;
    page = Number(nextPage);
    if (!page) break;
  }

  return all as T;
}

function isLikelyBot(user: GitLabUser): boolean {
  const u = (user.username || "").toLowerCase();
  const n = (user.name || "").toLowerCase();
  return u.includes("bot") || u.includes("automation") || u.includes("ci") || n.includes("bot");
}

function extractSuggestions(body: string): string[] {
  const out: string[] = [];
  const re = /```suggestion\s*([\s\S]*?)```/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const content = (m[1] ?? "").trimEnd();
    if (content.trim()) out.push(content);
  }
  return out;
}

function positionToSummary(note: GitLabNote): string | undefined {
  const pos = note.position;
  if (!pos) return undefined;

  const newPath = pos.new_path || pos.position?.new_path;
  const oldPath = pos.old_path || pos.position?.old_path;
  const newLine = pos.new_line || pos.position?.new_line;
  const oldLine = pos.old_line || pos.position?.old_line;

  const path = newPath || oldPath;
  const line = newLine ?? oldLine;

  if (path && line) return `${path}:${line}`;
  if (path) return String(path);
  return undefined;
}

function normalizeDiscussion(d: GitLabDiscussion, includeBots: boolean): NormalizedItem[] {
  const items: NormalizedItem[] = [];
  for (const n of d.notes || []) {
    const bot = isLikelyBot(n.author);
    if (n.system) continue;
    if (!includeBots && bot) continue;

    items.push({
      kind: "discussion",
      discussionId: d.id,
      noteId: n.id,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
      author: { id: n.author.id, username: n.author.username, name: n.author.name },
      body: n.body,
      url: n.url,
      isSystem: n.system,
      isBotLikely: bot,
      resolvable: n.resolvable,
      resolved: n.resolved,
      isInline: !!n.position,
      positionSummary: positionToSummary(n),
      suggestions: extractSuggestions(n.body || ""),
    });
  }
  return items;
}

function normalizeNote(n: GitLabNote, includeBots: boolean): NormalizedItem | null {
  const bot = isLikelyBot(n.author);
  if (n.system) return null;
  if (!includeBots && bot) return null;

  return {
    kind: "note",
    noteId: n.id,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    author: { id: n.author.id, username: n.author.username, name: n.author.name },
    body: n.body,
    url: n.url,
    isSystem: n.system,
    isBotLikely: bot,
    resolvable: n.resolvable,
    resolved: n.resolved,
    isInline: !!n.position,
    positionSummary: positionToSummary(n),
    suggestions: extractSuggestions(n.body || ""),
  };
}

function dedupeByNoteId(items: NormalizedItem[]): NormalizedItem[] {
  const seen = new Set<number>();
  const out: NormalizedItem[] = [];
  for (const it of items) {
    if (seen.has(it.noteId)) continue;
    seen.add(it.noteId);
    out.push(it);
  }
  return out;
}

/** HARD FILTERS: unresolved resolvable + exclude MR author */
function applyHardFilters(items: NormalizedItem[], mrAuthorUsername: string): NormalizedItem[] {
  return items.filter((it) => {
    const isUnresolvedResolvable = it.resolvable === true && it.resolved === false;
    const isMrAuthor = it.author.username === mrAuthorUsername;
    return isUnresolvedResolvable && !isMrAuthor;
  });
}

function toMarkdown(meta: any, items: NormalizedItem[]): string {
  const byLoc = new Map<string, NormalizedItem[]>();
  for (const it of items) {
    const key = it.positionSummary || "(general)";
    if (!byLoc.has(key)) byLoc.set(key, []);
    byLoc.get(key)!.push(it);
  }

  const lines: string[] = [];
  lines.push(`# MR !${meta.iid} Unresolved Review Threads`);
  lines.push(`**Project:** ${meta.projectPath}`);
  if (meta.webUrl) lines.push(`**MR:** ${meta.webUrl}`);
  if (meta.title) lines.push(`**Title:** ${meta.title}`);
  lines.push(`**MR Author:** ${meta.mrAuthorUsername}`);
  lines.push(`**Total unresolved resolvable notes (excluding author):** ${items.length}`);
  lines.push("");

  lines.push(`## Unresolved items (grouped by location)`);
  for (const [loc, locItems] of [...byLoc.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### ${loc}`);
    for (const it of locItems.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      lines.push(`- **${it.author.name}** (${it.author.username}) — ${new Date(it.createdAt).toISOString()}`);
      if (it.url) lines.push(`  - ${it.url}`);
      lines.push(`  - ${it.body.replace(/\n/g, "\n    ")}`);
      if (it.suggestions.length) {
        lines.push(`  - Suggestions:`);
        for (const s of it.suggestions) lines.push(`    \`\`\`\n${s}\n\`\`\``);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  const token = requireEnv("GITLAB_TOKEN");
  const baseUrl = process.env.GITLAB_BASE_URL || "https://gitlab.com";

  if (!args.repo) throw new Error(`Missing --repo <local-repo-path>`);
  if (!args.mr) throw new Error(`Missing --mr <mr-iid> (from MR URL), e.g. --mr 2244`);

  const remoteName = args.remote || "origin";
  const remoteUrl = sh(`git remote get-url ${remoteName}`, args.repo);
  const { projectPath } = parseProjectFromRemoteUrl(remoteUrl);
  const projectRef = encodeURIComponent(projectPath);

  // MR metadata (by IID)
  const mrObj = await glFetch<any>(baseUrl, token, `/projects/${projectRef}/merge_requests/${args.mr}`);
  const mrAuthorUsername: string = mrObj?.author?.username;
  if (!mrAuthorUsername) throw new Error(`Could not determine MR author username from GitLab response.`);

  // Discussions + Notes
  const discussions = await glFetchPaged<GitLabDiscussion[]>(
    baseUrl,
    token,
    `/projects/${projectRef}/merge_requests/${args.mr}/discussions`
  );

  const notes = await glFetchPaged<GitLabNote[]>(
    baseUrl,
    token,
    `/projects/${projectRef}/merge_requests/${args.mr}/notes`
  );

  const includeBots = !!args.includeBots;

  const fromDiscussions = discussions.flatMap((d) => normalizeDiscussion(d, includeBots));
  const fromNotes = notes.map((n) => normalizeNote(n, includeBots)).filter(Boolean) as NormalizedItem[];

  const allRaw = dedupeByNoteId([...fromDiscussions, ...fromNotes]).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );

  // Apply requested filters
  const all = applyHardFilters(allRaw, mrAuthorUsername);

  const meta = {
    baseUrl,
    projectPath,
    iid: mrObj.iid,
    globalId: mrObj.id,
    title: mrObj.title,
    webUrl: mrObj.web_url,
    mrAuthorUsername,
    extractedAt: new Date().toISOString(),
    includeBots,
    remoteUrl,
    filters: {
      onlyUnresolvedResolvable: "resolvable === true && resolved === false",
      excludeMrAuthorNotes: true,
    },
  };

  const outDir = resolve(process.cwd(), args.outDir || ".");
  const jsonPath = resolve(outDir, `mr-${mrObj.iid}-review-comments.json`);
  const mdPath = resolve(outDir, `mr-${mrObj.iid}-review-comments.md`);

  writeFileSync(jsonPath, JSON.stringify({ meta, items: all }, null, 2), "utf8");
  writeFileSync(mdPath, toMarkdown(meta, all), "utf8");

  const suggestions = all.reduce((acc, i) => acc + i.suggestions.length, 0);

  console.log(`✅ Project: ${projectPath}`);
  console.log(`✅ MR !${mrObj.iid}: ${mrObj.title}`);
  console.log(`✅ MR author excluded: ${mrAuthorUsername}`);
  console.log(`✅ Extracted ${all.length} unresolved resolvable notes (excluding author)`);
  console.log(`   Suggestions found: ${suggestions}`);
  console.log(`📄 JSON: ${jsonPath}`);
  console.log(`📝 MD:   ${mdPath}`);
}

main().catch((e) => {
  console.error(`❌ ${e?.message || e}`);
  process.exit(1);
});
