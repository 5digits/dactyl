// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("messages", {
    exports: ["Messages", "messages", "_"],
    require: ["services", "util"]
}, this);

var Messages = Module("messages", {

    init: function init(name) {
        let self = this;
        this.name = name || "messages";

        this._ = Class("_", String, {
            init: function _(message) {
                this.args = arguments;
            },
            instance: {},
            message: Class.Memoize(function () {
                let message = this.args[0];

                if (this.args.length > 1) {
                    let args = Array.slice(this.args, 1);
                    return self.format(message + "-" + args.length, args, null) || self.format(message, args);
                }
                return self.get(message);
            }),
            valueOf: function valueOf() this.message,
            toString: function toString() this.message
        });
    },

    cleanup: function cleanup() {
        services.stringBundle.flushBundles();
    },

    bundles: Class.Memoize(function ()
        array.uniq([JSMLoader.getTarget("dactyl://locale/" + this.name + ".properties"),
                    JSMLoader.getTarget("dactyl://locale-local/" + this.name + ".properties"),
                    "resource://dactyl-locale/en-US/" + this.name + ".properties",
                    "resource://dactyl-locale-local/en-US/" + this.name + ".properties"])
             .map(services.stringBundle.createBundle)
             .filter(function (bundle) { try { bundle.getSimpleEnumeration(); return true; } catch (e) { return false; } })),

    iterate: function () {
        let seen = {};
        for (let bundle in values(this.bundles))
            for (let { key, value } in iter(bundle.getSimpleEnumeration(), Ci.nsIPropertyElement))
                if (!Set.add(seen, key))
                    yield [key, value];
    },

    get: function get(value, default_) {
        for (let bundle in values(this.bundles))
            try {
                let res = bundle.GetStringFromName(value);
                if (res.slice(0, 2) == "+ ")
                    return res.slice(2).replace(/\s+/g, " ");
                return res;
            }
            catch (e) {}

        // Report error so tests fail, but don't throw
        if (arguments.length < 2) // Do *not* localize these strings
            util.reportError(Error("Invalid locale string: " + value));
        return arguments.length > 1 ? default_ : value;
    },

    format: function format(value, args, default_) {
        for (let bundle in values(this.bundles))
            try {
                let res = bundle.formatStringFromName(value, args, args.length);
                if (res.slice(0, 2) == "+ ")
                    return res.slice(2).replace(/\s+/g, " ");
                return res;
            }
            catch (e) {}

        // Report error so tests fail, but don't throw
        if (arguments.length < 3) // Do *not* localize these strings
            util.reportError(Error("Invalid locale string: " + value));
        return arguments.length > 2 ? default_ : value;
    }

}, {
    Localized: Class("Localized", Class.Property, {
        init: function init(prop, obj) {
            let _prop = "unlocalized_" + prop;
            if (this.initialized) {
                /*
                if (config.locale === "en-US")
                    return { configurable: true, enumerable: true, value: this.default, writable: true };
                */

                if (!Set.has(obj, "localizedProperties"))
                    obj.localizedProperties = { __proto__: obj.localizedProperties };
                obj.localizedProperties[prop] = true;

                obj[_prop] = this.default;
                return {
                    get: function get() {
                        let self = this;
                        let value = this[_prop];

                        function getter(key, default_) function getter() messages.get([name, key].join("."), default_);

                        if (value != null) {
                            var name = [this.constructor.className.toLowerCase(), this.identifier || this.name, prop].join(".");
                            if (!isObject(value))
                                value = messages.get(name, value);
                            else if (isArray(value))
                                // Deprecated
                                iter(value).forEach(function ([k, v]) {
                                    if (isArray(v))
                                        memoize(v, 1, getter(v[0], v[1]));
                                    else
                                        memoize(value, k, getter(k, v));
                                });
                            else
                                iter(value).forEach(function ([k, v]) {
                                    memoize(value, k, function () messages.get([name, k].join("."), v));
                                });
                        }

                        return Class.replaceProperty(this, prop, value);
                    },

                    set: function set(val) this[_prop] = val
                };
            }
            this.default = prop;
            this.initialized = true;
        }
    })
}, {
    javascript: function initJavascript(dactyl, modules, window) {
        modules.JavaScript.setCompleter([this._, this.get, this.format], [
            function (context) messages.iterate()
        ]);
    }
});

var { _ } = messages;

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
