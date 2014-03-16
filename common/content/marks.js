// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
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
                  ).sort((a, b) => String.localeCompare(a[0], b[0])),

    get localURI() buffer.focusedFrame.document.documentURI.replace(/#.*/, ""),

    Mark: function Mark(params={}) {
        let win = buffer.focusedFrame;
        let doc = win.document;

        params.location = doc.documentURI.replace(/#.*/, ""),
        params.offset = buffer.scrollPosition;
        params.path = DOM(buffer.findScrollable(0, false)).xpath;
        params.timestamp = Date.now() * 1000;
        params.equals = function (m) this.location == m.location
                                  && this.offset.x == m.offset.x
                                  && this.offset.y == m.offset.y
                                  && this.path == m.path;
        return params;
    },

    /**
     * Add a named mark for the current buffer, at its current position.
     * If mark matches [A-Z], it's considered a URL mark, and will jump to
     * the same position at the same URL no matter what buffer it's
     * selected from. If it matches [a-z], it's a local mark, and can
     * only be recalled from a buffer with a matching URL.
     *
     * @param {string} name The mark name.
     * @param {boolean} silent Whether to output error messages.
     */
    add: function (name, silent) {
        let mark = this.Mark();

        if (Marks.isURLMark(name)) {
            // FIXME: Disabled due to cross-compartment magic.
            // mark.tab = util.weakReference(tabs.getTab());
            this._urlMarks.set(name, mark);
            var message = "mark.addURL";
        }
        else if (Marks.isLocalMark(name)) {
            this._localMarks.get(mark.location, {})[name] = mark;
            this._localMarks.changed();
            message = "mark.addLocal";
        }

        if (!silent)
            dactyl.log(_(message, Marks.markToString(name, mark)), 5);
        return mark;
    },

    /**
     * Push the current buffer position onto the jump stack.
     *
     * @param {string} reason The reason for this scroll event. Multiple
     *      scroll events for the same reason are coalesced. @optional
     */
    push: function push(reason) {
        let store = buffer.localStore;
        let jump  = store.jumps[store.jumpsIndex];

        if (reason && jump && jump.reason == reason)
            return;

        let mark = this.add("'");
        if (jump && mark.equals(jump.mark))
            return;

        if (!this.jumping) {
            store.jumps[++store.jumpsIndex] = { mark: mark, reason: reason };
            store.jumps.length = store.jumpsIndex + 1;

            if (store.jumps.length > this.maxJumps) {
                store.jumps = store.jumps.slice(-this.maxJumps);
                store.jumpsIndex = store.jumps.length - 1;
            }
        }
    },

    maxJumps: 200,

    /**
     * Jump to the given offset in the jump stack.
     *
     * @param {number} offset The offset from the current position in
     *      the jump stack to jump to.
     * @returns {number} The actual change in offset.
     */
    jump: function jump(offset) {
        let store = buffer.localStore;
        if (offset < 0 && store.jumpsIndex == store.jumps.length - 1)
            this.push();

        return this.withSavedValues(["jumping"], function _jump() {
            this.jumping = true;
            let idx = Math.constrain(store.jumpsIndex + offset, 0, store.jumps.length - 1);
            let orig = store.jumpsIndex;

            if (idx in store.jumps && !dactyl.trapErrors("_scrollTo", this, store.jumps[idx].mark))
                store.jumpsIndex = idx;
            return store.jumpsIndex - orig;
        });
    },

    get jumps() {
        let store = buffer.localStore;
        return {
            index: store.jumpsIndex,
            locations: store.jumps.map(j => j.mark)
        };
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
                    if (tab.linkedBrowser.contentDocument.documentURI.replace(/#.*/, "") === mark.location)
                        break;
                    tab = null;
                }

            if (tab) {
                tabs.select(tab);
                let doc = tab.linkedBrowser.contentDocument;
                if (doc.documentURI.replace(/#.*/, "") == mark.location) {
                    dactyl.log(_("mark.jumpingToURL", Marks.markToString(char, mark)), 5);
                    this._scrollTo(mark);
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

            dactyl.log(_("mark.jumpingToLocal", Marks.markToString(char, mark)), 5);
            this._scrollTo(mark);
        }
        else
            dactyl.echoerr(_("mark.invalid"));

    },

    _scrollTo: function _scrollTo(mark) {
        if (!mark.path)
            var node = buffer.findScrollable(0, (mark.offset || mark.position).x);
        else
            for (node in DOM.XPath(mark.path, buffer.focusedFrame.document))
                break;

        util.assert(node);
        if (node instanceof Element)
            DOM(node).scrollIntoView();

        if (mark.offset)
            Buffer.scrollToPosition(node, mark.offset.x, mark.offset.y);
        else if (mark.position)
            Buffer.scrollToPercent(node, mark.position.x * 100, mark.position.y * 100);
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
            marks = marks.filter(([k]) => (pattern.test(k)));
            dactyl.assert(marks.length > 0, _("mark.noMatching", filter.quote()));
        }

        commandline.commandOutput(
            template.tabular(
                ["Mark",   "HPos",              "VPos",              "File"],
                ["",       "text-align: right", "text-align: right", "color: green"],
                ([name,
                  mark.offset ? Math.round(mark.offset.x)
                              : Math.round(mark.position.x * 100) + "%",
                  mark.offset ? Math.round(mark.offset.y)
                              : Math.round(mark.position.y * 100) + "%",
                  mark.location]
                  for ([, [name, mark]] in Iterator(marks)))));
    },

    _onPageLoad: function _onPageLoad(event) {
        let win = event.originalTarget.defaultView;
        for (let [i, mark] in Iterator(this._pendingJumps)) {
            if (win && win.location.href == mark.location) {
                this._scrollTo(mark);
                this._pendingJumps.splice(i, 1);
                return;
            }
        }
    },
}, {
    markToString: function markToString(name, mark) {
        let tab = mark.tab && mark.tab.get();
        if (mark.offset)
            return [name, mark.location,
                    "(" + Math.round(mark.offset.x * 100),
                          Math.round(mark.offset.y * 100) + ")",
                    (tab && "tab: " + tabs.index(tab))
            ].filter(util.identity).join(", ");

        if (mark.position)
            return [name, mark.location,
                    "(" + Math.round(mark.position.x * 100) + "%",
                          Math.round(mark.position.y * 100) + "%)",
                    (tab && "tab: " + tabs.index(tab))
            ].filter(util.identity).join(", ");
    },

    isLocalMark: bind("test", /^[a-z`']$/),

    isURLMark: bind("test", /^[A-Z]$/)
}, {
    events: function () {
        let appContent = document.getElementById("appcontent");
        if (appContent)
            events.listen(appContent, "load", marks.bound._onPageLoad, true);
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

    commands: function initCommands() {
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
                dactyl.assert(mark.length <= 1, _("error.trailingCharacters"));
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

    completion: function initCompletion() {
        completion.mark = function mark(context) {
            function percent(i) Math.round(i * 100);

            context.title = ["Mark", "HPos VPos File"];
            context.keys.description = ([, m]) => (m.offset ? Math.round(m.offset.x) + " " + Math.round(m.offset.y)
                                                            : percent(m.position.x) + "% " + percent(m.position.y) + "%"
                                                  ) + " " + m.location;
            context.completions = marks.all;
        };
    },
    sanitizer: function initSanitizer() {
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

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
