/**
 * Time one GH Archive hour end to end, with NO database writes and no timeout.
 *
 * Ingest currently fails every hour with "GH Archive fetch timed out after
 * 30000ms" even though the transfer itself completes in well under a second.
 * The 30s AbortSignal in withGhArchiveTimeout covers fetch + gunzip + per-line
 * JSON.parse + the onCreate callback, so this separates transfer cost from
 * processing cost and shows what ceiling the work actually needs.
 *
 *   npx tsx scripts/probe-gharchive-hour.ts 2026-07-26-5
 */
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";

const hour = process.argv[2] ?? "2026-07-26-5";
const url = `https://data.gharchive.org/${hour}.json.gz`;

console.log(`hour: ${hour}`);
console.log(`url:  ${url}\n`);

const t0 = Date.now();
const res = await fetch(url);
const tHeaders = Date.now();
console.log(`response headers      ${String(tHeaders - t0).padStart(7)}ms status=${res.status}`);
console.log(`content-length        ${res.headers.get("content-length") ?? "(none)"} bytes gzipped`);

if (!res.ok || !res.body) {
  console.log("aborting: no usable body");
  process.exit(1);
}

const gunzip = createGunzip();
Readable.fromWeb(res.body as import("node:stream/web").ReadableStream).pipe(gunzip);

let compressedSeen = 0;
let decompressed = 0;
let lines = 0;
let parsed = 0;
let createEvents = 0;
let repoCreates = 0;
let parseMs = 0;
let buffer = "";

const isRepoCreate = (e: { type?: string; payload?: unknown; repo?: { name?: string } }): boolean => {
  if (e.type !== "CreateEvent" || !e.repo?.name?.includes("/")) return false;
  const p = e.payload as { ref_type?: string } | undefined;
  return p?.ref_type === "repository" || p?.ref_type === "repo";
};

for await (const chunk of gunzip) {
  decompressed += (chunk as Buffer).byteLength;
  buffer += (chunk as Buffer).toString("utf8");
  const split = buffer.split("\n");
  buffer = split.pop() ?? "";
  const pStart = Date.now();
  for (const line of split) {
    if (!line.trim()) continue;
    lines++;
    try {
      const ev = JSON.parse(line);
      parsed++;
      if (ev.type === "CreateEvent") createEvents++;
      if (isRepoCreate(ev)) repoCreates++;
    } catch {
      /* skip malformed */
    }
  }
  parseMs += Date.now() - pStart;
}

const tDone = Date.now();
console.log(`\ndownload + gunzip + parse ${String(tDone - tHeaders).padStart(7)}ms`);
console.log(`  of which JSON.parse      ${String(parseMs).padStart(7)}ms`);
console.log(`  transport + gunzip       ${String(tDone - tHeaders - parseMs).padStart(7)}ms`);
console.log(`\ndecompressed          ${(decompressed / 1024 / 1024).toFixed(1)} MB`);
console.log(`lines                 ${lines}`);
console.log(`parsed events         ${parsed}`);
console.log(`CreateEvents          ${createEvents}`);
console.log(`repository creates    ${repoCreates}`);
console.log(`\nTOTAL                 ${tDone - t0}ms (no DB writes, no timeout)`);
console.log(`current ceiling       ${process.env.GH_ARCHIVE_FETCH_TIMEOUT_MS ?? 30000}ms`);
console.log(
  tDone - t0 > 30_000
    ? "VERDICT: exceeds the 30s ceiling before any database work is added"
    : "VERDICT: fits under 30s without DB writes; inserts push it over",
);
