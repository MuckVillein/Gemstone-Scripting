#!/usr/bin/env node
/* damage.js — tally Kyrandos's OUTGOING damage from GSIV xml logs.
   Splits into: spells, physical (weapon + maneuvers), and flares.
   Excludes Elmilrion and any other player/creature damage.
   Usage: node damage.js file1.xml file2.xml ...
   Attribution rules are documented inline; an "unclassified" bucket
   captures any you-context damage tick that didn't match, so nothing
   is silently dropped (a coverage check). */
'use strict';
const fs = require('fs');
const readline = require('readline');

const files = process.argv.slice(2);
if (!files.length) { console.error('pass xml files'); process.exit(1); }

const strip = s => s.replace(/<[^>]*>/g, '').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/^\d\d:\d\d:\d\d:\s?/,'');

// ---- flare classification (only YOUR flares; owner check done by caller) ----
function classifyFlare(t){
  if (/Hissing darkness/i.test(t)) return 'spear: hissing darkness (acid)';
  if (/forged spear pulses with a burst of plasma/i.test(t)) return 'spear: plasma';
  if (/forged spear bursts alight/i.test(t)) return 'spear: fire';
  if (/forged spear sprays/i.test(t)) return 'spear: acid spray';
  if (/forged spear surges with power/i.test(t)) return 'spear: force surge';
  if (/ebon-colored ice/i.test(t)) return 'spear: ebon ice (cold)';
  if (/Necrotic energy from your forged spear/i.test(t)) return 'spear: necrotic (heals you, no dmg)';
  if (/spike on your spiked mithglin greatshield/i.test(t)) return 'greatshield: spike';
  if (/mithril full plate bursts alight/i.test(t)) return 'plate: fire';
  if (/mithril full plate releases .*tendril/i.test(t)) return 'plate: force tendril';
  if (/Afflicted by your mithril full plate/i.test(t)) return 'plate: poison';
  if (/The air around .* pulses rapidly with violent oscillation/i.test(t)) return 'weapon: concussive oscillation';
  if (/Harvested essence stirs within your arcarium/i.test(t)) return 'arcarium: essence proc (buff, no dmg)';
  if (/noxious brume/i.test(t)) return 'noxious brume';
  return 'other (yours): ' + t.replace(/^\*\*\s*/,'').split(/\s+/).slice(0,6).join(' ');
}
const NONDMG = /necrotic|arcarium: essence/;

// Known Paladin buffs/utility — never damage spells; used to reject stale-name pollution.
const BUFFS = new Set(['Defense of the Faithful','Aura of the Arkati','Water Walking','Divine Shield',
  'Spirit Warding I','Spirit Warding II','Faith\'s Clarity','Higher Vision',"Patron's Blessing",'Vigor',
  'Dauntless','Mantle of Faith','Armor Blessing','Bravery','Prayer','Benediction','Zealot','Righteous Wrath',
  'Prayer of Holding','Well of Life','Beacon of Courage','Symbol of Protection','Symbol of Courage']);

// ---- tallies ----
const spells = {};        // name -> {count, dmg}
let weapon = {count:0, dmg:0};
let maneuver = {count:0, dmg:0};   // count = SMR maneuver resolutions (shield throw, radial sweep, bash, …)
const flares = {};        // name -> {count, dmg}
let unclassified = {count:0, dmg:0};

// ---- state machine ----
let actor = 'other';      // 'you' | 'other' (last attack initiator)
let seqCat = null;        // 'spell' | 'weapon' | 'maneuver'
let spellName = null;     // last spell you began casting
let sink = {mine:false};  // where plain "... N points" ticks go
let justFlare = false;

const SELF_ATTACK = /^You\b.*\b(swing|lunge|thrust|jab|attack|launch|snap|hurl|lob|fire|shoot|sweep|bash|punch|kick|whirl|slice|drive|strike|chop|pound|cleave|slam|stab)/;
const SELF_CAST   = /^You\b.*\b(gesture|incant|cast|invoke|point|raise|trace|murmur|recite|utter|chant|weave|intone|evoke)|^Your spell is ready|^Your vision darkens/;
const OTHER_ATTACK= /^(?:A|An|The|[A-Z][a-z]+)\b.*\b(swings?|lunges?|thrusts?|jabs?|claws?|bites?|gestures?|hurls?|lashes?|attacks?|strikes?|slashes?|charges?|pounds?|flails?|kicks?|punches?|swipes?|slams?|rakes?|gores?|stabs?|chomps?|snaps?|lunges? towards you|tries to)/;
const INCOMING    = /\bat you\b|\bhits for\b|assails you|ravage you|barrels into you|slashes at you|swings at you/;

