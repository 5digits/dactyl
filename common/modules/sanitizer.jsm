// Copyright (c) 2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2009-2015 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

// TODO:
//   - fix Sanitize autocommand
//   - add warning for TIMESPAN_EVERYTHING?

// FIXME:
//   - finish 1.9.0 support if we're going to support sanitizing in Melodactyl

defineModule("sanitizer", {
    exports: ["Range", "Sanitizer", "sanitizer"],
    require: ["config", "prefs", "services", "util"]
});

lazyRequire("messages", ["_"]);
lazyRequire("overlay", ["overlay"]);
lazyRequire("storage", ["storage"]);
lazyRequire("template", ["template"]);

let tmp = Object.create(this);
JSMLoader.loadSubScript("chrome://browser/content/sanitize.js", tmp);
tmp.Sanitizer.prototype.__proto__ = Class.prototype;

var Range = Struct("min", "max");
update(Range.prototype, {
    contains: function (date) date == null ||
        (this.min == null || date >= this.min) && (this.max == null || date <= this.max),

    get isEternity() {
        return this.max == null && this.min == null;
    },
    get isSession() {
        return this.max == null && this.min == sanitizer.sessionStart;
    },

    get native() {
        return this.isEternity ? null
                               : [this.min || 0, this.max == null ? Number.MAX_VALUE
                                                                  : this.max];
    }
});

var Item = Class("SanitizeItem", {
    init: function (name, params) {
        this.name = name;
        this.description = params.description;
    },

    // Hack for completion:
    "0": Class.Property({ get: function () { return this.name; } }),
    "1": Class.Property({ get: function () { return this.description; } }),

    description: Messages.Localized(""),

    get cpdPref() {
        return (this.builtin ? "" : Item.PREFIX) + Item.BRANCH + Sanitizer.argToPref(this.name);
    },
    get shutdownPref() {
        return (this.builtin ? "" : Item.PREFIX) + Item.SHUTDOWN_BRANCH + Sanitizer.argToPref(this.name);
    },
    get cpd() { return prefs.get(this.cpdPref); },
    get shutdown() { return prefs.get(this.shutdownPref); },

    shouldSanitize: function (shutdown) {
        return (!shutdown || this.builtin || this.persistent) &&
               prefs.get(shutdown ? this.shutdownPref : this.pref);
    }
}, {
    PREFIX: config.prefs.branch.root,
    BRANCH: "privacy.cpd.",
    SHUTDOWN_BRANCH: "privacy.clearOnShutdown."
});

