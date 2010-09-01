// Copyright (c) 2009 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let use = {};
let loaded = {};
let currentModule;
function defmodule(name, module, params) {
    module.NAME = name;
    module.EXPORTED_SYMBOLS = params.exports || [];
    dump("defmodule " + name + "\n");
    for(let [, mod] in Iterator(params.require || []))
        require(module, mod);

    for(let [, mod] in Iterator(params.use || []))
        if (loaded.hasOwnProperty(mod))
            require(module, mod, "use");
        else {
            use[mod] = use[mod] || [];
            use[mod].push(module);
        }
    currentModule = module;
}
defmodule.modules = [];

function endmodule() {
    dump("endmodule " + currentModule.NAME + "\n");
    loaded[currentModule.NAME] = 1;
    for(let [, mod] in Iterator(use[currentModule.NAME] || []))
        require(mod, currentModule.NAME, "use");
}

function require(obj, name, from) {
    try {
        dump((from || "require") + ": loading " + name + " into " + obj.NAME + "\n");
        Cu.import("resource://dactyl/" + name + ".jsm", obj);
    }
    catch (e) {
        dump("loading " + String.quote("resource://dactyl/" + name + ".jsm") + "\n"); 
        dump("    " + e.fileName + ":" + e.lineNumber + ": " + e +"\n");
    }
}

defmodule("base", this, {
    // sed -n 's/^(const|function) ([a-zA-Z0-9_]+).*/	"\2",/p' base.jsm | sort | fmt
    exports: [
        "Cc", "Ci", "Class", "Cr", "Cu", "Module", "Object", "Runnable",
        "Struct", "StructBase", "Timer", "allkeys", "array", "call",
        "callable", "curry", "debuggerProperties", "defmodule", "dict",
        "endmodule", "extend", "foreach", "isarray", "isgenerator",
        "isinstance", "isobject", "isstring", "issubclass", "iter", "memoize",
        "properties", "requiresMainThread", "set", "update", "values",
    ],
    use: ["services"]
});

function Runnable(self, func, args) {
    return {
        QueryInterface: XPCOMUtils.generateQI([Ci.nsIRunnable]),
        run: function () { func.apply(self, args || []); }
    };
}

function allkeys(obj) {
    let ret = {};
    try {
        for (; obj; obj = obj.__proto__) {
            services.get("debugger").wrapValue(obj).getProperties(ret, {});
            for (let prop in values(ret.value))
                yield prop.name.stringValue;
        }
        return;
    }
    catch (e) {}

    let __iterator__ = obj.__iterator__;
    try {
        if ("__iterator__" in obj) {
            yield "__iterator__";
            delete obj.__iterator__;
        }
        for (let k in obj)
            yield k;
    }
    finally {
        if (__iterator__)
            obj.__iterator__ = __iterator__;
    }
}

function debuggerProperties(obj) {
    if (loaded.services && services.get("debugger").isOn) {
        let ret = {};
        services.get("debugger").wrapValue(obj).getProperties(ret, {});
        return ret.value;
    }
}

if (!Object.keys)
    Object.keys = function keys(obj) [k for (k in obj) if (obj.hasOwnProperty(k))];

if (!Object.getOwnPropertyNames)
    Object.getOwnPropertyNames = function getOwnPropertyNames(obj) {
        let res = debuggerProperties(obj);
        if (res)
            return [prop.name.stringValue for (prop in values(res))];
        return Object.keys(obj);
    }

function properties(obj, prototypes) {
    let orig = obj;
    let seen = {};
    for (; obj; obj = prototypes && obj.__proto__) {
        try {
            var iter = values(Object.getOwnPropertyNames(obj));
        }
        catch (e) {
            iter = (prop.name.stringValue for (prop in values(debuggerProperties(obj))));
        }
        for (let key in iter)
            if (!prototypes || !set.add(seen, key) && obj != orig)
                yield key
    }
}

function values(obj) {
    for (var k in obj)
        if (obj.hasOwnProperty(k))
            yield obj[k];
}
function foreach(iter, fn, self) {
    for (let val in iter)
        fn.call(self, val);
}

function dict(ary) {
    var obj = {};
    for (var i = 0; i < ary.length; i++) {
        var val = ary[i];
        obj[val[0]] = val[1];
    }
    return obj;
}

function set(ary) {
    let obj = {};
    if (ary)
        for (var i = 0; i < ary.length; i++)
            obj[ary[i]] = true;
    return obj;
}
set.add = function (set, key) {
    let res = this.has(set, key);
    set[key] = true;
    return res;
}
set.has = function (set, key) Object.prototype.hasOwnProperty.call(set, key);
set.remove = function (set, key) { delete set[key]; }

function iter(obj) {
    if (obj instanceof Ci.nsISimpleEnumerator)
        return (function () {
            while (obj.hasMoreElements())
                yield obj.getNext();
        })();
    if (isinstance(obj, [Ci.nsIStringEnumerator, Ci.nsIUTF8StringEnumerator]))
        return (function () {
            while (obj.hasMore())
                yield obj.getNext();
        })();
    if (isinstance(obj, Ci.nsIDOMNodeIterator))
        return (function () {
            try {
                while (true)
                    yield obj.nextNode();
            }
            catch (e) {}
        })();
    if (isinstance(obj, [Ci.nsIDOMHTMLCollection, Ci.nsIDOMNodeList]))
        return array.iteritems(obj);
    if (obj instanceof Ci.nsIDOMNamedNodeMap)
        return (function () {
            for (let i = 0; i < obj.length; i++)
                yield [obj.name, obj];
        })();
    return Iterator(obj);
}

function issubclass(targ, src) {
    return src === targ ||
        targ && typeof targ === "function" && targ.prototype instanceof src;
}

function isinstance(targ, src) {
    const types = {
        boolean: Boolean,
        string: String,
        function: Function,
        number: Number
    }
    src = Array.concat(src);
    for (var i = 0; i < src.length; i++) {
        if (typeof src[i] == "string") {
            if (Object.prototype.toString.call(targ) == "[object " + src[i] + "]")
                return true;
        }
        else {
            if (targ instanceof src[i])
                return true;
            var type = types[typeof targ];
            if (type && issubclass(src[i], type))
                return true;
        }
    }
    return false;
}

function isobject(obj) {
    return typeof obj === "object" && obj != null;
}

/**
 * Returns true if and only if its sole argument is an
 * instance of the builtin Array type. The array may come from
 * any window, frame, namespace, or execution context, which
 * is not the case when using (obj instanceof Array).
 */
function isarray(val) {
    return Object.prototype.toString.call(val) == "[object Array]";
}

/**
 * Returns true if and only if its sole argument is an
 * instance of the builtin Generator type. This includes
 * functions containing the 'yield' statement and generator
 * statements such as (x for (x in obj)).
 */
function isgenerator(val) {
    return Object.prototype.toString.call(val) == "[object Generator]";
}

/**
 * Returns true if and only if its sole argument is a String,
 * as defined by the builtin type. May be constructed via
 * String(foo) or new String(foo) from any window, frame,
 * namespace, or execution context, which is not the case when
 * using (obj instanceof String) or (typeof obj == "string").
 */
function isstring(val) {
    return Object.prototype.toString.call(val) == "[object String]";
}

/**
 * Returns true if and only if its sole argument may be called
 * as a function. This includes classes and function objects.
 */
function callable(val) {
    return typeof val === "function";
}

function call(fn) {
    fn.apply(arguments[1], Array.slice(arguments, 2));
    return fn;
}

function memoize(obj, key, getter) {
    obj.__defineGetter__(key, function () {
        delete obj[key];
        return obj[key] = getter(obj, key);
    });
}

/**
 * Curries a function to the given number of arguments. Each
 * call of the resulting function returns a new function. When
 * a call does not contain enough arguments to satisfy the
 * required number, the resulting function is another curried
 * function with previous arguments accumulated.
 *
 *     function foo(a, b, c) [a, b, c].join(" ");
 *     curry(foo)(1, 2, 3) -> "1 2 3";
 *     curry(foo)(4)(5, 6) -> "4 5 6";
 *     curry(foo)(4)(8)(9) -> "7 8 9";
 *
 * @param {function} fn The function to curry.
 * @param {integer} length The number of arguments expected.
 *     @default fn.length
 *     @optional
 * @param {object} self The 'this' value for the returned function. When
 *     omitted, the value of 'this' from the first call to the function is
 *     preserved.
 *     @optional
 */
function curry(fn, length, self, acc) {
    if (length == null)
        length = fn.length;
    if (length == 0)
        return fn;

    // Close over function with 'this'
    function close(self, fn) function () fn.apply(self, Array.slice(arguments));

    if (acc == null)
        acc = [];

    return function curried() {
        let args = acc.concat(Array.slice(arguments));

        // The curried result should preserve 'this'
        if (arguments.length == 0)
            return close(self || this, curried);

        if (args.length >= length)
            return fn.apply(self || this, args);

        return curry(fn, length, self || this, args);
    };
}

/**
 * Wraps a function so that when called it will always run synchronously
 * in the main thread. Return values are not preserved.
 *
 * @param {function}
 * @returns {function}
 */
function requiresMainThread(callback)
    function wrapper() {
        let mainThread = services.get("threadManager").mainThread;
        if (services.get("threadManager").isMainThread)
            callback.apply(this, arguments);
        else
            mainThread.dispatch(Runnable(this, callback, arguments), mainThread.DISPATCH_NORMAL);
    }

/**
 * Updates an object with the properties of another object. Getters
 * and setters are copied as expected. Moreover, any function
 * properties receive new 'supercall' and 'superapply' properties,
 * which will call the identically named function in target's
 * prototype.
 *
 *    let a = { foo: function (arg) "bar " + arg }
 *    let b = { __proto__: a }
 *    update(b, { foo: function foo() foo.supercall(this, "baz") });
 *
 *    a.foo("foo") -> "bar foo"
 *    b.foo()      -> "bar baz"
 *
 * @param {Object} target The object to update.
 * @param {Object} src The source object from which to update target.
 *    May be provided multiple times.
 * @returns {Object} Returns its updated first argument.
 */
function update(target) {
    for (let i = 1; i < arguments.length; i++) {
        let src = arguments[i];
        Object.getOwnPropertyNames(src || {}).forEach(function (k) {
            var get = src.__lookupGetter__(k),
                set = src.__lookupSetter__(k);
            if (!get && !set) {
                var v = src[k];
                target[k] = v;
                if (target.__proto__ && callable(v)) {
                    v.superapply = function (self, args) {
                        return target.__proto__[k].apply(self, args);
                    };
                    v.supercall = function (self) {
                        return v.superapply(self, Array.slice(arguments, 1));
                    };
                }
            }
            if (get)
                target.__defineGetter__(k, get);
            if (set)
                target.__defineSetter__(k, set);
        });
    }
    return target;
}

/**
 * Extends a subclass with a superclass. The subclass's
 * prototype is replaced with a new object, which inherits
 * from the super class's prototype, {@see update}d with the
 * members of 'overrides'.
 *
 * @param {function} subclass
 * @param {function} superclass
 * @param {Object} overrides @optional
 */
function extend(subclass, superclass, overrides) {
    subclass.prototype = { __proto__: superclass.prototype };
    update(subclass.prototype, overrides);

    subclass.superclass = superclass.prototype;
    subclass.prototype.constructor = subclass;
    subclass.prototype.__class__ = subclass;

    if (superclass.prototype.constructor === Object.prototype.constructor)
        superclass.prototype.constructor = superclass;
}

/**
 * @constructor Class
 *
 * Constructs a new Class. Arguments marked as optional must be
 * either entirely elided, or they must have the exact type
 * specified.
 *
 * @param {string} name The class's as it will appear when toString
 *     is called, as well as in stack traces.
 *     @optional
 * @param {function} base The base class for this module. May be any
 *     callable object.
 *     @optional
 *     @default Class
 * @param {Object} prototype The prototype for instances of this
 *     object. The object itself is copied and not used as a prototype
 *     directly.
 * @param {Object} classProperties The class properties for the new
 *     module constructor. More than one may be provided.
 *     @optional
 *
 * @returns {function} The constructor for the resulting class.
 */
function Class() {
    function constructor() {
        let self = {
            __proto__: Constructor.prototype,
            constructor: Constructor,
            get closure() {
                delete this.closure;
                function closure(fn) function () fn.apply(self, arguments);
                for (let k in this)
                    if (!this.__lookupGetter__(k) && callable(this[k]))
                        closure[k] = closure(self[k]);
                return this.closure = closure;
            }
        };
        var res = self.init.apply(self, arguments);
        return res !== undefined ? res : self;
    }

    var args = Array.slice(arguments);
    if (isstring(args[0]))
        var name = args.shift();
    var superclass = Class;
    if (callable(args[0]))
        superclass = args.shift();

    var Constructor = eval("(function " + (name || superclass.name).replace(/\W/g, "_") +
            String.substr(constructor, 20) + ")");
    Constructor.__proto__ = superclass;
    Constructor.name = name || superclass.name;

    if (!("init" in superclass.prototype)) {
        var superc = superclass;
        superclass = function Shim() {};
        extend(superclass, superc, {
            init: superc
        });
    }

    extend(Constructor, superclass, args[0]);
    update(Constructor, args[1]);
    args = args.slice(2);
    Array.forEach(args, function (obj) {
        if (callable(obj))
            obj = obj.prototype;
        update(Constructor.prototype, obj);
    });
    return Constructor;
}
if (Object.defineProperty)
    Class.replaceProperty = function (obj, prop, value) {
        Object.defineProperty(obj, prop, { configurable: true, enumerable: true, value: value, writable: true });
        return value;
    };
