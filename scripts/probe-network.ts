/**
 * Outbound network probe for the app container.
 *
 * Exists because two independent slowdowns pointed at the same suspect: GitHub
 * metadata requests measured 11s at p50 (they were ~1.4s per repo end to end in
 * July) and every GH Archive hour download now exceeds the 30s timeout. Both are
 * outbound HTTP, so this measures the transport directly instead of inferring it
 * from pipeline timings.
 *
 *   npx tsx scripts/probe-network.ts
 */
const GH_ARCHIVE_HOUR =
  process.env.PROBE_ARCHIVE_URL ??
  "https://data.gharchive.org/2026-07-26-5.json.gz";

async function probe(
  label: string,
  url: string,
  init?: RequestInit,
): Promise<void> {
  const started = Date.now();
  try {
    const res = await fetch(url, init);
    const body = await res.arrayBuffer();
    const ms = Date.now() - started;
    const kbps = body.byteLength > 0 ? (body.byteLength / 1024 / (ms / 1000)).toFixed(0) : "-";
    console.log(
      `${label.padEnd(24)} status=${res.status} ${String(ms).padStart(7)}ms ` +
        `${String(body.byteLength).padStart(9)} bytes ${kbps.padStart(7)} KB/s`,
    );
  } catch (err) {
    console.log(
      `${label.padEnd(24)} ERROR   ${String(Date.now() - started).padStart(7)}ms ` +
        (err as Error).message,
    );
  }
}

const ghHeaders: Record<string, string> = { "user-agent": "githubarchive-probe" };
if (process.env.GITHUB_TOKEN) {
  ghHeaders.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

console.log(`probe at ${new Date().toISOString()}`);
console.log(`archive url: ${GH_ARCHIVE_HOUR}`);
console.log(`github token: ${process.env.GITHUB_TOKEN ? "present" : "ABSENT"}\n`);

await probe("gharchive HEAD", GH_ARCHIVE_HOUR, { method: "HEAD" });
await probe("gharchive 1MB range", GH_ARCHIVE_HOUR, {
  headers: { Range: "bytes=0-1048576" },
});
await probe("gharchive 8MB range", GH_ARCHIVE_HOUR, {
  headers: { Range: "bytes=0-8388608" },
});

// Three separate hosts: isolates GitHub-specific throttling from general egress.
for (const repo of ["sveltejs/svelte", "torvalds/linux", "nodejs/node"]) {
  await probe(`api.github ${repo.split("/")[1]}`, `https://api.github.com/repos/${repo}`, {
    headers: ghHeaders,
  });
}
await probe("example.com", "https://example.com");
await probe("cloudflare 1.1.1.1", "https://1.1.1.1");
