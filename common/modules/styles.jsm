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

const sss = services.get("stylesheet");
function cssUri(css) "chrome-data:text/css," + encodeURI(css);
const namespace = "@namespace html " + XHTML.uri.quote() + ";\n" +
                  "@namespace xul " + XUL.uri.quote() + ";\n" +
                  "@namespace dactyl " + NS.uri.quote() + ";\n";

const Sheet = Struct("name", "id", "sites", "css", "system", "agent");
Sheet.liveProperty = function (name) {
    let i = this.prototype.members.indexOf(name);
    this.prototype.__defineGetter__(name, function () this[i]);
    this.prototype.__defineSetter__(name, function (val) {
        this[i] = val;
        this.enabled = this.enabled;
    });
}
Sheet.liveProperty("agent");
Sheet.liveProperty("css");
Sheet.liveProperty("sites");
Sheet.prototype.__defineGetter__("uri", function () cssUri(this.fullCSS));
Sheet.prototype.__defineGetter__("enabled", function () this._enabled);
Sheet.prototype.__defineSetter__("enabled", function (on) {
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
});
Sheet.prototype.__defineGetter__("fullCSS", function wrapCSS() {
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
});

/**
 * Manages named and unnamed user style sheets, which apply to both
 * chrome and content pages.
 *
 * @author Kris Maglione <maglione.k@gmail.com>
 */
