// Copyright (c) 2009-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
try {
    var ctypes;
    Components.utils.import("resource://gre/modules/ctypes.jsm");
}
catch (e) {}

let objproto = Object.prototype;
let hasOwnProperty = objproto.hasOwnProperty;

if (typeof XPCSafeJSObjectWrapper === "undefined")
    this.XPCSafeJSObjectWrapper = XPCNativeWrapper;

if (!XPCNativeWrapper.unwrap)
    XPCNativeWrapper.unwrap = function unwrap(obj) {
        if (hasOwnProperty.call(obj, "wrappedJSObject"))
            return obj.wrappedJSObject;
        return obj;
    };
if (!Object.create)
    Object.create = function create(proto, props) {
        let obj = { __proto__: proto };
        for (let k in properties(props || {}))
            Object.defineProperty(obj, k, props[k]);
        return obj;
    };
if (!Object.defineProperty)
    Object.defineProperty = function defineProperty(obj, prop, desc) {
        let value = desc.value;
        if ("value" in desc)
            if (desc.writable && !objproto.__lookupGetter__.call(obj, prop)
                              && !objproto.__lookupSetter__.call(obj, prop))
                try {
                    obj[prop] = value;
                }
                catch (e if e instanceof TypeError) {}
            else {
                objproto.__defineGetter__.call(obj, prop, function () value);
                if (desc.writable)
                    objproto.__defineSetter__.call(obj, prop, function (val) { value = val; });
            }

        if ("get" in desc)
            objproto.__defineGetter__.call(obj, prop, desc.get);
        if ("set" in desc)
            objproto.__defineSetter__.call(obj, prop, desc.set);
    };
if (!Object.defineProperties)
    Object.defineProperties = function defineProperties(obj, props) {
        for (let [k, v] in Iterator(props))
            Object.defineProperty(obj, k, v);
    }
if (!Object.getOwnPropertyDescriptor)
    Object.getOwnPropertyDescriptor = function getOwnPropertyDescriptor(obj, prop) {
        if (!hasOwnProperty.call(obj, prop))
            return undefined;
        let desc = {
            configurable: true,
            enumerable: objproto.propertyIsEnumerable.call(obj, prop)
        };
        var get = obj.__lookupGetter__(prop),
            set = obj.__lookupSetter__(prop);
        if (!get && !set) {
            desc.value = obj[prop];
            desc.writable = true;
        }
        if (get)
            desc.get = get;
        if (set)
            desc.set = set;
        return desc;
    };
if (!Object.getOwnPropertyNames)
    Object.getOwnPropertyNames = function getOwnPropertyNames(obj, _debugger) {
        // This is an ugly and unfortunately necessary hack.
        if (hasOwnProperty.call(obj, "__iterator__")) {
            var oldIter = obj.__iterator__;
            delete obj.__iterator__;
        }
        let res = [k for (k in obj) if (hasOwnProperty.call(obj, k))];
        if (oldIter !== undefined) {
            obj.__iterator__ = oldIter;
            res.push("__iterator__");
        }
        return res;
    };
if (!Object.getPrototypeOf)
    Object.getPrototypeOf = function getPrototypeOf(obj) obj.__proto__;
if (!Object.keys)
    Object.keys = function keys(obj)
        Object.getOwnPropertyNames(obj).filter(function (k) objproto.propertyIsEnumerable.call(obj, k));

let use = {};
let loaded = {};
let currentModule;
let global = this;
function defineModule(name, params, module) {
    if (!module)
        module = Cu.getGlobalForObject ? Cu.getGlobalForObject(params) : params.__parent__;

    module.NAME = name;
    module.EXPORTED_SYMBOLS = params.exports || [];
    defineModule.loadLog.push("defineModule " + name);
    for (let [, mod] in Iterator(params.require || []))
        require(module, mod);

    for (let [, mod] in Iterator(params.use || []))
        if (loaded.hasOwnProperty(mod))
            require(module, mod, "use");
        else {
            use[mod] = use[mod] || [];
            use[mod].push(module);
        }
    currentModule = module;
}

defineModule.loadLog = [];
Object.defineProperty(defineModule.loadLog, "push", {
    value: function (val) {
        if (true)
            defineModule.dump(val + "\n");
        this[this.length] = Date.now() + " " + val;
    }
});
defineModule.dump = function dump_() {
    let msg = Array.map(arguments, function (msg) {
        if (loaded.util && typeof msg == "object")
            msg = util.objectToString(msg);
        return msg;
    }).join(", ");
    let name = loaded.config ? config.name : "dactyl";
    dump(String.replace(msg, /\n?$/, "\n")
               .replace(/^./gm, name + ": $&"));
}
defineModule.modules = [];
defineModule.times = { all: 0 };
defineModule.time = function time(major, minor, func, self) {
    let time = Date.now();
    try {
        var res = func.apply(self, Array.slice(arguments, 4));
    }
    catch (e) {
        loaded.util && util.reportError(e);
    }
    let delta = Date.now() - time;
    defineModule.times.all += delta;
    defineModule.times[major] = (defineModule.times[major] || 0) + delta;
    if (minor) {
        defineModule.times[":" + minor] = (defineModule.times[":" + minor] || 0) + delta;
        defineModule.times[major + ":" + minor] = (defineModule.times[major + ":" + minor] || 0) + delta;
    }
    return res;
}

