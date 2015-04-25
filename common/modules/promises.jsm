// Copyright (c) 2015 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("promises", {
    exports: ["CancelablePromise", "Promise", "Task", "promises"],
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

function CancelablePromise(executor, oncancel) {
    let deferred = Promise.defer();
    let canceled = new Promise((accept, reject) => {
        promises.oncancel(deferred, accept);
    });

    try {
        executor(deferred.resolve, deferred.reject, canceled);
    }
    catch (e) {
        deferred.reject(e);
    }

    return Object.freeze(Object.create(deferred.promise, {
        cancel: {
            value: thing => promises.cancel(deferred.promise, thing)
        }
    }));
}

var Promises = Module("Promises", {
    _cancel: new WeakMap,

    /**
     * Allows promises to be canceled.
     *
     * @param {Promise} promise The promise to cancel.
     * @param {*} arg Argument to be passed to the cancellation
     * function.
     */
    cancel: function cancel(promise, reason) {
        let cleanup = this._cancel.get(promise);
        if (cleanup) {
            cleanup[0](promise);
            cleanup[1](reason);
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
        this._cancel.set(deferred.promise, [fn, deferred.reject]);
    },

    /**
     * Returns a promise which resolves after a brief delay.
     */
    delay: function delay([accept]) {
        return new Promise(resolve => {
            let { mainThread } = services.threading;
            mainThread.dispatch(resolve, mainThread.DISPATCH_NORMAL);
        });
    },

    /**
     * Returns true if the passed object is a promise.
     */
    isPromise: function isPromise(obj) {
        return isObject(obj) && typeof obj.then === "function";
    },

    /**
     * Returns a promise which resolves after the given number of
     * milliseconds.
     *
     * @param {number} delay The number of milliseconds to wait.
     */
    sleep: function sleep(delay) {
        return new Promise(resolve => {
            this.timeout(resolve, delay);
        });
    },

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
    waitFor: function waitFor(test, timeout=null, pollInterval=10) {
        return new Promise((resolve, reject) => {
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
                        resolve(result);
                    }
                },
                pollInterval, services.Timer.TYPE_REPEATING_SLACK);
        });
    },

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
