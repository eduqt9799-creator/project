/**
 * Shared write-generation counter.
 *
 * The Apps Script bridge answers a single-table read in 6-17s, and several
 * routes read the same reference tables (users, departments) on every single
 * request. dataService caches reads for a short window; this counter lets any
 * write bump the generation so cached rows are never served after a mutation,
 * without dataService and appsScriptClient having to import each other.
 */
let epoch = 0;

module.exports = {
  get: () => epoch,
  bump: () => {
    epoch += 1;
  },
};