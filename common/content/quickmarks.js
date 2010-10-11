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
const QuickMarks = Module("quickmarks", {
    init: function () {
        this._qmarks = storage.newMap("quickmarks", { store: true });
        storage.addObserver("quickmarks", function () {
            statusline.updateUrl();
        }, window);
    },

    /**
     * Adds a new quickmark with name <b>qmark</b> referencing
     * the URL <b>location</b>. Any existing quickmark with the same name
     * will be replaced.
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
     * Deletes the specified quickmarks. The <b>filter</b> is a list of
     * quickmarks and ranges are supported. Eg. "ab c d e-k".
     *
     * @param {string} filter The list of quickmarks to delete.
     *
     */
    remove: function remove(filter) {
        let pattern = RegExp("[" + filter.replace(/\s+/g, "") + "]");

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
     * Opens the URL referenced by the specified <b>qmark</b>.
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
     * Lists all quickmarks matching <b>filter</b> in the message window.
     *
     * @param {string} filter The list of quickmarks to display. Eg. "abc"
     * Ranges are not supported.
     */
    // FIXME: filter should match that of quickmarks.remove or vice versa
    list: function list(filter) {
        let marks = [k for ([k, v] in this._qmarks)];
        let lowercaseMarks = marks.filter(function (x) /[a-z]/.test(x)).sort();
        let uppercaseMarks = marks.filter(function (x) /[A-Z]/.test(x)).sort();
        let numberMarks    = marks.filter(function (x) /[0-9]/.test(x)).sort();

        marks = Array.concat(lowercaseMarks, uppercaseMarks, numberMarks);

        dactyl.assert(marks.length > 0, "No QuickMarks set");

        if (filter.length > 0) {
            marks = marks.filter(function (qmark) filter.indexOf(qmark) >= 0);
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
                completer: function (context) {
                    context.title = ["QuickMark", "URL"];
                    context.completions = this._qmarks;
                },
                literal: 0
            });

        commands.add(["qma[rk]"],
            "Mark a URL with a letter for quick access",
            function (args) {
                if (!/^[a-zA-Z0-9]$/.test(args[0]))
                    dactyl.echoerr("E488: Trailing characters");
                else if (!args[1])
                    quickmarks.add(args[0], buffer.URL);
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
            "Show all QuickMarks",
            function (args) {
                args = args[0] || "";

                // ignore invalid qmark characters unless there are no valid qmark chars
                dactyl.assert(!args || /[a-zA-Z0-9]/.test(args), "E283: No QuickMarks matching " + args.quote());

                let filter = args.replace(/[^a-zA-Z0-9]/g, "");
                quickmarks.list(filter);
            }, {
                literal: 0
            });
    },
    completion: function () {
        completion.quickmark = function (context) {
            context.title = ["QuickMark", "URL"];
            context.generate = function () Iterator(quickmarks._qmarks);
        }
    },
    mappings: function () {
        var myModes = config.browserModes;

        mappings.add(myModes,
            ["go"], "Jump to a QuickMark",
            function (arg) { quickmarks.jumpTo(arg, dactyl.CURRENT_TAB); },
            { arg: true });

        mappings.add(myModes,
            ["gn"], "Jump to a QuickMark in a new tab",
            function (arg) { quickmarks.jumpTo(arg, { from: "quickmark", where: dactyl.NEW_TAB }); },
            { arg: true });

        mappings.add(myModes,
            ["M"], "Add new QuickMark for current URL",
            function (arg) {
                dactyl.assert(/^[a-zA-Z0-9]$/.test(arg));
                quickmarks.add(arg, buffer.URL);
            },
            { arg: true });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
