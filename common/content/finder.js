// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/** @instance rangefinder */
const RangeFinder = Module("rangefinder", {
    requires: ["config"],

    init: function () {
        this.lastSearchPattern = "";
    },

    openPrompt: function (mode) {
        let backwards = mode == modes.FIND_BACKWARD;
        commandline.open(backwards ? "?" : "/", "", mode);

        this.find("", backwards);
    },

    bootstrap: function (str, backward) {
        if (this.rangeFind && this.rangeFind.stale)
            this.rangeFind = null;

        let highlighted = this.rangeFind && this.rangeFind.highlighted;
        let matchCase = !(options["ignorecase"] || options["smartcase"] && !/[A-Z]/.test(str));
        let linksOnly = options["linksearch"];

        // All this ado is ludicrous.
        str = str.replace(/\\(.|$)/g, function (m, n1) {
            if (n1 == "l")
                linksOnly = true;
            else if (n1 == "L")
                linksOnly = false;
            else if (n1 == "c")
                matchCase = false;
            else if (n1 == "C")
                matchCase = true;
            else
                return n1;
            return "";
        });

        // It's possible, with :tabdetach, for the rangeFind to actually move
        // from one window to another, which breaks things.
        if (!this.rangeFind || this.rangeFind.window.get() != window ||
            linksOnly ^ !!this.rangeFind.elementPath ||
            matchCase ^ this.rangeFind.matchCase || backward ^ this.rangeFind.reverse) {
            if (this.rangeFind)
                this.rangeFind.cancel();
            this.rangeFind = RangeFind(matchCase, backward, linksOnly && options["hinttags"]);
            this.rangeFind.highlighted = highlighted;
        }
        return str;
    },

    find: function (pattern, backwards) {
        let str = this.bootstrap(pattern);
        if (!this.rangeFind.search(str))
            setTimeout(function () { liberator.echoerr("E486: Pattern not found: " + pattern); }, 0);

        return this.rangeFind.found;
    },

    findAgain: function (reverse) {
        if (!this.rangeFind)
            this.find(this.lastSearchPattern);
        else if (!this.rangeFind.search(null, reverse))
            liberator.echoerr("E486: Pattern not found: " + this.lastSearchPattern);
        else if (this.rangeFind.wrapped) {
            // hack needed, because wrapping causes a "scroll" event which clears
            // our command line
            this.setTimeout(function () {
                let msg = this.rangeFind.backward ? "search hit TOP, continuing at BOTTOM"
                                                  : "search hit BOTTOM, continuing at TOP";
                commandline.echo(msg, commandline.HL_WARNINGMSG, commandline.APPEND_TO_MESSAGES);
            }, 0);
        }
        else
            commandline.echo((this.rangeFind.backward ? "?" : "/") + this.lastSearchPattern, null, commandline.FORCE_SINGLELINE);

        if (options["hlsearch"])
            this.highlight();
        this.rangeFind.focus();
    },

    // Called when the user types a key in the search dialog. Triggers a find attempt if 'incsearch' is set
    onKeyPress: function (command) {
        if (options["incsearch"]) {
            command = this.bootstrap(command);
            this.rangeFind.search(command);
        }
    },

    onSubmit: function (command) {
        if (!options["incsearch"] || !this.rangeFind || !this.rangeFind.found) {
            this.clear();
            this.find(command || this.lastSearchPattern, modes.extended & modes.FIND_BACKWARD);
        }

        this.lastSearchPattern = command;

        if (options["hlsearch"])
            this.highlight();
        this.rangeFind.focus();

        modes.reset();
    },

    // Called when the search is canceled - for example if someone presses
    // escape while typing a search
    onCancel: function () {
        // TODO: code to reposition the document to the place before search started
        if (this.rangeFind)
            this.rangeFind.cancel();
    },

    get rangeFind() buffer.localStore.rangeFind,
    set rangeFind(val) buffer.localStore.rangeFind = val,

    /**
     * Highlights all occurances of <b>str</b> in the buffer.
     *
     * @param {string} str The string to highlight.
     */
    highlight: function () {
        if (this.rangeFind)
            this.rangeFind.highlight();
    },

    /**
     * Clears all search highlighting.
     */
    clear: function () {
        if (this.rangeFind)
            this.rangeFind.highlight(true);
    }
}, {
}, {
    commandline: function () {
        // Event handlers for search - closure is needed
        commandline.registerCallback("change", modes.FIND_FORWARD, this.closure.onKeyPress);
        commandline.registerCallback("submit", modes.FIND_FORWARD, this.closure.onSubmit);
        commandline.registerCallback("cancel", modes.FIND_FORWARD, this.closure.onCancel);
        // TODO: allow advanced myModes in register/triggerCallback
        commandline.registerCallback("change", modes.FIND_BACKWARD, this.closure.onKeyPress);
        commandline.registerCallback("submit", modes.FIND_BACKWARD, this.closure.onSubmit);
        commandline.registerCallback("cancel", modes.FIND_BACKWARD, this.closure.onCancel);

    },
    commands: function () {
        commands.add(["noh[lsearch]"],
            "Remove the search highlighting",
            function () { rangefinder.clear(); },
            { argCount: "0" });
    },
    mappings: function () {
        var myModes = config.browserModes.concat([modes.CARET]);

        mappings.add(myModes,
            ["/"], "Search forward for a pattern",
            function () { rangefinder.openPrompt(modes.FIND_FORWARD); });

        mappings.add(myModes,
            ["?"], "Search backwards for a pattern",
            function () { rangefinder.openPrompt(modes.FIND_BACKWARD); });

        mappings.add(myModes,
            ["n"], "Find next",
            function () { rangefinder.findAgain(false); });

        mappings.add(myModes,
            ["N"], "Find previous",
            function () { rangefinder.findAgain(true); });

        mappings.add(myModes.concat([modes.CARET, modes.TEXTAREA]), ["*"],
            "Find word under cursor",
            function () {
                rangefinder._found = false;
                rangefinder.onSubmit(buffer.getCurrentWord(), false);
            });

        mappings.add(myModes.concat([modes.CARET, modes.TEXTAREA]), ["#"],
            "Find word under cursor backwards",
            function () {
                rangefinder._found = false;
                rangefinder.onSubmit(buffer.getCurrentWord(), true);
            });

    },
    modes: function () {
        modes.addMode("FIND_FORWARD", true);
        modes.addMode("FIND_BACKWARD", true);
    },
    options: function () {
        options.add(["hlsearch", "hls"],
            "Highlight previous search pattern matches",
            "boolean", "false", {
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

        options.add(["ignorecase", "ic"],
            "Ignore case in search patterns",
            "boolean", true);

        options.add(["incsearch", "is"],
            "Show where the search pattern matches as it is typed",
            "boolean", true);

        options.add(["linksearch", "lks"],
            "Limit the search to hyperlink text",
            "boolean", false);

        options.add(["smartcase", "scs"],
            "Override the 'ignorecase' option if the pattern contains uppercase characters",
            "boolean", true);
    }
});

/**
 * @class RangeFind
 *
 * A fairly sophisticated typeahead-find replacement. It supports
 * incremental search very much as the builtin component.
 * Additionally, it supports several features impossible to
 * implement using the standard component. Incremental searching
 * works both forwards and backwards. Erasing characters during an
 * incremental search moves the selection back to the first
 * available match for the shorter term. The selection and viewport
 * are restored when the search is canceled.
 *
 * Also, in addition to full support for frames and iframes, this
 * implementation will begin searching from the position of the
 * caret in the last active frame. This is contrary to the behavior
 * of the builtin component, which always starts a search from the
 * begining of the first frame in the case of frameset documents,
 * and cycles through all frames from begining to end. This makes it
 * impossible to choose the starting point of a search for such
 * documents, and represents a major detriment to productivity where
 * large amounts of data are concerned (e.g., for API documents).
 */
const RangeFind = Class("RangeFind", {
    init: function (matchCase, backward, elementPath) {
        this.window = Cu.getWeakReference(window);
        this.elementPath = elementPath || null;
        this.matchCase = Boolean(matchCase);
        this.reverse = Boolean(backward);
        this.finder = services.create("find");
        this.finder.caseSensitive = this.matchCase;

        this.ranges = this.makeFrameList(content);

        this.reset();

        this.highlighted = null;
        this.lastString = "";
        this.forward = null;
        this.found = false;
    },

    get selectedRange() {
        let range = RangeFind.Range(tabs.localStore.focusedFrame || content);
        return (range.selection.rangeCount ? range.selection.getRangeAt(0) : this.ranges[0].range).cloneRange();
    },

    reset: function () {
        this.startRange = this.selectedRange;
        this.startRange.collapse(!this.reverse);
        this.lastRange = this.selectedRange;
        this.range = this.findRange(this.startRange);
        this.ranges.first = this.range;
    },

    sameDocument: function (r1, r2) r1 && r2 && r1.endContainer.ownerDocument == r2.endContainer.ownerDocument,

    compareRanges: function (r1, r2)
            this.backward ?  r1.compareBoundaryPoints(Range.END_TO_START, r2)
                          : -r1.compareBoundaryPoints(Range.START_TO_END, r2),

    findRange: function (range) {
        let doc = range.startContainer.ownerDocument;
        let win = doc.defaultView;
        let ranges = this.ranges.filter(function (r)
            r.window == win &&
            r.range.compareBoundaryPoints(Range.START_TO_END, range) >= 0 &&
            r.range.compareBoundaryPoints(Range.END_TO_START, range) <= 0);

        if (this.backward)
            return ranges[ranges.length - 1];
        return ranges[0];
    },

    findSubRanges: function (range) {
        let doc = range.startContainer.ownerDocument;
        for (let elem in util.evaluateXPath(this.elementPath, doc)) {
            let r = doc.createRange();
            r.selectNode(elem);
            if (range.compareBoundaryPoints(Range.START_TO_END, r) >= 0 &&
                range.compareBoundaryPoints(Range.END_TO_START, r) <= 0)
                yield r;
        }
    },

    focus: function() {
        if(this.lastRange)
            var node = util.evaluateXPath(RangeFind.selectNodePath, this.range.document,
                                          this.lastRange.commonAncestorContainer).snapshotItem(0);
        if(node) {
            node.focus();
            this.search(null, false); // Rehighlight collapsed range
        }
    },

    makeFrameList: function (win) {
        const self = this;
        win = win.top;
        let frames = [];
        let backup = null;

        function pushRange(start, end) {
            function push(r) {
                r = RangeFind.Range(r, frames.length);
                if (r)
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
            let pageRange = doc.createRange();
            pageRange.selectNode(doc.body || doc.documentElement.lastChild);
            backup = backup || pageRange;
            let pageStart = RangeFind.endpoint(pageRange, true);
            let pageEnd = RangeFind.endpoint(pageRange, false);

            for (let frame in util.Array.itervalues(win.frames)) {
                let range = doc.createRange();
                range.selectNode(frame.frameElement);
                pushRange(pageStart, RangeFind.endpoint(range, true));
                pageStart = RangeFind.endpoint(range, false);
                rec(frame);
            }
            pushRange(pageStart, pageEnd);
        }
        rec(win);
        if (frames.length == 0)
            frames[0] = RangeFind.Range(RangeFind.endpoint(backup, true), 0);
        return frames;
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

    get searchString() this.lastString,
    get backward() this.finder.findBackwards,

    iter: function (word) {
        let saved = ["range", "lastRange", "lastString"].map(this.closure(function (s) [s, this[s]]));
        try {
            this.range = this.ranges[0];
            this.lastRange = null;
            this.lastString = word;
            var res;
            while ((res = this.search(null, this.reverse, true)))
                yield res;
        }
        finally {
            saved.forEach(function ([k, v]) this[k] = v, this);
        }
    },

    search: function (word, reverse, private_) {
        if (!private_ && this.lastRange && !RangeFind.equal(this.selectedRange, this.lastRange))
            this.reset();

        this.wrapped = false;
        this.finder.findBackwards = reverse ? !this.reverse : this.reverse;
        let again = word == null;
        if (again)
            word = this.lastString;
        if (!this.matchCase)
            word = word.toLowerCase();

        if (!again && (word == "" || word.indexOf(this.lastString) != 0 || this.backward)) {
            if (!private_)
                this.range.deselect();
            if (word == "")
                this.range.descroll();
            this.lastRange = this.startRange;
            this.range = this.ranges.first;
        }

        if (word == "")
            var range = this.startRange;
        else {
            function indices() {
                let idx = this.range.index;
                for (let i in this.backward ? util.range(idx + 1, 0, -1) : util.range(idx, this.ranges.length))
                    yield i;
                if (private_)
                    return;
                this.wrapped = true;
                this.lastRange = null;
                for (let i in this.backward ? util.range(this.ranges.length, idx, -1) : util.range(0, idx + 1))
                    yield i;
            }
            for (let i in indices.call(this)) {
                this.range = this.ranges[i];

                let start = this.sameDocument(this.lastRange, this.range.range) && this.range.intersects(this.lastRange) ?
                            RangeFind.endpoint(this.lastRange, !(again ^ this.backward)) :
                            RangeFind.endpoint(this.range.range, !this.backward);;
                if (this.backward && !again)
                    start = RangeFind.endpoint(this.startRange, false);

                var range = this.finder.Find(word, this.range.range, start, this.range.range);
                if (range)
                    break;
                if (!private_) {
                    this.range.descroll();
                    this.range.deselect();
                }
            }
        }

        if (range)
            this.lastRange = range.cloneRange();
        if (private_)
            return range;

        this.lastString = word;
        if (range == null) {
            this.cancel();
            this.found = false;
            return null;
        }
        this.range.selection.removeAllRanges();
        this.range.selection.addRange(range);
        this.range.selectionController.scrollSelectionIntoView(
            this.range.selectionController.SELECTION_NORMAL, 0, false);
        this.found = true;
        return range;
    },

    highlight: function (clear) {

        if (!clear && (!this.lastString || this.lastString == this.highlighted))
            return;

        if (!clear && this.highlighted)
            this.highlight(true);

        if (clear && !this.highlighted)
            return;

        let span = util.xmlToDom(<span highlight="Search"/>, this.range.document);

        function highlight(range) {
            let startContainer = range.startContainer;
            let startOffset = range.startOffset;
            let node = startContainer.ownerDocument.importNode(span, true);

            let docfrag = range.extractContents();
            let before = startContainer.splitText(startOffset);
            let parent = before.parentNode;
            node.appendChild(docfrag);
            parent.insertBefore(node, before);
            range.selectNode(node);
        }

        function unhighlight(range) {
            let elem = range.startContainer;
            while (!(elem instanceof Element) && elem.parentNode)
                elem = elem.parentNode;
            if (elem.getAttributeNS(NS.uri, "highlight") != "Search")
                return;

            let docfrag = range.extractContents();

            let parent = elem.parentNode;
            parent.replaceChild(docfrag, elem);
            parent.normalize();
        }

        let action = clear ? unhighlight : highlight;
        let string = this[clear ? "highlighted" : "lastString"];
        for (let r in this.iter(string)) {
            action(r);
            this.lastRange = r;
        }
        if (clear) {
            this.highlighted = null;
            this.purgeListeners();
        }
        else {
            this.highlighted = this.lastString;
            this.addListeners();
            this.search(null, false); // Rehighlight collapsed range
        }
    },

    addListeners: function () {
        for (let range in values(this.ranges))
            range.window.addEventListener("unload", this.closure.onUnload, true);
    },
    purgeListeners: function () {
        for (let range in values(this.ranges))
            range.window.removeEventListener("unload", this.closure.onUnload, true);
    },

    onUnload: function (event) {
        this.purgeListeners();
        if (this.highlighted)
            this.highlight(false);
        this.stale = true;
    },

    cancel: function () {
        this.purgeListeners();
        this.range.deselect();
        this.range.descroll();
    }
}, {
    Range: Class("RangeFind.Range", {
        init: function (range, index) {
            if (range instanceof Ci.nsIDOMWindow) { // Kludge
                this.document = range.document;
                return;
            }

            this.index = index;

            this.document = range.startContainer.ownerDocument;
            this.window = this.document.defaultView;
            this.range = range;

            if (this.selection == null)
                return false;

            this.save();
        },

        intersects: function (range)
            this.range.compareBoundaryPoints(Range.START_TO_END, range) >= 0 &&
            this.range.compareBoundaryPoints(Range.END_TO_START, range) <= 0,

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
            this.selection.removeAllRanges();
            if (this.initialSelection)
                this.selection.addRange(this.initialSelection);
        },

        get docShell() {
            if (this._docShell)
                return this._docShell;
            for (let shell in iter(config.browser.docShell.getDocShellEnumerator(Ci.nsIDocShellTreeItem.typeAll, Ci.nsIDocShell.ENUMERATE_FORWARDS)))
                if (shell.QueryInterface(nsIWebNavigation).document == this.document)
                    return this._docShell = shell;
            throw Error();
        },
        get selectionController() this.docShell
                    .QueryInterface(Ci.nsIInterfaceRequestor)
                    .getInterface(Ci.nsISelectionDisplay)
                    .QueryInterface(Ci.nsISelectionController),
        get selection() {
            try {
                return this.selectionController.getSelection(Ci.nsISelectionController.SELECTION_NORMAL)
            } catch (e) {
                return null;
            }}

    }),
    selectNodePath: ["ancestor-or-self::" + s for ([i, s] in Iterator(
            ["a", "xhtml:a", "*[@onclick]"]))].join(" | "),
    endpoint: function (range, before) {
        range = range.cloneRange();
        range.collapse(before);
        return range;
    },
    equal: function (r1, r2) {
        try {
                return !r1.compareBoundaryPoints(Range.START_TO_START, r2) && !r1.compareBoundaryPoints(Range.END_TO_END, r2)
        }
        catch (e) {}
        return false;
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
