/**
 * Db.gs
 * Thin spreadsheet-as-database access layer.
 * Every tab is treated as a table whose first row is the header.
 * All writes are serialized with a document lock (last-write-wins per the brief).
 */

var Db = (function () {

  // Per-request read cache. Each google.script.run call is a fresh execution, so
  // this memoises full-tab reads within one request and is cleared on any write.
  var _cache = {};

  // Per-request lookup indexes: { tab+'!'+field : { stringValue → first matching row } }.
  // Turns the O(n) linear scan in findBy() into an O(1) map hit. Rebuilt lazily
  // from the cached rows and dropped alongside _cache whenever the tab is written.
  var _index = {};

  function ss_() {
    var id = PropertiesService.getScriptProperties().getProperty(CONFIG.PROP.DATA_SHEET_ID);
    if (!id) throw new Error('Data Sheet not configured. Run Setup → setupApp() first.');
    return SpreadsheetApp.openById(id);
  }

  function sheet_(tab) {
    var sh = ss_().getSheetByName(tab);
    if (!sh) throw new Error('Missing tab: ' + tab + '. Run repairSchema().');
    return sh;
  }

  function headers_(tab) {
    return CONFIG.HEADERS[tab];
  }

  /** Read every row of a tab as an array of plain objects keyed by header. */
  function readAll(tab) {
    if (_cache[tab]) return _cache[tab];
    var sh = sheet_(tab);
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return [];
    var head = values[0];
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      if (row.join('') === '') continue; // skip blank line
      var obj = { _row: r + 1 };
      for (var c = 0; c < head.length; c++) {
        obj[head[c]] = normalize_(row[c]);
      }
      rows.push(obj);
    }
    _cache[tab] = rows;
    return rows;
  }

  function normalize_(v) {
    if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
    return v;
  }

  /** Drop the cached rows AND any derived lookup indexes for a tab (or everything). */
  function invalidate_(tab) {
    if (tab) {
      delete _cache[tab];
      var prefix = tab + '!';
      for (var k in _index) { if (k.indexOf(prefix) === 0) delete _index[k]; }
    } else {
      _cache = {};
      _index = {};
    }
  }

  /**
   * Lazily build (and memoise) a { stringValue → first matching row } map for one
   * column of a tab, so repeated lookups by that column are O(1) instead of O(n).
   * First-match-wins mirrors the old linear findBy exactly.
   */
  function indexBy(tab, field) {
    var key = tab + '!' + field;
    if (_index[key]) return _index[key];
    var rows = readAll(tab);
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var k = String(rows[i][field]);
      if (!map.hasOwnProperty(k)) map[k] = rows[i]; // keep first occurrence
    }
    _index[key] = map;
    return map;
  }

  function findBy(tab, field, value) {
    return indexBy(tab, field)[String(value)] || null;
  }

  function filter(tab, predicate) {
    return readAll(tab).filter(predicate);
  }

  /** Append one record. Missing fields default to ''. Returns the stored object. */
  function insert(tab, obj) {
    return withLock_(function () {
      var sh = sheet_(tab);
      var head = headers_(tab);
      var line = head.map(function (h) { return obj.hasOwnProperty(h) ? toCell_(obj[h]) : ''; });
      sh.appendRow(line);
      invalidate_(tab);
      return obj;
    });
  }

  /** Patch the first row whose idField matches idValue. Returns true if updated. */
  function update(tab, idField, idValue, patch) {
    return withLock_(function () {
      var sh = sheet_(tab);
      var values = sh.getDataRange().getValues();
      var head = values[0];
      var idCol = head.indexOf(idField);
      if (idCol < 0) throw new Error('No column ' + idField + ' in ' + tab);
      for (var r = 1; r < values.length; r++) {
        if (String(values[r][idCol]) === String(idValue)) {
          for (var key in patch) {
            var c = head.indexOf(key);
            if (c >= 0) sh.getRange(r + 1, c + 1).setValue(toCell_(patch[key]));
          }
          invalidate_(tab);
          return true;
        }
      }
      return false;
    });
  }

  /** Hard-delete the first row whose idField matches idValue. */
  function remove(tab, idField, idValue) {
    return withLock_(function () {
      var sh = sheet_(tab);
      var values = sh.getDataRange().getValues();
      var head = values[0];
      var idCol = head.indexOf(idField);
      for (var r = values.length - 1; r >= 1; r--) {
        if (String(values[r][idCol]) === String(idValue)) {
          sh.deleteRow(r + 1);
          invalidate_(tab);
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Prepare a value for writing to a Sheets cell.
   *
   * Formula injection defence: Sheets executes any string whose first character
   * is =, +, -, or @ as a formula (e.g. =IMPORTXML(...) can exfiltrate data).
   * Prefixing with a leading apostrophe forces literal-text mode.  The apostrophe
   * is stored as a cell "prefix" — it is invisible in the cell and is NOT returned
   * by getValues(), so round-trips are lossless.  Booleans, numbers, and Dates
   * are passed through as-is because Sheets handles their types natively and none
   * of them can trigger formula execution.
   */
  function toCell_(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number')  return v;
    if (v instanceof Date)      return v;
    var s = String(v);
    if (s.length > 0 && '=+-@'.indexOf(s[0]) !== -1) return "'" + s;
    return s;
  }

  function withLock_(fn) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { return fn(); }
    finally { lock.releaseLock(); }
  }

  return {
    ss: ss_,
    sheet: sheet_,
    readAll: readAll,
    indexBy: indexBy,
    findBy: findBy,
    filter: filter,
    insert: insert,
    update: update,
    remove: remove,
    invalidate: invalidate_
  };
})();

/* ---- Small shared helpers used across modules ---- */

function nowIso() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

function today() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function genId(prefix) {
  return prefix + '-' + Utilities.getUuid().slice(0, 8);
}

function asBool(v) {
  return v === true || String(v).toLowerCase() === 'true';
}

function lc(email) {
  return String(email || '').trim().toLowerCase();
}