function endModule() {
    defineModule.loadLog.push("endModule " + currentModule.NAME);

    for (let [, mod] in Iterator(use[currentModule.NAME] || []))
        require(mod, currentModule.NAME, "use");

    loaded[currentModule.NAME] = 1;
}

function require(obj, name, from) {
    try {
        if (arguments.length === 1)
            [obj, name] = [{}, obj];

        defineModule.loadLog.push((from || "require") + ": loading " + name + " into " + obj.NAME);
        JSMLoader.load(name + ".jsm", obj);
        return obj;
    }
    catch (e) {
        defineModule.dump("loading " + String.quote(name + ".jsm") + "\n");
        if (loaded.util)
            util.reportError(e);
        else
            defineModule.dump("    " + (e.filename || e.fileName) + ":" + e.lineNumber + ": " + e +"\n");
    }
}

defineModule("base", {
    // sed -n 's/^(const|function) ([a-zA-Z0-9_]+).*/	"\2",/p' base.jsm | sort | fmt
    exports: [
        "ErrorBase", "Cc", "Ci", "Class", "Cr", "Cu", "Module", "JSMLoader", "Object", "Runnable",
        "Struct", "StructBase", "Timer", "UTF8", "XPCOM", "XPCOMUtils", "XPCSafeJSObjectWrapper",
        "array", "call", "callable", "ctypes", "curry", "debuggerProperties", "defineModule",
        "deprecated", "endModule", "forEach", "isArray", "isGenerator", "isinstance", "isObject",
        "isString", "isSubclass", "iter", "iterAll", "keys", "memoize", "octal", "properties",
        "require", "set", "update", "values", "withCallerGlobal"
    ],
    use: ["config", "services", "util"]
}, this);

function Runnable(self, func, args) {
    return {
        __proto__: Runnable.prototype,
        run: function () { func.apply(self, args || []); }
    };
}
Runnable.prototype.QueryInterface = XPCOMUtils.generateQI([Ci.nsIRunnable]);

/**
 * Returns a list of all of the top-level properties of an object, by
 * way of the debugger.
 *
 * @param {object} obj
 * @returns [jsdIProperty]
 */
function debuggerProperties(obj) {
    if (loaded.services && services.debugger.isOn) {
        let ret = {};
        services.debugger.wrapValue(obj).getProperties(ret, {});
        return ret.value;
    }
}

/**
 * Iterates over the names of all of the top-level properties of an
 * object or, if prototypes is given, all of the properties in the
 * prototype chain below the top. Uses the debugger if possible.
 *
 * @param {object} obj The object to inspect.
 * @param {boolean} properties Whether to inspect the prototype chain
 * @default false
 * @returns {Generator}
 */
function prototype(obj)
    /* Temporary hack: */ typeof obj === "xml" || obj.__proto__ !== obj.__proto__ ? null :
    obj.__proto__ || Object.getPrototypeOf(obj) ||
    XPCNativeWrapper.unwrap(obj).__proto__ ||
    Object.getPrototypeOf(XPCNativeWrapper.unwrap(obj));

function properties(obj, prototypes, debugger_) {
    let orig = obj;
    let seen = { dactylPropertyNames: true };

    try {
        if ("dactylPropertyNames" in obj && !prototypes)
            for (let key in values(obj.dactylPropertyNames))
                if (key in obj && !set.add(seen, key))
                    yield key;
    }
    catch (e) {}

    for (; obj; obj = prototypes && prototype(obj)) {
        try {
            if (sandbox.Object.getOwnPropertyNames || !debugger_ || !services.debugger.isOn)
                var iter = values(Object.getOwnPropertyNames(obj));
        }
        catch (e) {}
        if (!iter)
            iter = (prop.name.stringValue for (prop in values(debuggerProperties(obj))));

        for (let key in iter)
            if (!prototypes || !set.add(seen, key) && obj != orig)
                yield key;
    }
}

