/*
 * Copyright ©2010-2014 Kris Maglione <maglione.k at Gmail>
 * Distributable under the terms of the MIT license.
 *
 * Documentation is at the tail of this file.
 */
"use strict";

if (!("noscriptOverlay" in window)) {
    if (!userContext.noscriptIgnoreMissing)
        dactyl.echoerr("This plugin requires the NoScript add-on.");
    throw Finished();
}

/*
 *  this.globalJS ? !this.alwaysBlockUntrustedContent || !this.untrustedSites.matches(s)
 *                : this.jsPolicySites.matches(s) && !this.untrustedSites.matches(s) && !this.isForbiddenByHttpsStatus(s));
 */

function getSites() {
    // This logic comes directly from NoScript. To my mind, it's insane.
    const ns     = services.noscript;
    const global = options["script"];
    const groups = { allowed: ns.jsPolicySites, temp: ns.tempSites, untrusted: ns.untrustedSites };
    const show   = RealSet(options["noscript-list"]);
    const sites  = window.noscriptOverlay.getSites();

    const blockUntrusted = global && ns.alwaysBlockUntrustedContent;

    let res = [];
    for (let site of array.iterValues(Array.concat(sites.topSite, sites))) {
        let ary = [];

        let untrusted    = groups.untrusted.matches(site);
        let matchingSite = null;
        if (!untrusted)
            matchingSite = groups.allowed.matches(site) || blockUntrusted && site;

        let enabled = Boolean(matchingSite);
        if (site == sites.topSite && !ns.dom.getDocShellForWindow(content).allowJavascript)
            enabled = false;

        let hasPort = /:\d+$/.test(site);

        if (enabled && !global || untrusted) {
            if (!enabled || global)
                matchingSite = untrusted;

            if (hasPort && ns.ignorePorts)
                if (site = groups.allowed.matches(site.replace(/:\d+$/, "")))
                    matchingSite = site;
            ary.push(matchingSite);
        }
        else {
            if ((!hasPort || ns.ignorePorts) && (show.has("full") || show.has("base"))) {
                let domain = !ns.isForbiddenByHttpsStatus(site) && ns.getDomain(site);
                if (domain && ns.isJSEnabled(domain) == enabled) {
                    ary = util.subdomains(domain);
                    if (!show.has("base") && ary.length > 1)
                        ary = ary.slice(1);
                    if (!show.has("full"))
                        ary = ary.slice(0, 1);
                }
            }

            if (show.has("address") || ary.length == 0) {
                ary.push(site);

                if (hasPort && ns.ignorePorts) {
                    site = site.replace(/:\d+$/, "");
                    if (!groups.allowed.matches(site))
                        ary.push(site);
                }
            }
        }
        res = res.concat(ary);
    }

    let seen = RealSet();
    return res.filter(function (h) {
        let res = !seen.has(h);
        seen.add(h);
        return res;
    });
}
function getObjects() {
    let sites = noscriptOverlay.getSites();
    let general = [], specific = [];
    for (let group of values(sites.pluginExtras))
        for (let obj of array.iterValues(group)) {
            if (!obj.placeholder && (ns.isAllowedObject(obj.url, obj.mime) || obj.tag))
                continue;
            specific.push(obj.mime + "@" + obj.url);
            general.push("*@" + obj.url);
            general.push("*@" + obj.site);
        }
    sites = buffer.allFrames().map(f => f.location.host);
    for (let filter of values(options["noscript-objects"])) {
        let host = util.getHost(util.split(filter, /@/, 2)[1]);
        if (sites.some(s => s == host))
            specific.push(filter);
    }
    let seen = RealSet();
    return specific.concat(general).filter(function (site) {
        let res = !seen.has(site);
        seen.add(site);
        return res;
    });
}

var onUnload = overlay.overlayObject(gBrowser, {
    // Extend NoScript's bookmarklet handling hack to the command-line
    // Modified from NoScript's own wrapper.
    loadURIWithFlags: function loadURIWithFlags(url) {
        let args = arguments;
        let load = () => loadURIWithFlags.superapply(gBrowser, args);

        if (!commandline.command || !util.isDactyl(Components.stack.caller))
            return load();

        try {
            for (let [cmd, args] of commands.parseCommands(commandline.command))
                var origURL = args.literalArg;

            let isJS = url => /^(?:data|javascript):/i.test(url);
            let allowJS = prefs.get("noscript.allowURLBarJS", true);

            if (isJS(origURL) && allowJS) {
                if (services.noscript.executeJSURL(origURL, load))
                    return;
            }
            else if (url != origURL && isJS(url)) {
                if(services.noscript.handleBookmark(url, load))
                    return;
            }
        }
        catch (e) {
            util.reportError(e);
        }
        return load();
    }
});

