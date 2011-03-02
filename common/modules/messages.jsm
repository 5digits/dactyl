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
            value: Class.memoize(function () {
                let message = this.args[0];

                if (this.args.length > 1) {
                    let args = Array.slice(this.args, 1);
                    return self.format(message + "-" + args.length, args, null) || self.format(message, args);
                }
                return self.get(message);
            }),
            valueOf: function valueOf() this.value,
            toString: function toString() this.value
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