function deprecated(alternative, fn) {
    if (isObject(fn))
        return Class.Property(iter(fn).map(function ([k, v]) [k, callable(v) ? deprecated(alternative, v) : v])
                                      .toObject());

    let name, func = callable(fn) ? fn : function () this[fn].apply(this, arguments);

    function deprecatedMethod() {
        let frame = Components.stack.caller;
        let obj = this.className             ? this.className + "#" :
                  this.constructor.className ? this.constructor.className + "#" :
                      "";
        let filename = (frame.filename || "unknown").replace(/.* -> /, "");
        if (!set.add(deprecatedMethod.seen, filename))
            util.dactyl(fn).warn(
                util.urlPath(filename) + ":" + frame.lineNumber + ": " +
                obj + (fn.name || name) + " is deprecated: Please use " + alternative + " instead");
        return func.apply(this, arguments);
    }
    memoize(deprecatedMethod, "seen", function () set([
        "resource://dactyl" + JSMLoader.suffix + "/javascript.jsm",
        "resource://dactyl" + JSMLoader.suffix + "/util.jsm"
    ]));

    return callable(fn) ? deprecatedMethod : Class.Property({
        get: function () deprecatedMethod,
        init: function (prop) { name = prop; }
    });
}

/**
 * Iterates over all of the top-level, iterable property names of an
 * object.
 *
 * @param {object} obj The object to inspect.
 * @returns {Generator}
 */
function keys(obj) iter(function keys() {
    for (var k in obj)
        if (hasOwnProperty.call(obj, k))
            yield k;
}());
/**
 * Iterates over all of the top-level, iterable property values of an
 * object.
 *
 * @param {object} obj The object to inspect.
 * @returns {Generator}
 */
function values(obj) iter(function values() {
    if (isinstance(obj, ["Generator", "Iterator"]))
        for (let k in obj)
            yield k;
    else
        for (var k in obj)
            if (hasOwnProperty.call(obj, k))
                yield obj[k];
}());

var forEach = deprecated("iter.forEach", function forEach() iter.forEach.apply(iter, arguments));
var iterAll = deprecated("iter", function iterAll() iter.apply(null, arguments));

/**
 * Utility for managing sets of strings. Given an array, returns an
 * object with one key for each value thereof.
 *
 * @param {[string]} ary @optional
 * @returns {object}
 */
function set(ary) {
    let obj = {};
    if (ary)
        for (let val in values(ary))
            obj[val] = true;
    return obj;
}
/**
 * Adds an element to a set and returns true if the element was
 * previously contained.
 *
 * @param {object} set The set.
 * @param {string} key The key to add.
 * @returns boolean
 */
set.add = function (set, key) {
    let res = this.has(set, key);
    set[key] = true;
    return res;
}
/**
 * Returns true if the given set contains the given key.
 *
 * @param {object} set The set.
 * @param {string} key The key to check.
 * @returns {boolean}
 */
set.has = function (set, key) hasOwnProperty.call(set, key);
/**
 * Returns a new set containing the members of the first argument which
 * do not exist in any of the other given arguments.
 *
 * @param {object} set The set.
 * @returns {object}
 */
set.subtract = function (set) {
    set = update({}, set);
    for (let i = 1; i < arguments.length; i++)
        for (let k in keys(arguments[i]))
            delete set[k];
    return set;
}
/**
 * Removes an element from a set and returns true if the element was
 * previously contained.
 *
 * @param {object} set The set.
 * @param {string} key The key to remove.
 * @returns boolean
 */
set.remove = function (set, key) {
    let res = set.has(set, key);
    delete set[key];
    return res;
}

/**
 * Returns true if both arguments are functions and
 * (targ() instanceof src) would also return true.
 *
 * @param {function} targ
 * @param {function} src
 * @returns {boolean}
 */
function isSubclass(targ, src) {
    return src === targ ||
        targ && typeof targ === "function" && targ.prototype instanceof src;
}

/**
 * Returns true if *object* is an instance of *interfaces*. If *interfaces* is
 * an array, returns true if *object* is an instance of any element of
 * *interfaces*. If *interfaces* is the object form of a primitive type,
 * returns true if *object* is a non-boxed version of the type, i.e., if
 * (typeof object == "string"), isinstance(object, String) is true. Finally, if
 * *interfaces* is a string, returns true if ({}.toString.call(object) ==
 * "[object <interfaces>]").
 *
 * @param {object} object The object to check.
 * @param {constructor|[constructor|string]} interfaces The types to check *object* against.
 * @returns {boolean}
 */
var isinstance_types = {
    boolean: Boolean,
    string: String,
    function: Function,
    number: Number
};
function isinstance(object, interfaces) {
    if (object == null)
        return false;

    interfaces = Array.concat(interfaces);
    for (var i = 0; i < interfaces.length; i++) {
        if (typeof interfaces[i] === "string") {
            if (objproto.toString.call(object) === "[object " + interfaces[i] + "]")
                return true;
        }
        else if (typeof object === "object" && "isinstance" in object && object.isinstance !== isinstance) {
            if (object.isinstance(interfaces[i]))
                return true;
        }
        else {
            if (object instanceof interfaces[i])
                return true;
            var type = isinstance_types[typeof object];
            if (type && isSubclass(interfaces[i], type))
                return true;
        }
    }
    return false;
}

