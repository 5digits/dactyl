// Copyright (c) 2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2009-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

// TODO:
//   - fix Sanitize autocommand
//   - add warning for TIMESPAN_EVERYTHING?

// FIXME:
//   - finish 1.9.0 support if we're going to support sanitizing in Melodactyl

Components.utils.import("resource://dactyl/base.jsm");
defineModule("sanitizer", {
    exports: ["Range", "Sanitizer", "sanitizer"],
    require: ["services", "storage", "template", "util"]
});

let tmp = {};
services.get("subscriptLoader").loadSubScript("chrome://browser/content/sanitize.js", tmp);
tmp.Sanitizer.prototype.__proto__ = Class.prototype;

const Range = Struct("min", "max");
Range.prototype.contains = function (date)
    date == null || (this.min == null || date >= this.min) && (this.max == null || date <= this.max);
Range.prototype.__defineGetter__("isEternity", function () this.max == null && this.min == null);
Range.prototype.__defineGetter__("isSession", function () this.max == null && this.min == sanitizer.sessionStart);

const Item = Class("Item", {
    init: function (name) {
        this.name = name;
    },

    // Hack for completion:
    "0": Class.Property({ get: function () this.name }),
    "1": Class.Property({ get: function () this.description }),

    get cpdPref() (this.builtin ? "" : Item.PREFIX) + Item.BRANCH + Sanitizer.argToPref(this.name),
    get shutdownPref() (this.builtin ? "" : Item.PREFIX) + Item.SHUTDOWN_BRANCH + Sanitizer.argToPref(this.name),
    get cpd() prefs.get(this.cpdPref),
    get shutdown() prefs.get(this.shutdownPref),

    shouldSanitize: function (shutdown) (!shutdown || this.builtin || this.persistent) &&
        prefs.get(shutdown ? this.shutdownPref : this.pref)
}, {
    PREFIX: "extensions.dactyl.",
    BRANCH: "privacy.cpd.",
    SHUTDOWN_BRANCH: "privacy.clearOnShutdown."
});

