// Copyright (c) 2009-2012 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm", this);
try {
    var ctypes;
    Cu.import("resource://gre/modules/ctypes.jsm");
}
catch (e) {}

let objproto = Object.prototype;
let { __lookupGetter__, __lookupSetter__, __defineGetter__, __defineSetter__,
      hasOwnProperty, propertyIsEnumerable } = objproto;

if (typeof XPCSafeJSObjectWrapper === "undefined")
    this.XPCSafeJSObjectWrapper = XPCNativeWrapper;

if (!XPCNativeWrapper.unwrap)
    XPCNativeWrapper.unwrap = function unwrap(obj) {
        if (hasOwnProperty.call(obj, "wrappedJSObject"))
            return obj.wrappedJSObject;
        return obj;
    };

let getGlobalForObject = Cu.getGlobalForObject || function (obj) obj.__parent__;

function require(module, target) JSMLoader.load(module, target);

function lazyRequire(module, names, target) {
    for each (let name in names)
        memoize(target || this, name, function (name) require(module)[name]);
}

let jsmodules = { lazyRequire: lazyRequire };
jsmodules.jsmodules = jsmodules;

function toString() "[module-global " + this.NAME + "]";

let use = {};
let loaded = {};
let currentModule;
let global = this;
function defineModule(name, params, module) {
    if (!module)
        module = this;

    module.NAME = name;
    module.EXPORTED_SYMBOLS = params.exports || [];
    if (!~module.EXPORTED_SYMBOLS.indexOf("File"))
        delete module.File;

    defineModule.loadLog.push("[Begin " + name + "]");
    defineModule.prefix += "  ";

    for (let [, mod] in Iterator(params.require || []))
        require(mod, module);

    module._lastModule = currentModule;
    currentModule = module;
    module.startTime = Date.now();
}

defineModule.loadLog = [];
Object.defineProperty(defineModule.loadLog, "push", {
    value: function (val) {
        val = defineModule.prefix + val;
        if (true)
            defineModule.dump(val + "\n");
        this[this.length] = Date.now() + " " + val;
    }
});
defineModule.prefix = "";
defineModule.dump = function dump_() {
    let msg = Array.map(arguments, function (msg) {
        if (loaded.util && typeof msg == "object")
            msg = util.objectToString(msg);
        return msg;
    }).join(", ");
    dump(String.replace(msg, /\n?$/, "\n")
               .replace(/^./gm, JSMLoader.name + ": $&"));
}
defineModule.modules = [];
defineModule.time = function time(major, minor, func, self) {
    let time = Date.now();
    if (typeof func !== "function")
        func = self[func];

    try {
        var res = func.apply(self, Array.slice(arguments, 4));
    }
    catch (e) {
        loaded.util && util.reportError(e);
    }

    JSMLoader.times.add(major, minor, Date.now() - time);
    return res;
}

function endModule() {
    defineModule.prefix = defineModule.prefix.slice(0, -2);
    defineModule.loadLog.push("(End   " + currentModule.NAME + ")");

    loaded[currentModule.NAME] = 1;
    require(currentModule.NAME, jsmodules);
    currentModule = currentModule._lastModule;
}

function require_(obj, name, from, targetName) {
    try {
        if (arguments.length === 1)
            [obj, name] = [{}, obj];

        let caller = Components.stack.caller;

        if (!loaded[name])
            defineModule.loadLog.push((from || "require") + ": loading " + name +
                                      " into " + (targetName || obj.NAME || caller.filename + ":" + caller.lineNumber));

        JSMLoader.load(name + ".jsm", obj);

        if (!loaded[name] && obj != jsmodules)
            JSMLoader.load(name + ".jsm", jsmodules);

        return obj;
    }
    catch (e) {
        defineModule.dump("loading " + String.quote(name + ".jsm") + "\n");
        if (loaded.util)
            util.reportError(e);
        else
            defineModule.dump("    " + (e.filename || e.fileName) + ":" + e.lineNumber + ": " + e + "\n");
    }
}

