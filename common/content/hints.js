// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */
/** @instance hints */

var HintSession = Class("HintSession", CommandMode, {
    get extendedMode() modes.HINTS,

    init: function init(mode, opts={}) {
        init.supercall(this);

        if (!opts.window)
            opts.window = modes.getStack(0).params.window;

        this.hintMode = hints.modes[mode];
        dactyl.assert(this.hintMode);

        this.activeTimeout = null; // needed for hinttimeout > 0
        this.continue = Boolean(opts.continue);
        this.docs = [];
        this.hintKeys = DOM.Event.parse(options["hintkeys"]).map(DOM.Event.bound.stringify);
        this.hintNumber = 0;
        this.hintString = opts.filter || "";
        this.pageHints = [];
        this.prevInput = "";
        this.usedTabKey = false;
        this.validHints = []; // store the indices of the "hints" array with valid elements

        mappings.pushCommand();
        this.open();

        this.top = opts.window || content;
        this.top.addEventListener("resize", this.bound._onResize, true);
        this.top.addEventListener("dactyl-commandupdate", this.bound._onResize, false, true);

        this.generate();

        this.show();
        this.magic = true;

        if (this.validHints.length == 0) {
            dactyl.beep();
            modes.pop();
        }
        else if (this.validHints.length == 1 && !this.continue)
            this.process(false);
        else
            this.checkUnique();
    },

    get docs() this._docs = this._docs.filter(({ doc }) => !Cu.isDeadWrapper(doc)),
    set docs(docs) {
        this._docs = docs;
    },

    Hint: {
        get active() this._active,
        set active(val) {
            this._active = val;
            if (val)
                this.span.setAttribute("active", true);
            else
                this.span.removeAttribute("active");

            hints.setClass(this.elem, this.valid ? val : null);
            if (this.imgSpan)
                hints.setClass(this.imgSpan, this.valid ? val : null);
        },

        get ambiguous() this.span.hasAttribute("ambiguous"),
        set ambiguous(val) {
            let meth = val ? "setAttribute" : "removeAttribute";
            this.elem[meth]("ambiguous", "true");
            this.span[meth]("ambiguous", "true");
            if (this.imgSpan)
                this.imgSpan[meth]("ambiguous", "true");
        },

        get valid() this._valid,
        set valid(val) {
            this._valid = val,

            this.span.style.display = (val ? "" : "none");
            if (this.imgSpan)
                this.imgSpan.style.display = (val ? "" : "none");
            this.active = this.active;
        }
    },

    get mode() modes.HINTS,

    get prompt() ["Question", UTF8(this.hintMode.prompt) + ": "],

    leave: function leave(stack) {
        leave.superapply(this, arguments);

        if (!stack.push) {
            mappings.popCommand();

            if (hints.hintSession == this)
                hints.hintSession = null;
            if (this.top) {
                this.top.removeEventListener("resize", this.bound._onResize, true);
                this.top.removeEventListener("dactyl-commandupdate", this.bound._onResize, true);
            }

            this.removeHints(0);
        }
    },

    checkUnique: function _checkUnique() {
        if (this.hintNumber == 0)
            return;
        dactyl.assert(this.hintNumber <= this.validHints.length);

        // if we write a numeric part like 3, but we have 45 hints, only follow
        // the hint after a timeout, as the user might have wanted to follow link 34
        if (this.hintNumber > 0 && this.hintNumber * this.hintKeys.length <= this.validHints.length) {
            let timeout = options["hinttimeout"];
            if (timeout > 0)
                this.activeTimeout = this.timeout(function () {
                    this.process(true);
                }, timeout);
        }
        else // we have a unique hint
            this.process(true);
    },

    /**
     * Clear any timeout which might be active after pressing a number
     */
    clearTimeout: function () {
        if (this.activeTimeout)
            this.activeTimeout.cancel();
        this.activeTimeout = null;
    },

    _escapeNumbers: false,
    get escapeNumbers() this._escapeNumbers,
    set escapeNumbers(val) {
        this.clearTimeout();
        this._escapeNumbers = !!val;
        if (val && this.usedTabKey)
            this.hintNumber = 0;

        this.updateStatusline();
    },

    /**
     * Returns the hint string for a given number based on the values of
     * the 'hintkeys' option.
     *
     * @param {number} n The number to transform.
     * @returns {string}
     */
    getHintString: function getHintString(n) {
        let res = [], len = this.hintKeys.length;
        do {
            res.push(this.hintKeys[n % len]);
            n = Math.floor(n / len);
        }
        while (n > 0);
        return res.reverse().join("");
    },

    /**
     * The reverse of {@link #getHintString}. Given a hint string,
     * returns its index.
     *
     * @param {string} str The hint's string.
     * @returns {number} The hint's index.
     */
    getHintNumber: function getHintNumber(str) {
        let base = this.hintKeys.length;
        let res = 0;
        for (let char in values(str))
            res = res * base + this.hintKeys.indexOf(char);
        return res;
    },

    /**
     * Returns true if the given key string represents a
     * pseudo-hint-number.
     *
     * @param {string} key The key to test.
     * @returns {boolean} Whether the key represents a hint number.
     */
    isHintKey: function isHintKey(key) this.hintKeys.indexOf(key) >= 0,

    /**
     * Gets the actual offset of an imagemap area.
     *
     * Only called by {@link #_generate}.
     *
     * @param {Object} elem The <area> element.
     * @param {number} leftPos The left offset of the image.
     * @param {number} topPos The top offset of the image.
     * @returns [leftPos, topPos] The updated offsets.
     */
    getAreaOffset: function _getAreaOffset(elem, leftPos, topPos) {
        try {
            // Need to add the offset to the area element.
            // Always try to find the top-left point, as per dactyl default.
            let shape = elem.getAttribute("shape").toLowerCase();
            let coordStr = elem.getAttribute("coords");
            // Technically it should be only commas, but hey
            coordStr = coordStr.replace(/\s+[;,]\s+/g, ",").replace(/\s+/g, ",");
            let coords = coordStr.split(",").map(Number);

            if ((shape == "rect" || shape == "rectangle") && coords.length == 4) {
                leftPos += coords[0];
                topPos += coords[1];
            }
            else if (shape == "circle" && coords.length == 3) {
                leftPos += coords[0] - coords[2] / Math.sqrt(2);
                topPos += coords[1] - coords[2] / Math.sqrt(2);
            }
            else if ((shape == "poly" || shape == "polygon") && coords.length % 2 == 0) {
                let leftBound = Infinity;
                let topBound = Infinity;

                // First find the top-left corner of the bounding rectangle (offset from image topleft can be noticeably suboptimal)
                for (let i = 0; i < coords.length; i += 2) {
                    leftBound = Math.min(coords[i], leftBound);
                    topBound = Math.min(coords[i + 1], topBound);
                }

                let curTop = null;
                let curLeft = null;
                let curDist = Infinity;

                // Then find the closest vertex. (we could generalize to nearest point on an edge, but I doubt there is a need)
                for (let i = 0; i < coords.length; i += 2) {
                    let leftOffset = coords[i] - leftBound;
                    let topOffset = coords[i + 1] - topBound;
                    let dist = Math.sqrt(leftOffset * leftOffset + topOffset * topOffset);
                    if (dist < curDist) {
                        curDist = dist;
                        curLeft = coords[i];
                        curTop = coords[i + 1];
                    }
                }

                // If we found a satisfactory offset, let's use it.
                if (curDist < Infinity)
                    return [leftPos + curLeft, topPos + curTop];
            }
        }
        catch (e) {} // badly formed document, or shape == "default" in which case we don't move the hint
        return [leftPos, topPos];
    },

    // the containing block offsets with respect to the viewport
    getContainerOffsets: function _getContainerOffsets(doc) {
        let body = doc.body || doc.documentElement;
        // TODO: getComputedStyle returns null for Facebook channel_iframe doc - probable Gecko bug.
        let style = DOM(body).style;

        if (style && /^(absolute|fixed|relative)$/.test(style.position)) {
            let rect = body.getClientRects()[0];
            return [-rect.left, -rect.top];
        }
        else
            return [doc.defaultView.scrollX, doc.defaultView.scrollY];
    },

    /**
     * Generate the hints in a window.
     *
     * Pushes the hints into the pageHints object, but does not display them.
     *
     * @param {Window} win The window for which to generate hints.
     * @default content
     */
    generate: function _generate(win, offsets) {
        if (!win)
            win = this.top;

        let doc = win.document;

        memoize(doc, "dactylLabels", () =>
            iter([l.getAttribute("for"), l]
                 for (l in array.iterValues(doc.querySelectorAll("label[for]"))))
             .toObject());

        let [offsetX, offsetY] = this.getContainerOffsets(doc);

        offsets = offsets || { left: 0, right: 0, top: 0, bottom: 0 };
        offsets.right  = win.innerWidth  - offsets.right;
        offsets.bottom = win.innerHeight - offsets.bottom;

        function isVisible(elem) {
            let rect = elem.getBoundingClientRect();
            if (!rect ||
                rect.top > offsets.bottom || rect.bottom < offsets.top ||
                rect.left > offsets.right || rect.right < offsets.left)
                return false;

            if (!rect.width && !rect.height)
                if (!Array.some(elem.childNodes, elem => elem instanceof Element
                                                      && DOM(elem).style.float != "none"
                                                      && isVisible(elem)))
                    if (elem.textContent || !elem.name)
                        return false;

            let computedStyle = doc.defaultView.getComputedStyle(elem, null);
            if (!computedStyle)
                return false;
            if (computedStyle.visibility != "visible" || computedStyle.display == "none")
                return false;
            return true;
        }

        let body = doc.body || doc.querySelector("body");
        if (body) {
            let fragment = DOM(["div", { highlight: "hints" }], doc).appendTo(body);
            fragment.style.height; // Force application of binding.
            let container = doc.getAnonymousElementByAttribute(fragment[0], "anonid", "hints") || fragment[0];

            let baseNode = DOM(["span", { highlight: "Hint", style: "display: none;" }], doc)[0];

            let mode = this.hintMode;
            let res = mode.matcher(doc);

            let start = this.pageHints.length;
            let _hints = [];
            for (let elem in res)
                if (isVisible(elem) && (!mode.filter || mode.filter(elem)))
                    _hints.push({
                        elem: elem,
                        rect: elem.getClientRects()[0] || elem.getBoundingClientRect(),
                        showText: false,
                        __proto__: this.Hint
                    });

            for (let hint of _hints) {
                let { elem, rect } = hint;

                if (elem.hasAttributeNS(NS, "hint"))
                    [hint.text, hint.showText] = [elem.getAttributeNS(NS, "hint"), true];
                else if (isinstance(elem, [Ci.nsIDOMHTMLInputElement,
                                           Ci.nsIDOMHTMLSelectElement,
                                           Ci.nsIDOMHTMLTextAreaElement]))
                    [hint.text, hint.showText] = hints.getInputHint(elem, doc);
                else if (elem.firstElementChild instanceof Ci.nsIDOMHTMLImageElement && /^\s*$/.test(elem.textContent))
                    [hint.text, hint.showText] = [elem.firstElementChild.alt || elem.firstElementChild.title, true];
                else
                    hint.text = elem.textContent.toLowerCase();

                hint.span = baseNode.cloneNode(false);

                let leftPos = Math.max((rect.left + offsetX), offsetX);
                let topPos  = Math.max((rect.top + offsetY), offsetY);

                if (elem instanceof Ci.nsIDOMHTMLAreaElement)
                    [leftPos, topPos] = this.getAreaOffset(elem, leftPos, topPos);

                hint.span.setAttribute("style", ["display: none; left:", leftPos, "px; top:", topPos, "px"].join(""));
                container.appendChild(hint.span);

                this.pageHints.push(hint);
            }

            this.docs.push({ doc: doc, start: start, end: this.pageHints.length - 1 });
        }

        Array.forEach(win.frames, function (f) {
            if (isVisible(f.frameElement)) {
                let rect = f.frameElement.getBoundingClientRect();
                this.generate(f, {
                    left: Math.max(offsets.left - rect.left, 0),
                    right: Math.max(rect.right - offsets.right, 0),
                    top: Math.max(offsets.top - rect.top, 0),
                    bottom: Math.max(rect.bottom - offsets.bottom, 0)
                });
            }
        }, this);

        return true;
    },

    /**
     * Handle user input.
     *
     * Will update the filter on displayed hints and follow the final hint if
     * necessary.
     *
     * @param {Event} event The keypress event.
     */
    onChange: function onChange(event) {
        this.prevInput = "text";

        this.clearTimeout();

        this.hintNumber = 0;
        this.hintString = commandline.command;
        this.updateStatusline();
        this.show();
        if (this.validHints.length == 1)
            this.process(false);
    },

    /**
     * Handle a hints mode event.
     *
     * @param {Event} event The event to handle.
     */
    onKeyPress: function onKeyPress(eventList) {
        const KILL = false, PASS = true;
        let key = DOM.Event.stringify(eventList[0]);

        this.clearTimeout();

        if (!this.escapeNumbers && this.isHintKey(key)) {
            this.prevInput = "number";

            let oldHintNumber = this.hintNumber;
            if (this.usedTabKey) {
                this.hintNumber = 0;
                this.usedTabKey = false;
            }
            this.hintNumber = this.hintNumber * this.hintKeys.length +
                this.hintKeys.indexOf(key);

            this.updateStatusline();

            if (this.docs.length)
                this.updateValidNumbers();
            else {
                this.generate();
                this.show();
            }

            this.showActiveHint(this.hintNumber, oldHintNumber || 1);

            dactyl.assert(this.hintNumber != 0);

            this.checkUnique();
            return KILL;
        }

        return PASS;
    },

    onResize: function onResize() {
        this.removeHints(0);
        this.generate(this.top);
        this.show();
    },

    _onResize: function _onResize() {
        if (this.magic)
            hints.resizeTimer.tell();
    },

    /**
     * Finish hinting.
     *
     * Called when there are one or zero hints in order to possibly activate it
     * and, if activated, to clean up the rest of the hinting system.
     *
     * @param {boolean} followFirst Whether to force the following of the first
     *     link (when 'followhints' is 1 or 2)
     *
     */
    process: function _processHints(followFirst) {
        dactyl.assert(this.validHints.length > 0);

        // This "followhints" option is *too* confusing. For me, and
        // presumably for users, too. --Kris
        if (options["followhints"] > 0 && !followFirst)
            return; // no return hit; don't examine uniqueness

        if (!followFirst) {
            let firstHref = this.validHints[0].elem.getAttribute("href") || null;
            if (firstHref) {
                if (this.validHints.some(h => h.elem.getAttribute("href") != firstHref))
                    return;
            }
            else if (this.validHints.length > 1)
                return;
        }

        let timeout = followFirst || events.feedingKeys ? 0 : 500;
        let activeIndex = (this.hintNumber ? this.hintNumber - 1 : 0);
        let elem = this.validHints[activeIndex].elem;
        let top = this.top;

        if (this.continue)
            this._reset();
        else
            this.removeHints(timeout);

        let n = 5;
        (function next() {
            if (Cu.isDeadWrapper && Cu.isDeadWrapper(elem))
                // Hint document has been unloaded.
                return;

            let hinted = n || this.validHints.some(h => h.elem === elem);
            if (!hinted)
                hints.setClass(elem, null);
            else if (n)
                hints.setClass(elem, n % 2);
            else
                hints.setClass(elem, this.validHints[Math.max(0, this.hintNumber - 1)].elem === elem);

            if (n--)
                this.timeout(next, 50);
        }).call(this);

        mappings.pushCommand();
        if (!this.continue) {
            modes.pop();
            if (timeout)
                modes.push(modes.IGNORE, modes.HINTS);
        }

        dactyl.trapErrors("action", this.hintMode,
                          elem, elem.href || elem.src || "",
                          this.extendedhintCount, top);
        mappings.popCommand();

        this.timeout(function () {
            if (modes.main == modes.IGNORE && !this.continue)
                modes.pop();
            commandline.lastEcho = null; // Hack.
            if (this.continue && this.top)
                this.show();
        }, timeout);
    },

    /**
     * Remove all hints from the document, and reset the completions.
     *
     * Lingers on the active hint briefly to confirm the selection to the user.
     *
     * @param {number} timeout The number of milliseconds before the active
     *     hint disappears.
     */
    removeHints: function _removeHints(timeout) {
        for (let { doc, start, end } in values(this.docs)) {
            DOM(doc.documentElement).highlight.remove("Hinting");
            // Goddamn stupid fucking Gecko 1.x security manager bullshit.
            try { delete doc.dactylLabels; } catch (e) { doc.dactylLabels = undefined; }

            for (let elem in DOM.XPath("//*[@dactyl:highlight='hints']", doc))
                elem.parentNode.removeChild(elem);
            for (let i in util.range(start, end + 1)) {
                this.pageHints[i].ambiguous = false;
                this.pageHints[i].valid = false;
            }
        }
        styles.system.remove("hint-positions");

        this.reset();
    },

    reset: function reset() {
        this.pageHints = [];
        this.validHints = [];
        this.docs = [];
        this.clearTimeout();
    },
    _reset: function _reset() {
        if (!this.usedTabKey)
            this.hintNumber = 0;
        if (this.continue && this.validHints.length <= 1) {
            this.hintString = "";
            commandline.widgets.command = this.hintString;
            this.show();
        }
        this.updateStatusline();
    },

    /**
     * Display the hints in pageHints that are still valid.
     */
    showCount: 0,
    show: function _show() {
        let count = ++this.showCount;
        let hintnum = 1;
        let validHint = hints.hintMatcher(this.hintString.toLowerCase());
        let activeHint = this.hintNumber || 1;
        this.validHints = [];

        for (let { doc, start, end } in values(this.docs)) {
            DOM(doc.documentElement).highlight.add("Hinting");
            let [offsetX, offsetY] = this.getContainerOffsets(doc);

        inner:
            for (let i in (util.interruptibleRange(start, end + 1, 500))) {
                if (this.showCount != count)
                    return;

                let hint = this.pageHints[i];

                hint.valid = validHint(hint.text);
                if (!hint.valid)
                    continue inner;

                if (hint.text == "" && hint.elem.firstChild && hint.elem.firstChild instanceof Ci.nsIDOMHTMLImageElement) {
                    if (!hint.imgSpan) {
                        let rect = hint.elem.firstChild.getBoundingClientRect();
                        if (!rect)
                            continue;

                        hint.imgSpan = DOM(["span", { highlight: "Hint", "dactyl:hl": "HintImage" }], doc).css({
                            display: "none",
                            left: (rect.left + offsetX) + "px",
                            top: (rect.top + offsetY) + "px",
                            width: (rect.right - rect.left) + "px",
                            height: (rect.bottom - rect.top) + "px"
                        }).appendTo(hint.span.parentNode)[0];
                    }
                }

                let str = this.getHintString(hintnum);
                let text = [];
                if (hint.elem instanceof Ci.nsIDOMHTMLInputElement)
                    if (hint.elem.type === "radio")
                        text.push(UTF8(hint.elem.checked ? "⊙" : "○"));
                    else if (hint.elem.type === "checkbox")
                        text.push(UTF8(hint.elem.checked ? "☑" : "☐"));
                if (hint.showText && !/^\s*$/.test(hint.text))
                    text.push(hint.text.substr(0, 50));

                hint.span.setAttribute("text", str + (text.length ? ": " + text.join(" ") : ""));
                hint.span.setAttribute("number", str);
                if (hint.imgSpan)
                    hint.imgSpan.setAttribute("number", str);

                hint.active = activeHint == hintnum;

                this.validHints.push(hint);
                hintnum++;
            }
        }

        let base = this.hintKeys.length;
        for (let [i, hint] in Iterator(this.validHints))
            hint.ambiguous = (i + 1) * base <= this.validHints.length;

        if (options["usermode"]) {
            let css = [];
            for (let hint in values(this.pageHints)) {
                let selector = highlight.selector("Hint") + "[number=" + hint.span.getAttribute("number").quote() + "]";
                let imgSpan = "[dactyl|hl=HintImage]";
                css.push(selector + ":not(" + imgSpan + ") { " + hint.span.style.cssText + " }");
                if (hint.imgSpan)
                    css.push(selector + imgSpan + " { " + hint.span.style.cssText + " }");
            }
            styles.system.add("hint-positions", "*", css.join("\n"));
        }

        return true;
    },

    /**
     * Update the activeHint.
     *
     * By default highlights it green instead of yellow.
     *
     * @param {number} newId The hint to make active.
     * @param {number} oldId The currently active hint.
     */
    showActiveHint: function _showActiveHint(newId, oldId) {
        let oldHint = this.validHints[oldId - 1];
        if (oldHint)
            oldHint.active = false;

        let newHint = this.validHints[newId - 1];
        if (newHint)
            newHint.active = true;
    },

    backspace: function () {
        this.clearTimeout();
        if (this.prevInput !== "number")
            return Events.PASS;

        if (this.hintNumber > 0 && !this.usedTabKey) {
            this.hintNumber = Math.floor(this.hintNumber / this.hintKeys.length);
            if (this.hintNumber == 0)
                this.prevInput = "text";
            this.update(false);
        }
        else {
            this.usedTabKey = false;
            this.hintNumber = 0;
            dactyl.beep();
        }
        return Events.KILL;
    },

    updateValidNumbers: function updateValidNumbers(always) {
        let string = this.getHintString(this.hintNumber);
        for (let hint in values(this.validHints))
            hint.valid = always || hint.span.getAttribute("number").startsWith(string);
    },

    tab: function tab(previous) {
        this.clearTimeout();
        this.usedTabKey = true;
        if (this.hintNumber == 0)
            this.hintNumber = 1;

        let oldId = this.hintNumber;
        if (!previous) {
            if (++this.hintNumber > this.validHints.length)
                this.hintNumber = 1;
        }
        else {
            if (--this.hintNumber < 1)
                this.hintNumber = this.validHints.length;
        }

        this.updateValidNumbers(true);
        this.showActiveHint(this.hintNumber, oldId);
        this.updateStatusline();
    },

    update: function update(followFirst) {
        this.clearTimeout();
        this.updateStatusline();

        if (this.docs.length == 0 && this.hintString.length > 0)
            this.generate();

        this.show();
        this.process(followFirst);
    },

    /**
     * Display the current status to the user.
     */
    updateStatusline: function _updateStatusline() {
        statusline.inputBuffer = (this.escapeNumbers ? "\\" : "") +
                                 (this.hintNumber ? this.getHintString(this.hintNumber) : "");
    },
});

