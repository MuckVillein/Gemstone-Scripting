#!/usr/bin/env node
/* ============================================================
   lens.js — GSIV Combat Lens offline analysis CLI (Node)
   Shares parsing rules with the dashboard via lens-core.js.

   Commands:
     index   [--char NAME] [--root DIR]
     window  --char NAME --at HH:MM:SS [--date YYYY-MM-DD]
             [--before N] [--after N] [--file PATH] [--all] [--root DIR]

   --root defaults to $GSIV_LOGS, else DEFAULT_ROOT below (edit for
   your machine). Emits plain text; add --json for structured output.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./lens-core.js');

const DEFAULT_ROOT = 'E:\\Games\\Other\\Gemstone\\Ruby4Lich5\\R4LInstall\\Lich5.12.12\\logs';

/* ---------- arg parsing ---------- */
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) a[k] = true;
      else { a[k] = next; i++; }
    } else a._.push(t);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const ROOT = args.root || process.env.GSIV_LOGS || DEFAULT_ROOT;
const cmd = args._[0];

/* ---------- file discovery ---------- */
function listXml(root, charFilter) {
  const out = [];
  let chars;
  try { chars = fs.readdirSync(root); } catch (e) { die('Cannot read log root: ' + root + ' (' + e.message + ')'); }
  for (const cdir of chars) {
    if (!/^GSIV-/.test(cdir)) continue;
    const char = cdir.replace(/^GSIV-/, '');
    if (charFilter && char.toLowerCase() !== charFilter.toLowerCase()) continue;
    const base = path.join(root, cdir);
    walk(base, (fp) => { if (fp.endsWith('.xml')) out.push({ char, file: fp }); });
  }
  return out;
}
function walk(dir, cb) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, cb);
    else cb(fp);
  }
}
function fileSpan(fp) {
  const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/);
  let start = null, end = null, count = 0;
  for (const l of lines) {
    const t = C.parseTime(l);
    if (t) { if (start === null) start = t.hms; end = t.hms; count++; }
  }
  return { start, end, count, lines: lines.length };
}

/* ---------- index ---------- */
function cmdIndex() {
  const files = listXml(ROOT, args.char).sort((a, b) => a.char.localeCompare(b.char) || a.file.localeCompare(b.file));
  const rows = [];
  for (const f of files) {
    const span = fileSpan(f.file);
    rows.push({ char: f.char, name: path.basename(f.file), start: span.start || '?', end: span.end || '?', lines: span.count });
  }
  if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  let curChar = null;
  for (const r of rows) {
    if (r.char !== curChar) { curChar = r.char; console.log('\n' + curChar); }
    console.log('  ' + r.name.padEnd(26) + '  ' + r.start + ' → ' + r.end + '   (' + r.lines + ' events)');
  }
  console.log('\n' + rows.length + ' log files under ' + ROOT);
}