defineModule("base", {
    // sed -n 's/^(const|var|function) ([a-zA-Z0-9_]+).*/	"\2",/p' base.jsm | sort | fmt
    exports: [
        "ErrorBase", "Cc", "Ci", "Class", "Cr", "Cu", "Module", "JSMLoader",
        "Set", "Struct", "StructBase", "Timer", "UTF8", "XPCOM", "XPCOMShim", "XPCOMUtils",
        "XPCSafeJSObjectWrapper", "array", "bind", "call", "callable", "ctypes", "curry",
        "debuggerProperties", "defineModule", "deprecated", "endModule", "forEach", "isArray",
        "isGenerator", "isinstance", "isObject", "isString", "isSubclass", "isXML", "iter",
        "iterAll", "iterOwnProperties", "keys", "literal", "memoize", "octal", "properties",
        "require", "set", "update", "values", "update_"
    ]
});

this.lazyRequire("cache", ["cache"]);
this.lazyRequire("config", ["config"]);
this.lazyRequire("messages", ["_", "Messages"]);
this.lazyRequire("services", ["services"]);
this.lazyRequire("storage", ["File"]);
this.lazyRequire("util", ["FailedAssertion", "util"]);

function literal(/* comment */) {
    let { caller } = Components.stack;
    while (caller && caller.language != 2)
        caller = caller.caller;

    let file = caller.filename.replace(/.* -> /, "");
    let key = "literal:" + file + ":" + caller.line;

    let source = File.readURL(file);

    let match = RegExp("(?:.*\\n){" + (caller.lineNumber - 1) + "}" +
                       ".*literal\\(/\\*([^]*?)\\*/\\)").exec(source);
    return match[1];

    // Later...
    return cache.get(key, function () {
        let source = cache.get("literal:" + file,
                               function () util.httpGet(file).responseText);

        let match = RegExp("(?:.*\\n){" + (caller.lineNumber - 1) + "}" +
                           ".*literal\\(/\\*([^]*?)\\*/\\)").exec(source);
        return match[1];
    });
}

/**
 * Returns a list of all of the top-level properties of an object, by
 * way of the debugger.
 *
 * @param {object} obj
 * @returns [jsdIProperty]
 */
function debuggerProperties(obj) {
    if (loaded.services && services.debugger.isOn) {
        let res = {};
        services.debugger.wrapValue(obj).getProperties(res, {});
        return res.value;
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
                if (key in obj && !Set.add(seen, key))
                    yield key;
    }
    catch (e) {}

    for (; obj; obj = prototypes && prototype(obj)) {
        try {
            if (sandbox.Object.getOwnPropertyNames || !debugger_ || !services.debugger.isOn)
                var iter = (v for each (v in Object.getOwnPropertyNames(obj)));
        }
        catch (e) {}
        if (!iter)
            iter = (prop.name.stringValue for (prop in values(debuggerProperties(obj))));

        for (let key in iter)
            if (!prototypes || !Set.add(seen, key) && obj != orig)
                yield key;
    }
}

function iterOwnProperties(obj) {
    for (let prop in properties(obj))
        yield [prop, Object.getOwnPropertyDescriptor(obj, prop)];
}