/**
 * Returns true if obj is a non-null object.
 */
function isObject(obj) typeof obj === "object" && obj != null || obj instanceof Ci.nsISupports;

/**
 * Returns true if and only if its sole argument is an
 * instance of the builtin Array type. The array may come from
 * any window, frame, namespace, or execution context, which
 * is not the case when using (obj instanceof Array).
 */
var isArray =
    Array.isArray
        // This is bloody stupid.
        ? function isArray(val) Array.isArray(val) || val && val.constructor && val.constructor.name === "Array"
        : function isArray(val) objproto.toString.call(val) == "[object Array]";

/**
 * Returns true if and only if its sole argument is an
 * instance of the builtin Generator type. This includes
 * functions containing the 'yield' statement and generator
 * statements such as (x for (x in obj)).
 */
function isGenerator(val) objproto.toString.call(val) == "[object Generator]";

/**
 * Returns true if and only if its sole argument is a String,
 * as defined by the builtin type. May be constructed via
 * String(foo) or new String(foo) from any window, frame,
 * namespace, or execution context, which is not the case when
 * using (obj instanceof String) or (typeof obj == "string").
 */
function isString(val) objproto.toString.call(val) == "[object String]";

/**
 * Returns true if and only if its sole argument may be called
 * as a function. This includes classes and function objects.
 */
function callable(val) typeof val === "function";

function call(fn) {
    fn.apply(arguments[1], Array.slice(arguments, 2));
    return fn;
}

/**
 * Memoizes an object property value.
 *
 * @param {object} obj The object to add the property to.
 * @param {string} key The property name.
 * @param {function} getter The function which will return the initial
 * value of the property.
 */
function memoize(obj, key, getter) {
    if (arguments.length == 1) {
        obj = update({}, obj);
        for (let prop in Object.getOwnPropertyNames(obj)) {
            let get = objproto.__lookupGetter__.call(obj, prop);
            if (get)
                memoize(obj, prop, get);
        }
        return obj;
    }
    obj.__defineGetter__(key, function g_replaceProperty() (
        Class.replaceProperty(this.instance || this, key, null),
        Class.replaceProperty(this.instance || this, key, getter.call(this, key))));
    obj.__defineSetter__(key, function s_replaceProperty(val)
        Class.replaceProperty(this.instance || this, key, val));
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
 *     curry(foo)(7)(8)(9) -> "7 8 9";
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

let sandbox = Cu.Sandbox(this);
sandbox.__proto__ = this;
/**
 * Wraps a function so that when called, the global object of the caller
 * is prepended to its arguments.
 */
// Hack to get around lack of access to caller in strict mode.
var withCallerGlobal = Cu.evalInSandbox(<![CDATA[
    (function withCallerGlobal(fn)
        function withCallerGlobal_wrapped()
            fn.apply(this,
                     [Class.objectGlobal(withCallerGlobal_wrapped.caller)]
                        .concat(Array.slice(arguments))))
]]>, Cu.Sandbox(this), "1.8");

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
            let desc = Object.getOwnPropertyDescriptor(src, k);
            if (desc.value instanceof Class.Property)
                desc = desc.value.init(k) || desc.value;
            if (typeof desc.value == "function" && Object.getPrototypeOf(target)) {
                let func = desc.value;
                desc.value.__defineGetter__("super", function () Object.getPrototypeOf(target)[k]);
                desc.value.superapply = function superapply(self, args)
                    let (meth = Object.getPrototypeOf(target)[k])
                        meth && meth.apply(self, args);
                desc.value.supercall = function supercall(self)
                    func.superapply(self, Array.slice(arguments, 1));
            }
            Object.defineProperty(target, k, desc);
        });
    }
    return target;
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

    var args = Array.slice(arguments);
    if (isString(args[0]))
        var name = args.shift();
    var superclass = Class;
    if (callable(args[0]))
        superclass = args.shift();

    var Constructor = eval(String.replace(<![CDATA[
        (function constructor() {
            let self = Object.create(Constructor.prototype, {
                constructor: { value: Constructor },
            });
            self.instance = self;
            var res = self.init.apply(self, arguments);
            return res !== undefined ? res : self;
        })]]>,
        "constructor", (name || superclass.className).replace(/\W/g, "_")));
    Constructor.className = name || superclass.className || superclass.name;

    if ("init" in superclass.prototype)
        Constructor.__proto__ = superclass;
    else {
        let superc = superclass;
        superclass = function Shim() {};
        Class.extend(superclass, superc, {
            init: superc
        });
        superclass.__proto__ = superc;
    }

    Class.extend(Constructor, superclass, args[0]);
    update(Constructor, args[1]);
    Constructor.__proto__ = superclass;
    args = args.slice(2);
    Array.forEach(args, function (obj) {
        if (callable(obj))
            obj = obj.prototype;
        update(Constructor.prototype, obj);
    });
    return Constructor;
}