else
    Class.replaceProperty = function (obj, prop, value) {
        obj.__defineGetter__(prop, function () value);
        obj.__defineSetter__(prop, function (val) { value = val; });
        return value;
    };
Class.toString = function () "[class " + this.name + "]";
Class.prototype = {
    /**
     * Initializes new instances of this class. Called automatically
     * when new instances are created.
     */
    init: function () {},

    toString: function () "[instance " + this.constructor.name + "]",

    /**
     * Exactly like {@see nsIDOMWindow#setTimeout}, except that it
     * preserves the value of 'this' on invocation of 'callback'.
     *
     * @param {function} callback The function to call after 'timeout'
     * @param {number} timeout The timeout, in seconds, to wait
     *     before calling 'callback'.
     * @returns {integer} The ID of this timeout, to be passed to
     *     {@see nsIDOMWindow#clearTimeout}.
     */
    setTimeout: function (callback, timeout) {
        const self = this;
        let notify = { notify: function notify(timer) { callback.call(self) } };
        let timer = services.create("timer");
        timer.initWithCallback(notify, timeout, timer.TYPE_ONE_SHOT);
        return timer;
    }
};

/**
 * Constructs a mew Module class and instantiates an instance into the current
 * module global object.
 *
 * @param {string} name The name of the instance.
 * @param {Object} prototype The instance prototype.
 * @param {Object} classProperties Properties to be applied to the class constructor.
 * @return {Class}
 */
function Module(name, prototype, classProperties, init) {
    const module = Class(name, prototype, classProperties);
    let instance = module();
    module.name = name.toLowerCase();
    instance.INIT = init || {};
    currentModule[module.name] = instance;
    defmodule.modules.push(instance);
    return module;
}

/**
 * @class Struct
 *
 * Creates a new Struct constructor, used for creating objects with
 * a fixed set of named members. Each argument should be the name of
 * a member in the resulting objects. These names will correspond to
 * the arguments passed to the resultant constructor. Instances of
 * the new struct may be treated vary much like arrays, and provide
 * many of the same methods.
 *
 *     const Point = Struct("x", "y", "z");
 *     let p1 = Point(x, y, z);
 *
 * @returns {function} The constructor for the new Struct.
 */
function Struct() {
    let args = Array.slice(arguments);
    const Struct = Class("Struct", Struct_Base, {
        length: args.length,
        members: args
    });
    args.forEach(function (name, i) {
        Struct.prototype.__defineGetter__(name, function () this[i]);
        Struct.prototype.__defineSetter__(name, function (val) { this[i] = val; });
    });
    return Struct;
}
let Struct_Base = Class("StructBase", Array, {
    init: function () {
        for (let i = 0; i < arguments.length; i++)
            if (arguments[i] != undefined)
                this[i] = arguments[i];
    },

    clone: function clone() this.constructor.apply(null, this.slice()),

    // Iterator over our named members
    __iterator__: function () {
        let self = this;
        return ([k, self[k]] for (k in values(self.members)))
    }
}, {
    fromArray: function (ary) {
        ary.__proto__ = this.prototype;
        return ary;
    },

    /**
     * Sets a lazily constructed default value for a member of
     * the struct. The value is constructed once, the first time
     * it is accessed and memoized thereafter.
     *
     * @param {string} key The name of the member for which to
     *     provide the default value.
     * @param {function} val The function which is to generate
     *     the default value.
     */
    defaultValue: function (key, val) {
        let i = this.prototype.members.indexOf(key);
        this.prototype.__defineGetter__(i, function () (this[i] = val.call(this), this[i])); // Kludge for FF 3.0
        this.prototype.__defineSetter__(i, function (value)
            Class.replaceProperty(this, i, value));
    }
});