var Hints = Module("hints", {
    init: function init() {
        this.resizeTimer = Timer(100, 500, function () {
            if (isinstance(modes.main, modes.HINTS))
                modes.getStack(0).params.onResize();
        });

        let appContent = document.getElementById("appcontent");
        if (appContent)
            events.listen(appContent, "scroll", this.resizeTimer.bound.tell, false);

        const Mode = Hints.Mode;
        Mode.prototype.__defineGetter__("matcher", function ()
            options.get("extendedhinttags").getKey(this.name, options.get("hinttags").matcher));

        function cleanLoc(loc) {
            try {
                let uri = util.newURI(loc);
                if (uri.scheme == "mailto" && !~uri.path.indexOf("?"))
                    return uri.path;
            }
            catch (e) {}
            return loc;
        }

        this.modes = {};
        this.addMode(";", "Focus hint",                           buffer.bound.focusElement);
        this.addMode("?", "Show information for hint",            elem => buffer.showElementInfo(elem));
        // TODO: allow for ! override to overwrite existing paths -- where? --djk
        this.addMode("s", "Save hint",                            elem => buffer.saveLink(elem, false));
        this.addMode("f", "Focus frame",                          elem => dactyl.focus(elem.ownerDocument.defaultView));
        this.addMode("F", "Focus frame or pseudo-frame",          buffer.bound.focusElement, isScrollable);
        this.addMode("o", "Follow hint",                          elem => buffer.followLink(elem, dactyl.CURRENT_TAB));
        this.addMode("t", "Follow hint in a new tab",             elem => buffer.followLink(elem, dactyl.NEW_TAB));
        this.addMode("b", "Follow hint in a background tab",      elem => buffer.followLink(elem, dactyl.NEW_BACKGROUND_TAB));
        this.addMode("w", "Follow hint in a new window",          elem => buffer.followLink(elem, dactyl.NEW_WINDOW));
        this.addMode("O", "Generate an ‘:open URL’ prompt",       (elem, loc) => CommandExMode().open("open " + loc));
        this.addMode("T", "Generate a ‘:tabopen URL’ prompt",     (elem, loc) => CommandExMode().open("tabopen " + loc));
        this.addMode("W", "Generate a ‘:winopen URL’ prompt",     (elem, loc) => CommandExMode().open("winopen " + loc));
        this.addMode("a", "Add a bookmark",                       elem => bookmarks.addSearchKeyword(elem));
        this.addMode("S", "Add a search keyword",                 elem => bookmarks.addSearchKeyword(elem));
        this.addMode("v", "View hint source",                     (elem, loc) => buffer.viewSource(loc, false));
        this.addMode("V", "View hint source in external editor",  (elem, loc) => buffer.viewSource(loc, true));
        this.addMode("y", "Yank hint location",                   (elem, loc) => editor.setRegister(null, cleanLoc(loc), true));
        this.addMode("Y", "Yank hint description",                elem => editor.setRegister(null, elem.textContent || "", true));
        this.addMode("A", "Yank hint anchor url",                 function (elem) {
            let uri = elem.ownerDocument.documentURIObject.clone();
            uri.ref = elem.id || elem.name;
            dactyl.clipboardWrite(uri.spec, true);
        });
        this.addMode("c", "Open context menu",                    elem => DOM(elem).contextmenu());
        this.addMode("i", "Show image",                           elem => dactyl.open(elem.src));
        this.addMode("I", "Show image in a new tab",              elem => dactyl.open(elem.src, dactyl.NEW_TAB));

        function isScrollable(elem) isinstance(elem, [Ci.nsIDOMHTMLFrameElement,
                                                      Ci.nsIDOMHTMLIFrameElement]) ||
            Buffer.isScrollable(elem, 0, true) || Buffer.isScrollable(elem, 0, false);
    },

    hintSession: Modes.boundProperty(),

    /**
     * Creates a new hints mode.
     *
     * @param {string} mode The letter that identifies this mode.
     * @param {string} prompt The description to display to the user
     *     about this mode.
     * @param {function(Node)} action The function to be called with the
     *     element that matches.
     * @param {function(Node):boolean} filter A function used to filter
     *     the returned node set.
     * @param {[string]} tags A value to add to the default
     *     'extendedhinttags' value for this mode.
     *     @optional
     */
    addMode: function (mode, prompt, action, filter, tags) {
        function toString(regexp) RegExp.prototype.toString.call(regexp);

        if (tags != null) {
            let eht = options.get("extendedhinttags");
            let update = eht.isDefault;

            let value = eht.parse(Option.quote(util.regexp.escape(mode)) + ":" + tags.map(Option.quote))[0];
            eht.defaultValue = eht.defaultValue.filter(re => toString(re) != toString(value))
                                  .concat(value);

            if (update)
                eht.reset();
        }

        this.modes[mode] = Hints.Mode(mode, UTF8(prompt), action, filter);
    },

    /**
     * Get a hint for "input", "textarea" and "select".
     *
     * Tries to use <label>s if possible but does not try to guess that a
     * neighboring element might look like a label. Only called by
     * {@link #_generate}.
     *
     * If it finds a hint it returns it, if the hint is not the caption of the
     * element it will return showText=true.
     *
     * @param {Object} elem The element used to generate hint text.
     * @param {Document} doc The containing document.
     *
     * @returns [text, showText]
     */
    getInputHint: function _getInputHint(elem, doc) {
        // <input type="submit|button|reset"/>   Always use the value
        // <input type="radio|checkbox"/>        Use the value if it is not numeric or label or name
        // <input type="password"/>              Never use the value, use label or name
        // <input type="text|file"/> <textarea/> Use value if set or label or name
        // <input type="image"/>                 Use the alt text if present (showText) or label or name
        // <input type="hidden"/>                Never gets here
        // <select/>                             Use the text of the selected item or label or name

        let type = elem.type;

        if (DOM(elem).isInput)
            return [elem.value, false];
        else {
            for (let [, option] in Iterator(options["hintinputs"])) {
                if (option == "value") {
                    if (elem instanceof Ci.nsIDOMHTMLSelectElement) {
                        if (elem.selectedIndex >= 0)
                            return [elem.item(elem.selectedIndex).text.toLowerCase(), false];
                    }
                    else if (type == "image") {
                        if (elem.alt)
                            return [elem.alt.toLowerCase(), true];
                    }
                    else if (elem.value && type != "password") {
                        // radios and checkboxes often use internal ids as values - maybe make this an option too...
                        if (! ((type == "radio" || type == "checkbox") && !isNaN(elem.value)))
                            return [elem.value.toLowerCase(), (type == "radio" || type == "checkbox")];
                    }
                }
                else if (option == "label") {
                    if (elem.id) {
                        let label = (elem.ownerDocument.dactylLabels || {})[elem.id];
                        // Urgh.
                        if (label)
                            return [label.textContent.toLowerCase(), true];
                    }
                }
                else if (option == "name")
                    return [elem.name.toLowerCase(), true];
            }
        }

        return ["", false];
    },

    /**
     * Get the hintMatcher according to user preference.
     *
     * @param {string} hintString The currently typed hint.
     * @returns {hintMatcher}
     */
    hintMatcher: function _hintMatcher(hintString) { //{{{
        /**
         * Divide a string by a regular expression.
         *
         * @param {RegExp|string} pat The pattern to split on.
         * @param {string} str The string to split.
         * @returns {Array(string)} The lowercased splits of the splitting.
         */
        function tokenize(pat, str) str.split(pat).map(String.toLowerCase);

        /**
         * Get a hint matcher for hintmatching=contains
         *
         * The hintMatcher expects the user input to be space delimited and it
         * returns true if each set of characters typed can be found, in any
         * order, in the link.
         *
         * @param {string} hintString The string typed by the user.
         * @returns {function(String):boolean} A function that takes the text
         *     of a hint and returns true if all the (space-delimited) sets of
         *     characters typed by the user can be found in it.
         */
        function containsMatcher(hintString) { //{{{
            let tokens = tokenize(/\s+/, hintString);
            return function (linkText) {
                linkText = linkText.toLowerCase();
                return tokens.every(token => indexOf(linkText, token) >= 0);
            };
        } //}}}

        /**
         * Get a hintMatcher for hintmatching=firstletters|wordstartswith
         *
         * The hintMatcher will look for any division of the user input that
         * would match the first letters of words. It will always only match
         * words in order.
         *
         * @param {string} hintString The string typed by the user.
         * @param {boolean} allowWordOverleaping Whether to allow non-contiguous
         *     words to match.
         * @returns {function(String):boolean} A function that will filter only
         *     hints that match as above.
         */
        function wordStartsWithMatcher(hintString, allowWordOverleaping) { //{{{
            let hintStrings     = tokenize(/\s+/, hintString);
            let wordSplitRegexp = util.regexp(options["wordseparators"]);

            /**
             * Match a set of characters to the start of words.
             *
             * What the **** does this do? --Kris
             * This function matches hintStrings like 'hekho' to links
             * like 'Hey Kris, how are you?' -> [HE]y [K]ris [HO]w are you
             * --Daniel
             *
             * @param {string} chars The characters to match.
             * @param {Array(string)} words The words to match them against.
             * @param {boolean} allowWordOverleaping Whether words may be
             *     skipped during matching.
             * @returns {boolean} Whether a match can be found.
             */
            function charsAtBeginningOfWords(chars, words, allowWordOverleaping) {
                function charMatches(charIdx, chars, wordIdx, words, inWordIdx, allowWordOverleaping) {
                    let matches = (chars[charIdx] == words[wordIdx][inWordIdx]);
                    if ((matches == false && allowWordOverleaping) || words[wordIdx].length == 0) {
                        let nextWordIdx = wordIdx + 1;
                        if (nextWordIdx == words.length)
                            return false;

                        return charMatches(charIdx, chars, nextWordIdx, words, 0, allowWordOverleaping);
                    }

                    if (matches) {
                        let nextCharIdx = charIdx + 1;
                        if (nextCharIdx == chars.length)
                            return true;

                        let nextWordIdx = wordIdx + 1;
                        let beyondLastWord = (nextWordIdx == words.length);
                        let charMatched = false;
                        if (beyondLastWord == false)
                            charMatched = charMatches(nextCharIdx, chars, nextWordIdx, words, 0, allowWordOverleaping);

                        if (charMatched)
                            return true;

                        if (charMatched == false || beyondLastWord == true) {
                            let nextInWordIdx = inWordIdx + 1;
                            if (nextInWordIdx == words[wordIdx].length)
                                return false;

                            return charMatches(nextCharIdx, chars, wordIdx, words, nextInWordIdx, allowWordOverleaping);
                        }
                    }

                    return false;
                }

                return charMatches(0, chars, 0, words, 0, allowWordOverleaping);
            }

            /**
             * Check whether the array of strings all exist at the start of the
             * words.
             *
             * i.e. ['ro', 'e'] would match ['rollover', 'effect']
             *
             * The matches must be in order, and, if allowWordOverleaping is
             * false, contiguous.
             *
             * @param {Array(string)} strings The strings to search for.
             * @param {Array(string)} words The words to search in.
             * @param {boolean} allowWordOverleaping Whether matches may be
             *     non-contiguous.
             * @returns {boolean} Whether all the strings matched.
             */
            function stringsAtBeginningOfWords(strings, words, allowWordOverleaping) {
                let strIdx = 0;
                for (let [, word] in Iterator(words)) {
                    if (word.length == 0)
                        continue;

                    let str = strings[strIdx];
                    if (str.length == 0 || indexOf(word, str) == 0)
                        strIdx++;
                    else if (!allowWordOverleaping)
                        return false;

                    if (strIdx == strings.length)
                        return true;
                }

                for (; strIdx < strings.length; strIdx++) {
                    if (strings[strIdx].length != 0)
                        return false;
                }
                return true;
            }

            return function (linkText) {
                if (hintStrings.length == 1 && hintStrings[0].length == 0)
                    return true;

                let words = tokenize(wordSplitRegexp, linkText);
                if (hintStrings.length == 1)
                    return charsAtBeginningOfWords(hintStrings[0], words, allowWordOverleaping);
                else
                    return stringsAtBeginningOfWords(hintStrings, words, allowWordOverleaping);
            };
        } //}}}

        let indexOf = String.indexOf;
        if (options.get("hintmatching").has("transliterated"))
            indexOf = Hints.bound.indexOf;

        switch (options["hintmatching"][0]) {
        case "contains"      : return containsMatcher(hintString);
        case "wordstartswith": return wordStartsWithMatcher(hintString, true);
        case "firstletters"  : return wordStartsWithMatcher(hintString, false);
        case "custom"        : return dactyl.plugins.customHintMatcher(hintString);
        default              : dactyl.echoerr(_("hints.noMatcher", hintMatching));
        }
        return null;
    }, //}}}

    open: function open(mode, opts={}) {
        this._extendedhintCount = opts.count;

        mappings.pushCommand();
        commandline.input(["Normal", mode], {
            autocomplete: false,
            completer: function (context) {
                context.compare = () => 0;
                context.completions = [[k, v.prompt] for ([k, v] in Iterator(hints.modes))];
            },
            onCancel: mappings.bound.popCommand,
            onSubmit: function (arg) {
                if (arg)
                    hints.show(arg, opts);
                mappings.popCommand();
            },
            onChange: function (arg) {
                if (Object.keys(hints.modes).some(m => m != arg && m.startsWith(arg)))
                    return;

                this.accepted = true;
                modes.pop();
            }
        });
    },

    /**
     * Toggle the highlight of a hint.
     *
     * @param {Object} elem The element to toggle.
     * @param {boolean} active Whether it is the currently active hint or not.
     */
    setClass: function _setClass(elem, active) {
        if (elem.dactylHighlight == null)
            elem.dactylHighlight = elem.getAttributeNS(NS, "highlight") || "";

        let prefix = (elem.getAttributeNS(NS, "hl") || "") + " " + elem.dactylHighlight + " ";
        if (active)
            highlight.highlightNode(elem, prefix + "HintActive");
        else if (active != null)
            highlight.highlightNode(elem, prefix + "HintElem");
        else {
            highlight.highlightNode(elem, elem.dactylHighlight);
            // delete elem.dactylHighlight fails on Gecko 1.9. Issue #197
            elem.dactylHighlight = null;
        }
    },

    show: function show(mode, opts) {
        this.hintSession = HintSession(mode, opts);
    }
}, {
    isVisible: function isVisible(elem, offScreen) {
        let rect = elem.getBoundingClientRect();
        if (!rect.width && !rect.height)
            if (!Array.some(elem.childNodes, elem => elem instanceof Element
                                                  && DOM(elem).style.float != "none"
                                                  && isVisible(elem)))
                return false;

        let win = elem.ownerDocument.defaultView;
        if (offScreen && (rect.top + win.scrollY < 0 || rect.left + win.scrollX < 0 ||
                          rect.bottom + win.scrollY > win.scrolMaxY + win.innerHeight ||
                          rect.right + win.scrollX > win.scrolMaxX + win.innerWidth))
            return false;

        if (!DOM(elem).isVisible)
            return false;
        return true;
    },

    translitTable: Class.Memoize(function () {
        const table = {};
        [
            [0x00c0, 0x00c6, ["A"]], [0x00c7, 0x00c7, ["C"]],
            [0x00c8, 0x00cb, ["E"]], [0x00cc, 0x00cf, ["I"]],
            [0x00d1, 0x00d1, ["N"]], [0x00d2, 0x00d6, ["O"]],
            [0x00d8, 0x00d8, ["O"]], [0x00d9, 0x00dc, ["U"]],
            [0x00dd, 0x00dd, ["Y"]], [0x00e0, 0x00e6, ["a"]],
            [0x00e7, 0x00e7, ["c"]], [0x00e8, 0x00eb, ["e"]],
            [0x00ec, 0x00ef, ["i"]], [0x00f1, 0x00f1, ["n"]],
            [0x00f2, 0x00f6, ["o"]], [0x00f8, 0x00f8, ["o"]],
            [0x00f9, 0x00fc, ["u"]], [0x00fd, 0x00fd, ["y"]],
            [0x00ff, 0x00ff, ["y"]], [0x0100, 0x0105, ["A", "a"]],
            [0x0106, 0x010d, ["C", "c"]], [0x010e, 0x0111, ["D", "d"]],
            [0x0112, 0x011b, ["E", "e"]], [0x011c, 0x0123, ["G", "g"]],
            [0x0124, 0x0127, ["H", "h"]], [0x0128, 0x0130, ["I", "i"]],
            [0x0132, 0x0133, ["IJ", "ij"]], [0x0134, 0x0135, ["J", "j"]],
            [0x0136, 0x0136, ["K", "k"]], [0x0139, 0x0142, ["L", "l"]],
            [0x0143, 0x0148, ["N", "n"]], [0x0149, 0x0149, ["n"]],
            [0x014c, 0x0151, ["O", "o"]], [0x0152, 0x0153, ["OE", "oe"]],
            [0x0154, 0x0159, ["R", "r"]], [0x015a, 0x0161, ["S", "s"]],
            [0x0162, 0x0167, ["T", "t"]], [0x0168, 0x0173, ["U", "u"]],
            [0x0174, 0x0175, ["W", "w"]], [0x0176, 0x0178, ["Y", "y", "Y"]],
            [0x0179, 0x017e, ["Z", "z"]], [0x0180, 0x0183, ["b", "B", "B", "b"]],
            [0x0187, 0x0188, ["C", "c"]], [0x0189, 0x0189, ["D"]],
            [0x018a, 0x0192, ["D", "D", "d", "F", "f"]],
            [0x0193, 0x0194, ["G"]],
            [0x0197, 0x019b, ["I", "K", "k", "l", "l"]],
            [0x019d, 0x01a1, ["N", "n", "O", "O", "o"]],
            [0x01a4, 0x01a5, ["P", "p"]], [0x01ab, 0x01ab, ["t"]],
            [0x01ac, 0x01b0, ["T", "t", "T", "U", "u"]],
            [0x01b2, 0x01d2, ["V", "Y", "y", "Z", "z", "D", "L", "N", "A", "a",
               "I", "i", "O", "o"]],
            [0x01d3, 0x01dc, ["U", "u"]], [0x01de, 0x01e1, ["A", "a"]],
            [0x01e2, 0x01e3, ["AE", "ae"]],
            [0x01e4, 0x01ed, ["G", "g", "G", "g", "K", "k", "O", "o", "O", "o"]],
            [0x01f0, 0x01f5, ["j", "D", "G", "g"]],
            [0x01fa, 0x01fb, ["A", "a"]], [0x01fc, 0x01fd, ["AE", "ae"]],
            [0x01fe, 0x0217, ["O", "o", "A", "a", "A", "a", "E", "e", "E", "e",
               "I", "i", "I", "i", "O", "o", "O", "o", "R", "r", "R", "r", "U",
               "u", "U", "u"]],
            [0x0253, 0x0257, ["b", "c", "d", "d"]],
            [0x0260, 0x0269, ["g", "h", "h", "i", "i"]],
            [0x026b, 0x0273, ["l", "l", "l", "l", "m", "n", "n"]],
            [0x027c, 0x028b, ["r", "r", "r", "r", "s", "t", "u", "u", "v"]],
            [0x0290, 0x0291, ["z"]], [0x029d, 0x02a0, ["j", "q"]],
            [0x1e00, 0x1e09, ["A", "a", "B", "b", "B", "b", "B", "b", "C", "c"]],
            [0x1e0a, 0x1e13, ["D", "d"]], [0x1e14, 0x1e1d, ["E", "e"]],
            [0x1e1e, 0x1e21, ["F", "f", "G", "g"]], [0x1e22, 0x1e2b, ["H", "h"]],
            [0x1e2c, 0x1e8f, ["I", "i", "I", "i", "K", "k", "K", "k", "K", "k",
               "L", "l", "L", "l", "L", "l", "L", "l", "M", "m", "M", "m", "M",
               "m", "N", "n", "N", "n", "N", "n", "N", "n", "O", "o", "O", "o",
               "O", "o", "O", "o", "P", "p", "P", "p", "R", "r", "R", "r", "R",
               "r", "R", "r", "S", "s", "S", "s", "S", "s", "S", "s", "S", "s",
               "T", "t", "T", "t", "T", "t", "T", "t", "U", "u", "U", "u", "U",
               "u", "U", "u", "U", "u", "V", "v", "V", "v", "W", "w", "W", "w",
               "W", "w", "W", "w", "W", "w", "X", "x", "X", "x", "Y", "y"]],
            [0x1e90, 0x1e9a, ["Z", "z", "Z", "z", "Z", "z", "h", "t", "w", "y", "a"]],
            [0x1ea0, 0x1eb7, ["A", "a"]], [0x1eb8, 0x1ec7, ["E", "e"]],
            [0x1ec8, 0x1ecb, ["I", "i"]], [0x1ecc, 0x1ee3, ["O", "o"]],
            [0x1ee4, 0x1ef1, ["U", "u"]], [0x1ef2, 0x1ef9, ["Y", "y"]],
            [0x2071, 0x2071, ["i"]], [0x207f, 0x207f, ["n"]],
            [0x249c, 0x24b5, "a"], [0x24b6, 0x24cf, "A"],
            [0x24d0, 0x24e9, "a"],
            [0xfb00, 0xfb06, ["ff", "fi", "fl", "ffi", "ffl", "st", "st"]],
            [0xff21, 0xff3a, "A"], [0xff41, 0xff5a, "a"]
        ].forEach(function ([start, stop, val]) {
            if (typeof val != "string")
                for (let i = start; i <= stop; i++)
                    table[String.fromCharCode(i)] = val[(i - start) % val.length];
            else {
                let n = val.charCodeAt(0);
                for (let i = start; i <= stop; i++)
                    table[String.fromCharCode(i)] = String.fromCharCode(n + i - start);
            }
        });
        return table;
    }),
    indexOf: function indexOf(dest, src) {
        let table = this.translitTable;
        var end = dest.length - src.length;
        if (src.length == 0)
            return 0;
    outer:
        for (var i = 0; i <= end; i++) {
                var j = i;
                for (var k = 0; k < src.length;) {
                    var s = dest[j++];
                    s = table[s] || s;
                    for (var l = 0; l < s.length; l++, k++) {
                        if (s[l] != src[k])
                            continue outer;
                        if (k == src.length - 1)
                            return i;
                    }
                }
            }
        return -1;
    },

    Mode: Struct("HintMode", "name", "prompt", "action", "filter")
            .localize("prompt")
}, {
    modes: function initModes() {
        initModes.require("commandline");
        modes.addMode("HINTS", {
            extended: true,
            description: "Active when selecting elements with hints",
            bases: [modes.COMMAND_LINE],
            input: true,
            ownsBuffer: true
        });
    },
    mappings: function () {
        let bind = function bind(names, description, action, params)
            mappings.add(config.browserModes, names, description,
                         action, params);

        bind(["f"],
            "Start Hints mode",
            function () { hints.show("o"); });

        bind(["F"],
            "Start Hints mode, but open link in a new tab",
            function () { hints.show(options.get("activate").has("links") ? "t" : "b"); });

        bind([";"],
            "Start an extended hints mode",
            function ({ count }) { hints.open(";", { count: count }); },
            { count: true });

        bind(["g;"],
            "Start an extended hints mode and stay there until <Esc> is pressed",
            function ({ count }) { hints.open("g;", { continue: true, count: count }); },
            { count: true });

        bind = function bind(names, description, action, params)
            mappings.add([modes.HINTS], names, description,
                         action, params);

        bind(["<Return>"],
            "Follow the selected hint",
            function ({ self }) { self.update(true); });

        bind(["<Tab>"],
            "Focus the next matching hint",
            function ({ self }) { self.tab(false); });

        bind(["<S-Tab>"],
            "Focus the previous matching hint",
            function ({ self }) { self.tab(true); });

        bind(["<BS>", "<C-h>"],
            "Delete the previous character",
            function ({ self }) self.backspace());

        bind(["\\"],
            "Toggle hint filtering",
            function ({ self }) { self.escapeNumbers = !self.escapeNumbers; });
    },
    options: function () {
        options.add(["extendedhinttags", "eht"],
            "XPath or CSS selector strings of hintable elements for extended hint modes",
            "regexpmap", {
                // Make sure to update the docs when you change this.
                "[iI]": "img",
                "[asOTvVWy]": [":-moz-any-link", "area[href]", "img[src]", "iframe[src]"],
                "[A]": ["[id]", "a[name]"],
                "[f]": "body",
                "[F]": ["body", "code", "div", "html", "p", "pre", "span"],
                "[S]": ["input:not([type=hidden])", "textarea", "button", "select"]
            },
            {
                keepQuotes: true,

                getKey: function (val, default_)
                    let (res = this.value.find(re => let (match = re.exec(val)) match && match[0] == val))
                        res ? res.matcher
                            : default_,

                parse: function parse(val) {
                    let vals = parse.supercall(this, val);
                    for (let value in values(vals))
                        value.matcher = DOM.compileMatcher(Option.splitList(value.result));
                    return vals;
                },

                testValues: function testValues(vals, validator) vals.every(re => Option.splitList(re).every(validator)),

                validator: DOM.validateMatcher
            });

        options.add(["hinttags", "ht"],
            "XPath or CSS selector strings of hintable elements for Hints mode",
            // Make sure to update the docs when you change this.
            "stringlist", ":-moz-any-link,area,button,iframe,input:not([type=hidden]):not([disabled])," +
                          "label[for],select,textarea," +
                          "[onclick],[onmouseover],[onmousedown],[onmouseup],[oncommand]," +
                          "[tabindex],[role=link],[role=button],[contenteditable=true]",
            {
                setter: function (values) {
                    this.matcher = DOM.compileMatcher(values);
                    return values;
                },
                validator: DOM.validateMatcher
            });

        options.add(["hintkeys", "hk"],
            "The keys used to label and select hints",
            "string", "0123456789",
            {
                values: {
                    "0123456789": "Numbers",
                    "asdfg;lkjh": "Home Row"
                },
                validator: function (value) {
                    let values = DOM.Event.parse(value).map(DOM.Event.bound.stringify);
                    return Option.validIf(array.uniq(values).length === values.length && values.length > 1,
                                          _("option.hintkeys.duplicate"));
                }
            });

        options.add(["hinttimeout", "hto"],
            "Timeout before automatically following a non-unique numerical hint",
            "number", 0,
            { validator: function (value) value >= 0 });

        options.add(["followhints", "fh"],
            "Define the conditions under which selected hints are followed",
            "number", 0,
            {
                values: {
                    "0": "Follow the first hint as soon as typed text uniquely identifies it. Follow the selected hint on <Return>.",
                    "1": "Follow the selected hint on <Return>."
                }
            });

        options.add(["hintmatching", "hm"],
            "How hints are filtered",
            "stringlist", "contains",
            {
                values: {
                    "contains":       "The typed characters are split on whitespace. The resulting groups must all appear in the hint.",
                    "custom":         "Delegate to a custom function: dactyl.plugins.customHintMatcher(hintString)",
                    "firstletters":   "Behaves like wordstartswith, but all groups must match a sequence of words.",
                    "wordstartswith": "The typed characters are split on whitespace. The resulting groups must all match the beginnings of words, in order.",
                    "transliterated": UTF8("When true, special latin characters are translated to their ASCII equivalents (e.g., é ⇒ e)")
                },
                validator: function (values) Option.validateCompleter.call(this, values) &&
                    1 === values.reduce((acc, v) => acc + (["contains", "custom", "firstletters", "wordstartswith"].indexOf(v) >= 0),
                                        0)
            });

        options.add(["wordseparators", "wsp"],
            "Regular expression defining which characters separate words when matching hints",
            "string", '[.,!?:;/"^$%&?()[\\]{}<>#*+|=~ _-]',
            { validator: function (value) RegExp(value) });

        options.add(["hintinputs", "hin"],
            "Which text is used to filter hints for input elements",
            "stringlist", "label,value",
            {
                values: {
                    "value": "Match against the value of the input field",
                    "label": "Match against the text of a label for the input field, if one can be found",
                    "name":  "Match against the name of the input field"
                }
            });
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