if (Cu.getGlobalForObject)
    Class.objectGlobal = function (caller) {
        try {
            return Cu.getGlobalForObject(caller);
        }
        catch (e) {
            return null;
        }
    };
else
    Class.objectGlobal = function (caller) {
        while (caller.__parent__)
            caller = caller.__parent__;
        return caller;
    };

/**
 * @class Class.Property
 * A class which, when assigned to a property in a Class's prototype
 * or class property object, defines that property's descriptor
 * rather than its value. If the desc object has an init property, it
 * will be called with the property's name before the descriptor is
 * assigned.
 *
 * @param {Object} desc The property descriptor.
 */
Class.Property = function Property(desc) update(
    Object.create(Property.prototype), desc || { configurable: true, writable: true });
Class.Property.prototype.init = function () {};
/**
 * Extends a subclass with a superclass. The subclass's
 * prototype is replaced with a new object, which inherits
 * from the superclass's prototype, {@see update}d with the
 * members of *overrides*.
 *
 * @param {function} subclass
 * @param {function} superclass
 * @param {Object} overrides @optional
 */
Class.extend = function extend(subclass, superclass, overrides) {
    subclass.superclass = superclass;

    subclass.prototype = Object.create(superclass.prototype);
    update(subclass.prototype, overrides);
    subclass.prototype.constructor = subclass;
    subclass.prototype._class_ = subclass;

    if (superclass.prototype.constructor === objproto.constructor)
        superclass.prototype.constructor = superclass;
}

/**
 * Memoizes the value of a class property to the value returned by
 * the passed function the first time the property is accessed.
 *
 * @param {function(string)} getter The function which returns the
 *      property's value.
 * @return {Class.Property}
 */
Class.memoize = function memoize(getter)
    Class.Property({
        configurable: true,
        enumerable: true,
        init: function (key) {
            this.get = function replace() let (obj = this.instance || this) (
                Class.replaceProperty(obj, key, null),
                Class.replaceProperty(obj, key, getter.call(this, key)))
        }
    });

Class.replaceProperty = function replaceProperty(obj, prop, value) {
    Object.defineProperty(obj, prop, { configurable: true, enumerable: true, value: value, writable: true });
    return value;
};
Class.toString = function toString() "[class " + this.className + "]";
Class.prototype = {
    /**
     * Initializes new instances of this class. Called automatically
     * when new instances are created.
     */
    init: function () {},

    withSavedValues: function (names, callback, self) {
        let vals = names.map(function (name) this[name], this);
        try {
            return callback.call(self || this);
        }
        finally {
            names.forEach(function (name, i) this[name] = vals[i], this);
        }
    },

    toString: function () {
        if (this.toStringParams)
            var params = "(" + this.toStringParams.map(function (m) isArray(m)  ? "[" + m + "]" :
                                                                    isString(m) ? m.quote() : String(m))
                                   .join(", ") + ")";
        return "[instance " + this.constructor.className + (params || "") + "]";
    },

    /**
     * Executes *callback* after *timeout* milliseconds. The value of
     * 'this' is preserved in the invocation of *callback*.
     *
     * @param {function} callback The function to call after *timeout*
     * @param {number} timeout The time, in milliseconds, to wait
     *     before calling *callback*.
     * @returns {nsITimer} The timer which backs this timeout.
     */
    timeout: function (callback, timeout) {
        const self = this;
        function notify(timer) {
            if (util.rehashing && !isinstance(Cu.getGlobalForObject(callback), ["BackstagePass"]))
                return;
            util.trapErrors(callback, self);
        }
        return services.Timer(notify, timeout || 0, services.Timer.TYPE_ONE_SHOT);
    }
};
memoize(Class.prototype, "closure", function () {
    const self = this;
    function closure(fn) function () {
        try {
            return fn.apply(self, arguments);
        }
        catch (e) {
            util.reportError(e);
        }
    }
    iter(properties(this), properties(this, true)).forEach(function (k) {
        if (!this.__lookupGetter__(k) && callable(this[k]))
            closure[k] = closure(this[k]);
        else if (!(k in closure))
            Object.defineProperty(closure, k, {
                get: function get_proxy() self[k],
                set: function set_proxy(val) self[k] = val,
            });
    }, this);
    return closure;
});

/**
 * A base class generator for classes which implement XPCOM interfaces.
 *
 * @param {nsIIID|[nsIJSIID]} interfaces The interfaces which the class
 *      implements.
 * @param {Class} superClass A super class. @optional
 * @returns {Class}
 */
