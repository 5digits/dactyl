// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */
/** @instance hints */

const Hints = Module("hints", {
    init: function init() {
        const self = this;

        this._hintMode = null;
        this._submode = "";             // used for extended mode, can be "o", "t", "y", etc.
        this._hintString = "";          // the typed string part of the hint is in this string
        this._hintNumber = 0;           // only the numerical part of the hint
        this._usedTabKey = false;       // when we used <Tab> to select an element
        this.prevInput = "";            // record previous user input type, "text" || "number"
        this._extendedhintCount = null; // for the count argument of Mode#action (extended hint only)

        this._pageHints = [];
        this._validHints = []; // store the indices of the "hints" array with valid elements

        this._activeTimeout = null; // needed for hinttimeout > 0
        this._canUpdate = false;

        // keep track of the documents which we generated the hints for
        // this._docs = { doc: document, start: start_index in hints[], end: end_index in hints[] }
        this._docs = [];

        this._resizeTimer = Timer(100, 500, function () {
            if (self._top && (modes.extended & modes.HINTS)) {
                self._removeHints(0, true);
                self._generate(self._top);
                self._showHints();
            }
        });
        let appContent = document.getElementById("appcontent");
        if (appContent)
            events.addSessionListener(appContent, "scroll", this._resizeTimer.closure.tell, false);

        const Mode = Hints.Mode;
        Mode.defaultValue("tags", function () function () options["hinttags"]);
        Mode.prototype.__defineGetter__("xpath", function ()
            options.get("extendedhinttags").getKey(this.name, this.tags()));

        this._hintModes = {};
        this.addMode(";", "Focus hint",                           function (elem) buffer.focusElement(elem));
        this.addMode("?", "Show information for hint",            function (elem) buffer.showElementInfo(elem));
        this.addMode("s", "Save hint",                            function (elem) buffer.saveLink(elem, true));
        this.addMode("a", "Save hint with prompt",                function (elem) buffer.saveLink(elem, false));
        this.addMode("f", "Focus frame",                          function (elem) elem.ownerDocument.defaultView.focus(), function () ["body"]);
        this.addMode("o", "Follow hint",                          function (elem) buffer.followLink(elem, dactyl.CURRENT_TAB));
        this.addMode("t", "Follow hint in a new tab",             function (elem) buffer.followLink(elem, dactyl.NEW_TAB));
        this.addMode("b", "Follow hint in a background tab",      function (elem) buffer.followLink(elem, dactyl.NEW_BACKGROUND_TAB));
        this.addMode("w", "Follow hint in a new window",          function (elem) buffer.followLink(elem, dactyl.NEW_WINDOW));
        this.addMode("O", "Generate an ‘:open URL’ prompt",       function (elem, loc) commandline.open(":", "open " + loc, modes.EX));
        this.addMode("T", "Generate a ‘:tabopen URL’ prompt",     function (elem, loc) commandline.open(":", "tabopen " + loc, modes.EX));
        this.addMode("W", "Generate a ‘:winopen URL’ prompt",     function (elem, loc) commandline.open(":", "winopen " + loc, modes.EX));
        this.addMode("S", "Add a search keyword",                 function (elem) bookmarks.addSearchKeyword(elem));
        this.addMode("v", "View hint source",                     function (elem, loc) buffer.viewSource(loc, false));
        this.addMode("V", "View hint source in external editor",  function (elem, loc) buffer.viewSource(loc, true));
        this.addMode("y", "Yank hint location",                   function (elem, loc) dactyl.clipboardWrite(loc, true));
        this.addMode("Y", "Yank hint description",                function (elem) dactyl.clipboardWrite(elem.textContent || "", true));
        this.addMode("c", "Open context menu",                    function (elem) buffer.openContextMenu(elem));
        this.addMode("i", "Show image",                           function (elem) dactyl.open(elem.src));
        this.addMode("I", "Show image in a new tab",              function (elem) dactyl.open(elem.src, dactyl.NEW_TAB));
    },

    /**
     * Reset hints, so that they can be cleanly used again.
     */
    _reset: function _reset(slight) {
        if (!slight) {
            this.__reset();
            this.prevInput = "";
            this.escNumbers = false;
            this._usedTabKey = false;
            this._canUpdate = false;
            this._hintNumber = 0;
            this._hintString = "";
            statusline.updateInputBuffer("");
            commandline.widgets.command = "";
        }
        this._pageHints = [];
        this._validHints = [];
        this._docs = [];

        if (this._activeTimeout)
            this._activeTimeout.cancel();
        this._activeTimeout = null;
    },
    __reset: function __reset() {
        if (!this._usedTabKey)
            this._hintNumber = 0;
        if (this._continue && this._validHints.length <= 1) {
            this._hintString = "";
            commandline.widgets.command = this._hintString;
            this._showHints();
        }
        this._updateStatusline();
    },

    /**
     * Display the current status to the user.
     */
    _updateStatusline: function _updateStatusline() {
        statusline.updateInputBuffer((hints.escNumbers ? options["mapleader"] : "") +
                                     (this._hintNumber ? this.getHintString(this._hintNumber) : ""));
    },

    /**
     * Get a hint for "input", "textarea" and "select".
     *
     * Tries to use <label>s if possible but does not try to guess that a
     * neighbouring element might look like a label. Only called by
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
    _getInputHint: function _getInputHint(elem, doc) {
        // <input type="submit|button|reset"/>   Always use the value
        // <input type="radio|checkbox"/>        Use the value if it is not numeric or label or name
        // <input type="password"/>              Never use the value, use label or name
        // <input type="text|file"/> <textarea/> Use value if set or label or name
        // <input type="image"/>                 Use the alt text if present (showText) or label or name
        // <input type="hidden"/>                Never gets here
        // <select/>                             Use the text of the selected item or label or name

        let type = elem.type;

        if (elem instanceof HTMLInputElement && set.has(util.editableInputs, elem.type))
            return [elem.value, false];
        else {
            for (let [, option] in Iterator(options["hintinputs"])) {
                if (option == "value") {
                    if (elem instanceof HTMLSelectElement) {
                        if (elem.selectedIndex >= 0)
                            return [elem.item(elem.selectedIndex).text.toLowerCase(), false];
                    }
                    else if (type == "image") {
                        if (elem.alt)
                            return [elem.alt.toLowerCase(), true];
                    }
                    else if (elem.value && type != "password") {
                        // radio's and checkboxes often use internal ids as values - maybe make this an option too...
                        if (! ((type == "radio" || type == "checkbox") && !isNaN(elem.value)))
                            return [elem.value.toLowerCase(), (type == "radio" || type == "checkbox")];
                    }
                }
                else if (option == "label") {
                    if (elem.id) {
                        // TODO: (possibly) do some guess work for label-like objects
                        let label = util.evaluateXPath(["label[@for=" + elem.id.quote() + "]"], doc).snapshotItem(0);
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
     * Gets the actual offset of an imagemap area.
     *
     * Only called by {@link #_generate}.
     *
     * @param {Object} elem The <area> element.
     * @param {number} leftPos The left offset of the image.
     * @param {number} topPos The top offset of the image.
     * @returns [leftPos, topPos] The updated offsets.
     */
    _getAreaOffset: function _getAreaOffset(elem, leftPos, topPos) {
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

                // Then find the closest vertex. (we could generalise to nearest point on an edge, but I doubt there is a need)
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
    _getContainerOffsets: function _getContainerOffsets(doc) {
        let body = doc.body || doc.documentElement;
        // TODO: getComputedStyle returns null for Facebook channel_iframe doc - probable Gecko bug.
        let style = util.computedStyle(body);

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
     * @default window.content
     */
    _generate: function _generate(win, offsets) {
        if (!win)
            win = this._top;

        let doc = win.document;

        let [offsetX, offsetY] = this._getContainerOffsets(doc);

        offsets = offsets || { left: 0, right: 0, top: 0, bottom: 0 };
        offsets.right  = win.innerWidth  - offsets.right;
        offsets.bottom = win.innerHeight - offsets.bottom;

        function isVisible(elem) {
            let rect = elem.getBoundingClientRect();
            if (!rect || !rect.width || !rect.height ||
                rect.top > offsets.bottom || rect.bottom < offsets.top ||
                rect.left > offsets.right || rect.right < offsets.left)
                return false;

            let computedStyle = doc.defaultView.getComputedStyle(elem, null);
            if (computedStyle.visibility != "visible" || computedStyle.display == "none")
                return false;
            return true;
        }

        let baseNodeAbsolute = util.xmlToDom(<span highlight="Hint"/>, doc);

        let res = util.evaluateXPath(this._hintMode.xpath, doc, null, true);

        let fragment = util.xmlToDom(<div highlight="hints"/>, doc);
        let start = this._pageHints.length;
        for (let elem in res) {
            let hint = { elem: elem, showText: false };

            if (!isVisible(elem))
                continue;

            if (isinstance(elem, [HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement]))
                [hint.text, hint.showText] = this._getInputHint(elem, doc);
            else
                hint.text = elem.textContent.toLowerCase();

            hint.span = baseNodeAbsolute.cloneNode(true);

            let rect = elem.getClientRects()[0] || elem.getBoundingClientRect();
            let leftPos = Math.max((rect.left + offsetX), offsetX);
            let topPos  = Math.max((rect.top + offsetY), offsetY);

            if (elem instanceof HTMLAreaElement)
                [leftPos, topPos] = this._getAreaOffset(elem, leftPos, topPos);

            hint.span.style.left = leftPos + "px";
            hint.span.style.top =  topPos + "px";
            fragment.appendChild(hint.span);

            this._pageHints.push(hint);
        }

        let body = doc.body || util.evaluateXPath(["body"], doc).snapshotItem(0);
        if (body) {
            body.appendChild(fragment);
            this._docs.push({ doc: doc, start: start, end: this._pageHints.length - 1 });
        }

        Array.forEach(win.frames, function (f) {
            if (isVisible(f.frameElement)) {
                let rect = f.frameElement.getBoundingClientRect();
                this._generate(f, {
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
     * Update the activeHint.
     *
     * By default highlights it green instead of yellow.
     *
     * @param {number} newId The hint to make active.
     * @param {number} oldId The currently active hint.
     */
    _showActiveHint: function _showActiveHint(newId, oldId) {
        let oldElem = this._validHints[oldId - 1];
        if (oldElem)
            this._setClass(oldElem, false);

        let newElem = this._validHints[newId - 1];
        if (newElem)
            this._setClass(newElem, true);
    },

    /**
     * Toggle the highlight of a hint.
     *
     * @param {Object} elem The element to toggle.
     * @param {boolean} active Whether it is the currently active hint or not.
     */
    _setClass: function _setClass(elem, active) {
        let prefix = (elem.getAttributeNS(NS, "class") || "") + " ";
        if (active)
            elem.setAttributeNS(NS, "highlight", prefix + "HintActive");
        else if (active != null)
            elem.setAttributeNS(NS, "highlight", prefix + "HintElem");
        else
            elem.removeAttributeNS(NS, "highlight");
    },

    /**
     * Display the hints in pageHints that are still valid.
     */
    _showHints: function _showHints() {
        let hintnum = 1;
        let validHint = this._hintMatcher(this._hintString.toLowerCase());
        let activeHint = this._hintNumber || 1;
        this._validHints = [];

        for (let [,{ doc: doc, start: start, end: end }] in Iterator(this._docs)) {
            let [offsetX, offsetY] = this._getContainerOffsets(doc);

        inner:
            for (let i in (util.interruptibleRange(start, end + 1, 500))) {
                let hint = this._pageHints[i];

                let valid = validHint(hint.text);
                hint.span.style.display = (valid ? "" : "none");
                if (hint.imgSpan)
                    hint.imgSpan.style.display = (valid ? "" : "none");

                if (!valid) {
                    hint.elem.removeAttributeNS(NS, "highlight");
                    continue inner;
                }

                if (hint.text == "" && hint.elem.firstChild && hint.elem.firstChild instanceof HTMLImageElement) {
                    if (!hint.imgSpan) {
                        let rect = hint.elem.firstChild.getBoundingClientRect();
                        if (!rect)
                            continue;

                        hint.imgSpan = util.xmlToDom(<span highlight="Hint" dactyl:class="HintImage" xmlns:dactyl={NS}/>, doc);
                        hint.imgSpan.style.left = (rect.left + offsetX) + "px";
                        hint.imgSpan.style.top = (rect.top + offsetY) + "px";
                        hint.imgSpan.style.width = (rect.right - rect.left) + "px";
                        hint.imgSpan.style.height = (rect.bottom - rect.top) + "px";
                        hint.span.parentNode.appendChild(hint.imgSpan);
                    }
                    this._setClass(hint.imgSpan, activeHint == hintnum);
                }

                let str = this.getHintString(hintnum);
                hint.span.setAttribute("number", hint.showText ? str + ": " + hint.text.substr(0, 50) : str);
                if (hint.imgSpan)
                    hint.imgSpan.setAttribute("number", str);
                else
                    this._setClass(hint.elem, activeHint == hintnum);
                this._validHints.push(hint.elem);
                hintnum++;
            }
        }

        if (options["usermode"]) {
            let css = [];
            // FIXME: Broken for imgspans.
            for (let [, { doc: doc }] in Iterator(this._docs)) {
                for (let elem in util.evaluateXPath("//*[@dactyl:highlight and @number]", doc)) {
                    let group = elem.getAttributeNS(NS, "highlight");
                    css.push(highlight.selector(group) + "[number=" + elem.getAttribute("number").quote() + "] { " + elem.style.cssText + " }");
                }
            }
            styles.addSheet(true, "hint-positions", "*", css.join("\n"));
        }

        return true;
    },

    /**
     * Remove all hints from the document, and reset the completions.
     *
     * Lingers on the active hint briefly to confirm the selection to the user.
     *
     * @param {number} timeout The number of milliseconds before the active
     *     hint disappears.
     */
    _removeHints: function _removeHints(timeout, slight) {
        for (let [,{ doc: doc, start: start, end: end }] in Iterator(this._docs)) {
            for (let elem in util.evaluateXPath("//*[@dactyl:highlight='hints']", doc))
                elem.parentNode.removeChild(elem);
            for (let i in util.range(start, end + 1))
                this._pageHints[i].elem.removeAttributeNS(NS, "highlight");
        }
        styles.removeSheet(true, "hint-positions");

        this._reset(slight);
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
    _processHints: function _processHints(followFirst) {
        if (this._validHints.length == 0) {
            dactyl.beep();
            return false;
        }

        // This "followhints" option is *too* confusing. For me, and
        // presumably for users, too. --Kris
        if (options["followhints"] > 0) {
            if (!followFirst)
                return false; // no return hit; don't examine uniqueness

            // OK. return hit. But there's more than one hint, and
            // there's no tab-selected current link. Do not follow in mode 2
            dactyl.assert(options["followhints"] != 2 || this._validHints.length == 1 || this._hintNumber);
        }

        if (!followFirst) {
            let firstHref = this._validHints[0].getAttribute("href") || null;
            if (firstHref) {
                if (this._validHints.some(function (e) e.getAttribute("href") != firstHref))
                    return false;
            }
            else if (this._validHints.length > 1)
                return false;
        }

        let timeout = followFirst || events.feedingKeys ? 0 : 500;
        let activeIndex = (this._hintNumber ? this._hintNumber - 1 : 0);
        let elem = this._validHints[activeIndex];
        let top = this._top;

        if (this._continue)
            this.__reset();
        else
            this._removeHints(timeout);

        let n = 5;
        (function next() {
            let hinted = n || this._validHints.some(function (e) e === elem);
            this._setClass(elem, n ? n % 2 : !hinted ? null : this._validHints[Math.max(0, this._hintNumber-1)] === elem);
            if (n--)
                this.timeout(next, 50);
        }).call(this);

        this.timeout(function () {
            if ((modes.extended & modes.HINTS) && !this._continue)
                modes.pop();
            commandline._lastEcho = null; // Hack.
            dactyl.trapErrors(this._hintMode.action, this._hintMode,
                              elem, elem.href || elem.src || "",
                              this._extendedhintCount, top);
        }, timeout);
        return true;
    },

    _checkUnique: function _checkUnique() {
        if (this._hintNumber == 0)
            return;
        dactyl.assert(this._hintNumber <= this._validHints.length);

        // if we write a numeric part like 3, but we have 45 hints, only follow
        // the hint after a timeout, as the user might have wanted to follow link 34
        if (this._hintNumber > 0 && this._hintNumber * this.hintKeys.length <= this._validHints.length) {
            let timeout = options["hinttimeout"];
            if (timeout > 0)
                this._activeTimeout = this.timeout(function () {
                    this._processHints(true);
                }, timeout);
        }
        else // we have a unique hint
            this._processHints(true);
    },

    /**
     * Handle user input.
     *
     * Will update the filter on displayed hints and follow the final hint if
     * necessary.
     *
     * @param {Event} event The keypress event.
     */
    _onInput: function _onInput(event) {
        this.prevInput = "text";

        // clear any timeout which might be active after pressing a number
        if (this._activeTimeout) {
            this._activeTimeout.cancel();
            this._activeTimeout = null;
        }

        this._hintNumber = 0;
        this._hintString = commandline.command;
        this._updateStatusline();
        this._showHints();
        if (this._validHints.length == 1)
            this._processHints(false);
    },

    /**
     * Get the hintMatcher according to user preference.
     *
     * @param {string} hintString The currently typed hint.
     * @returns {hintMatcher}
     */
    _hintMatcher: function _hintMatcher(hintString) { //{{{
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
         * @param {string} hintString  The string typed by the user.
         * @returns {function(String):boolean} A function that takes the text
         *     of a hint and returns true if all the (space-delimited) sets of
         *     characters typed by the user can be found in it.
         */
        function containsMatcher(hintString) { //{{{
            let tokens = tokenize(/\s+/, hintString);
            return function (linkText) {
                linkText = linkText.toLowerCase();
                return tokens.every(function (token) indexOf(linkText, token) >= 0);
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
            let hintStrings    = tokenize(/\s+/, hintString);
            let wordSplitRegex = RegExp(options["wordseparators"]);

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

                let words = tokenize(wordSplitRegex, linkText);
                if (hintStrings.length == 1)
                    return charsAtBeginningOfWords(hintStrings[0], words, allowWordOverleaping);
                else
                    return stringsAtBeginningOfWords(hintStrings, words, allowWordOverleaping);
            };
        } //}}}

        let indexOf = String.indexOf;
        if (options.get("hintmatching").has("transliterated"))
            indexOf = Hints.indexOf;

        switch (options["hintmatching"][0]) {
        case "contains"      : return containsMatcher(hintString);
        case "wordstartswith": return wordStartsWithMatcher(hintString, true);
        case "firstletters"  : return wordStartsWithMatcher(hintString, false);
        case "custom"        : return dactyl.plugins.customHintMatcher(hintString);
        default              : dactyl.echoerr("Invalid hintmatching type: " + hintMatching);
        }
        return null;
    }, //}}}

    /**
     * Creates a new hint mode.
     *
     * @param {string} mode The letter that identifies this mode.
     * @param {string} prompt The description to display to the user
     *     about this mode.
     * @param {function(Node)} action The function to be called with the
     *     element that matches.
     * @param {function():string} tags The function that returns an
     *     XPath expression to decide which elements can be hinted (the
     *     default returns options["hinttags"]).
     * @optional
     */
    addMode: function (mode, prompt, action, tags) {
        arguments[1] = UTF8(prompt);
        this._hintModes[mode] = Hints.Mode.apply(Hints.Mode, arguments);
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
     * Returns true if the given key string represents a
     * pseudo-hint-number.
     *
     * @param {string} key The key to test.
     * @returns {boolean} Whether the key represents a hint number.
     */
    isHintKey: function isHintKey(key) this.hintKeys.indexOf(key) >= 0,

    open: function open(mode, opts) {
        this._extendedhintCount = opts.count;
        commandline.input(";", null, {
            promptHighlight: "Normal",
            completer: function (context) {
                context.compare = function () 0;
                context.completions = [[k, v.prompt] for ([k, v] in Iterator(hints._hintModes))];
            },
            onAccept: function (arg) { arg && util.timeout(function () hints.show(arg, opts), 0); },
            get onCancel() this.onAccept,
            onChange: function () { modes.pop(); }
        });
    },

    /**
     * Updates the display of hints.
     *
     * @param {string} minor Which hint mode to use.
     * @param {Object} opts Extra options.
     */
    show: function show(minor, opts) {
        opts = opts || {};
        this._hintMode = this._hintModes[minor];
        dactyl.assert(this._hintMode);

        commandline.input(UTF8(this._hintMode.prompt) + ": ", null, {
            extended: modes.HINTS,
            leave: function (stack) {
                if (!stack.push)
                    hints.hide();
            },
            onChange: this.closure._onInput,
            onEvent: this.closure.onEvent
        });
        modes.extended = modes.HINTS;

        this.hintKeys = events.fromString(options["hintkeys"]).map(events.closure.toString);
        this._submode = minor;
        this._hintString = opts.filter || "";
        this._hintNumber = 0;
        this._usedTabKey = false;
        this.prevInput = "";
        this._canUpdate = false;
        this._continue = Boolean(opts.continue);

        this._top = opts.window || window.content;
        this._top.addEventListener("resize", this._resizeTimer.closure.tell, true);

        this._generate();

        // get all keys from the input queue
        util.threadYield(true);

        this._canUpdate = true;
        this._showHints();

        if (this._validHints.length == 0) {
            dactyl.beep();
            modes.pop();
        }
        else if (this._validHints.length == 1 && !this._continue)
            this._processHints(false);
        else // Ticket #185
            this._checkUnique();
    },

    /**
     * Cancel all hinting.
     */
    hide: function hide() {
        this._continue = false;
        if (this._top)
            this._top.removeEventListener("resize", this._resizeTimer.closure.tell, true);
        this._top = null;

        this._removeHints(0);
    },

    /**
     * Handle a hint mode event.
     *
     * @param {Event} event The event to handle.
     */
    onEvent: function onEvent(event) {
        let key = events.toString(event);
        let followFirst = false;

        // clear any timeout which might be active after pressing a number
        if (this._activeTimeout) {
            this._activeTimeout.cancel();
            this._activeTimeout = null;
        }

        switch (key) {
        case "<Return>":
            followFirst = true;
            break;

        case "<Tab>":
        case "<S-Tab>":
            this._usedTabKey = true;
            if (this._hintNumber == 0)
                this._hintNumber = 1;

            let oldId = this._hintNumber;
            if (key == "<Tab>") {
                if (++this._hintNumber > this._validHints.length)
                    this._hintNumber = 1;
            }
            else {
                if (--this._hintNumber < 1)
                    this._hintNumber = this._validHints.length;
            }
            this._showActiveHint(this._hintNumber, oldId);
            this._updateStatusline();
            return false;

        case "<BS>":
            if (this.prevInput !== "number")
                return true;

            if (this._hintNumber > 0 && !this._usedTabKey) {
                this._hintNumber = Math.floor(this._hintNumber / this.hintKeys.length);
                if (this._hintNumber == 0)
                    this.prevInput = "text";
            }
            else {
                this._usedTabKey = false;
                this._hintNumber = 0;
                dactyl.beep();
                return;
            }
            break;

       case options["mapleader"]:
           hints.escNumbers = !hints.escNumbers;
           if (hints.escNumbers && this._usedTabKey)
               this._hintNumber = 0;

           this._updateStatusline();
           return false;

        default:
            if (!this.escNumbers && this.isHintKey(key)) {
                this.prevInput = "number";

                let oldHintNumber = this._hintNumber;
                if (this._usedTabKey) {
                    this._hintNumber = 0;
                    this._usedTabKey = false;
                }
                this._hintNumber = this._hintNumber * this.hintKeys.length +
                    this.hintKeys.indexOf(key);

                this._updateStatusline();

                if (!this._canUpdate)
                    return;

                if (this._docs.length == 0) {
                    this._generate();
                    this._showHints();
                }
                this._showActiveHint(this._hintNumber, oldHintNumber || 1);

                dactyl.assert(this._hintNumber != 0);

                this._checkUnique();
                return false;
            }
            return true;
        }

        this._updateStatusline();

        if (this._canUpdate) {
            if (this._docs.length == 0 && this._hintString.length > 0)
                this._generate();

            this._showHints();
            this._processHints(followFirst);
        }
        return false;
    }
    //}}}
}, {
    translitTable: Class.memoize(function () {
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
        ].forEach(function (start, stop, val) {
            if (typeof val != "string")
                for (let i=start; i <= stop; i++)
                    table[String.fromCharCode(i)] = val[(i - start) % val.length];
            else {
                let n = val.charCodeAt(0);
                for (let i=start; i <= stop; i++)
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
        for (var i = 0; i < end; i++) {
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

    Mode: Struct("name", "prompt", "action", "tags")
}, {
    mappings: function () {
        var myModes = config.browserModes;
        mappings.add(myModes, ["f"],
            "Start QuickHint mode",
            function () { hints.show("o"); });

        // At the moment, "F" calls
        //    buffer.followLink(clicked_element, DO_WHAT_FIREFOX_DOES_WITH_CNTRL_CLICK)
        // It is not clear that it shouldn't be:
        //    buffer.followLink(clicked_element, !DO_WHAT_FIREFOX_DOES_WITH_CNTRL_CLICK)
        // In fact, it might be nice if there was a "dual" to F (like H and
        // gH, except that gF is already taken). --tpp
        //
        // Likewise, it might be nice to have a dactyl.NEW_FOREGROUND_TAB
        // and then make dactyl.NEW_TAB always do what a Cntrl+Click
        // does. --tpp
        mappings.add(myModes, ["F"],
            "Start QuickHint mode, but open link in a new tab",
            function () { hints.show(options.get("activate").has("links") ? "t" : "b"); });

        mappings.add(myModes, [";"],
            "Start an extended hint mode",
            function (count) { hints.open(";", { count: count }); },
            { count: true });

        mappings.add(myModes, ["g;"],
            "Start an extended hint mode and stay there until <Esc> is pressed",
            function (count) { hints.open("g;", { continue: true, count: count }); },
            { count: true });
    },
    options: function () {
        const DEFAULT_HINTTAGS =
            util.makeXPath(["input[not(@type='hidden')]", "a", "area", "iframe", "textarea", "button", "select",
                            "*[@onclick or @onmouseover or @onmousedown or @onmouseup or @oncommand or @role='link']"]);

        options.add(["extendedhinttags", "eht"],
            "XPath string of hintable elements activated by ';'",
            "regexmap", "[iI]:" + Option.quote(util.makeXPath(["img"])) +
                       ",[OTivVWy]:" + Option.quote(util.makeXPath(
                            ["{a,area}[@href]", "{img,iframe}[@src]"])) +
                       ",[S]:" + Option.quote(util.makeXPath(
                            ["input[not(@type='hidden')]", "textarea", "button", "select"])),
            { validator: Option.validateXPath });

        options.add(["hinttags", "ht"],
            "XPath string of hintable elements activated by 'f' and 'F'",
            "string", DEFAULT_HINTTAGS,
            { validator: Option.validateXPath });

        options.add(["hintkeys", "hk"],
            "The keys used to label and select hints",
            "string", "0123456789",
            {
                completer: function () [
                    ["0123456789", "Numbers"],
                    ["asdfg;lkjh", "Home Row"]],
                validator: function (value) {
                    let values = events.fromString(value).map(events.closure.toString);
                    return Option.validIf(array.uniq(values).length === values.length,
                                          "Duplicate keys not allowed")
                }
            });

        options.add(["hinttimeout", "hto"],
            "Timeout before automatically following a non-unique numerical hint",
            "number", 0,
            { validator: function (value) value >= 0 });

        options.add(["followhints", "fh"],
            // FIXME: this description isn't very clear but I can't think of a
            // better one right now.
            "Change the behavior of <Return> in hint mode",
            "number", 0,
            {
                completer: function () [
                    ["0", "Follow the first hint as soon as typed text uniquely identifies it. Follow the selected hint on <Return>."],
                    ["1", "Follow the selected hint on <Return>."],
                    ["2", "Follow the selected hint on <Return> only it's been <Tab>-selected."]
                ]
            });

        options.add(["hintmatching", "hm"],
            "How links are matched",
            "stringlist", "contains",
            {
                completer: function (context) [
                    ["contains",       "The typed characters are split on whitespace. The resulting groups must all appear in the hint."],
                    ["wordstartswith", "The typed characters are split on whitespace. The resulting groups must all match the beginings of words, in order."],
                    ["firstletters",   "Behaves like wordstartswith, but all groups much match a sequence of words."],
                    ["custom",         "Delegate to a custom function: dactyl.plugins.customHintMatcher(hintString)"],
                    ["transliterated", UTF8("When true, special latin characters are translated to their ASCII equivalents (e.g., é ⇒ e)")]
                ]
            });

        options.add(["wordseparators", "wsp"],
            "How words are split for hintmatching",
            "string", '[.,!?:;/"^$%&?()[\\]{}<>#*+|=~ _-]');

        options.add(["hintinputs", "hin"],
            "How text input fields are hinted",
            "stringlist", "label,value",
            {
                completer: function (context) [
                    ["value", "Match against the value contained by the input field"],
                    ["label", "Match against the value of a label for the input field, if one can be found"],
                    ["name",  "Match against the name of an input field, only if neither a name or value could be found."]
                ]
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
