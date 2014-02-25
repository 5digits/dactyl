// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

defineModule("options", {
    exports: ["Option", "Options", "ValueError", "options"],
    require: ["contexts", "messages", "storage"]
});

lazyRequire("cache", ["cache"]);
lazyRequire("config", ["config"]);
lazyRequire("commands", ["Commands"]);
lazyRequire("completion", ["CompletionContext"]);
lazyRequire("prefs", ["prefs"]);
lazyRequire("styles", ["Styles"]);
lazyRequire("template", ["template"]);

/** @scope modules */

let ValueError = Class("ValueError", ErrorBase);

// do NOT create instances of this class yourself, use the helper method
// options.add() instead
/**
 * A class representing configuration options. Instances are created by the
 * {@link Options} class.
 *
 * @param {[string]} names The names by which this option is identified.
 * @param {string} description A short one line description of the option.
 * @param {string} type The option's value data type (see {@link Option#type}).
 * @param {string} defaultValue The default value for this option.
 * @param {Object} extraInfo An optional extra configuration hash. The
 *     following properties are supported.
 *         completer   - see {@link Option#completer}
 *         domains     - see {@link Option#domains}
 *         getter      - see {@link Option#getter}
 *         initialValue - Initial value is loaded from getter
 *         persist     - see {@link Option#persist}
 *         privateData - see {@link Option#privateData}
 *         scope       - see {@link Option#scope}
 *         setter      - see {@link Option#setter}
 *         validator   - see {@link Option#validator}
 * @optional
 * @private
 */
