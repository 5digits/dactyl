// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

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
 *         valdator    - see {@link Option#validator}
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

        if (this.type in Option.parseValues)
            this.parseValues = Option.parseValues[this.type];

        if (this.type in Option.joinValues)
            this.joinValues = Option.joinValues[this.type];

        if (this.type in Option.testValues)
            this.testValues = Option.testValues[this.type];

        this._op = Option.ops[this.type];

        if (arguments.length > 3) {
            if (this.type == "string")
                defaultValue = Commands.quote(defaultValue);
            this.defaultValues = this.parseValues(defaultValue)
            this.defaultValue = this.joinValues(this.defaultValues);
        }

        if (extraInfo)
            update(this, extraInfo);

        // add no{option} variant of boolean {option} to this.names
        if (this.type == "boolean")
            this.names = array([name, "no" + name] for (name in values(names))).flatten().array;

        if (this.globalValue == undefined && !this.initialValue)
            this.globalValue = this.parseValues(this.defaultValue);
    },

    /** @property {value} The option's global value. @see #scope */
    get globalValue() options.store.get(this.name, {}).value,
    set globalValue(val) { options.store.set(this.name, { value: val, time: Date.now() }); },

    /**
     * Returns <b>value</b> as an array of parsed values if the option type is
     * "charlist" or "stringlist" or else unchanged.
     *
     * @param {value} value The option value.
     * @returns {value|string[]}
     */
    parseValues: function (value) Option.dequote(value),

    /**
     * Returns <b>values</b> packed in the appropriate format for the option
     * type.
     *
     * @param {value|string[]} values The option value.
     * @returns {value}
     */
    joinValues: function (vals) Commands.quote(vals),

    /** @property {value|string[]} The option value or array of values. */
    get values() this.getValues(this.scope),
    set values(values) this.setValues(values, this.scope),

    /**
     * Returns the option's value as an array of parsed values if the option
     * type is "charlist" or "stringlist" or else the simple value.
     *
     * @param {number} scope The scope to return these values from (see
     *     {@link Option#scope}).
     * @returns {value|string[]}
     */
    getValues: function (scope) {
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
    setValues: function (newValues, scope, skipGlobal) {
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

    /**
     * Returns the value of the option in the specified <b>scope</b>. The
     * (@link Option#getter) callback, if it exists, is invoked with this value
     * before it is returned.
     *
     * @param {number} scope The scope to return this value from (see
     *     {@link Option#scope}).
     * @returns {value}
     */
    get: function (scope) this.joinValues(this.getValues(scope)),

    /**
     * Sets the option value to <b>newValue</b> for the specified <b>scope</b>.
     * The (@link Option#setter) callback, if it exists, is invoked with
     * <b>newValue</b>.
     *
     * @param {value} newValue The option's new value.
     * @param {number} scope The scope to apply this value to (see
     *     {@link Option#scope}).
     */
    set: function (newValue, scope) this.setValues(this.parseValues(newValue), scope),

    /**
     * @property {value} The option's current value. The option's local value,
     *     or if no local value is set, this is equal to the
     *     (@link #globalValue).
     */
    get value() this.get(),
    set value(val) this.set(val),

    getKey: function (key) undefined,

    /**
     * Returns whether the option value contains one or more of the specified
     * arguments.
     *
     * @returns {boolean}
     */
    has: function () Array.some(arguments, function (val) this.values.indexOf(val) >= 0, this),

    /**
     * Returns whether this option is identified by <b>name</b>.
     *
     * @param {string} name
     * @returns {boolean}
     */
    hasName: function (name) this.names.indexOf(name) >= 0,

    /**
     * Returns whether the specified <b>values</b> are valid for this option.
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
     * Sets the option's value using the specified set <b>operator</b>.
     *
     * @param {string} operator The set operator.
     * @param {value|string[]} values The value (or values) to apply.
     * @param {number} scope The scope to apply this value to (see
     *     {@link #scope}).
     * @param {boolean} invert Whether this is an invert boolean operation.
     */
    op: function (operator, values, scope, invert, str) {

        let newValues = this._op(operator, values, scope, invert);

        if (newValues == null)
            return "Operator " + operator + " not supported for option type " + this.type;

        try {
            if (!this.isValidValue(newValues))
                return this.invalidArgument(str || this.joinValues(values), operator);
        }
        catch (e) {
            return this.invalidArgument(str || this.joinValues(values), operator) + ": " + e.message;
        }

        this.setValues(newValues, scope);
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
     *     "regexlist"  - Regex list, e.g., "^foo,bar$"
     *     "stringmap"  - String map, e.g., "key:v,foo:bar"
     *     "regexmap"   - Regex map, e.g., "^key:v,foo$:bar"
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

    parseRegex: function (value, result) {
        let [, bang, val] = /^(!?)(.*)/.exec(value);
        let re = RegExp(Option.dequote(val));
        re.bang = bang;
        re.result = arguments.length == 2 ? result : !bang;
        re.toString = function () Option.unparseRegex(this);
        return re;
    },
    unparseRegex: function (re) re.bang + Option.quote(re.source.replace(/\\(.)/g, function (m, n1) n1 == "/" ? n1 : m), /^!|:/) +
        (typeof re.result === "string" ? ":" + Option.quote(re.result) : ""),

    getKey: {
        stringlist: function (k) this.values.indexOf(k) >= 0,
        get charlist() this.stringlist,

        regexlist: function (k, default_) {
            for (let re in values(this.values))
                if (re.test(k))
                    return re.result;
            return arguments.length > 1 ? default_ : null;
        },
        get regexmap() this.regexlist
    },

    joinValues: {
        charlist:    function (vals) Commands.quote(vals.join("")),
        stringlist:  function (vals) vals.map(Option.quote).join(","),
        stringmap:   function (vals) [Option.quote(k, /:/) + ":" + Option.quote(v) for ([k, v] in Iterator(vals))].join(","),
        regexlist:   function (vals) vals.join(","),
        get regexmap() this.regexlist
    },

    parseValues: {
        number:     function (value) Number(Option.dequote(value)),
        boolean:    function (value) Option.dequote(value) == "true" || value == true ? true : false,
        charlist:   function (value) Array.slice(Option.dequote(value)),
        stringlist: function (value) (value === "") ? [] : Option.splitList(value),
        regexlist:  function (value) (value === "") ? [] : Option.splitList(value, true).map(Option.parseRegex),
        stringmap:  function (value) array.toObject(
            Option.splitList(value, true).map(function (v) {
                let [count, key, quote] = Commands.parseArg(v, /:/);
                return [key, Option.dequote(v.substr(count + 1))]
            })),
        regexmap:   function (value)
            Option.splitList(value, true).map(function (v) {
                let [count, re, quote] = Commands.parseArg(v, /:/, true);
                v = Option.dequote(v.substr(count + 1));
                if (count === v.length)
                    [v, re] = [re, ".?"];
                return Option.parseRegex(re, v);
            })
    },

    testValues: {
        regexmap:   function (vals, validator) vals.every(function (re) validator(re.result)),
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
        do {
            if (count !== undefined)
                value = value.slice(1);
            var [count, arg, quote] = Commands.parseArg(value, /,/, keepQuotes);
            Option._quote = quote; // FIXME
            res.push(arg);
            if (value.length > count)
                Option._splitAt += count + 1;
            value = value.slice(count);
        } while (value.length);
        return res;
    },
    quote: function quote(str, re) Commands.quoteArg[/[\s|"'\\,]|^$/.test(str) || re && re.test && re.test(str) ? "'" : ""](str, re),

    ops: {
        boolean: function (operator, values, scope, invert) {
            if (operator != "=")
                return null;
            if (invert)
                return !this.value;
            return values;
        },

        number: function (operator, values, scope, invert) {
            // TODO: support floats? Validators need updating.
            if (!/^[+-]?(?:0x[0-9a-f]+|0[0-7]*|[1-9][0-9]*)$/i.test(values))
                return "E521: Number required after := " + this.name + "=" + values;

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
            let res = update({}, this.values);

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
            const self = this;
            values = Array.concat(values);
            switch (operator) {
            case "+":
                return array.uniq(Array.concat(this.values, values), true);
            case "^":
                // NOTE: Vim doesn't prepend if there's a match in the current value
                return array.uniq(Array.concat(values, this.values), true);
            case "-":
                return this.values.filter(function (item) values.indexOf(item) == -1);
            case "=":
                if (invert) {
                    let keepValues = this.values.filter(function (item) values.indexOf(item) == -1);
                    let addValues  = values.filter(function (item) self.values.indexOf(item) == -1);
                    return addValues.concat(keepValues);
                }
                return values;
            }
            return null;
        },
        get charlist() this.stringlist,
        get regexlist() this.stringlist,
        get regexmap() this.stringlist,

        string: function (operator, values, scope, invert) {
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
        throw Error(error);
    },

    // TODO: Run this by default?
    /**
     * Validates the specified <b>values</b> against values generated by the
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
        if (this.type == "regexmap")
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
        this._prefContexts = [];

        for (let [, pref] in Iterator(this.allPrefs(Options.OLD_SAVED))) {
            let saved = Options.SAVED + pref.substr(Options.OLD_SAVED.length);
            if (!this.getPref(saved))
                this.setPref(saved, this.getPref(pref));
            this.resetPref(pref);
        }

        // Host application preferences which need to be changed to work well with
        //

        // Work around the popup blocker
        // TODO: Make this work like safeSetPref
        var popupAllowedEvents = this._loadPreference("dom.popup_allowed_events", "change click dblclick mouseup reset submit");
        if (!/keypress/.test(popupAllowedEvents)) {
            this._storePreference("dom.popup_allowed_events", popupAllowedEvents + " keypress");
            dactyl.registerObserver("shutdown", function () {
                if (this._loadPreference("dom.popup_allowed_events", "") == popupAllowedEvents + " keypress")
                    this._storePreference("dom.popup_allowed_events", popupAllowedEvents);
            });
        }

        storage.newMap("options", { store: false });
        storage.addObserver("options", function optionObserver(key, event, option) {
            // Trigger any setters.
            let opt = options.get(option);
            if (event == "change" && opt)
                opt.setValues(opt.globalValue, Option.SCOPE_GLOBAL, true);
        }, window);

        this._branch = services.get("pref").getBranch("").QueryInterface(Ci.nsIPrefBranch2);
        this._branch.addObserver("", this, false);
    },

    destroy: function () {
        this._branch.removeObserver("", this);
    },

    /** @property {Iterator(Option)} @private */
    __iterator__: function ()
        values(this._options.sort(function (a, b) String.localeCompare(a.name, b.name))),

    observe: function (subject, topic, data) {
        if (topic == "nsPref:changed") {
            // subject is the nsIPrefBranch we're observing (after appropriate QI)
            // data is the name of the pref that's been changed (relative to subject)
            switch (data) {
            case "accessibility.browsewithcaret":
                let value = options.getPref("accessibility.browsewithcaret", false);
                dactyl.mode = value ? modes.CARET : modes.NORMAL;
                break;
            }
        }
    },

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
        if (extraInfo.setter)
            memoize(this.needInit, this.needInit.length, closure);

        // quickly access options with options["wildmode"]:
        this.__defineGetter__(name, function () this._optionMap[name].values);
        this.__defineSetter__(name, function (value) { this._optionMap[name].values = value; });
    },

    /**
     * Returns the names of all preferences.
     *
     * @param {string} branch The branch in which to search preferences.
     *     @default ""
     */
    allPrefs: function (branch) services.get("pref").getChildList(branch || "", { value: 0 }),

    /**
     * Returns the option with <b>name</b> in the specified <b>scope</b>.
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
     * Lists all options in <b>scope</b> or only those with changed values
     * if <b>onlyNonDefault</b> is specified.
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
                    isDefault: opt.value === opt.defaultValue,
                    name:      opt.name,
                    default:   opt.defaultValue,
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
                    option.default = (option.default ? "" : "no") + opt.name;
                }
                else
                    option.value = <>={template.highlight(opt.value)}</>;
                yield option;
            }
        };

        commandline.commandOutput(template.options("Options", opts()));
    },

    /**
     * Lists all preferences matching <b>filter</b> or only those with
     * changed values if <b>onlyNonDefault</b> is specified.
     *
     * @param {boolean} onlyNonDefault Limit the list to prefs with a
     *     non-default value.
     * @param {string} filter The list filter. A null filter lists all
     *     prefs.
     * @optional
     */
    listPrefs: function (onlyNonDefault, filter) {
        if (!filter)
            filter = "";

        let prefArray = options.allPrefs();
        prefArray.sort();
        function prefs() {
            for (let [, pref] in Iterator(prefArray)) {
                let userValue = services.get("pref").prefHasUserValue(pref);
                if (onlyNonDefault && !userValue || pref.indexOf(filter) == -1)
                    continue;

                let value = options.getPref(pref);

                let option = {
                    isDefault: !userValue,
                    default:   options._loadPreference(pref, null, true),
                    value:     <>={template.highlight(value, true, 100)}</>,
                    name:      pref,
                    pre:       "\u00a0\u00a0" // Unicode nonbreaking space.
                };

                yield option;
            }
        };

        commandline.commandOutput(
            template.options(config.host + " Options", prefs()));
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
        args.match(/^\s*(no|inv)?([a-z_-]*?)([?&!])?\s*(([-+^]?)=(.*))?\s*$/) || [];

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
        ret.optionValues = ret.option.getValues(ret.scope);

        ret.values = ret.option.parseValues(ret.value);

        return ret;
    },

    /**
     * Remove the option with matching <b>name</b>.
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
    get store() storage.options,

    /**
     * Returns the value of the preference <b>name</b>.
     *
     * @param {string} name The preference name.
     * @param {value} forcedDefault The default value for this
     *     preference. Used for internal dactyl preferences.
     */
    getPref: function (name, forcedDefault) {
        return this._loadPreference(name, forcedDefault);
    },

    _checkPrefSafe: function (name, message, value) {
        let curval = this._loadPreference(name, null, false);
        if (arguments.length > 2 && curval === value)
            return;
        let defval = this._loadPreference(name, null, true);
        let saved  = this._loadPreference(Options.SAVED + name);

        if (saved == null && curval != defval || curval != saved) {
            let msg = "Warning: setting preference " + name + ", but it's changed from its default value.";
            if (message)
                msg += " " + message;
            dactyl.echomsg(msg);
        }
    },

    /**
     * Resets the preference <b>name</b> to </b>value</b> but warns the user
     * if the value is changed from its default.
     *
     * @param {string} name The preference name.
     * @param {value} value The new preference value.
     */
    safeResetPref: function (name, message) {
        this._checkPrefSafe(name, message);
        this.resetPref(name);
        this.resetPref(Options.SAVED + name);
    },

    /**
     * Sets the preference <b>name</b> to </b>value</b> but warns the user
     * if the value is changed from its default.
     *
     * @param {string} name The preference name.
     * @param {value} value The new preference value.
     */
    safeSetPref: function (name, value, message) {
        this._checkPrefSafe(name, message, value);
        this._storePreference(name, value);
        this._storePreference(Options.SAVED + name, value);
    },

    /**
     * Sets the preference <b>name</b> to </b>value</b>.
     *
     * @param {string} name The preference name.
     * @param {value} value The new preference value.
     */
    setPref: function (name, value) {
        this._storePreference(name, value);
    },

    /**
     * Resets the preference <b>name</b> to its default value.
     *
     * @param {string} name The preference name.
     */
    resetPref: function (name) {
        try {
            services.get("pref").clearUserPref(name);
        }
        catch (e) {} // ignore - thrown if not a user set value
    },

    /**
     * Toggles the value of the boolean preference <b>name</b>.
     *
     * @param {string} name The preference name.
     */
    invertPref: function (name) {
        if (services.get("pref").getPrefType(name) == Ci.nsIPrefBranch.PREF_BOOL)
            this.setPref(name, !this.getPref(name));
        else
            dactyl.echoerr("E488: Trailing characters: " + name + "!");
    },

    /**
     * Pushes a new preference context onto the context stack.
     *
     * @see #withContext
     */
    pushContext: function () {
        this._prefContexts.push({});
    },

    /**
     * Pops the top preference context from the stack.
     *
     * @see #withContext
     */
    popContext: function () {
        for (let [k, v] in Iterator(this._prefContexts.pop()))
            this._storePreference(k, v);
    },

    /**
     * Executes <b>func</b> with a new preference context. When <b>func</b>
     * returns, the context is popped and any preferences set via
     * {@link #setPref} or {@link #invertPref} are restored to their
     * previous values.
     *
     * @param {function} func The function to call.
     * @param {Object} func The 'this' object with which to call <b>func</b>
     * @see #pushContext
     * @see #popContext
     */
    withContext: function (func, self) {
        try {
            this.pushContext();
            return func.call(self);
        }
        finally {
            this.popContext();
        }
    },

    _storePreference: function (name, value) {
        if (this._prefContexts.length) {
            let val = this._loadPreference(name, null);
            if (val != null)
                this._prefContexts[this._prefContexts.length - 1][name] = val;
        }

        let type = services.get("pref").getPrefType(name);
        switch (typeof value) {
        case "string":
            if (type == Ci.nsIPrefBranch.PREF_INVALID || type == Ci.nsIPrefBranch.PREF_STRING) {
                let supportString = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
                supportString.data = value;
                services.get("pref").setComplexValue(name, Ci.nsISupportsString, supportString);
            }
            else if (type == Ci.nsIPrefBranch.PREF_INT)
                dactyl.echoerr("E521: Number required after =: " + name + "=" + value);
            else
                dactyl.echoerr("E474: Invalid argument: " + name + "=" + value);
            break;
        case "number":
            if (type == Ci.nsIPrefBranch.PREF_INVALID || type == Ci.nsIPrefBranch.PREF_INT)
                services.get("pref").setIntPref(name, value);
            else
                dactyl.echoerr("E474: Invalid argument: " + name + "=" + value);
            break;
        case "boolean":
            if (type == Ci.nsIPrefBranch.PREF_INVALID || type == Ci.nsIPrefBranch.PREF_BOOL)
                services.get("pref").setBoolPref(name, value);
            else if (type == Ci.nsIPrefBranch.PREF_INT)
                dactyl.echoerr("E521: Number required after =: " + name + "=" + value);
            else
                dactyl.echoerr("E474: Invalid argument: " + name + "=" + value);
            break;
        default:
            dactyl.echoerr("Unknown preference type: " + typeof value + " (" + name + "=" + value + ")");
        }
    },

    _loadPreference: function (name, forcedDefault, defaultBranch) {
        let defaultValue = null; // XXX
        if (forcedDefault != null) // this argument sets defaults for non-user settable options (like extensions.history.comp_history)
            defaultValue = forcedDefault;

        let branch = defaultBranch ? services.get("pref").getDefaultBranch("") : services.get("pref");
        let type = services.get("pref").getPrefType(name);
        try {
            switch (type) {
            case Ci.nsIPrefBranch.PREF_STRING:
                let value = branch.getComplexValue(name, Ci.nsISupportsString).data;
                // try in case it's a localized string (will throw an exception if not)
                if (!services.get("pref").prefIsLocked(name) && !services.get("pref").prefHasUserValue(name) &&
                    RegExp("chrome://.+/locale/.+\\.properties").test(value))
                        value = branch.getComplexValue(name, Ci.nsIPrefLocalizedString).data;
                return value;
            case Ci.nsIPrefBranch.PREF_INT:
                return branch.getIntPref(name);
            case Ci.nsIPrefBranch.PREF_BOOL:
                return branch.getBoolPref(name);
            default:
                return defaultValue;
            }
        }
        catch (e) {
            return defaultValue;
        }
    }
}, {
    SAVED: "extensions.dactyl.saved.",
    OLD_SAVED: "dactyl.saved."
}, {
    commands: function () {
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
                        arg.match(/^\s*?([a-zA-Z0-9\.\-_{}]+)([?&!])?\s*(([-+^]?)=(.*))?\s*$/);
                        reset = (postfix == "&");
                        invertBoolean = (postfix == "!");
                    }

                    if (name == "all" && reset)
                        commandline.input("Warning: Resetting all preferences may make " + config.host + " unusable. Continue (yes/[no]): ",
                            function (resp) {
                                if (resp == "yes")
                                    for (let pref in values(options.allPrefs()))
                                        options.resetPref(pref);
                            },
                            { promptHighlight: "WarningMsg" });
                    else if (name == "all")
                        options.listPrefs(onlyNonDefault, "");
                    else if (reset)
                        options.resetPref(name);
                    else if (invertBoolean)
                        options.invertPref(name);
                    else if (valueGiven) {
                        if (value == undefined)
                            value = "";
                        else if (value == "true")
                            value = true;
                        else if (value == "false")
                            value = false;
                        else if (/^\d+$/.test(value))
                            value = parseInt(value, 10);
                        options.setPref(name, value);
                    }
                    else
                        options.listPrefs(onlyNonDefault, name);
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
                        if (option.type == "boolean")
                            var msg = (opt.optionValue ? "  " : "no") + option.name;
                        else
                            msg = "  " + option.name + "=" + opt.optionValue;

                        if (options["verbose"] > 0 && option.setFrom)
                            msg += "\n        Last set from " + option.setFrom.path;

                        // FIXME: Message highlight group wrapping messes up the indent up for multi-arg verbose :set queries
                        dactyl.echo(<span highlight="CmdOutput">{msg}</span>);
                    }
                }
                // write access
                else {
                    if (opt.option.type == "boolean") {
                        dactyl.assert(!opt.valueGiven, "E474: Invalid argument: " + arg);
                        opt.values = !opt.unsetBoolean;
                    }
                    try {
                        var res = opt.option.op(opt.operator || "=", opt.values, opt.scope, opt.invert, opt.value);
                    }
                    catch (e) {
                        res = e;
                    }
                    if (res)
                        dactyl.echoerr(res);
                    option.setFrom = modifiers.setFrom || null;
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
                            [options._loadPreference(filter, null, false), "Current Value"],
                            [options._loadPreference(filter, null, true), "Default Value"]
                    ].filter(function ([k]) k != null && k.length < 200);
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
                            [option.value, "Current value"],
                            [option.defaultValue, "Default value"]
                    ].filter(function (f) f[0] !== "" && String(f[0]).length < 200);
                    context.quote = ["", util.identity, ""];
                });
            }

            let optcontext = context.fork("values");
            completion.optionValue(optcontext, opt.name, opt.operator);

            // Fill in the current values if we're removing
            if (opt.operator == "-" && isArray(opt.values)) {
                let have = set([i.text for (i in context.allItems)]);
                context = context.fork("current-values", 0);
                context.anchored = optcontext.anchored;
                context.maxItems = optcontext.maxItems;

                context.filters.push(function (i) !set.has(have, i.text));
                completion.optionValue(context, opt.name, opt.operator, null,
                                       function (context) {
                                           context.generate = function () option.values.map(function (o) [o, ""]);
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
                                                               : opt.name + "=" + opt.value]
                        }
                        for (opt in options)
                        if (!opt.getter && opt.value !== opt.defaultValue && (opt.scope & Option.SCOPE_GLOBAL))
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
                    completer: function (context, args) {
                        return setCompleter(context, args);
                    },
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
                    opt.type == "boolean" || isArray(opt.values) ? opt.names.map(function (n) "inv" + n)
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
                var curValues = curValue != null ? opt.parseValues(curValue) : opt.values;
                var newValues = opt.parseValues(context.filter);
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
            case "regexlist":
                newValues = Option.splitList(context.filter);
                // Fallthrough
            case "stringlist":
                break;
            case "stringmap":
            case "regexmap":
                let vals = Option.splitList(context.filter);
                let target = vals.pop() || "";
                let [count, key, quote] = Commands.parseArg(target, /:/, true);
                let split = Option._splitAt;
                extra.key = Option.dequote(key);
                extra.value = count < target.length ? Option.dequote(target.substr(count + 1)) : null;
                extra.values = opt.parseValues(vals.join(","));
                Option._splitAt = split + (extra.value == null ? 0 : count + 1);
                break;
            }
            // TODO: Highlight when invalid
            context.advance(Option._splitAt);
            context.filter = Option.dequote(context.filter);

            context.title = ["Option Value"];
            context.quote = Commands.complQuote[Option._quote] || Commands.complQuote[""]
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

        completion.preference = function preference(context) {
            context.anchored = false;
            context.title = [config.host + " Preference", "Value"];
            context.keys = { text: function (item) item, description: function (item) options.getPref(item) };
            context.completions = options.allPrefs();
        };
    },
    javascript: function () {
        JavaScript.setCompleter(this.get, [function () ([o.name, o.description] for (o in options))]);
        JavaScript.setCompleter([this.getPref, this.safeSetPref, this.setPref, this.resetPref, this.invertPref],
                [function (context) (context.anchored=false, options.allPrefs().map(function (pref) [pref, ""]))]);
    },
    sanitizer: function () {
        sanitizer.addItem("options", {
            description: "Options containing hostname data",
            action: function (timespan, host) {
                if (host)
                    for (let opt in values(options._options))
                        if (timespan.contains(opt.lastSet * 1000) && opt.domains)
                            try {
                                opt.values = opt.filterDomain(host, opt.values);
                            }
                            catch (e) {
                                dactyl.reportError(e);
                            }
            },
            privateEnter: function () {
                for (let opt in values(options._options))
                    if (opt.privateData && (!callable(opt.privateData) || opt.privateData(opt.values)))
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
