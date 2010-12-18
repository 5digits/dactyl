// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/** @instance rangefinder */
const RangeFinder = Module("rangefinder", {
    init: function () {
        this.lastFindPattern = "";
    },

    openPrompt: function (mode) {
        let backwards = mode == modes.FIND_BACKWARD;
        commandline.open(backwards ? "?" : "/", "", mode);

        if (this.rangeFind && this.rangeFind.window.get() === window)
            this.rangeFind.reset();
        this.find("", backwards);
    },

    bootstrap: function (str, backward) {
        if (this.rangeFind && this.rangeFind.stale)
            this.rangeFind = null;

        let highlighted = this.rangeFind && this.rangeFind.highlighted;
        let selections = this.rangeFind && this.rangeFind.selections;
        let linksOnly = false;
        let regexp = false;
        let matchCase = options["findcase"] === "smart"  ? /[A-Z]/.test(str) :
                        options["findcase"] === "ignore" ? false : true;

        str = str.replace(/\\(.|$)/g, function (m, n1) {
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
        });

        // It's possible, with :tabdetach for instance, for the rangeFind to
        // actually move from one window to another, which breaks things.
        if (!this.rangeFind
            || this.rangeFind.window.get() != window
            || linksOnly  != !!this.rangeFind.elementPath
            || regexp     != this.rangeFind.regexp
            || matchCase  != this.rangeFind.matchCase
            || !!backward != this.rangeFind.reverse) {

            if (this.rangeFind)
                this.rangeFind.cancel();
            this.rangeFind = RangeFind(matchCase, backward, linksOnly && options["hinttags"], regexp);
            this.rangeFind.highlighted = highlighted;
            this.rangeFind.selections = selections;
        }
        return this.lastFindPattern = str;
    },

    find: function (pattern, backwards) {
        let str = this.bootstrap(pattern, backwards);
        if (!this.rangeFind.find(str))
            this.timeout(function () { dactyl.echoerr("E486: Pattern not found: " + pattern); }, 0);

        return this.rangeFind.found;
    },

    findAgain: function (reverse) {
        if (!this.rangeFind)
            this.find(this.lastFindPattern);
        else if (!this.rangeFind.find(null, reverse))
            dactyl.echoerr("E486: Pattern not found: " + this.lastFindPattern);
        else if (this.rangeFind.wrapped)
            // hack needed, because wrapping causes a "scroll" event which
            // clears our command line
            this.timeout(function () {
                let msg = this.rangeFind.backward ? "find hit TOP, continuing at BOTTOM"
                                                  : "find hit BOTTOM, continuing at TOP";
                commandline.echo(msg, commandline.HL_WARNINGMSG,
                                 commandline.APPEND_TO_MESSAGES | commandline.FORCE_SINGLELINE);
            }, 0);
        else
            commandline.echo((this.rangeFind.backward ? "?" : "/") + this.lastFindPattern, null, commandline.FORCE_SINGLELINE);

        if (options["hlfind"])
            this.highlight();
        this.rangeFind.focus();
    },

    // Called when the user types a key in the find dialog. Triggers a find attempt if 'incfind' is set
    onKeyPress: function (command) {
        if (options["incfind"]) {
            command = this.bootstrap(command);
            this.rangeFind.find(command);
        }
    },

    onSubmit: function (command) {
        if (!options["incfind"] || !this.rangeFind || !this.rangeFind.found) {
            this.clear();
            this.find(command || this.lastFindPattern, modes.extended & modes.FIND_BACKWARD);
        }

        if (options["hlfind"])
            this.highlight();
        this.rangeFind.focus();
    },

    // Called when the find is canceled - for example if someone presses
    // escape while typing a find
    onCancel: function () {
        if (this.rangeFind)
            this.rangeFind.cancel();
    },

    get rangeFind() buffer.localStore.rangeFind,
    set rangeFind(val) buffer.localStore.rangeFind = val,

    /**
     * Highlights all occurrences of the last finded for string in the
     * current buffer.
     */
    highlight: function () {
        if (this.rangeFind)
            this.rangeFind.highlight();
    },

    /**
     * Clears all find highlighting.
     */
    clear: function () {
        if (this.rangeFind)
            this.rangeFind.highlight(true);
    }
}, {
}, {
    modes: function () {
        /* Must come before commandline. */
        modes.addMode("FIND_FORWARD", true);
        modes.addMode("FIND_BACKWARD", true);
    },
    commandline: function () {
        commandline.registerCallback("change", modes.FIND_FORWARD, this.closure.onKeyPress);
        commandline.registerCallback("submit", modes.FIND_FORWARD, this.closure.onSubmit);
        commandline.registerCallback("cancel", modes.FIND_FORWARD, this.closure.onCancel);
        commandline.registerCallback("change", modes.FIND_BACKWARD, this.closure.onKeyPress);
        commandline.registerCallback("submit", modes.FIND_BACKWARD, this.closure.onSubmit);
        commandline.registerCallback("cancel", modes.FIND_BACKWARD, this.closure.onCancel);
    },
    commands: function () {
        commands.add(["noh[lfind]"],
            "Remove the find highlighting",
            function () { rangefinder.clear(); },
            { argCount: "0" });
    },
    mappings: function () {
        var myModes = config.browserModes.concat([modes.CARET]);

        mappings.add(myModes,
            ["/"], "Find a pattern starting at the current caret position",
            function () { rangefinder.openPrompt(modes.FIND_FORWARD); });

        mappings.add(myModes,
            ["?"], "Find a pattern backward of the current caret position",
            function () { rangefinder.openPrompt(modes.FIND_BACKWARD); });

        mappings.add(myModes,
            ["n"], "Find next",
            function () { rangefinder.findAgain(false); });

        mappings.add(myModes,
            ["N"], "Find previous",
            function () { rangefinder.findAgain(true); });

        mappings.add(myModes.concat([modes.CARET, modes.TEXT_EDIT]), ["*"],
            "Find word under cursor",
            function () {
                rangefinder.find(buffer.getCurrentWord(), false);
                rangefinder.findAgain();
            });

        mappings.add(myModes.concat([modes.CARET, modes.TEXT_EDIT]), ["#"],
            "Find word under cursor backwards",
            function () {
                rangefinder.find(buffer.getCurrentWord(), true);
                rangefinder.findAgain();
            });

    },
    options: function () {
        // prefs.safeSet("accessibility.typeaheadfind.autostart", false);
        // The above should be sufficient, but: https://bugzilla.mozilla.org/show_bug.cgi?id=348187
        prefs.safeSet("accessibility.typeaheadfind", false);

        options.add(["hlfind", "hlf"],
            "Highlight all /find pattern matches on the current page after submission",
            "boolean", false, {
                setter: function (value) {
                    try {
                        if (value)
                            rangefinder.highlight();
                        else
                            rangefinder.clear();
                    }
                    catch (e) {}

                    return value;
                }
            });

        options.add(["findcase", "fc"],
            "Find case matching mode",
            "string", "smart",
            {
                completer: function () [
                    ["smart", "Case is significant when capital letters are typed"],
                    ["match", "Case is always significant"],
                    ["ignore", "Case is never significant"]
                ]
            });

        options.add(["incfind", "if"],
            "Find a pattern incrementally as it is typed rather than awaiting <Return>",
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
const RangeFind = Class("RangeFind", {
    init: function (matchCase, backward, elementPath, regexp) {
        this.window = Cu.getWeakReference(window);
        this.elementPath = elementPath || null;
        this.reverse = Boolean(backward);

        this.finder = services.Find();
        this.matchCase = Boolean(matchCase);
        this.regexp = Boolean(regexp);

        this.ranges = this.makeFrameList(content);

        this.reset();

        this.highlighted = null;
        this.selections = [];
        this.lastString = "";
    },

    get backward() this.finder.findBackwards,

    get matchCase() this.finder.caseSensitive,
    set matchCase(val) this.finder.caseSensitive = Boolean(val),

    get regexp() this.finder.regularExpression || false,
    set regexp(val) {
        try {
            return this.finder.regularExpression = Boolean(val);
        }
        catch (e) {
            return false;
        }
    },

    get findString() this.lastString,

    get selectedRange() {
        let selection = (buffer.focusedFrame || content).getSelection();
        return (selection.rangeCount ? selection.getRangeAt(0) : this.ranges[0].range).cloneRange();
    },
    set selectedRange(range) {
        this.range.selection.removeAllRanges();
        this.range.selection.addRange(range);
        this.range.selectionController.scrollSelectionIntoView(
            this.range.selectionController.SELECTION_NORMAL, 0, false);
    },

    cancel: function () {
        this.purgeListeners();
        this.range.deselect();
        this.range.descroll();
    },

    compareRanges: function (r1, r2)
            this.backward ?  r1.compareBoundaryPoints(r1.END_TO_START, r2)
                          : -r1.compareBoundaryPoints(r1.START_TO_END, r2),

    findRange: function (range) {
        let doc = range.startContainer.ownerDocument;
        let win = doc.defaultView;
        let ranges = this.ranges.filter(function (r)
            r.window === win && RangeFind.contains(r.range, range));

        if (this.backward)
            return ranges[ranges.length - 1];
        return ranges[0];
    },

    findSubRanges: function (range) {
        let doc = range.startContainer.ownerDocument;
        for (let elem in util.evaluateXPath(this.elementPath, doc)) {
            let r = RangeFind.nodeRange(elem);
            if (RangeFind.contains(range, r))
                yield r;
        }
    },

    focus: function () {
        if (this.lastRange)
            var node = util.evaluateXPath(RangeFind.selectNodePath, this.range.document,
                                          this.lastRange.commonAncestorContainer).snapshotItem(0);
        if (node) {
            node.focus();
            // Re-highlight collapsed selection
            this.selectedRange = this.lastRange;
        }
    },

    highlight: function (clear) {

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

    indexIter: function (private_) {
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

    iter: function (word) {
        let saved = ["lastRange", "lastString", "range"].map(function (s) [s, this[s]], this);
        try {
            this.range = this.ranges[0];
            this.lastRange = null;
            this.lastString = word;
            var res;
            while (res = this.find(null, this.reverse, true))
                yield res;
        }
        finally {
            saved.forEach(function ([k, v]) this[k] = v, this);
        }
    },

    makeFrameList: function (win) {
        const self = this;
        win = win.top;
        let frames = [];
        let backup = null;

        function pushRange(start, end) {
            function push(r) {
                if (r = RangeFind.Range(r, frames.length))
                    frames.push(r);
            }

            let range = start.startContainer.ownerDocument.createRange();
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
            let pageRange = RangeFind.nodeRange(doc.body || doc.documentElement.lastChild);
            backup = backup || pageRange;
            let pageStart = RangeFind.endpoint(pageRange, true);
            let pageEnd = RangeFind.endpoint(pageRange, false);

            for (let frame in array.iterValues(win.frames)) {
                let range = doc.createRange();
                if (util.computedStyle(frame.frameElement).visibility == "visible") {
                    range.selectNode(frame.frameElement);
                    pushRange(pageStart, RangeFind.endpoint(range, true));
                    pageStart = RangeFind.endpoint(range, false);
                    rec(frame);
                }
            }
            pushRange(pageStart, pageEnd);
        }
        rec(win);
        if (frames.length == 0)
            frames[0] = RangeFind.Range(RangeFind.endpoint(backup, true), 0);
        return frames;
    },

    reset: function () {
        this.startRange = this.selectedRange;
        this.startRange.collapse(!this.reverse);
        this.lastRange = this.selectedRange;
        this.range = this.findRange(this.startRange);
        this.ranges.first = this.range;
        this.ranges.forEach(function (range) range.save());
        this.forward = null;
        this.found = false;
    },

    // This doesn't work yet.
    resetCaret: function () {
        let equal = RangeFind.equal;
        let selection = this.win.getSelection();
        if (selection.rangeCount == 0)
            selection.addRange(this.pageStart);
        function getLines() {
            let orig = selection.getRangeAt(0);
            function getRanges(forward) {
                selection.removeAllRanges();
                selection.addRange(orig);
                let cur = orig;
                while (true) {
                    var last = cur;
                    this.sel.lineMove(forward, false);
                    cur = selection.getRangeAt(0);
                    if (equal(cur, last))
                        break;
                    yield cur;
                }
            }
            yield orig;
            for (let range in getRanges(true))
                yield range;
            for (let range in getRanges(false))
                yield range;
        }
        for (let range in getLines()) {
            if (this.sel.checkVisibility(range.startContainer, range.startOffset, range.startOffset))
                return range;
        }
        return null;
    },

    find: function (word, reverse, private_) {
        if (!private_ && this.lastRange && !RangeFind.equal(this.selectedRange, this.lastRange))
            this.reset();

        this.wrapped = false;
        this.finder.findBackwards = reverse ? !this.reverse : this.reverse;
        let again = word == null;
        if (again)
            word = this.lastString;
        if (!this.matchCase)
            word = word.toLowerCase();

        if (!again && (word === "" || word.indexOf(this.lastString) !== 0 || this.backward)) {
            if (!private_)
                this.range.deselect();
            if (word === "")
                this.range.descroll();
            this.lastRange = this.startRange;
            this.range = this.ranges.first;
        }

        if (word == "")
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
                                RangeFind.endpoint(this.range.range, !this.backward);;

                if (this.backward && !again)
                    start = RangeFind.endpoint(this.startRange, false);

                var range = this.finder.Find(word, this.range.range, start, this.range.range);
                if (range)
                    break;
            }

        if (range)
            this.lastRange = range.cloneRange();
        if (!private_) {
            this.lastString = word;
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

    addListeners: function () {
        for (let range in array.iterValues(this.ranges))
            range.window.addEventListener("unload", this.closure.onUnload, true);
    },
    purgeListeners: function () {
        for (let range in array.iterValues(this.ranges))
            try {
                range.window.removeEventListener("unload", this.closure.onUnload, true);
            }
            catch (e if e.result === Cr.NS_ERROR_FAILURE) {}
    },
    onUnload: function (event) {
        this.purgeListeners();
        if (this.highlighted)
            this.highlight(false);
        this.stale = true;
    }
}, {
    Range: Class("RangeFind.Range", {
        init: function (range, index) {
            this.index = index;

            this.range = range;
            this.document = range.startContainer.ownerDocument;
            this.window = this.document.defaultView;
            this.docShell = this.window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
                                       .QueryInterface(Ci.nsIDocShell);

            if (this.selection == null)
                return false;

            this.save();
        },

        intersects: function (range)
            this.range.compareBoundaryPoints(range.START_TO_END, range) >= 0 &&
            this.range.compareBoundaryPoints(range.END_TO_START, range) <= 0,

        save: function () {
            this.scroll = Point(this.window.pageXOffset, this.window.pageYOffset);

            this.initialSelection = null;
            if (this.selection.rangeCount)
                this.initialSelection = this.selection.getRangeAt(0);
        },

        descroll: function (range) {
            this.window.scrollTo(this.scroll.x, this.scroll.y);
        },

        deselect: function () {
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
    contains: function (range, r)
        range.compareBoundaryPoints(range.START_TO_END, r) >= 0 &&
        range.compareBoundaryPoints(range.END_TO_START, r) <= 0,
    intersects: function (range, r)
        r.compareBoundaryPoints(range.START_TO_END, range) >= 0 &&
        r.compareBoundaryPoints(range.END_TO_START, range) <= 0,
    endpoint: function (range, before) {
        range = range.cloneRange();
        range.collapse(before);
        return range;
    },
    equal: function (r1, r2) {
        try {
            return !r1.compareBoundaryPoints(r1.START_TO_START, r2) && !r1.compareBoundaryPoints(r1.END_TO_END, r2);
        }
        catch (e) {
            return false;
        }
    },
    nodeRange: function (node) {
        let range = node.ownerDocument.createRange();
        range.selectNode(node);
        return range;
    },
    sameDocument: function (r1, r2) r1 && r2 && r1.endContainer.ownerDocument == r2.endContainer.ownerDocument,
    selectNodePath: ["a", "xhtml:a", "*[@onclick]"].map(
        function (p) "ancestor-or-self::" + p).join(" | ")
});

// vim: set fdm=marker sw=4 ts=4 et:
