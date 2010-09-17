// Copyright (c) 2009 by Doug Kearns <dougkearns@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

// TODO:
//   - fix Sanitize autocommand
//   - add warning for TIMESPAN_EVERYTHING?
//   - respect privacy.clearOnShutdown et al or recommend Leave autocommand?
//   - integrate with the Clear Private Data dialog?

// FIXME:
//   - finish 1.9.0 support if we're going to support sanitizing in Xulmus

Components.utils.import("resource://dactyl/base.jsm");
defmodule("sanitizer", this, {
    exports: ["Range", "Sanitizer", "sanitizer"],
    require: ["services", "storage", "util"]
});

let tmp = {};
services.get("subscriptLoader").loadSubScript("chrome://browser/content/sanitize.js", tmp);

const Range = Struct("min", "max");
Range.prototype.contains = function (date)
    date == null || (this.min == null || date >= this.min) && (this.max == null || date <= this.max);
Range.prototype.__defineGetter__("isEternity", function () this.max == null && this.min == null);
Range.prototype.__defineGetter__("isSession", function () this.max == null && this.min == sanitizer.sessionStart);

const Sanitizer = Module("sanitizer", tmp.Sanitizer, {
    sessionStart: Date.now() * 1000,

    init: function () {
        services.add("contentprefs", "@mozilla.org/content-pref/service;1", Ci.nsIContentPrefService);
        services.add("cookies",      "@mozilla.org/cookiemanager;1",        [Ci.nsICookieManager, Ci.nsICookieManager2,
                                                                             Ci.nsICookieService]);
        services.add("loginmanager", "@mozilla.org/login-manager;1",        Ci.nsILoginManager);
        services.add("permissions",  "@mozilla.org/permissionmanager;1",    Ci.nsIPermissionManager);

        this.itemOverrides = {};
        this.itemDescriptions = {
            all: "Sanitize all items",
            // Builtin items
            cache: "Cache",
            downloads: "Download history",
            formdata: "Saved form and search history",
            history: "Browsing history",
            offlineapps: "Offline website data",
            passwords: "Saved passwords",
            sessions: "Authenticated sessions",
        };
        // These builtin methods don't support hosts or have
        // insufficient granularity
        this.addItem("cookies", {
            description: "Cookies",
            action: function (range, host) {
                for (let c in Sanitizer.iterCookies(host))
                    if (range.contains(c.creationTime) || timespan.isSession && c.isSession)
                        services.get("cookies").remove(c.host, c.name, c.path, false);
            },
            override: true
        });
        this.addItem("sitesettings", {
            description: "Site preferences",
            action: function (range, host) {
                if (host) {
                    for (let p in Sanitizer.iterPermissions(host)) {
                        services.get("permissions").remove(util.createURI(p.host), p.type);
                        services.get("permissions").add(util.createURI(p.host), p.type, 0);
                    }
                    for (let p in iter(services.get("contentprefs").getPrefs(util.createURI(host)).enumerator))
                        services.get("contentprefs").removePref(util.createURI(host), p.QueryInterface(Ci.nsIProperty).name);
                }
                else {
                    // "Allow this site to open popups" ...
                    services.get("permissions").removeAll();
                    // Zoom level, ...
                    services.get("contentprefs").removeGroupedPrefs();
                }
                
                // "Never remember passwords" ...
                for each (let domain in services.get("loginmanager").getAllDisabledHosts())
                    if (!host || util.isSubdomain(domain, host))
                        services.get("loginmanager").setLoginSavingEnabled(host, true);
            },
            override: true
        });
        util.addObserver(this);
    },

    QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),

    addItem: function addItem(name, params) {
        if (params.description)
            this.itemDescriptions[name] = params.description;
        if (params.override)
            set.add(this.itemOverrides, name);

        name = "clear-" + name;
        storage.addObserver("sanitizer",
            function (key, event, arg) {
                if (event == name)
                    params.action.apply(params, arg);
            }, Module.callerGlobal(params.action));

        if (params.privateEnter || params.privateLeave)
            storage.addObserver("private-mode",
                function (key, event, arg) {
                    let meth = params[arg ? "privateEnter" : "privateLeave"];
                    if (meth)
                        meth.call(params);
                }, Module.callerGlobal(params.action));
    },

    observe: {
        "browser:purge-domain-data": function (subject, data) {
            storage.fireEvent("sanitize", "domain", data);
            // If we're sanitizing, our own sanitization functions will already
            // be called, and with much greater granularity. Only process this
            // event if it's triggered externally.
            if (!this.sanitizing)
                this.sanitizeItems(null, Range(), data);
        },
        "browser:purge-session-history": function (subject, data) {
            // See above.
            if (!this.sanitizing)
                this.sanitizeItems(null, Range(this.sessionStart/1000), null);
        },
        "private-browsing": function (subject, data) {
            if (data == "enter")
                storage.privateMode = true;
            else if (data == "exit")
                storage.privateMode = false;
            storage.fireEvent("private-mode", "change", storage.privateMode);
        }
    },

    sanitize: function (items, range) {
        this.sanitizing = true;
        let errors = this.sanitizeItems(items, range, null);

        for (let itemName in values(items)) {
            try {
                let item = this.items[Sanitizer.argToPref(itemName)];
                if (item && !this.itemOverrides[itemName]) {
                    item.range = range;
                    if ("clear" in item && item.canClear)
                        item.clear();
                }
            }
            catch (e) {
                errors = errors || {};
                errors[itemName] = e;
                dump("Error sanitizing " + itemName + ": " + e + "\n" + e.stack + "\n");
            }
        }

        this.sanitizing = false;
        return errors;
    },

    sanitizeItems: function (items, range, host) {
        if (items == null)
            items = Object.keys(this.itemDescriptions);
        let errors;
        for (let itemName in values(items))
            try {
                storage.fireEvent("sanitizer", "clear-" + itemName, [range, host]);
            }
            catch (e) {
                errors = errors || {};
                errors[itemName] = e;
                dump("Error sanitizing " + itemName + ": " + e + "\n" + e.stack + "\n");
            }
        return errors;
    }
}, {
    argPrefMap: {
        commandline:  "commandLine",
        offlineapps:  "offlineApps",
        sitesettings: "siteSettings",
    },
    argToPref: function (arg) Sanitizer.argPrefMap[arg] || arg,
    prefToArg: function (pref) pref.replace(/.*\./, "").toLowerCase(),

    iterCookies: function iterCookies(host) {
        for (let c in iter(services.get("cookies").enumerator))
            if (!host || util.isSubdomain(c.QueryInterface(Ci.nsICookie2).rawHost, host))
                yield c;
    },
    iterPermissions: function iterPermissions(host) {
        for (let p in iter(services.get("permissions").enumerator))
            if (p.QueryInterface(Ci.nsIPermission) && (!host || util.isSubdomain(p.host, host)))
                yield p;
    }
}, {
    autocommands: function (dactyl, modules, window) {
        storage.addObserver("private-mode",
            function (key, event, value) {
                modules.autocommands.trigger("PrivateMode", { state: value });
            }, window);
        storage.addObserver("sanitizer",
            function (key, event, value) {
                if (event == "domain")
                    modules.autocommands.trigger("SanitizeDomain", { domain: value });
                else if (!value[1])
                    modules.autocommands.trigger("Sanitize", { name: event.substr("clear-".length), domain: value[1] });
            }, window);
    },
    commands: function (dactyl, modules, window) {
        const commands = modules.commands;
        commands.add(["sa[nitize]"],
            "Clear private data",
            function (args) {
                dactyl.assert(!modules.options['private'], "Cannot sanitize items in private mode");

                let timespan = args["-timespan"] || modules.options["sanitizetimespan"];

                let range = Range(), match = /^(\d+)([mhdw])$/.exec(timespan);
                range[args["-older"] ? "max" : "min"] =
                    match ? 1000 * (Date.now() - 1000 * parseInt(match[1], 10) * { m: 60, h: 3600, d: 3600 * 24, w: 3600 * 24 * 7 }[match[2]])
                          : (timespan[0] == "s" ? sanitizer.sessionStart : null);

                let items = args.slice();
                if (args.bang) {
                    dactyl.assert(args.length == 0, "E488: Trailing characters");
                    items = modules.options.get("sanitizeitems").values;
                }
                else
                    dactyl.assert(modules.options.get("sanitizeitems").validator(items), "Valid items required");

                if (items[0] == "all")
                    items = Object.keys(sanitizer.itemDescriptions);

                sanitizer.range = range;
                sanitizer.ignoreTimespan = range.min == null;
                sanitizer.sanitizing = true;
                if (args["-host"]) {
                    args["-host"].forEach(function (host) {
                        sanitizer.sanitizing = true;
                        if (items.indexOf("history") > -1)
                            services.get("privateBrowsing").removeDataFromDomain(host);
                        sanitizer.sanitizeItems(items, range, host)
                    });
                }
                else
                    sanitizer.sanitize(items, range);
            },
            {
                argCount: "*", // FIXME: should be + and 0
                bang: true,
                completer: function (context) {
                    context.title = ["Privacy Item", "Description"];
                    context.completions = modules.options.get("sanitizeitems").completer();
                },
                domains: function (args) args["-host"] || [],
                options: [
                    {
                        names: ["-host", "-h"],
                        description: "Only sanitize items referring to listed host or hosts",
                        completer: function (context, args) {
                            let hosts = context.filter.split(",");
                            context.advance(context.filter.length - hosts.pop().length);
                            context.filters.push(function (item)
                                !hosts.some(function (host) util.isSubdomain(item.text, host)));
                            modules.completion.domain(context);
                        },
                        type: modules.CommandOption.LIST,
                    }, {
                        names: ["-older", "-o"],
                        description: "Sanitize items older than timespan",
                        type: modules.CommandOption.NOARG
                    }, {
                        names: ["-timespan", "-t"],
                        description: "Timespan for which to sanitize items",
                        completer: function (context) modules.options.get("sanitizetimespan").completer(context),
                        type: modules.CommandOption.STRING,
                        validator: function (arg) modules.options.get("sanitizetimespan").validator(arg),
                    }
                ],
                privateData: true
            });
    },
    options: function (dactyl, modules) {
        const options = modules.options;
        if (services.get("privateBrowsing"))
            options.add(["private", "pornmode"],
                "Set the 'private browsing' option",
                "boolean", false,
                {
                    setter: function (value) services.get("privateBrowsing").privateBrowsingEnabled = value,
                    getter: function () services.get("privateBrowsing").privateBrowsingEnabled
                });

        options.add(["sanitizeitems", "si"],
            "The default list of private items to sanitize",
            "stringlist", "all",
            {
                completer: function (value) Iterator(sanitizer.itemDescriptions),
                validator: function (values) values.length &&
                    values.every(function (val) set.has(sanitizer.itemDescriptions, val)) &&
                    (values.length == 1 || !values.some(function (val) val == "all"))
            });

        options.add(["sanitizetimespan", "sts"],
            "The default sanitizer time span",
            "string", "all",
            {
                completer: function (context) {
                    context.compare = context.constructor.Sort.Unsorted;
                    return [
                        ["all",     "Everything"],
                        ["session", "The current session"],
                        ["10m",     "Last ten minutes"],
                        ["1h",      "Past hour"],
                        ["1d",      "Past day"],
                        ["1w",      "Past week"],
                    ]
                },
                validator: function (value) /^(a(ll)?|s(ession)|\d+[mhdw])$/.test(value)
            });
    }
});

endmodule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
