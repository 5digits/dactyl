// Copyright (c) 2008-2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("styles", {
    exports: ["Style", "Styles", "styles"],
    require: ["services", "util"]
});

lazyRequire("contexts", ["Contexts"]);
lazyRequire("template", ["template"]);

function cssUri(css) "chrome-data:text/css," + encodeURI(css);
var namespace = "@namespace html " + XHTML.quote() + ";\n" +
                "@namespace xul " + XUL.quote() + ";\n" +
                "@namespace dactyl " + NS.quote() + ";\n";

var Sheet = Struct("name", "id", "sites", "css", "hive", "agent");
Sheet.liveProperty = function (name) {
    let i = this.prototype.members[name];
    this.prototype.__defineGetter__(name, function () this[i]);
    this.prototype.__defineSetter__(name, function (val) {
        if (isArray(val))
            val = Array.slice(val);
        if (isArray(val))
            Object.freeze(val);
        this[i] = val;
        this.enabled = this.enabled;
    });
};
Sheet.liveProperty("agent");
Sheet.liveProperty("css");
Sheet.liveProperty("sites");
update(Sheet.prototype, {
    formatSites: function (uris)
          template.map(this.sites,
                       filter => ["span", { highlight: uris.some(Styles.matchFilter(filter)) ? "Filter" : "" }, filter],
                       ","),

    remove: function () { this.hive.remove(this); },

    get uri() "dactyl://style/" + this.id + "/" + this.hive.name + "/" + (this.name || ""),

    get enabled() this._enabled,
    set enabled(on) {
        if (on != this._enabled || this.fullCSS != this._fullCSS) {
            if (on)
                this.enabled = false;
            else if (!this._fullCSS)
                return;

            let meth = on ? "registerSheet" : "unregisterSheet";
            styles[meth](this.uri, on ? this.agent : this._agent);

            this._agent = this.agent;
            this._enabled = Boolean(on);
            this._fullCSS = this.fullCSS;
        }
    },

    match: function (uri) {
        if (isString(uri))
            uri = util.newURI(uri);
        return this.sites.some(site => Styles.matchFilter(site, uri));
    },

    get fullCSS() {
        let filter = this.sites;
        let css = this.css;

        let preamble = "/* " + this.uri + (this.agent ? " (agent)" : "") + " */\n\n" + namespace + "\n";
        if (filter[0] == "*")
            return preamble + css;

        let selectors = filter.map(part =>
                                    !/^(?:[a-z-]+[:*]|[a-z-.]+$)/i.test(part) ? "regexp(" + Styles.quote(".*(?:" + part + ").*") + ")" :
                                       (/[*]$/.test(part)   ? "url-prefix" :
                                        /[\/:]/.test(part)  ? "url"
                                                            : "domain")
                                       + '(' + Styles.quote(part.replace(/\*$/, "")) + ')')
                              .join(",\n               ");

        return preamble + "@-moz-document " + selectors + " {\n\n" + css + "\n\n}\n";
    }
});

