// Copyright (c) 2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2009-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

// TODO:
//   - fix Sanitize autocommand
//   - add warning for TIMESPAN_EVERYTHING?

// FIXME:
//   - finish 1.9.0 support if we're going to support sanitizing in Melodactyl

try {

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("sanitizer", {
    exports: ["Range", "Sanitizer", "sanitizer"],
    require: ["prefs", "services", "storage", "template", "util"]
}, this);

let tmp = {};
JSMLoader.loadSubScript("chrome://browser/content/sanitize.js", tmp);
tmp.Sanitizer.prototype.__proto__ = Class.prototype;

var Range = Struct("min", "max");
update(Range.prototype, {
    contains: function (date) date == null ||
        (this.min == null || date >= this.min) && (this.max == null || date <= this.max),

    get isEternity() this.max == null && this.min == null,
    get isSession() this.max == null && this.min == sanitizer.sessionStart,

    get native() this.isEternity ? null : [range.min || 0, range.max == null ? Number.MAX_VALUE : range.max]
});

var Item = Class("Item", {
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
    PREFIX: localPrefs.branch.root,
    BRANCH: "privacy.cpd.",
    SHUTDOWN_BRANCH: "privacy.clearOnShutdown."
});

var Sanitizer = Module("sanitizer", XPCOM([Ci.nsIObserver, Ci.nsISupportsWeakReference], tmp.Sanitizer), {
    sessionStart: Date.now() * 1000,

    init: function () {
        const self = this;

        util.addObserver(this);

        services.add("contentprefs", "@mozilla.org/content-pref/service;1", Ci.nsIContentPrefService);
        services.add("cookies",      "@mozilla.org/cookiemanager;1",        [Ci.nsICookieManager, Ci.nsICookieManager2,
                                                                             Ci.nsICookieService]);
        services.add("loginmanager", "@mozilla.org/login-manager;1",        Ci.nsILoginManager);
        services.add("permissions",  "@mozilla.org/permissionmanager;1",    Ci.nsIPermissionManager);

        this.itemMap = {};

        this.addItem("all", { description: "Sanitize all items", shouldSanitize: function () false });
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
                for (let c in Sanitizer.iterCookies(host))
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
                else
                    services.history.removeVisitsByTimeframe(this.range.min, this.range.max);

                if (!host)
                    services.observer.notifyObservers(null, "browser:purge-session-history", "");

                if (!host || util.isDomainURL(prefs.get("general.open_location.last_url"), host))
                    prefs.reset("general.open_location.last_url");
            },
            override: true
        });
        this.addItem("host", {
            description: "All data from the given host",
            action: function (range, host) {
                if (host)
                    services.privateBrowsing.removeDataFromDomain(host);
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
                    for (let p in Sanitizer.iterPermissions(host)) {
                        services.permissions.remove(util.createURI(p.host), p.type);
                        services.permissions.add(util.createURI(p.host), p.type, 0);
                    }
                    for (let p in iter(services.contentprefs.getPrefs(util.createURI(host))))
                        services.contentprefs.removePref(util.createURI(host), p.QueryInterface(Ci.nsIProperty).name);
                }
                else {
                    // "Allow this site to open popups" ...
                    services.permissions.removeAll();
                    // Zoom level, ...
                    services.contentprefs.removeGroupedPrefs();
                }

                // "Never remember passwords" ...
                for each (let domain in services.loginmanager.getAllDisabledHosts())
                    if (!host || util.isSubdomain(domain, host))
                        services.loginmanager.setLoginSavingEnabled(host, true);
            },
            override: true
        });

        function ourItems(persistent) [
            item for (item in values(self.itemMap))
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
                for (let [, pref] in iter(pane.preferences))
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
                          <caption label={config.appName + " (see :help privacy)"}/>
                          <grid flex="1">
                            <columns><column flex="1"/><column flex="1"/></columns>
                            <rows>{
                              let (items = ourItems(true))
                                 template.map(util.range(0, Math.ceil(items.length / 2)), function (i)
                                   <row xmlns={XUL}>{
                                     template.map(items.slice(i * 2, i * 2 + 2), function (item)
                                       <checkbox xmlns={XUL} label={item.description} preference={branch + item.name}/>)
                                   }</row>)
                            }</rows>
                          </grid>
                        </groupbox>
                }
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
                                      label={config.appName + " " + desc}
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
                                sanitizer.sanitizeItems([item.name for (item in values(self.itemMap))
                                                         if (item.shouldSanitize(false))],
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
            iter.toObject([k, v]
                          for ([k, v] in Iterator(params))
                          if (!callable(v))));

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
        },
        "private-browsing": function (subject, data) {
            if (data == "enter")
                storage.privateMode = true;
            else if (data == "exit")
                storage.privateMode = false;
            storage.fireEvent("private-mode", "change", storage.privateMode);
        }
    },

    get ranAtShutdown()    localPrefs.get("didSanitizeOnShutdown"),
    set ranAtShutdown(val) localPrefs.set("didSanitizeOnShutdown", Boolean(val)),
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
        session: 8
    },
    UNPERMS: Class.memoize(function () iter(this.PERMS).map(Array.reverse).toObject()),
    COMMANDS: {
        unset:   "Unset",
        allow:   "Allowed",
        deny:    "Denied",
        session: "Allowed for the current session",
        list:    "List all cookies for domain",
        clear:   "Clear all cookies for domain",
        "clear-persistent": "Clear all persistent cookies for domain",
        "clear-session":    "Clear all session cookies for domain"
    },

    argPrefMap: {
        offlineapps:  "offlineApps",
        sitesettings: "siteSettings"
    },
    argToPref: function (arg) Sanitizer.argPrefMap[arg] || arg,
    prefToArg: function (pref) pref.replace(/.*\./, "").toLowerCase(),

    iterCookies: function iterCookies(host) {
        let iterator = host ? services.cookies.getCookiesFromHost(host)
                            : services.cookies;
        for (let c in iter(iterator))
            yield c.QueryInterface(Ci.nsICookie2);
    },
    iterPermissions: function iterPermissions(host) {
        for (let p in iter(services.permissions)) {
            p.QueryInterface(Ci.nsIPermission);
            if (!host || util.isSubdomain(p.host, host))
                yield p;
        }
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

                let range = Range();
                let [match, num, unit] = /^(\d+)([mhdw])$/.exec(timespan) || [];
                range[args["-older"] ? "max" : "min"] =
                    match ? 1000 * (Date.now() - 1000 * parseInt(num, 10) * { m: 60, h: 3600, d: 3600 * 24, w: 3600 * 24 * 7 }[unit])
                          : (timespan[0] == "s" ? sanitizer.sessionStart : null);

                let items = args.slice();
                if (args["-host"] && !args.length)
                    args[0] = "all";

                if (args.bang) {
                    dactyl.assert(args.length == 0, "E488: Trailing characters");
                    items = Object.keys(sanitizer.itemMap).filter(
                        function (k) modules.options.get("sanitizeitems").has(k));
                }
                else
                    dactyl.assert(modules.options.get("sanitizeitems").validator(items), "Valid items required");

                if (items.indexOf("all") >= 0)
                    items = Object.keys(sanitizer.itemMap).filter(function (k) items.indexOf(k) === -1);

                sanitizer.range = range.native;
                sanitizer.ignoreTimespan = range.min == null;
                sanitizer.sanitizing = true;
                if (args["-host"]) {
                    args["-host"].forEach(function (host) {
                        sanitizer.sanitizing = true;
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
                    context.completions = modules.options.get("sanitizeitems").values;
                },
                domains: function (args) args["-host"] || [],
                options: [
                    {
                        names: ["-host", "-h"],
                        description: "Only sanitize items referring to listed host or hosts",
                        completer: function (context, args) {
                            context.filters.push(function (item)
                                !args["-host"].some(function (host) util.isSubdomain(item.text, host)));
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
                    return Sanitizer.UNPERMS[services.permissions.testPermission(uri, "cookie")];
                return "unset";
            }
            function setPerms(host, perm) {
                let uri = util.createURI(host);
                services.permissions.remove(uri, "cookie");
                services.permissions.add(uri, "cookie", Sanitizer.PERMS[perm]);
            }
            commands.add(["cookies", "ck"],
                "Change cookie permissions for sites",
                function (args) {
                    let host = args.shift();
                    let session = true;
                    if (!args.length)
                        args = modules.options["cookies"];

                    for (let [, cmd] in Iterator(args))
                        switch (cmd) {
                        case "clear":
                            for (let c in Sanitizer.iterCookies(host))
                                services.cookies.remove(c.host, c.name, c.path, false);
                            break;
                        case "clear-persistent":
                            session = false;
                        case "clear-session":
                            for (let c in Sanitizer.iterCookies(host))
                                if (c.isSession == session)
                                    services.cookies.remove(c.host, c.name, c.path, false);
                            return;

                        case "list":
                            modules.commandline.commandOutput(template.tabular(
                                ["Host", "Expiry (UTC)", "Path", "Name", "Value"],
                                ["padding-right: 1em", "padding-right: 1em", "padding-right: 1em", "max-width: 12em; overflow: hidden;", "padding-left: 1ex;"],
                                ([c.host,
                                  c.isSession ? <span highlight="Enabled">session</span>
                                              : (new Date(c.expiry * 1000).toJSON() || "Never").replace(/:\d\d\.000Z/, "").replace("T", " ").replace(/-/g, "/"),
                                  c.path,
                                  c.name,
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
                            };
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
            let res = util.visibleHosts(window.content);
            if (context.filter && !res.some(function (host) host.indexOf(context.filter) >= 0))
                res.push(context.filter);

            context.title = ["Domain"];
            context.anchored = false;
            context.compare = modules.CompletionContext.Sort.unsorted;
            context.keys = { text: util.identity, description: util.identity };
            context.completions = res;
        };
    },
    options: function (dactyl, modules) {
        const options = modules.options;
        if (services.privateBrowsing)
            options.add(["private", "pornmode"],
                "Set the 'private browsing' option",
                "boolean", false,
                {
                    initialValue: true,
                    getter: function () services.privateBrowsing.privateBrowsingEnabled,
                    setter: function (value) {
                        if (services.privateBrowsing.privateBrowsingEnabled != value)
                            services.privateBrowsing.privateBrowsingEnabled = value;
                    },
                    persist: false
                });

        options.add(["sanitizeitems", "si"],
            "The default list of private items to sanitize",
            "stringlist", "all",
            {
                get values() values(sanitizer.itemMap),
                has: modules.Option.has.toggleAll,
                validator: function (values) values.length &&
                    values.every(function (val) val === "all" || set.has(sanitizer.itemMap, val))
            });

        options.add(["sanitizeshutdown", "ss"],
            "The items to sanitize automatically at shutdown",
            "stringlist", "",
            {
                initialValue: true,
                get values() [i for (i in values(sanitizer.itemMap)) if (i.persistent || i.builtin)],
                getter: function () !sanitizer.runAtShutdown ? [] : [
                    item.name for (item in values(sanitizer.itemMap))
                    if (item.shouldSanitize(true))
                ],
                setter: function (value) {
                    if (value.length === 0)
                        sanitizer.runAtShutdown = false;
                    else {
                        sanitizer.runAtShutdown = true;
                        let have = set(value);
                        for (let item in values(sanitizer.itemMap))
                            prefs.set(item.shutdownPref,
                                      Boolean(set.has(have, item.name) ^ set.has(have, "all")));
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
                values: [
                    ["all",     "Everything"],
                    ["session", "The current session"],
                    ["10m",     "Last ten minutes"],
                    ["1h",      "Past hour"],
                    ["1d",      "Past day"],
                    ["1w",      "Past week"]
                ],
                validator: function (value) /^(a(ll)?|s(ession)|\d+[mhdw])$/.test(value)
            });

        options.add(["cookies", "ck"],
            "The default mode for newly added cookie permissions",
            "stringlist", "session",
            { get values() iter(Sanitizer.COMMANDS) });

        options.add(["cookieaccept", "ca"],
            "When to accept cookies",
            "string", "all",
            {
                PREF: "network.cookie.cookieBehavior",
                values: [
                    ["all", "Accept all cookies"],
                    ["samesite", "Accept all non-third-party cookies"],
                    ["none", "Accept no cookies"]
                ],
                getter: function () (this.values[prefs.get(this.PREF)] || ["all"])[0],
                setter: function (val) {
                    prefs.set(this.PREF, this.values.map(function (i) i[0]).indexOf(val));
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
                getter: function () (this.values[prefs.get(this.PREF)] || [prefs.get(this.PREF_DAYS)])[0],
                setter: function (value) {
                    let val = this.values.map(function (i) i[0]).indexOf(value);
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

} catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
