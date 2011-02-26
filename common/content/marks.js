// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/**
 * @scope modules
 * @instance marks
 */
var Marks = Module("marks", {
    init: function init() {
        this._localMarks = storage.newMap("local-marks", { privateData: true, replacer: Storage.Replacer.skipXpcom, store: true });
        this._urlMarks = storage.newMap("url-marks", { privateData: true, replacer: Storage.Replacer.skipXpcom, store: true });

        try {
            if (isArray(Iterator(this._localMarks).next()[1]))
                this._localMarks.clear();
        }
        catch (e) {}

        this._pendingJumps = [];
    },

    /**
     * @property {Array} Returns all marks, both local and URL, in a sorted
     *     array.
     */
    get all() iter(this._localMarks.get(this.localURI) || {},
                   this._urlMarks
                  ).sort(function (a, b) String.localeCompare(a[0], b[0])),

    get localURI() buffer.focusedFrame.document.documentURI,

    /**
     * Add a named mark for the current buffer, at its current position.
     * If mark matches [A-Z], it's considered a URL mark, and will jump to
     * the same position at the same URL no matter what buffer it's
     * selected from. If it matches [a-z], it's a local mark, and can
     * only be recalled from a buffer with a matching URL.
     *
     * @param {string} mark The mark name.
     * @param {boolean} silent Whether to output error messages.
     */
    add: function (mark, silent) {
        let win = buffer.focusedFrame;
        let doc = win.document;

        let position = { x: buffer.scrollXPercent / 100, y: buffer.scrollYPercent / 100 };

        if (Marks.isURLMark(mark)) {
            let res = this._urlMarks.set(mark, { location: doc.documentURI, position: position, tab: Cu.getWeakReference(tabs.getTab()), timestamp: Date.now()*1000 });
            if (!silent)
                dactyl.log("Adding URL mark: " + Marks.markToString(mark, res), 5);
        }
        else if (Marks.isLocalMark(mark)) {
            let marks = this._localMarks.get(doc.documentURI, {});
            marks[mark] = { location: doc.documentURI, position: position, timestamp: Date.now()*1000 };
            this._localMarks.changed();
            if (!silent)
                dactyl.log("Adding local mark: " + Marks.markToString(mark, marks[mark]), 5);
        }
    },

    /**
     * Remove all marks matching *filter*. If *special* is given, removes all
     * local marks.
     *
     * @param {string} filter The list of marks to delete, e.g. "aA b C-I"
     * @param {boolean} special Whether to delete all local marks.
     */
    remove: function (filter, special) {
        if (special)
            this._localMarks.remove(this.localURI);
        else {
            let pattern = util.charListToRegexp(filter, "a-zA-Z");
            let local = this._localMarks.get(this.localURI);
            this.all.forEach(function ([k, ]) {
                if (pattern.test(k)) {
                    local && delete local[k];
                    marks._urlMarks.remove(k);
                }
            });
            try {
                Iterator(local).next();
                this._localMarks.changed();
            }
            catch (e) {
                this._localMarks.remove(this.localURI);
            }
        }
    },

    /**
     * Jumps to the named mark. See {@link #add}
     *
     * @param {string} char The mark to jump to.
     */
    jumpTo: function (char) {
        if (Marks.isURLMark(char)) {
            let mark = this._urlMarks.get(char);
            dactyl.assert(mark, _("mark.unset", char));

            let tab = mark.tab && mark.tab.get();
            if (!tab || !tab.linkedBrowser || tabs.allTabs.indexOf(tab) == -1)
                for ([, tab] in iter(tabs.visibleTabs, tabs.allTabs)) {
                    if (tab.linkedBrowser.contentDocument.documentURI === mark.location)
                        break;
                    tab = null;
                }

            if (tab) {
                tabs.select(tab);
                let doc = tab.linkedBrowser.contentDocument;
                if (doc.documentURI == mark.location) {
                    dactyl.log("Jumping to URL mark: " + Marks.markToString(char, mark), 5);
                    buffer.scrollToPercent(mark.position.x * 100, mark.position.y * 100);
                }
                else {
                    this._pendingJumps.push(mark);

                    let sh = tab.linkedBrowser.sessionHistory;
                    let items = array(util.range(0, sh.count));

                    let a = items.slice(0, sh.index).reverse();
                    let b = items.slice(sh.index);
                    a.length = b.length = Math.max(a.length, b.length);
                    items = array(a).zip(b).flatten().compact();

                    for (let i in items.iterValues()) {
                        let entry = sh.getEntryAtIndex(i, false);
                        if (entry.URI.spec.replace(/#.*/, "") == mark.location)
                            return void tab.linkedBrowser.webNavigation.gotoIndex(i);
                    }
                    dactyl.open(mark.location);
                }
            }
            else {
                this._pendingJumps.push(mark);
                dactyl.open(mark.location, dactyl.NEW_TAB);
            }
        }
        else if (Marks.isLocalMark(char)) {
            let mark = (this._localMarks.get(this.localURI) || {})[char];
            dactyl.assert(mark, _("mark.unset", char));

            dactyl.log("Jumping to local mark: " + Marks.markToString(char, mark), 5);
            buffer.scrollToPercent(mark.position.x * 100, mark.position.y * 100);
        }
        else
            dactyl.echoerr(_("mark.invalid"));

    },

    /**
     * List all marks matching *filter*.
     *
     * @param {string} filter List of marks to show, e.g. "ab A-I".
     */
    list: function (filter) {
        let marks = this.all;

        dactyl.assert(marks.length > 0, _("mark.none"));

        if (filter.length > 0) {
            let pattern = util.charListToRegexp(filter, "a-zA-Z");
            marks = marks.filter(function ([k, ]) pattern.test(k));
            dactyl.assert(marks.length > 0, _("mark.noMatching", filter.quote()));
        }

        commandline.commandOutput(
            template.tabular(
                ["Mark",   "HPos",              "VPos",              "File"],
                ["",       "text-align: right", "text-align: right", "color: green"],
                ([mark[0],
                  Math.round(mark[1].position.x * 100) + "%",
                  Math.round(mark[1].position.y * 100) + "%",
                  mark[1].location]
                  for ([, mark] in Iterator(marks)))));
    },

    _onPageLoad: function _onPageLoad(event) {
        let win = event.originalTarget.defaultView;
        for (let [i, mark] in Iterator(this._pendingJumps)) {
            if (win && win.location.href == mark.location) {
                buffer.scrollToPercent(mark.position.x * 100, mark.position.y * 100);
                this._pendingJumps.splice(i, 1);
                return;
            }
        }
    },
}, {
    markToString: function markToString(name, mark) {
        let tab = mark.tab && mark.tab.get();
        return name + ", " + mark.location +
                ", (" + Math.round(mark.position.x * 100) +
                "%, " + Math.round(mark.position.y * 100) + "%)" +
                (tab ? ", tab: " + tabs.index(tab) : "");
    },

    isLocalMark: function isLocalMark(mark) /^[a-z`']$/.test(mark),

    isURLMark: function isURLMark(mark) /^[A-Z]$/.test(mark)
}, {
    events: function () {
        let appContent = document.getElementById("appcontent");
        if (appContent)
            events.listen(appContent, "load", marks.closure._onPageLoad, true);
    },
    mappings: function () {
        var myModes = config.browserModes;

        mappings.add(myModes,
            ["m"], "Set mark at the cursor position",
            function ({ arg }) {
                dactyl.assert(/^[a-zA-Z]$/.test(arg), _("mark.invalid"));
                marks.add(arg);
            },
            { arg: true });

        mappings.add(myModes,
            ["'", "`"], "Jump to the mark in the current buffer",
            function ({ arg }) { marks.jumpTo(arg); },
            { arg: true });
    },

    commands: function () {
        commands.add(["delm[arks]"],
            "Delete the specified marks",
            function (args) {
                let special = args.bang;
                let arg = args[0] || "";

                // assert(special ^ args)
                dactyl.assert( special ||  arg, _("error.argumentRequired"));
                dactyl.assert(!special || !arg, _("error.invalidArgument"));

                marks.remove(arg, special);
            },
            {
                bang: true,
                completer: function (context) completion.mark(context),
                literal: 0
            });

        commands.add(["ma[rk]"],
            "Mark current location within the web page",
            function (args) {
                let mark = args[0] || "";
                dactyl.assert(mark.length <= 1, _("error.trailing"));
                dactyl.assert(/[a-zA-Z]/.test(mark), _("mark.invalid"));

                marks.add(mark);
            },
            { argCount: "1" });

        commands.add(["marks"],
            "Show the specified marks",
            function (args) {
                marks.list(args[0] || "");
            }, {
                completer: function (context) completion.mark(context),
                literal: 0
            });
    },

    completion: function () {
        completion.mark = function mark(context) {
            function percent(i) Math.round(i * 100);

            // FIXME: Line/Column doesn't make sense with %
            context.title = ["Mark", "HPos VPos File"];
            context.keys.description = function ([, m]) percent(m.position.x) + "% " + percent(m.position.y) + "% " + m.location;
            context.completions = marks.all;
        };
    },
    sanitizer: function () {
        sanitizer.addItem("marks", {
            description: "Local and URL marks",
            persistent: true,
            contains: ["history"],
            action: function (timespan, host) {
                function matchhost(url) !host || util.isDomainURL(url, host);
                function match(marks) (k for ([k, v] in Iterator(marks)) if (timespan.contains(v.timestamp) && matchhost(v.location)));

                for (let [url, local] in marks._localMarks)
                    if (matchhost(url)) {
                        for (let key in match(local))
                            delete local[key];
                        if (!Object.keys(local).length)
                            marks._localMarks.remove(url);
                    }
                marks._localMarks.changed();

                for (let key in match(marks._urlMarks))
                    marks._urlMarks.remove(key);
            }
        });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