/* ---------- window ---------- */
function resolveFile() {
  if (args.file) return args.file;
  if (!args.char) die('window needs --char (or --file)');
  if (!args.at) die('window needs --at HH:MM:SS');
  const target = C.hmsToSecs(args.at);
  const cdir = path.join(ROOT, 'GSIV-' + cap(args.char));
  // gather candidate xml files (optionally filtered by --date)
  const cands = [];
  walk(cdir, (fp) => {
    if (!fp.endsWith('.xml')) return;
    const bn = path.basename(fp);
    if (args.date && !bn.startsWith(args.date)) return;
    cands.push(fp);
  });
  if (!cands.length) die('No .xml logs for ' + args.char + (args.date ? ' on ' + args.date : '') + ' under ' + cdir);
  // pick the file whose [start,end] contains target; else latest start <= target
  let best = null, bestStart = -1;
  for (const fp of cands) {
    const span = fileSpan(fp);
    if (!span.start) continue;
    const s = C.hmsToSecs(span.start), e = C.hmsToSecs(span.end);
    if (s <= target && target <= e) return fp;
    if (s <= target && s > bestStart) { best = fp; bestStart = s; }
  }
  if (best) return best;
  die('No log covering ' + args.at + ' for ' + args.char + (args.date ? ' on ' + args.date : ''));
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

function cmdWindow() {
  const fp = resolveFile();
  const target = C.hmsToSecs(args.at);
  const before = +(args.before || 30), after = +(args.after || 15);
  const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/);

  const state = { hp: null, position: null, stunned: null, room: null, char: null, rtEnd: null, promptTime: null };
  const rows = [];
  for (const raw of lines) {
    const t = C.parseTime(raw);
    // merge state from every line (state carries forward across the window boundary)
    const d = C.readState(raw);
    if (d.hp) state.hp = d.hp;
    if (d.position) state.position = d.position;
    if (d.stunned !== undefined) state.stunned = d.stunned;
    if (d.dead) state.dead = true;
    if (d.room) state.room = d.room;
    if (d.char) state.char = d.char;
    if (d.rtEnd) state.rtEnd = d.rtEnd;
    if (d.promptTime) state.promptTime = d.promptTime;
    if (!t) continue;
    if (t.secs < target - before || t.secs > target + after) continue;
    const text = C.stripTags(t.rest);
    if (!text || C.isNoise(text)) { if (!args.all) continue; }
    const rtRem = (state.rtEnd && state.promptTime) ? Math.max(0, state.rtEnd - state.promptTime) : null;
    rows.push({
      hms: t.hms,
      hp: state.hp ? Math.round(100 * state.hp.cur / state.hp.max) : null,
      hpText: state.hp ? state.hp.cur + '/' + state.hp.max : null,
      pos: state.position, stun: state.stunned, rt: rtRem,
      cls: C.classify(text), text
    });
  }

  const povNote = state.char ? state.char : cap(args.char || '?');
  if (args.json) {
    console.log(JSON.stringify({ file: path.basename(fp), pov: state.char, room: state.room, rows }, null, 2));
    return;
  }
  console.log('=== window: ' + povNote + ' @ ' + args.at + '  (−' + before + 's … +' + after + 's) ===');
  console.log('file: ' + path.basename(fp) + (state.char ? '   POV char: ' + state.char : '') +
    (state.room ? '   room: ' + state.room.lich + ' ' + state.room.name : ''));
  console.log('cols: TIME  HP  POS  [flags]  | event\n');
  const TAG = { death: '[DEATH] ', 'forced-move': '[MOVE]  ', disarm: '[DISARM]', stun: '[STUN]  ', finisher: '[KILL]  ', posture: '[POS]   ', rt: '[RT]    ' };
  for (const r of rows) {
    const flags = [];
    if (r.pos && r.pos !== 'standing') flags.push(r.pos.toUpperCase());
    if (r.stun) flags.push('STUNNED');
    if (r.rt) flags.push('rt' + r.rt);
    const hp = r.hp == null ? '  ? ' : String(r.hp).padStart(3) + '%';
    const tag = TAG[r.cls] || '        ';
    console.log(r.hms + '  ' + hp + '  ' + (flags.join(' ').padEnd(20)) + tag + ' ' + r.text);
  }
  console.log('\n' + rows.length + ' events shown. (add --all to include room/noise lines, --json for structured output)');
}

/* ---------- main ---------- */
function die(msg) { console.error('error: ' + msg); process.exit(1); }
function usage() {
  console.log('GSIV Combat Lens CLI\n' +
    '  node lens.js index  [--char NAME] [--root DIR] [--json]\n' +
    '  node lens.js window --char NAME --at HH:MM:SS [--date YYYY-MM-DD]\n' +
    '                      [--before N] [--after N] [--file PATH] [--all] [--json] [--root DIR]\n');
}
if (cmd === 'index') cmdIndex();
else if (cmd === 'window') cmdWindow();
else usage();