var Hive = Class("Hive", {
    init: function (name, persist) {
        this.name = name;
        this.sheets = [];
        this.names = {};
        this.refs = [];
        this.persist = persist;
    },

    get modifiable() this.name !== "system",

    addRef: function (obj) {
        this.refs.push(util.weakReference(obj));
        this.dropRef(null);
    },
    dropRef: function (obj) {
        this.refs = this.refs.filter(ref => (ref.get() && ref.get() !== obj));

        if (!this.refs.length) {
            this.cleanup();
            styles.hives = styles.hives.filter(h => h !== this);
        }
    },

    cleanup: function cleanup() {
        for (let sheet of this.sheets)
            util.trapErrors(() => {
                sheet.enabled = false;
            });
    },

    __iterator__: function () Iterator(this.sheets),

    get sites() array(this.sheets).map(s => s.sites)
                                  .flatten()
                                  .uniq().array,

    /**
     * Add a new style sheet.
     *
     * @param {string} name The name given to the style sheet by
     *     which it may be later referenced.
     * @param {string} filter The sites to which this sheet will
     *     apply. Can be a domain name or a URL. Any URL ending in
     *     "*" is matched as a prefix.
     * @param {string} css The CSS to be applied.
     * @param {boolean} agent If true, the sheet is installed as an
     *     agent sheet.
     * @param {boolean} lazy If true, the sheet is not initially enabled.
     * @returns {Sheet}
     */
    add: function add(name, filter, css, agent, lazy) {

        if (isArray(filter))
            // Need an array from the same compartment.
            filter = Array.slice(filter);
        else
            filter = filter.split(",");

        if (name && name in this.names) {
            var sheet = this.names[name];
            sheet.agent = agent;
            sheet.css = String(css);
            sheet.sites = filter;
        }
        else {
            sheet = Sheet(name, styles._id++, filter.filter(util.identity), String(css), this, agent);
            this.sheets.push(sheet);
        }

        styles.allSheets[sheet.id] = sheet;

        if (!lazy)
            sheet.enabled = true;

        if (name)
            this.names[name] = sheet;
        return sheet;
    },

    /**
     * Get a sheet with a given name or index.
     *
     * @param {string or number} sheet The sheet to retrieve. Strings indicate
     *     sheet names, while numbers indicate indices.
     */
    get: function get(sheet) {
        if (typeof sheet === "number")
            return this.sheets[sheet];
        return this.names[sheet];
    },

    /**
     * Find sheets matching the parameters. See {@link #addSheet}
     * for parameters.
     *
     * @param {string} name
     * @param {string} filter
     * @param {string} css
     * @param {number} index
     */
    find: function find(name, filter, css, index) {
        // Grossly inefficient.
        let matches = [k for ([k, v] in Iterator(this.sheets))];
        if (index)
            matches = String(index).split(",").filter(i => i in this.sheets);
        if (name)
            matches = matches.filter(i => this.sheets[i].name == name);
        if (css)
            matches = matches.filter(i => this.sheets[i].css == css);
        if (filter)
            matches = matches.filter(i => this.sheets[i].sites.indexOf(filter) >= 0);

        return matches.map(i => this.sheets[i]);
    },

    /**
     * Remove a style sheet. See {@link #addSheet} for parameters.
     * In cases where *filter* is supplied, the given filters are removed from
     * matching sheets. If any remain, the sheet is left in place.
     *
     * @param {string} name
     * @param {string} filter
     * @param {string} css
     * @param {number} index
     */
    remove: function remove(name, filter, css, index) {
        if (arguments.length == 1) {
            var matches = [name];
            name = null;
        }

        if (filter && filter.contains(","))
            return filter.split(",").reduce(
                (n, f) => n + this.removeSheet(name, f, index), 0);

        if (filter == undefined)
            filter = "";

        if (!matches)
            matches = this.findSheets(name, filter, css, index);
        if (matches.length == 0)
            return null;

        for (let [, sheet] in Iterator(matches.reverse())) {
            if (filter) {
                let sites = sheet.sites.filter(f => f != filter);
                if (sites.length) {
                    sheet.sites = sites;
                    continue;
                }
            }
            sheet.enabled = false;
            if (sheet.name)
                delete this.names[sheet.name];
            delete styles.allSheets[sheet.id];
        }
        this.sheets = this.sheets.filter(s => matches.indexOf(s) == -1);
        return matches.length;
    },
});

/**
 * Manages named and unnamed user style sheets, which apply to both
 * chrome and content pages.
 *
 * @author Kris Maglione <maglione.k@gmail.com>
 */