var Sanitizer = Module("sanitizer", XPCOM([Ci.nsIObserver, Ci.nsISupportsWeakReference], tmp.Sanitizer), {
    sessionStart: Date.now() * 1000,

    init: function () {
        const self = this;

        util.addObserver(this);

        services.add("cookies",      "@mozilla.org/cookiemanager;1",        [Ci.nsICookieManager, Ci.nsICookieManager2,
                                                                             Ci.nsICookieService]);
        services.add("loginManager", "@mozilla.org/login-manager;1",        Ci.nsILoginManager);
        services.add("permissions",  "@mozilla.org/permissionmanager;1",    Ci.nsIPermissionManager);

        this.itemMap = {};

        this.addItem("all", {
            description: "Sanitize all items",
            shouldSanitize: function () { return false; }
        });
        // Builtin items
        this.addItem("cache",       { builtin: true, description: "Cache" });
        this.addItem("downloads",   { builtin: true, description: "Download history" });
        this.addItem("formdata",    { builtin: true, description: "Saved form and search history" });
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
                for (let c of Sanitizer.iterCookies(host))
                    if (range.contains(c.creationTime) || timespan.isSession && c.isSession)
                        services.cookies.remove(c.host, c.name, c.path, false);
            },
            override: true
        });
        this.addItem("history", {
            builtin: true,
            description: "Browsing history",
            persistent: true,
            sessionHistory: true,
            action: function (range, host) {
                if (host)
                    services.history.removePagesFromHost(host, true);
                else {
                    if (range.isEternity)
                        services.history.removeAllPages();
                    else
                        services.history.removeVisitsByTimeframe(range.native[0], Math.min(Date.now() * 1000, range.native[1])); // XXX
                    services.observer.notifyObservers(null, "browser:purge-session-history", "");
                }

                if (!host || util.isDomainURL(prefs.get("general.open_location.last_url"), host))
                    prefs.reset("general.open_location.last_url");
            },
            override: true
        });
        try {
            var { ForgetAboutSite } = Cu.import("resource://gre/modules/ForgetAboutSite.jsm", {});
        }
        catch (e) {}
        if (ForgetAboutSite)
            this.addItem("host", {
                description: "All data from the given host",
                action: function (range, host) {
                    if (host)
                        ForgetAboutSite.removeDataFromDomain(host);
                }
            });
        this.addItem("sitesettings", {
            builtin: true,
            description: "Site preferences",
            persistent: true,
            action: function (range, host) {
                if (range.isSession)
                    return;
                if (host) {
                    for (let p of Sanitizer.iterPermissions(host)) {
                        services.permissions.remove(util.createURI(p.host), p.type);
                        services.permissions.add(util.createURI(p.host), p.type, 0);
                    }
                    for (let p of iter(services.contentPrefs.getPrefs(util.createURI(host))))
                        services.contentPrefs.removePref(util.createURI(host), p.QueryInterface(Ci.nsIProperty).name);
                }
                else {
                    // "Allow this site to open popups" ...
                    services.permissions.removeAll();
                    // Zoom level, ...
                    services.contentPrefs.removeAllDomains(null);
                }

                // "Never remember passwords" ...
                for (let domain of services.loginManager.getAllDisabledHosts())
                    if (!host || util.isSubdomain(domain, host))
                        services.loginManager.setLoginSavingEnabled(host, true);
            },
            override: true
        });

        function ourItems(persistent) {
            return [
                item for (item of values(self.itemMap))
                if (!item.builtin && (!persistent || item.persistent) && item.name !== "all")
            ];
        }

        function prefOverlay(branch, persistent, local) {
            return update(Object.create(local),
                          {
                before: [
                    ["preferences", { id: branch.substr(Item.PREFIX.length) + "history",
                                      xmlns: "xul" },
                      template.map(ourItems(persistent), item =>
                          ["preference", { type: "bool", id: branch + item.name, name: branch + item.name }])]
                ],
                init: function init(win) {
                    let pane = win.document.getElementById("SanitizeDialogPane");
                    for (let pref of pane.preferences)
                        pref.updateElements();
                    init.superapply(this, arguments);
                }
            });
        }

        util.timeout(function () { // Load order issue...

            {
                let branch = Item.PREFIX + Item.SHUTDOWN_BRANCH;

                overlay.overlayWindow("chrome://browser/content/preferences/sanitize.xul",
                                      win => {
                    let items = ourItems(true);

                    return prefOverlay(branch, true, {
                        append: {
                            SanitizeDialogPane:
                                ["groupbox", { orient: "horizontal", xmlns: "xul" },
                                  ["caption", { label: config.appName + /*L*/" (see :help privacy)" }],
                                  ["grid", { flex: "1" },
                                    ["columns", {},
                                        ["column", { flex: "1" }],
                                        ["column", { flex: "1" }]],
                                    ["rows", {},
                                         template.map(util.range(0, Math.ceil(items.length / 2)),
                                                      i =>
                                             ["row", {},
                                                 template.map(items.slice(i * 2, i * 2 + 2),
                                                              item =>
                                                    ["checkbox", { xmlns: XUL, label: item.description, preference: branch + item.name }])])]]]
                        }
                    });
                });
            }

            {
                let branch = Item.PREFIX + Item.BRANCH;

                overlay.overlayWindow("chrome://browser/content/sanitize.xul",
                                      function (win) {
                    return prefOverlay(branch, false, {
                        append: {
                            itemList: [
                                ["listitem", { xmlns: "xul", label: /*L*/"See :help privacy for the following:",
                                            disabled: "true", style: "font-style: italic; font-weight: bold;" }],
                                template.map(ourItems(), ([item, desc]) =>
                                    ["listitem", { xmlns: "xul", preference: branch + item,
                                                type: "checkbox", label: config.appName + ", " + desc,
                                                onsyncfrompreference: "return gSanitizePromptDialog.onReadGeneric();" }])
                            ]
                        },
                        ready: function ready(win) {
                            let elem =  win.document.getElementById("itemList");
                            elem.setAttribute("rows", elem.itemCount);
                            win.Sanitizer = Class("Sanitizer", win.Sanitizer, {
                                sanitize: function sanitize() {
                                    self.withSavedValues(["sanitizing"], function () {
                                        self.sanitizing = true;
                                        sanitize.superapply(this, arguments);
                                        sanitizer.sanitizeItems([item.name for (item of values(self.itemMap))
                                                                if (item.shouldSanitize(false))],
                                                                Range.fromArray(this.range || []));
                                    }, this);
                                }
                            });
                        }
                    });
                });
            }
        });
    },

    firstRun: 0,

    addItem: function addItem(name, params) {
        let item = this.itemMap[name] || Item(name, params);
        this.itemMap[name] = item;

        for (let [k, prop] of iterOwnProperties(params))
            if (!("value" in prop) || !callable(prop.value) && !(k in item))
                Object.defineProperty(item, k, prop);

        function getWindow(obj) {
            obj = Class.objectGlobal(obj);
            return obj.window || obj;
        }

        let names = new RealSet([name].concat(params.contains || []).map(e => "clear-" + e));
        if (params.action)
            storage.addObserver("sanitizer",
                function (key, event, arg) {
                    if (names.has(event))
                        apply(params, "action", arg);
                },
                getWindow(params.action));
    },

    observers: {
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
        }
    },

    /**
     * Returns a load context for the given thing, to be used with
     * interfaces needing one for per-window private browsing support.
     *
     * @param {Window|Document|Node} thing The thing for which to return
     *      a load context.
     */
    getContext: function getContext(thing) {
        if (!Ci.nsILoadContext)
            return null;

        if (thing instanceof Ci.nsIDOMNode && thing.ownerDocument)
            thing = thing.ownerDocument;
        if (thing instanceof Ci.nsIDOMDocument)
            thing = thing.defaultView;
        if (thing instanceof Ci.nsIInterfaceRequestor)
            thing = thing.getInterface(Ci.nsIWebNavigation);
        return thing.QueryInterface(Ci.nsILoadContext);
    },

    get ranAtShutdown() {
        return config.prefs.get("didSanitizeOnShutdown");
    },
    set ranAtShutdown(val) {
        config.prefs.set("didSanitizeOnShutdown", Boolean(val));
    },
    get runAtShutdown() {
        return prefs.get("privacy.sanitize.sanitizeOnShutdown");
    },
    set runAtShutdown(val) {
        prefs.set("privacy.sanitize.sanitizeOnShutdown", Boolean(val));
    },

    sanitize: function sanitize(items, range) {
        return this.withSavedValues(["sanitizing"], function () {
            this.sanitizing = true;
            let errors = this.sanitizeItems(items, range, null);

            for (let itemName of values(items)) {
                try {
                    let item = this.items[Sanitizer.argToPref(itemName)];
                    if (item && !this.itemMap[itemName].override) {
                        item.range = range.native;
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
        });
    },

    sanitizeItems: function sanitizeItems(items, range, host, key) {
        return this.withSavedValues(["sanitizing"], function () {
            this.sanitizing = true;
            if (items == null)
                items = Object.keys(this.itemMap);

            let errors;
            for (let itemName of values(items))
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
        });
    }
}, {
    PERMS: {
        unset:   0,
        allow:   1,
        deny:    2,
        session: 8
    },

    UNPERMS: Class.Memoize(function () {
        return iter(this.PERMS).map(Array.reverse).toObject();
    }),

    COMMANDS: {
        "unset":   /*L*/"Unset",
        "allow":   /*L*/"Allowed",
        "deny":    /*L*/"Denied",
        "session": /*L*/"Allowed for the current session",
        "list":    /*L*/"List all cookies for domain",
        "clear":   /*L*/"Clear all cookies for domain",
        "clear-persistent": /*L*/"Clear all persistent cookies for domain",
        "clear-session":    /*L*/"Clear all session cookies for domain"
    },

    argPrefMap: {
        offlineapps:  "offlineApps",
        sitesettings: "siteSettings"
    },
    argToPref: function (arg) {
        return Sanitizer.argPrefMap[arg] || arg;
    },
    prefToArg: function (pref) {
        return pref.replace(/.*\./, "").toLowerCase();
    },

    iterCookies: function* iterCookies(host) {
        for (let c of iter(services.cookies, Ci.nsICookie2))
            if (!host || util.isSubdomain(c.rawHost, host) ||
                    c.host[0] == "." && c.host.length < host.length
                        && host.endsWith(c.host))
                yield c;

    },
    iterPermissions: function* iterPermissions(host) {
        for (let p of iter(services.permissions, Ci.nsIPermission))
            if (!host || util.isSubdomain(p.host, host))
                yield p;
    }
}, {
    load: function initLoad(dactyl, modules, window) {
        if (!sanitizer.firstRun++ && sanitizer.runAtShutdown && !sanitizer.ranAtShutdown)
            sanitizer.sanitizeItems(null, Range(), null, "shutdown");
        sanitizer.ranAtShutdown = false;
    },
    autocommands: function initAutocommands(dactyl, modules, window) {
        const { autocommands } = modules;

        storage.addObserver("sanitizer",
            function (key, event, value) {
                if (event == "domain")
                    autocommands.trigger("SanitizeDomain", { domain: value });
                else if (!value[1])
                    autocommands.trigger("Sanitize", { name: event.substr("clear-".length), domain: value[1] });
            }, window);
    },
    commands: function initCommands(dactyl, modules, window) {
        const { commands } = modules;
        commands.add(["sa[nitize]"],
            "Clear private data",
            function (args) {
                if (args["-host"] && !args.length && !args.bang)
                    args[0] = "all";

                let timespan = args["-timespan"] || modules.options["sanitizetimespan"];

                let range = Range();
                let [match, num, unit] = /^(\d+)([mhdw])$/.exec(timespan) || [];
                range[args["-older"] ? "max" : "min"] =
                    match ? 1000 * (Date.now() - 1000 * parseInt(num, 10) * { m: 60, h: 3600, d: 3600 * 24, w: 3600 * 24 * 7 }[unit])
                          : (timespan[0] == "s" ? sanitizer.sessionStart : null);

                let opt = modules.options.get("sanitizeitems");
                if (args.bang)
                    dactyl.assert(args.length == 0, _("error.trailingCharacters"));
                else {
                    dactyl.assert(args.length, _("error.argumentRequired"));
                    dactyl.assert(opt.validator(args), _("error.invalidArgument"));
                    opt = { __proto__: opt, value: args.slice() };
                }

                let items = Object.keys(sanitizer.itemMap)
                                  .slice(1)
                                  .filter(opt.has, opt);

                function sanitize(items) {
                    sanitizer.range = range.native;
                    sanitizer.ignoreTimespan = range.min == null;
                    sanitizer.sanitizing = true;
                    if (args["-host"]) {
                        args["-host"].forEach(function (host) {
                            sanitizer.sanitizing = true;
                            sanitizer.sanitizeItems(items, range, host);
                        });
                    }
                    else
                        sanitizer.sanitize(items, range);
                }

                if ("all" == opt.value.find(i => (i == "all" ||
                                                  /^!/.test(i)))
                    && !args["-host"])

                    modules.commandline.input(_("sanitize.prompt.deleteAll") + " ",
                        resp => {
                            if (resp.match(/^y(es)?$/i)) {
                                sanitize(items);
                                dactyl.echomsg(_("command.sanitize.allDeleted"));
                            }
                            else
                                dactyl.echo(_("command.sanitize.noneDeleted"));
                        });
                else
                    sanitize(items);

            }, {
                argCount: "*", // FIXME: should be + and 0
                bang: true,
                completer: function (context) {
                    context.title = ["Privacy Item", "Description"];
                    context.completions = modules.options.get("sanitizeitems").values;
                },
                domains: function (args) { return args["-host"] || []; },
                options: [
                    {
                        names: ["-host", "-h"],
                        description: "Only sanitize items referring to listed host or hosts",
                        completer: function (context, args) {
                            context.filters.push(item =>
                                !args["-host"].some(host => util.isSubdomain(item.text, host)));
                            modules.completion.domain(context);
                        },
                        type: modules.CommandOption.LIST
                    }, {
                        names: ["-older", "-o"],
                        description: "Sanitize items older than timespan",
                        type: modules.CommandOption.NOARG
                    }, {
                        names: ["-timespan", "-t"],
                        description: "Timespan for which to sanitize items",
                        completer: function (context) {
                            modules.options.get("sanitizetimespan").completer(context);
                        },
                        type: modules.CommandOption.STRING,
                        validator: function (arg) {
                            return modules.options.get("sanitizetimespan").validator(arg);
                        }
                    }
                ],
                privateData: true
            });

            function getPerms(host) {
                let uri = util.createURI(host);
                if (uri)
                    return Sanitizer.UNPERMS[services.permissions.testPermission(uri, "cookie")];
                return "unset";
            }
            function setPerms(host, perm) {
                let uri = util.createURI(host);
                services.permissions.remove(uri.host, "cookie");
                services.permissions.add(uri, "cookie", Sanitizer.PERMS[perm]);
            }
            commands.add(["cookies", "ck"],
                "Change cookie permissions for sites",
                function (args) {
                    let host = args.shift();
                    let session = true;
                    if (!args.length)
                        args = modules.options["cookies"];

                    for (let cmd of args)
                        switch (cmd) {
                        case "clear":
                            for (let c of Sanitizer.iterCookies(host))
                                services.cookies.remove(c.host, c.name, c.path, false);
                            break;
                        case "clear-persistent":
                            session = false;
                        case "clear-session":
                            for (let c of Sanitizer.iterCookies(host))
                                if (c.isSession == session)
                                    services.cookies.remove(c.host, c.name, c.path, false);
                            return;

                        case "list":
                            modules.commandline.commandOutput(template.tabular(
                                ["Host", "Expiry (UTC)", "Path", "Name", "Value"],
                                ["padding-right: 1em", "padding-right: 1em", "padding-right: 1em", "max-width: 12em; overflow: hidden;", "padding-left: 1ex;"],
                                ([c.host,
                                  c.isSession ? ["span", { highlight: "Enabled" }, "session"]
                                              : (new Date(c.expiry * 1000).toJSON() || "Never").replace(/:\d\d\.000Z/, "").replace("T", " ").replace(/-/g, "/"),
                                  c.path,
                                  c.name,
                                  c.value]
                                  for (c of Sanitizer.iterCookies(host)))));
                            return;
                        default:
                            util.assert(cmd in Sanitizer.PERMS, _("error.invalidArgument"));
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
                                for (let c of Sanitizer.iterCookies(host))
                                    count[c.isSession + 0]++;
                                return [Sanitizer.COMMANDS[getPerms(host)], " (session: ", count[1], " persistent: ", count[0], ")"].join("");
                            };
                            break;
                        case 1:
                            context.completions = Sanitizer.COMMANDS;
                            break;
                        }
                    }
                });
    },
    completion: function initCompletion(dactyl, modules, window) {
        modules.completion.visibleHosts = function completeHosts(context) {
            let res = util.visibleHosts(window.content);
            if (context.filter && !res.some(host => host.contains(context.filter)))
                res.push(context.filter);

            context.title = ["Domain"];
            context.anchored = false;
            context.compare = modules.CompletionContext.Sort.unsorted;
            context.keys = { text: identity, description: identity };
            context.completions = res;
        };
    },
    options: function initOptions(dactyl, modules) {
        const options = modules.options;

        options.add(["sanitizeitems", "si"],
            "The default list of private items to sanitize",
            "stringlist", "all",
            {
                get values() { return values(sanitizer.itemMap).toArray(); },

                completer: function completer(context, extra) {
                    if (context.filter[0] == "!")
                        context.advance(1);
                    return completer.superapply(this, arguments);
                },

                has: function has(val) {
                    let res = this.value.find(v => (v == "all" || v.replace(/^!/, "") == val));

                    return res && !/^!/.test(res);
                },

                validator: function (values) {
                    return values.length &&
                           values.every(val => (val === "all" || hasOwnProperty(sanitizer.itemMap, val.replace(/^!/, ""))));
                }
            });

        options.add(["sanitizeshutdown", "ss"],
            "The items to sanitize automatically at shutdown",
            "stringlist", "",
            {
                initialValue: true,
                get values() {
                    return [i
                            for (i of values(sanitizer.itemMap))
                            if (i.persistent || i.builtin)];
                },
                getter: function () {
                    if (!sanitizer.runAtShutdown)
                        return [];
                    else
                        return [item.name
                               for (item of values(sanitizer.itemMap))
                               if (item.shouldSanitize(true))];
                },
                setter: function (value) {
                    if (value.length === 0)
                        sanitizer.runAtShutdown = false;
                    else {
                        sanitizer.runAtShutdown = true;
                        let have = new RealSet(value);
                        for (let item of values(sanitizer.itemMap))
                            prefs.set(item.shutdownPref,
                                      Boolean(have.has(item.name) ^ have.has("all")));
                    }
                    return value;
                }
            });

        options.add(["sanitizetimespan", "sts"],
            "The default sanitizer time span",
            "string", "all",
            {
                completer: function (context) {
                    context.compare = context.constructor.Sort.Unsorted;
                    context.completions = this.values;
                },
                values: {
                    "all":     "Everything",
                    "session": "The current session",
                    "10m":     "Last ten minutes",
                    "1h":      "Past hour",
                    "1d":      "Past day",
                    "1w":      "Past week"
                },
                validator: bind("test", /^(a(ll)?|s(ession)|\d+[mhdw])$/)
            });

        options.add(["cookies", "ck"],
            "The default mode for newly added cookie permissions",
            "stringlist", "session",
            { get values() { return Sanitizer.COMMANDS; }});

        options.add(["cookieaccept", "ca"],
            "When to accept cookies",
            "string", "all",
            {
                PREF: "network.cookie.cookieBehavior",
                values: [
                    ["all", "Accept all cookies"],
                    ["samesite", "Accept all non-third-party cookies"],
                    ["none", "Accept no cookies"],
                    ["visited", "Accept cookies from visited sites"]
                ],
                getter: function () {
                    return (this.values[prefs.get(this.PREF)] || ["all"])[0];
                },
                setter: function (val) {
                    prefs.set(this.PREF, this.values.map(i => i[0]).indexOf(val));
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
                values: [
                    ["default", "The lifetime requested by the setter"],
                    ["prompt",  "Always prompt for a lifetime"],
                    ["session", "The current session"]
                ],
                getter: function () {
                    return (this.values[prefs.get(this.PREF)] || [prefs.get(this.PREF_DAYS)])[0];
                },
                setter: function (value) {
                    let val = this.values.map(i => i[0]).indexOf(value);
                    if (val > -1)
                        prefs.set(this.PREF, val);
                    else {
                        prefs.set(this.PREF, 3);
                        prefs.set(this.PREF_DAYS, parseInt(value));
                    }
                },
                initialValue: true,
                persist: false,
                validator: function validator(val) {
                    return parseInt(val) == val ||
                           validator.superapply(this, arguments);
                }
            });
    }
});

endModule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
