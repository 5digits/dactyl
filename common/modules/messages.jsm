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

// TODO: Lazy instantiation
var Messages = Module("messages", {

    init: function init() {
        let self = this;

        this.bundle = services.stringBundle.createBundle(JSMLoader.getTarget("dactyl://locale/messages.properties"));

        this._ = Class("_", String, {
            init: function _(message) {
                this.args = arguments;
            },
            message: Class.memoize(function () {
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

        let seen = {};
        for (let { key } in this.iterate()) {
            if (!set.add(seen, key))
                this._[key] = this[key] = {
                    __noSuchMethod__: function __(prop, args) self._.apply(self, [prop].concat(args))
                };
        }
    },

    iterate: function () let (bundle = this.bundle)
        iter(prop.QueryInterface(Ci.nsIPropertyElement) for (prop in iter(bundle.getSimpleEnumeration()))),

    cleanup: function cleanup() {
        services.stringBundle.flushBundles();
    },

    get: function get(value, default_) {
        try {
            return this.bundle.GetStringFromName(value);
        }
        catch (e) {
            // Report error so tests fail, but don't throw
            if (arguments.length < 2)
                util.reportError(Error("Invalid locale string: " + value + ": " + e));
            return arguments.length > 1 ? default_ : value;
        }
    },

    format: function format(value, args, default_) {
        try {
            return this.bundle.formatStringFromName(value, args, args.length);
        }
        catch (e) {
            // Report error so tests fail, but don't throw
            if (arguments.length < 3)
                util.reportError(Error("Invalid locale string: " + value + ": " + e));
            return arguments.length > 2 ? default_ : value;
        }
    }

}, {
    Localized: Class("Localized", Class.Property, {
        init: function init(prop, obj) {
            let _prop = "localized_" + prop;
            if (this.initialized) {
                /*
                if (config.locale === "en-US")
                    return { configurable: true, enumerable: true, value: null, writable: true };
                */

                obj[_prop] = this.default;
                return {
                    get: function get() {
                        let self = this;
                        let value = this[_prop];

                        function getter(key, default_) function getter() messages.get([name, key].join("."), default_);

                        let name = [this.constructor.className.toLowerCase(), this.identifier || this.name, prop].join(".");
                        if (!isObject(value))
                            value = messages.get(name, value)
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

                        return Class.replaceProperty(this, prop, value);
                    },
                    set: function set(val) this[_prop] = val
                }
            }
            this.default = prop;
            this.initialized = true;
        }
    })
}, {
    javascript: function initJavascript(dactyl, modules, window) {
        modules.JavaScript.setCompleter([this._, this.get, this.format], [
            function (context) {
                context.keys = { text: "key", description: "value" };
                return messages.iterate();
            }
        ]);
    }
});

var { _ } = messages;

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