var Styles = Module("Styles", {
    Local: function (dactyl, modules, window) ({
        cleanup: function () {}
    }),

    init: function () {
        this._id = 0;
        this.cleanup();
        this.allSheets = {};

        update(services["dactyl:"].providers, {
            "style": function styleProvider(uri, path) {
                let id = parseInt(path);
                if (hasOwnProperty(styles.allSheets, id))
                    return ["text/css", styles.allSheets[id].fullCSS];
                return null;
            }
        });
    },

    cleanup: function cleanup() {
        for (let hive of this.hives || [])
            util.trapErrors("cleanup", hive);
        this.hives = [];
        this.user = this.addHive("user", this, true);
        this.system = this.addHive("system", this, false);
    },

    addHive: function addHive(name, ref, persist) {
        let hive = this.hives.find(h => h.name === name);
        if (!hive) {
            hive = Hive(name, persist);
            this.hives.push(hive);
        }
        hive.persist = persist;
        if (ref)
            hive.addRef(ref);
        return hive;
    },

    __iterator__: function () Iterator(this.user.sheets.concat(this.system.sheets)),

    _proxy: function (name, args)
        let (obj = this[args[0] ? "system" : "user"])
            obj[name].apply(obj, Array.slice(args, 1)),

    addSheet: deprecated("Styles#{user,system}.add", function addSheet() this._proxy("add", arguments)),
    findSheets: deprecated("Styles#{user,system}.find", function findSheets() this._proxy("find", arguments)),
    get: deprecated("Styles#{user,system}.get", function get() this._proxy("get", arguments)),
    removeSheet: deprecated("Styles#{user,system}.remove", function removeSheet() this._proxy("remove", arguments)),

    userSheets: Class.Property({ get: deprecated("Styles#user.sheets", function userSheets() this.user.sheets) }),
    systemSheets: Class.Property({ get: deprecated("Styles#system.sheets", function systemSheets() this.system.sheets) }),
    userNames: Class.Property({ get: deprecated("Styles#user.names", function userNames() this.user.names) }),
    systemNames: Class.Property({ get: deprecated("Styles#system.names", function systemNames() this.system.names) }),
    sites: Class.Property({ get: deprecated("Styles#user.sites", function sites() this.user.sites) }),

    list: function list(content, sites, name, hives) {
        const { commandline, dactyl } = this.modules;

        hives = hives || styles.hives.filter(h => (h.modifiable && h.sheets.length));

        function sheets(group)
            group.sheets.slice()
                 .filter(sheet => ((!name || sheet.name === name) &&
                                   (!sites || sites.every(s => sheet.sites.indexOf(s) >= 0))))
                 .sort((a, b) => (a.name && b.name ? String.localeCompare(a.name, b.name)
                                                   : !!b.name - !!a.name || a.id - b.id));

        let uris = util.visibleURIs(content);

        let list = ["table", {},
                ["tr", { highlight: "Title" },
                    ["td"],
                    ["td"],
                    ["td", { style: "padding-right: 1em;" }, _("title.Name")],
                    ["td", { style: "padding-right: 1em;" }, _("title.Filter")],
                    ["td", { style: "padding-right: 1em;" }, _("title.CSS")]],
                ["col", { style: "min-width: 4em; padding-right: 1em;" }],
                ["col", { style: "min-width: 1em; text-align: center; color: red; font-weight: bold;" }],
                ["col", { style: "padding: 0 1em 0 1ex; vertical-align: top;" }],
                ["col", { style: "padding: 0 1em 0 0; vertical-align: top;" }],
                template.map(hives, hive => let (i = 0) [
                    ["tr", { style: "height: .5ex;" }],
                    template.map(sheets(hive), sheet =>
                        ["tr", {},
                            ["td", { highlight: "Title" }, !i++ ? hive.name : ""],
                            ["td", {}, sheet.enabled ? "" : UTF8("×")],
                            ["td", {}, sheet.name || hive.sheets.indexOf(sheet)],
                            ["td", {}, sheet.formatSites(uris)],
                            ["td", {}, sheet.css]]),
                    ["tr", { style: "height: .5ex;" }]])];

        // E4X-FIXME
        // // TODO: Move this to an ItemList to show this automatically
        // if (list.*.length() === list.text().length() + 5)
        //     dactyl.echomsg(_("style.none"));
        // else
        commandline.commandOutput(list);
    },

    registerSheet: function registerSheet(url, agent, reload) {
        let uri = services.io.newURI(url, null, null);
        if (reload)
            this.unregisterSheet(url, agent);

        let type = services.stylesheet[agent ? "AGENT_SHEET" : "USER_SHEET"];
        if (reload || !services.stylesheet.sheetRegistered(uri, type))
            services.stylesheet.loadAndRegisterSheet(uri, type);
    },

    unregisterSheet: function unregisterSheet(url, agent) {
        let uri = services.io.newURI(url, null, null);
        let type = services.stylesheet[agent ? "AGENT_SHEET" : "USER_SHEET"];
        if (services.stylesheet.sheetRegistered(uri, type))
            services.stylesheet.unregisterSheet(uri, type);
    },
}, {
    append: function (dest, src, sort) {
        let props = {};
        for (let str of [dest, src])
            for (let prop in Styles.propertyIter(str))
                props[prop.name] = prop.value;

        let val = Object.keys(props)[sort ? "sort" : "slice"]()
                        .map(prop => prop + ": " + props[prop] + ";")
                        .join(" ");

        if (/^\s*(\/\*.*?\*\/)/.exec(src))
            val = RegExp.$1 + " " + val;
        return val;
    },

    completeSite: function (context, content, group=styles.user) {
        context.anchored = false;
        try {
            context.fork("current", 0, this, function (context) {
                context.title = ["Current Site"];
                context.completions = [
                    [content.location.host, /*L*/"Current Host"],
                    [content.location.href, /*L*/"Current URL"]
                ];
            });
        }
        catch (e) {}

        let uris = util.visibleURIs(content);

        context.generate = () => values(group.sites);

        context.keys.text = util.identity;
        context.keys.description = function (site) this.sheets.length + /*L*/" sheet" + (this.sheets.length == 1 ? "" : "s") + ": " +
            array.compact(this.sheets.map(s => s.name)).join(", ");
        context.keys.sheets = site => group.sheets.filter(s => s.sites.indexOf(site) >= 0);
        context.keys.active = site => uris.some(Styles.matchFilter(site));

        Styles.splitContext(context, "Sites");
    },

    /**
     * A curried function which determines which host names match a
     * given stylesheet filter. When presented with one argument,
     * returns a matcher function which, given one nsIURI argument,
     * returns true if that argument matches the given filter. When
     * given two arguments, returns true if the second argument matches
     * the given filter.
     *
     * @param {string} filter The URI filter to match against.
     * @param {nsIURI} uri The location to test.
     * @returns {nsIURI -> boolean}
     */
    matchFilter: function (filter) {
        filter = filter.trim();

        if (filter === "*")
            var test = function test(uri) true;
        else if (!/^(?:[a-z-]+:|[a-z-.]+$)/.test(filter)) {
            let re = util.regexp(filter);
            test = function test(uri) re.test(uri.spec);
        }
        else if (/[*]$/.test(filter)) {
            let re = RegExp("^" + util.regexp.escape(filter.substr(0, filter.length - 1)));
            test = function test(uri) re.test(uri.spec);
        }
        else if (/[\/:]/.test(filter))
            test = function test(uri) uri.spec === filter;
        else
            test = function test(uri) { try { return util.isSubdomain(uri.host, filter); } catch (e) { return false; } };
        test.toString = function toString() filter;
        test.key = filter;
        if (arguments.length < 2)
            return test;
        return test(arguments[1]);
    },

    splitContext: function splitContext(context, title) {
        for (let item in Iterator({ Active: true, Inactive: false })) {
            let [name, active] = item;
            context.split(name, null, function (context) {
                context.title[0] = /*L*/name + " " + (title || "Sheets");
                context.filters.push(item => !!item.active == active);
            });
        }
    },

    propertyIter: function (str, always) {
        let i = 0;
        for (let match in this.propertyPattern.iterate(str)) {
            if (match.value || always && match.name || match.wholeMatch === match.preSpace && always && !i++)
                yield match;
            if (!/;/.test(match.postSpace))
                break;
        }
    },

    propertyPattern: util.regexp(literal(function () /*
            (?:
                (?P<preSpace> <space>*)
                (?P<name> [-a-z]*)
                (?:
                    <space>* : \s* (?P<value>
                        (?:
                            [-\w]+
                            (?:
                                \s* \( \s*
                                    (?: <string> | [^)]*  )
                                \s* (?: \) | $)
                            )?
                            \s*
                            | \s* <string> \s*
                            | <space>*
                            | [^;}]*
                        )*
                    )
                )?
            )
            (?P<postSpace> <space>* (?: ; | $) )
        */$), "gix",
        {
            space: /(?: \s | \/\* .*? \*\/ )/,
            string: /(?:" (?:[^\\"]|\\.)* (?:"|$) | '(?:[^\\']|\\.)* (?:'|$) )/
        }),

    patterns: memoize({
        get property() util.regexp(literal(function () /*
                (?:
                    (?P<preSpace> <space>*)
                    (?P<name> [-a-z]*)
                    (?:
                        <space>* : \s* (?P<value>
                            <token>*
                        )
                    )?
                )
                (?P<postSpace> <space>* (?: ; | $) )
            */$), "gix", this),

        get function() util.regexp(literal(function () /*
                (?P<function>
                    \s* \( \s*
                        (?: <string> | [^)]*  )
                    \s* (?: \) | $)
                )
            */$), "gx", this),

        space: /(?: \s | \/\* .*? \*\/ )/,

        get string() util.regexp(literal(function () /*
                (?P<string>
                    " (?:[^\\"]|\\.)* (?:"|$) |
                    ' (?:[^\\']|\\.)* (?:'|$)
                )
            */$), "gx", this),

        get token() util.regexp(literal(function () /*
            (?P<token>
                (?P<word> [-\w]+)
                <function>?
                \s*
                | (?P<important> !important\b)
                | \s* <string> \s*
                | <space>+
                | [^;}\s]+
            )
        */$), "gix", this)
    }),

    /**
     * Quotes a string for use in CSS stylesheets.
     *
     * @param {string} str
     * @returns {string}
     */
    quote: function quote(str) {
        return '"' + str.replace(/([\\"])/g, "\\$1").replace(/\n/g, "\\00000a") + '"';
    },
}, {
    commands: function initCommands(dactyl, modules, window) {
        const { commands, contexts, styles } = modules;

        function sheets(context, args, filter) {
            let uris = util.visibleURIs(window.content);
            context.compare = modules.CompletionContext.Sort.number;
            context.generate = () => args["-group"].sheets;
            context.keys.active = sheet => uris.some(sheet.bound.match);
            context.keys.description = sheet => [sheet.formatSites(uris), ": ", sheet.css.replace("\n", "\\n")];
            if (filter)
                context.filters.push(({ item }) => filter(item));
            Styles.splitContext(context);
        }

        function nameFlag(filter) ({
            names: ["-name", "-n"],
            description: "The name of this stylesheet",
            type: modules.CommandOption.STRING,
            completer: function (context, args) {
                context.keys.text = sheet => sheet.name;
                context.filters.unshift(({ item }) => item.name);
                sheets(context, args, filter);
            }
        });

        commands.add(["sty[le]"],
            "Add or list user styles",
            function (args) {
                let [filter, css] = args;

                if (!css)
                    styles.list(window.content, filter ? filter.split(",") : null, args["-name"], args.explicitOpts["-group"] ? [args["-group"]] : null);
                else {
                    util.assert(args["-group"].modifiable && args["-group"].hive.modifiable,
                                _("group.cantChangeBuiltin", _("style.styles")));

                    if (args["-append"]) {
                        let sheet = args["-group"].get(args["-name"]);
                        if (sheet) {
                            filter = array(sheet.sites).concat(filter).uniq().join(",");
                            css = sheet.css + " " + css;
                        }
                    }
                    let style = args["-group"].add(args["-name"], filter, css, args["-agent"]);

                    if (args["-nopersist"] || !args["-append"] || style.persist === undefined)
                        style.persist = !args["-nopersist"];
                }
            },
            {
                completer: function (context, args) {
                    let compl = [];
                    let sheet = args["-group"].get(args["-name"]);
                    if (args.completeArg == 0) {
                        if (sheet)
                            context.completions = [[sheet.sites.join(","), "Current Value"]];
                        context.fork("sites", 0, Styles, "completeSite", window.content, args["-group"]);
                    }
                    else if (args.completeArg == 1) {
                        if (sheet)
                            context.completions = [
                                [sheet.css, _("option.currentValue")]
                            ];
                        context.fork("css", 0, modules.completion, "css");
                    }
                },
                hereDoc: true,
                literal: 1,
                options: [
                    { names: ["-agent", "-A"],  description: "Apply style as an Agent sheet" },
                    { names: ["-append", "-a"], description: "Append site filter and css to an existing, matching sheet" },
                    contexts.GroupFlag("styles"),
                    nameFlag(),
                    { names: ["-nopersist", "-N"], description: "Do not save this style to an auto-generated RC file" }
                ],
                serialize: function ()
                    array(styles.hives)
                        .filter(hive => hive.persist)
                        .map(hive =>
                             hive.sheets.filter(style => style.persist)
                                 .sort((a, b) => String.localeCompare(a.name || "",
                                                                      b.name || ""))
                                 .map(style => ({
                                    command: "style",
                                    arguments: [style.sites.join(",")],
                                    literalArg: style.css,
                                    options: {
                                        "-group": hive.name == "user" ? undefined : hive.name,
                                        "-name": style.name || undefined
                                    }
                                })))
                        .flatten().array
            });

        [
            {
                name: ["stylee[nable]", "stye[nable]"],
                desc: "Enable a user style sheet",
                action: function (sheet) sheet.enabled = true,
                filter: function (sheet) !sheet.enabled
            },
            {
                name: ["styled[isable]", "styd[isable]"],
                desc: "Disable a user style sheet",
                action: function (sheet) sheet.enabled = false,
                filter: function (sheet) sheet.enabled
            },
            {
                name: ["stylet[oggle]", "styt[oggle]"],
                desc: "Toggle a user style sheet",
                action: function (sheet) sheet.enabled = !sheet.enabled
            },
            {
                name: ["dels[tyle]"],
                desc: "Remove a user style sheet",
                action: function (sheet) sheet.remove(),
            }
        ].forEach(function (cmd) {
            commands.add(cmd.name, cmd.desc,
                function (args) {
                    dactyl.assert(args.bang ^ !!(args[0] || args[1] || args["-name"] || args["-index"]),
                                  _("error.argumentOrBang"));

                    args["-group"].find(args["-name"], args[0], args.literalArg, args["-index"])
                                  .forEach(cmd.action);
                }, {
                    bang: true,
                    completer: function (context, args) {
                        let uris = util.visibleURIs(window.content);

                        Styles.completeSite(context, window.content, args["-group"]);
                        if (cmd.filter)
                            context.filters.push(({ sheets }) => sheets.some(cmd.filter));
                    },
                    literal: 1,
                    options: [
                        contexts.GroupFlag("styles"),
                        {
                            names: ["-index", "-i"],
                            type: modules.CommandOption.INT,
                            completer: function (context, args) {
                                context.keys.text = sheet => args["-group"].sheets.indexOf(sheet);
                                sheets(context, args, cmd.filter);
                            }
                        },
                        nameFlag(cmd.filter)
                    ]
                });
        });
    },
    contexts: function initContexts(dactyl, modules, window) {
        modules.contexts.Hives("styles",
            Class("LocalHive", Contexts.Hive, {
                init: function init(group) {
                    init.superapply(this, arguments);
                    this.hive = styles.addHive(group.name, this, this.persist);
                },

                get names() this.hive.names,
                get sheets() this.hive.sheets,
                get sites() this.hive.sites,

                __noSuchMethod__: function __noSuchMethod__(meth, args) {
                    return this.hive[meth].apply(this.hive, args);
                },

                destroy: function () {
                    this.hive.dropRef(this);
                }
            }));
    },
    completion: function initCompletion(dactyl, modules, window) {
        const names = Array.slice(DOM(["div"], window.document).style);
        modules.completion.css = function (context) {
            context.title = ["CSS Property"];
            context.keys = { text: function (p) p + ":",
                             description: function () "" };

            for (let match in Styles.propertyIter(context.filter, true))
                var lastMatch = match;

            if (lastMatch != null && !lastMatch.value && !lastMatch.postSpace) {
                context.advance(lastMatch.index + lastMatch.preSpace.length);
                context.completions = names;
            }
        };
    },
    javascript: function initJavascript(dactyl, modules, window) {
        modules.JavaScript.setCompleter(["get", "add", "remove", "find"].map(m => Hive.prototype[m]),
            [ // Prototype: (name, filter, css, index)
                function (context, obj, args) this.names,
                (context, obj, args) => Styles.completeSite(context, window.content),
                null,
                function (context, obj, args) this.sheets
            ]);
    },
    template: function initTemplate() {
        let patterns = Styles.patterns;

        template.highlightCSS = function highlightCSS(css) {
            return this.highlightRegexp(css, patterns.property, function (match) {
                if (!match.length)
                    return [];
                return ["", match.preSpace, template.filter(match.name), ": ",

                    template.highlightRegexp(match.value, patterns.token, function (match) {
                        if (match.function)
                            return ["", template.filter(match.word),
                                template.highlightRegexp(match.function, patterns.string,
                                                         match => ["span", { highlight: "String" },
                                                                       match.string])
                            ];
                        if (match.important == "!important")
                            return ["span", { highlight: "String" }, match.important];
                        if (match.string)
                            return ["span", { highlight: "String" }, match.string];
                        return template._highlightRegexp(match.wholeMatch, /^(\d+)(em|ex|px|in|cm|mm|pt|pc)?/g,
                                                         (m, n, u) => [
                                                             ["span", { highlight: "Number" }, n],
                                                             ["span", { highlight: "Object" }, u || ""]
                                                         ]);
                    }),
                    match.postSpace
                ];
            });
        };
    }
});

endModule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
