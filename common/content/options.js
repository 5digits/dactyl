// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

let ValueError = Class("ValueError", Error);

// do NOT create instances of this class yourself, use the helper method
// options.add() instead
/**
 * A class representing configuration options. Instances are created by the
 * {@link Options} class.
 *
 * @param {string[]} names The names by which this option is identified.
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
const Option = Class("Option", {
    init: function (names, description, type, defaultValue, extraInfo) {
        this.name = names[0];
        this.names = names;
        this.type = type;
        this.description = description;

        if (this.type in Option.getKey)
            this.getKey = Option.getKey[this.type];

        if (this.type in Option.parse)
            this.parse = Option.parse[this.type];

        if (this.type in Option.stringify)
            this.stringify = Option.stringify[this.type];

        if (this.type in Option.testValues)
            this.testValues = Option.testValues[this.type];

        this._op = Option.ops[this.type];

        if (extraInfo)
            update(this, extraInfo);

        if (arguments.length > 3) {
            if (this.type == "string")
                defaultValue = Commands.quote(defaultValue);
            this.defaultValue = this.parse(defaultValue);
        }

        // add no{option} variant of boolean {option} to this.names
        if (this.type == "boolean")
            this.names = array([name, "no" + name] for (name in values(names))).flatten().array;

        if (this.globalValue == undefined && !this.initialValue)
            this.globalValue = this.defaultValue;
    },

    initValue: function () {
        dactyl.trapErrors(function () this.value = this.value, this);
    },

    get isDefault() this.stringValue === this.stringDefaultValue,

    /** @property {value} The option's global value. @see #scope */
    get globalValue() options.store.get(this.name, {}).value,
    set globalValue(val) { options.store.set(this.name, { value: val, time: Date.now() }); },

    /**
     * Returns *value* as an array of parsed values if the option type is
     * "charlist" or "stringlist" or else unchanged.
     *
     * @param {value} value The option value.
     * @returns {value|string[]}
     */
    parse: function (value) Option.dequote(value),

    /**
     * Returns *values* packed in the appropriate format for the option type.
     *
     * @param {value|string[]} values The option value.
     * @returns {value}
     */
    stringify: function (vals) Commands.quote(vals),

    /**
     * Returns the option's value as an array of parsed values if the option
     * type is "charlist" or "stringlist" or else the simple value.
     *
     * @param {number} scope The scope to return these values from (see
     *     {@link Option#scope}).
     * @returns {value|string[]}
     */
    get: function (scope) {
        if (scope) {
            if ((scope & this.scope) == 0) // option doesn't exist in this scope
                return null;
        }
        else
            scope = this.scope;

        let values;

        if (dactyl.has("tabs") && (scope & Option.SCOPE_LOCAL))
            values = tabs.options[this.name];
        if ((scope & Option.SCOPE_GLOBAL) && (values == undefined))
            values = this.globalValue;

        if (this.getter)
            return dactyl.trapErrors(this.getter, this, values);

        return values;
    },

    /**
     * Sets the option's value from an array of values if the option type is
     * "charlist" or "stringlist" or else the simple value.
     *
     * @param {number} scope The scope to apply these values to (see
     *     {@link Option#scope}).
     */
    set: function (newValues, scope, skipGlobal) {
        scope = scope || this.scope;
        if ((scope & this.scope) == 0) // option doesn't exist in this scope
            return;

        if (this.setter)
            newValues = dactyl.trapErrors(this.setter, this, newValues);
        if (newValues === undefined)
            return;

        if (dactyl.has("tabs") && (scope & Option.SCOPE_LOCAL))
            tabs.options[this.name] = newValues;
        if ((scope & Option.SCOPE_GLOBAL) && !skipGlobal)
            this.globalValue = newValues;

        this.hasChanged = true;
        this.setFrom = null;

        dactyl.triggerObserver("options." + this.name, newValues);
    },

    getValues: deprecated("Please use Option#get instead", "get"),
    setValues: deprecated("Please use Option#set instead", "set"),
    joinValues: deprecated("Please use Option#stringify instead", "stringify"),
    parseValues: deprecated("Please use Option#parse instead", "parse"),
    values: Class.Property({
        get: deprecated("Please use Option#value instead", function values() this.value),
        set: deprecated("Please use Option#value instead", function values(val) this.value = val)
    }),

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

    getKey: function (key) undefined,

    /**
     * Returns whether the option value contains one or more of the specified
     * arguments.
     *
     * @returns {boolean}
     */
    has: function () Array.some(arguments, function (val) this.value.indexOf(val) >= 0, this),

    /**
     * Returns whether this option is identified by *name*.
     *
     * @param {string} name
     * @returns {boolean}
     */
    hasName: function (name) this.names.indexOf(name) >= 0,

    /**
     * Returns whether the specified *values* are valid for this option.
     * @see Option#validator
     */
    isValidValue: function (values) this.validator(values),

    invalidArgument: function (arg, op) "E474: Invalid argument: " +
        this.name + (op || "").replace(/=?$/, "=") + arg,

    /**
     * Resets the option to its default value.
     */
    reset: function () {
        this.value = this.defaultValue;
    },

    /**
     * Sets the option's value using the specified set *operator*.
     *
     * @param {string} operator The set operator.
     * @param {value|string[]} values The value (or values) to apply.
     * @param {number} scope The scope to apply this value to (see
     *     {@link #scope}).
     * @param {boolean} invert Whether this is an invert boolean operation.
     */
    op: function (operator, values, scope, invert, str) {

        try {
            var newValues = this._op(operator, values, scope, invert);
            if (newValues == null)
                return "Operator " + operator + " not supported for option type " + this.type;

            if (!this.isValidValue(newValues))
                return this.invalidArgument(str || this.stringify(values), operator);
        }
        catch (e) {
            if (!(e instanceof ValueError))
                dactyl.reportError(e);
            return this.invalidArgument(str || this.stringify(values), operator) + ": " + e.message;
        }

        this.set(newValues, scope);
        return null;
    },

    // Properties {{{2

    /** @property {string} The option's canonical name. */
    name: null,
    /** @property {string[]} All names by which this option is identified. */
    names: null,

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
     * @property {string} This option's description, as shown in :optionusage.
     */
    description: "",

    /**
     * @property {function(CompletionContext, Args)} This option's completer.
     * @see CompletionContext
     */
    completer: null,

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
        Array.filter(values, function (val) !util.isSubdomain(val, host)),

    /**
     * @property {value} The option's default value. This value will be used
     *     unless the option is explicitly set either interactively or in an RC
     *     file or plugin.
     */
    defaultValue: null,

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

    testValues: function (values, validator) validator(values),

    /**
     * @property {function} The function called to validate the option's value
     *     when set.
     */
    validator: function () {
        if (this.completer)
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
     * Returns the timestamp when the option's value was last changed.
     */
    get lastSet() options.store.get(this.name).time,
    set lastSet(val) { options.store.set(this.name, { value: this.globalValue, time: Date.now() }); },

    /**
     * @property {nsIFile} The script in which this option was last set. null
     *     implies an interactive command.
     */
    setFrom: null

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

    parseRegexp: function (value, result, flags) {
        let [, bang, val] = /^(!?)(.*)/.exec(value);
        let re = RegExp(Option.dequote(val), flags);
        re.bang = bang;
        re.result = result !== undefined ? result : !bang;
        re.toString = function () Option.unparseRegexp(this);
        return re;
    },
    unparseRegexp: function (re) re.bang + Option.quote(util.regexp.getSource(re), /^!|:/) +
        (typeof re.result === "boolean" ? "" : ":" + Option.quote(re.result)),

    getKey: {
        stringlist: function (k) this.value.indexOf(k) >= 0,
        get charlist() this.stringlist,

        regexplist: function (k, default_) {
            for (let re in values(this.value))
                if (re.test(k))
                    return re.result;
            return arguments.length > 1 ? default_ : null;
        },
        get regexpmap() this.regexplist
    },

    stringify: {
        charlist:    function (vals) Commands.quote(vals.join("")),

        stringlist:  function (vals) vals.map(Option.quote).join(","),

        stringmap:   function (vals) [Option.quote(k, /:/) + ":" + Option.quote(v) for ([k, v] in Iterator(vals))].join(","),

        regexplist:  function (vals) vals.join(","),
        get regexpmap() this.regexplist
    },

    parse: {
        number:     function (value) Number(Option.dequote(value)),

        boolean:    function (value) Option.dequote(value) == "true" || value == true ? true : false,

        charlist:   function (value) Array.slice(Option.dequote(value)),

        stringlist: function (value) (value === "") ? [] : Option.splitList(value),

        regexplist: function (value) (value === "") ? [] :
            Option.splitList(value, true)
                  .map(function (re) Option.parseRegexp(re, undefined, this.regexpFlags), this),

        stringmap:  function (value) array.toObject(
            Option.splitList(value, true).map(function (v) {
                let [count, key, quote] = Commands.parseArg(v, /:/);
                return [key, Option.dequote(v.substr(count + 1))];
            })),

        regexpmap:  function (value)
            Option.splitList(value, true).map(function (v) {
                let [count, re, quote] = Commands.parseArg(v, /:/, true);
                v = Option.dequote(v.substr(count + 1));
                if (count === v.length)
                    [v, re] = [re, ".?"];
                return Option.parseRegexp(re, v, this.regexpFlags);
            }, this)
    },

    testValues: {
        regexpmap:  function (vals, validator) vals.every(function (re) validator(re.result)),
        stringlist: function (vals, validator) vals.every(validator, this),
        stringmap:  function (vals, validator) array(values(vals)).every(validator, this)
    },

    dequote: function (value) {
        let arg;
        [, arg, Option._quote] = Commands.parseArg(String(value), "");
        Option._splitAt = 0;
        return arg;
    },
    splitList: function (value, keepQuotes) {
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
    quote: function quote(str, re)
        Commands.quoteArg[/[\s|"'\\,]|^$/.test(str) || re && re.test && re.test(str)
            ? (/[\b\f\n\r\t]/.test(str) ? '"' : "'")
            : ""](str, re),

    ops: {
        boolean: function (operator, values, scope, invert) {
            if (operator != "=")
                return null;
            if (invert)
                return !this.value;
            return values;
        },

        number: function (operator, values, scope, invert) {
            if (invert)
                values = values[(values.indexOf(String(this.value)) + 1) % values.length]

            dactyl.assert(!isNaN(values) && Number(values) == parseInt(values),
                          "E521: Number required after := " + this.name + "=" + values);

            let value = parseInt(values);

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

        stringmap: function (operator, values, scope, invert) {
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

        stringlist: function (operator, values, scope, invert) {
            values = Array.concat(values);

            switch (operator) {
            case "+":
                return array.uniq(Array.concat(this.value, values), true);
            case "^":
                // NOTE: Vim doesn't prepend if there's a match in the current value
                return array.uniq(Array.concat(values, this.value), true);
            case "-":
                return this.value.filter(function (item) values.indexOf(item) == -1);
            case "=":
                if (invert) {
                    let keepValues = this.value.filter(function (item) values.indexOf(item) == -1);
                    let addValues  = values.filter(function (item) this.value.indexOf(item) == -1, this);
                    return addValues.concat(keepValues);
                }
                return values;
            }
            return null;
        },
        get charlist() this.stringlist,
        get regexplist() this.stringlist,
        get regexpmap() this.stringlist,

        string: function (operator, values, scope, invert) {
            if (invert)
                return values[(values.indexOf(this.value) + 1) % values.length]
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
        }
    },

    validIf: function (test, error) {
        if (test)
            return true;
        throw ValueError(error);
    },

    /**
     * Validates the specified *values* against values generated by the
     * option's completer function.
     *
     * @param {value|string[]} values The value or array of values to validate.
     * @returns {boolean}
     */
    validateCompleter: function (values) {
        let context = CompletionContext("");
        let res = context.fork("", 0, this, this.completer);
        if (!res)
            res = context.allItems.items.map(function (item) [item.text]);
        if (this.type == "regexpmap")
            return Array.concat(values).every(function (re) res.some(function (item) item[0] == re.result));
        return Array.concat(values).every(function (value) res.some(function (item) item[0] == value));
    },

    validateXPath: function (values) {
        let evaluator = XPathEvaluator();
        return this.testValues(values,
            function (value) evaluator.createExpression(value, util.evaluateXPath.resolver));
    }
});

/**
 * @instance options
 */
const Options = Module("options", {
    init: function () {
        this.needInit = [];
        this._options = [];
        this._optionMap = {};

        storage.newMap("options", { store: false });
        storage.addObserver("options", function optionObserver(key, event, option) {
            // Trigger any setters.
            let opt = options.get(option);
            if (event == "change" && opt)
                opt.set(opt.globalValue, Option.SCOPE_GLOBAL, true);
        }, window);
    },

    /** @property {Iterator(Option)} @private */
    __iterator__: function ()
        values(this._options.sort(function (a, b) String.localeCompare(a.name, b.name))),

    /**
     * Adds a new option.
     *
     * @param {string[]} names All names for the option.
     * @param {string} description A description of the option.
     * @param {string} type The option type (see {@link Option#type}).
     * @param {value} defaultValue The option's default value.
     * @param {Object} extra An optional extra configuration hash (see
     *     {@link Map#extraInfo}).
     * @optional
     */
    add: function (names, description, type, defaultValue, extraInfo) {
        if (!extraInfo)
            extraInfo = {};

        extraInfo.definedAt = commands.getCaller(Components.stack.caller);

        let name = names[0];
        if (name in this._optionMap) {
            dactyl.log("Warning: " + name.quote() + " already exists: replacing existing option.", 1);
            this.remove(name);
        }

        let closure = function () options._optionMap[name];
        memoize(this._options, this._options.length, closure);
        memoize(this._optionMap, name, function () Option(names, description, type, defaultValue, extraInfo));
        for (let alias in values(names.slice(1)))
            memoize(this._optionMap, alias, closure);
        if (extraInfo.setter && (!extraInfo.scope || extraInfo.scope & Option.SCOPE_GLOBAL))
            if (dactyl.initialized)
                closure().initValue();
            else
                memoize(this.needInit, this.needInit.length, closure);

        // quickly access options with options["wildmode"]:
        this.__defineGetter__(name, function () this._optionMap[name].value);
        this.__defineSetter__(name, function (value) { this._optionMap[name].value = value; });
    },

    allPrefs: deprecated("Please use prefs.getNames", function allPrefs() prefs.getNames.apply(prefs, arguments)),
    getPref: deprecated("Please use prefs.get", function getPref() prefs.get.apply(prefs, arguments)),
    invertPref: deprecated("Please use prefs.invert", function invertPref() prefs.invert.apply(prefs, arguments)),
    listPrefs: deprecated("Please use prefs.list", function listPrefs() { commandline.commandOutput(prefs.list.apply(prefs, arguments)); }),
    observePref: deprecated("Please use prefs.observe", function observePref() prefs.observe.apply(prefs, arguments)),
    popContext: deprecated("Please use prefs.popContext", function popContext() prefs.popContext.apply(prefs, arguments)),
    pushContext: deprecated("Please use prefs.pushContext", function pushContext() prefs.pushContext.apply(prefs, arguments)),
    resetPref: deprecated("Please use prefs.reset", function resetPref() prefs.reset.apply(prefs, arguments)),
    safeResetPref: deprecated("Please use prefs.safeReset", function safeResetPref() prefs.safeReset.apply(prefs, arguments)),
    safeSetPref: deprecated("Please use prefs.safeSet", function safeSetPref() prefs.safeSet.apply(prefs, arguments)),
    setPref: deprecated("Please use prefs.set", function setPref() prefs.set.apply(prefs, arguments)),
    withContext: deprecated("Please use prefs.withContext", function withContext() prefs.withContext.apply(prefs, arguments)),

    /**
     * Returns the option with *name* in the specified *scope*.
     *
     * @param {string} name The option's name.
     * @param {number} scope The option's scope (see {@link Option#scope}).
     * @optional
     * @returns {Option} The matching option.
     */
    get: function (name, scope) {
        if (!scope)
            scope = Option.SCOPE_BOTH;

        if (this._optionMap[name] && (this._optionMap[name].scope & scope))
            return this._optionMap[name];
        return null;
    },

    /**
     * Lists all options in *scope* or only those with changed values if
     * *onlyNonDefault* is specified.
     *
     * @param {boolean} onlyNonDefault Limit the list to prefs with a
     *     non-default value.
     * @param {number} scope Only list options in this scope (see
     *     {@link Option#scope}).
     */
    list: function (onlyNonDefault, scope) {
        if (!scope)
            scope = Option.SCOPE_BOTH;

        function opts(opt) {
            for (let opt in Iterator(options)) {
                let option = {
                    isDefault: opt.isDefault,
                    name:      opt.name,
                    default:   opt.stringDefaultValue,
                    pre:       "\u00a0\u00a0", // Unicode nonbreaking space.
                    value:     <></>
                };

                if (onlyNonDefault && option.isDefault)
                    continue;
                if (!(opt.scope & scope))
                    continue;

                if (opt.type == "boolean") {
                    if (!opt.value)
                        option.pre = "no";
                    option.default = (opt.defaultValue ? "" : "no") + opt.name;
                }
                else if (isArray(opt.value))
                    option.value = <>={template.map(opt.value, function (v) template.highlight(String(v)), <>,<span style="width: 0; display: inline-block"> </span></>)}</>;
                else
                    option.value = <>={template.highlight(opt.stringValue)}</>;
                yield option;
            }
        };

        commandline.commandOutput(template.options("Options", opts()));
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
        let ret = {};
        let matches, prefix, postfix, valueGiven;

        [matches, prefix, ret.name, postfix, valueGiven, ret.operator, ret.value] =
        args.match(/^\s*(no|inv)?([a-z_.-]*?)([?&!])?\s*(([-+^]?)=(.*))?\s*$/) || [];

        ret.args = args;
        ret.onlyNonDefault = false; // used for :set to print non-default options
        if (!args) {
            ret.name = "all";
            ret.onlyNonDefault = true;
        }

        if (matches) {
            ret.option = options.get(ret.name, ret.scope);
            if (!ret.option && (ret.option = options.get(prefix + ret.name, ret.scope))) {
                ret.name = prefix + ret.name;
                prefix = "";
            }
        }

        ret.prefix = prefix;
        ret.postfix = postfix;

        ret.all = (ret.name == "all");
        ret.get = (ret.all || postfix == "?" || (ret.option && ret.option.type != "boolean" && !valueGiven));
        ret.invert = (prefix == "inv" || postfix == "!");
        ret.reset = (postfix == "&");
        ret.unsetBoolean = (prefix == "no");

        ret.scope = modifiers && modifiers.scope;

        if (!ret.option)
            return ret;

        if (ret.value === undefined)
            ret.value = "";

        ret.optionValue = ret.option.get(ret.scope);

        ret.values = ret.option.parse(ret.value);

        return ret;
    },

    /**
     * Remove the option with matching *name*.
     *
     * @param {string} name The name of the option to remove. This can be
     *     any of the option's names.
     */
    remove: function (name) {
        let opt = this.get(name);
        for (let name in values(opt.names))
            delete this._optionMap[name];
        this._options = this._options.filter(function (o) o != opt);
    },

    /** @property {Object} The options store. */
    get store() storage.options
}, {
}, {
    commands: function () {
        let args = {
            getMode: function (args) findMode(args["-mode"]),
            iterate: function (args) {
                for (let map in mappings.iterate(this.getMode(args)))
                    for (let name in values(map.names))
                        yield { name: name, __proto__: map };
            },
            format: {
                description: function (map) (XML.ignoreWhitespace = false, XML.prettyPrinting = false, <>
                        {options.get("passkeys").has(map.name)
                            ? <span highlight="URLExtra">(passed by {template.helpLink("'passkeys'")})</span>
                            : <></>}
                        {template.linkifyHelp(map.description)}
                </>)
            }
        }

        dactyl.addUsageCommand({
            name: ["listo[ptions]", "lo"],
            description: "List all options along with their short descriptions",
            iterate: function (args) options,
            format: {
                description: function (opt) (XML.ignoreWhitespace = false, XML.prettyPrinting = false, <>
                        {opt.scope == Option.SCOPE_LOCAL
                            ? <span highlight="URLExtra">(buffer local)</span> : ""}
                        {template.linkifyHelp(opt.description)}
                </>)
            }
        });

        function setAction(args, modifiers) {
            let bang = args.bang;
            if (!args.length)
                args[0] = "";

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
                            arg.match(/^\s*?([a-zA-Z0-9\.\-_{}]+?)([?&!])?\s*(([-+^]?)=(.*))?\s*$/);
                        reset = (postfix == "&");
                        invertBoolean = (postfix == "!");
                    }

                    if (name == "all" && reset)
                        commandline.input("Warning: Resetting all preferences may make " + config.host + " unusable. Continue (yes/[no]): ",
                            function (resp) {
                                if (resp == "yes")
                                    for (let pref in values(prefs.getNames()))
                                        prefs.reset(pref);
                            },
                            { promptHighlight: "WarningMsg" });
                    else if (name == "all")
                        commandline.commandOutput(prefs.list(onlyNonDefault, ""));
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
                        else if (!isNaN(value) && parseInt(value) === Number(value))
                            value = parseInt(value);
                        else
                            value = Option.dequote(value);

                        if (operator)
                            value = Option.ops[typeof value].call({ value: prefs.get(name) }, operator, value);
                        prefs.set(name, value);
                    }
                    else
                        commandline.commandOutput(prefs.list(onlyNonDefault, name));
                    return;
                }

                let opt = options.parseOpt(arg, modifiers);
                dactyl.assert(opt, "Error parsing :set command: " + arg);

                let option = opt.option;
                dactyl.assert(option != null || opt.all,
                    "E518: Unknown option: " + opt.name);

                // reset a variable to its default value
                if (opt.reset) {
                    if (opt.all) {
                        for (let option in options)
                            option.reset();
                    }
                    else {
                        option.reset();
                    }
                }
                // read access
                else if (opt.get) {
                    if (opt.all)
                        options.list(opt.onlyNonDefault, opt.scope);
                    else {
                        XML.prettyPrinting = false;
                        XML.ignoreWhitespace = false;
                        if (option.type == "boolean")
                            var msg = (opt.optionValue ? "  " : "no") + option.name;
                        else
                            msg = "  " + option.name + "=" + opt.option.stringify(opt.optionValue);

                        if (options["verbose"] > 0 && option.setFrom)
                            msg = <>{msg}<br/>        Last set from {template.sourceLink(option.setFrom)}</>;

                        dactyl.echo(<span highlight="CmdOutput Message">{msg}</span>);
                    }
                }
                // write access
                else {
                    if (opt.option.type === "boolean") {
                        dactyl.assert(!opt.valueGiven, "E474: Invalid argument: " + arg);
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
                    option.setFrom = commands.getCaller(null);
                }
            }
        }

        function setCompleter(context, args, modifiers) {
            let filter = context.filter;

            if (args.bang) { // list completions for about:config entries
                if (filter[filter.length - 1] == "=") {
                    context.advance(filter.length);
                    filter = filter.substr(0, filter.length - 1);
                    context.completions = [
                            [prefs.get(filter), "Current Value"],
                            [prefs.getDefault(filter), "Default Value"]
                    ].filter(function (k) k[0] != null && String(k[0]).length < 200);
                    return null;
                }

                return completion.preference(context);
            }

            let opt = options.parseOpt(filter, modifiers);
            let prefix = opt.prefix;

            if (context.filter.indexOf("=") == -1) {
                if (false && prefix)
                    context.filters.push(function ({ item }) item.type == "boolean" || prefix == "inv" && isArray(item.values));
                return completion.option(context, opt.scope, prefix);
            }

            let option = opt.option;
            context.advance(context.filter.indexOf("=") + 1);

            if (!option) {
                context.message = "No such option: " + opt.name;
                context.highlight(0, name.length, "SPELLCHECK");
            }

            if (opt.get || opt.reset || !option || prefix)
                return null;

            if (!opt.value && !opt.operator && !opt.invert) {
                context.fork("default", 0, this, function (context) {
                    context.title = ["Extra Completions"];
                    context.completions = [
                            [option.stringValue, "Current value"],
                            [option.stringDefaultValue, "Default value"]
                    ].filter(function (f) f[0] !== "" && String(f[0]).length < 200);
                    context.quote = ["", util.identity, ""];
                });
            }

            let optcontext = context.fork("values");
            completion.optionValue(optcontext, opt.name, opt.operator);

            // Fill in the current values if we're removing
            if (opt.operator == "-" && isArray(opt.values)) {
                let have = set([i.text for (i in values(context.allItems.items))]);
                context = context.fork("current-values", 0);
                context.anchored = optcontext.anchored;
                context.maxItems = optcontext.maxItems;

                context.filters.push(function (i) !set.has(have, i.text));
                completion.optionValue(context, opt.name, opt.operator, null,
                                       function (context) {
                                           context.generate = function () option.value.map(function (o) [o, ""]);
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
                if (!args || args == "g:") {
                    let str =
                        <table>
                        {
                            template.map(globalVariables, function ([i, value]) {
                                return <tr>
                                            <td style="width: 200px;">{i}</td>
                                            <td>{fmt(value)}</td>
                                       </tr>;
                            })
                        }
                        </table>;
                    if (str.text().length() == str.*.length())
                        dactyl.echomsg("No variables found");
                    else
                        dactyl.echo(str, commandline.FORCE_MULTILINE);
                    return;
                }

                let matches = args.match(/^([a-z]:)?([\w]+)(?:\s*([-+.])?=\s*(.*)?)?$/);
                if (matches) {
                    let [, scope, name, op, expr] = matches;
                    let fullName = (scope || "") + name;

                    dactyl.assert(scope == "g:" || scope == null,
                        "E461: Illegal variable name: " + scope + name);
                    dactyl.assert(globalVariables.hasOwnProperty(name) || (expr && !op),
                        "E121: Undefined variable: " + fullName);

                    if (!expr)
                        dactyl.echo(fullName + "\t\t" + fmt(globalVariables[name]));
                    else {
                        try {
                            var newValue = dactyl.userEval(expr);
                        }
                        catch (e) {}
                        dactyl.assert(newValue !== undefined,
                            "E15: Invalid expression: " + expr);

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
                    dactyl.echoerr("E18: Unexpected characters in :let");
            },
            {
                deprecated: "Please use the options system instead",
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
                        for (opt in options)
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
                    domains: function (args) array.flatten(args.map(function (spec) {
                        try {
                            let opt = options.parseOpt(spec);
                            if (opt.option && opt.option.domains)
                                return opt.option.domains(opt.values);
                        }
                        catch (e) {
                            dactyl.reportError(e);
                        }
                        return [];
                    })),
                    keepQuotes: true,
                    privateData: function (args) args.some(function (spec) {
                        let opt = options.parseOpt(spec);
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
                    if (!dactyl.globalVariables.hasOwnProperty(name)) {
                        if (!args.bang)
                            dactyl.echoerr("E108: No such variable: " + name);
                        return;
                    }

                    delete dactyl.globalVariables[name];
                }
            },
            {
                argCount: "+",
                bang: true,
                deprecated: "Please use the options system instead"
            });
    },
    completion: function () {
        completion.option = function option(context, scope, prefix) {
            context.title = ["Option"];
            context.keys = { text: "names", description: "description" };
            context.completions = options;
            if (prefix == "inv")
                context.keys.text = function (opt)
                    opt.type == "boolean" || isArray(opt.value) ? opt.names.map(function (n) "inv" + n)
                                                                : opt.names;
            if (scope)
                context.filters.push(function ({ item }) item.scope & scope);
        };

        completion.optionValue = function (context, name, op, curValue, completer) {
            let opt = options.get(name);
            completer = completer || opt.completer;
            if (!completer || !opt)
                return;

            try {
                var curValues = curValue != null ? opt.parse(curValue) : opt.value;
                var newValues = opt.parse(context.filter);
            }
            catch (e) {
                context.message = "Error: " + e;
                context.completions = [];
                return;
            }

            let extra = {};
            switch (opt.type) {
            case "boolean":
                if (!completer)
                    completer = function () [["true", ""], ["false", ""]];
                break;
            case "regexplist":
                newValues = Option.splitList(context.filter);
                // Fallthrough
            case "stringlist":
                break;
            case "stringmap":
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

            context.title = ["Option Value"];
            context.quote = Commands.complQuote[Option._quote] || Commands.complQuote[""];
            // Not Vim compatible, but is a significant enough improvement
            // that it's worth breaking compatibility.
            if (isArray(newValues)) {
                context.filters.push(function (i) newValues.indexOf(i.text) == -1);
                if (op == "+")
                    context.filters.push(function (i) curValues.indexOf(i.text) == -1);
                if (op == "-")
                    context.filters.push(function (i) curValues.indexOf(i.text) > -1);
            }

            let res = completer.call(opt, context, extra);
            if (res)
                context.completions = res;
        };
    },
    javascript: function () {
        JavaScript.setCompleter(this.get, [function () ([o.name, o.description] for (o in options))]);
    },
    sanitizer: function () {
        sanitizer.addItem("options", {
            description: "Options containing hostname data",
            action: function (timespan, host) {
                if (host)
                    for (let opt in values(options._options))
                        if (timespan.contains(opt.lastSet * 1000) && opt.domains)
                            try {
                                opt.value = opt.filterDomain(host, opt.value);
                            }
                            catch (e) {
                                dactyl.reportError(e);
                            }
            },
            privateEnter: function () {
                for (let opt in values(options._options))
                    if (opt.privateData && (!callable(opt.privateData) || opt.privateData(opt.value)))
                        opt.oldValue = opt.value;
            },
            privateLeave: function () {
                for (let opt in values(options._options))
                    if (opt.oldValue != null) {
                        opt.value = opt.oldValue;
                        opt.oldValue = null;
                    }
            }
        });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