const Styles = Module("Styles", {
    init: function () {
        this._id = 0;
        this.userSheets = [];
        this.systemSheets = [];
        this.userNames = {};
        this.systemNames = {};
    },

    get sites() array(this.userSheets).map(function (s) s.sites).flatten().uniq().array,

    __iterator__: function () Iterator(this.userSheets.concat(this.systemSheets)),

    /**
     * Add a new style sheet.
     *
     * @param {boolean} system Declares whether this is a system or
     *     user sheet. System sheets are used internally by
     *     @dactyl.
     * @param {string} name The name given to the style sheet by
     *     which it may be later referenced.
     * @param {string} filter The sites to which this sheet will
     *     apply. Can be a domain name or a URL. Any URL ending in
     *     "*" is matched as a prefix.
     * @param {string} css The CSS to be applied.
     */
    addSheet: function addSheet(system, name, filter, css, agent, lazy) {
        let sheets = system ? this.systemSheets : this.userSheets;
        let names = system ? this.systemNames : this.userNames;

        if (!isArray(filter))
            filter = filter.split(",");
        if (name && name in names) {
            var sheet = names[name];
            sheet.agent = agent;
            sheet.css = String(css);
            sheet.sites = filter;
        }
        else {
            sheet = Sheet(name, this._id++, filter.filter(util.identity), String(css), system, agent);
            sheets.push(sheet);
        }

        if (!lazy)
            sheet.enabled = true;

        if (name)
            names[name] = sheet;
        return sheet;
    },

    /**
     * Get a sheet with a given name or index.
     *
     * @param {boolean} system
     * @param {string or number} sheet The sheet to retrieve. Strings indicate
     *     sheet names, while numbers indicate indices.
     */
    get: function get(system, sheet) {
        let sheets = system ? this.systemSheets : this.userSheets;
        let names = system ? this.systemNames : this.userNames;
        if (typeof sheet === "number")
            return sheets[sheet];
        return names[sheet];
    },

    /**
     * Find sheets matching the parameters. See {@link #addSheet}
     * for parameters.
     *
     * @param {boolean} system
     * @param {string} name
     * @param {string} filter
     * @param {string} css
     * @param {number} index
     */
    findSheets: function findSheets(system, name, filter, css, index) {
        let sheets = system ? this.systemSheets : this.userSheets;

        // Grossly inefficient.
        let matches = [k for ([k, v] in Iterator(sheets))];
        if (index)
            matches = String(index).split(",").filter(function (i) i in sheets);
        if (name)
            matches = matches.filter(function (i) sheets[i].name == name);
        if (css)
            matches = matches.filter(function (i) sheets[i].css == css);
        if (filter)
            matches = matches.filter(function (i) sheets[i].sites.indexOf(filter) >= 0);
        return matches.map(function (i) sheets[i]);
    },

    /**
     * Remove a style sheet. See {@link #addSheet} for parameters.
     * In cases where *filter* is supplied, the given filters are removed from
     * matching sheets. If any remain, the sheet is left in place.
     *
     * @param {boolean} system
     * @param {string} name
     * @param {string} filter
     * @param {string} css
     * @param {number} index
     */
    removeSheet: function removeSheet(system, name, filter, css, index) {
        let self = this;
        if (arguments.length == 1) {
            var matches = [system];
            system = matches[0].system;
        }
        let sheets = system ? this.systemSheets : this.userSheets;
        let names = system ? this.systemNames : this.userNames;

        if (filter && filter.indexOf(",") > -1)
            return filter.split(",").reduce(
                function (n, f) n + self.removeSheet(system, name, f, index), 0);

        if (filter == undefined)
            filter = "";

        if (!matches)
            matches = this.findSheets(system, name, filter, css, index);
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
                delete names[sheet.name];
            if (sheets.indexOf(sheet) > -1)
                sheets.splice(sheets.indexOf(sheet), 1);
        }
        return matches.length;
    },

    /**
     * Register a user style sheet at the given URI.
     *
     * @param {string} url The URI of the sheet to register.
     * @param {boolean} agent If true, sheet is registered as an agent sheet.
     * @param {boolean} reload Whether to reload any sheets that are
     *     already registered.
     */
    registerSheet: function registerSheet(url, agent, reload) {
        let uri = services.get("io").newURI(url, null, null);
        if (reload)
            this.unregisterSheet(url, agent);
        if (reload || !sss.sheetRegistered(uri, agent ? sss.AGENT_SHEET : sss.USER_SHEET))
            sss.loadAndRegisterSheet(uri, agent ? sss.AGENT_SHEET : sss.USER_SHEET);
    },

    /**
     * Unregister a sheet at the given URI.
     *
     * @param {string} url The URI of the sheet to unregister.
     * @param {boolean} agent If true, sheet is registered as an agent sheet.
     */
    unregisterSheet: function unregisterSheet(url, agent) {
        let uri = services.get("io").newURI(url, null, null);
        if (sss.sheetRegistered(uri, agent ? sss.AGENT_SHEET : sss.USER_SHEET))
            sss.unregisterSheet(uri, agent ? sss.AGENT_SHEET : sss.USER_SHEET);
    },
}, {
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
            context.completions = [[s, ""] for ([, s] in Iterator(styles.sites))];
        });
    },

    propertyPattern: util.regexp(<![CDATA[
            (?:
                (\s*)
                ([-a-z]*)
                (?:
                    \s* : \s* (
                        (?:
                            [-\w]
                            (?:
                                \s* \( \s*
                                    (?: <string> | [^)]*  )
                                \s* (?: \) | $)
                            )?
                            \s*
                            | \s* <string> \s* | [^;}]*
                        )*
                    )
                )?
            )
            (\s* (?: ; | $) )
        ]]>, "gi",
        { string: /(?:"(?:[^\\"]|\\.)*(?:"|$)|'(?:[^\\']|\\.)*(?:'|$))/ })
}, {
    commands: function (dactyl, modules, window) {
        const commands = modules.commands;
        commands.add(["sty[le]"],
            "Add or list user styles",
            function (args) {
                let [filter, css] = args;
                let name = args["-name"];

                if (!css) {
                    let list = Array.concat([i for (i in Iterator(styles.userNames))],
                                            [i for (i in Iterator(styles.userSheets)) if (!i[1].name)]);
                    modules.commandline.commandOutput(
                        template.tabular(["", "Name", "Filter", "CSS"],
                            ["min-width: 1em; text-align: center; color: red; font-weight: bold;",
                             "padding: 0 1em 0 1ex; vertical-align: top;",
                             "padding: 0 1em 0 0; vertical-align: top;"],
                            ([sheet.enabled ? "" : UTF8("×"),
                              key,
                              sheet.sites.join(","),
                              sheet.css]
                             for ([i, [key, sheet]] in Iterator(list))
                             if ((!filter || sheet.sites.indexOf(filter) >= 0) && (!name || sheet.name == name)))));
                }
                else {
                    if ("-append" in args) {
                        let sheet = styles.get(false, name);
                        if (sheet) {
                            filter = sheet.sites.concat(filter).join(",");
                            css = sheet.css + " " + css;
                        }
                    }
                    styles.addSheet(false, name, filter, css, args["-agent"]);
                }
            },
            {
                bang: true,
                completer: function (context, args) {
                    let compl = [];
                    if (args.completeArg == 0)
                        Styles.completeSite(context, window.content);
                    else if (args.completeArg == 1) {
                        let sheet = styles.get(false, args["-name"]);
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
                        completer: function () [[k, v.css] for ([k, v] in Iterator(styles.userNames))],
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
                    } for ([k, sty] in Iterator(styles.userSheets))
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
                action: function (sheet) styles.removeSheet(sheet)
            }
        ].forEach(function (cmd) {
            commands.add(cmd.name, cmd.desc,
                function (args) {
                    styles.findSheets(false, args["-name"], args[0], args.literalArg, args["-index"])
                          .forEach(cmd.action);
                },
            {
                completer: function (context) { context.completions = styles.sites.map(function (site) [site, ""]); },
                literal: 1,
                options: [
                    {
                        names: ["-index", "-i"],
                        type: modules.CommandOption.INT,
                        completer: function (context) {
                            context.compare = modules.CompletionContext.Sort.number;
                            return [[i, <>{sheet.sites.join(",")}: {sheet.css.replace("\n", "\\n")}</>]
                                    for ([i, sheet] in styles.userSheets)
                                    if (!cmd.filter || cmd.filter(sheet))];
                        },
                    }, {
                        names: ["-name", "-n"],
                        type: modules.CommandOption.STRING,
                        completer: function () [[name, sheet.css]
                                                for ([name, sheet] in Iterator(styles.userNames))
                                                if (!cmd.filter || cmd.filter(sheet))]
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

            Styles.propertyPattern.lastIndex = 0;
            let match, lastMatch;
            while ((!match || match[0]) && (match = Styles.propertyPattern.exec(context.filter)) && (match[0].length || !lastMatch))
                lastMatch = match;
            if (lastMatch != null && !lastMatch[3] && !lastMatch[4]) {
                context.advance(lastMatch.index + lastMatch[1].length)
                context.completions = names;
            }
        };
    },
    javascript: function (dactyl, modules, window) {
        modules.JavaScript.setCompleter(["get", "addSheet", "removeSheet", "findSheets"].map(function (m) styles[m]),
            [ // Prototype: (system, name, filter, css, index)
                null,
                function (context, obj, args) args[0] ? this.systemNames : this.userNames,
                function (context, obj, args) Styles.completeSite(context, window.content),
                null,
                function (context, obj, args) args[0] ? this.systemSheets : this.userSheets
            ]);
    }
});

endModule();

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim:se fdm=marker sw=4 ts=4 et ft=javascript:
