// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

defineModule("prefs", {
    exports: ["Prefs", "localPrefs", "prefs"],
    require: ["services", "util"]
});

lazyRequire("messages", ["_"]);
lazyRequire("template", ["template"]);

var Prefs = Module("prefs", XPCOM([Ci.nsIObserver, Ci.nsISupportsWeakReference]), {
    ORIGINAL: "extensions.dactyl.original.",
    RESTORE: "extensions.dactyl.restore.",
    SAVED: "extensions.dactyl.saved.",
    INIT: {},

    init: function init(branch, defaults) {
        this._prefContexts = [];

        this.branch = services.pref[defaults ? "getDefaultBranch" : "getBranch"](branch || "");
        if ("nsIPrefBranch2" in Ci)
            this.branch instanceof Ci.nsIPrefBranch2;

        this.defaults = defaults ? this : this.constructor(branch, true);

        this.branches = memoize({
            __proto__: this,
            get original() this.constructor(this.ORIGINAL + this.root),
            get restore() this.constructor(this.RESTORE + this.root),
            get saved() this.constructor(this.SAVED + this.root),
        });

        if (!defaults)
            this.restore();

        this._observers = {};
    },

    cleanup: function cleanup(reason) {
        if (this.defaults != this)
            this.defaults.cleanup(reason);

        this._observers = {};
        if (this.observe) {
            this.branch.removeObserver("", this);
            this.observe.unregister();
            delete this.observe;
        }

        if (this == prefs) {
            if (~["uninstall", "disable"].indexOf(reason)) {
                for (let name in values(this.branches.saved.getNames()))
                    this.safeReset(name, null, true);

                this.branches.original.resetBranch();
                this.branches.saved.resetBranch();
            }

            if (reason == "uninstall")
                localPrefs.resetBranch();
        }
    },

    /**
     * Returns a new Prefs instance for the sub-branch *branch* of this
     * branch.
     *
     * @param {string} branch The sub-branch to branch to.
     * @returns {Prefs}
     */
    Branch: function Branch(branch) Prefs(this.root + branch),

    /**
     * Clears the entire branch.
     *
     * @param {string} name The name of the preference branch to delete.
     */
    clear: function clear(branch) {
        this.branch.deleteBranch(branch || "");
    },

    /**
     * Returns the full name of this object's preference branch.
     */
    get root() this.branch.root,

    /**
     * Returns the value of the preference *name*, or *defaultValue* if
     * the preference does not exist.
     *
     * @param {string} name The name of the preference to return.
     * @param {*} defaultValue The value to return if the preference has no value.
     * @optional
     */
    get: function get(name, defaultValue) {
        if (defaultValue == null)
            defaultValue = null;
        if (isArray(name))
            name = name.join(".");

        let type = this.branch.getPrefType(name);
        try {
            switch (type) {
            case Ci.nsIPrefBranch.PREF_STRING:
                let value = this.branch.getComplexValue(name, Ci.nsISupportsString).data;
                try {
                    if (/^[a-z0-9-]+:/i.test(value))
                    value = this.branch.getComplexValue(name, Ci.nsIPrefLocalizedString).data;
                }
                catch (e) {}
                return value;
            case Ci.nsIPrefBranch.PREF_INT:
                return this.branch.getIntPref(name);
            case Ci.nsIPrefBranch.PREF_BOOL:
                return this.branch.getBoolPref(name);
            default:
                return defaultValue;
            }
        }
        catch (e) {
            return defaultValue;
        }
    },

    getDefault: deprecated("Prefs#defaults.get", function getDefault(name, defaultValue) this.defaults.get(name, defaultValue)),

    /**
     * Returns an array of all preference names in this branch or the
     * given sub-branch.
     *
     * @param {string} branch The sub-branch for which to return preferences.
     * @optional
     */
    getNames: function getNames(branch) this.branch.getChildList(branch || "", { value: 0 }),

    /**
     * Returns true if the given preference exists in this branch.
     *
     * @param {string} name The name of the preference to check.
     */
    has: function has(name) this.branch.getPrefType(name) !== 0,

    /**
     * Returns true if the given preference is set to its default value.
     *
     * @param {string} name The name of the preference to check.
     */
    isDefault: function isDefault(name) !this.branch.prefHasUserValue(name),

    _checkSafe: function _checkSafe(name, message, value) {
        let curval = this.get(name, null);

        if (this.branches.original.get(name) == null && !this.branches.saved.has(name))
            this.branches.original.set(name, curval, true);

        if (arguments.length > 2 && curval === value)
            return;

        let defval = this.defaults.get(name, null);
        let saved  = this.branches.saved.get(name);

        if (saved == null && curval != defval || saved != null && curval != saved) {
            let msg = _("pref.safeSet.warnChanged", name);
            if (message)
                msg = template.linkifyHelp(msg + " " + message);
            util.dactyl.warn(msg);
        }
    },

    /**
     * Resets the preference *name* to *value* but warns the user if the value
     * is changed from its default.
     *
     * @param {string} name The preference name.
     * @param {value} value The new preference value.
     * @param {boolean} silent Ignore errors.
     */
    safeReset: function safeReset(name, message, silent) {
        this._checkSafe(name, message);
        this.set(name, this.branches.original.get(name), silent);
        this.branches.original.reset(name);
        this.branches.saved.reset(name);
    },

    /**
     * Sets the preference *name* to *value* but warns the user if the value is
     * changed from its default.
     *
     * @param {string} name The preference name.
     * @param {value} value The new preference value.
     */
    safeSet: function safeSet(name, value, message, skipSave) {
        this._checkSafe(name, message, value);
        this.set(name, value);
        this.branches.saved[skipSave ? "reset" : "set"](name, value);
    },

    /**
     * Sets the preference *name* to *value*. If the preference already
     * exists, it must have the same type as the given value.
     *
     * @param {name} name The name of the preference to change.
     * @param {string|number|boolean} value The value to set.
     * @param {boolean} silent Ignore errors.
     */
    set: function set(name, value, silent) {
        if (this._prefContexts.length)
            this._prefContexts[this._prefContexts.length - 1][name] = this.get(name, null);

        function assertType(needType)
            util.assert(type === Ci.nsIPrefBranch.PREF_INVALID || type === needType,
                type === Ci.nsIPrefBranch.PREF_INT
                                ? /*L*/"E521: Number required after =: " + name + "=" + value
                                : /*L*/"E474: Invalid argument: " + name + "=" + value);

        let type = this.branch.getPrefType(name);
        try {
            switch (typeof value) {
            case "string":
                assertType(Ci.nsIPrefBranch.PREF_STRING);

                this.branch.setComplexValue(name, Ci.nsISupportsString, services.String(value));
                break;
            case "number":
                assertType(Ci.nsIPrefBranch.PREF_INT);

                this.branch.setIntPref(name, value);
                break;
            case "boolean":
                assertType(Ci.nsIPrefBranch.PREF_BOOL);

                this.branch.setBoolPref(name, value);
                break;
            default:
                if (value == null && this != this.defaults)
                    this.reset(name);
                else
                    throw FailedAssertion("Unknown preference type: " + typeof value + " (" + name + "=" + value + ")");
            }
        }
        catch (e if silent) {}
        return value;
    },

    /**
     * Saves the current value of a preference to be restored at next
     * startup.
     *
     * @param {string} name The preference to save.
     */
    save: function save(name) {
        let val = this.get(name);
        this.set(this.RESTORE + name, val);
        this.safeSet(name, val);
    },

    /**
     * Restores saved preferences in the given branch.
     *
     * @param {string} branch The branch from which to restore
     *      preferences. @optional
     */
    restore: function restore(branch) {
        this.getNames(this.RESTORE + (branch || "")).forEach(function (pref) {
            this.safeSet(pref.substr(this.RESTORE.length), this.get(pref), null, true);
            this.reset(pref);
        }, this);
    },

    /**
     * Resets the preference *name* to its default value.
     *
     * @param {string} name The name of the preference to reset.
     */
    reset: function reset(name) {
        if (this.branch.prefHasUserValue(name))
            this.branch.clearUserPref(name);
    },

    /**
     * Resets the preference branch *branch* to its default value.
     *
     * @param {string} branch The preference name. @optional
     */
    resetBranch: function resetBranch(branch) {
        this.getNames(branch).forEach(this.bound.reset);
    },

    /**
     * Toggles the value of the boolean preference *name*.
     *
     * @param {string} name The preference name.
     */
    toggle: function toggle(name) {
        util.assert(this.branch.getPrefType(name) === Ci.nsIPrefBranch.PREF_BOOL,
                    _("error.trailingCharacters", name + "!"));
        this.set(name, !this.get(name));
    },

    /**
     * Pushes a new preference context onto the context stack.
     *
     * @see #withContext
     */
    pushContext: function pushContext() {
        this._prefContexts.push({});
    },

    /**
     * Pops the top preference context from the stack.
     *
     * @see #withContext
     */
    popContext: function popContext() {
        for (let [k, v] in Iterator(this._prefContexts.pop()))
            this.set(k, v);
    },

    /**
     * Executes *func* with a new preference context. When *func* returns, the
     * context is popped and any preferences set via {@link #setPref} or
     * {@link #invertPref} are restored to their previous values.
     *
     * @param {function} func The function to call.
     * @param {Object} func The 'this' object with which to call *func*
     * @see #pushContext
     * @see #popContext
     */
    withContext: function withContext(func, self) {
        try {
            this.pushContext();
            return func.call(self);
        }
        finally {
            this.popContext();
        }
    },

    observe: null,
    observers: {
        "nsPref:changed": function (subject, data) {
            let observers = this._observers[data];
            if (observers) {
                let value = this.get(data, false);
                this._observers[data] = observers.filter(function (callback) {
                    callback = callback.get();
                    if (!callback)
                        return false;
                    util.trapErrors(callback, null, value);
                    return true;
                });
            }
        }
    },

    /**
     * Adds a new preference observer for the given preference.
     *
     * @param {string} pref The preference to observe.
     * @param {function(object)} callback The callback, called with the
     *    new value of the preference whenever it changes.
     */
    watch: function watch(pref, callback, strong) {
        if (!this.observe) {
            util.addObserver(this);
            this.branch.addObserver("", this, false);
        }

        if (!this._observers[pref])
            this._observers[pref] = [];
        this._observers[pref].push(!strong ? util.weakReference(callback)
                                           : { get: function () callback });
    },

    /**
     * Lists all preferences matching *filter* or only those with changed
     * values if *onlyNonDefault* is specified.
     *
     * @param {boolean} onlyNonDefault Limit the list to prefs with a
     *     non-default value.
     * @param {string} filter The list filter. A null filter lists all
     *     prefs.
     * @optional
     */
    list: function list(onlyNonDefault, filter) {
        if (!filter)
            filter = "";

        let prefArray = this.getNames();
        prefArray.sort();
        function prefs() {
            for (let [, pref] in Iterator(prefArray)) {
                let userValue = services.pref.prefHasUserValue(pref);
                if (onlyNonDefault && !userValue || !pref.contains(filter))
                    continue;

                let value = this.get(pref);

                let option = {
                    isDefault: !userValue,
                    default:   this.defaults.get(pref, null),
                    value:     ["", "=", template.highlight(value, true, 100)],
                    name:      pref,
                    pre:       "\u00a0\u00a0" // Unicode nonbreaking space.
                };

                yield option;
            }
        };

        return template.options(_("pref.hostPreferences", config.host), prefs.call(this));
    },
}, {
}, {
    completion: function init_completion(dactyl, modules) {
        modules.completion.preference = function preference(context) {
            context.anchored = false;
            context.title = [config.host + " Preference", "Value"];
            context.keys = { text: function (item) item,
                             description: function (item) prefs.get(item) };
            context.completions = prefs.getNames();
        };
    },
    javascript: function init_javascript(dactyl, modules) {
        modules.JavaScript.setCompleter([this.get, this.safeSet, this.set, this.reset, this.toggle],
                [function (context) (context.anchored=false, this.getNames().map(pref => [pref, ""]))]);
    }
});

var localPrefs = Prefs("extensions.dactyl.");
defineModule.modules.push(localPrefs);

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
