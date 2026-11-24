// node test.js <path to Tableau-downloaded CSV>   -- replays the user's real export through pivot.js
const fs = require('fs');
const P = require('./pivot.js');

function parseCsv(s) {
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}

const raw = parseCsv(fs.readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''));
const hdr = raw[0], body = raw.slice(1).filter(r => r.length > 1);
const H = n => hdr.indexOf(n);
const cell = v => ({ value: v, formattedValue: v });
const calcOf = { 'PSF Count': 'Calc: PSF Count', 'PSF %': 'Calc: PSF %', 'CSF Count': 'Calc: CSF Count', 'CSF %': 'Calc: CSF %' };
const calcNames = Object.values(calcOf).sort();          // Tableau sorts measure columns alphabetically

function simulate({ withCalc, aggWrap, dropAll }) {
  const columns = [{ fieldName: 'Factor', dataType: 'string' }, { fieldName: 'Measure Names', dataType: 'string' },
                   { fieldName: 'Measure Values', dataType: 'float' }];
  if (withCalc) calcNames.forEach(n => columns.push({ fieldName: aggWrap ? `AGG(${n})` : n, dataType: 'float' }));
  const data = [];
  body.filter(r => !(dropAll && r[0] === 'All')).forEach(r => {
    const mn = r[H('Measure Names')];
    const shown = r[H(calcOf[mn.trim()])];                 // what the dashboard displays for this measure
    const row = [cell(r[0]), cell(mn), { value: r[H('Measure Values')], formattedValue: shown }];
    if (withCalc) calcNames.forEach(n => row.push(cell(r[H(n)])));
    data.push(row);
  });
  return { columns, data };
}

// expected = what the dashboard table shows (de-duplicated, dashboard column order)
const seen = new Set(), expected = [['Factor', 'PSF Count', 'PSF %', 'CSF Count', 'CSF %']];
body.forEach(r => { if (!seen.has(r[0])) { seen.add(r[0]);
  expected.push([r[0], r[H('Calc: PSF Count')], r[H('Calc: PSF %')], r[H('Calc: CSF Count')], r[H('Calc: CSF %')]]); } });
const expCsv = expected.map(r => r.map(x => /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x).join(',')).join('\r\n');

let fail = 0;
function check(name, got, exp) {
  const ok = got === exp; if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) { console.log('--- got\n' + got + '\n--- expected\n' + exp); }
}

check('A  Calc columns as AGG(...)', P.toCsv(P.toWide(simulate({ withCalc: true, aggWrap: true }))), expCsv);
check('B  Calc columns plain names ', P.toCsv(P.toWide(simulate({ withCalc: true, aggWrap: false }))), expCsv);
check('C  Measure Values only      ', P.toCsv(P.toWide(simulate({ withCalc: false }))), expCsv);

// D: totals row not returned by the API -> built from a dimension-less totals sheet
const main = P.toWide(simulate({ withCalc: false, dropAll: true }));
const totCols = [{ fieldName: 'Measure Names', dataType: 'string' }, { fieldName: 'Measure Values', dataType: 'float' }];
const totData = body.filter(r => r[0] === 'All').map(r => [cell(r[H('Measure Names')]),
  { value: r[H('Measure Values')], formattedValue: r[H(calcOf[r[H('Measure Names')].trim()])] }]);
check('D  All row via totals sheet ', P.toCsv(P.appendTotals(main, P.toWide({ columns: totCols, data: totData }), 'All')), expCsv);

console.log('\n' + expCsv);
process.exit(fail ? 1 : 0);