var Option = Class("Option", {
    init: function init(modules, names, description, defaultValue, extraInfo) {
        this.modules = modules;
        this.name = names[0];
        this.realNames = names;
        this.description = description;

        if (extraInfo)
            this.update(extraInfo);

        this._defaultValue = defaultValue;

        if (this.globalValue == undefined && !this.initialValue)
            this.globalValue = this.defaultValue;
    },

    magicalProperties: RealSet(["cleanupValue"]),

    /**
     * @property {string} This option's description, as shown in :listoptions.
     */
    description: Messages.Localized(""),

    get helpTag() "'" + this.name + "'",

    initValue: function initValue() {
        util.trapErrors(() => { this.value = this.value; });
    },

    get isDefault() this.stringValue === this.stringDefaultValue,

    /** @property {value} The value to reset this option to at cleanup time. */
    get cleanupValue() options.cleanupPrefs.get(this.name),
    set cleanupValue(value) {
        if (options.cleanupPrefs.get(this.name) == null)
            options.cleanupPrefs.set(this.name, value);
    },

    /** @property {value} The option's global value. @see #scope */
    get globalValue() {
        let val = options.store.get(this.name, {}).value;
        if (val != null)
            return val;
        return this.globalValue = this.defaultValue;
    },
    set globalValue(val) {
        options.store.set(this.name,
                          { value: this.parse(this.stringify(val)),
                            time: Date.now() });
    },

    /**
     * Returns *value* as an array of parsed values if the option type is
     * "charlist" or "stringlist" or else unchanged.
     *
     * @param {value} value The option value.
     * @returns {value|[string]}
     */
    parse: function parse(value) Option.dequote(value),

    parseKey: function parseKey(value) value,

    /**
     * Returns *values* packed in the appropriate format for the option type.
     *
     * @param {value|[string]} values The option value.
     * @returns {value}
     */
    stringify: function stringify(vals) Commands.quote(vals),

    /**
     * Returns the option's value as an array of parsed values if the option
     * type is "charlist" or "stringlist" or else the simple value.
     *
     * @param {number} scope The scope to return these values from (see
     *     {@link Option#scope}).
     * @returns {value|[string]}
     */
    get: function get(scope) {
        if (scope) {
            if ((scope & this.scope) == 0) // option doesn't exist in this scope
                return null;
        }
        else
            scope = this.scope;

        let values;

        /*
        if (config.has("tabs") && (scope & Option.SCOPE_LOCAL))
            values = tabs.options[this.name];
         */
        if ((scope & Option.SCOPE_GLOBAL) && (values == undefined))
            values = this.globalValue;

        if (hasOwnProperty(this, "_value"))
            values = this._value;

        if (this.getter)
            return util.trapErrors(this.getter, this, values);

        return values;
    },

    /**
     * Sets the option's value from an array of values if the option type is
     * "charlist" or "stringlist" or else the simple value.
     *
     * @param {number} scope The scope to apply these values to (see
     *     {@link Option#scope}).
     */
    set: function set(newValues, scope, skipGlobal) {
        scope = scope || this.scope;
        if ((scope & this.scope) == 0) // option doesn't exist in this scope
            return;

        if (this.setter)
            newValues = this.setter(newValues);
        if (newValues === undefined)
            return;

        /*
        if (config.has("tabs") && (scope & Option.SCOPE_LOCAL))
            tabs.options[this.name] = newValues;
        */
        if ((scope & Option.SCOPE_GLOBAL) && !skipGlobal)
            this.globalValue = newValues;
        this._value = newValues;

        this.hasChanged = true;
        this.setFrom = null;

        // dactyl.triggerObserver("options." + this.name, newValues);
    },

    getValues: deprecated("Option#get", "get"),
    setValues: deprecated("Option#set", "set"),
    joinValues: deprecated("Option#stringify", "stringify"),
    parseValues: deprecated("Option#parse", "parse"),

    /**
     * @property {value} The option's current value. The option's local value,
     *     or if no local value is set, this is equal to the
     *     (@link #globalValue).
     */
    get value() this.get(),
    set value(val) this.set(val),

    get stringValue() this.stringify(this.value),
    set stringValue(value) this.value = this.parse(value),

    get stringDefaultValue() this.stringify(this.defaultValue),
    set stringDefaultValue(val) this.defaultValue = this.parse(val),

    getKey: function getKey(key) undefined,

    /**
     * Returns whether the option value contains one or more of the specified
     * arguments.
     *
     * @returns {boolean}
     */
    has: function has() Array.some(arguments, val => this.value.indexOf(val) >= 0),

    /**
     * Returns whether this option is identified by *name*.
     *
     * @param {string} name
     * @returns {boolean}
     */
    hasName: function hasName(name) this.names.indexOf(name) >= 0,

    /**
     * Returns whether the specified *values* are valid for this option.
     * @see Option#validator
     */
    isValidValue: function isValidValue(values) this.validator(values),

    invalidArgument: function invalidArgument(arg, op) _("error.invalidArgument",
        this.name + (op || "").replace(/=?$/, "=") + arg),

    /**
     * Resets the option to its default value.
     */
    reset: function reset() {
        this.value = this.defaultValue;
    },

    /**
     * Sets the option's value using the specified set *operator*.
     *
     * @param {string} operator The set operator.
     * @param {value|[string]} values The value (or values) to apply.
     * @param {number} scope The scope to apply this value to (see
     *     {@link #scope}).
     * @param {boolean} invert Whether this is an invert boolean operation.
     */
    op: function op(operator, values, scope, invert, str) {

        try {
            var newValues = this._op(operator, values, scope, invert);
            if (newValues == null)
                return _("option.operatorNotSupported", operator, this.type);

            if (!this.isValidValue(newValues))
                return this.invalidArgument(str || this.stringify(values), operator);

            this.set(newValues, scope);
        }
        catch (e) {
            if (!(e instanceof ValueError))
                util.reportError(e);
            return this.invalidArgument(str || this.stringify(values), operator) + ": " + e.message;
        }
        return null;
    },

    // Properties {{{

    /** @property {string} The option's canonical name. */
    name: null,

    /** @property {[string]} All names by which this option is identified. */
    names: Class.Memoize(function () this.realNames),

    /**
     * @property {string} The option's data type. One of:
     *     "boolean"    - Boolean, e.g., true
     *     "number"     - Integer, e.g., 1
     *     "string"     - String, e.g., "Pentadactyl"
     *     "charlist"   - Character list, e.g., "rb"
     *     "regexplist" - Regexp list, e.g., "^foo,bar$"
     *     "stringmap"  - String map, e.g., "key:v,foo:bar"
     *     "regexpmap"  - Regexp map, e.g., "^key:v,foo$:bar"
     */
    type: null,

    /**
     * @property {number} The scope of the option. This can be local, global,
     *     or both.
     * @see Option#SCOPE_LOCAL
     * @see Option#SCOPE_GLOBAL
     * @see Option#SCOPE_BOTH
     */
    scope: 1, // Option.SCOPE_GLOBAL // XXX set to BOTH by default someday? - kstep

    /**
     * @property {function(CompletionContext, Args)} This option's completer.
     * @see CompletionContext
     */
    completer: function completer(context, extra) {
        if (/map$/.test(this.type) && extra.value == null)
            return;

        if (this.values)
            context.completions = this.values;
    },

    /**
     * @property {[[string, string]]} This option's possible values.
     * @see CompletionContext
     */
    values: Messages.Localized(null),

    /**
     * @property {function(host, values)} A function which should return a list
     *     of domains referenced in the given values. Used in determining whether
     *     to purge the command from history when clearing private data.
     * @see Command#domains
     */
    domains: null,

    /**
     * @property {function(host, values)} A function which should strip
     *     references to a given domain from the given values.
     */
    filterDomain: function filterDomain(host, values)
        Array.filter(values, val => !this.domains([val]).some(val => util.isSubdomain(val, host))),

    /**
     * @property {value} The option's default value. This value will be used
     *     unless the option is explicitly set either interactively or in an RC
     *     file or plugin.
     */
    defaultValue: Class.Memoize(function () {
        let defaultValue = this._defaultValue;
        delete this._defaultValue;

        if (hasOwnProperty(this.modules.config.optionDefaults, this.name))
            defaultValue = this.modules.config.optionDefaults[this.name];

        if (defaultValue == null && this.getter)
            defaultValue = this.getter();

        if (defaultValue == undefined)
            return null;

        if (this.type === "string")
            defaultValue = Commands.quote(defaultValue);

        if (isArray(defaultValue))
            defaultValue = defaultValue.map(Option.quote).join(",");
        else if (isObject(defaultValue))
            defaultValue = iter(defaultValue).map(val => val.map(v => Option.quote(v, /:/))
                                                            .join(":"))
                                             .join(",");

        if (isArray(defaultValue))
            defaultValue = defaultValue.map(Option.quote).join(",");

        return this.parse(defaultValue);
    }),

    /**
     * @property {function} The function called when the option value is read.
     */
    getter: null,

    /**
     * @property {boolean} When true, this options values will be saved
     *     when generating a configuration file.
     * @default true
     */
    persist: true,

    /**
     * @property {boolean|function(values)} When true, values of this
     *     option may contain private data which should be purged from
     *     saved histories when clearing private data. If a function, it
     *     should return true if an invocation with the given values
     *     contains private data
     */
    privateData: false,

    /**
     * @property {function} The function called when the option value is set.
     */
    setter: null,

    testValues: function testValues(values, validator) validator(values),

    /**
     * @property {function} The function called to validate the option's value
     *     when set.
     */
    validator: function validator() {
        if (this.values || this.completer !== Option.prototype.completer)
            return Option.validateCompleter.apply(this, arguments);
        return true;
    },

    /**
     * @property {boolean} Set to true whenever the option is first set. This
     *     is useful to see whether it was changed from its default value
     *     interactively or by some RC file.
     */
    hasChanged: false,

    /**
     * @property {number} Returns the timestamp when the option's value was
     *     last changed.
     */
    get lastSet() options.store.get(this.name).time,
    set lastSet(val) { options.store.set(this.name, { value: this.globalValue, time: Date.now() }); },

    /**
     * @property {nsIFile} The script in which this option was last set. null
     *     implies an interactive command.
     */
    setFrom: null

    //}}}
}, {
    /**
     * @property {number} Global option scope.
     * @final
     */
    SCOPE_GLOBAL: 1,

    /**
     * @property {number} Local option scope. Options in this scope only
     *     apply to the current tab/buffer.
     * @final
     */
    SCOPE_LOCAL: 2,

    /**
     * @property {number} Both local and global option scope.
     * @final
     */
    SCOPE_BOTH: 3,

    has: {
        toggleAll: function toggleAll() toggleAll.supercall(this, "all") ^ !!toggleAll.superapply(this, arguments),
    },

    parseRegexp: function parseRegexp(value, result, flags) {
        let keepQuotes = this && this.keepQuotes;
        if (isArray(flags)) // Called by Array.map
            result = flags = undefined;

        if (flags == null)
            flags = this && this.regexpFlags || "";

        let [, bang, val] = /^(!?)(.*)/.exec(value);
        let re = util.regexp(Option.dequote(val), flags);
        re.bang = bang;
        re.result = result !== undefined ? result : !bang;
        re.key = re.bang + Option.quote(util.regexp.getSource(re), /^!|:/);
        re.toString = function () Option.unparseRegexp(this, keepQuotes);
        return re;
    },

    unparseRegexp: function unparseRegexp(re, quoted) re.bang + Option.quote(util.regexp.getSource(re), /^!|:/) +
        (typeof re.result === "boolean" ? "" : ":" + (quoted ? re.result : Option.quote(re.result, /:/))),

    parseSite: function parseSite(pattern, result, rest) {
        if (isArray(rest)) // Called by Array.map
            result = undefined;

        let [, bang, filter] = /^(!?)(.*)/.exec(pattern);
        filter = Option.dequote(filter).trim();

        let quote = this.keepQuotes ? v => v
                                    : v => Option.quote(v, /:/);

        return update(Styles.matchFilter(filter), {
            bang: bang,
            filter: filter,
            result: result !== undefined ? result : !bang,
            toString: function toString() this.bang + Option.quote(this.filter, /:/) +
                (typeof this.result === "boolean" ? "" : ":" + quote(this.result)),
        });
    },

    getKey: {
        stringlist: function stringlist(k) this.value.indexOf(k) >= 0,
        get charlist() this.stringlist,

        regexplist: function regexplist(k, default_=null) {
            for (let re in values(this.value))
                if ((re.test || re).call(re, k))
                    return re.result;
            return default_;
        },
        get regexpmap() this.regexplist,
        get sitelist() this.regexplist,
        get sitemap() this.regexplist
    },

    domains: {
        sitelist: function (vals) array.compact(vals.map(site => util.getHost(site.filter))),
        get sitemap() this.sitelist
    },

    stringify: {
        charlist:    function (vals) Commands.quote(vals.join("")),

        stringlist:  function (vals) vals.map(Option.quote).join(","),

        stringmap:   function (vals) [Option.quote(k, /:/) + ":" + Option.quote(v, /:/) for ([k, v] in Iterator(vals))].join(","),

        regexplist:  function (vals) vals.join(","),
        get regexpmap() this.regexplist,
        get sitelist() this.regexplist,
        get sitemap() this.regexplist
    },

    parse: {
        number:     function (value) let (val = Option.dequote(value))
                            Option.validIf(Number(val) % 1 == 0, _("option.intRequired")) && parseInt(val),

        boolean:    function boolean(value) Option.dequote(value) == "true" || value == true ? true : false,

        charlist:   function charlist(value) Array.slice(Option.dequote(value)),

        stringlist: function stringlist(value) (value === "") ? [] : Option.splitList(value),

        regexplist: function regexplist(value) (value === "") ? [] :
            Option.splitList(value, true)
                  .map(re => Option.parseRegexp(re, undefined, this.regexpFlags)),

        sitelist: function sitelist(value) {
            if (value === "")
                return [];
            if (!isArray(value))
                value = Option.splitList(value, true);
            return value.map(Option.parseSite, this);
        },

        stringmap: function stringmap(value) array.toObject(
            Option.splitList(value, true).map(function (v) {
                let [count, key, quote] = Commands.parseArg(v, /:/);
                return [key, Option.dequote(v.substr(count + 1))];
            })),

        regexpmap: function regexpmap(value) Option.parse.list.call(this, value, Option.parseRegexp),

        sitemap: function sitemap(value) Option.parse.list.call(this, value, Option.parseSite),

        list: function list(value, parse) let (prev = null)
            array.compact(Option.splitList(value, true).map(function (v) {
                let [count, filter, quote] = Commands.parseArg(v, /:/, true);

                let val = v.substr(count + 1);
                if (!this.keepQuotes)
                    val = Option.dequote(val);

                if (v.length > count)
                    return prev = parse.call(this, filter, val);
                else {
                    util.assert(prev, _("error.syntaxError"), false);
                    prev.result += "," + v;
                }
            }, this))
    },

    parseKey: {
        number: Number,
        boolean: function boolean(value) value == "true" || value == true ? true : false,
    },

    testValues: {
        regexpmap:  function regexpmap(vals, validator) vals.every(re => validator(re.result)),
        get sitemap() this.regexpmap,
        stringlist: function stringlist(vals, validator) vals.every(validator, this),
        stringmap:  function stringmap(vals, validator) values(vals).every(validator, this)
    },

    dequote: function dequote(value) {
        let arg;
        [, arg, Option._quote] = Commands.parseArg(String(value), "");
        Option._splitAt = 0;
        return arg;
    },

    splitList: function splitList(value, keepQuotes) {
        let res = [];
        Option._splitAt = 0;
        while (value.length) {
            if (count !== undefined)
                value = value.slice(1);
            var [count, arg, quote] = Commands.parseArg(value, /,/, keepQuotes);
            Option._quote = quote; // FIXME
            res.push(arg);
            if (value.length > count)
                Option._splitAt += count + 1;
            value = value.slice(count);
        }
        return res;
    },

    quote: function quote(str, re) isArray(str) ? str.map(s => quote(s, re)).join(",") :
        Commands.quoteArg[/[\s|"'\\,]|^$/.test(str) || re && re.test && re.test(str)
            ? (/[\b\f\n\r\t]/.test(str) ? '"' : "'")
            : ""](str, re),

    ops: {
        boolean: function boolean(operator, values, scope, invert) {
            if (operator != "=")
                return null;
            if (invert)
                return !this.value;
            return values;
        },

        number: function number(operator, values, scope, invert) {
            if (invert)
                values = values[(values.indexOf(String(this.value)) + 1) % values.length];

            let value = parseInt(values);
            util.assert(Number(values) % 1 == 0,
                        _("command.set.numberRequired", this.name, values));

            switch (operator) {
            case "+":
                return this.value + value;
            case "-":
                return this.value - value;
            case "^":
                return this.value * value;
            case "=":
                return value;
            }
            return null;
        },

        string: function string(operator, values, scope, invert) {
            if (invert)
                return values[(values.indexOf(this.value) + 1) % values.length];

            switch (operator) {
            case "+":
                return this.value + values;
            case "-":
                return this.value.replace(values, "");
            case "^":
                return values + this.value;
            case "=":
                return values;
            }
            return null;
        },

        stringmap: function stringmap(operator, values, scope, invert) {
            let res = update({}, this.value);

            switch (operator) {
            // The result is the same.
            case "+":
            case "^":
                return update(res, values);
            case "-":
                for (let [k, v] in Iterator(values))
                    if (v === res[k])
                        delete res[k];
                return res;
            case "=":
                if (invert) {
                    for (let [k, v] in Iterator(values))
                        if (v === res[k])
                            delete res[k];
                        else
                            res[k] = v;
                    return res;
                }
                return values;
            }
            return null;
        },

        stringlist: function stringlist(operator, values, scope, invert) {
            values = Array.concat(values);

            function uniq(ary) {
                let seen = RealSet();
                return ary.filter(elem => !seen.add(elem));
            }

            switch (operator) {
            case "+":
                return uniq(Array.concat(this.value, values), true);
            case "^":
                // NOTE: Vim doesn't prepend if there's a match in the current value
                return uniq(Array.concat(values, this.value), true);
            case "-":
                return this.value.filter(function (item) !this.has(item), RealSet(values));
            case "=":
                if (invert) {
                    let keepValues = this.value.filter(function (item) !this.has(item), RealSet(values));
                    let addValues  = values.filter(function (item) !this.has(item), RealSet(this.value));
                    return addValues.concat(keepValues);
                }
                return values;
            }
            return null;
        },
        get charlist() this.stringlist,
        get regexplist() this.stringlist,
        get regexpmap() this.stringlist,
        get sitelist() this.stringlist,
        get sitemap() this.stringlist
    },

    validIf: function validIf(test, error) {
        if (test)
            return true;
        throw ValueError(error);
    },

    /**
     * Validates the specified *values* against values generated by the
     * option's completer function.
     *
     * @param {value|[string]} values The value or array of values to validate.
     * @returns {boolean}
     */
    validateCompleter: function validateCompleter(vals) {
        function completions(extra) {
            let context = CompletionContext("");
            return context.fork("", 0, this, this.completer, extra) ||
                   context.allItems.items.map(item => [item.text]);
        };

        if (isObject(vals) && !isArray(vals)) {
            let k = values(completions.call(this, { values: {} })).toObject();
            let v = values(completions.call(this, { value: "" })).toObject();

            return Object.keys(vals).every(hasOwnProperty.bind(null, k)) &&
                   values(vals).every(hasOwnProperty.bind(null, v));
        }

        if (this.values)
            var acceptable = this.values.array || this.values;
        else
            acceptable = completions.call(this);

        if (isArray(acceptable))
            acceptable = RealSet(acceptable.map(([k]) => k));
        else
            acceptable = RealSet(this.parseKey(k)
                                 for (k of Object.keys(acceptable)));

        if (this.type === "regexpmap" || this.type === "sitemap")
            return Array.concat(vals).every(re => acceptable.has(re.result));

        return Array.concat(vals).every(v => acceptable.has(v));
    },

    types: {}
});

["Boolean",
 "Charlist",
 "Number",
 "RegexpList",
 "RegexpMap",
 "SiteList",
 "SiteMap",
 "String",
 "StringList",
 "StringMap"].forEach(function (name) {
     let type = name.toLowerCase();
     let class_ = Class(name + "Option", Option, {
         type: type,

         _op: Option.ops[type]
     });

    if (type in Option.getKey)
        class_.prototype.getKey = Option.getKey[type];

    if (type in Option.parse)
        class_.prototype.parse = Option.parse[type];

    if (type in Option.parseKey)
        class_.prototype.parseKey = Option.parse[type];

    if (type in Option.stringify)
        class_.prototype.stringify = Option.stringify[type];

    if (type in Option.domains)
        class_.prototype.domains = Option.domains[type];

    if (type in Option.testValues)
        class_.prototype.testValues = Option.testValues[type];

    Option.types[type] = class_;
    this[class_.className] = class_;
    EXPORTED_SYMBOLS.push(class_.className);
}, this);

update(BooleanOption.prototype, {
    names: Class.Memoize(function ()
                array.flatten([[name, "no" + name] for (name in values(this.realNames))]))
});

var OptionHive = Class("OptionHive", Contexts.Hive, {
    init: function init(group) {
        init.supercall(this, group);
        this.values = {};
        this.has = v => hasOwnProperty(this.values, v);
    },

    add: function add(names, description, type, defaultValue, extraInfo) {
        return this.modules.options.add(names, description, type, defaultValue, extraInfo);
    }
});

/**
 * @instance options
 */
var Options = Module("options", {
    Local: function Local(dactyl, modules, window) let ({ contexts } = modules) ({
        init: function init() {
            const self = this;

            update(this, {
                hives: contexts.Hives("options", Class("OptionHive", OptionHive, { modules: modules })),
                user: contexts.hives.options.user
            });

            this.needInit = [];
            this._options = [];
            this._optionMap = {};

            storage.newMap("options", { store: false });
            storage.addObserver("options", function optionObserver(key, event, option) {
                // Trigger any setters.
                let opt = self.get(option);
                if (event == "change" && opt)
                    opt.set(opt.globalValue, Option.SCOPE_GLOBAL, true);
            }, window);

            modules.cache.register("options.dtd",
                () => util.makeDTD(
                        iter(([["option", o.name, "default"].join("."),
                               o.type === "string" ? o.defaultValue.replace(/'/g, "''") :
                               o.defaultValue === true  ? "on"  :
                               o.defaultValue === false ? "off" : o.stringDefaultValue]
                              for (o in self)),

                             ([["option", o.name, "type"].join("."), o.type] for (o in self)),

                             config.dtd)),
                true);
        },

        signals: {
            "io.source": function ioSource(context, file, modTime) {
                cache.flushEntry("options.dtd", modTime);
            }
        },

        dactyl: dactyl,

        /**
         * Lists all options in *scope* or only those with changed values if
         * *onlyNonDefault* is specified.
         *
         * @param {function(Option)} filter Limit the list
         * @param {number} scope Only list options in this scope (see
         *     {@link Option#scope}).
         */
        list: function list(filter, scope) {
            if (!scope)
                scope = Option.SCOPE_BOTH;

            function opts(opt) {
                for (let opt in Iterator(this)) {
                    if (filter && !filter(opt))
                        continue;
                    if (!(opt.scope & scope))
                        continue;

                    let option = {
                        __proto__: opt,
                        isDefault: opt.isDefault,
                        default:   opt.stringDefaultValue,
                        pre:       "\u00a0\u00a0", // Unicode nonbreaking space.
                        value:     []
                    };

                    if (opt.type == "boolean") {
                        if (!opt.value)
                            option.pre = "no";
                        option.default = (opt.defaultValue ? "" : "no") + opt.name;
                    }
                    else if (isArray(opt.value) && opt.type != "charlist")
                        option.value = ["", "=",
                                        template.map(opt.value,
                                                     v => template.highlight(String(v)),
                                                     ["", ",",
                                                      ["span", { style: "width: 0; display: inline-block" }, " "]])];
                    else
                        option.value = ["", "=", template.highlight(opt.stringValue)];
                    yield option;
                }
            };

            modules.commandline.commandOutput(
                template.options("Options", opts.call(this), this["verbose"] > 0));
        },

        cleanup: function cleanup() {
            for (let opt in this)
                if (opt.cleanupValue != null)
                    opt.stringValue = opt.cleanupValue;
        },

        /**
         * Adds a new option.
         *
         * @param {[string]} names All names for the option.
         * @param {string} description A description of the option.
         * @param {string} type The option type (see {@link Option#type}).
         * @param {value} defaultValue The option's default value.
         * @param {Object} extra An optional extra configuration hash (see
         *     {@link Map#extraInfo}).
         * @optional
         */
        add: function add(names, description, type, defaultValue, extraInfo) {
            if (!util.isDactyl(Components.stack.caller))
                deprecated.warn(add, "options.add", "group.options.add");

            util.assert(type in Option.types, _("option.noSuchType", type),
                        false);

            if (!extraInfo)
                extraInfo = {};

            extraInfo.definedAt = contexts.getCaller(Components.stack.caller);

            let name = names[0];
            if (name in this._optionMap) {
                this.dactyl.log(_("option.replaceExisting", name.quote()), 1);
                this.remove(name);
            }

            let closure = () => this._optionMap[name];

            memoize(this._optionMap, name,
                    function () Option.types[type](modules, names, description, defaultValue, extraInfo));

            for (let alias in values(names.slice(1)))
                memoize(this._optionMap, alias, closure);

            if (extraInfo.setter && (!extraInfo.scope || extraInfo.scope & Option.SCOPE_GLOBAL))
                if (this.dactyl.initialized)
                    closure().initValue();
                else
                    memoize(this.needInit, this.needInit.length, closure);

            this._floptions = (this._floptions || []).concat(name);
            memoize(this._options, this._options.length, closure);

            // quickly access options with options["wildmode"]:
            this.__defineGetter__(name, function () this._optionMap[name].value);
            this.__defineSetter__(name, function (value) { this._optionMap[name].value = value; });
        }
    }),

    /** @property {Iterator(Option)} @private */
    __iterator__: function __iterator__()
        values(this._options.sort((a, b) => String.localeCompare(a.name, b.name))),

    allPrefs: deprecated("prefs.getNames", function allPrefs() prefs.getNames.apply(prefs, arguments)),
    getPref: deprecated("prefs.get", function getPref() prefs.get.apply(prefs, arguments)),
    invertPref: deprecated("prefs.invert", function invertPref() prefs.invert.apply(prefs, arguments)),
    listPrefs: deprecated("prefs.list", function listPrefs() { this.modules.commandline.commandOutput(prefs.list.apply(prefs, arguments)); }),
    observePref: deprecated("prefs.observe", function observePref() prefs.observe.apply(prefs, arguments)),
    popContext: deprecated("prefs.popContext", function popContext() prefs.popContext.apply(prefs, arguments)),
    pushContext: deprecated("prefs.pushContext", function pushContext() prefs.pushContext.apply(prefs, arguments)),
    resetPref: deprecated("prefs.reset", function resetPref() prefs.reset.apply(prefs, arguments)),
    safeResetPref: deprecated("prefs.safeReset", function safeResetPref() prefs.safeReset.apply(prefs, arguments)),
    safeSetPref: deprecated("prefs.safeSet", function safeSetPref() prefs.safeSet.apply(prefs, arguments)),
    setPref: deprecated("prefs.set", function setPref() prefs.set.apply(prefs, arguments)),
    withContext: deprecated("prefs.withContext", function withContext() prefs.withContext.apply(prefs, arguments)),

    cleanupPrefs: Class.Memoize(() => config.prefs.Branch("cleanup.option.")),

    cleanup: function cleanup(reason) {
        if (~["disable", "uninstall"].indexOf(reason))
            this.cleanupPrefs.resetBranch();
    },

    /**
     * Returns the option with *name* in the specified *scope*.
     *
     * @param {string} name The option's name.
     * @param {number} scope The option's scope (see {@link Option#scope}).
     * @optional
     * @returns {Option} The matching option.
     */
    get: function get(name, scope) {
        if (!scope)
            scope = Option.SCOPE_BOTH;

        if (this._optionMap[name] && (this._optionMap[name].scope & scope))
            return this._optionMap[name];
        return null;
    },

    /**
     * Parses a :set command's argument string.
     *
     * @param {string} args The :set command's argument string.
     * @param {Object} modifiers A hash of parsing modifiers. These are:
     *     scope - see {@link Option#scope}
     * @optional
     * @returns {Object} The parsed command object.
     */
    parseOpt: function parseOpt(args, modifiers) {
        let res = {};
        let matches, prefix, postfix;

        [matches, prefix, res.name, postfix, res.valueGiven, res.operator, res.value] =
        args.match(/^\s*(no|inv)?([^=]+?)([?&!])?\s*(([-+^]?)=(.*))?\s*$/) || [];

        res.args = args;
        res.onlyNonDefault = false; // used for :set to print non-default options
        if (!args) {
            res.name = "all";
            res.onlyNonDefault = true;
        }

        if (matches) {
            if (res.option = this.get(res.name, res.scope)) {
                if (prefix === "no" && res.option.type !== "boolean")
                    res.option = null;
            }
            else if (res.option = this.get(prefix + res.name, res.scope)) {
                res.name = prefix + res.name;
                prefix = "";
            }
        }

        res.prefix = prefix;
        res.postfix = postfix;

        res.all = (res.name == "all");
        res.get = (res.all || postfix == "?" || (res.option && res.option.type != "boolean" && !res.valueGiven));
        res.invert = (prefix == "inv" || postfix == "!");
        res.reset = (postfix == "&");
        res.unsetBoolean = (prefix == "no");

        res.scope = modifiers && modifiers.scope;

        if (!res.option)
            return res;

        if (res.value === undefined)
            res.value = "";

        res.optionValue = res.option.get(res.scope);

        try {
            if (!res.invert || res.option.type != "number") // Hack.
                res.values = res.option.parse(res.value);
        }
        catch (e) {
            res.error = e;
        }

        return res;
    },

    /**
     * Remove the option with matching *name*.
     *
     * @param {string} name The name of the option to remove. This can be
     *     any of the option's names.
     */
    remove: function remove(name) {
        let opt = this.get(name);
        this._options = this._options.filter(o => o != opt);
        for (let name in values(opt.names))
            delete this._optionMap[name];
    },

    /** @property {Object} The options store. */
    get store() storage.options
}, {
}, {
    commands: function initCommands(dactyl, modules, window) {
        const { commands, contexts, options } = modules;

        dactyl.addUsageCommand({
            name: ["listo[ptions]", "lo"],
            description: "List all options along with their short descriptions",
            index: "option",
            iterate: function (args) options,
            format: {
                description: function (opt) [
                        opt.scope == Option.SCOPE_LOCAL
                            ? ["span", { highlight: "URLExtra" },
                                  "(" + _("option.bufferLocal") + ")"]
                            : "",
                        template.linkifyHelp(opt.description)
                ],
                help: function (opt) "'" + opt.name + "'"
            }
        });

        function setAction(args, modifiers) {
            let bang = args.bang;
            if (!args.length)
                args[0] = "";

            let list = [];
            function flushList() {
                let names = RealSet(list.map(opt => opt.option ? opt.option.name : ""));
                if (list.length)
                    if (list.some(opt => opt.all))
                        options.list(opt => !(list[0].onlyNonDefault && opt.isDefault),
                                     list[0].scope);
                    else
                        options.list(opt => names.has(opt.name),
                                     list[0].scope);
                list = [];
            }

            for (let [, arg] in args) {
                if (bang) {
                    let onlyNonDefault = false;
                    let reset = false;
                    let invertBoolean = false;

                    if (args[0] == "") {
                        var name = "all";
                        onlyNonDefault = true;
                    }
                    else {
                        var [matches, name, postfix, valueGiven, operator, value] =
                            arg.match(/^\s*?((?:[^=\\']|\\.|'[^']*')+?)([?&!])?\s*(([-+^]?)=(.*))?\s*$/);
                        reset = (postfix == "&");
                        invertBoolean = (postfix == "!");
                    }

                    name = Option.dequote(name);
                    if (name == "all" && reset)
                        modules.commandline.input(_("pref.prompt.resetAll", config.host) + " ",
                            function (resp) {
                                if (resp == "yes")
                                    for (let pref in values(prefs.getNames()))
                                        prefs.reset(pref);
                            },
                            { promptHighlight: "WarningMsg" });
                    else if (name == "all")
                        modules.commandline.commandOutput(prefs.list(onlyNonDefault, ""));
                    else if (reset)
                        prefs.reset(name);
                    else if (invertBoolean)
                        prefs.toggle(name);
                    else if (valueGiven) {
                        if (value == undefined)
                            value = "";
                        else if (value == "true")
                            value = true;
                        else if (value == "false")
                            value = false;
                        else if (Number(value) % 1 == 0)
                            value = parseInt(value);
                        else
                            value = Option.dequote(value);

                        if (operator)
                            value = Option.ops[typeof value].call({ value: prefs.get(name) }, operator, value);
                        prefs.set(name, value);
                    }
                    else
                        modules.commandline.commandOutput(prefs.list(onlyNonDefault, name));
                    return;
                }

                let opt = modules.options.parseOpt(arg, modifiers);
                util.assert(opt, _("command.set.errorParsing", arg));
                util.assert(!opt.error, _("command.set.errorParsing", opt.error));

                let option = opt.option;
                util.assert(option != null || opt.all, _("command.set.unknownOption", opt.name));

                // reset a variable to its default value
                if (opt.reset) {
                    flushList();
                    if (opt.all) {
                        for (let option in modules.options)
                            option.reset();
                    }
                    else {
                        option.reset();
                    }
                }
                // read access
                else if (opt.get)
                    list.push(opt);
                // write access
                else {
                    flushList();
                    if (opt.option.type === "boolean") {
                        util.assert(!opt.valueGiven, _("error.invalidArgument", arg));
                        opt.values = !opt.unsetBoolean;
                    }
                    else if (/^(string|number)$/.test(opt.option.type) && opt.invert)
                        opt.values = Option.splitList(opt.value);
                    try {
                        var res = opt.option.op(opt.operator || "=", opt.values, opt.scope, opt.invert,
                                                opt.value);
                    }
                    catch (e) {
                        res = e;
                    }
                    if (res)
                        dactyl.echoerr(res);
                    option.setFrom = contexts.getCaller(null);
                }
            }
            flushList();
        }

        function setCompleter(context, args, modifiers) {
            const { completion } = modules;

            let filter = context.filter;

            if (args.bang) { // list completions for about:config entries
                if (filter[filter.length - 1] == "=") {
                    context.advance(filter.length);
                    filter = filter.substr(0, filter.length - 1);

                    context.pushProcessor(0, (item, text, next) => next(item, text.substr(0, 100)));
                    context.completions = [
                            [prefs.get(filter), _("option.currentValue")],
                            [prefs.defaults.get(filter), _("option.defaultValue")]
                    ].filter(k => k[0] != null);
                    return null;
                }

                return completion.preference(context);
            }

            let opt = modules.options.parseOpt(filter, modifiers);
            let prefix = opt.prefix;

            context.highlight();
            if (context.filter.indexOf("=") == -1) {
                if (false && prefix)
                    context.filters.push(({ item }) => (item.type == "boolean" ||
                                                        prefix == "inv" && isArray(item.values)));

                return completion.option(context, opt.scope,
                                         opt.name == "inv" ? opt.name
                                                           : prefix);
            }

            function error(length, message) {
                context.message = message;
                context.highlight(0, length, "SPELLCHECK");
            }

            let option = opt.option;
            if (!option)
                return error(opt.name.length, _("option.noSuch", opt.name));

            context.advance(context.filter.indexOf("="));
            if (option.type == "boolean")
                return error(context.filter.length, _("error.trailingCharacters"));

            context.advance(1);
            if (opt.error)
                return error(context.filter.length, opt.error);

            if (opt.get || opt.reset || !option || prefix)
                return null;

            if (!opt.value && !opt.operator && !opt.invert) {
                context.fork("default", 0, this, function (context) {
                    context.title = ["Extra Completions"];
                    context.pushProcessor(0, (item, text, next) => next(item, text.substr(0, 100)));
                    context.completions = [
                            [option.stringValue, _("option.currentValue")],
                            [option.stringDefaultValue, _("option.defaultValue")]
                    ].filter(f => f[0] !== "");
                    context.quote = ["", util.identity, ""];
                });
            }

            let optcontext = context.fork("values");
            modules.completion.optionValue(optcontext, opt.name, opt.operator);

            // Fill in the current values if we're removing
            if (opt.operator == "-" && isArray(opt.values)) {
                let have = RealSet((i.text for (i in values(context.allItems.items))));
                context = context.fork("current-values", 0);
                context.anchored = optcontext.anchored;
                context.maxItems = optcontext.maxItems;

                context.filters.push(i => !have.has(i.text));
                modules.completion.optionValue(context, opt.name, opt.operator, null,
                                       function (context) {
                                           context.generate = () => option.value.map(o => [o, ""]);
                                       });
                context.title = ["Current values"];
            }
        }

        // TODO: deprecated. This needs to support "g:"-prefixed globals at a
        // minimum for now.  The coderepos plugins make extensive use of global
        // variables.
        commands.add(["let"],
            "Set or list a variable",
            function (args) {
                let globalVariables = dactyl._globalVariables;
                args = (args[0] || "").trim();
                function fmt(value) (typeof value == "number"   ? "#" :
                                     typeof value == "function" ? "*" :
                                                                  " ") + value;
                util.assert(!(!args || args == "g:"));

                let matches = args.match(/^([a-z]:)?([\w]+)(?:\s*([-+.])?=\s*(.*)?)?$/);
                if (matches) {
                    let [, scope, name, op, expr] = matches;
                    let fullName = (scope || "") + name;

                    util.assert(scope == "g:" || scope == null,
                                _("command.let.illegalVar", scope + name));
                    util.assert(hasOwnProperty(globalVariables, name) || (expr && !op),
                                _("command.let.undefinedVar", fullName));

                    if (!expr)
                        dactyl.echo(fullName + "\t\t" + fmt(globalVariables[name]));
                    else {
                        try {
                            var newValue = dactyl.userEval(expr);
                        }
                        catch (e) {}
                        util.assert(newValue !== undefined,
                            _("command.let.invalidExpression", expr));

                        let value = newValue;
                        if (op) {
                            value = globalVariables[name];
                            if (op == "+")
                                value += newValue;
                            else if (op == "-")
                                value -= newValue;
                            else if (op == ".")
                                value += String(newValue);
                        }
                        globalVariables[name] = value;
                    }
                }
                else
                    dactyl.echoerr(_("command.let.unexpectedChar"));
            },
            {
                deprecated: "the options system",
                literal: 0
            }
        );

        [
            {
                names: ["setl[ocal]"],
                description: "Set local option",
                modifiers: { scope: Option.SCOPE_LOCAL }
            },
            {
                names: ["setg[lobal]"],
                description: "Set global option",
                modifiers: { scope: Option.SCOPE_GLOBAL }
            },
            {
                names: ["se[t]"],
                description: "Set an option",
                modifiers: {},
                extra: {
                    serialize: function () [
                        {
                            command: this.name,
                            literalArg: [opt.type == "boolean" ? (opt.value ? "" : "no") + opt.name
                                                               : opt.name + "=" + opt.stringValue]
                        }
                        for (opt in modules.options)
                        if (!opt.getter && !opt.isDefault && (opt.scope & Option.SCOPE_GLOBAL))
                    ]
                }
            }
        ].forEach(function (params) {
            commands.add(params.names, params.description,
                function (args, modifiers) {
                    setAction(args, update(modifiers, params.modifiers));
                },
                update({
                    bang: true,
                    completer: setCompleter,
                    domains: function domains(args) array.flatten(args.map(function (spec) {
                        try {
                            let opt = modules.options.parseOpt(spec);
                            if (opt.option && opt.option.domains)
                                return opt.option.domains(opt.values);
                        }
                        catch (e) {
                            util.reportError(e);
                        }
                        return [];
                    })),
                    keepQuotes: true,
                    privateData: function privateData(args) args.some(function (spec) {
                        let opt = modules.options.parseOpt(spec);
                        return opt.option && opt.option.privateData &&
                            (!callable(opt.option.privateData) ||
                             opt.option.privateData(opt.values));
                    })
                }, params.extra || {}));
        });

        // TODO: deprecated. This needs to support "g:"-prefixed globals at a
        // minimum for now.
        commands.add(["unl[et]"],
            "Delete a variable",
            function (args) {
                for (let [, name] in args) {
                    name = name.replace(/^g:/, ""); // throw away the scope prefix
                    if (!hasOwnProperty(dactyl._globalVariables, name)) {
                        if (!args.bang)
                            dactyl.echoerr(_("command.let.noSuch", name));
                        return;
                    }

                    delete dactyl._globalVariables[name];
                }
            },
            {
                argCount: "+",
                bang: true,
                deprecated: "the options system"
            });
    },
    completion: function initCompletion(dactyl, modules, window) {
        const { completion } = modules;

        completion.option = function option(context, scope, prefix) {
            context.title = ["Option"];
            context.keys = { text: "names", description: "description" };
            context.anchored = false;
            context.completions = modules.options;
            if (prefix == "inv")
                context.keys.text = opt =>
                    opt.type == "boolean" || isArray(opt.value) ? opt.names.map(n => "inv" + n)
                                                                : opt.names;
            if (scope)
                context.filters.push(({ item }) => item.scope & scope);
        };

        completion.optionValue = function (context, name, op, curValue, completer) {
            let opt = modules.options.get(name);
            completer = completer || opt.completer;
            if (!completer || !opt)
                return;

            try {
                var curValues = curValue != null ? opt.parse(curValue) : opt.value;
                var newValues = opt.parse(context.filter);
            }
            catch (e) {
                context.message = _("error.error", e);
                context.completions = [];
                return;
            }

            let extra = {};
            switch (opt.type) {
            case "boolean":
                return;
            case "sitelist":
            case "regexplist":
                newValues = Option.splitList(context.filter);
                // Fallthrough
            case "stringlist":
                break;
            case "charlist":
                Option._splitAt = newValues.length;
                break;
            case "stringmap":
            case "sitemap":
            case "regexpmap":
                let vals = Option.splitList(context.filter);
                let target = vals.pop() || "";

                let [count, key, quote] = Commands.parseArg(target, /:/, true);
                let split = Option._splitAt;

                extra.key = Option.dequote(key);
                extra.value = count < target.length ? Option.dequote(target.substr(count + 1)) : null;
                extra.values = opt.parse(vals.join(","));

                Option._splitAt = split + (extra.value == null ? 0 : count + 1);
                break;
            }
            // TODO: Highlight when invalid
            context.advance(Option._splitAt);
            context.filter = Option.dequote(context.filter);

            function val(obj) {
                if (isArray(opt.defaultValue)) {
                    let val = [].find.call(obj, re => (re.key == extra.key));
                    return val && val.result;
                }
                if (hasOwnProperty(opt.defaultValue, extra.key))
                    return obj[extra.key];
            }

            if (extra.key && extra.value != null) {
                context.fork("default", 0, this, function (context) {
                    context.completions = [
                            [val(opt.value), _("option.currentValue")],
                            [val(opt.defaultValue), _("option.defaultValue")]
                    ].filter(f => (f[0] !== "" && f[0] != null));
                });
                context = context.fork("stuff", 0);
            }

            context.title = ["Option Value"];
            context.quote = Commands.complQuote[Option._quote] || Commands.complQuote[""];
            // Not Vim compatible, but is a significant enough improvement
            // that it's worth breaking compatibility.
            if (isArray(newValues)) {
                context.filters.push(i => newValues.indexOf(i.text) == -1);
                if (op == "+")
                    context.filters.push(i => curValues.indexOf(i.text) == -1);
                if (op == "-")
                    context.filters.push(i => curValues.indexOf(i.text) > -1);

                memoize(extra, "values", function () {
                    if (op == "+")
                        return curValues.concat(newValues);
                    if (op == "-")
                        return curValues.filter(v => newValues.indexOf(val) == -1);
                    return newValues;
                });
            }

            let res = completer.call(opt, context, extra);
            if (res)
                context.completions = res;
        };
    },
    javascript: function initJavascript(dactyl, modules, window) {
        const { options, JavaScript } = modules;
        JavaScript.setCompleter(Options.prototype.get, [() => ([o.name, o.description] for (o in options))]);
    },
    sanitizer: function initSanitizer(dactyl, modules, window) {
        const { sanitizer } = modules;

        sanitizer.addItem("options", {
            description: "Options containing hostname data",
            action: function sanitize_action(timespan, host) {
                if (host)
                    for (let opt in values(modules.options._options))
                        if (timespan.contains(opt.lastSet * 1000) && opt.domains)
                            try {
                                opt.value = opt.filterDomain(host, opt.value);
                            }
                            catch (e) {
                                dactyl.reportError(e);
                            }
            },
            privateEnter: function privateEnter() {
                for (let opt in values(modules.options._options))
                    if (opt.privateData && (!callable(opt.privateData) || opt.privateData(opt.value)))
                        opt.oldValue = opt.value;
            },
            privateLeave: function privateLeave() {
                for (let opt in values(modules.options._options))
                    if (opt.oldValue != null) {
                        opt.value = opt.oldValue;
                        opt.oldValue = null;
                    }
            }
        });
    }
});

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