function deprecated(alternative, fn) {
    if (isObject(fn))
        return Class.Property(iter(fn).map(function ([k, v]) [k, callable(v) ? deprecated(alternative, v) : v])
                                      .toObject());

    let name, func = callable(fn) ? fn : function () this[fn].apply(this, arguments);

    function deprecatedMethod() {
        let obj = !this                      ? "" :
                  this.className             ? this.className + "#" :
                  this.constructor.className ? this.constructor.className + "#" :
                      "";

        deprecated.warn(func, obj + (fn.name || name), alternative);
        return func.apply(this, arguments);
    }

    return callable(fn) ? deprecatedMethod : Class.Property({
        get: function () deprecatedMethod,
        init: function (prop) { name = prop; }
    });
}
deprecated.warn = function warn(func, name, alternative, frame) {
    if (!func.seenCaller)
        func.seenCaller = Set([
            "resource://dactyl/javascript.jsm",
            "resource://dactyl/util.jsm"
        ]);

    frame = frame || Components.stack.caller.caller;
    let filename = util.fixURI(frame.filename || "unknown");
    if (!Set.add(func.seenCaller, filename))
        util.dactyl(func).warn([util.urlPath(filename), frame.lineNumber, " "].join(":")
                                   + _("warn.deprecated", name, alternative));
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
    if (isinstance(obj, ["Generator", "Iterator", Iter]))
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
function Set(ary) {
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
Set.add = curry(function set_add(set, key) {
    let res = this.has(set, key);
    set[key] = true;
    return res;
});
/**
 * Returns true if the given set contains the given key.
 *
 * @param {object} set The set.
 * @param {string} key The key to check.
 * @returns {boolean}
 */
Set.has = curry(function set_has(set, key) hasOwnProperty.call(set, key) &&
                                           propertyIsEnumerable.call(set, key));
/**
 * Returns a new set containing the members of the first argument which
 * do not exist in any of the other given arguments.
 *
 * @param {object} set The set.
 * @returns {object}
 */
Set.subtract = function set_subtract(set) {
    set = update({}, set);
    for (let i = 1; i < arguments.length; i++)
        for (let k in keys(arguments[i]))
            delete set[k];
    return set;
};
/**
 * Removes an element from a set and returns true if the element was
 * previously contained.
 *
 * @param {object} set The set.
 * @param {string} key The key to remove.
 * @returns boolean
 */
Set.remove = curry(function set_remove(set, key) {
    let res = set.has(set, key);
    delete set[key];
    return res;
});

function set() {
    deprecated.warn(set, "set", "Set");
    return Set.apply(this, arguments);
}
Object.keys(Set).forEach(function (meth) {
    set[meth] = function proxy() {
        deprecated.warn(proxy, "set." + meth, "Set." + meth);
        return Set[meth].apply(Set, arguments);
    };
});

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

if (curry.bind)
    var bind = function bind(meth, self) let (func = callable(meth) ? meth : self[meth])
        func.bind.apply(func, Array.slice(arguments, 1));
else
    var bind = function bind(func, self) {
        if (!callable(func))
            func = self[func];

        let args = Array.slice(arguments, bind.length);
        return function bound() func.apply(self, args.concat(Array.slice(arguments)));
    };

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

    return Array.concat(interfaces).some(function isinstance_some(iface) {
        if (typeof iface === "string") {
            if (objproto.toString.call(object) === "[object " + iface + "]")
                return true;
        }
        else if (typeof object === "object" && "isinstance" in object && object.isinstance !== isinstance) {
            if (object.isinstance(iface))
                return true;
        }
        else {
            if (object instanceof iface)
                return true;
            var type = isinstance_types[typeof object];
            if (type && isSubclass(iface, type))
                return true;
        }
        return false;
    });
}

/**
 * Returns true if obj is a non-null object.
 */
function isObject(obj) typeof obj === "object" && obj != null || obj instanceof Ci.nsISupports;

/**
 * Returns true if obje is an E4X XML object.
 * @deprecated
 */
function isXML(obj) typeof obj === "xml";

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
function callable(val) typeof val === "function" && !(val instanceof Ci.nsIDOMElement);

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
        let res = update(Object.create(obj), obj);
        for each (let prop in Object.getOwnPropertyNames(obj)) {
            let get = __lookupGetter__.call(obj, prop);
            if (get)
                memoize(res, prop, get);
        }
        return res;
    }

    try {
        Object.defineProperty(obj, key, {
            configurable: true,
            enumerable: true,

            get: function g_replaceProperty() {
                try {
                    Class.replaceProperty(this.instance || this, key, null);
                    return Class.replaceProperty(this.instance || this, key, getter.call(this, key));
                }
                catch (e) {
                    util.reportError(e);
                }
            },

            set: function s_replaceProperty(val)
                Class.replaceProperty(this.instance || this, key, val)
        });
    }
    catch (e) {
        obj[key] = getter.call(obj, key);
    }
}

