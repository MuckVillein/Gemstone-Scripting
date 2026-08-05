/* ============================================================
   lens-core.js — shared GSIV log parsing (environment-agnostic)
   Pure JavaScript: no Node or browser globals. Used by the Node
   CLI (lens.js) and, going forward, the browser dashboard, so the
   state-extraction rules live in ONE place.

   Everything here reads the RICH .xml log (per-line timestamps +
   tags). Nothing here touches the filesystem — that's the CLI's job.
   ============================================================ */
(function (root) {
  'use strict';

  function decode(s) {
    return String(s)
      .replace(/&gt;/g, '>').replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  }
  function stripTags(s) { return decode(String(s).replace(/<[^>]*>/g, '')).replace(/\s+$/,''); }

  /* Leading "HH:MM:SS: " on every .xml log line. */
  function parseTime(line) {
    const m = String(line).match(/^(\d\d):(\d\d):(\d\d):\s?/);
    if (!m) return null;
    return {
      hms: m[1] + ':' + m[2] + ':' + m[3],
      secs: (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]),
      rest: line.slice(m[0].length)
    };
  }
  function hmsToSecs(hms) {
    const m = String(hms).match(/^(\d\d?):(\d\d)(?::(\d\d))?$/);
    if (!m) return null;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0));
  }
  function secsToHms(s) {
    s = ((s % 86400) + 86400) % 86400;
    const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  /* Pull any self-state present in a raw line's XML.
     Returns only the keys that appear on that line (a delta). */
  function readState(raw) {
    raw = String(raw);
    const st = {};

    const vit = { health: 'hp', mana: 'mana', stamina: 'stamina', spirit: 'spirit' };
    for (const id in vit) {
      const re = new RegExp("id=['\"]" + id + "['\"][^>]*?text=['\"]" + id + "\\s+(-?\\d+)/(\\d+)['\"]");
      const m = raw.match(re);
      if (m) st[vit[id]] = { cur: +m[1], max: +m[2] };
    }

    const posMap = { IconSTANDING: 'standing', IconKNEELING: 'kneeling', IconSITTING: 'sitting', IconPRONE: 'prone' };
    let posRe = /<indicator id=['"](Icon(?:STANDING|KNEELING|SITTING|PRONE))['"] visible=['"]([yn])['"]/g, pm;
    while ((pm = posRe.exec(raw))) { if (pm[2] === 'y') st.position = posMap[pm[1]]; }

    const flag = (name) => {
      const m = raw.match(new RegExp("<indicator id=['\"]" + name + "['\"] visible=['\"]([yn])['\"]"));
      return m ? (m[1] === 'y') : undefined;
    };
    const stunned = flag('IconSTUNNED'); if (stunned !== undefined) st.stunned = stunned;
    const dead = flag('IconDEAD'); if (dead !== undefined) st.dead = dead;
    const bleeding = flag('IconBLEEDING'); if (bleeding !== undefined) st.bleeding = bleeding;
    const webbed = flag('IconWEBBED'); if (webbed !== undefined) st.webbed = webbed;

    const rt = raw.match(/<roundTime value=['"](\d+)['"]/);
    if (rt) st.rtEnd = +rt[1];
    const rts = raw.match(/Roundtime:\s*(\d+) sec/);
    if (rts) st.rtSecs = +rts[1];

    const pr = raw.match(/<prompt time=['"](\d+)['"]>([^<]*)<\/prompt>/);
    if (pr) { st.promptTime = +pr[1]; st.promptFlags = decode(pr[2]).replace(/[>]/g, '').trim(); }

    const room = raw.match(/\[([^\]]+?) - (\d+)\]\s*\(u(\d+)\)/);
    if (room) st.room = { name: room[1], lich: +room[2], uid: +room[3] };

    const ch = raw.match(/<app char="([^"]+)"/);
    if (ch) st.char = ch[1];

    return st;
  }

  /* Classify the narrative meaning of a stripped text line (for highlighting). */
  function classify(text) {
    const t = text;
    if (/It seems you have died/.test(t)) return 'death';
    if (/dragging you|barrels into you at full speed|Momentum carries/.test(t)) return 'forced-move';
    if (/knocked from your grasp|flies from your|wrenched from your|from your grasp and out of sight/.test(t)) return 'disarm';
    if (/You are stunned|stunned for \d+ round/.test(t)) return 'stun';
    if (/You (?:stand back up|fall flat|are knocked to the ground|kneel down|rise to your feet)/.test(t)) return 'posture';
    if (/Roundtime:\s*\d+ sec|\.\.\.wait \d+ seconds/.test(t)) return 'rt';
    if (/\bAS:\s*[+\-]|\bCS:\s*[+\-]|\[SMR result:/.test(t)) return 'resolve';
    if (/and hits? for \d+ points? of damage|\.\.\.\s*\d+ points? of damage/.test(t)) return 'damage';
    if (/grabs you by the head|snaps? .*neck|body goes limp|neck bones snap/.test(t)) return 'finisher';
    return 'text';
  }

  /* Noise lines we never echo in a window (state is read separately). */
  const NOISE = [/^You also see/, /^Also here:/, /^Obvious paths:/, /^Your worn items are:/, /^\s*[a-z].*\bworn\b/, /^\s*$/];
  function isNoise(text) { return NOISE.some((re) => re.test(text)); }

  const api = { decode, stripTags, parseTime, hmsToSecs, secsToHms, readState, classify, isNoise };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LensCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
