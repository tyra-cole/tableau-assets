/* pivot.js - turns Tableau summary data (long: Measure Names/Measure Values) into the wide table shown on the dashboard. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CsvPivot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Column order of the dashboard table (matched after trimming spaces and a leading "Calc:").
  // Leave [] to use the order in which Measure Names first appear in the data.
  var MEASURE_ORDER = ['PSF Count', 'PSF %', 'CSF Count', 'CSF %'];
  var LAYOUTS = {
    'Form Details Table': {
      columns: ['ID', 'Submission Date', 'Case Number', 'Offense', 'Offense Date',
                'Detective Assigned (Badge)', 'Unit Assigned', 'PSF', 'CSFs',
                'Federal Charges Filed', 'Federal Offense'],
      drop: ['Blank', 'OFFENSE_RAW'],
           trimTime: ['Submission Date']
    },
    'Highlight Table': {
      xlsx: true,
      matrix: {
        rows: 'Offense',                 // field on Rows
        cols: 'Factor',                  // field on Columns
        value: '% of Offense',           // measure shown in the cells
        corner: 'Offense',               // header of the first column
        rowOrder: ['Business Robbery', 'Individual Robbery', 'Kidnapping/Unlawful Restraint',
                   'Murder/Manslaughter', 'Sex Assault FV', 'Sex Assault NFV', 'Other'],
        colOrder: ['Witness', 'Video', 'Suspect Surrendered/Stayed at Scene', 'ALPR', 'Intel',
                   'CDRs', 'Social Media', 'Phone Extraction', 'NIBIN']
      }
    }
  };

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

  // Grid (Offense x Factor). Fields are matched by name (case-insensitive, "Calc:"/AGG()/ATTR() ignored).
  // Members missing from rowOrder/colOrder are appended in the order they first appear.
  function toMatrix(table, m) {
    var cols = table.columns;
    function find(want) {
      var w = norm(want).toLowerCase();
      return cols.findIndex(function (c) { return norm(cleanHeader(c.fieldName)).toLowerCase() === w; });
    }
    var iR = find(m.rows), iC = find(m.cols), iVal = find(m.value);
    var iN = cols.findIndex(function (c) { return c.fieldName === 'Measure Names'; });
    var iV = cols.findIndex(function (c) { return c.fieldName === 'Measure Values'; });
    var useMV = iVal < 0 && iN >= 0 && iV >= 0;
    if (iR < 0 || iC < 0 || (iVal < 0 && !useMV)) {
      throw new Error('Matrix fields not found (rows="' + m.rows + '", cols="' + m.cols + '", value="' + m.value +
        '"). Columns returned: ' + cols.map(function (c) { return c.fieldName; }).join(' | '));
    }
    var rowSeen = [], colSeen = [], cell = {}, rawCell = {};
    table.data.forEach(function (r) {
      if (useMV && norm(text(r[iN])).toLowerCase() !== norm(m.value).toLowerCase()) return;
      var rk = text(r[iR]), ck = text(r[iC]);
      if (rowSeen.indexOf(rk) < 0) rowSeen.push(rk);
      if (colSeen.indexOf(ck) < 0) colSeen.push(ck);
      cell[rk + '\u0001' + ck] = text(r[useMV ? iV : iVal]);
      var rv = r[useMV ? iV : iVal], nv = rv && rv.value !== '' && rv.value != null ? Number(rv.value) : NaN;
      rawCell[rk + '\u0001' + ck] = isFinite(nv) ? nv : null;
    });
    function arrange(order, seen) {
      return (order || []).filter(function (x) { return seen.indexOf(x) >= 0; })
        .concat(seen.filter(function (x) { return (order || []).indexOf(x) < 0; }));
    }
    var rows = arrange(m.rowOrder, rowSeen), fcols = arrange(m.colOrder, colSeen);
    return {
      header: [m.corner || m.rows].concat(fcols),
      rows: rows.map(function (rk) {
        return [rk].concat(fcols.map(function (ck) { var v = cell[rk + '\u0001' + ck]; return v == null ? '' : v; }));
      }),
      raw: rows.map(function (rk) {
        return [null].concat(fcols.map(function (ck) { var v = rawCell[rk + '\u0001' + ck]; return v == null ? null : v; }));
      })
    };
  }

  // table = { columns: [{fieldName, dataType}], data: [[{value, formattedValue}, ...], ...] }
  function toWide(table, opts) {
    opts = opts || {};
    if (opts.layout && opts.layout.matrix) return toMatrix(table, opts.layout.matrix);
    var order = (opts.measureOrder !== undefined ? opts.measureOrder : MEASURE_ORDER).map(norm);
    var cols = table.columns;
    var iN = cols.findIndex(function (c) { return c.fieldName === 'Measure Names'; });
    var iV = cols.findIndex(function (c) { return c.fieldName === 'Measure Values'; });

    if (iN < 0 || iV < 0) {                // not a Measure Names/Values sheet: reorder/trim only
      var layout = opts.layout || {};
      var hdr = cols.map(function (c) { return cleanHeader(c.fieldName); });
      var idx = cols.map(function (c, i) { return i; }).filter(function (i) {
        return (layout.drop || []).indexOf(hdr[i]) < 0;
      });
      if (layout.columns) {
        var rank = function (i) { var k = layout.columns.indexOf(hdr[i]); return k < 0 ? 1e6 + i : k; };
        idx.sort(function (a, b) { return rank(a) - rank(b); });
      }
      var trim = layout.trimTime || [];
      return {
        header: idx.map(function (i) { return hdr[i]; }),
        rows: table.data.map(function (r) {
          return idx.map(function (i) {
            var t = text(r[i]);
            return trim.indexOf(hdr[i]) >= 0 ? t.replace(/\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M$/i, '') : t;
          });
        })
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
      rows: groups.slice().sort(function (a, b) {
        var ta = a.key[0] === 'All', tb = b.key[0] === 'All';   // keep a total row last
        if (ta !== tb) return ta ? 1 : -1;
        return a.key.join('\u0001').localeCompare(b.key.join('\u0001'), undefined, { sensitivity: 'base', numeric: true });
      }).map(function (g) {
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

  return { toWide: toWide, appendTotals: appendTotals, toCsv: toCsv, norm: norm, LAYOUTS: LAYOUTS };
});
