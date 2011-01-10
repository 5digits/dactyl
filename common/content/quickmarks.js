// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/**
* @instance quickmarks
*/
var QuickMarks = Module("quickmarks", {
    init: function () {
        this._qmarks = storage.newMap("quickmarks", { store: true });
        storage.addObserver("quickmarks", function () {
            statusline.updateUrl();
        }, window);
    },

    /**
     * Adds a new quickmark with name *qmark* referencing the URL *location*.
     * Any existing quickmark with the same name will be replaced.
     *
     * @param {string} qmark The name of the quickmark {A-Z}.
     * @param {string} location The URL accessed by this quickmark.
     */
    add: function add(qmark, location) {
        this._qmarks.set(qmark, location);
        dactyl.echomsg({ domains: [util.getHost(location)], message: "Added Quick Mark '" + qmark + "': " + location }, 1);
    },

    /**
     * Returns a list of QuickMarks associates with the given URL.
     *
     * @param {string} url The url to find QuickMarks for.
     * @return {[string]}
     */
    find: function find(url) {
        let res = [];
        for (let [k, v] in this._qmarks)
            if (dactyl.parseURLs(v).some(function (u) String.replace(u, /#.*/, "") == url))
                res.push(k);
        return res;
    },

    /**
     * Returns the URL of the given QuickMark, or null if none exists.
     *
     * @param {string} mark The mark to find.
     * @returns {string} The mark's URL.
     */
    get: function (mark) this._qmarks.get(mark) || null,

    /**
     * Deletes the specified quickmarks. The *filter* is a list of quickmarks
     * and ranges are supported. Eg. "ab c d e-k".
     *
     * @param {string} filter The list of quickmarks to delete.
     *
     */
    remove: function remove(filter) {
        let pattern = util.charListToRegexp(filter, "a-zA-Z0-9");

        for (let [qmark, ] in this._qmarks) {
            if (pattern.test(qmark))
                this._qmarks.remove(qmark);
        }
    },

    /**
     * Removes all quickmarks.
     */
    removeAll: function removeAll() {
        this._qmarks.clear();
    },

    /**
     * Opens the URL referenced by the specified *qmark*.
     *
     * @param {string} qmark The quickmark to open.
     * @param {object} where A set of parameters specifying how to open the
     *     URL. See {@link Dactyl#open}.
     */
    jumpTo: function jumpTo(qmark, where) {
        let url = this.get(qmark);

        if (url)
            dactyl.open(url, where);
        else
            dactyl.echoerr("E20: QuickMark not set");
    },

    /**
     * Lists all quickmarks matching *filter* in the message window.
     *
     * @param {string} filter The list of quickmarks to display, e.g. "a-c i O-X".
     */
    list: function list(filter) {
        let marks = [k for ([k, v] in this._qmarks)];
        let lowercaseMarks = marks.filter(function (x) /[a-z]/.test(x)).sort();
        let uppercaseMarks = marks.filter(function (x) /[A-Z]/.test(x)).sort();
        let numberMarks    = marks.filter(function (x) /[0-9]/.test(x)).sort();

        marks = Array.concat(lowercaseMarks, uppercaseMarks, numberMarks);

        dactyl.assert(marks.length > 0, "No QuickMarks set");

        if (filter.length > 0) {
            let pattern = util.charListToRegexp(filter, "a-zA-Z0-9");
            marks = marks.filter(function (qmark) pattern.test(qmark));
            dactyl.assert(marks.length >= 0, "E283: No QuickMarks matching " + filter.quote());
        }

        commandline.commandOutput(template.tabular(["QuickMark", "URL"], [],
            ([mark, quickmarks._qmarks.get(mark)] for ([k, mark] in Iterator(marks)))));
    }
}, {
}, {
    commands: function () {
        commands.add(["delqm[arks]"],
            "Delete the specified QuickMarks",
            function (args) {
                // TODO: finish arg parsing - we really need a proper way to do this. :)
                // assert(args.bang ^ args[0])
                dactyl.assert( args.bang ||  args[0], "E471: Argument required");
                dactyl.assert(!args.bang || !args[0], "E474: Invalid argument");

                if (args.bang)
                    quickmarks.removeAll();
                else
                    quickmarks.remove(args[0]);
            },
            {
                bang: true,
                completer: function (context) completion.quickmark(context),
                literal: 0
            });

        commands.add(["qma[rk]"],
            "Mark a URL with a letter for quick access",
            function (args) {
                dactyl.assert(/^[a-zA-Z0-9]$/.test(args[0]),
                    "E191: Argument must be an ASCII letter or digit");
                if (!args[1])
                    quickmarks.add(args[0], buffer.URL.spec);
                else
                    quickmarks.add(args[0], args[1]);
            },
            {
                argCount: "+",
                completer: function (context, args) {
                    if (args.length == 1)
                        return completion.quickmark(context);
                    if (args.length == 2) {
                        context.fork("current", 0, this, function (context) {
                            context.title = ["Extra Completions"];
                            context.completions = [
                                [quickmarks.get(args[0]), "Current Value"]
                            ].filter(function ([k, v]) k);
                        });
                        context.fork("url", 0, completion, "url");
                    }
                },
                literal: 1
            });

        commands.add(["qmarks"],
            "Show the specified QuickMarks",
            function (args) {
                quickmarks.list(args[0] || "");
            }, {
                completer: function (context) completion.quickmark(context),
                literal: 0
            });
    },
    completion: function () {
        completion.quickmark = function (context) {
            context.title = ["QuickMark", "URL"];
            context.generate = function () Iterator(quickmarks._qmarks);
        };
    },
    mappings: function () {
        var myModes = config.browserModes;

        mappings.add(myModes,
            ["go"], "Jump to a QuickMark",
            function ({ arg }) { quickmarks.jumpTo(arg, dactyl.CURRENT_TAB); },
            { arg: true });

        mappings.add(myModes,
            ["gn"], "Jump to a QuickMark in a new tab",
            function ({ arg }) { quickmarks.jumpTo(arg, { from: "quickmark", where: dactyl.NEW_TAB }); },
            { arg: true });

        mappings.add(myModes,
            ["M"], "Add new QuickMark for current URL",
            function ({ arg }) {
                dactyl.assert(/^[a-zA-Z0-9]$/.test(arg), "E191: Argument must be an ASCII letter or digit");
                quickmarks.add(arg, buffer.URL.spec);
            },
            { arg: true });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
