// Copyright (c) 2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("promises", {
    exports: ["Promise", "Task", "promises"],
    require: []
});

lazyRequire("resource://gre/modules/Promise.jsm", ["Promise"]);
lazyRequire("resource://gre/modules/Task.jsm", ["Task"]);

var Promises = Module("Promises", {
    /**
     * Wraps the given function so that each call spawns a Task.
     *
     * @param {function} fn The function to wrap.
     * @returns {function}
     */
    task: function task(fn) {
        return function task_(...args) {
            return Task.spawn(fn.bind.apply(fn, [this].concat(args)));
        }
    },

    /**
     * Wraps the given function so that its first argument is a
     * callback which, when called, resolves the returned promise.
     *
     * @param {function} fn The function to wrap.
     * @returns {Promise}
     */
    withCallback: function withCallback(fn) {
        return function wrapper(...args) {
            let deferred = Promise.defer();
            function callback(arg) {
                deferred.resolve(arg);
            }
            return fn.apply(this, [callback].concat(args));
        }
    },
});

endModule();

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