highlight.loadCSS(String.raw`
    NoScriptAllowed         color: green;
    NoScriptBlocked         color: #444; font-style: italic;
    NoScriptTemp            color: blue;
    NoScriptUntrusted       color: #c00; font-style: italic;
`);

let groupProto = {};
["temp", "jsPolicy", "untrusted"].forEach(function (group) {
    memoize(groupProto, group,
            function () {
                return services.noscript[group + "Sites"].matches(this.site);
            });
});
let groupDesc = {
    NoScriptTemp:       "Temporarily allowed",
    NoScriptAllowed:    "Allowed permanently",
    NoScriptUntrusted:  "Untrusted",
    NoScriptBlocked:    "Blocked"
};

function splitContext(context, list) {
    for (let [name, title, filter] of values(list)) {
        let ctxt = context.split(name);
        ctxt.title = [title];
        ctxt.filters.push(filter);
    }
}

completion.noscriptObjects = function (context) {
    let whitelist = options.get("noscript-objects").set;
    context = context.fork();
    context.compare = CompletionContext.Sort.unsorted;
    context.generate = getObjects;
    context.keys = {
        text: util.identity,
        description: key => whitelist.has(key) ? "Allowed" : "Forbidden"
    };
    splitContext(context, getObjects, [
        ["forbidden", "Forbidden objects", item => !whitelist.has(item.item)],
        ["allowed",   "Allowed objects",   item => whitelist.has(item.item)]]);
};
completion.noscriptSites = function (context) {
    context.compare = CompletionContext.Sort.unsorted;
    context.generate = getSites;
    context.keys = {
        text: util.identity,
        description: site => groupDesc[this.highlight] +
            (this.groups.untrusted && this.highlight != "NoScriptUntrusted" ? " (untrusted)" : ""),

        highlight: function (site) {
            return this.groups.temp      ? "NoScriptTemp" :
                   this.groups.jsPolicy  ? "NoScriptAllowed" :
                   this.groups.untrusted ? "NoScriptUntrusted" :
                                           "NoScriptBlocked";
        },
        groups: site => ({ site: site, __proto__: groupProto })
    };
    splitContext(context, [
        ["normal",    "Active sites",    item => item.groups.jsPolicy || !item.groups.untrusted],
        ["untrusted", "Untrusted sites", item => !item.groups.jsPolicy && item.groups.untrusted]]);
    context.maxItems = 100;
}

services.add("noscript", "@maone.net/noscript-service;1");

var PrefBase = "noscript.";
var Pref = Struct("text", "pref", "description");
let prefs = {
    forbid: [
        ["bookmarklet", "forbidBookmarklets", "Forbid bookmarklets"],
        ["collapse",    "collapseObject",     "Collapse forbidden objects"],
        ["flash",       "forbidFlash",        "Block Adobe® Flash® animations"],
        ["fonts",       "forbidFonts",        "Forbid remote font loading"],
        ["frame",       "forbidFrames",       "Block foreign <frame> elements"],
        ["iframe",      "forbidIFrames",      "Block foreign <iframe> elements"],
        ["java",        "forbidJava",         "Block Java™ applets"],
        ["media",       "forbidMedia",        "Block <audio> and <video> elements"],
        ["placeholder", "showPlaceholder",    "Replace forbidden objects with a placeholder"],
        ["plugins",     "forbidPlugins",      "Forbid other plugins"],
        ["refresh",     "forbidMetaRefresh",  "Block <meta> page directions"],
        ["silverlight", "forbidSilverlight",  "Block Microsoft® Silverlight™ objects"],
        ["trusted",     "contentBlocker",     "Block media and plugins even on trusted sites"],
        ["webbug",      "blockNSWB",          "Block “web bug” tracking images"],
        ["xslt",        "forbidXSLT",         "Forbid XSLT stylesheets"]
    ],
    list: [
        ["address", "showAddress",    "Show the full address (http://www.google.com)"],
        ["base",    "showBaseDomain", "Show the base domain (google.com)"],
        ["full",    "showDomain",     "Show the full domain (www.google.com)"]
    ]
};
for (let [k, v] of iter(prefs))
    prefs[k] = array(v).map(v => [v[0], Pref.fromArray(v.map(UTF8))]).toObject();

function getPref(pref)      { return modules.prefs.get(PrefBase + pref); }
function setPref(pref, val) { return modules.prefs.set(PrefBase + pref, val); }

