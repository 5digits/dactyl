// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/base.jsm");
defineModule("styles", {
    exports: ["Style", "Styles", "styles"],
    require: ["services", "util"],
    use: ["template"]
});

function cssUri(css) "chrome-data:text/css," + encodeURI(css);
var namespace = "@namespace html " + XHTML.uri.quote() + ";\n" +
                  "@namespace xul " + XUL.uri.quote() + ";\n" +
                  "@namespace dactyl " + NS.uri.quote() + ";\n";

var Sheet = Struct("name", "id", "sites", "css", "hive", "agent");
Sheet.liveProperty = function (name) {
    let i = this.prototype.members[name];
    this.prototype.__defineGetter__(name, function () this[i]);
    this.prototype.__defineSetter__(name, function (val) {
        if (isArray(val) && Object.freeze)
            Object.freeze(val);
        this[i] = val;
        this.enabled = this.enabled;
    });
}
Sheet.liveProperty("agent");
Sheet.liveProperty("css");
Sheet.liveProperty("sites");
update(Sheet.prototype, {
    formatSites: function (uris)
          template.map(this.sites,
                       function (filter) <span highlight={uris.some(Styles.matchFilter(filter)) ? "Filter" : ""}>{filter}</span>,
                       <>,</>),

    remove: function () { this.hive.remove(this); },

    get uri() cssUri(this.fullCSS),

    get enabled() this._enabled,
    set enabled(on) {
        if (on != this._enabled || this.uri != this._uri) {
            if (on)
                this.enabled = false;
            else if (!this._uri)
                return;

            let meth = on ? "registerSheet" : "unregisterSheet";
            styles[meth](on ? this.uri   : this._uri,
                         on ? this.agent : this._agent);

            this._agent = this.agent;
            this._enabled = Boolean(on);
            this._uri = this.uri;
        }
    },

    match: function (uri) {
        if (isString(uri))
            uri = util.newURI(uri);
        return this.sites.some(function (site) Styles.matchFilter(site, uri));
    },

    get fullCSS() {
        let filter = this.sites;
        let css = this.css;
        if (filter[0] == "*")
            return namespace + css;

        let selectors = filter.map(function (part)
                                    (/[*]$/.test(part)   ? "url-prefix" :
                                     /[\/:]/.test(part)  ? "url"
                                                         : "domain")
                                    + '("' + part.replace(/"/g, "%22").replace(/\*$/, "") + '")')
                              .join(", ");
        return "/* Dactyl style #" + this.id + (this.agent ? " (agent)" : "") + " */ "
             + namespace + " @-moz-document " + selectors + "{\n" + css + "\n}\n";
    }
});

var Hive = Class("Hive", {
    init: function () {
        this.sheets = [];
        this.names = {};
    },

    cleanup: function cleanup() {
        for (let sheet in values(this.sheets))
            sheet.enabled = false;
    },

    __iterator__: function () Iterator(this.sheets),

    get sites() array(this.sheets).map(function (s) s.sites).flatten().uniq().array,

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

        if (!isArray(filter))
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
            matches = String(index).split(",").filter(function (i) i in this.sheets, this);
        if (name)
            matches = matches.filter(function (i) this.sheets[i].name == name, this);
        if (css)
            matches = matches.filter(function (i) this.sheets[i].css == css, this);
        if (filter)
            matches = matches.filter(function (i) this.sheets[i].sites.indexOf(filter) >= 0, this);
        return matches.map(function (i) this.sheets[i], this);
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
        let self = this;
        if (arguments.length == 1) {
            var matches = [name];
            name = null;
        }

        if (filter && filter.indexOf(",") > -1)
            return filter.split(",").reduce(
                function (n, f) n + self.removeSheet(name, f, index), 0);

        if (filter == undefined)
            filter = "";

        if (!matches)
            matches = this.findSheets(name, filter, css, index);
        if (matches.length == 0)
            return null;

        for (let [, sheet] in Iterator(matches.reverse())) {
            if (filter) {
                let sites = sheet.sites.filter(function (f) f != filter);
                if (sites.length) {
                    sheet.sites = sites;
                    continue;
                }
            }
            sheet.enabled = false;
            if (sheet.name)
                delete this.names[sheet.name];
        }
        this.sheets = this.sheets.filter(function (s) matches.indexOf(s) == -1);
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
    init: function () {
        this._id = 0;
        this.user = Hive();
        this.system = Hive();
    },

    cleanup: function cleanup() {
        for each (let hive in [this.user, this.system])
            hive.cleanup();
    },

    __iterator__: function () Iterator(this.user.sheets.concat(this.system.sheets)),

    _proxy: function (name, args)
        let (obj = this[args[0] ? "system" : "user"])
            obj[name].apply(obj, Array.slice(args, 1)),

    addSheet: deprecated("Please use Styles#{user,system}.add instead", function addSheet() this._proxy("add", arguments)),
    findSheets: deprecated("Please use Styles#{user,system}.find instead", function findSheets() this._proxy("find", arguments)),
    get: deprecated("Please use Styles#{user,system}.get instead", function get() this._proxy("get", arguments)),
    removeSheet: deprecated("Please use Styles#{user,system}.remove instead", function removeSheet() this._proxy("remove", arguments)),

    userSheets: Class.Property({ get: deprecated("Please use Styles#user.sheets instead", function userSheets() this.user.sheets) }),
    systemSheets: Class.Property({ get: deprecated("Please use Styles#system.sheets instead", function systemSheets() this.system.sheets) }),
    userNames: Class.Property({ get: deprecated("Please use Styles#user.names instead", function userNames() this.user.names) }),
    systemNames: Class.Property({ get: deprecated("Please use Styles#system.names instead", function systemNames() this.system.names) }),
    sites: Class.Property({ get: deprecated("Please use Styles#user.sites instead", function sites() this.user.sites) }),

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
        for each (let str in [dest, src])
            for (let prop in Styles.propertyIter(str))
                props[prop.name] = prop.value;

        return Object.keys(props)[sort ? "sort" : "slice"]()
                     .map(function (prop) prop + ": " + props[prop] + ";")
                     .join(" ");
    },

    completeSite: function (context, content) {
        context.anchored = false;
        try {
            context.fork("current", 0, this, function (context) {
                context.title = ["Current Site"];
                context.completions = [
                    [content.location.host, "Current Host"],
                    [content.location.href, "Current URL"]
                ];
            });
        }
        catch (e) {}
        context.fork("others", 0, this, function (context) {
            context.title = ["Site"];
            context.completions = [[s, ""] for ([, s] in Iterator(styles.user.sites))];
        });
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
        if (filter === "*")
            function test(uri) true;
        else if (/[*]$/.test(filter)) {
            let re = RegExp("^" + util.regexp.escape(filter.substr(0, filter.length - 1)));
            function test(uri) re.test(uri.spec);
        }
        else if (/[\/:]/.test(filter))
            function test(uri) uri.spec === filter;
        else
            function test(uri) { try { return util.isSubdomain(uri.host, filter); } catch (e) { return false; } };
        test.toString = function toString() filter;
        if (arguments.length < 2)
            return test;
        return test(arguments[1]);
    },

    propertyIter: function (str, always) {
        this.propertyPattern.lastIndex = 0;

        let match, i = 0;
        while ((!match || match[0]) && (match = Styles.propertyPattern.exec(str)))
            if (always && !i++ || match[0])
                yield this.Property.fromArray(match);
    },

    Property: Struct("whole", "preSpace", "name", "value", "postSpace"),
    propertyPattern: util.regexp(<![CDATA[
            (?:
                (<space>*)
                ([-a-z]*)
                (?:
                    <space>* : \s* (
                        (?:
                            [-\w]
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
            (<space>* (?: ; | $) )
        ]]>, "gi",
        {
            space: /(?: \s | \/\* .*? \*\/ )/,
            string: /(?:"(?:[^\\"]|\\.)*(?:"|$)|'(?:[^\\']|\\.)*(?:'|$))/
        })
}, {
    commands: function (dactyl, modules, window) {
        const commands = modules.commands;

        commands.add(["sty[le]"],
            "Add or list user styles",
            function (args) {
                let [filter, css] = args;

                if (css) {
                    if ("-append" in args) {
                        let sheet = styles.user.get(args["-name"]);
                        if (sheet) {
                            filter = sheet.sites.concat(filter).join(",");
                            css = sheet.css + " " + css;

                        }
                    }
                    styles.user.add(args["-name"], filter, css, args["-agent"]);
                }
                else {
                    let list = styles.user.sheets.slice()
                                     .sort(function (a, b) a.name && b.name ? String.localeCompare(a.name, b.name)
                                                                            : !!b.name - !!a.name || a.id - b.id);
                    let uris = util.visibleURIs(window.content);
                    let name = args["-name"];
                    modules.commandline.commandOutput(
                        template.tabular(["", "Name", "Filter", "CSS"],
                            ["min-width: 1em; text-align: center; color: red; font-weight: bold;",
                             "padding: 0 1em 0 1ex; vertical-align: top;",
                             "padding: 0 1em 0 0; vertical-align: top;"],
                            ([sheet.enabled ? "" : UTF8("×"),
                              sheet.name || styles.user.sheets.indexOf(sheet),
                              sheet.formatSites(uris),
                              sheet.css]
                             for (sheet in values(list))
                             if ((!filter || sheet.sites.indexOf(filter) >= 0) && (!name || sheet.name == name)))));
                }
            },
            {
                bang: true,
                completer: function (context, args) {
                    let compl = [];
                    if (args.completeArg == 0)
                        Styles.completeSite(context, window.content);
                    else if (args.completeArg == 1) {
                        let sheet = styles.user.get(args["-name"]);
                        if (sheet)
                            context.completions = [[sheet.css, "Current Value"]];
                        context.fork("css", 0, modules.completion, "css");
                    }
                },
                hereDoc: true,
                literal: 1,
                options: [
                    { names: ["-agent", "-A"],  description: "Apply style as an Agent sheet" },
                    { names: ["-append", "-a"], description: "Append site filter and css to an existing, matching sheet" },
                    {
                        names: ["-name", "-n"],
                        description: "The name of this stylesheet",
                        completer: function () [[k, v.css] for ([k, v] in Iterator(styles.user.names))],
                        type: modules.CommandOption.STRING
                    }
                ],
                serialize: function () [
                    {
                        command: this.name,
                        arguments: [sty.sites.join(",")],
                        bang: true,
                        literalArg: sty.css,
                        options: sty.name ? { "-name": sty.name } : {}
                    } for ([k, sty] in Iterator(styles.user.sheets.slice().sort(function (a, b) String.localeCompare(a.name || "", b.name || ""))))
                ]
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
                action: function (sheet) sheet.remove()
            }
        ].forEach(function (cmd) {

            function splitContext(context, generate) {
                for (let item in Iterator({ Active: true, Inactive: false })) {
                    let [name, active] = item;
                    context.split(name, null, function (context) {
                        context.title[0] = name + " Sheets";
                        context.filters.push(function (item) item.active == active);
                    });
                }
            }
            function sheets(context) {
                let uris = util.visibleURIs(window.content);
                context.compare = modules.CompletionContext.Sort.number;
                context.generate = function () styles.user.sheets;
                context.keys.active = function (sheet) uris.some(sheet.closure.match);
                context.keys.description = function (sheet) <>{sheet.formatSites(uris)}: {sheet.css.replace("\n", "\\n")}</>
                if (cmd.filter)
                    context.filters.push(function ({ item }) cmd.filter(item));
                splitContext(context);
            }

            commands.add(cmd.name, cmd.desc,
                function (args) {
                    styles.user.find(args["-name"], args[0], args.literalArg, args["-index"])
                          .forEach(cmd.action);
                }, {
                    completer: function (context) {
                        let uris = util.visibleURIs(window.content);
                        context.generate = function () styles.user.sites;
                        context.keys.text = util.identity;
                        context.keys.description = function (site) this.sheets.length + " sheet" + (this.sheets.length == 1 ? "" : "s") + ": " +
                            array.compact(this.sheets.map(function (s) s.name)).join(", ");
                        context.keys.sheets = function (site) styles.user.sheets.filter(function (s) s.sites.indexOf(site) >= 0);
                        context.keys.active = function (site) uris.some(Styles.matchFilter(site));

                        if (cmd.filter)
                            context.filters.push(function ({ sheets }) sheets.some(cmd.filter));

                        splitContext(context);
                    },
                    literal: 1,
                    options: [
                        {
                            names: ["-index", "-i"],
                            type: modules.CommandOption.INT,
                            completer: function (context) {
                                context.keys.text = function (sheet) styles.user.sheets.indexOf(sheet);
                                sheets(context);
                            },
                        }, {
                            names: ["-name", "-n"],
                            type: modules.CommandOption.STRING,
                            completer: function (context) {
                                context.keys.text = function (sheet) sheet.name;
                                context.filters.push(function ({ item }) item.name);
                                sheets(context);
                            }
                        }
                    ]
                });
        });
    },
    completion: function (dactyl, modules, window) {
        const names = Array.slice(util.computedStyle(window.document.createElement("div")));
        modules.completion.css = function (context) {
            context.title = ["CSS Property"];
            context.keys = { text: function (p) p + ":", description: function () "" };

            for (let match in Styles.propertyIter(context.filter, true))
                var lastMatch = match;

            if (lastMatch != null && !lastMatch.value && !lastMatch.postSpace) {
                context.advance(lastMatch.index + lastMatch.preSpace.length);
                context.completions = names;
            }
        };
    },
    javascript: function (dactyl, modules, window) {
        modules.JavaScript.setCompleter(["get", "add", "remove", "find"].map(function (m) styles.user[m]),
            [ // Prototype: (name, filter, css, index)
                function (context, obj, args) this.names,
                function (context, obj, args) Styles.completeSite(context, window.content),
                null,
                function (context, obj, args) this.sheets
            ]);
    }
});

endModule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
