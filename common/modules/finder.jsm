// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("finder", {
    exports: ["RangeFind", "RangeFinder", "rangefinder"],
    require: ["prefs", "util"]
});

lazyRequire("buffer", ["Buffer"]);
lazyRequire("overlay", ["overlay"]);

function id(w) w.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils)
                .outerWindowID;
function equals(a, b) id(a) == id(b);

/** @instance rangefinder */
var RangeFinder = Module("rangefinder", {
    Local: function (dactyl, modules, window) ({
        init: function () {
            this.dactyl = dactyl;
            this.modules = modules;
            this.window = window;
            this.lastFindPattern = "";
        },

        get content() {
            let { window } = this.modes.getStack(0).params;
            return window || this.window.content;
        },

        get rangeFind() {
            let find = overlay.getData(this.content.document,
                                       "range-find", null);

            if (!isinstance(find, RangeFind) || find.stale)
                return this.rangeFind = null;
            return find;
        },
        set rangeFind(val) overlay.setData(this.content.document,
                                           "range-find", val)
    }),

    init: function init() {
        prefs.safeSet("accessibility.typeaheadfind.autostart", false);
        // The above should be sufficient, but: http://bugzil.la/348187
        prefs.safeSet("accessibility.typeaheadfind", false);
    },

    cleanup: function cleanup() {
        for (let doc in util.iterDocuments()) {
            let find = overlay.getData(doc, "range-find", null);
            if (find)
                find.highlight(true);

            overlay.setData(doc, "range-find", null);
        }
    },

    get commandline() this.modules.commandline,
    get modes() this.modules.modes,
    get options() this.modules.options,

    openPrompt: function openPrompt(mode) {
        this.modules.marks.push();
        this.commandline;
        this.CommandMode(mode, this.content).open();

        Buffer(this.content).resetCaret();

        if (this.rangeFind && equals(this.rangeFind.window.get(), this.window))
            this.rangeFind.reset();
        this.find("", mode == this.modes.FIND_BACKWARD);
    },

    bootstrap: function bootstrap(str, backward=this.rangeFind && this.rangeFind.reverse) {

        let highlighted = this.rangeFind && this.rangeFind.highlighted;
        let selections = this.rangeFind && this.rangeFind.selections;
        let linksOnly = false;
        let regexp = false;
        let matchCase = this.options["findcase"] === "smart"  ? /[A-Z]/.test(str) :
                        this.options["findcase"] === "ignore" ? false : true;

        function replacer(m, n1) {
            if (n1 == "c")
                matchCase = false;
            else if (n1 == "C")
                matchCase = true;
            else if (n1 == "l")
                linksOnly = true;
            else if (n1 == "L")
                linksOnly = false;
            else if (n1 == "r")
                regexp = true;
            else if (n1 == "R")
                regexp = false;
            else
                return m;
            return "";
        }

        this.options["findflags"].forEach(f => replacer(f, f));

        let pattern = str.replace(/\\(.|$)/g, replacer);

        if (str)
            this.lastFindPattern = str;
        // It's possible, with :tabdetach for instance, for the rangeFind to
        // actually move from one window to another, which breaks things.
        if (!this.rangeFind
            || !equals(this.rangeFind.window.get(), this.window)
            || linksOnly  != !!this.rangeFind.elementPath
            || regexp     != this.rangeFind.regexp
            || matchCase  != this.rangeFind.matchCase
            || !!backward != this.rangeFind.reverse) {

            if (this.rangeFind)
                this.rangeFind.cancel();
            this.rangeFind = null;
            this.rangeFind = RangeFind(this.window, this.content, matchCase, backward,
                                       linksOnly && this.options.get("hinttags").matcher,
                                       regexp);
            this.rangeFind.highlighted = highlighted;
            this.rangeFind.selections = selections;
        }
        this.rangeFind.pattern = str;
        return pattern;
    },

    find: function find(pattern, backwards) {
        this.modules.marks.push();
        let str = this.bootstrap(pattern, backwards);
        this.backward = this.rangeFind.reverse;

        if (!this.rangeFind.find(str))
            this.dactyl.echoerr(_("finder.notFound", pattern),
                                this.commandline.FORCE_SINGLELINE);

        return this.rangeFind.found;
    },

    findAgain: function findAgain(reverse) {
        this.modules.marks.push();
        if (!this.rangeFind)
            this.find(this.lastFindPattern);
        else if (!this.rangeFind.find(null, reverse))
            this.dactyl.echoerr(_("finder.notFound", this.lastFindPattern),
                                this.commandline.FORCE_SINGLELINE);
        else if (this.rangeFind.wrapped) {
            let msg = this.rangeFind.backward ? _("finder.atTop")
                                              : _("finder.atBottom");
            this.commandline.echo(msg, "WarningMsg", this.commandline.APPEND_TO_MESSAGES
                                                   | this.commandline.FORCE_SINGLELINE);
        }
        else
            this.commandline.echo((this.rangeFind.backward ? "?" : "/") + this.rangeFind.pattern,
                                  "Normal", this.commandline.FORCE_SINGLELINE);

        if (this.options["hlfind"])
            this.highlight();
        this.rangeFind.focus();
    },

    onCancel: function onCancel() {
        if (this.rangeFind)
            this.rangeFind.cancel();
    },

    onChange: function onChange(command) {
        if (this.options["incfind"]) {
            command = this.bootstrap(command);
            this.rangeFind.find(command);
        }
    },

    onHistory: function onHistory() {
        this.rangeFind.found = false;
    },

    onSubmit: function onSubmit(command) {
        if (!command && this.lastFindPattern) {
            this.find(this.lastFindPattern, this.backward);
            this.findAgain();
            return;
        }

        if (!this.options["incfind"] || !this.rangeFind || !this.rangeFind.found) {
            this.clear();
            this.find(command || this.lastFindPattern, this.backward);
        }

        if (this.options["hlfind"])
            this.highlight();
        this.rangeFind.focus();
    },

    /**
     * Highlights all occurrences of the last sought for string in the
     * current buffer.
     */
    highlight: function highlight() {
        if (this.rangeFind)
            this.rangeFind.highlight();
    },

    /**
     * Clears all find highlighting.
     */
    clear: function clear() {
        if (this.rangeFind)
            this.rangeFind.highlight(true);
    }
}, {
}, {
    modes: function initModes(dactyl, modules, window) {
        initModes.require("commandline");

        const { modes } = modules;

        modes.addMode("FIND", {
            description: "Find mode, active when typing search input",
            bases: [modes.COMMAND_LINE]
        });
        modes.addMode("FIND_FORWARD", {
            description: "Forward Find mode, active when typing search input",
            bases: [modes.FIND]
        });
        modes.addMode("FIND_BACKWARD", {
            description: "Backward Find mode, active when typing search input",
            bases: [modes.FIND]
        });
    },
    commands: function initCommands(dactyl, modules, window) {
        const { commands, rangefinder } = modules;
        commands.add(["noh[lfind]"],
            "Remove the find highlighting",
            function () { rangefinder.clear(); },
            { argCount: "0" });
    },
    commandline: function initCommandline(dactyl, modules, window) {
        const { rangefinder } = modules;
        rangefinder.CommandMode = Class("CommandFindMode", modules.CommandMode, {
            init: function init(mode, window) {
                this.mode = mode;
                this.window = window;
                init.supercall(this);
            },

            historyKey: "find",

            get prompt() this.mode === modules.modes.FIND_BACKWARD ? "?" : "/",

            get onCancel()  modules.rangefinder.bound.onCancel,
            get onChange()  modules.rangefinder.bound.onChange,
            get onHistory() modules.rangefinder.bound.onHistory,
            get onSubmit()  modules.rangefinder.bound.onSubmit
        });
    },
    mappings: function initMappings(dactyl, modules, window) {
        const { Buffer, buffer, config, mappings, modes, rangefinder } = modules;
        var myModes = config.browserModes.concat([modes.CARET]);

        mappings.add(myModes,
            ["/", "<find-forward>"], "Find a pattern starting at the current caret position",
            function () { rangefinder.openPrompt(modes.FIND_FORWARD); });

        mappings.add(myModes,
            ["?", "<find-backward>", "<S-Slash>"], "Find a pattern backward of the current caret position",
            function () { rangefinder.openPrompt(modes.FIND_BACKWARD); });

        mappings.add(myModes,
            ["n", "<find-next>"], "Find next",
            function () { rangefinder.findAgain(false); });

        mappings.add(myModes,
            ["N", "<find-previous>"], "Find previous",
            function () { rangefinder.findAgain(true); });

        mappings.add(myModes.concat([modes.CARET, modes.TEXT_EDIT]), ["*", "<find-word-forward>"],
            "Find word under cursor",
            function () {
                rangefinder.find(Buffer.currentWord(buffer.focusedFrame, true), false);
                rangefinder.findAgain();
            });

        mappings.add(myModes.concat([modes.CARET, modes.TEXT_EDIT]), ["#", "<find-word-backward>"],
            "Find word under cursor backwards",
            function () {
                rangefinder.find(Buffer.currentWord(buffer.focusedFrame, true), true);
                rangefinder.findAgain();
            });

    },
    options: function initOptions(dactyl, modules, window) {
        const { options, rangefinder } = modules;

        options.add(["hlfind", "hlf"],
            "Highlight all /find pattern matches on the current page after submission",
            "boolean", false, {
                setter: function (value) {
                    rangefinder[value ? "highlight" : "clear"]();
                    return value;
                }
            });

        options.add(["findcase", "fc"],
            "Find case matching mode",
            "string", "smart",
            {
                values: {
                    "smart": "Case is significant when capital letters are typed",
                    "match": "Case is always significant",
                    "ignore": "Case is never significant"
                }
            });

        options.add(["findflags", "ff"],
            "Default flags for find invocations",
            "charlist", "",
            {
                values: {
                    "c": "Ignore case",
                    "C": "Match case",
                    "r": "Perform a regular expression search",
                    "R": "Perform a plain string search",
                    "l": "Search only in links",
                    "L": "Search all text"
                }
            });

        options.add(["incfind", "if"],
            "Find a pattern incrementally as it is typed rather than awaiting c_<Return>",
            "boolean", true);
    }
});

/**
 * @class RangeFind
 *
 * A fairly sophisticated typeahead-find replacement. It supports
 * incremental find very much as the builtin component.
 * Additionally, it supports several features impossible to
 * implement using the standard component. Incremental finding
 * works both forwards and backwards. Erasing characters during an
 * incremental find moves the selection back to the first
 * available match for the shorter term. The selection and viewport
 * are restored when the find is canceled.
 *
 * Also, in addition to full support for frames and iframes, this
 * implementation will begin finding from the position of the
 * caret in the last active frame. This is contrary to the behavior
 * of the builtin component, which always starts a find from the
 * beginning of the first frame in the case of frameset documents,
 * and cycles through all frames from beginning to end. This makes it
 * impossible to choose the starting point of a find for such
 * documents, and represents a major detriment to productivity where
 * large amounts of data are concerned (e.g., for API documents).
 */
var RangeFind = Class("RangeFind", {
    init: function init(window, content, matchCase, backward, elementPath, regexp) {
        this.window = util.weakReference(window);
        this.content = content;

        this.baseDocument = util.weakReference(this.content.document);
        this.elementPath = elementPath || null;
        this.reverse = Boolean(backward);

        this.finder = services.Find();
        this.matchCase = Boolean(matchCase);
        this.regexp = Boolean(regexp);

        this.reset();

        this.highlighted = null;
        this.selections = [];
        this.lastString = "";
    },

    get store() overlay.getData(this.content.document, "buffer", Object),

    get backward() this.finder.findBackwards,
    set backward(val) this.finder.findBackwards = val,

    get matchCase() this.finder.caseSensitive,
    set matchCase(val) this.finder.caseSensitive = Boolean(val),

    get findString() this.lastString,

    get flags() this.matchCase ? "" : "i",

    get selectedRange() {
        let win = this.store.focusedFrame && this.store.focusedFrame.get() || this.content;

        let selection = win.getSelection();
        return (selection.rangeCount ? selection.getRangeAt(0) : this.ranges[0].range).cloneRange();
    },
    set selectedRange(range) {
        this.range.selection.removeAllRanges();
        this.range.selection.addRange(range);
        this.range.selectionController.scrollSelectionIntoView(
            this.range.selectionController.SELECTION_NORMAL, 0, false);

        this.store.focusedFrame = util.weakReference(range.startContainer.ownerDocument.defaultView);
    },

    cancel: function cancel() {
        this.purgeListeners();
        if (this.range) {
            this.range.deselect();
            this.range.descroll();
        }
    },

    compareRanges: function compareRanges(r1, r2) {
        try {
            return this.backward ?  r1.compareBoundaryPoints(r1.END_TO_START, r2)
                                 : -r1.compareBoundaryPoints(r1.START_TO_END, r2);
        }
        catch (e) {
            util.reportError(e);
            return 0;
        }
    },

    findRange: function findRange(range) {
        let doc = range.startContainer.ownerDocument;
        let win = doc.defaultView;
        let ranges = this.ranges.filter(r =>
            r.window === win && RangeFind.sameDocument(r.range, range) && RangeFind.contains(r.range, range));

        if (this.backward)
            return ranges[ranges.length - 1];
        return ranges[0];
    },

    findSubRanges: function findSubRanges(range) {
        let doc = range.startContainer.ownerDocument;
        for (let elem in this.elementPath(doc)) {
            let r = RangeFind.nodeRange(elem);
            if (RangeFind.contains(range, r))
                yield r;
        }
    },

    focus: function focus() {
        if (this.lastRange)
            var node = DOM.XPath(RangeFind.selectNodePath,
                                 this.lastRange.commonAncestorContainer).snapshotItem(0);
        if (node) {
            node.focus();
            // Re-highlight collapsed selection
            this.selectedRange = this.lastRange;
        }
    },

    highlight: function highlight(clear) {
        if (!clear && (!this.lastString || this.lastString == this.highlighted))
            return;
        if (clear && !this.highlighted)
            return;

        if (!clear && this.highlighted)
            this.highlight(true);

        if (clear) {
            this.selections.forEach(function (selection) {
                selection.removeAllRanges();
            });
            this.selections = [];
            this.highlighted = null;
        }
        else {
            this.selections = [];
            let string = this.lastString;
            for (let r in this.iter(string)) {
                let controller = this.range.selectionController;
                for (let node = r.startContainer; node; node = node.parentNode)
                    if (node instanceof Ci.nsIDOMNSEditableElement) {
                        controller = node.editor.selectionController;
                        break;
                    }

                let sel = controller.getSelection(Ci.nsISelectionController.SELECTION_FIND);
                sel.addRange(r);
                if (this.selections.indexOf(sel) < 0)
                    this.selections.push(sel);
            }
            this.highlighted = this.lastString;
            if (this.lastRange)
                this.selectedRange = this.lastRange;
            this.addListeners();
        }
    },

    indexIter: function indexIter(private_) {
        let idx = this.range.index;
        if (this.backward)
            var groups = [util.range(idx + 1, 0, -1), util.range(this.ranges.length, idx, -1)];
        else
            var groups = [util.range(idx, this.ranges.length), util.range(0, idx + 1)];

        for (let i in groups[0])
            yield i;

        if (!private_) {
            this.wrapped = true;
            this.lastRange = null;
            for (let i in groups[1])
                yield i;
        }
    },

    iter: function iter(word) {
        let saved = ["lastRange", "lastString", "range", "regexp"].map(s => [s, this[s]]);
        let res;
        try {
            let regexp = this.regexp && word != util.regexp.escape(word);
            this.lastRange = null;
            this.regexp = false;
            if (regexp) {
                let re = RegExp(word, "gm" + this.flags);
                for (this.range in array.iterValues(this.ranges)) {
                    for (let match in util.regexp.iterate(re, DOM.stringify(this.range.range, true))) {
                        let lastRange = this.lastRange;
                        if (res = this.find(null, this.reverse, true))
                            yield res;
                        else
                            this.lastRange = lastRange;
                    }
                }
            }
            else {
                this.range = this.ranges[0];
                this.lastString = word;
                while (res = this.find(null, this.reverse, true))
                    yield res;
            }
        }
        finally {
            saved.forEach(([k, v]) => { this[k] = v; });
        }
    },

    makeFrameList: function makeFrameList(win) {
        const self = this;
        win = win.top;
        let frames = [];
        let backup = null;

        function pushRange(start, end) {
            function push(r) {
                if (r = RangeFind.Range(r, frames.length))
                    frames.push(r);
            }

            let doc = start.startContainer.ownerDocument;

            let range = doc.createRange();
            range.setStart(start.startContainer, start.startOffset);
            range.setEnd(end.startContainer, end.startOffset);

            if (!self.elementPath)
                push(range);
            else
                for (let r in self.findSubRanges(range))
                    push(r);
        }
        function rec(win) {
            let doc = win.document;
            let pageRange = RangeFind[doc.body ? "nodeRange" : "nodeContents"](doc.body || doc.documentElement);
            backup = backup || pageRange;
            let pageStart = RangeFind.endpoint(pageRange, true);
            let pageEnd = RangeFind.endpoint(pageRange, false);

            for (let frame in array.iterValues(win.frames)) {
                let range = doc.createRange();
                if (DOM(frame.frameElement).style.visibility == "visible") {
                    range.selectNode(frame.frameElement);
                    pushRange(pageStart, RangeFind.endpoint(range, true));
                    pageStart = RangeFind.endpoint(range, false);
                    rec(frame);
                }
            }
            pushRange(pageStart, pageEnd);

            let anonNodes = doc.getAnonymousNodes(doc.documentElement);
            if (anonNodes) {
                for (let [, elem] in iter(anonNodes)) {
                    let range = RangeFind.nodeContents(elem);
                    pushRange(RangeFind.endpoint(range, true), RangeFind.endpoint(range, false));
                }
            }
        }
        rec(win);
        if (frames.length == 0)
            frames[0] = RangeFind.Range(RangeFind.endpoint(backup, true), 0);
        return frames;
    },

    reset: function reset() {
        this.ranges = this.makeFrameList(this.content);

        this.startRange = this.selectedRange;
        this.startRange.collapse(!this.reverse);
        this.lastRange = this.selectedRange;
        this.range = this.findRange(this.startRange) || this.ranges[0];
        util.assert(this.range, "Null range", false);
        this.ranges.first = this.range;
        this.ranges.forEach(range => { range.save(); });
        this.forward = null;
        this.found = false;
    },

    find: function find(pattern, reverse, private_) {
        if (!private_ && this.lastRange && !RangeFind.equal(this.selectedRange, this.lastRange))
            this.reset();

        this.wrapped = false;
        this.backward = reverse ? !this.reverse : this.reverse;
        let again = pattern == null;
        if (again)
            pattern = this.lastString;
        if (!this.matchCase)
            pattern = pattern.toLowerCase();

        if (!again && (pattern === "" || !pattern.startsWith(this.lastString) || this.backward)) {
            if (!private_)
                this.range.deselect();
            if (pattern === "")
                this.range.descroll();
            this.lastRange = this.startRange;
            this.range = this.ranges.first;
        }

        let word = pattern;
        let regexp = this.regexp && word != util.regexp.escape(word);

        if (regexp)
            try {
                RegExp(pattern);
            }
            catch (e) {
                pattern = "";
            }

        if (pattern == "")
            var range = this.startRange;
        else
            for (let i in this.indexIter(private_)) {
                if (!private_ && this.range.window != this.ranges[i].window && this.range.window != this.ranges[i].window.parent) {
                    this.range.descroll();
                    this.range.deselect();
                }
                this.range = this.ranges[i];

                let start = RangeFind.sameDocument(this.lastRange, this.range.range) && this.range.intersects(this.lastRange) ?
                                RangeFind.endpoint(this.lastRange, !(again ^ this.backward)) :
                                RangeFind.endpoint(this.range.range, !this.backward);

                if (this.backward && !again)
                    start = RangeFind.endpoint(this.startRange, false);

                if (regexp) {
                    let range = this.range.range.cloneRange();
                    range[this.backward ? "setEnd" : "setStart"](
                        start.startContainer, start.startOffset);
                    range = DOM.stringify(range);

                    if (!this.backward)
                        var match = RegExp(pattern, "m" + this.flags).exec(range);
                    else {
                        match = RegExp("[^]*(?:" + pattern + ")", "m" + this.flags).exec(range);
                        if (match)
                            match = RegExp(pattern + "$", this.flags).exec(match[0]);
                    }
                    if (!(match && match[0]))
                        continue;
                    word = match[0];
                }

                var range = this.finder.Find(word, this.range.range, start, this.range.range);
                if (range && DOM(range.commonAncestorContainer).isVisible)
                    break;
            }

        if (range)
            this.lastRange = range.cloneRange();
        if (!private_) {
            this.lastString = pattern;
            if (range == null) {
                this.cancel();
                this.found = false;
                return null;
            }
            this.found = true;
        }
        if (range && (!private_ || private_ < 0))
            this.selectedRange = range;
        return range;
    },

    get stale() this._stale || this.baseDocument.get() != this.content.document,
    set stale(val) this._stale = val,

    addListeners: function addListeners() {
        for (let range in array.iterValues(this.ranges))
            range.window.addEventListener("unload", this.bound.onUnload, true);
    },
    purgeListeners: function purgeListeners() {
        for (let range in array.iterValues(this.ranges))
            try {
                range.window.removeEventListener("unload", this.bound.onUnload, true);
            }
            catch (e if e.result === Cr.NS_ERROR_FAILURE) {}
    },
    onUnload: function onUnload(event) {
        this.purgeListeners();
        if (this.highlighted)
            this.highlight(true);
        this.stale = true;
    }
}, {
    Range: Class("RangeFind.Range", {
        init: function init(range, index) {
            this.index = index;

            this.range = range;
            this.document = range.startContainer.ownerDocument;
            this.window = this.document.defaultView;

            if (this.selection == null)
                return false;

            this.save();
        },

        docShell: Class.Memoize(function () util.docShell(this.window)),

        intersects: function (range) RangeFind.intersects(this.range, range),

        save: function save() {
            this.scroll = Point(this.window.pageXOffset, this.window.pageYOffset);

            this.initialSelection = null;
            if (this.selection.rangeCount)
                this.initialSelection = this.selection.getRangeAt(0);
        },

        descroll: function descroll() {
            this.window.scrollTo(this.scroll.x, this.scroll.y);
        },

        deselect: function deselect() {
            if (this.selection) {
                this.selection.removeAllRanges();
                if (this.initialSelection)
                    this.selection.addRange(this.initialSelection);
            }
        },

        get selectionController() this.docShell
                    .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsISelectionDisplay)
                    .QueryInterface(Ci.nsISelectionController),
        get selection() {
            try {
                return this.selectionController.getSelection(Ci.nsISelectionController.SELECTION_NORMAL);
            }
            catch (e) {
                return null;
            }
        }
    }),
    contains: function contains(range, r, quiet) {
        try {
            return range.compareBoundaryPoints(range.START_TO_END, r) >= 0 &&
                   range.compareBoundaryPoints(range.END_TO_START, r) <= 0;
        }
        catch (e) {
            if (e.result != Cr.NS_ERROR_DOM_WRONG_DOCUMENT_ERR && !quiet)
                util.reportError(e, true);
            return false;
        }
    },
    containsNode: function containsNode(range, n, quiet) n.ownerDocument && this.contains(range, RangeFind.nodeRange(n), quiet),
    intersects: function intersects(range, r) {
        try {
            return r.compareBoundaryPoints(range.START_TO_END, range) >= 0 &&
                   r.compareBoundaryPoints(range.END_TO_START, range) <= 0;
        }
        catch (e) {
            util.reportError(e, true);
            return false;
        }
    },
    endpoint: function endpoint(range, before) {
        range = range.cloneRange();
        range.collapse(before);
        return range;
    },
    equal: function equal(r1, r2) {
        try {
            return !r1.compareBoundaryPoints(r1.START_TO_START, r2) && !r1.compareBoundaryPoints(r1.END_TO_END, r2);
        }
        catch (e) {
            return false;
        }
    },
    nodeContents: function nodeContents(node) {
        let range = node.ownerDocument.createRange();
        try {
            range.selectNodeContents(node);
        }
        catch (e) {}
        return range;
    },
    nodeRange: function nodeRange(node) {
        let range = node.ownerDocument.createRange();
        try {
            range.selectNode(node);
        }
        catch (e) {}
        return range;
    },
    sameDocument: function sameDocument(r1, r2) {
        if (!(r1 && r2 && r1.endContainer.ownerDocument == r2.endContainer.ownerDocument))
            return false;
        try {
            r1.compareBoundaryPoints(r1.START_TO_START, r2);
        }
        catch (e if e.result == 0x80530004 /* NS_ERROR_DOM_WRONG_DOCUMENT_ERR */) {
            return false;
        }
        return true;
    },
    selectNodePath: ["a", "xhtml:a", "*[@onclick]"].map(p => "ancestor-or-self::" + p).join(" | "),
    union: function union(a, b) {
        let start = a.compareBoundaryPoints(a.START_TO_START, b) < 0 ? a : b;
        let end   = a.compareBoundaryPoints(a.END_TO_END, b) > 0 ? a : b;
        let res   = start.cloneRange();
        res.setEnd(end.endContainer, end.endOffset);
        return res;
    }
});

// catch(e){ if (typeof e === "string") e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

endModule();

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