prefs.complete = group => context => {
    context.keys = { text: "text", description: "description" };
    context.completions = values(prefs[group]);
};
prefs.get = function (group) { return [p.text for (p of values(this[group])) if (getPref(p.pref))]; };
prefs.set = function (group, val) {
    for (let p of values(this[group]))
        setPref(p.pref, val.indexOf(p.text) >= 0);
    return val;
}
prefs.descs = function prefDescs(group) {
    return ["dl", {},
        template.map(values(this[group]), pref =>
            [["dt", {}, pref.text], ["dd", {}, pref.description]])];
};

function groupParams(group) {
    return {
        getter: () => prefs.get(group),
        completer: prefs.complete(group),
        setter: val => prefs.set(group, val),
        initialValue: true,
        persist: false
    };
}
group.options.add(["noscript-forbid", "nsf"],
    "The set of permissions forbidden to untrusted sites",
    "stringlist", "",
    groupParams("forbid"));
group.options.add(["noscript-list", "nsl"],
    "The set of domains to show in the menu and completion list",
    "stringlist", "",
    groupParams("list"));

group.options.add(["script"],
    "Whether NoScript is enabled",
    "boolean", false,
    {
        getter: () => services.noscript.jsEnabled,
        setter: (val) => services.noscript.jsEnabled = val,
        initialValue: true,
        persist: false
    });

[
    {
        names: ["noscript-sites", "nss"],
        description: "The list of sites allowed to execute scripts",
        action: (add, sites) => sites.length && noscriptOverlay.safeAllow(sites, add, false, -1),
        completer: (context) => completion.noscriptSites(context),
        has: (val) => hasOwnProperty(services.noscript.jsPolicySites.sitesMap, val) &&
            !hasOwnProperty(services.noscript.tempSites.sitesMap, val),
        get set() {
            return RealSet(k for (k in services.noscript.jsPolicySites.sitesMap))
                .difference(RealSet(k for (k in services.noscript.tempSites.sitesMap)))
        }
    }, {
        names: ["noscript-tempsites", "nst"],
        description: "The list of sites temporarily allowed to execute scripts",
        action: (add, sites) => sites.length && noscriptOverlay.safeAllow(sites, add, true, -1),
        completer: (context) => completion.noscriptSites(context),
        get set() { return RealSet(k for (k in services.noscript.tempSites.sitesMap)) },
    }, {
        names: ["noscript-untrusted", "nsu"],
        description: "The list of untrusted sites",
        action: (add, sites) => sites.length && services.noscript.setUntrusted(sites, add),
        completer: (context) => completion.noscriptSites(context),
        get set() { return RealSet(k for (k in services.noscript.untrustedSites.sitesMap)) },
    }, {
        names: ["noscript-objects", "nso"],
        description: "The list of allowed objects",
        get set() { return RealSet(array.flatten(
            [Array.concat(v).map(function (v) { return v + "@" + this; }, k)
             for ([k, v] of iter(services.noscript.objectWhitelist))])) },
        action: function (add, patterns) {
            for (let pattern of values(patterns)) {
                let [mime, site] = util.split(pattern, /@/, 2);
                if (add)
                    services.noscript.allowObject(site, mime);
                else {
                    let list = services.noscript.objectWhitelist[site];
                    if (list) {
                        if (list == "*") {
                            delete services.noscript.objectWhitelist[site];
                            services.noscript.objectWhitelistLen--;
                        }
                        else {
                            let types = list.filter(type => type != mime);
                            services.noscript.objectWhitelistLen -= list.length - types.length;
                            services.noscript.objectWhitelist[site] = types;
                            if (!types.length)
                                delete services.noscript.objectWhitelist[site];
                        }
                    }
                }
            }
            if (add)
                services.noscript.reloadAllowedObjects(config.browser.selectedBrowser);
        },
        completer: context => completion.noscriptObjects(context)
    }
].forEach(function (params) {
    group.options.add(params.names, params.description,
        "stringlist", "",
        {
            completer: function (context) {
                context.anchored = false;
                if (params.completer)
                    params.completer(context)
            },
            domains: params.domains || (values => values),
            has: params.has || bind("has", params.set),
            initialValue: true,
            getter: params.getter || (() => Array.from(params.set)),
            setter: function (values) {
                let newset  = RealSet(values);
                let current = params.set;
                let value   = this.value;
                params.action(true,  values.filter(site => !current.has(site)))
                params.action(false, value.filter(site => !newset.has(site)));
                return this.value;
            },
            persist: false,
            privateData: true,
            validator: params.validator || (() => true),
        })
});

