// Copyright (c) 2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("promises", {
    exports: ["Promise", "Task", "promises"],
    require: []
});

lazyRequire("services", ["services"]);

lazyRequire("resource://gre/modules/Promise.jsm", ["Promise"]);
lazyRequire("resource://gre/modules/Task.jsm", ["Task"]);

function withCallbacks(fn) {
    return function wrapper(...args) {
        let deferred = Promise.defer();
        function resolve(arg) { deferred.resolve(arg); }
        function reject(arg)  { deferred.reject(arg); }
        fn.apply(this, [[resolve, reject, deferred]].concat(args));
        return deferred.promise;
    }
}

var Promises = Module("Promises", {
    _cancel: WeakMap(),

    /**
     * Allows promises to be canceled..
     *
     * @param {Promise} promise The promise to cancel.
     * @param {*} arg Argument to be passed to the cancellation
     * function.
     */
    cancel: function cancel(promise, reason) {
        let cleanup = this._cancel.get(promise);
        if (cleanup) {
            cleanup[0](promise);
            cleanup[1].reject(reason);
        }
        this._cancel.delete(promise);
    },

    /**
     * Registers a cleanup function for the given deferred promise.
     *
     * @param {Deferred} promise The promise to cancel.
     * @param {function} fn The cleanup function.
     */
    oncancel: function oncancel(deferred, fn) {
        this._cancel.set(deferred.promise, [fn, deferred]);
    },

    /**
     * Returns a promise which resolves after a brief delay.
     */
    delay: withCallbacks(function delay([accept]) {
        let { mainThread } = services.threading;
        mainThread.dispatch(accept, mainThread.DISPATCH_NORMAL);
    }),

    /**
     * Returns a promise which resolves after the given number of
     * milliseconds.
     *
     * @param {number} delay The number of milliseconds to wait.
     */
    sleep: withCallbacks(function sleep([callback], delay) {
        this.timeout(callback, delay);
    }),

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
     * Returns a promise which resolves when the function *test* returns
     * true, or *timeout* milliseconds have expired.
     *
     * @param {function} test The predicate on which to wait.
     * @param {Number} timeout The maximum number of milliseconds to
     *      wait.
     *      @optional
     * @param {number} pollInterval The poll interval, in milliseconds.
     *      @default 10
     */
    waitFor: withCallbacks(function waitFor([accept, reject], test, timeout=null, pollInterval=10) {
        let end = timeout && Date.now() + timeout, result;

        let timer = services.Timer(
            () => {
                try {
                    var result = test();
                }
                catch (e) {
                    timer.cancel();
                    reject(e);
                }
                if (result) {
                    timer.cancel();
                    accept(result);
                }
            },
            pollInterval, services.Timer.TYPE_REPEATING_SLACK);
    }),

    /**
     * Wraps the given function so that its first argument is an array
     * of success and failure callbacks which, when called, resolve the
     * returned promise.
     *
     * @param {function} fn The function to wrap.
     * @returns {Promise}
     */
    withCallbacks: withCallbacks,
});

endModule();

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