function XPCOM(interfaces, superClass) {
    interfaces = Array.concat(interfaces);

    let shim = interfaces.reduce(function (shim, iface) shim.QueryInterface(iface),
                                 Cc["@dactyl.googlecode.com/base/xpc-interface-shim"].createInstance());

    let res = Class("XPCOM(" + interfaces + ")", superClass || Class, update(
        iter.toObject([k, v === undefined || callable(v) ? function stub() null : v]
                      for ([k, v] in Iterator(shim))),
        { QueryInterface: XPCOMUtils.generateQI(interfaces) }));
    shim = interfaces = null;
    return res;
}

/**
 * An abstract base class for classes that wish to inherit from Error.
 */
var ErrorBase = Class("ErrorBase", Error, {
    level: 2,
    init: function (message, level) {
        level = level || 0;
        update(this, Error(message))
        this.message = message;

        let frame = Components.stack;
        for (let i = 0; i < this.level + level; i++) {
            frame = frame.caller;
            this.stack = this.stack.replace(/^.*\n/, "");
        }
        this.fileName = frame.filename;
        this.lineNumber = frame.lineNumber;
    }
});

/**
 * Constructs a new Module class and instantiates an instance into the current
 * module global object.
 *
 * @param {string} name The name of the instance.
 * @param {Object} prototype The instance prototype.
 * @param {Object} classProperties Properties to be applied to the class constructor.
 * @returns {Class}
 */
function Module(name, prototype) {
    let init = callable(prototype) ? 4 : 3;
    const module = Class.apply(Class, Array.slice(arguments, 0, init));
    let instance = module();
    module.className = name.toLowerCase();

    instance.INIT = update(Object.create(Module.INIT),
                           arguments[init] || {});

    currentModule[module.className] = instance;
    defineModule.modules.push(instance);
    return module;
}
Module.INIT = {
    init: function (dactyl, modules, window) {
        let args = arguments;

        let locals = [];
        for (let local = this.Local; local; local = local.super)
            locals.push(local);

        if (locals.length) {
            let module = this, objs = {};
            for (let i in locals)
                module = objs[i] = Object.create(module);

            modules[this.constructor.className] = module;
            locals.reverse().forEach(function (fn, i) update(objs[i], fn.apply(module, args)))
            module.instance = module;
            module.init();
        }
    }
}

/**
 * @class Struct
 *
 * Creates a new Struct constructor, used for creating objects with
 * a fixed set of named members. Each argument should be the name of
 * a member in the resulting objects. These names will correspond to
 * the arguments passed to the resultant constructor. Instances of
 * the new struct may be treated very much like arrays, and provide
 * many of the same methods.
 *
 *     const Point = Struct("x", "y", "z");
 *     let p1 = Point(x, y, z);
 *
 * @returns {function} The constructor for the new Struct.
 */
function Struct() {
    let args = Array.slice(arguments);
    const Struct = Class("Struct", StructBase, {
        length: args.length,
        members: array.toObject(args.map(function (v, k) [v, k]))
    });
    args.forEach(function (name, i) {
        Struct.prototype.__defineGetter__(name, function () this[i]);
        Struct.prototype.__defineSetter__(name, function (val) { this[i] = val; });
    });
    return Struct;
}
let StructBase = Class("StructBase", Array, {
    init: function () {
        for (let i = 0; i < arguments.length; i++)
            if (arguments[i] != undefined)
                this[i] = arguments[i];
    },

    clone: function clone() this.constructor.apply(null, this.slice()),

    closure: Class.Property(Object.getOwnPropertyDescriptor(Class.prototype, "closure")),

    get: function (key, val) this[this.members[key]],
    set: function (key, val) this[this.members[key]] = val,

    toString: function () Class.prototype.toString.apply(this, arguments),

    // Iterator over our named members
    __iterator__: function () {
        let self = this;
        return ([k, self[k]] for (k in keys(self.members)))
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
        let i = this.prototype.members[key];
        this.prototype.__defineGetter__(i, function () (this[i] = val.call(this)));
        this.prototype.__defineSetter__(i, function (value)
            Class.replaceProperty(this, i, value));
    }
});