let sandbox = Cu.Sandbox(Cc["@mozilla.org/systemprincipal;1"].createInstance());
sandbox.__proto__ = this;

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
                desc = desc.value.init(k, target) || desc.value;

            try {
                if (typeof desc.value === "function" && target.__proto__ && !(desc.value instanceof Ci.nsIDOMElement /* wtf? */)) {
                    let func = desc.value.wrapped || desc.value;
                    if (!func.superapply) {
                        func.__defineGetter__("super", function get_super() Object.getPrototypeOf(target)[k]);
                        func.superapply = function superapply(self, args)
                            let (meth = Object.getPrototypeOf(target)[k])
                                meth && meth.apply(self, args);
                        func.supercall = function supercall(self)
                            func.superapply(self, Array.slice(arguments, 1));
                    }
                }
                Object.defineProperty(target, k, desc);
            }
            catch (e) {}
        });
    }
    return target;
}
function update_(target) {
    for (let i = 1; i < arguments.length; i++) {
        let src = arguments[i];
        Object.getOwnPropertyNames(src || {}).forEach(function (k) {
            let desc = Object.getOwnPropertyDescriptor(src, k);
            if (desc.value instanceof Class.Property)
                desc = desc.value.init(k, target) || desc.value;

            try {
                if (typeof desc.value === "function" && target.__proto__ && !(desc.value instanceof Ci.nsIDOMElement /* wtf? */)) {
                    let func = desc.value.wrapped || desc.value;
                    if (!func.superapply) {
                        func.__defineGetter__("super", function get_super_() Object.getPrototypeOf(target)[k]);
                        func.superapply = function super_apply(self, args)
                            let (meth = Object.getPrototypeOf(target)[k])
                                meth && meth.apply(self, args);
                        func.supercall = function super_call(self)
                            func.superapply(self, Array.slice(arguments, 1));
                    }
                }
                Object.defineProperty(target, k, desc);
            }
            catch (e) {}
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

    if (loaded.config && (config.haveGecko("5.*", "6.0") || config.haveGecko("6.*"))) // Bug 657418.
        var Constructor = function Constructor() {
            var self = Object.create(Constructor.prototype);
            self.instance = self;

            if ("_metaInit_" in self && self._metaInit_)
                self._metaInit_.apply(self, arguments);

            var res = self.init.apply(self, arguments);
            return res !== undefined ? res : self;
        };
    else
        var Constructor = eval(String.replace('\n\
            (function constructor(PARAMS) {                      \n\
                var self = Object.create(Constructor.prototype); \n\
                self.instance = self;                            \n\
                                                                 \n\
                if ("_metaInit_" in self && self._metaInit_)     \n\
                    self._metaInit_.apply(self, arguments);      \n\
                                                                 \n\
                var res = self.init.apply(self, arguments);      \n\
                return res !== undefined ? res : self;           \n\
            })',
            "constructor", (name || superclass.className).replace(/\W/g, "_"))
                .replace("PARAMS", /^function .*?\((.*?)\)/.exec(args[0] && args[0].init || Class.prototype.init)[1]
                                                           .replace(/\b(self|res|Constructor)\b/g, "$1_")));

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
    memoize(Constructor, "closure", Class.makeClosure);
    update(Constructor, args[1]);

    Constructor.__proto__ = superclass;

    args.slice(2).forEach(function (obj) {
        if (callable(obj))
            obj = obj.prototype;
        update(Constructor.prototype, obj);
    });
    return Constructor;
}

if (Cu.getGlobalForObject)
    Class.objectGlobal = function (object) {
        try {
            return Cu.getGlobalForObject(object);
        }
        catch (e) {
            return null;
        }
    };
else
    Class.objectGlobal = function (object) {
        while (object.__parent__)
            object = object.__parent__;
        return object;
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
 * @returns {Class.Property}
 */
Class.Memoize = function Memoize(getter, wait)
    Class.Property({
        configurable: true,
        enumerable: true,
        init: function (key) {
            let done = false;

            if (wait)
                // Crazy, yeah, I know. -- Kris
                this.get = function replace() {
                    let obj = this.instance || this;
                    Object.defineProperty(obj, key,  {
                        configurable: true, enumerable: false,
                        get: function get() {
                            util.waitFor(function () done);
                            return this[key];
                        }
                    });

                    util.yieldable(function () {
                        let wait;
                        for (var res in getter.call(obj)) {
                            if (wait !== undefined)
                                yield wait;
                            wait = res;
                        }
                        Class.replaceProperty(obj, key, res);
                        done = true;
                    })();

                    return this[key];
                };
            else
                this.get = function g_Memoize() {
                    let obj = this.instance || this;
                    try {
                        Class.replaceProperty(obj, key, null);
                        return Class.replaceProperty(obj, key, getter.call(this, key));
                    }
                    catch (e) {
                        util.reportError(e);
                    }
                };

            this.set = function s_Memoize(val) Class.replaceProperty(this.instance || this, key, val);
        }
    });

Class.memoize = deprecated("Class.Memoize", function memoize() Class.Memoize.apply(this, arguments));

/**
 * Updates the given object with the object in the target class's
 * prototype.
 */
Class.Update = function Update(obj)
    Class.Property({
        configurable: true,
        enumerable: true,
        writable: true,
        init: function (key, target) {
            this.value = update({}, target[key], obj);
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
    init: function c_init() {},

    get instance() ({}),
    set instance(val) Class.replaceProperty(this, "instance", val),

    withSavedValues: function withSavedValues(names, callback, self) {
        let vals = names.map(function (name) this[name], this);
        try {
            return callback.call(self || this);
        }
        finally {
            names.forEach(function (name, i) this[name] = vals[i], this);
        }
    },

    toString: function C_toString() {
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
    timeout: function timeout(callback, timeout) {
        const self = this;
        function timeout_notify(timer) {
            if (self.stale ||
                    util.rehashing && !isinstance(Cu.getGlobalForObject(callback), ["BackstagePass"]))
                return;
            self.timeouts.splice(self.timeouts.indexOf(timer), 1);
            util.trapErrors(callback, self);
        }
        let timer = services.Timer(timeout_notify, timeout || 0, services.Timer.TYPE_ONE_SHOT);
        this.timeouts.push(timer);
        return timer;
    },
    timeouts: [],

    /**
     * Updates this instance with the properties of the given objects.
     * Like the update function, but with special semantics for
     * localized properties.
     */
    update: function update() {
        let self = this;
        // XXX: Duplication.

        for (let i = 0; i < arguments.length; i++) {
            let src = arguments[i];
            Object.getOwnPropertyNames(src || {}).forEach(function (k) {
                let desc = Object.getOwnPropertyDescriptor(src, k);
                if (desc.value instanceof Class.Property)
                    desc = desc.value.init(k, this) || desc.value;

                if (typeof desc.value === "function") {
                    let func = desc.value.wrapped || desc.value;
                    if (!func.superapply) {
                        func.__defineGetter__("super", function () Object.getPrototypeOf(self)[k]);
                        func.superapply = function superapply(self, args)
                            let (meth = Object.getPrototypeOf(self)[k])
                                meth && meth.apply(self, args);
                        func.supercall = function supercall(self)
                            func.superapply(self, Array.slice(arguments, 1));
                    }
                }

                try {
                    if ("value" in desc && (k in this.localizedProperties || k in this.magicalProperties))
                        this[k] = desc.value;
                    else
                        Object.defineProperty(this, k, desc);
                }
                catch (e) {}
            }, this);
        }
        return this;
    },

    localizedProperties: {},
    magicalProperties: {}
};
for (let name in properties(Class.prototype)) {
    let desc = Object.getOwnPropertyDescriptor(Class.prototype, name);
    desc.enumerable = false;
    Object.defineProperty(Class.prototype, name, desc);
}

Class.makeClosure = function makeClosure() {
    const self = this;
    function closure(fn) {
        function _closure() {
            try {
                return fn.apply(self, arguments);
            }
            catch (e if !(e instanceof FailedAssertion)) {
                util.reportError(e);
                throw e.stack ? e : Error(e);
            }
        }
        _closure.wrapped = fn;
        return _closure;
    }

    iter(properties(this), properties(this, true)).forEach(function (k) {
        if (!__lookupGetter__.call(this, k) && callable(this[k]))
            closure[k] = closure(this[k]);
        else if (!(k in closure))
            Object.defineProperty(closure, k, {
                configurable: true,
                enumerable: true,
                get: function get_proxy() self[k],
                set: function set_proxy(val) self[k] = val,
            });
    }, this);

    return closure;
};
memoize(Class.prototype, "closure", Class.makeClosure);

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

    let shim = XPCOMShim(interfaces);

    let res = Class("XPCOM(" + interfaces + ")", superClass || Class,
        update(iter([k,
                     v === undefined || callable(v) ? stub : v]
                     for ([k, v] in Iterator(shim))).toObject(),
               { QueryInterface: XPCOMUtils.generateQI(interfaces) }));

    return res;
}
function XPCOMShim(interfaces) {
    let ip = services.InterfacePointer({
        QueryInterface: function (iid) {
            if (iid.equals(Ci.nsISecurityCheckedComponent))
                throw Cr.NS_ERROR_NO_INTERFACE;
            return this;
        },
        getHelperForLanguage: function () null,
        getInterfaces: function (count) { count.value = 0; }
    });
    return (interfaces || []).reduce(function (shim, iface) shim.QueryInterface(Ci[iface]),
                                     ip.data)
};
let stub = Class.Property({
    configurable: true,
    enumerable: false,
    value: function stub() null,
    writable: true
});

/**
 * An abstract base class for classes that wish to inherit from Error.
 */
var ErrorBase = Class("ErrorBase", Error, {
    level: 2,
    init: function EB_init(message, level) {
        level = level || 0;
        let error = Error(message);
        update(this, error)
        this.stack = error.stack;
        this.message = message;

        let frame = Components.stack;
        for (let i = 0; i < this.level + level; i++) {
            frame = frame.caller;
            this.stack = this.stack.replace(/^.*\n/, "");
        }
        this.fileName = frame.filename;
        this.lineNumber = frame.lineNumber;
    },
    toString: function () String(this.message)
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
    try {
        let init = callable(prototype) ? 4 : 3;
        let proto = arguments[callable(prototype) ? 2 : 1];

        proto._metaInit_ = function () {
            delete module.prototype._metaInit_;
            currentModule[name.toLowerCase()] = this;
        };

        const module = Class.apply(Class, Array.slice(arguments, 0, init));
        let instance = module();
        module.className = name.toLowerCase();

        instance.INIT = update(Object.create(Module.INIT),
                               arguments[init] || {});

        currentModule[module.className] = instance;
        defineModule.modules.push(instance);
        return module;
    }
    catch (e) {
        if (typeof e === "string")
            e = Error(e);

        dump(e.fileName + ":" + e.lineNumber + ": " + e + "\n" + (e.stack || Error().stack));
    }
}
Module.INIT = {
    init: function Module_INIT_init(dactyl, modules, window) {
        let args = arguments;

        let locals = [];
        for (let local = this.Local; local; local = local.super)
            locals.push(local);

        if (locals.length) {
            let module = this, objs = {};
            for (let i in locals) {
                module = objs[i] = Object.create(module);
                module.modules = modules;
            }
            module.isLocalModule = true;

            modules.jsmodules[this.constructor.className] = module;
            locals.reverse().forEach(function (fn, i) update(objs[i], fn.apply(module, args)))

            memoize(module, "closure", Class.makeClosure);
            module.instance = module;
            module.init();

            if (module.signals)
                modules.dactyl.registerObservers(module);
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
    if (!/^[A-Z]/.test(arguments[0]))
        var args = Array.slice(arguments, 0);
    else {
        var className = arguments[0];
        args = Array.slice(arguments, 1);
    }

    const Struct = Class(className || "Struct", StructBase, {
        length: args.length,
        members: array.toObject(args.map(function (v, k) [v, k]))
    });
    args.forEach(function (name, i) {
        Struct.prototype.__defineGetter__(name, function () this[i]);
        Struct.prototype.__defineSetter__(name, function (val) { this[i] = val; });
    });
    return Struct;
}
var StructBase = Class("StructBase", Array, {
    init: function struct_init() {
        for (let i = 0; i < arguments.length; i++)
            if (arguments[i] != undefined)
                this[i] = arguments[i];
    },

    get toStringParams() this,

    clone: function struct_clone() this.constructor.apply(null, this.slice()),

    closure: Class.Property(Object.getOwnPropertyDescriptor(Class.prototype, "closure")),

    get: function struct_get(key, val) this[this.members[key]],
    set: function struct_set(key, val) this[this.members[key]] = val,

    toString: function struct_toString() Class.prototype.toString.apply(this, arguments),

    // Iterator over our named members
    __iterator__: function struct__iterator__() {
        let self = this;
        return ([k, self[k]] for (k in keys(self.members)))
    }
}, {
    fromArray: function fromArray(ary) {
        if (!(ary instanceof this))
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
    defaultValue: function defaultValue(key, val) {
        let i = this.prototype.members[key];
        this.prototype.__defineGetter__(i, function () (this[i] = val.call(this)));
        this.prototype.__defineSetter__(i, function (value)
            Class.replaceProperty(this, i, value));
        return this;
    },

    localize: function localize(key, defaultValue) {
        let i = this.prototype.members[key];
        Object.defineProperty(this.prototype, i, Messages.Localized(defaultValue).init(key, this.prototype));
        return this;
    }
});

var Timer = Class("Timer", {
    init: function init(minInterval, maxInterval, callback, self) {
        this._timer = services.Timer();
        this.callback = callback;
        this.self = self || this;
        this.minInterval = minInterval;
        this.maxInterval = maxInterval;
        this.doneAt = 0;
        this.latest = 0;
    },

    notify: function notify(timer, force) {
        try {
            if (!loaded || loaded.util && util.rehashing || typeof util === "undefined" || !force && this.doneAt == 0)
                return;

            this._timer.cancel();
            this.latest = 0;
            // minInterval is the time between the completion of the command and the next firing
            this.doneAt = Date.now() + this.minInterval;

            this.callback.call(this.self, this.arg);
        }
        catch (e) {
            if (typeof util === "undefined")
                dump(JSMLoader.name + ": " + e + "\n" + (e.stack || Error().stack));
            else
                util.reportError(e);
        }
        finally {
            this.doneAt = Date.now() + this.minInterval;
        }
    },

    tell: function tell(arg) {
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

    reset: function reset() {
        this._timer.cancel();
        this.doneAt = 0;
    },

    flush: function flush(force) {
        if (this.doneAt == -1 || force)
            this.notify(null, true);
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
 * @param {nsIJSIID} iface The interface to which to query all elements.
 * @returns {Generator}
 */
function iter(obj, iface) {
    if (arguments.length == 2 && iface instanceof Ci.nsIJSIID)
        return iter(obj).map(function (item) item.QueryInterface(iface));

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
    return Iter(res);
}
update(iter, {
    toArray: function toArray(iter) array(iter).array,

    // See array.prototype for API docs.
    toObject: function toObject(iter) {
        let obj = {};
        for (let [k, v] in iter)
            if (v instanceof Class.Property)
                Object.defineProperty(obj, k, v.init(k, obj) || v);
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

    indexOf: function indexOf(iter, elem) {
        let i = 0;
        for (let item in iter) {
            if (item == elem)
                return i;
            i++;
        }
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
        if (typeof pred === "number")
            [pred, n] = [function () true, pred]; // Hack.

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
            if (!Set.add(seen, item))
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

const Iter = Class("Iter", {
    init: function init(iter) {
        this.iter = iter;
        if ("__iterator__" in iter)
            this.iter = iter.__iterator__();

        if (this.iter.finalize)
            this.finalize = function finalize() this.iter.finalize.apply(this.iter, arguments);
    },

    next: function next() this.iter.next(),

    send: function send() this.iter.send.apply(this.iter, arguments),

    __iterator__: function () this.iter
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
     * @param {[Array]} assoc
     * @... {string} 0 - Key
     * @...          1 - Value
     */
    toObject: function toObject(assoc) {
        let obj = {};
        assoc.forEach(function ([k, v]) {
            if (v instanceof Class.Property)
                Object.defineProperty(obj, k, v.init(k, obj) || v);
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
        let res = [];
        if (unsorted) {
            for (let item in values(ary))
                if (res.indexOf(item) == -1)
                    res.push(item);
        }
        else {
            for (let [, item] in Iterator(ary.sort())) {
                if (item != last || !res.length)
                    res.push(item);
                var last = item;
            }
        }
        return res;
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

/* Make Minefield not explode, because Minefield exploding is not fun. */
let iterProto = Iter.prototype;
Object.keys(iter).forEach(function (k) {
    iterProto[k] = function () {
        let res = iter[k].apply(iter, [this].concat(Array.slice(arguments)));
        if (isinstance(res, ["Iterator", "Generator"]))
            return Iter(res);
        return res;
    };
});

Object.keys(array).forEach(function (k) {
    if (!(k in iterProto))
        iterProto[k] = function () {
            let res = array[k].apply(array, [this.toArray()].concat(Array.slice(arguments)));
            if (isinstance(res, ["Iterator", "Generator"]))
                return Iter(res);
            if (isArray(res))
                return array(res);
            return res;
        };
});

Object.getOwnPropertyNames(Array.prototype).forEach(function (k) {
    if (!(k in iterProto) && callable(Array.prototype[k]))
        iterProto[k] = function () {
            let ary = iter(this).toArray();
            let res = ary[k].apply(ary, arguments);
            if (isArray(res))
                return array(res);
            return res;
        };
});

endModule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
