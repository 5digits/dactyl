// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("prefs", {
    exports: ["Prefs", "localPrefs", "prefs"],
    require: ["services", "util"],
    use: ["config", "template"]
}, this);

var Prefs = Module("prefs", XPCOM([Ci.nsIObserver, Ci.nsISupportsWeakReference]), {
    SAVED: "extensions.dactyl.saved.",
    RESTORE: "extensions.dactyl.restore.",
    INIT: {},

    init: function (branch, defaults) {
        this._prefContexts = [];

        this.branch = services.pref[defaults ? "getDefaultBranch" : "getBranch"](branch || "");
        if (this.branch instanceof Ci.nsIPrefBranch2)
            this.branch.QueryInterface(Ci.nsIPrefBranch2);

        this.defaults = defaults ? this : this.constructor(branch, true);

        if (!defaults)
            this.restore();

        this._observers = {};
    },

    cleanup: function cleanup() {
        if (this.defaults != this)
            this.defaults.cleanup();
        this._observers = {};
        if (this.observe) {
            this.branch.removeObserver("", this);
            this.observe.unregister();
            delete this.observe;
        }
    },

    observe: null,
    observers: {
        "nsPref:changed": function (subject, data) {
            let observers = this._observers[data];
            if (observers) {
                let value = this.get(data, false);
                this._observers[data] = observers.filter(function (callback) {
                    if (!callback.get())
                        return false;
                    util.trapErrors(callback.get(), null, value);
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
    watch: function (pref, callback, strong) {
        if (!this.observe) {
            util.addObserver(this);
            this.branch.addObserver("", this, false);
        }

        if (!this._observers[pref])
            this._observers[pref] = [];
        this._observers[pref].push(!strong ? Cu.getWeakReference(callback) : { get: function () callback });
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
                if (onlyNonDefault && !userValue || pref.indexOf(filter) == -1)
                    continue;

                let value = this.get(pref);

                let option = {
                    isDefault: !userValue,
                    default:   this.defaults.get(pref, null),
                    value:     <>={template.highlight(value, true, 100)}</>,
                    name:      pref,
                    pre:       "\u00a0\u00a0" // Unicode nonbreaking space.
                };

                yield option;
            }
        };

        return template.options(config.host + " Preferences", prefs.call(this));
    },

    /**
     * Returns the value of a preference.
     *
     * @param {string} name The preference name.
     * @param {value} defaultValue The value to return if the preference
     *     is unset.
     */
    get: function get(name, defaultValue) {
        if (defaultValue == null)
            defaultValue = null;

        let type = this.branch.getPrefType(name);
        try {
            switch (type) {
            case Ci.nsIPrefBranch.PREF_STRING:
                let value = this.branch.getComplexValue(name, Ci.nsISupportsString).data;
                // try in case it's a localized string (will throw an exception if not)
                if (!this.branch.prefIsLocked(name) && !this.branch.prefHasUserValue(name) &&
                    RegExp("chrome://.+/locale/.+\\.properties").test(value))
                        value = this.branch.getComplexValue(name, Ci.nsIPrefLocalizedString).data;
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
     * Returns the names of all preferences.
     *
     * @param {string} branch The branch in which to search preferences.
     *     @default ""
     */
    getNames: function (branch) this.branch.getChildList(branch || "", { value: 0 }),

    _checkSafe: function (name, message, value) {
        let curval = this.get(name, null);
        if (arguments.length > 2 && curval === value)
            return;
        let defval = this.defaults.get(name, null);
        let saved  = this.get(this.SAVED + name);

        if (saved == null && curval != defval || saved != null && curval != saved) {
            let msg = "Warning: setting preference " + name + ", but it's changed from its default value.";
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
     */
    safeReset: function (name, message) {
        this._checkSafe(name, message);
        this.reset(name);
        this.reset(this.SAVED + name);
    },

    /**
     * Sets the preference *name* to *value* but warns the user if the value is
     * changed from its default.
     *
     * @param {string} name The preference name.
     * @param {value} value The new preference value.
     */
    safeSet: function (name, value, message, skipSave) {
        this._checkSafe(name, message, value);
        this.set(name, value);
        this[skipSave ? "reset" : "set"](this.SAVED + name, value);
    },

    /**
     * Sets the preference *name* to *value*.
     *
     * @param {string} name The preference name.
     * @param {value} value The new preference value.
     */
    set: function (name, value) {
        if (this._prefContexts.length) {
            let val = this.get(name, null);
            if (val != null)
                this._prefContexts[this._prefContexts.length - 1][name] = val;
        }

        function assertType(needType)
            util.assert(type === Ci.nsIPrefBranch.PREF_INVALID || type === needType,
                type === Ci.nsIPrefBranch.PREF_INT
                                ? "E521: Number required after =: " + name + "=" + value
                                : "E474: Invalid argument: " + name + "=" + value);

        let type = this.branch.getPrefType(name);
        switch (typeof value) {
        case "string":
            assertType(Ci.nsIPrefBranch.PREF_STRING);

            let supportString = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
            supportString.data = value;
            this.branch.setComplexValue(name, Ci.nsISupportsString, supportString);
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
            throw FailedAssertion("Unknown preference type: " + typeof value + " (" + name + "=" + value + ")");
        }
    },

    /**
     * Saves the current value of a preference to be restored at next
     * startup.
     *
     * @param {string} name The preference to save.
     */
    save: function (name) {
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
    restore: function (branch) {
        this.getNames(this.RESTORE + (branch || "")).forEach(function (pref) {
            this.safeSet(pref.substr(this.RESTORE.length), this.get(pref), null, true);
            this.reset(pref);
        }, this);
    },

    /**
     * Resets the preference *name* to its default value.
     *
     * @param {string} name The preference name.
     */
    reset: function (name) {
        try {
            this.branch.clearUserPref(name);
        }
        catch (e) {} // ignore - thrown if not a user set value
    },

    /**
     * Toggles the value of the boolean preference *name*.
     *
     * @param {string} name The preference name.
     */
    toggle: function (name) {
        util.assert(this.branch.getPrefType(name) === Ci.nsIPrefBranch.PREF_BOOL,
                    "E488: Trailing characters: " + name + "!");
        this.set(name, !this.get(name));
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
    withContext: function (func, self) {
        try {
            this.pushContext();
            return func.call(self);
        }
        finally {
            this.popContext();
        }
    }
}, {
}, {
    completion: function (dactyl, modules) {
        modules.completion.preference = function preference(context) {
            context.anchored = false;
            context.title = [config.host + " Preference", "Value"];
            context.keys = { text: function (item) item, description: function (item) prefs.get(item) };
            context.completions = prefs.getNames();
        };
    },
    javascript: function (dactyl, modules) {
        modules.JavaScript.setCompleter([this.get, this.safeSet, this.set, this.reset, this.toggle],
                [function (context) (context.anchored=false, this.getNames().map(function (pref) [pref, ""]))]);
    }
});

var localPrefs = Prefs("extensions.dactyl.");
defineModule.modules.push(localPrefs);

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
