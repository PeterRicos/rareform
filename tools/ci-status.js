#!/usr/bin/env node
// ci-status.js — what the newest GitHub Actions runs are doing, in one short look.
//
// Run: node tools/ci-status.js                 latest five runs, right now
//      node tools/ci-status.js --wait 20       poll for up to twenty seconds, then report
//      node tools/ci-status.js --sha 9b7361b   only runs for that commit (a prefix is enough)
//      node tools/ci-status.js --repo o/n      a repo other than this clone's origin
//
// Why it exists: the agent shell that works in this repo kills a foreground command after
// about thirty seconds, and `gh` is not installed here — so "gh run watch" and a sixty
// second `sleep` are both out. A wait has to be a chunk that fits inside the cap. This
// polls inside the chunk and says, in its exit code, whether to come back:
//
//   0  everything it looked at is finished, and nothing failed
//   1  the newest run of a workflow failed (timed out, needs action, or was cancelled and
//      nothing replaced it)
//   3  still running when the wait ran out — call it again
//   2  the API could not be read (bad --repo, or the hourly rate limit)
//
// "Newest run of each workflow" is the whole trick: one push can start two runs, and
// `concurrency: cancel-in-progress` kills the earlier one on purpose. Judging every row
// made a healthy deploy report itself as failed because its own predecessor was cancelled.
//
// Unauthenticated GitHub allows 60 requests an hour per IP, so the interval is eight
// seconds rather than one and a single call is at most four requests. Export GITHUB_TOKEN
// to raise the allowance to 5,000 when a loop is going to run long.

'use strict';

const { execSync } = require('child_process');

const INTERVAL_MS = 8000;
const FAILED = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required']);

function parseArgs(argv) {
  const opts = { wait: 0, sha: '', repo: '', limit: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wait') opts.wait = Number(argv[++i]);
    else if (a === '--sha') opts.sha = String(argv[++i] || '');
    else if (a === '--repo') opts.repo = String(argv[++i] || '');
    else if (a === '--limit') opts.limit = Math.min(20, Number(argv[++i]) || 5);
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  if (!Number.isFinite(opts.wait) || opts.wait < 0) throw new Error('--wait wants seconds, e.g. --wait 20');
  return opts;
}

// "git@github.com:owner/name.git" and "https://github.com/owner/name.git" are both how a
// clone here might be configured; neither is the string the API wants.
function originSlug() {
  const url = execSync('git config --get remote.origin.url', { cwd: __dirname + '/..' })
    .toString().trim();
  const m = url.match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error('cannot read owner/name from the origin URL: ' + url);
  return m[1] + '/' + m[2];
}

async function getRuns(repo, limit) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'randomstock-ci-status'
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = 'Bearer ' + process.env.GITHUB_TOKEN;

  const res = await fetch('https://api.github.com/repos/' + repo + '/actions/runs?per_page=' + limit, { headers });

  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const left = res.headers.get('x-ratelimit-remaining');
    const when = Number.isFinite(reset) ? new Date(reset * 1000).toLocaleTimeString() : 'later';
    const err = new Error('rate limited (remaining=' + left + ', resets ' + when +
      ') — set GITHUB_TOKEN for 5,000 calls an hour');
    err.code = 2;
    throw err;
  }
  if (!res.ok) {
    const err = new Error('GitHub said ' + res.status + ' ' + res.statusText + ' for ' + repo);
    err.code = 2;
    throw err;
  }
  const body = await res.json();
  return body.workflow_runs || [];
}

const pad = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);

function report(runs, superseded) {
  if (!runs.length) return console.log('  (no runs)');
  console.log('  ' + pad('workflow', 30) + pad('status', 12) + pad('conclusion', 14) + pad('sha', 9) + 'age');
  for (const r of runs) {
    const age = Math.max(0, Math.round((Date.now() - Date.parse(r.created_at)) / 60000));
    const mark = superseded.indexOf(r) >= 0 ? ' · superseded' : '';
    console.log('  ' + pad(r.name, 30) + pad(r.status, 12) + pad(r.conclusion || '-', 14) +
      pad(String(r.head_sha || '').slice(0, 7), 9) + age + 'm ago' + mark);
  }
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('usage: node tools/ci-status.js [--wait SECONDS] [--sha PREFIX] [--repo OWNER/NAME] [--limit N]');
    return;
  }
  const repo = opts.repo || originSlug();
  const deadline = Date.now() + opts.wait * 1000;

  // A sha filter looks further back than the default five runs: right after a push, the
  // run being waited for is usually the newest, but a re-run lands below the first try.
  const select = (all) => opts.sha
    ? all.filter((r) => String(r.head_sha || '').startsWith(opts.sha))
    : all;

  let runs = [];
  for (;;) {
    runs = select(await getRuns(repo, opts.sha ? 20 : opts.limit));
    if (!runs.some((r) => r.status !== 'completed')) break;
    if (Date.now() + INTERVAL_MS > deadline) break;
    await new Promise((ok) => setTimeout(ok, INTERVAL_MS));
  }

  // Newest first, whatever order the API handed them over in — "the state of the site" is
  // read off the top of this list, so it has to be the top.
  runs = runs.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  // One push can start two runs of the same workflow, and `concurrency: cancel-in-progress`
  // cancels the older one deliberately. So the verdict is per workflow, from its newest run:
  // everything below that is history, and a cancelled history entry is not a failure.
  const newest = new Map();
  runs.forEach((r) => {
    const held = newest.get(r.name);
    if (!held || Date.parse(r.created_at) > Date.parse(held.created_at)) newest.set(r.name, r);
  });
  const live = Array.from(newest.values());
  const superseded = runs.filter((r) => live.indexOf(r) < 0 && r.conclusion === 'cancelled');

  console.log(repo + (opts.sha ? ' @ ' + opts.sha : '') + ':');
  report(runs, superseded);

  if (!runs.length) {
    // A commit with no run is normal twice over: the first thirty seconds after a push,
    // and forever when its workflow was filtered out by `paths:`. Either way the honest
    // answer is "look again", not "clean".
    console.log('  no run for that commit yet (queued, or filtered out by paths:) — look again');
    process.exitCode = 3;
    return;
  }
  if (live.some((r) => FAILED.has(r.conclusion))) {
    const broken = live.filter((r) => FAILED.has(r.conclusion)).map((r) => r.name + '=' + r.conclusion);
    console.log('  FAILED (' + broken.join(', ') + ') — open the run for the log');
    process.exitCode = 1;
    return;
  }
  if (live.some((r) => r.status !== 'completed')) {
    const pending = live.filter((r) => r.status !== 'completed').map((r) => r.name);
    console.log('  still running: ' + pending.join(', ') + ' — call again');
    process.exitCode = 3;
    return;
  }
  if (superseded.length) {
    console.log('  ' + superseded.length + ' cancelled run(s) above were replaced by a newer build of the ' +
      'same workflow, which passed — not a failure');
  }
  console.log('  all green');
  process.exitCode = 0;
})().catch((err) => {
  console.error('ci-status: ' + err.message);
  process.exitCode = err.code || 2;
});
