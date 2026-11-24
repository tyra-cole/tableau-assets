/* xlsx.js - builds a styled .xlsx (no dependencies) from the wide table; used for the Highlight Table heat map.
   Rules copied from the dashboard: top factor per offense = blue; every other cell = grey ramp on % of offense. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CsvXlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BLUE = '005BBB';
  // Grey ramp sampled from the dashboard: [% value, colour]. 58.3 = top of the dashboard's colour scale.
  // Stops are rescaled to the data's own max, so the ramp always spans 0 -> max like the dashboard legend.
  var RAMP = [[0, 'EAEAE7'], [1.1, 'E7E8E5'], [5.1, 'DCDDDB'], [10.2, 'CED0CF'], [14.3, 'C3C5C6'],
              [18.7, 'B7BABC'], [22.2, 'ADB1B3'], [28.6, '9CA0A4'], [33.3, '8E9499'], [58.3, '49525E']]
    .map(function (p) { return [p[0] / 58.3, p[1]]; });

  function rgb(h) { return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function hex(a) { return a.map(function (v) { v = Math.round(v); return ('0' + v.toString(16)).slice(-2); }).join('').toUpperCase(); }
  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    for (var i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) {
        var a = RAMP[i - 1], b = RAMP[i], k = (t - a[0]) / (b[0] - a[0]), ca = rgb(a[1]), cb = rgb(b[1]);
        return hex(ca.map(function (v, j) { return v + (cb[j] - v) * k; }));
      }
    }
    return RAMP[RAMP.length - 1][1];
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function colName(i) { var s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }

  // ---- minimal ZIP (stored, no compression) ----
  var CRC = (function () { var t = [], c, n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var csize = central.reduce(function (n, p) { return n + p.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(end.buffer)]);
    var out = new Uint8Array(all.reduce(function (n, p) { return n + p.length; }, 0)), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  // wide = { header: [...], rows: [[label, "10.2%", ...]], raw: [[null, 0.102, ...]] (optional) }
  function build(wide, opt) {
    opt = opt || {};
    var nums = wide.rows.map(function (r, i) {
      return r.map(function (t, j) {
        if (j === 0) return null;
        var raw = wide.raw && wide.raw[i] ? wide.raw[i][j] : null;
        if (typeof raw === 'number' && isFinite(raw)) return raw;
        var m = /^\s*(-?[\d.]+)\s*%\s*$/.exec(t);
        return m ? parseFloat(m[1]) / 100 : null;
      });
    });
    var max = 0;
    nums.forEach(function (r) { r.forEach(function (v) { if (v != null && v > max) max = v; }); });

    // style registry: fixed xfs 0 default, 1 header, 2 row label, 3 note; then one per fill/font
    var fills = [], fillIdx = {}, xfs = [], xfIdx = {}, FIXED = 4;
    function fillId(h) { if (!(h in fillIdx)) { fillIdx[h] = fills.length + 2; fills.push(h); } return fillIdx[h]; }
    function cellXf(h, white) {
      var key = h + (white ? 'w' : 'k');
      if (!(key in xfIdx)) {
        xfIdx[key] = FIXED + xfs.length;
        xfs.push('<xf numFmtId="164" fontId="' + (white ? 1 : 0) + '" fillId="' + fillId(h) + '" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>');
      }
      return xfIdx[key];
    }

    function str(ref, s, style) { return '<c r="' + ref + '" t="inlineStr" s="' + style + '"><is><t>' + esc(s) + '</t></is></c>'; }
    var rowsXml = [];
    rowsXml.push('<row r="1" ht="45" customHeight="1">' + wide.header.map(function (h, j) { return str(colName(j) + '1', h, 1); }).join('') + '</row>');
    wide.rows.forEach(function (r, i) {
      var rn = i + 2, rowMax = 0;
      nums[i].forEach(function (v) { if (v != null && v > rowMax) rowMax = v; });
      var cells = r.map(function (t, j) {
        var ref = colName(j) + rn;
        if (j === 0) return str(ref, t, 2);
        var v = nums[i][j];
        if (v == null) return '<c r="' + ref + '" s="0"/>';
        var top = v > 0 && v >= rowMax - 1e-12;
        var s = top ? cellXf(BLUE, true) : cellXf(ramp(max > 0 ? v / max : 0), false);
        return '<c r="' + ref + '" s="' + s + '"><v>' + v + '</v></c>';
      });
      rowsXml.push('<row r="' + rn + '" ht="30" customHeight="1">' + cells.join('') + '</row>');
    });
    var ln = wide.rows.length + 3;
    rowsXml.push('<row r="' + ln + '">' + '<c r="A' + ln + '" t="inlineStr" s="' + cellXf(BLUE, true) + '"><is><t>Top factor for that offense</t></is></c></row>');
    rowsXml.push('<row r="' + (ln + 1) + '">' + str('A' + (ln + 1), "Grey shading: darker = higher % of each offense's closed cases (0% to " + (max * 100).toFixed(1) + '%)', 3) + '</row>');

    var lastCol = colName(wide.header.length - 1);
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      '<cols><col min="1" max="1" width="32" customWidth="1"/><col min="2" max="' + wide.header.length + '" width="14" customWidth="1"/></cols>' +
      '<sheetData>' + rowsXml.join('') + '</sheetData></worksheet>';

    var NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' + NS + '">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>' +
      '<fonts count="4"><font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font>' +
      '<font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/></font></fonts>' +
      '<fills count="' + (fills.length + 2) + '"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      fills.map(function (h) { return '<fill><patternFill patternType="solid"><fgColor rgb="FF' + h + '"/><bgColor indexed="64"/></patternFill></fill>'; }).join('') + '</fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFFFFFFF"/></left><right style="thin"><color rgb="FFFFFFFF"/></right><top style="thin"><color rgb="FFFFFFFF"/></top><bottom style="thin"><color rgb="FFFFFFFF"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + (FIXED + xfs.length) + '">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      xfs.join('') + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

    var sn = esc((opt.sheetName || 'Sheet1').replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31));
    return zip([
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + sn + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', text: styles },
      { name: 'xl/worksheets/sheet1.xml', text: sheet }
    ]);
  }

  return { build: build, ramp: ramp };
});
