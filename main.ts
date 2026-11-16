// Token Radar, radar-4 entry point (Node 22, standard library only).
//
// Run flow: read the sealed snapshot (a file, or a directory holding snapshot.json),
// score every rankable pre-token protocol through lib/model.ts, write the ranked
// board and the dashboard dataset, copy the dashboard and its three screenshots,
// and finish with the dossier the judge reads, built by the vendored make.fun code.
//
// The grader mounts the sealed snapshot at /input and expects /output; outside
// that container MAKEFUN_OUTPUT_DIR takes /output's place:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { fileURLToPath as urlToPath } from 'node:url';
import { buildRadar, boardIssue, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier as makeDossier } from './vendor/makefun-board.ts';

const repoRoot = urlToPath(new URL('.', import.meta.url));

/** Dossier caps from the scorer (reference/gate.json): text shapes bytes, the rest refuse. */
const DOSSIER_TEXT_CAP = 65536;
const SHOT_LIMITS = { max_bytes: 524288, max: 4 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Write a failure to stderr and leave with the given code. */
function die(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** The value after --name, or --name=value, or the fallback when neither is given. */
function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

const inputGiven = flagValue('input', '/input');
const snapshotPath = inputGiven.endsWith('.json') ? inputGiven : joinPath(inputGiven, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  die(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const sealed = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board: ranked, radar: radarData } = buildRadar(sealed);
const boardProblem = boardIssue(ranked, sealed);
if (boardProblem !== null) die(`the model wrote a board the gate refuses: ${boardProblem}`, 1);

mkdirSync(outDir, { recursive: true });
writeFileSync(joinPath(outDir, 'board.json'), `${JSON.stringify({ rows: ranked })}\n`);
writeFileSync(joinPath(outDir, 'data.js'), dataScript(radarData));

/** Copy a directory's regular files into `to`, skipping dotfiles, and name what arrived. */
function copyDirFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const arrived: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const candidate = joinPath(from, name);
    if (!statSync(candidate).isFile()) continue;
    copyFileSync(candidate, joinPath(to, name));
    arrived.push(name);
  }
  return arrived;
}

copyDirFiles(joinPath(repoRoot, 'dashboard'), joinPath(outDir, 'dashboard'));
const shots = copyDirFiles(joinPath(repoRoot, 'screenshots'), joinPath(outDir, 'screenshots'));
if (shots.length < 3) {
  die(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  }
}

// The dossier goes last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(joinPath(outDir, 'dossier.json'), makeDossier(outDir, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SHOT_LIMITS, dashboard: { max_files: 400, max_bytes: 4194304 } }));

process.stdout.write(
  `token radar: ${sealed.protocols.length} protocols in, ${sealed.watchlist.length} on the watchlist, ${ranked.length} rows scored (${radarData.early_size} early, ${radarData.live_size} live set aside)\n` +
    `token radar: wrote ${joinPath(outDir, 'board.json')}, ${joinPath(outDir, 'data.js')}, ${joinPath(outDir, 'dashboard')} (3 files), ${joinPath(outDir, 'screenshots')} (${shots.length} images) and ${joinPath(outDir, 'dossier.json')}\n`,
);