var INFO =
["plugin", { name: "noscript",
             version: "0.9",
             href: "http://dactyl.sf.net/pentadactyl/plugins#noscript-plugin",
             summary: "NoScript integration",
             xmlns: "dactyl" },
    ["author", { email: "maglione.k@gmail.com" }, "Kris Maglione"],
    ["license", { href: "http://opensource.org/licenses/mit-license.php" }, "MIT"],
    ["project", { name: "Pentadactyl", "min-version": "1.0" }],

    ["p", {},
        "This plugin provides tight integration with the NoScript add-on. ",
        "In addition to commands and options to control the behavior of ",
        "NoScript, this plugin also provides integration with both the ",
        config.appName, " and ", config.host, " sanitization systems sorely ",
        "lacking in the add-on itself. Namely, when data for a domain is ",
        "purged, all of its associated NoScript permissions are purged as ",
        "well, and temporary permissions are purged along with session ",
        "data."],

    ["note", {},
        "As most options provided by this script directly alter NoScript ",
        "preferences, which are persistent, their values are automatically ",
        "preserved across restarts."],

    ["item", {},
        ["tags", {}, "'script' 'noscript'"],
        ["strut", {}],
        ["spec", {}, "'script'"],
        ["type", {}, "boolean"],
        ["default", {}, "noscript"],
        ["description", {},
            ["p", {},
                "When on, all sites are allowed to execute scripts and ",
                "load plugins. When off, only specifically allowed sites ",
                "may do so."]]],

    ["item", {},
        ["tags", {}, "'nsf' 'noscript-forbid'"],
        ["spec", {}, "'noscript-forbid'"],
        ["type", {}, "stringlist"],
        ["default", {}, ""],
        ["description", {},
            ["p", {},
                "The set of permissions forbidden to untrusted sites."],
            prefs.descs("forbid"),
            ["p", {},
                "See also ", ["o", {}, "noscript-objects"], "."]]],

    ["item", {},
        ["tags", {}, "'nsl' 'noscript-list'"],
        ["spec", {}, "'noscript-list'"],
        ["type", {}, "stringlist"],
        ["default", {}, ""],
        ["description", {},
            ["p", {},
                "The set of items to show in the main completion list and ",
                "NoScript menu."],
            prefs.descs("list")]],

    ["item", {},
        ["tags", {}, "'nso' 'noscript-objects'"],
        ["spec", {}, "'noscript-objects'"],
        ["type", {}, "stringlist"],
        ["default", {}, ""],
        ["description", {},
            ["p", {},
                "The list of objects which allowed to display. See also ",
                ["o", {}, "noscript-forbid"], "."],
            ["example", {},
                ["ex", {}, ":map ", ["k", { name: "A-c",  link: "false" }]], " ",
                ["ex", {}, ":set nso!=", ["k", { name: "A-Tab", link: "c_<A-Tab>" }]]]]],

    ["item", {},
        ["tags", {}, "'nss' 'noscript-sites'"],
        ["spec", {}, "'noscript-sites'"],
        ["type", {}, "stringlist"],
        ["default", {}, ""],
        ["description", {},
            ["p", {},
                "The list of sites which are permanently allowed to execute ",
                "scripts."],
            ["example", {},
                ["ex", {}, ":map ", ["k", { name: "A-s", link: "false" }]], " ",
                ["ex", {}, ":set nss!=", ["k", { name: "A-Tab", link: "c_<A-Tab>" }]]]]],

    ["item", {},
        ["tags", {}, "'nst' 'noscript-tempsites'"],
        ["spec", {}, "'noscript-tempsites'"],
        ["type", {}, "stringlist"],
        ["default", {}, ""],
        ["description", {},
            ["p", {},
                "The list of sites which are temporarily allowed to execute ",
                "scripts. The value is not preserved across application ",
                "restarts."],
            ["example", {},
                ["ex", {}, ":map ", ["k", { name: "A-S-s", link: "false" }]], " ",
                ["ex", {}, ":set nst!=", ["k", { name: "A-Tab", link: "c_<A-Tab>" }]]]]],

    ["item", {},
        ["tags", {}, "'nsu' 'noscript-untrusted'"],
        ["spec", {}, "'noscript-untrusted'"],
        ["type", {}, "stringlist"],
        ["default", {}, ""],
        ["description", {},
            ["p", {},
                "The list of untrusted sites which are not allowed to activate, ",
                "nor are listed in the main completion lists or NoScript menu."],
            ["example", {},
                ["ex", {}, ":map ", ["k", { name: "A-C-s", link: "false" }]], " ",
                ["ex", {}, ":set nsu!=", ["k", { name: "A-Tab", link: "c_<A-Tab>" }]]]]]];

/* vim:se sts=4 sw=4 et: */