async function run(){
  for (const fp of files){
    const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity });
    for await (const raw of rl){
      const t = strip(raw);
      if (!t.trim()) continue;

      // spell name capture
      let m;
      if ((m = t.match(/incantation for ([A-Z][\w' -]+?)[.!]/))) spellName = m[1].trim();

      // incoming markers reset ownership so stray ticks aren't credited to you
      if (INCOMING.test(t)) { actor='other'; sink={mine:false}; justFlare=false; }

      // actor-init
      if (SELF_ATTACK.test(t)) { actor='you'; seqCat='weapon'; sink={mine:false}; justFlare=false; }
      else if (SELF_CAST.test(t)) { actor='you'; seqCat='spell'; sink={mine:false}; justFlare=false; }
      else if (OTHER_ATTACK.test(t) && !/^You\b/.test(t)) { actor='other'; seqCat=null; sink={mine:false}; justFlare=false; }

      // resolutions
      if (/^\s*CS:\s*[+\-]?\d+\s*-\s*TD:/.test(t)) { if (actor==='you') seqCat='spell'; } // enemy CS lines stay 'other'
      else if (/^\s*AS:\s*[+\-]?\d+\s+vs DS:/.test(t)) { if (actor==='you') seqCat='weapon'; }
      else if (/\[SMR result:/.test(t)) { if (actor==='you' && !justFlare) { seqCat='maneuver'; maneuver.count++; sink={kind:'maneuver', mine:true}; } }

      // spell resolves (name is best-effort; buff names rejected as stale pollution)
      if (/^\s*Warding failed!/.test(t) && seqCat==='spell' && actor==='you') {
        let nm = spellName; if (!nm || BUFFS.has(nm)) nm = 'offensive spell (unnamed)';
        spells[nm] = spells[nm] || {count:0, dmg:0};
        spells[nm].count++;
        sink = {kind:'spell', name:nm, mine:true};
        spellName = null;
      }
      if (/Warded off!|is buffeted|resists the/.test(t) && seqCat==='spell' && actor==='you') { sink={mine:false}; spellName=null; }

      // flare line (may have leading spaces; classify on trimmed text)
      if (/^\s*\*\*/.test(t)) {
        const ft = t.replace(/^\s+/,'');
        const otherOwner = /\b[A-Z][a-z]+'s\b/.test(ft) && !/\byour\b/i.test(ft);
        const name = classifyFlare(ft);
        const known = !name.startsWith('other (yours)');
        const mine = !otherOwner && (/\byour\b/i.test(ft) || known);
        if (mine) {
          flares[name] = flares[name] || {count:0, dmg:0};
          flares[name].count++;
          sink = {kind:'flare', name, mine:true, nondmg: NONDMG.test(name)};
          justFlare = true;
        } else { sink = {mine:false}; }
      }

      // ---- damage lines ----
      // weapon base: "and hit for N" (2nd person = you). "hits for" = Elmilrion/creature (skip).
      if ((m = t.match(/\.\.\.\s*and hit for (\d+) points? of damage/))) {
        weapon.count++; weapon.dmg += +m[1];   // "hit for" (2nd person) = Kyrandos only
        continue;
      }
      // plain tick: "... N points of damage!"
      if ((m = t.match(/^\s*\.\.\.\s*(\d+) points? of damage/))) {
        const n = +m[1];
        if (sink.mine) {
          if (sink.kind==='spell') { spells[sink.name].dmg += n; }
          else if (sink.kind==='maneuver') { maneuver.dmg += n; }
          else if (sink.kind==='flare') { if (!sink.nondmg) flares[sink.name].dmg += n; }
          else { unclassified.count++; unclassified.dmg += n; }
        }
        justFlare = false;
        continue;
      }
    }
  }
  report();
}

function report(){
  const sum = o => Object.values(o).reduce((a,x)=>a+x.dmg,0);
  const spellTot = sum(spells);
  const flareTot = sum(flares);
  const physTot = weapon.dmg + maneuver.dmg;
  const grand = spellTot + physTot + flareTot + unclassified.dmg;
  const pct = n => grand? (100*n/grand).toFixed(1)+'%' : '0%';

  console.log('================ KYRANDOS DAMAGE TALLY ================');
  console.log('grand total outgoing: ' + grand.toLocaleString() + '\n');

  console.log('--- BY CATEGORY ---');
  console.log('Spells      ' + String(spellTot).padStart(9) + '   ' + pct(spellTot));
  console.log('Physical    ' + String(physTot).padStart(9) + '   ' + pct(physTot) + '   (weapon ' + weapon.dmg + ' / maneuvers ' + maneuver.dmg + ')');
  console.log('Flares      ' + String(flareTot).padStart(9) + '   ' + pct(flareTot));
  if (unclassified.dmg) console.log('Unclassified' + String(unclassified.dmg).padStart(9) + '   ' + pct(unclassified.dmg) + '   (' + unclassified.count + ' ticks — attribution gap)');

  console.log('\n--- SPELLS (by name) ---');
  Object.entries(spells).sort((a,b)=>b[1].dmg-a[1].dmg).forEach(([n,v])=>
    console.log('  ' + n.padEnd(34) + ' casts:' + String(v.count).padStart(5) + '  dmg:' + String(v.dmg).padStart(8) + '  avg:' + (v.count? (v.dmg/v.count).toFixed(1):'-')));

  console.log('\n--- PHYSICAL ---');
  console.log('  weapon hits      count:' + String(weapon.count).padStart(5) + '  dmg:' + String(weapon.dmg).padStart(8) + '  avg:' + (weapon.count?(weapon.dmg/weapon.count).toFixed(1):'-'));
  console.log('  maneuvers        count:' + String(maneuver.count).padStart(5) + '  dmg:' + String(maneuver.dmg).padStart(8) + '  avg:' + (maneuver.count?(maneuver.dmg/maneuver.count).toFixed(1):'-'));

  console.log('\n--- FLARES (frequency + damage) ---');
  Object.entries(flares).sort((a,b)=>b[1].dmg-a[1].dmg || b[1].count-a[1].count).forEach(([n,v])=>
    console.log('  ' + n.padEnd(42) + ' fired:' + String(v.count).padStart(5) + '  dmg:' + String(v.dmg).padStart(8) + '  avg:' + (v.count?(v.dmg/v.count).toFixed(1):'-')));
}
run();