var Timer = Class("Timer", {
    init: function (minInterval, maxInterval, callback, self) {
        this._timer = services.Timer();
        this.callback = callback;
        this.self = self || this;
        this.minInterval = minInterval;
        this.maxInterval = maxInterval;
        this.doneAt = 0;
        this.latest = 0;
    },

    notify: function (timer) {
        try {
            if (util.rehashing || typeof util === "undefined")
                return;

            this._timer.cancel();
            this.latest = 0;
            // minInterval is the time between the completion of the command and the next firing
            this.doneAt = Date.now() + this.minInterval;

            this.callback.call(this.self, this.arg);
        }
        catch (e) {
            if (typeof util === "undefined")
                dump("dactyl: " + e + "\n" + (e.stack || Error().stack));
            else
                util.reportError(e);
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

    flush: function (force) {
        if (this.doneAt == -1 || force)
            this.notify();
    }
});

/**
 * Idempotent function which returns the UTF-8 encoded value of an
 * improperly-decoded string.
 *
 * @param {string} str
 * @returns {string}
 */
function UTF8(str) {
    try {
        return decodeURIComponent(escape(str));
    }
    catch (e) {
        return str;
    }
}

function octal(decimal) parseInt(decimal, 8);

/**
 * Iterates over an arbitrary object. The following iterator types are
 * supported, and work as a user would expect:
 *
 *  • nsIDOMNodeIterator
 *  • mozIStorageStatement
 *
 * Additionally, the following array-like objects yield a tuple of the
 * form [index, element] for each contained element:
 *
 *  • nsIDOMHTMLCollection
 *  • nsIDOMNodeList
 *
 * and the following likewise yield one element of the form
 * [name, element] for each contained element:
 *
 *  • nsIDOMNamedNodeMap
 *
 * Duck typing is implemented for any other type. If the object
 * contains the "enumerator" property, iter is called on that. If the
 * property is a function, it is called first. If it contains the
 * property "getNext" along with either "hasMoreItems" or "hasMore", it
 * is iterated over appropriately.
 *
 * For all other cases, this function behaves exactly like the Iterator
 * function.
 *
 * @param {object} obj
 * @returns {Generator}
 */
function iter(obj) {
    let args = arguments;
    let res = Iterator(obj);

    if (args.length > 1)
        res = (function () {
            for (let i = 0; i < args.length; i++)
                for (let j in iter(args[i]))
                    yield j;
        })();
    else if (isinstance(obj, ["Iterator", "Generator"]))
        ;
    else if (ctypes && ctypes.CData && obj instanceof ctypes.CData) {
        while (obj.constructor instanceof ctypes.PointerType)
            obj = obj.contents;
        if (obj.constructor instanceof ctypes.ArrayType)
            res = array.iterItems(obj);
        else if (obj.constructor instanceof ctypes.StructType)
            res = (function () {
                for (let prop in values(obj.constructor.fields))
                    yield let ([name, type] = Iterator(prop).next()) [name, obj[name]];
            })();
        else
            return iter({});
    }
    else if (isinstance(obj, [Ci.nsIDOMHTMLCollection, Ci.nsIDOMNodeList]))
        res = array.iterItems(obj);
    else if (obj instanceof Ci.nsIDOMNamedNodeMap)
        res = (function () {
            for (let i = 0; i < obj.length; i++)
                yield [obj.name, obj];
        })();
    else if (obj instanceof Ci.mozIStorageStatement)
        res = (function (obj) {
            while (obj.executeStep())
                yield obj.row;
            obj.reset();
        })(obj);
    else if ("getNext" in obj) {
        if ("hasMoreElements" in obj)
            res = (function () {
                while (obj.hasMoreElements())
                    yield obj.getNext();
            })();
        else if ("hasMore" in obj)
            res = (function () {
                while (obj.hasMore())
                    yield obj.getNext();
            })();
    }
    else if ("enumerator" in obj) {
        if (callable(obj.enumerator))
            return iter(obj.enumerator());
        return iter(obj.enumerator);
    }
    res.__noSuchMethod__ = function __noSuchMethod__(meth, args) {
        if (meth in iter)
            var res = iter[meth].apply(iter, [this].concat(args));
        else
            res = let (ary = array(this))
                ary[meth] ? ary[meth].apply(ary, args) : ary.__noSuchMethod__(meth, args);
        if (isinstance(res, ["Iterator", "Generator"]))
            return iter(res);
        return res;
    };
    return res;
}
update(iter, {
    toArray: function toArray(iter) array(iter).array,

    // See array.prototype for API docs.
    toObject: function toObject(iter) {
        let obj = {};
        for (let [k, v] in iter)
            if (v instanceof Class.Property)
                Object.defineProperty(obj, k, v.init(k) || v);
            else
                obj[k] = v;
        return obj;
    },

    compact: function compact(iter) (item for (item in iter) if (item != null)),

    every: function every(iter, pred, self) {
        pred = pred || util.identity;
        for (let elem in iter)
            if (!pred.call(self, elem))
                return false;
        return true;
    },
    some: function every(iter, pred, self) {
        pred = pred || util.identity;
        for (let elem in iter)
            if (pred.call(self, elem))
                return true;
        return false;
    },

    filter: function filter(iter, pred, self) {
        for (let elem in iter)
            if (pred.call(self, elem))
                yield elem;
    },

    /**
     * Iterates over an iterable object and calls a callback for each
     * element.
     *
     * @param {object} iter The iterator.
     * @param {function} fn The callback.
     * @param {object} self The this object for *fn*.
     */
    forEach: function forEach(iter, func, self) {
        for (let val in iter)
            func.call(self, val);
    },

    /**
     * Returns the array that results from applying *func* to each property of
     * *obj*.
     *
     * @param {Object} obj
     * @param {function} func
     * @returns {Array}
     */
    map: function map(iter, func, self) {
        for (let i in iter)
            yield func.call(self, i);
    },

    /**
     * Returns the nth member of the given array that matches the
     * given predicate.
     */
    nth: function nth(iter, pred, n, self) {
        for (let elem in iter)
            if (pred.call(self, elem) && n-- === 0)
                return elem;
        return undefined;
    },

    sort: function sort(iter, fn, self)
        array(this.toArray(iter).sort(fn, self)),

    uniq: function uniq(iter) {
        let seen = {};
        for (let item in iter)
            if (!set.add(seen, item))
                yield item;
    },

    /**
     * Zips the contents of two arrays. The resulting array is the length of
     * ary1, with any shortcomings of ary2 replaced with null strings.
     *
     * @param {Array} ary1
     * @param {Array} ary2
     * @returns {Array}
     */
    zip: function zip(iter1, iter2) {
        try {
            yield [iter1.next(), iter2.next()];
        }
        catch (e if e instanceof StopIteration) {}
    }
});

/**
 * Array utility methods.
 */
var array = Class("array", Array, {
    init: function (ary) {
        if (isinstance(ary, ["Iterator", "Generator"]) || "__iterator__" in ary)
            ary = [k for (k in ary)];
        else if (ary.length)
            ary = Array.slice(ary);

        return {
            __proto__: ary,
            __iterator__: function () this.iterItems(),
            __noSuchMethod__: function (meth, args) {
                var res = array[meth].apply(null, [this.array].concat(args));
                if (isArray(res))
                    return array(res);
                if (isinstance(res, ["Iterator", "Generator"]))
                    return iter(res);
                return res;
            },
            array: ary,
            toString: function () this.array.toString(),
            concat: function () this.__noSuchMethod__("concat", Array.slice(arguments)),
            filter: function () this.__noSuchMethod__("filter", Array.slice(arguments)),
            map: function () this.__noSuchMethod__("map", Array.slice(arguments))
        };
    }
}, {
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
        assoc.forEach(function ([k, v]) {
            if (v instanceof Class.Property)
                Object.defineProperty(obj, k, v.init(k) || v);
            else
                obj[k] = v;
        });
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
     * Returns true if each element of ary1 is equal to the
     * corresponding element in ary2.
     *
     * @param {Array} ary1
     * @param {Array} ary2
     * @returns {boolean}
     */
    equals: function (ary1, ary2)
        ary1.length === ary2.length && Array.every(ary1, function (e, i) e === ary2[i]),

    /**
     * Flattens an array, such that all elements of the array are
     * joined into a single array:
     *    [["foo", ["bar"]], ["baz"], "quux"] -> ["foo", ["bar"], "baz", "quux"]
     *
     * @param {Array} ary
     * @returns {Array}
     */
    flatten: function flatten(ary) ary.length ? Array.prototype.concat.apply([], ary) : [],

    /**
     * Returns an Iterator for an array's values.
     *
     * @param {Array} ary
     * @returns {Iterator(Object)}
     */
    iterValues: function iterValues(ary) {
        for (let i = 0; i < ary.length; i++)
            yield ary[i];
    },

    /**
     * Returns an Iterator for an array's indices and values.
     *
     * @param {Array} ary
     * @returns {Iterator([{number}, {Object}])}
     */
    iterItems: function iterItems(ary) {
        let length = ary.length;
        for (let i = 0; i < length; i++)
            yield [i, ary[i]];
    },

    /**
     * Returns the nth member of the given array that matches the
     * given predicate.
     */
    nth: function nth(ary, pred, n, self) {
        for (let elem in values(ary))
            if (pred.call(self, elem) && n-- === 0)
                return elem;
        return undefined;
    },

    /**
     * Filters out all duplicates from an array. If *unsorted* is false, the
     * array is sorted before duplicates are removed.
     *
     * @param {Array} ary
     * @param {boolean} unsorted
     * @returns {Array}
     */
    uniq: function uniq(ary, unsorted) {
        let ret = [];
        if (unsorted) {
            for (let item in values(ary))
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
        let res = [];
        for (let [i, item] in Iterator(ary1))
            res.push([item, i in ary2 ? ary2[i] : ""]);
        return res;
    }
});

endModule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