const Sanitizer = Module("sanitizer", XPCOM([Ci.nsIObserver, Ci.nsISupportsWeakReference], tmp.Sanitizer), {
    sessionStart: Date.now() * 1000,

    init: function () {
        const self = this;

        util.addObserver(this);

        services.add("contentprefs", "@mozilla.org/content-pref/service;1", Ci.nsIContentPrefService);
        services.add("cookies",      "@mozilla.org/cookiemanager;1",        [Ci.nsICookieManager, Ci.nsICookieManager2,
                                                                             Ci.nsICookieService]);
        services.add("loginmanager", "@mozilla.org/login-manager;1",        Ci.nsILoginManager);
        services.add("permissions",  "@mozilla.org/permissionmanager;1",    Ci.nsIPermissionManager);

        this.itemMap = {
            __iterator__: function () {
                // For platforms without getOwnPropertyNames :(
                for (let p in properties(this))
                    if (p !== "__iterator__")
                        yield this[p]
            }
        };

        this.addItem("all", { description: "Sanitize all items", shouldSanitize: function () false });
        // Builtin items
        this.addItem("cache",       { builtin: true, description: "Cache" });
        this.addItem("downloads",   { builtin: true, description: "Download history" });
        this.addItem("formdata",    { builtin: true, description: "Saved form and search history" });
        this.addItem("history",     { builtin: true, description: "Browsing history", sessionHistory: true });
        this.addItem("offlineapps", { builtin: true, description: "Offline website data" });
        this.addItem("passwords",   { builtin: true, description: "Saved passwords" });
        this.addItem("sessions",    { builtin: true, description: "Authenticated sessions" });

        // These builtin methods don't support hosts or otherwise have
        // insufficient granularity
        this.addItem("cookies", {
            builtin: true,
            description: "Cookies",
            persistent: true,
            action: function (range, host) {
                for (let c in Sanitizer.iterCookies(host))
                    if (range.contains(c.creationTime) || timespan.isSession && c.isSession)
                        services.get("cookies").remove(c.host, c.name, c.path, false);
            },
            override: true
        });
        this.addItem("sitesettings", {
            builtin: true,
            description: "Site preferences",
            persistent: true,
            action: function (range, host) {
                if (range.isSession)
                    return;
                if (host) {
                    for (let p in Sanitizer.iterPermissions(host)) {
                        services.get("permissions").remove(util.createURI(p.host), p.type);
                        services.get("permissions").add(util.createURI(p.host), p.type, 0);
                    }
                    for (let p in iter(services.get("contentprefs").getPrefs(util.createURI(host))))
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

        function ourItems(persistent) [
            item for (item in self.itemMap)
            if (!item.builtin && (!persistent || item.persistent) && item.name !== "all")
        ];

        function prefOverlay(branch, persistent, local) update(Object.create(local), {
            before: array.toObject([
                [branch.substr(Item.PREFIX.length) + "history",
                    <preferences xmlns={XUL}>{
                      template.map(ourItems(persistent), function (item)
                        <preference type="bool" id={branch + item.name} name={branch + item.name}/>)
                    }</preferences>.*::*]
            ]),
            init: function init(win) {
                let pane = win.document.getElementById("SanitizeDialogPane");
                for (let [,pref] in iter(pane.preferences))
                    pref.updateElements();
                init.superapply(this, arguments);
            }
        });

        let (branch = Item.PREFIX + Item.SHUTDOWN_BRANCH) {
            util.overlayWindow("chrome://browser/content/preferences/sanitize.xul",
                               function (win) prefOverlay(branch, true, {
                append: {
                    SanitizeDialogPane:
                        <groupbox orient="horizontal" xmlns={XUL}>
                          <caption label={services.get("dactyl:").appName + " (see :help privacy)"}/>
                          <grid flex="1">
                            <columns><column flex="1"/><column flex="1"/></columns>
                            <rows>{
                              let (items = ourItems(true))
                                 template.map(util.range(0, Math.ceil(items.length/2)), function (i)
                                   <row xmlns={XUL}>{
                                     template.map(items.slice(i*2, i*2+2), function (item)
                                       <checkbox xmlns={XUL} label={item.description} preference={branch + item.name}/>)
                                   }</row>)
                            }</rows>
                          </grid>
                        </groupbox>
                },
            }));
        }
        let (branch = Item.PREFIX + Item.BRANCH) {
            util.overlayWindow("chrome://browser/content/sanitize.xul",
                               function (win) prefOverlay(branch, false, {
                append: {
                    itemList: <>
                        <listitem xmlns={XUL} label="See :help privacy for the following:" disabled="true" style="font-style: italic; font-weight: bold;"/>
                        {
                          template.map(ourItems(), function ([item, desc])
                            <listitem xmlns={XUL} type="checkbox"
                                      label={services.get("dactyl:").appName + " " + desc}
                                      preference={branch + item}
                                      onsyncfrompreference="return gSanitizePromptDialog.onReadGeneric();"/>)
                        }
                    </>
                },
                init: function (win) {
                    let elem =  win.document.getElementById("itemList");
                    elem.setAttribute("rows", elem.itemCount);
                    win.Sanitizer = Class("Sanitizer", win.Sanitizer, {
                        sanitize: function sanitize() {
                            self.withSavedValues(["sanitizing"], function () {
                                self.sanitizing = true;
                                sanitize.superapply(this, arguments);
                                sanitizer.sanitizeItems([item.name for (item in self.itemMap) if (item.shouldSanitize(false))],
                                                        Range.fromArray(this.range || []));
                            }, this);
                        }
                    });
                }
            }));
        }
    },

    addItem: function addItem(name, params) {
        this.itemMap[name] = update(this.itemMap[name] || Item(name),
            array([k, v] for ([k, v] in Iterator(params)) if (!callable(v))).toObject());

        let names = set([name].concat(params.contains || []).map(function (e) "clear-" + e));
        if (params.action)
            storage.addObserver("sanitizer",
                function (key, event, arg) {
                    if (event in names)
                        params.action.apply(params, arg);
                },
                Class.objectGlobal(params.action));

        if (params.privateEnter || params.privateLeave)
            storage.addObserver("private-mode",
                function (key, event, arg) {
                    let meth = params[arg ? "privateEnter" : "privateLeave"];
                    if (meth)
                        meth.call(params);
                },
                Class.objectGlobal(params.action));
    },

    observe: {
        "browser:purge-domain-data": function (subject, host) {
            storage.fireEvent("sanitize", "domain", host);
            // If we're sanitizing, our own sanitization functions will already
            // be called, and with much greater granularity. Only process this
            // event if it's triggered externally.
            if (!this.sanitizing)
                this.sanitizeItems(null, Range(), data);
        },
        "browser:purge-session-history": function (subject, data) {
            // See above.
            if (!this.sanitizing)
                this.sanitizeItems(null, Range(this.sessionStart), null, "sessionHistory");
        },
        "quit-application-granted": function (subject, data) {
            if (this.runAtShutdown && !this.sanitizeItems(null, Range(), null, "shutdown"))
                this.ranAtShutdown = true;
        },
        "private-browsing": function (subject, data) {
            if (data == "enter")
                storage.privateMode = true;
            else if (data == "exit")
                storage.privateMode = false;
            storage.fireEvent("private-mode", "change", storage.privateMode);
        }
    },

    get ranAtShutdown()    prefs.get(Item.PREFIX + "didSanitizeOnShutdown"),
    set ranAtShutdown(val) prefs.set(Item.PREFIX + "didSanitizeOnShutdown", Boolean(val)),
    get runAtShutdown()    prefs.get("privacy.sanitize.sanitizeOnShutdown"),
    set runAtShutdown(val) prefs.set("privacy.sanitize.sanitizeOnShutdown", Boolean(val)),

    sanitize: function (items, range)
        this.withSavedValues(["sanitizing"], function () {
            this.sanitizing = true;
            let errors = this.sanitizeItems(items, range, null);

            for (let itemName in values(items)) {
                try {
                    let item = this.items[Sanitizer.argToPref(itemName)];
                    if (item && !this.itemMap[itemName].override) {
                        item.range = range;
                        if ("clear" in item && item.canClear)
                            item.clear();
                    }
                }
                catch (e) {
                    errors = errors || {};
                    errors[itemName] = e;
                    util.dump("Error sanitizing " + itemName);
                    util.reportError(e);
                }
            }
            return errors;
        }),

    sanitizeItems: function (items, range, host, key)
        this.withSavedValues(["sanitizing"], function () {
            this.sanitizing = true;
            if (items == null)
                items = Object.keys(this.itemMap);

            let errors;
            for (let itemName in values(items))
                try {
                    if (!key || this.itemMap[itemName][key])
                        storage.fireEvent("sanitizer", "clear-" + itemName, [range, host]);
                }
                catch (e) {
                    errors = errors || {};
                    errors[itemName] = e;
                    util.dump("Error sanitizing " + itemName);
                    util.reportError(e);
                }
            return errors;
        })
}, {
    PERMS: {
        unset:   0,
        allow:   1,
        deny:    2,
        session: 8,
    },
    UNPERMS: Class.memoize(function () array.toObject([[v, k] for ([k, v] in Iterator(this.PERMS))])),
    COMMANDS: {
        unset:   "Unset",
        allow:   "Allowed",
        deny:    "Denied",
        session: "Allowed for the current session",
        list:    "List all cookies for domain",
        clear:   "Clear all cookies for domain",
        "clear-persistent": "Clear all persistent cookies for domain",
        "clear-session":    "Clear all session cookies for domain",
    },

    argPrefMap: {
        offlineapps:  "offlineApps",
        sitesettings: "siteSettings",
    },
    argToPref: function (arg) Sanitizer.argPrefMap[arg] || arg,
    prefToArg: function (pref) pref.replace(/.*\./, "").toLowerCase(),

    iterCookies: function iterCookies(host) {
        for (let c in iter(services.get("cookies")))
            if (c.QueryInterface(Ci.nsICookie2) && !host || util.isSubdomain(c.rawHost, host))
                yield c;
    },
    iterPermissions: function iterPermissions(host) {
        for (let p in iter(services.get("permissions")))
            if (p.QueryInterface(Ci.nsIPermission) && (!host || util.isSubdomain(p.host, host)))
                yield p;
    }
}, {
    load: function (dactyl, modules, window) {
        if (sanitizer.runAtShutdown && !sanitizer.ranAtShutdown)
            sanitizer.sanitizeItems(null, Range(), null, "shutdown");
        sanitizer.ranAtShutdown = false;
    },
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
                    items = Object.keys(sanitizer.itemDescriptions).filter(
                        function (k) modules.options.get("sanitizeitems").has(k));
                }
                else
                    dactyl.assert(modules.options.get("sanitizeitems").validator(items), "Valid items required");

                if (items.indexOf("all") >= 0)
                    items = Object.keys(sanitizer.itemDescriptions).filter(function (k) items.indexOf(k) === -1);

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


            function getPerms(host) {
                let uri = util.createURI(host);
                if (uri)
                    return Sanitizer.UNPERMS[services.get("permissions").testPermission(uri, "cookie")];
                return "unset";
            }
            function setPerms(host, perm) {
                let uri = util.createURI(host);
                services.get("permissions").remove(uri, "cookie");
                services.get("permissions").add(uri, "cookie", Sanitizer.PERMS[perm]);
            }
            commands.add(["cookies", "ck"],
                "Change cookie permissions for sites.",
                function (args) {
                    let host = args.shift();
                    let session = true;
                    if (!args.length)
                        args = modules.options["cookies"];

                    for (let [,cmd] in Iterator(args))
                        switch (cmd) {
                        case "clear":
                            for (let c in Sanitizer.iterCookies(host))
                                services.get("cookies").remove(c.host, c.name, c.path, false);
                            break;
                        case "clear-persistent":
                            session = false;
                        case "clear-session":
                            for (let c in Sanitizer.iterCookies(host))
                                if (c.isSession == session)
                                    services.get("cookies").remove(c.host, c.name, c.path, false);
                            return;

                        case "list":
                            modules.commandline.commandOutput(template.tabular(
                                ["Host", "Session", "Path", "Value"], ["padding-right: 1em", "padding-right: 1em", "padding-right: 1em"],
                                ([c.host,
                                  <span highlight={c.isSession ? "Enabled" : "Disabled"}>{c.isSession ? "session" : "persistent"}</span>,
                                  c.path,
                                  c.value]
                                  for (c in Sanitizer.iterCookies(host)))));
                            return;
                        default:
                            util.assert(cmd in Sanitizer.PERMS, "Invalid argument");
                            setPerms(host, cmd);
                        }
                }, {
                    argCount: "+",
                    completer: function (context, args) {
                        switch (args.completeArg) {
                        case 0:
                            modules.completion.visibleHosts(context);
                            context.title[1] = "Current Permissions";
                            context.keys.description = function desc(host) {
                                let count = [0, 0];
                                for (let c in Sanitizer.iterCookies(host))
                                    count[c.isSession + 0]++;
                                return <>{Sanitizer.COMMANDS[getPerms(host)]} (session: {count[1]} persistent: {count[0]})</>;
                            }
                            break;
                        case 1:
                            context.completions = Sanitizer.COMMANDS;
                            break;
                        }
                    },
                });
    },
    completion: function (dactyl, modules, window) {
        modules.completion.visibleHosts = function completeHosts(context) {
            let res = [], seen = {};
            (function rec(frame) {
                try {
                    res = res.concat(util.subdomains(frame.location.host));
                } catch (e) {}
                Array.forEach(frame.frames, rec);
            })(window.content);
            if (context.filter && !res.some(function (host) host.indexOf(context.filter) >= 0))
                res.push(context.filter);

            context.title = ["Domain"];
            context.anchored = false;
            context.compare = modules.CompletionContext.Sort.unsorted;
            context.keys = { text: util.identity, description: util.identity };
            context.completions = res.filter(function (h) !set.add(seen, h));
        };
    },
    options: function (dactyl, modules) {
        const options = modules.options;
        if (services.get("privateBrowsing"))
            options.add(["private", "pornmode"],
                "Set the 'private browsing' option",
                "boolean", false,
                {
                    initialValue: true,
                    getter: function () services.get("privateBrowsing").privateBrowsingEnabled,
                    setter: function (value) {
                        if (services.get("privateBrowsing").privateBrowsingEnabled != value)
                            services.get("privateBrowsing").privateBrowsingEnabled = value
                    },
                    persist: false
                });

        options.add(["sanitizeitems", "si"],
            "The default list of private items to sanitize",
            "stringlist", "all",
            {
                completer: function (value) sanitizer.itemMap,
                has: modules.Option.has.toggleAll,
                validator: function (values) values.length &&
                    values.every(function (val) val === "all" || set.has(sanitizer.itemMap, val))
            });

        options.add(["sanitizeshutdown", "ss"],
            "The items to sanitize automatically at shutdown",
            "stringlist", "",
            {
                initialValue: true,
                completer: function () [i for (i in sanitizer.itemMap) if (i.persistent || i.builtin)],
                getter: function () !sanitizer.runAtShutdown ? [] : [
                    item.name for (item in sanitizer.itemMap)
                    if (item.shouldSanitize(true))
                ],
                setter: function (values) {
                    if (values.length === 0)
                        sanitizer.runAtShutdown = false;
                    else {
                        sanitizer.runAtShutdown = true;
                        let have = set(values);
                        for (let item in sanitizer.itemMap)
                            prefs.set(item.shutdownPref,
                                      Boolean(set.has(have, item.name) ^ set.has(have, "all")));
                    }
                    return values;
                }
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


        options.add(["cookies", "ck"],
            "The default mode for newly added cookie permissions",
            "stringlist", "session",
            { completer: function (context) iter(Sanitizer.COMMANDS) });
        options.add(["cookieaccept", "ca"],
            "When to accept cookies",
            "string", "all",
            {
                PREF: "network.cookie.cookieBehavior",
                completer: function (context) [
                    ["all", "Accept all cookies"],
                    ["samesite", "Accept all non-third-party cookies"],
                    ["none", "Accept no cookies"]
                ],
                getter: function () (this.completer()[prefs.get(this.PREF)] || ["all"])[0],
                setter: function (val) {
                    prefs.set(this.PREF, this.completer().map(function (i) i[0]).indexOf(val));
                    return val;
                },
                initialValue: true,
                persist: false
            });
        options.add(["cookielifetime", "cl"],
            "The lifetime for which to accept cookies",
            "string", "default", {
                PREF: "network.cookie.lifetimePolicy",
                PREF_DAYS: "network.cookie.lifetime.days",
                completer: function (context) [
                    ["default", "The lifetime requested by the setter"],
                    ["prompt",  "Always prompt for a lifetime"],
                    ["session", "The current session"]
                ],
                getter: function () (this.completer()[prefs.get(this.PREF)]
                        || [prefs.get(this.PREF_DAYS)])[0],
                setter: function (value) {
                    let val = this.completer().map(function (i) i[0]).indexOf(value);
                    if (val > -1)
                        prefs.set(this.PREF, val);
                    else {
                        prefs.set(this.PREF, 3);
                        prefs.set(this.PREF_DAYS, parseInt(value));
                    }
                },
                initialValue: true,
                persist: false,
                validator: function (val) parseInt(val) == val || modules.Option.validateCompleter.call(this, val)
            });
    }
});

endModule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
