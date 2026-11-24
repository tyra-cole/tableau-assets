/* pivot.js - turns Tableau summary data (long: Measure Names/Measure Values) into the wide table shown on the dashboard. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CsvPivot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Column order of the dashboard table (matched after trimming spaces and a leading "Calc:").
  // Leave [] to use the order in which Measure Names first appear in the data.
  var MEASURE_ORDER = ['PSF Count', 'PSF %', 'CSF Count', 'CSF %'];

  var AGG = /^(SUM|AVG|MIN|MAX|MEDIAN|CNT|CNTD|COUNT|COUNTD|AGG|STDEV|STDEVP|VAR|VARP)\((.*)\)$/i;

  function stripAgg(name) {
    var m = AGG.exec(name);
    return m ? m[2] : name;
  }
  function norm(s) {                       // "AGG(Calc: PSF %)" -> "PSF %"
    return stripAgg(String(s == null ? '' : s)).replace(/^\s*Calc:\s*/i, '').trim();
  }
  function cleanHeader(name) {             // "ATTR(Factor)" -> "Factor"
    var m = /^ATTR\((.*)\)$/i.exec(name);
    return m ? m[1] : name;
  }
  function text(cell) {
    if (cell == null) return '';
    var f = cell.formattedValue;
    if (f != null && f !== '' && f !== '%null%') return String(f);
    var v = cell.value;
    return v == null || v === '%null%' ? '' : String(v);
  }
  function isMeasureCol(col) {
    return AGG.test(col.fieldName) || col.dataType === 'int' || col.dataType === 'float';
  }

  // table = { columns: [{fieldName, dataType}], data: [[{value, formattedValue}, ...], ...] }
  function toWide(table, opts) {
    opts = opts || {};
    var order = (opts.measureOrder !== undefined ? opts.measureOrder : MEASURE_ORDER).map(norm);
    var cols = table.columns;
    var iN = cols.findIndex(function (c) { return c.fieldName === 'Measure Names'; });
    var iV = cols.findIndex(function (c) { return c.fieldName === 'Measure Values'; });

    if (iN < 0 || iV < 0) {                // not a Measure Names/Values sheet: pass through
      return {
        header: cols.map(function (c) { return cleanHeader(c.fieldName); }),
        rows: table.data.map(function (r) { return r.map(text); })
      };
    }

    var keyIdx = [];
    cols.forEach(function (c, i) { if (i !== iN && i !== iV && !isMeasureCol(c)) keyIdx.push(i); });

    // measure columns already present as their own (formatted) columns, keyed by normalized name
    var direct = {};
    cols.forEach(function (c, i) { if (i !== iV && isMeasureCol(c)) direct[norm(c.fieldName)] = i; });

    var names = [], seen = {}, groups = [], byKey = {};
    table.data.forEach(function (r) {
      var mn = norm(text(r[iN]));
      if (!seen[mn]) { seen[mn] = true; names.push(mn); }
      var key = keyIdx.map(function (i) { return text(r[i]); });
      var k = JSON.stringify(key);
      var g = byKey[k];
      if (!g) { g = byKey[k] = { key: key, row: r, vals: {} }; groups.push(g); }
      g.vals[mn] = text(r[iV]);
    });

    var ordered = order.filter(function (n) { return seen[n]; })
      .concat(names.filter(function (n) { return order.indexOf(n) < 0; }));

    return {
      header: keyIdx.map(function (i) { return cleanHeader(cols[i].fieldName); }).concat(ordered),
      rows: groups.map(function (g) {
        return g.key.concat(ordered.map(function (n) {
          return direct[n] !== undefined ? text(g.row[direct[n]])
               : (g.vals[n] !== undefined ? g.vals[n] : '');
        }));
      })
    };
  }

  // Optional: add a grand-total row built from a second sheet that has the measures but no dimension.
  function appendTotals(wide, totalsWide, label) {
    if (!totalsWide || !totalsWide.rows.length) return wide;
    var t = totalsWide.rows[0];
    var row = wide.header.map(function (h, i) {
      if (i === 0) return label || 'All';
      var j = totalsWide.header.findIndex(function (x) { return norm(x) === norm(h); });
      return j >= 0 ? t[j] : '';
    });
    return { header: wide.header, rows: wide.rows.concat([row]) };
  }

  function toCsv(wide) {
    function q(s) { s = String(s); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    return [wide.header].concat(wide.rows).map(function (r) { return r.map(q).join(','); }).join('\r\n');
  }

  return { toWide: toWide, appendTotals: appendTotals, toCsv: toCsv, norm: norm };
});
