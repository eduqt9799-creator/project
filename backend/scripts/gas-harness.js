/**
 * Test double for Apps Script's Spreadsheet service.
 *
 * apps-script/Code.gs runs on Google's runtime, so the header/column migration
 * in setupSheets() and the read/write paths cannot be exercised by `npm test`
 * without one of these. Only the surface Code.gs actually touches is stubbed:
 * getRange / getLastRow / getLastColumn / insertSheet / deleteRow.
 *
 * A range is addressed the way Sheets addresses it: row and column are
 * 1-based, getValues() returns a 2D array, and setValues() writes one.
 */
const fs = require('fs');
const vm = require('vm');

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.cells = [];
  }

  _ensure(r, c) {
    if (!this.cells[r]) this.cells[r] = [];
    if (this.cells[r][c] === undefined) this.cells[r][c] = '';
    return this.cells[r];
  }

  getLastRow() {
    let last = 0;
    this.cells.forEach((row, i) => {
      if (row && row.some((v) => v !== '' && v !== null && v !== undefined)) last = i + 1;
    });
    return last;
  }

  getLastColumn() {
    let last = 0;
    (this.cells[0] || []).forEach((v, i) => {
      if (v !== '' && v !== null && v !== undefined) last = i + 1;
    });
    return last;
  }

  getRange(row, col, numRows, numCols) {
    const self = this;
    const base = row - 1;
    if (numRows === 1 && numCols === 1) {
      return {
        getValues: () => [[self._ensure(base, col - 1)[col - 1]]],
        setValue: (v) => { self._ensure(base, col - 1)[col - 1] = v; },
        setValues: (v) => { self._ensure(base, col - 1)[col - 1] = v[0][0]; },
        setFontWeight: () => {},
      };
    }
    if (numRows === 1) {
      return {
        getValues: () => [Array.from({ length: numCols }, (_, i) => self._ensure(base, col - 1 + i)[col - 1 + i])],
        setValues: (v) => { for (let i = 0; i < numCols; i += 1) self._ensure(base, col - 1 + i)[col - 1 + i] = v[0][i]; },
        setValue: (v) => { self._ensure(base, col - 1)[col - 1] = v; },
        setFontWeight: () => {},
      };
    }
    return {
      getValues: () =>
        Array.from({ length: numRows }, (_, r) =>
          Array.from({ length: numCols }, (_, c) => self._ensure(base + r, col - 1 + c)[col - 1 + c])
        ),
      setValues: (v) => {
        for (let r = 0; r < numRows; r += 1) {
          const target = self._ensure(base + r, col - 1);
          for (let c = 0; c < numCols; c += 1) target[col - 1 + c] = v[r][c];
        }
      },
      setValue: (v) => { self._ensure(base, col - 1)[col - 1] = v; },
      setFontWeight: () => {},
      clearContent: () => {
        for (let r = 0; r < numRows; r += 1) {
          for (let c = 0; c < numCols; c += 1) {
            const target = self.cells[base + r];
            if (target) target[col - 1 + c] = '';
          }
        }
      },
    };
  }

  setFrozenRows() {}

  deleteRow(r) { this.cells.splice(r - 1, 1); }
}

/** Google services Code.gs touches, stubbed with an in-memory spreadsheet. */
function makeSandbox(sheetsByName) {
  const store = { SPREADSHEET_ID: 'test-spreadsheet-id', API_KEY: 'test-key' };
  const sandbox = {
    console,
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (n) => sheetsByName[n] || null,
        insertSheet: (n) => { sheetsByName[n] = new FakeSheet(n); return sheetsByName[n]; },
      }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] }) },
    Utilities: {
      getUuid: () => `uuid-${Math.random().toString(16).slice(2)}`,
      formatDate: () => '2026-10-04|10|30',
      computeHmacSha256Signature: () => 'sig',
      Charset: { US_ASCII: 'US_ASCII' },
    },
    ContentService: {
      createTextOutput: () => ({ setMimeType: () => {} }),
      MimeType: { JSON: 'json' },
    },
  };
  sandbox.global = sandbox;
  return sandbox;
}

/** Loads apps-script/Code.gs into a sandbox wired to `sheetsByName`. */
function loadCode(gspath, sheetsByName) {
  const sandbox = makeSandbox(sheetsByName);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(gspath, 'utf8'), sandbox, { filename: gspath });
  return sandbox;
}

module.exports = { FakeSheet, loadCode, makeSandbox };