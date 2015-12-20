// Copyright (c) 2015 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

// Implementations for some ES6 and ES7 features that aren't in Firefox
// mainline yet.

{
    // This is similar to the same-named function in self-hosted JS, but
    // somewhat less efficient.
    //
    // It helps dodge some of the pitfalls of using the `call` method of the
    // function you're intending to call, which might have been replaced,
    // and can fail for other reasons (on CPOWs, most notably).
    let callFunction = Function.call.bind(Function.call);

    let identity = x => x;

    if (!Object.entries)
        Object.entries = function (obj) {
            let result = [];

            for (let key of Object.keys(obj)) {
                // The check is necessary, since keys may be removed during
                // iteration.
                if (key in obj)
                    result.push([key, obj[val]]);
            }

            return result;
        };

    if (!Object.values)
        Object.values = function (obj) {
            let result = [];

            for (let key of Object.keys(obj)) {
                // The check is necessary, since keys may be removed during
                // iteration.
                if (key in obj)
                    result.push(obj[val]);
            }

            return result;
        };

    if (!Array.prototype.flatMap)
        Array.prototype.flatMap = function (fn = identity, self = null) {
            let result = [];

            for (let [i, value] of Array.prototype.entries.call(this)) {
                let res = callFunction(fn, self, value, i);

                if (isObject(res) && Symbol.iterator in res)
                    result.push(...res);
                else if (res !== undefined)
                    result.push(res);
            }

            return result;
        };

    if (!Array.prototype.values)
        Array.prototype.values = function* () {
            for (let [i, value] of this.entries())
                yield value;
        };
}
