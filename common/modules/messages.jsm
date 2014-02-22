// Copyright (c) 2011-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("messages", {
    exports: ["Messages", "messages", "_"],
    require: ["services", "util"]
});

var Messages = Module("messages", {

    init: function init(name="messages") {
        let self = this;
        this.name = name;

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
                    "resource://dactyl-locale-local/en-US/" + this.name + ".properties"],
                   true)
             .map(services.stringBundle.createBundle)
             .filter(function (bundle) {
                 try {
                     bundle.getSimpleEnumeration();
                     return true;
                 }
                 catch (e) {
                     return false;
                 }
             })),

    iterate: function () {
        let seen = RealSet();
        for (let bundle in values(this.bundles))
            for (let { key, value } in iter(bundle.getSimpleEnumeration(), Ci.nsIPropertyElement))
                if (!seen.add(key))
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
    },

    /**
     * Exports known localizable strings to a properties file.
     *
     * @param {string|nsIFile} {file} The file to which to export
     *      the strings.
     */
    export: function export_(file) {
        let { Buffer, commands, hints, io, mappings, modes, options, sanitizer } = overlay.activeModules;
        file = io.File(file);

        function properties(base, iter_, prop="description") iter(function _properties() {
            function key(...args) [base, obj.identifier || obj.name].concat(args).join(".").replace(/[\\:=]/g, "\\$&");

            for (var obj in iter_) {
                if (!obj.hive || obj.hive.name !== "user") {
                    yield key(prop) + " = " + obj[prop];

                    if (iter_.values)
                        for (let [k, v] in isArray(obj.values) ? array.iterValues(obj.values) : iter(obj.values))
                            yield key("values", k) + " = " + v;

                    for (let opt in values(obj.options))
                        yield key("options", opt.names[0]) + " = " + opt.description;

                    if (obj.deprecated)
                        yield key("deprecated") + " = " + obj.deprecated;
                }
            }
        }()).toArray();

        file.write(
            array(commands.allHives.map(h => properties("command", h)))
                          .concat(modes.all.map(m =>
                              properties("map", values(mappings.builtin.getStack(m)
                                                               .filter(map => map.modes[0] == m)))))
                          .concat(properties("mode", values(modes.all.filter(m => !m.hidden))))
                          .concat(properties("option", options))
                          .concat(properties("hintmode", values(hints.modes), "prompt"))
                          .concat(properties("pageinfo", values(Buffer.pageInfo), "title"))
                          .concat(properties("sanitizeitem", values(sanitizer.itemMap)))
                .flatten().uniq().join("\n"));
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

                if (!hasOwnProperty(obj, "localizedProperties"))
                    obj.localizedProperties = RealSet(obj.localizedProperties);
                obj.localizedProperties.add(prop);

                obj[_prop] = this.default;
                return {
                    get: function get() {
                        let value = this[_prop];

                        function getter(key, default_) function getter() messages.get([name, key].join("."), default_);

                        if (value != null) {
                            var name = [this.constructor.className.toLowerCase(),
                                        this.identifier || this.name,
                                        prop].join(".");

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
                                    memoize(value, k, () => messages.get([name, k].join("."), v));
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
        let { JavaScript } = modules;

        JavaScript.setCompleter([this._, this.get, this.format], [
            context => messages.iterate()
        ]);

        JavaScript.setCompleter([this.export],
            [function (context, obj, args) {
                context.quote[2] = "";
                modules.completion.file(context, true);
            }]);
    }
});

var { _ } = messages;

endModule();

// catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