const Timer = Class("Timer", {
    init: function (minInterval, maxInterval, callback) {
        this._timer = services.create("timer");
        this.callback = callback;
        this.minInterval = minInterval;
        this.maxInterval = maxInterval;
        this.doneAt = 0;
        this.latest = 0;
    },

    notify: function (timer) {
        this._timer.cancel();
        this.latest = 0;
        // minInterval is the time between the completion of the command and the next firing
        this.doneAt = Date.now() + this.minInterval;

        try {
            this.callback(this.arg);
        }
        finally {
            this.doneAt = Date.now() + this.minInterval;
        }
    },

    tell: function (arg) {
        if (arguments.length > 0)
            this.arg = arg;

        let now = Date.now();
        if (this.doneAt == -1)
            this._timer.cancel();

        let timeout = this.minInterval;
        if (now > this.doneAt && this.doneAt > -1)
            timeout = 0;
        else if (this.latest)
            timeout = Math.min(timeout, this.latest - now);
        else
            this.latest = now + this.maxInterval;

        this._timer.initWithCallback(this, Math.max(timeout, 0), this._timer.TYPE_ONE_SHOT);
        this.doneAt = -1;
    },

    reset: function () {
        this._timer.cancel();
        this.doneAt = 0;
    },

    flush: function () {
        if (this.doneAt == -1)
            this.notify();
    }
});

/**
 * Array utility methods.
 */
const array = Class("util.Array", Array, {
    init: function (ary) {
        if (isgenerator(ary))
            ary = [k for (k in ary)];
        else if (ary.length)
            ary = Array.slice(ary);

        return {
            __proto__: ary,
            __iterator__: function () this.iteritems(),
            __noSuchMethod__: function (meth, args) {
                var res = array[meth].apply(null, [this.__proto__].concat(args));

                if (array.isinstance(res))
                    return array(res);
                return res;
            },
            toString: function () this.__proto__.toString(),
            concat: function () this.__proto__.concat.apply(this.__proto__, arguments),
            map: function () this.__noSuchMethod__("map", Array.slice(arguments))
        };
    }
}, {
    isinstance: function isinstance(obj) {
        return Object.prototype.toString.call(obj) == "[object Array]";
    },

    /**
     * Converts an array to an object. As in lisp, an assoc is an
     * array of key-value pairs, which maps directly to an object,
     * as such:
     *    [["a", "b"], ["c", "d"]] -> { a: "b", c: "d" }
     *
     * @param {Array[]} assoc
     * @... {string} 0 - Key
     * @...          1 - Value
     */
    toObject: function toObject(assoc) {
        let obj = {};
        assoc.forEach(function ([k, v]) { obj[k] = v; });
        return obj;
    },

    /**
     * Compacts an array, removing all elements that are null or undefined:
     *    ["foo", null, "bar", undefined] -> ["foo", "bar"]
     *
     * @param {Array} ary
     * @returns {Array}
     */
    compact: function compact(ary) ary.filter(function (item) item != null),

    /**
     * Flattens an array, such that all elements of the array are
     * joined into a single array:
     *    [["foo", ["bar"]], ["baz"], "quux"] -> ["foo", ["bar"], "baz", "quux"]
     *
     * @param {Array} ary
     * @returns {Array}
     */
    flatten: function flatten(ary) ary.length ? Array.concat.apply([], ary) : [],

    /**
     * Returns an Iterator for an array's values.
     *
     * @param {Array} ary
     * @returns {Iterator(Object)}
     */
    itervalues: function itervalues(ary) {
        let length = ary.length;
        for (let i = 0; i < length; i++)
            yield ary[i];
    },

    /**
     * Returns an Iterator for an array's indices and values.
     *
     * @param {Array} ary
     * @returns {Iterator([{number}, {Object}])}
     */
    iteritems: function iteritems(ary) {
        let length = ary.length;
        for (let i = 0; i < length; i++)
            yield [i, ary[i]];
    },

    /**
     * Filters out all duplicates from an array. If
     * <b>unsorted</b> is false, the array is sorted before
     * duplicates are removed.
     *
     * @param {Array} ary
     * @param {boolean} unsorted
     * @returns {Array}
     */
    uniq: function uniq(ary, unsorted) {
        let ret = [];
        if (unsorted) {
            for (let [, item] in Iterator(ary))
                if (ret.indexOf(item) == -1)
                    ret.push(item);
        }
        else {
            for (let [, item] in Iterator(ary.sort())) {
                if (item != last || !ret.length)
                    ret.push(item);
                var last = item;
            }
        }
        return ret;
    },

    /**
     * Zips the contents of two arrays. The resulting array is the length of
     * ary1, with any shortcomings of ary2 replaced with null strings.
     *
     * @param {Array} ary1
     * @param {Array} ary2
     * @returns {Array}
     */
    zip: function zip(ary1, ary2) {
        let res = []
        for(let [i, item] in Iterator(ary1))
            res.push([item, i in ary2 ? ary2[i] : ""]);
        return res;
    }
});

endmodule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n");}

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
