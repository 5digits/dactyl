// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2009 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/**
* @instance quickmarks
*/
const QuickMarks = Module("quickmarks", {
    requires: ["config", "storage"],

    init: function () {
        this._qmarks = storage.newMap("quickmarks", { store: true });
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
        liberator.echomsg("Added Quick Mark '" + qmark + "': " + location, 1);
    },

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
     * @param {number} where A constant describing where to open the page.
     *     See {@link Liberator#open}.
     */
    jumpTo: function jumpTo(qmark, where) {
        let url = this._qmarks.get(qmark);

        if (url)
            liberator.open(url, where);
        else
            liberator.echoerr("E20: QuickMark not set");
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

        liberator.assert(marks.length > 0, "No QuickMarks set");

        if (filter.length > 0) {
            marks = marks.filter(function (qmark) filter.indexOf(qmark) >= 0);
            liberator.assert(marks.length >= 0, "E283: No QuickMarks matching \"" + filter + "\"");
        }

        let items = [[mark, this._qmarks.get(mark)] for ([k, mark] in Iterator(marks))];
        template.genericTable(items, { title: ["QuickMark", "URL"] });
    }
}, {
}, {
    commands: function () {
        commands.add(["delqm[arks]"],
            "Delete the specified QuickMarks",
            function (args) {
                // TODO: finish arg parsing - we really need a proper way to do this. :)
                // assert(args.bang ^ args.string)
                liberator.assert( args.bang ||  args.string, "E471: Argument required");
                liberator.assert(!args.bang || !args.string, "E474: Invalid argument");

                if (args.bang)
                    quickmarks.removeAll();
                else
                    quickmarks.remove(args.string);
            },
            {
                bang: true,
                completer: function (context) {
                    context.title = ["QuickMark", "URL"];
                    context.completions = this._qmarks;
                }
            });

        commands.add(["qma[rk]"],
            "Mark a URL with a letter for quick access",
            function (args) {
                let matches = args.string.match(/^([a-zA-Z0-9])(?:\s+(.+))?$/);
                if (!matches)
                    liberator.echoerr("E488: Trailing characters");
                else if (!matches[2])
                    quickmarks.add(matches[1], buffer.URL);
                else
                    quickmarks.add(matches[1], matches[2]);
            },
            { argCount: "+" });

        commands.add(["qmarks"],
            "Show all QuickMarks",
            function (args) {
                args = args.string;

                // ignore invalid qmark characters unless there are no valid qmark chars
                liberator.assert(!args || /[a-zA-Z0-9]/.test(args), "E283: No QuickMarks matching \"" + args + "\"");

                let filter = args.replace(/[^a-zA-Z0-9]/g, "");
                quickmarks.list(filter);
            });
    },
    mappings: function () {
        var myModes = config.browserModes;

        mappings.add(myModes,
            ["go"], "Jump to a QuickMark",
            function (arg) { quickmarks.jumpTo(arg, liberator.CURRENT_TAB); },
            { arg: true });

        mappings.add(myModes,
            ["gn"], "Jump to a QuickMark in a new tab",
            function (arg) {
                quickmarks.jumpTo(arg,
                    /\bquickmark\b/.test(options["activate"]) ?
                    liberator.NEW_TAB : liberator.NEW_BACKGROUND_TAB);
            },
            { arg: true });

        mappings.add(myModes,
            ["M"], "Add new QuickMark for current URL",
            function (arg) {
                liberator.assert(/^[a-zA-Z0-9]$/.test(arg));
                quickmarks.add(arg, buffer.URL);
            },
            { arg: true });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
