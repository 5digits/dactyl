/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is MozMill Test code.
 *
 * The Initial Developer of the Original Code is the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Geo Mealer <gmealer@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

// Paths for mapped memory and allocated memory, respectively.  Use as
// keys to access the appropriate memory reporters.
const PATH_MAPPED = "malloc/mapped";
const PATH_ALLOCATED = "malloc/allocated";

// Returning this as a numeric constant to simplify memory calculations
// Neither allocated nor mapped should be 0 in real life.
const MEMORY_UNAVAILABLE = "0";

// INITIALIZE MEMORY REPORTERS

// gMemReporters will be a dictionary, key=path and val=reporter
// See initMemReporters() for how it's used.
var gMemReporters = {};

/**
 * Initialize the static memory reporters
 *
 * Called during module initialization, below.
 * See also aboutMemory.js in Firefox code
 */
function initMemReporters() {
  var memMgr = Cc["@mozilla.org/memory-reporter-manager;1"].
               getService(Ci.nsIMemoryReporterManager);

  // Grab all the memory reporters, load into gMemReporters as a dictionary
  var e = memMgr.enumerateReporters();
  while (e.hasMoreElements()) {
    var memReporter = e.getNext().QueryInterface(Ci.nsIMemoryReporter);
    gMemReporters[memReporter.path] = memReporter;
  }
}

initMemReporters();

/**
 * PERFORMANCE TRACER
 *
 * Keeps a trace log of both actions and performance statistics
 * throughout a test run.
 *
 * Performance stats currently include mapped and allocated memory.
 * More stats will be added as methods to read them are discovered.
 *
 * Usage:
 *   Before test, create a new PerfTracer named after the test.
 *     Ex: var perf = new performance.PerfTracer("MyTestFunc");
 *
 *   During test, after notable actions call PerfTracer.addCheckpoint(label)
 *     Ex: perf.addCheckpoint("Opened preferences dialog");
 *
 *   After test, call PerfTracer.finish()
 *     Ex: perf.finish();
 */

/**
 * PerfTracer constructor
 *
 * @param {string} name
 *        Name of the tracer, currently used in the output title
 */
function PerfTracer(name) {
  if (!name) {
    throw new Error(arguments.callee.name + ": name not supplied.");
  }

  this.clearLog();
  this._name = name;
}

PerfTracer.prototype = {
  // UTILITY METHODS

  /**
   * Format a single result for printing
   *
   * @param {object} result
   *        Result as created by addCheckpoint()
   *        Elements: timestamp {Date}   - date/time
   *                  allocated {number} - allocated memory
   *                  mapped {number}    - mapped memory
   *                  label {string}     - label for result
   *
   * @returns Result string formatted for output
   * @type {string}
   */
  _formatResult : function PerfTracer_formatResult(result) {
    var resultString = result.timestamp.toUTCString() + " | " +
                       result.allocated + " | " +
                       result.mapped + " | " +
                       result.label + "\n";

    return resultString;
  },

  // PUBLIC INTERFACE

  /**
   * Get a memory value from a reporter
   *
   * @param {string} path
   *        Path of memory reporter (e.g. PATH_MAPPED)
   * @returns Memory value from requested reporter, MEMORY_UNAVAILABLE if
   *          not found
   * @type {number}
   */
  getMemory : function PerfTracer_getMemory(path) {
    var val = MEMORY_UNAVAILABLE;
    if (path in gMemReporters) {
      val = gMemReporters[path].memoryUsed;
    }

    return val;
  },

  /**
   * Clears the tracker log and starts over
   */
  clearLog : function PerfTracer_clearLog() {
    this._log = new Array();
  },

  /**
   * Adds a checkpoint to the tracker log, with time and performance info
   *
   * @param {string} aLabel
   *        Label attached to performance results. Typically should be
   *        whatever the test just did.
   */
  addCheckpoint : function PerfTracer_addCheckpoint(aLabel) {
    var result = {
      label:     aLabel,
      timestamp: new Date(),
      mapped:    this.getMemory(PATH_MAPPED),
      allocated: this.getMemory(PATH_ALLOCATED)
    };

    this._log.push(result);
  },

  /**
   * Prints all results to console.
   * XXX: make this work with output files
   */
  finish : function PerfTracer_finish() {
    // Title
    var title = "Performance Trace (" + this._name + ")";

    // Separator
    var sep = "";
    for(var i = 0; i < title.length; i++) {
      sep += "=";
    }

    dump(sep + "\n");
    dump(title + "\n");
    dump(sep + "\n");

    // Log
    for(i = 0; i < this._log.length; i++) {
      dump(this._formatResult(this._log[i]));
    }
  }
}

// Exported constants
exports.PATH_MAPPED = PATH_MAPPED;
exports.PATH_ALLOCATED = PATH_ALLOCATED;
exports.MEMORY_UNAVAILABLE = MEMORY_UNAVAILABLE;

// Exported class
exports.PerfTracer = PerfTracer;
