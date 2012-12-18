// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2012 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("buffer", {
    exports: ["Buffer", "buffer"],
    require: ["prefs", "services", "util"]
});

lazyRequire("bookmarkcache", ["bookmarkcache"]);
lazyRequire("io", ["io"]);
lazyRequire("finder", ["RangeFind"]);
lazyRequire("overlay", ["overlay"]);
lazyRequire("storage", ["File", "storage"]);
lazyRequire("template", ["template"]);

/**
 * A class to manage the primary web content buffer. The name comes
 * from Vim's term, 'buffer', which signifies instances of open
 * files.
 * @instance buffer
 */
var Buffer = Module("Buffer", {
    Local: function Local(dactyl, modules, window) ({
        get win() {
            return window.content;

            let win = services.focus.focusedWindow;
            if (!win || win == window || util.topWindow(win) != window)
                return window.content
            if (win.top == window)
                return win;
            return win.top;
        }
    }),

    init: function init(win) {
        if (win)
            this.win = win;
    },

    get addPageInfoSection() Buffer.closure.addPageInfoSection,

    get pageInfo() Buffer.pageInfo,

    // called when the active document is scrolled
    _updateBufferPosition: function _updateBufferPosition() {
        this.modules.statusline.updateBufferPosition();
        this.modules.commandline.clear(true);
    },

    /**
     * @property {Array} The alternative style sheets for the current
     *     buffer. Only returns style sheets for the 'screen' media type.
     */
    get alternateStyleSheets() {
        let stylesheets = array.flatten(
            this.allFrames().map(function (w) Array.slice(w.document.styleSheets)));

        return stylesheets.filter(
            function (stylesheet) /^(screen|all|)$/i.test(stylesheet.media.mediaText) && !/^\s*$/.test(stylesheet.title)
        );
    },

    climbUrlPath: function climbUrlPath(count) {
        let { dactyl } = this.modules;

        let url = this.documentURI.clone();
        dactyl.assert(url instanceof Ci.nsIURL);

        while (count-- && url.path != "/")
            url.path = url.path.replace(/[^\/]*\/*$/, "");

        dactyl.assert(!url.equals(this.documentURI));
        dactyl.open(url.spec);
    },

    incrementURL: function incrementURL(count) {
        let { dactyl } = this.modules;

        let matches = this.uri.spec.match(/(.*?)(\d+)(\D*)$/);
        dactyl.assert(matches);
        let oldNum = matches[2];

        // disallow negative numbers as trailing numbers are often proceeded by hyphens
        let newNum = String(Math.max(parseInt(oldNum, 10) + count, 0));
        if (/^0/.test(oldNum))
            while (newNum.length < oldNum.length)
                newNum = "0" + newNum;

        matches[2] = newNum;
        dactyl.open(matches.slice(1).join(""));
    },

    /**
     * @property {number} True when the buffer is fully loaded.
     */
    get loaded() Math.min.apply(null,
        this.allFrames()
            .map(function (frame) ["loading", "interactive", "complete"]
                                      .indexOf(frame.document.readyState))),

    /**
     * @property {Object} The local state store for the currently selected
     *     tab.
     */
    get localStore() {
        let { doc } = this;

        let store = overlay.getData(doc, "buffer", null);
        if (!store || !this.localStorePrototype.isPrototypeOf(store))
            store = overlay.setData(doc, "buffer", Object.create(this.localStorePrototype));
        return store.instance = store;
    },

    localStorePrototype: memoize({
        instance: {},
        get jumps() [],
        jumpsIndex: -1
    }),

    /**
     * @property {Node} The last focused input field in the buffer. Used
     *     by the "gi" key binding.
     */
    get lastInputField() {
        let field = this.localStore.lastInputField && this.localStore.lastInputField.get();

        let doc = field && field.ownerDocument;
        let win = doc && doc.defaultView;
        return win && doc === win.document ? field : null;
    },
    set lastInputField(value) { this.localStore.lastInputField = util.weakReference(value); },

    /**
     * @property {nsIURI} The current top-level document.
     */
    get doc() this.win.document,

    get docShell() util.docShell(this.win),

    get modules() this.topWindow.dactyl.modules,
    set modules(val) {},

    topWindow: Class.Memoize(function () util.topWindow(this.win)),

    /**
     * @property {nsIURI} The current top-level document's URI.
     */
    get uri() util.newURI(this.win.location.href),

    /**
     * @property {nsIURI} The current top-level document's URI, sans any
     *     fragment identifier.
     */
    get documentURI() this.doc.documentURIObject || util.newURI(this.doc.documentURI),

    /**
     * @property {string} The current top-level document's URL.
     */
    get URL() update(new String(this.win.location.href), util.newURI(this.win.location.href)),

    /**
     * @property {number} The buffer's height in pixels.
     */
    get pageHeight() this.win.innerHeight,

    get contentViewer() this.docShell.contentViewer
                                     .QueryInterface(Components.interfaces.nsIMarkupDocumentViewer),

    /**
     * @property {number} The current browser's zoom level, as a
     *     percentage with 100 as 'normal'.
     */
    get zoomLevel() {
        let v = this.contentViewer;
        return v[v.textZoom == 1 ? "fullZoom" : "textZoom"] * 100
    },
    set zoomLevel(value) { this.setZoom(value, this.fullZoom); },

    /**
     * @property {boolean} Whether the current browser is using full
     *     zoom, as opposed to text zoom.
     */
    get fullZoom() this.ZoomManager.useFullZoom,
    set fullZoom(value) { this.setZoom(this.zoomLevel, value); },

    get ZoomManager() this.topWindow.ZoomManager,

    /**
     * @property {string} The current document's title.
     */
    get title() this.doc.title,

    /**
     * @property {number} The buffer's horizontal scroll percentile.
     */
    get scrollXPercent() {
        let elem = Buffer.Scrollable(this.findScrollable(0, true));
        if (elem.scrollWidth - elem.clientWidth === 0)
            return 0;
        return elem.scrollLeft * 100 / (elem.scrollWidth - elem.clientWidth);
    },

    /**
     * @property {number} The buffer's vertical scroll percentile.
     */
    get scrollYPercent() {
        let elem = Buffer.Scrollable(this.findScrollable(0, false));
        if (elem.scrollHeight - elem.clientHeight === 0)
            return 0;
        return elem.scrollTop * 100 / (elem.scrollHeight - elem.clientHeight);
    },

    /**
     * @property {{ x: number, y: number }} The buffer's current scroll position
     * as reported by {@link Buffer.getScrollPosition}.
     */
    get scrollPosition() Buffer.getScrollPosition(this.findScrollable(0, false)),

    /**
     * Returns a list of all frames in the given window or current buffer.
     */
    allFrames: function allFrames(win, focusedFirst) {
        let frames = [];
        (function rec(frame) {
            if (true || frame.document.body instanceof Ci.nsIDOMHTMLBodyElement)
                frames.push(frame);
            Array.forEach(frame.frames, rec);
        })(win || this.win);

        if (focusedFirst)
            return frames.filter(function (f) f === this.focusedFrame, this).concat(
                   frames.filter(function (f) f !== this.focusedFrame, this));
        return frames;
    },

    /**
     * @property {Window} Returns the currently focused frame.
     */
    get focusedFrame() {
        let frame = this.localStore.focusedFrame;
        return frame && frame.get() || this.win;
    },
    set focusedFrame(frame) {
        this.localStore.focusedFrame = util.weakReference(frame);
    },

    /**
     * Returns the currently selected word. If the selection is
     * null, it tries to guess the word that the caret is
     * positioned in.
     *
     * @returns {string}
     */
    get currentWord() Buffer.currentWord(this.focusedFrame),
    getCurrentWord: deprecated("buffer.currentWord", function getCurrentWord() Buffer.currentWord(this.focusedFrame, true)),

    /**
     * Returns true if a scripts are allowed to focus the given input
     * element or input elements in the given window.
     *
     * @param {Node|Window}
     * @returns {boolean}
     */
    focusAllowed: function focusAllowed(elem) {
        if (elem instanceof Ci.nsIDOMWindow && !DOM(elem).isEditable)
            return true;

        let { options } = this.modules;

        let doc = elem.ownerDocument || elem.document || elem;
        switch (options.get("strictfocus").getKey(doc.documentURIObject || util.newURI(doc.documentURI), "moderate")) {
        case "despotic":
            return overlay.getData(elem)["focus-allowed"]
                    || elem.frameElement && overlay.getData(elem.frameElement)["focus-allowed"];
        case "moderate":
            return overlay.getData(doc, "focus-allowed")
                    || elem.frameElement && overlay.getData(elem.frameElement.ownerDocument)["focus-allowed"];
        default:
            return true;
        }
    },

    /**
     * Focuses the given element. In contrast to a simple
     * elem.focus() call, this function works for iframes and
     * image maps.
     *
     * @param {Node} elem The element to focus.
     */
    focusElement: function focusElement(elem) {
        let win = elem.ownerDocument && elem.ownerDocument.defaultView || elem;
        overlay.setData(elem, "focus-allowed", true);
        overlay.setData(win.document, "focus-allowed", true);

        if (isinstance(elem, [Ci.nsIDOMHTMLFrameElement,
                              Ci.nsIDOMHTMLIFrameElement]))
            elem = elem.contentWindow;

        if (elem.document)
            overlay.setData(elem.document, "focus-allowed", true);

        if (elem instanceof Ci.nsIDOMHTMLInputElement && elem.type == "file") {
            Buffer.openUploadPrompt(elem);
            this.lastInputField = elem;
        }
        else {
            if (isinstance(elem, [Ci.nsIDOMHTMLInputElement,
                                  Ci.nsIDOMXULTextBoxElement]))
                var flags = services.focus.FLAG_BYMOUSE;
            else
                flags = services.focus.FLAG_SHOWRING;

            // Hack to deal with current versions of Firefox misplacing
            // the caret
            if (!overlay.getData(elem, "had-focus", false) && elem.value &&
                    elem instanceof Ci.nsIDOMHTMLInputElement &&
                    DOM(elem).isEditable &&
                    elem.selectionStart != null &&
                    elem.selectionStart == elem.selectionEnd)
                elem.selectionStart = elem.selectionEnd = elem.value.length;

            DOM(elem).focus(flags);

            if (elem instanceof Ci.nsIDOMWindow) {
                let sel = elem.getSelection();
                if (sel && !sel.rangeCount)
                    sel.addRange(RangeFind.endpoint(
                        RangeFind.nodeRange(elem.document.body || elem.document.documentElement),
                        true));
            }
            else {
                let range = RangeFind.nodeRange(elem);
                let sel = (elem.ownerDocument || elem).defaultView.getSelection();
                if (!sel.rangeCount || !RangeFind.intersects(range, sel.getRangeAt(0))) {
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }

            // for imagemap
            if (elem instanceof Ci.nsIDOMHTMLAreaElement) {
                try {
                    let [x, y] = elem.getAttribute("coords").split(",").map(parseFloat);

                    DOM(elem).mouseover({ screenX: x, screenY: y });
                }
                catch (e) {}
            }
        }
    },

    /**
     * Find the *count*th last link on a page matching one of the given
     * regular expressions, or with a @rel or @rev attribute matching
     * the given relation. Each frame is searched beginning with the
     * last link and progressing to the first, once checking for
     * matching @rel or @rev properties, and then once for each given
     * regular expression. The first match is returned. All frames of
     * the page are searched, beginning with the currently focused.
     *
     * If follow is true, the link is followed.
     *
     * @param {string} rel The relationship to look for.
     * @param {[RegExp]} regexps The regular expressions to search for.
     * @param {number} count The nth matching link to follow.
     * @param {bool} follow Whether to follow the matching link.
     * @param {string} path The CSS to use for the search. @optional
     */
    findLink: function findLink(rel, regexps, count, follow, path) {
        let { Hints, dactyl, options } = this.modules;

        let selector = path || options.get("hinttags").stringDefaultValue;

        function followFrame(frame) {
            function iter(elems) {
                for (let i = 0; i < elems.length; i++)
                    if (elems[i].rel.toLowerCase() === rel || elems[i].rev.toLowerCase() === rel)
                        yield elems[i];
            }

            let elems = frame.document.getElementsByTagName("link");
            for (let elem in iter(elems))
                yield elem;

            elems = frame.document.getElementsByTagName("a");
            for (let elem in iter(elems))
                yield elem;

            function a(regexp, elem) regexp.test(elem.textContent) === regexp.result ||
                            Array.some(elem.childNodes, function (child) regexp.test(child.alt) === regexp.result);
            function b(regexp, elem) regexp.test(elem.title) === regexp.result;

            let res = Array.filter(frame.document.querySelectorAll(selector), Hints.isVisible);
            for (let test in values([a, b]))
                for (let regexp in values(regexps))
                    for (let i in util.range(res.length, 0, -1))
                        if (test(regexp, res[i]))
                            yield res[i];
        }

        for (let frame in values(this.allFrames(null, true)))
            for (let elem in followFrame(frame))
                if (count-- === 0) {
                    if (follow)
                        this.followLink(elem, dactyl.CURRENT_TAB);
                    return elem;
                }

        if (follow)
            dactyl.beep();
    },
    followDocumentRelationship: deprecated("buffer.findLink",
        function followDocumentRelationship(rel) {
            let { options } = this.modules;

            this.findLink(rel, options[rel + "pattern"], 0, true);
        }),

    /**
     * Fakes a click on a link.
     *
     * @param {Node} elem The element to click.
     * @param {number} where Where to open the link. See
     *     {@link dactyl.open}.
     */
    followLink: function followLink(elem, where) {
        let { dactyl } = this.modules;

        let doc = elem.ownerDocument;
        let win = doc.defaultView;
        let { left: offsetX, top: offsetY } = elem.getBoundingClientRect();

        if (isinstance(elem, [Ci.nsIDOMHTMLFrameElement,
                              Ci.nsIDOMHTMLIFrameElement]))
            return this.focusElement(elem);

        if (isinstance(elem, Ci.nsIDOMHTMLLinkElement))
            return dactyl.open(elem.href, where);

        if (elem instanceof Ci.nsIDOMHTMLAreaElement) { // for imagemap
            let coords = elem.getAttribute("coords").split(",");
            offsetX = Number(coords[0]) + 1;
            offsetY = Number(coords[1]) + 1;
        }
        else if (elem instanceof Ci.nsIDOMHTMLInputElement && elem.type == "file") {
            Buffer.openUploadPrompt(elem);
            return;
        }

        let { dactyl } = this.modules;

        let ctrlKey = false, shiftKey = false;
        let button = 0;
        switch (dactyl.forceTarget || where) {
        case dactyl.NEW_TAB:
        case dactyl.NEW_BACKGROUND_TAB:
            button = 1;
            shiftKey = dactyl.forceBackground != null ? dactyl.forceBackground
                                                      : where != dactyl.NEW_BACKGROUND_TAB;
            break;
        case dactyl.NEW_WINDOW:
            shiftKey = true;
            break;
        case dactyl.CURRENT_TAB:
            break;
        }

        this.focusElement(elem);

        prefs.withContext(function () {
            prefs.set("browser.tabs.loadInBackground", true);
            let params = {
                button: button, screenX: offsetX, screenY: offsetY,
                ctrlKey: ctrlKey, shiftKey: shiftKey, metaKey: ctrlKey
            };

            DOM(elem).mousedown(params).mouseup(params);
            if (!config.haveGecko("2b"))
                DOM(elem).click(params);

            let sel = util.selectionController(win);
            sel.getSelection(sel.SELECTION_FOCUS_REGION).collapseToStart();
        });
    },

    /**
     * Resets the caret position so that it resides within the current
     * viewport.
     */
    resetCaret: function resetCaret() {
        function visible(range) util.intersection(DOM(range).rect, viewport);

        function getRanges(rect) {
            let nodes = win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils)
                           .nodesFromRect(rect.x, rect.y, 0, rect.width, rect.height, 0, false, false);
            return Array.filter(nodes, function (n) n instanceof Ci.nsIDOMText)
                        .map(RangeFind.nodeContents);
        }

        let win = this.focusedFrame;
        let doc = win.document;
        let sel = win.getSelection();
        let { viewport } = DOM(win);

        if (sel.rangeCount) {
            var range = sel.getRangeAt(0);
            if (visible(range).height > 0)
                return;

            var { rect } = DOM(range);
            var reverse = rect.bottom > viewport.bottom;

            rect = { x: rect.left, y: 0, width: rect.width, height: win.innerHeight };
        }
        else {
            let w = win.innerWidth;
            rect = { x: w / 3, y: 0, width: w / 3, height: win.innerHeight };
        }

        var reduce = function (a, b) DOM(a).rect.top < DOM(b).rect.top ? a : b;
        var dir = "forward";
        var y = 0;
        if (reverse) {
            reduce = function (a, b) DOM(b).rect.bottom > DOM(a).rect.bottom ? b : a;
            dir = "backward";
            y = win.innerHeight - 1;
        }

        let ranges = getRanges(rect);
        if (!ranges.length)
            ranges = getRanges({ x: 0, y: y, width: win.innerWidth, height: 0 });

        if (ranges.length) {
            range = ranges.reduce(reduce);

            if (range) {
                range.collapse(!reverse);
                sel.removeAllRanges();
                sel.addRange(range);
                do {
                    if (visible(range).height > 0)
                        break;

                    var { startContainer, startOffset } = range;
                    sel.modify("move", dir, "line");
                    range = sel.getRangeAt(0);
                }
                while (startContainer != range.startContainer || startOffset != range.startOffset);

                sel.modify("move", reverse ? "forward" : "backward", "lineboundary");
            }
        }

        if (!sel.rangeCount)
            sel.collapse(doc.body || doc.querySelector("body") || doc.documentElement,
                         0);
    },

    /**
     * @property {nsISelection} The current document's normal selection.
     */
    get selection() this.win.getSelection(),

    /**
     * @property {nsISelectionController} The current document's selection
     *     controller.
     */
    get selectionController() util.selectionController(this.focusedFrame),

    /**
     * Opens the appropriate context menu for *elem*.
     *
     * @param {Node} elem The context element.
     */
    openContextMenu: deprecated("DOM#contextmenu", function openContextMenu(elem) DOM(elem).contextmenu()),

    /**
     * Saves a page link to disk.
     *
     * @param {HTMLAnchorElement} elem The page link to save.
     * @param {boolean} overwrite If true, overwrite any existing file.
     */
    saveLink: function saveLink(elem, overwrite) {
        let { completion, dactyl, io } = this.modules;

        let self = this;
        let doc      = elem.ownerDocument;
        let uri      = util.newURI(elem.href || elem.src, null, util.newURI(elem.baseURI));
        let referrer = util.newURI(doc.documentURI, doc.characterSet);

        try {
            services.security.checkLoadURIWithPrincipal(doc.nodePrincipal, uri,
                        services.security.STANDARD);

            io.CommandFileMode(_("buffer.prompt.saveLink") + " ", {
                onSubmit: function (path) {
                    let file = io.File(path);
                    if (file.exists() && file.isDirectory())
                        file.append(Buffer.getDefaultNames(elem)[0][0]);

                    util.assert(!file.exists() || overwrite, _("io.existsNoOverride", file.path));

                    try {
                        if (!file.exists())
                            file.create(File.NORMAL_FILE_TYPE, octal(644));
                    }
                    catch (e) {
                        util.assert(false, _("save.invalidDestination", e.name));
                    }

                    self.saveURI(uri, file);
                },

                completer: function (context) completion.savePage(context, elem)
            }).open();
        }
        catch (e) {
            dactyl.echoerr(e);
        }
    },

    /**
     * Saves the contents of a URI to disk.
     *
     * @param {nsIURI} uri The URI to save
     * @param {nsIFile} file The file into which to write the result.
     */
    saveURI: function saveURI(uri, file, callback, self) {
        var persist = services.Persist();
        persist.persistFlags = persist.PERSIST_FLAGS_FROM_CACHE
                             | persist.PERSIST_FLAGS_REPLACE_EXISTING_FILES;

        let window = this.topWindow;
        file = File(file);
        if (!file.exists())
            file.create(Ci.nsIFile.NORMAL_FILE_TYPE, octal(666));

        let downloadListener = new window.DownloadListener(window,
                services.Transfer(uri, File(file).URI, "",
                                  null, null, null, persist));

        if (callback)
            persist.progressListener = update(Object.create(downloadListener), {
                onStateChange: util.wrapCallback(function onStateChange(progress, request, flags, status) {
                    if (callback && (flags & Ci.nsIWebProgressListener.STATE_STOP) && status == 0)
                        util.trapErrors(callback, self, uri, file.file, progress, request, flags, status);

                    return onStateChange.superapply(this, arguments);
                })
            });
        else
            persist.progressListener = downloadListener;

        persist.saveURI(uri, null, null, null, null, file.path);
    },

    /**
     * Scrolls the currently active element horizontally. See
     * {@link Buffer.scrollHorizontal} for parameters.
     */
    scrollHorizontal: function scrollHorizontal(increment, number)
        Buffer.scrollHorizontal(this.findScrollable(number, true), increment, number),

    /**
     * Scrolls the currently active element vertically. See
     * {@link Buffer.scrollVertical} for parameters.
     */
    scrollVertical: function scrollVertical(increment, number)
        Buffer.scrollVertical(this.findScrollable(number, false), increment, number),

    /**
     * Scrolls the currently active element to the given horizontal and
     * vertical percentages. See {@link Buffer.scrollToPercent} for
     * parameters.
     */
    scrollToPercent: function scrollToPercent(horizontal, vertical)
        Buffer.scrollToPercent(this.findScrollable(0, vertical == null), horizontal, vertical),

    /**
     * Scrolls the currently active element to the given horizontal and
     * vertical positions. See {@link Buffer.scrollToPosition} for
     * parameters.
     */
    scrollToPosition: function scrollToPosition(horizontal, vertical)
        Buffer.scrollToPosition(this.findScrollable(0, vertical == null), horizontal, vertical),

    _scrollByScrollSize: function _scrollByScrollSize(count, direction) {
        let { options } = this.modules;

        if (count > 0)
            options["scroll"] = count;
        this.scrollByScrollSize(direction);
    },

    /**
     * Scrolls the buffer vertically 'scroll' lines.
     *
     * @param {boolean} direction The direction to scroll. If true then
     *     scroll up and if false scroll down.
     * @param {number} count The multiple of 'scroll' lines to scroll.
     * @optional
     */
    scrollByScrollSize: function scrollByScrollSize(direction, count) {
        let { options } = this.modules;

        direction = direction ? 1 : -1;
        count = count || 1;

        if (options["scroll"] > 0)
            this.scrollVertical("lines", options["scroll"] * direction);
        else
            this.scrollVertical("pages", direction / 2);
    },

    /**
     * Find the best candidate scrollable element for the given
     * direction and orientation.
     *
     * @param {number} dir The direction in which the element must be
     *   able to scroll. Negative numbers represent up or left, while
     *   positive numbers represent down or right.
     * @param {boolean} horizontal If true, look for horizontally
     *   scrollable elements, otherwise look for vertically scrollable
     *   elements.
     */
    findScrollable: function findScrollable(dir, horizontal) {
        function find(elem) {
            while (elem && !(elem instanceof Ci.nsIDOMElement) && elem.parentNode)
                elem = elem.parentNode;
            for (; elem instanceof Ci.nsIDOMElement; elem = elem.parentNode)
                if (Buffer.isScrollable(elem, dir, horizontal))
                    break;

            return elem;
        }

        try {
            var elem = this.focusedFrame.document.activeElement;
            if (elem == elem.ownerDocument.body)
                elem = null;
        }
        catch (e) {}

        try {
            var sel = this.focusedFrame.getSelection();
        }
        catch (e) {}
        if (!elem && sel && sel.rangeCount)
            elem = sel.getRangeAt(0).startContainer;
        if (elem)
            elem = find(elem);

        if (!(elem instanceof Ci.nsIDOMElement)) {
            let doc = this.findScrollableWindow().document;
            elem = find(doc.body || doc.getElementsByTagName("body")[0] ||
                        doc.documentElement);
        }
        let doc = this.focusedFrame.document;
        return util.assert(elem || doc.body || doc.documentElement);
    },

    /**
     * Find the best candidate scrollable frame in the current buffer.
     */
    findScrollableWindow: function findScrollableWindow() {
        let { document } = this.topWindow;

        let win = document.commandDispatcher.focusedWindow;
        if (win && (win.scrollMaxX > 0 || win.scrollMaxY > 0))
            return win;

        let win = this.focusedFrame;
        if (win && (win.scrollMaxX > 0 || win.scrollMaxY > 0))
            return win;

        win = this.win;
        if (win.scrollMaxX > 0 || win.scrollMaxY > 0)
            return win;

        for (let frame in array.iterValues(win.frames))
            if (frame.scrollMaxX > 0 || frame.scrollMaxY > 0)
                return frame;

        return win;
    },

    /**
     * Finds the next visible element for the node path in 'jumptags'
     * for *arg*.
     *
     * @param {string} arg The element in 'jumptags' to use for the search.
     * @param {number} count The number of elements to jump.
     *      @optional
     * @param {boolean} reverse If true, search backwards. @optional
     * @param {boolean} offScreen If true, include only off-screen elements. @optional
     */
    findJump: function findJump(arg, count, reverse, offScreen) {
        let { marks, options } = this.modules;

        const FUDGE = 10;

        marks.push();

        let path = options["jumptags"][arg];
        util.assert(path, _("error.invalidArgument", arg));

        let distance = reverse ? function (rect) -rect.top : function (rect) rect.top;
        let elems = [[e, distance(e.getBoundingClientRect())] for (e in path.matcher(this.focusedFrame.document))]
                        .filter(function (e) e[1] > FUDGE)
                        .sort(function (a, b) a[1] - b[1])

        if (offScreen && !reverse)
            elems = elems.filter(function (e) e[1] > this, this.topWindow.innerHeight);

        let idx = Math.min((count || 1) - 1, elems.length);
        util.assert(idx in elems);

        let elem = elems[idx][0];
        elem.scrollIntoView(true);

        let sel = elem.ownerDocument.defaultView.getSelection();
        sel.removeAllRanges();
        sel.addRange(RangeFind.endpoint(RangeFind.nodeRange(elem), true));
    },

    // TODO: allow callback for filtering out unwanted frames? User defined?
    /**
     * Shifts the focus to another frame within the buffer. Each buffer
     * contains at least one frame.
     *
     * @param {number} count The number of frames to skip through. A negative
     *     count skips backwards.
     */
    shiftFrameFocus: function shiftFrameFocus(count) {
        if (!(this.doc instanceof Ci.nsIDOMHTMLDocument))
            return;

        let frames = this.allFrames();

        if (frames.length == 0) // currently top is always included
            return;

        // remove all hidden frames
        frames = frames.filter(function (frame) !(frame.document.body instanceof Ci.nsIDOMHTMLFrameSetElement))
                       .filter(function (frame) !frame.frameElement ||
            let (rect = frame.frameElement.getBoundingClientRect())
                rect.width && rect.height);

        // find the currently focused frame index
        let current = Math.max(0, frames.indexOf(this.focusedFrame));

        // calculate the next frame to focus
        let next = current + count;
        if (next < 0 || next >= frames.length)
            util.dactyl.beep();
        next = Math.constrain(next, 0, frames.length - 1);

        // focus next frame and scroll into view
        DOM(frames[next]).focus();
        if (frames[next] != this.win)
            DOM(frames[next].frameElement).scrollIntoView();

        // add the frame indicator
        let doc = frames[next].document;
        let indicator = DOM(["div", { highlight: "FrameIndicator" }], doc)
                            .appendTo(doc.body || doc.documentElement || doc);

        util.timeout(function () { indicator.remove(); }, 500);

        // Doesn't unattach
        //doc.body.setAttributeNS(NS, "activeframe", "true");
        //util.timeout(function () { doc.body.removeAttributeNS(NS, "activeframe"); }, 500);
    },

    // similar to pageInfo
    // TODO: print more useful information, just like the DOM inspector
    /**
     * Displays information about the specified element.
     *
     * @param {Node} elem The element to query.
     */
    showElementInfo: function showElementInfo(elem) {
        let { dactyl } = this.modules;

        dactyl.echo(["", /*L*/"Element:", ["br"], util.objectToString(elem, true)]);
    },

    /**
     * Displays information about the current buffer.
     *
     * @param {boolean} verbose Display more verbose information.
     * @param {string} sections A string limiting the displayed sections.
     * @default The value of 'pageinfo'.
     */
    showPageInfo: function showPageInfo(verbose, sections) {
        let { commandline, dactyl, options } = this.modules;

        let self = this;

        // Ctrl-g single line output
        if (!verbose) {
            let file = this.win.location.pathname.split("/").pop() || _("buffer.noName");
            let title = this.win.document.title || _("buffer.noTitle");

            let info = template.map(
                (sections || options["pageinfo"])
                    .map(function (opt) Buffer.pageInfo[opt].action.call(self)),
                function (res) res && iter(res).join(", ") || undefined,
                ", ").join("");

            if (bookmarkcache.isBookmarked(this.URL))
                info += ", " + _("buffer.bookmarked");

            let pageInfoText = [file.quote(), " [", info, "] ", title].join("");
            dactyl.echo(pageInfoText, commandline.FORCE_SINGLELINE);
            return;
        }

        let list = template.map(sections || options["pageinfo"], function (option) {
            let { action, title } = Buffer.pageInfo[option];
            return template.table(title, action.call(self, true));
        }, ["br"]);

        commandline.commandOutput(list);
    },

    /**
     * Stops loading and animations in the current content.
     */
    stop: function stop() {
        let { config } = this.modules;

        if (config.stop)
            config.stop();
        else
            this.docShell.stop(this.docShell.STOP_ALL);
    },

    /**
     * Opens a viewer to inspect the source of the currently selected
     * range.
     */
    viewSelectionSource: function viewSelectionSource() {
        // copied (and tuned somewhat) from browser.jar -> nsContextMenu.js
        let { document, window } = this.topWindow;

        let win = document.commandDispatcher.focusedWindow;
        if (win == this.topWindow)
            win = this.focusedFrame;

        let charset = win ? "charset=" + win.document.characterSet : null;

        window.openDialog("chrome://global/content/viewPartialSource.xul",
                          "_blank", "scrollbars,resizable,chrome,dialog=no",
                          null, charset, win.getSelection(), "selection");
    },

    /**
     * Opens a viewer to inspect the source of the current buffer or the
     * specified *url*. Either the default viewer or the configured external
     * editor is used.
     *
     * @param {string|object|null} loc If a string, the URL of the source,
     *      otherwise an object with some or all of the following properties:
     *
     *          url: The URL to view.
     *          doc: The document to view.
     *          line: The line to select.
     *          column: The column to select.
     *
     *      If no URL is provided, the current document is used.
     *  @default The current buffer.
     * @param {boolean} useExternalEditor View the source in the external editor.
     */
    viewSource: function viewSource(loc, useExternalEditor) {
        let { dactyl, editor, history, options } = this.modules;

        let window = this.topWindow;

        let doc = this.focusedFrame.document;

        if (isObject(loc)) {
            if (options.get("editor").has("line") || !loc.url)
                this.viewSourceExternally(loc.doc || loc.url || doc, loc);
            else
                window.openDialog("chrome://global/content/viewSource.xul",
                                  "_blank", "all,dialog=no",
                                  loc.url, null, null, loc.line);
        }
        else {
            if (useExternalEditor)
                this.viewSourceExternally(loc || doc);
            else {
                let url = loc || doc.location.href;
                const PREFIX = "view-source:";
                if (url.indexOf(PREFIX) == 0)
                    url = url.substr(PREFIX.length);
                else
                    url = PREFIX + url;

                let sh = history.session;
                if (sh[sh.index].URI.spec == url)
                    this.docShell.gotoIndex(sh.index);
                else
                    dactyl.open(url, { hide: true });
            }
        }
    },

    /**
     * Launches an editor to view the source of the given document. The
     * contents of the document are saved to a temporary local file and
     * removed when the editor returns. This function returns
     * immediately.
     *
     * @param {Document} doc The document to view.
     * @param {function|object} callback If a function, the callback to be
     *      called with two arguments: the nsIFile of the file, and temp, a
     *      boolean which is true if the file is temporary. Otherwise, an object
     *      with line and column properties used to determine where to open the
     *      source.
     *      @optional
     */
    viewSourceExternally: Class("viewSourceExternally",
        XPCOM([Ci.nsIWebProgressListener, Ci.nsISupportsWeakReference]), {
        init: function init(doc, callback) {
            this.callback = callable(callback) ? callback :
                function (file, temp) {
                    let { editor } = overlay.activeModules;

                    editor.editFileExternally(update({ file: file.path }, callback || {}),
                                              function () { temp && file.remove(false); });
                    return true;
                };

            let uri = isString(doc) ? util.newURI(doc) : util.newURI(doc.location.href);
            let ext = uri.fileExtension || "txt";
            if (doc.contentType)
                ext = services.mime.getPrimaryExtension(doc.contentType, ext);

            if (!isString(doc))
                return io.withTempFiles(function (temp) {
                    let encoder = services.HtmlEncoder();
                    encoder.init(doc, "text/unicode", encoder.OutputRaw|encoder.OutputPreformatted);
                    temp.write(encoder.encodeToString(), ">");
                    return this.callback(temp, true);
                }, this, true, ext);

            let file = util.getFile(uri);
            if (file)
                this.callback(file, false);
            else {
                this.file = io.createTempFile();
                var persist = services.Persist();
                persist.persistFlags = persist.PERSIST_FLAGS_REPLACE_EXISTING_FILES;
                persist.progressListener = this;
                persist.saveURI(uri, null, null, null, null, this.file);
            }
            return null;
        },

        onStateChange: function onStateChange(progress, request, flags, status) {
            if ((flags & this.STATE_STOP) && status == 0) {
                try {
                    var ok = this.callback(this.file, true);
                }
                finally {
                    if (ok !== true)
                        this.file.remove(false);
                }
            }
            return 0;
        }
    }),

    /**
     * Increases the zoom level of the current buffer.
     *
     * @param {number} steps The number of zoom levels to jump.
     * @param {boolean} fullZoom Whether to use full zoom or text zoom.
     */
    zoomIn: function zoomIn(steps, fullZoom) {
        this.bumpZoomLevel(steps, fullZoom);
    },

    /**
     * Decreases the zoom level of the current buffer.
     *
     * @param {number} steps The number of zoom levels to jump.
     * @param {boolean} fullZoom Whether to use full zoom or text zoom.
     */
    zoomOut: function zoomOut(steps, fullZoom) {
        this.bumpZoomLevel(-steps, fullZoom);
    },

    /**
     * Adjusts the page zoom of the current buffer to the given absolute
     * value.
     *
     * @param {number} value The new zoom value as a possibly fractional
     *   percentage of the page's natural size.
     * @param {boolean} fullZoom If true, zoom all content of the page,
     *   including raster images. If false, zoom only text. If omitted,
     *   use the current zoom function. @optional
     * @throws {FailedAssertion} if the given *value* is not within the
     *   closed range [Buffer.ZOOM_MIN, Buffer.ZOOM_MAX].
     */
    setZoom: function setZoom(value, fullZoom) {
        let { dactyl, statusline } = this.modules;
        let { ZoomManager } = this;

        if (fullZoom === undefined)
            fullZoom = ZoomManager.useFullZoom;
        else
            ZoomManager.useFullZoom = fullZoom;

        value /= 100;
        try {
            this.contentViewer.textZoom =  fullZoom ? 1 : value;
            this.contentViewer.fullZoom = !fullZoom ? 1 : value;
        }
        catch (e if e == Cr.NS_ERROR_ILLEGAL_VALUE) {
            return dactyl.echoerr(_("zoom.illegal"));
        }

        if (services.has("contentPrefs") && !storage.privateMode
                && prefs.get("browser.zoom.siteSpecific")) {
            services.contentPrefs[value != 1 ? "setPref" : "removePref"]
                (this.uri, "browser.content.full-zoom", value);
            services.contentPrefs[value != 1 ? "setPref" : "removePref"]
                (this.uri, "dactyl.content.full-zoom", fullZoom);
        }

        statusline.updateZoomLevel();
    },

    /**
     * Updates the zoom level of this buffer from a content preference.
     */
    updateZoom: util.wrapCallback(function updateZoom() {
        let self = this;
        let uri = this.uri;

        if (services.has("contentPrefs") && prefs.get("browser.zoom.siteSpecific"))
            services.contentPrefs.getPref(uri, "dactyl.content.full-zoom", function (val) {
                if (val != null && uri.equals(self.uri) && val != prefs.get("browser.zoom.full"))
                    [self.contentViewer.textZoom, self.contentViewer.fullZoom] =
                        [self.contentViewer.fullZoom, self.contentViewer.textZoom];
            });
    }),

    /**
     * Adjusts the page zoom of the current buffer relative to the
     * current zoom level.
     *
     * @param {number} steps The integral number of natural fractions by which
     *     to adjust the current page zoom. If positive, the zoom level is
     *     increased, if negative it is decreased.
     * @param {boolean} fullZoom If true, zoom all content of the page,
     *     including raster images. If false, zoom only text. If omitted, use
     *     the current zoom function. @optional
     * @throws {FailedAssertion} if the buffer's zoom level is already at its
     *     extreme in the given direction.
     */
    bumpZoomLevel: function bumpZoomLevel(steps, fullZoom) {
        let { ZoomManager } = this;

        if (fullZoom === undefined)
            fullZoom = ZoomManager.useFullZoom;

        let values = ZoomManager.zoomValues;
        let cur = values.indexOf(ZoomManager.snap(this.zoomLevel / 100));
        let i = Math.constrain(cur + steps, 0, values.length - 1);

        util.assert(i != cur || fullZoom != ZoomManager.useFullZoom);

        this.setZoom(Math.round(values[i] * 100), fullZoom);
    },

    getAllFrames: deprecated("buffer.allFrames", "allFrames"),
    scrollTop: deprecated("buffer.scrollToPercent", function scrollTop() this.scrollToPercent(null, 0)),
    scrollBottom: deprecated("buffer.scrollToPercent", function scrollBottom() this.scrollToPercent(null, 100)),
    scrollStart: deprecated("buffer.scrollToPercent", function scrollStart() this.scrollToPercent(0, null)),
    scrollEnd: deprecated("buffer.scrollToPercent", function scrollEnd() this.scrollToPercent(100, null)),
    scrollColumns: deprecated("buffer.scrollHorizontal", function scrollColumns(cols) this.scrollHorizontal("columns", cols)),
    scrollPages: deprecated("buffer.scrollHorizontal", function scrollPages(pages) this.scrollVertical("pages", pages)),
    scrollTo: deprecated("Buffer.scrollTo", function scrollTo(x, y) this.win.scrollTo(x, y)),
    textZoom: deprecated("buffer.zoomValue/buffer.fullZoom", function textZoom() this.contentViewer.markupDocumentViewer.textZoom * 100)
}, {
    PageInfo: Struct("PageInfo", "name", "title", "action")
                        .localize("title"),

    pageInfo: {},

    /**
     * Adds a new section to the page information output.
     *
     * @param {string} option The section's value in 'pageinfo'.
     * @param {string} title The heading for this section's
     *     output.
     * @param {function} func The function to generate this
     *     section's output.
     */
    addPageInfoSection: function addPageInfoSection(option, title, func) {
        this.pageInfo[option] = Buffer.PageInfo(option, title, func);
    },

    Scrollable: function Scrollable(elem) {
        if (elem instanceof Ci.nsIDOMElement)
            return elem;
        if (isinstance(elem, [Ci.nsIDOMWindow, Ci.nsIDOMDocument]))
            return {
                __proto__: elem.documentElement || elem.ownerDocument.documentElement,

                win: elem.defaultView || elem.ownerDocument.defaultView,

                get clientWidth() this.win.innerWidth,
                get clientHeight() this.win.innerHeight,

                get scrollWidth() this.win.scrollMaxX + this.win.innerWidth,
                get scrollHeight() this.win.scrollMaxY + this.win.innerHeight,

                get scrollLeft() this.win.scrollX,
                set scrollLeft(val) { this.win.scrollTo(val, this.win.scrollY) },

                get scrollTop() this.win.scrollY,
                set scrollTop(val) { this.win.scrollTo(this.win.scrollX, val) }
            };
        return elem;
    },

    get ZOOM_MIN() prefs.get("zoom.minPercent"),
    get ZOOM_MAX() prefs.get("zoom.maxPercent"),

    setZoom: deprecated("buffer.setZoom", function setZoom()
                        let ({ buffer } = overlay.activeModules) buffer.setZoom.apply(buffer, arguments)),
    bumpZoomLevel: deprecated("buffer.bumpZoomLevel", function bumpZoomLevel()
                              let ({ buffer } = overlay.activeModules) buffer.bumpZoomLevel.apply(buffer, arguments)),

    /**
     * Returns the currently selected word in *win*. If the selection is
     * null, it tries to guess the word that the caret is positioned in.
     *
     * @returns {string}
     */
    currentWord: function currentWord(win, select) {
        let { Editor, options } = Buffer(win).modules;

        let selection = win.getSelection();
        if (selection.rangeCount == 0)
            return "";

        let range = selection.getRangeAt(0).cloneRange();
        if (range.collapsed) {
            let re = options.get("iskeyword").regexp;
            Editor.extendRange(range, true,  re, true);
            Editor.extendRange(range, false, re, true);
        }
        if (select) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
        return DOM.stringify(range);
    },

    getDefaultNames: function getDefaultNames(node) {
        let url = node.href || node.src || node.documentURI;
        let currExt = url.replace(/^.*?(?:\.([a-z0-9]+))?$/i, "$1").toLowerCase();

        let ext = "";
        if (isinstance(node, [Ci.nsIDOMDocument,
                              Ci.nsIDOMHTMLImageElement])) {
            let type = node.contentType || node.QueryInterface(Ci.nsIImageLoadingContent)
                                               .getRequest(0).mimeType;

            if (type === "text/plain")
                ext = "." + (currExt || "txt");
            else
                ext = "." + services.mime.getPrimaryExtension(type, currExt);
        }
        else if (currExt)
            ext = "." + currExt;

        let re = ext ? RegExp("(\\." + currExt + ")?$", "i") : /$/;

        var names = [];
        if (node.title)
            names.push([node.title,
                       _("buffer.save.pageName")]);

        if (node.alt)
            names.push([node.alt,
                       _("buffer.save.altText")]);

        if (!isinstance(node, Ci.nsIDOMDocument) && node.textContent)
            names.push([node.textContent,
                       _("buffer.save.linkText")]);

        names.push([decodeURIComponent(url.replace(/.*?([^\/]*)\/*$/, "$1")),
                    _("buffer.save.filename")]);

        return names.filter(function ([leaf, title]) leaf)
                    .map(function ([leaf, title]) [leaf.replace(config.OS.illegalCharacters, encodeURIComponent)
                                                       .replace(re, ext), title]);
    },

    findScrollableWindow: deprecated("buffer.findScrollableWindow", function findScrollableWindow()
                                     let ({ buffer } = overlay.activeModules) buffer.findScrollableWindow.apply(buffer, arguments)),
    findScrollable: deprecated("buffer.findScrollable", function findScrollable()
                               let ({ buffer } = overlay.activeModules) buffer.findScrollable.apply(buffer, arguments)),

    isScrollable: function isScrollable(elem, dir, horizontal) {
        if (!DOM(elem).isScrollable(horizontal ? "horizontal" : "vertical"))
            return false;

        return this.canScroll(elem, dir, horizontal);
    },

    canScroll: function canScroll(elem, dir, horizontal) {
        let pos = "scrollTop", size = "clientHeight", max = "scrollHeight", layoutSize = "offsetHeight",
            overflow = "overflowX", border1 = "borderTopWidth", border2 = "borderBottomWidth";
        if (horizontal)
            pos = "scrollLeft", size = "clientWidth", max = "scrollWidth", layoutSize = "offsetWidth",
            overflow = "overflowX", border1 = "borderLeftWidth", border2 = "borderRightWidth";

        let style = DOM(elem).style;
        let borderSize = Math.round(parseFloat(style[border1]) + parseFloat(style[border2]));
        let realSize = elem[size];

        // Stupid Gecko eccentricities. May fail for quirks mode documents.
        if (elem[size] + borderSize == elem[max] || elem[size] == 0) // Stupid, fallible heuristic.
            return false;

        if (style[overflow] == "hidden")
            realSize += borderSize;
        return dir < 0 && elem[pos] > 0 || dir > 0 && elem[pos] + realSize < elem[max] || !dir && realSize < elem[max];
    },

    /**
     * Scroll the contents of the given element to the absolute *left*
     * and *top* pixel offsets.
     *
     * @param {Element} elem The element to scroll.
     * @param {number|null} left The left absolute pixel offset. If
     *      null, to not alter the horizontal scroll offset.
     * @param {number|null} top The top absolute pixel offset. If
     *      null, to not alter the vertical scroll offset.
     * @param {string} reason The reason for the scroll event. See
     *      {@link marks.push}. @optional
     */
    scrollTo: function scrollTo(elem, left, top, reason) {
        let doc = elem.ownerDocument || elem.document || elem;

        let { buffer, marks, options } = util.topWindow(doc.defaultView).dactyl.modules;

        if (~[elem, elem.document, elem.ownerDocument].indexOf(buffer.focusedFrame.document))
            marks.push(reason);

        if (options["scrollsteps"] > 1)
            return this.smoothScrollTo(elem, left, top);

        elem = Buffer.Scrollable(elem);
        if (left != null)
            elem.scrollLeft = left;
        if (top != null)
            elem.scrollTop = top;
    },

    /**
     * Like scrollTo, but scrolls more smoothly and does not update
     * marks.
     */
    smoothScrollTo: function smoothScrollTo(node, x, y) {
        let { options } = overlay.activeModules;

        let time = options["scrolltime"];
        let steps = options["scrollsteps"];

        let elem = Buffer.Scrollable(node);

        if (node.dactylScrollTimer)
            node.dactylScrollTimer.cancel();

        if (x == null)
            x = elem.scrollLeft;
        if (y == null)
            y = elem.scrollTop;

        x = node.dactylScrollDestX = Math.min(x, elem.scrollWidth  - elem.clientWidth);
        y = node.dactylScrollDestY = Math.min(y, elem.scrollHeight - elem.clientHeight);
        let [startX, startY] = [elem.scrollLeft, elem.scrollTop];
        let n = 0;
        (function next() {
            if (n++ === steps) {
                elem.scrollLeft = x;
                elem.scrollTop  = y;
                delete node.dactylScrollDestX;
                delete node.dactylScrollDestY;
            }
            else {
                elem.scrollLeft = startX + (x - startX) / steps * n;
                elem.scrollTop  = startY + (y - startY) / steps * n;
                node.dactylScrollTimer = util.timeout(next, time / steps);
            }
        }).call(this);
    },

    /**
     * Scrolls the currently given element horizontally.
     *
     * @param {Element} elem The element to scroll.
     * @param {string} unit The increment by which to scroll.
     *   Possible values are: "columns", "pages"
     * @param {number} number The possibly fractional number of
     *   increments to scroll. Positive values scroll to the right while
     *   negative values scroll to the left.
     * @throws {FailedAssertion} if scrolling is not possible in the
     *   given direction.
     */
    scrollHorizontal: function scrollHorizontal(node, unit, number) {
        let fontSize = parseInt(DOM(node).style.fontSize);

        let elem = Buffer.Scrollable(node);
        let increment;
        if (unit == "columns")
            increment = fontSize; // Good enough, I suppose.
        else if (unit == "pages")
            increment = elem.clientWidth - fontSize;
        else
            throw Error();

        util.assert(number < 0 ? elem.scrollLeft > 0 : elem.scrollLeft < elem.scrollWidth - elem.clientWidth);

        let left = node.dactylScrollDestX !== undefined ? node.dactylScrollDestX : elem.scrollLeft;
        node.dactylScrollDestX = undefined;

        Buffer.scrollTo(node, left + number * increment, null, "h-" + unit);
    },

    /**
     * Scrolls the given element vertically.
     *
     * @param {Element} elem The element to scroll.
     * @param {string} unit The increment by which to scroll.
     *   Possible values are: "lines", "pages"
     * @param {number} number The possibly fractional number of
     *   increments to scroll. Positive values scroll upward while
     *   negative values scroll downward.
     * @throws {FailedAssertion} if scrolling is not possible in the
     *   given direction.
     */
    scrollVertical: function scrollVertical(node, unit, number) {
        let fontSize = parseInt(DOM(node).style.lineHeight);

        let elem = Buffer.Scrollable(node);
        let increment;
        if (unit == "lines")
            increment = fontSize;
        else if (unit == "pages")
            increment = elem.clientHeight - fontSize;
        else
            throw Error();

        util.assert(number < 0 ? elem.scrollTop > 0 : elem.scrollTop < elem.scrollHeight - elem.clientHeight);

        let top = node.dactylScrollDestY !== undefined ? node.dactylScrollDestY : elem.scrollTop;
        node.dactylScrollDestY = undefined;

        Buffer.scrollTo(node, null, top + number * increment, "v-" + unit);
    },

    /**
     * Scrolls the currently active element to the given horizontal and
     * vertical percentages.
     *
     * @param {Element} elem The element to scroll.
     * @param {number|null} horizontal The possibly fractional
     *   percentage of the current viewport width to scroll to. If null,
     *   do not scroll horizontally.
     * @param {number|null} vertical The possibly fractional percentage
     *   of the current viewport height to scroll to. If null, do not
     *   scroll vertically.
     */
    scrollToPercent: function scrollToPercent(node, horizontal, vertical) {
        let elem = Buffer.Scrollable(node);
        Buffer.scrollTo(node,
                        horizontal == null ? null
                                           : (elem.scrollWidth - elem.clientWidth) * (horizontal / 100),
                        vertical   == null ? null
                                           : (elem.scrollHeight - elem.clientHeight) * (vertical / 100));
    },

    /**
     * Scrolls the currently active element to the given horizontal and
     * vertical position.
     *
     * @param {Element} elem The element to scroll.
     * @param {number|null} horizontal The possibly fractional
     *      line ordinal to scroll to.
     * @param {number|null} vertical The possibly fractional
     *      column ordinal to scroll to.
     */
    scrollToPosition: function scrollToPosition(elem, horizontal, vertical) {
        let style = DOM(elem.body || elem).style;
        Buffer.scrollTo(elem,
                        horizontal == null ? null :
                        horizontal == 0    ? 0    : this._exWidth(elem) * horizontal,
                        vertical   == null ? null : parseFloat(style.lineHeight) * vertical);
    },

    /**
     * Returns the current scroll position as understood by
     * {@link #scrollToPosition}.
     *
     * @param {Element} elem The element to scroll.
     */
    getScrollPosition: function getPosition(node) {
        let style = DOM(node.body || node).style;

        let elem = Buffer.Scrollable(node);
        return {
            x: elem.scrollLeft && elem.scrollLeft / this._exWidth(node),
            y: elem.scrollTop / parseFloat(style.lineHeight)
        }
    },

    _exWidth: function _exWidth(elem) {
        try {
            let div = DOM(["elem", { style: "width: 1ex !important; position: absolute !important; padding: 0 !important; display: block;" }],
                          elem.ownerDocument).appendTo(elem.body || elem);
            try {
                return parseFloat(div.style.width);
            }
            finally {
                div.remove();
            }
        }
        catch (e) {
            return parseFloat(DOM(elem).fontSize) / 1.618;
        }
    },

    openUploadPrompt: function openUploadPrompt(elem) {
        let { io } = overlay.activeModules;

        io.CommandFileMode(_("buffer.prompt.uploadFile") + " ", {
            onSubmit: function onSubmit(path) {
                let file = io.File(path);
                util.assert(file.exists());

                DOM(elem).val(file.path).change();
            }
        }).open(elem.value);
    }
}, {
    init: function init(dactyl, modules, window) {
        init.superapply(this, arguments);

        dactyl.commands["buffer.viewSource"] = function (event) {
            let elem = event.originalTarget;
            let obj = { url: elem.getAttribute("href"), line: Number(elem.getAttribute("line")) };
            if (elem.hasAttribute("column"))
                obj.column = elem.getAttribute("column");

            modules.buffer.viewSource(obj);
        };
    },
    commands: function initCommands(dactyl, modules, window) {
        let { buffer, commands, config, options } = modules;

        commands.add(["frameo[nly]"],
            "Show only the current frame's page",
            function (args) {
                dactyl.open(buffer.focusedFrame.location.href);
            },
            { argCount: "0" });

        commands.add(["ha[rdcopy]"],
            "Print current document",
            function (args) {
                let arg = args[0];

                // FIXME: arg handling is a bit of a mess, check for filename
                dactyl.assert(!arg || arg[0] == ">" && !config.OS.isWindows,
                              _("error.trailingCharacters"));

                const PRINTER  = "PostScript/default";
                const BRANCH   = "printer_" + PRINTER + ".";
                const BRANCHES = ["print.", BRANCH, "print." + BRANCH];
                function set(pref, value) {
                    BRANCHES.forEach(function (branch) { prefs.set(branch + pref, value) });
                }

                prefs.withContext(function () {
                    if (arg) {
                        prefs.set("print.print_printer", PRINTER);

                        set("print_to_file", true);
                        set("print_to_filename", io.File(arg.substr(1)).path);

                        dactyl.echomsg(_("print.toFile", arg.substr(1)));
                    }
                    else
                        dactyl.echomsg(_("print.sending"));

                    prefs.set("print.always_print_silent", args.bang);
                    if (false)
                        prefs.set("print.show_print_progress", !args.bang);

                    config.browser.contentWindow.print();
                });

                dactyl.echomsg(_("print.sent"));
            },
            {
                argCount: "?",
                bang: true,
                completer: function (context, args) {
                    if (args.bang && /^>/.test(context.filter))
                        context.fork("file", 1, modules.completion, "file");
                },
                literal: 0
            });

        commands.add(["pa[geinfo]"],
            "Show various page information",
            function (args) {
                let arg = args[0];
                let opt = options.get("pageinfo");

                dactyl.assert(!arg || opt.validator(opt.parse(arg)),
                              _("error.invalidArgument", arg));
                buffer.showPageInfo(true, arg);
            },
            {
                argCount: "?",
                completer: function (context) {
                    modules.completion.optionValue(context, "pageinfo", "+", "");
                    context.title = ["Page Info"];
                }
            });

        commands.add(["pagest[yle]", "pas"],
            "Select the author style sheet to apply",
            function (args) {
                let arg = args[0] || "";

                let titles = buffer.alternateStyleSheets.map(function (stylesheet) stylesheet.title);

                dactyl.assert(!arg || titles.indexOf(arg) >= 0,
                              _("error.invalidArgument", arg));

                if (options["usermode"])
                    options["usermode"] = false;

                window.stylesheetSwitchAll(buffer.focusedFrame, arg);
            },
            {
                argCount: "?",
                completer: function (context) modules.completion.alternateStyleSheet(context),
                literal: 0
            });

        commands.add(["re[load]"],
            "Reload the current web page",
            function (args) { modules.tabs.reload(config.browser.mCurrentTab, args.bang); },
            {
                argCount: "0",
                bang: true
            });

        // TODO: we're prompted if download.useDownloadDir isn't set and no arg specified - intentional?
        commands.add(["sav[eas]", "w[rite]"],
            "Save current document to disk",
            function (args) {
                let { commandline, io } = modules;
                let { doc, win } = buffer;

                let chosenData = null;
                let filename = args[0];

                let command = commandline.command;
                if (filename) {
                    if (filename[0] == "!")
                        return buffer.viewSourceExternally(buffer.focusedFrame.document,
                            function (file) {
                                let output = io.system(filename.substr(1), file);
                                commandline.command = command;
                                commandline.commandOutput(["span", { highlight: "CmdOutput" }, output]);
                            });

                    if (/^>>/.test(filename)) {
                        let file = io.File(filename.replace(/^>>\s*/, ""));
                        dactyl.assert(args.bang || file.exists() && file.isWritable(),
                                      _("io.notWriteable", file.path.quote()));

                        return buffer.viewSourceExternally(buffer.focusedFrame.document,
                            function (tmpFile) {
                                try {
                                    file.write(tmpFile, ">>");
                                }
                                catch (e) {
                                    dactyl.echoerr(_("io.notWriteable", file.path.quote()));
                                }
                            });
                    }

                    let file = io.File(filename);

                    if (filename.substr(-1) === File.PATH_SEP || file.exists() && file.isDirectory())
                        file.append(Buffer.getDefaultNames(doc)[0][0]);

                    dactyl.assert(args.bang || !file.exists(), _("io.exists"));

                    chosenData = { file: file, uri: util.newURI(doc.location.href) };
                }

                // if browser.download.useDownloadDir = false then the "Save As"
                // dialog is used with this as the default directory
                // TODO: if we're going to do this shouldn't it be done in setCWD or the value restored?
                prefs.set("browser.download.lastDir", io.cwd.path);

                try {
                    var contentDisposition = win.QueryInterface(Ci.nsIInterfaceRequestor)
                                                .getInterface(Ci.nsIDOMWindowUtils)
                                                .getDocumentMetadata("content-disposition");
                }
                catch (e) {}

                window.internalSave(doc.location.href, doc, null, contentDisposition,
                                    doc.contentType, false, null, chosenData,
                                    doc.referrer ? window.makeURI(doc.referrer) : null,
                                    true);
            },
            {
                argCount: "?",
                bang: true,
                completer: function (context) {
                    let { buffer, completion } = modules;

                    if (context.filter[0] == "!")
                        return;
                    if (/^>>/.test(context.filter))
                        context.advance(/^>>\s*/.exec(context.filter)[0].length);

                    completion.savePage(context, buffer.doc);
                    context.fork("file", 0, completion, "file");
                },
                literal: 0
            });

        commands.add(["st[op]"],
            "Stop loading the current web page",
            function () { buffer.stop(); },
            { argCount: "0" });

        commands.add(["vie[wsource]"],
            "View source code of current document",
            function (args) { buffer.viewSource(args[0], args.bang); },
            {
                argCount: "?",
                bang: true,
                completer: function (context) modules.completion.url(context, "bhf")
            });

        commands.add(["zo[om]"],
            "Set zoom value of current web page",
            function (args) {
                let arg = args[0];
                let level;

                if (!arg)
                    level = 100;
                else if (/^\d+$/.test(arg))
                    level = parseInt(arg, 10);
                else if (/^[+-]\d+$/.test(arg))
                    level = Math.round(buffer.zoomLevel + parseInt(arg, 10));
                else
                    dactyl.assert(false, _("error.trailingCharacters"));

                buffer.setZoom(level, args.bang);
            },
            {
                argCount: "?",
                bang: true
            });
    },
    completion: function initCompletion(dactyl, modules, window) {
        let { CompletionContext, buffer, completion } = modules;

        completion.alternateStyleSheet = function alternateStylesheet(context) {
            context.title = ["Stylesheet", "Location"];

            // unify split style sheets
            let styles = iter([s.title, []] for (s in values(buffer.alternateStyleSheets))).toObject();

            buffer.alternateStyleSheets.forEach(function (style) {
                styles[style.title].push(style.href || _("style.inline"));
            });

            context.completions = [[title, href.join(", ")] for ([title, href] in Iterator(styles))];
        };

        completion.savePage = function savePage(context, node) {
            context.fork("generated", context.filter.replace(/[^/]*$/, "").length,
                         this, function (context) {
                context.generate = function () {
                    this.incomplete = true;
                    this.completions = Buffer.getDefaultNames(node);
                    util.httpGet(node.href || node.src || node.documentURI, {
                        method: "HEAD",
                        callback: function callback(xhr) {
                            context.incomplete = false;
                            try {
                                if (/filename="(.*?)"/.test(xhr.getResponseHeader("Content-Disposition")))
                                    context.completions.push([decodeURIComponent(RegExp.$1),
                                                             _("buffer.save.suggested")]);
                            }
                            finally {
                                context.completions = context.completions.slice();
                            }
                        },
                        notificationCallbacks: Class(XPCOM([Ci.nsIChannelEventSink, Ci.nsIInterfaceRequestor]), {
                            getInterface: function getInterface(iid) this.QueryInterface(iid),

                            asyncOnChannelRedirect: function (oldChannel, newChannel, flags, callback) {
                                if (newChannel instanceof Ci.nsIHttpChannel)
                                    newChannel.requestMethod = "HEAD";
                                callback.onRedirectVerifyCallback(Cr.NS_OK);
                            }
                        })()
                    });
                };
            });
        };
    },
    events: function initEvents(dactyl, modules, window) {
        let { buffer, config, events } = modules;

        events.listen(config.browser, "scroll", buffer.closure._updateBufferPosition, false);
    },
    mappings: function initMappings(dactyl, modules, window) {
        let { Editor, Events, buffer, editor, events, ex, mappings, modes, options, tabs } = modules;

        mappings.add([modes.NORMAL],
            ["y", "<yank-location>"], "Yank current location to the clipboard",
            function () {
                let { doc, uri } = buffer;
                if (uri instanceof Ci.nsIURL)
                    uri.query = uri.query.replace(/(?:^|&)utm_[^&]+/g, "")
                                         .replace(/^&/, "");

                let link = DOM("link[href][rev=canonical], link[href][rel=shortlink]", doc);
                let url = link.length && options.get("yankshort").getKey(uri) ? link.attr("href") : uri.spec;
                dactyl.clipboardWrite(url, true);
            });

        mappings.add([modes.NORMAL],
            ["<C-a>", "<increment-url-path>"], "Increment last number in URL",
            function (args) { buffer.incrementURL(Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL],
            ["<C-x>", "<decrement-url-path>"], "Decrement last number in URL",
            function (args) { buffer.incrementURL(-Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["gu", "<open-parent-path>"],
            "Go to parent directory",
            function (args) { buffer.climbUrlPath(Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["gU", "<open-root-path>"],
            "Go to the root of the website",
            function () { buffer.climbUrlPath(-1); });

        mappings.add([modes.COMMAND], [".", "<repeat-key>"],
            "Repeat the last key event",
            function (args) {
                if (mappings.repeat) {
                    for (let i in util.interruptibleRange(0, Math.max(args.count, 1), 100))
                        mappings.repeat();
                }
            },
            { count: true });

        mappings.add([modes.NORMAL], ["i", "<Insert>"],
            "Start Caret mode",
            function () { modes.push(modes.CARET); });

        mappings.add([modes.NORMAL], ["<C-c>", "<stop-load>"],
            "Stop loading the current web page",
            function () { ex.stop(); });

        // scrolling
        mappings.add([modes.NORMAL], ["j", "<Down>", "<C-e>", "<scroll-down-line>"],
            "Scroll document down",
            function (args) { buffer.scrollVertical("lines", Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["k", "<Up>", "<C-y>", "<scroll-up-line>"],
            "Scroll document up",
            function (args) { buffer.scrollVertical("lines", -Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.COMMAND], dactyl.has("mail") ? ["h", "<scroll-left-column>"] : ["h", "<Left>", "<scroll-left-column>"],
            "Scroll document to the left",
            function (args) { buffer.scrollHorizontal("columns", -Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], dactyl.has("mail") ? ["l", "<scroll-right-column>"] : ["l", "<Right>", "<scroll-right-column>"],
            "Scroll document to the right",
            function (args) { buffer.scrollHorizontal("columns", Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["0", "^", "<scroll-begin>"],
            "Scroll to the absolute left of the document",
            function () { buffer.scrollToPercent(0, null); });

        mappings.add([modes.NORMAL], ["$", "<scroll-end>"],
            "Scroll to the absolute right of the document",
            function () { buffer.scrollToPercent(100, null); });

        mappings.add([modes.NORMAL], ["gg", "<Home>", "<scroll-top>"],
            "Go to the top of the document",
            function (args) { buffer.scrollToPercent(null, args.count != null ? args.count : 0); },
            { count: true });

        mappings.add([modes.NORMAL], ["G", "<End>", "<scroll-bottom>"],
            "Go to the end of the document",
            function (args) {
                if (args.count)
                    var elem = options.get("linenumbers")
                                      .getLine(buffer.focusedFrame.document,
                                               args.count);
                if (elem)
                    elem.scrollIntoView(true);
                else if (args.count)
                    buffer.scrollToPosition(null, args.count);
                else
                    buffer.scrollToPercent(null, 100);
            },
            { count: true });

        mappings.add([modes.NORMAL], ["%", "<scroll-percent>"],
            "Scroll to {count} percent of the document",
            function (args) {
                dactyl.assert(args.count > 0 && args.count <= 100);
                buffer.scrollToPercent(null, args.count);
            },
            { count: true });

        mappings.add([modes.NORMAL], ["<C-d>", "<scroll-down>"],
            "Scroll window downwards in the buffer",
            function (args) { buffer._scrollByScrollSize(args.count, true); },
            { count: true });

        mappings.add([modes.NORMAL], ["<C-u>", "<scroll-up>"],
            "Scroll window upwards in the buffer",
            function (args) { buffer._scrollByScrollSize(args.count, false); },
            { count: true });

        mappings.add([modes.NORMAL], ["<C-b>", "<PageUp>", "<S-Space>", "<scroll-up-page>"],
            "Scroll up a full page",
            function (args) { buffer.scrollVertical("pages", -Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["<Space>"],
            "Scroll down a full page",
            function (args) {
                if (isinstance((services.focus.focusedWindow || buffer.win).document.activeElement,
                               [Ci.nsIDOMHTMLInputElement,
                                Ci.nsIDOMHTMLButtonElement,
                                Ci.nsIDOMXULButtonElement]))
                    return Events.PASS;

                buffer.scrollVertical("pages", Math.max(args.count, 1));
            },
            { count: true });

        mappings.add([modes.NORMAL], ["<C-f>", "<PageDown>", "<scroll-down-page>"],
            "Scroll down a full page",
            function (args) { buffer.scrollVertical("pages", Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["]f", "<previous-frame>"],
            "Focus next frame",
            function (args) { buffer.shiftFrameFocus(Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["[f", "<next-frame>"],
            "Focus previous frame",
            function (args) { buffer.shiftFrameFocus(-Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["["],
            "Jump to the previous element as defined by 'jumptags'",
            function (args) { buffer.findJump(args.arg, args.count, true); },
            { arg: true, count: true });

        mappings.add([modes.NORMAL], ["g]"],
            "Jump to the next off-screen element as defined by 'jumptags'",
            function (args) { buffer.findJump(args.arg, args.count, false, true); },
            { arg: true, count: true });

        mappings.add([modes.NORMAL], ["]"],
            "Jump to the next element as defined by 'jumptags'",
            function (args) { buffer.findJump(args.arg, args.count, false); },
            { arg: true, count: true });

        mappings.add([modes.NORMAL], ["{"],
            "Jump to the previous paragraph",
            function (args) { buffer.findJump("p", args.count, true); },
            { count: true });

        mappings.add([modes.NORMAL], ["}"],
            "Jump to the next paragraph",
            function (args) { buffer.findJump("p", args.count, false); },
            { count: true });

        mappings.add([modes.NORMAL], ["]]", "<next-page>"],
            "Follow the link labeled 'next' or '>' if it exists",
            function (args) {
                buffer.findLink("next", options["nextpattern"], (args.count || 1) - 1, true);
            },
            { count: true });

        mappings.add([modes.NORMAL], ["[[", "<previous-page>"],
            "Follow the link labeled 'prev', 'previous' or '<' if it exists",
            function (args) {
                buffer.findLink("prev", options["previouspattern"], (args.count || 1) - 1, true);
            },
            { count: true });

        mappings.add([modes.NORMAL], ["gf", "<view-source>"],
            "Toggle between rendered and source view",
            function () { buffer.viewSource(null, false); });

        mappings.add([modes.NORMAL], ["gF", "<view-source-externally>"],
            "View source with an external editor",
            function () { buffer.viewSource(null, true); });

        mappings.add([modes.NORMAL], ["gi", "<focus-input>"],
            "Focus last used input field",
            function (args) {
                let elem = buffer.lastInputField;

                if (args.count >= 1 || !elem || !events.isContentNode(elem)) {
                    let xpath = ["frame", "iframe", "input", "xul:textbox", "textarea[not(@disabled) and not(@readonly)]"];

                    let frames = buffer.allFrames(null, true);

                    let elements = array.flatten(frames.map(function (win) [m for (m in DOM.XPath(xpath, win.document))]))
                                        .filter(function (elem) {
                        if (isinstance(elem, [Ci.nsIDOMHTMLFrameElement,
                                              Ci.nsIDOMHTMLIFrameElement]))
                            return Editor.getEditor(elem.contentWindow);

                        elem = DOM(elem);

                        if (elem[0].readOnly || !DOM(elem).isEditable)
                            return false;

                        let style = elem.style;
                        let rect = elem.rect;
                        return elem.isVisible &&
                            (elem[0] instanceof Ci.nsIDOMXULTextBoxElement || style.MozUserFocus != "ignore") &&
                            rect.width && rect.height;
                    });

                    dactyl.assert(elements.length > 0);
                    elem = elements[Math.constrain(args.count, 1, elements.length) - 1];
                }
                buffer.focusElement(elem);
                DOM(elem).scrollIntoView();
            },
            { count: true });

        function url() {
            let url = dactyl.clipboardRead();
            dactyl.assert(url, _("error.clipboardEmpty"));

            let proto = /^([-\w]+):/.exec(url);
            if (proto && services.PROTOCOL + proto[1] in Cc && !RegExp(options["urlseparator"]).test(url))
                return url.replace(/\s+/g, "");
            return url;
        }

        mappings.add([modes.NORMAL], ["gP"],
            "Open (put) a URL based on the current clipboard contents in a new background buffer",
            function () {
                dactyl.open(url(), { from: "paste", where: dactyl.NEW_TAB, background: true });
            });

        mappings.add([modes.NORMAL], ["p", "<MiddleMouse>", "<open-clipboard-url>"],
            "Open (put) a URL based on the current clipboard contents in the current buffer",
            function () {
                dactyl.open(url());
            });

        mappings.add([modes.NORMAL], ["P", "<tab-open-clipboard-url>"],
            "Open (put) a URL based on the current clipboard contents in a new buffer",
            function () {
                dactyl.open(url(), { from: "paste", where: dactyl.NEW_TAB });
            });

        // reloading
        mappings.add([modes.NORMAL], ["r", "<reload>"],
            "Reload the current web page",
            function () { tabs.reload(tabs.getTab(), false); });

        mappings.add([modes.NORMAL], ["R", "<full-reload>"],
            "Reload while skipping the cache",
            function () { tabs.reload(tabs.getTab(), true); });

        // yanking
        mappings.add([modes.NORMAL], ["Y", "<yank-selection>"],
            "Copy selected text or current word",
            function () {
                let sel = buffer.currentWord;
                dactyl.assert(sel);
                editor.setRegister(null, sel, true);
            });

        // zooming
        mappings.add([modes.NORMAL], ["zi", "+", "<text-zoom-in>"],
            "Enlarge text zoom of current web page",
            function (args) { buffer.zoomIn(Math.max(args.count, 1), false); },
            { count: true });

        mappings.add([modes.NORMAL], ["zm", "<text-zoom-more>"],
            "Enlarge text zoom of current web page by a larger amount",
            function (args) { buffer.zoomIn(Math.max(args.count, 1) * 3, false); },
            { count: true });

        mappings.add([modes.NORMAL], ["zo", "-", "<text-zoom-out>"],
            "Reduce text zoom of current web page",
            function (args) { buffer.zoomOut(Math.max(args.count, 1), false); },
            { count: true });

        mappings.add([modes.NORMAL], ["zr", "<text-zoom-reduce>"],
            "Reduce text zoom of current web page by a larger amount",
            function (args) { buffer.zoomOut(Math.max(args.count, 1) * 3, false); },
            { count: true });

        mappings.add([modes.NORMAL], ["zz", "<text-zoom>"],
            "Set text zoom value of current web page",
            function (args) { buffer.setZoom(args.count > 1 ? args.count : 100, false); },
            { count: true });

        mappings.add([modes.NORMAL], ["ZI", "zI", "<full-zoom-in>"],
            "Enlarge full zoom of current web page",
            function (args) { buffer.zoomIn(Math.max(args.count, 1), true); },
            { count: true });

        mappings.add([modes.NORMAL], ["ZM", "zM", "<full-zoom-more>"],
            "Enlarge full zoom of current web page by a larger amount",
            function (args) { buffer.zoomIn(Math.max(args.count, 1) * 3, true); },
            { count: true });

        mappings.add([modes.NORMAL], ["ZO", "zO", "<full-zoom-out>"],
            "Reduce full zoom of current web page",
            function (args) { buffer.zoomOut(Math.max(args.count, 1), true); },
            { count: true });

        mappings.add([modes.NORMAL], ["ZR", "zR", "<full-zoom-reduce>"],
            "Reduce full zoom of current web page by a larger amount",
            function (args) { buffer.zoomOut(Math.max(args.count, 1) * 3, true); },
            { count: true });

        mappings.add([modes.NORMAL], ["zZ", "<full-zoom>"],
            "Set full zoom value of current web page",
            function (args) { buffer.setZoom(args.count > 1 ? args.count : 100, true); },
            { count: true });

        // page info
        mappings.add([modes.NORMAL], ["<C-g>", "<page-info>"],
            "Print the current file name",
            function () { buffer.showPageInfo(false); });

        mappings.add([modes.NORMAL], ["g<C-g>", "<more-page-info>"],
            "Print file information",
            function () { buffer.showPageInfo(true); });
    },
    options: function initOptions(dactyl, modules, window) {
        let { Option, buffer, completion, config, options } = modules;

        options.add(["encoding", "enc"],
            "The current buffer's character encoding",
            "string", "UTF-8",
            {
                scope: Option.SCOPE_LOCAL,
                getter: function () buffer.docShell.QueryInterface(Ci.nsIDocCharset).charset,
                setter: function (val) {
                    if (options["encoding"] == val)
                        return val;

                    // Stolen from browser.jar/content/browser/browser.js, more or less.
                    try {
                        buffer.docShell.QueryInterface(Ci.nsIDocCharset).charset = val;
                        window.PlacesUtils.history.setCharsetForURI(buffer.uri, val);
                        buffer.docShell.reload(Ci.nsIWebNavigation.LOAD_FLAGS_CHARSET_CHANGE);
                    }
                    catch (e) { dactyl.reportError(e); }
                    return null;
                },
                completer: function (context) completion.charset(context)
            });

        options.add(["iskeyword", "isk"],
            "Regular expression defining which characters constitute words",
            "string", '[^\\s.,!?:;/"\'^$%&?()[\\]{}<>#*+|=~_-]',
            {
                setter: function (value) {
                    this.regexp = util.regexp(value);
                    return value;
                },
                validator: function (value) RegExp(value)
            });

        options.add(["jumptags", "jt"],
            "XPath or CSS selector strings of jumpable elements for extended hint modes",
            "stringmap", {
                "p": "p,table,ul,ol,blockquote",
                "h": "h1,h2,h3,h4,h5,h6"
            },
            {
                keepQuotes: true,
                setter: function (vals) {
                    for (let [k, v] in Iterator(vals))
                        vals[k] = update(new String(v), { matcher: DOM.compileMatcher(Option.splitList(v)) });
                    return vals;
                },
                validator: function (value) DOM.validateMatcher.call(this, value)
                    && Object.keys(value).every(function (v) v.length == 1)
            });

        options.add(["linenumbers", "ln"],
            "Patterns used to determine line numbers used by G",
            "sitemap", {
                // Make sure to update the docs when you change this.
                "view-source:*": 'body,[id^=line]',
                "code.google.com": '#nums [id^="nums_table"] a[href^="#"]',
                "github.com": '.line_numbers>*',
                "mxr.mozilla.org": 'a.l',
                "pastebin.com": '#code_frame>div>ol>li',
                "addons.mozilla.org": '.gutter>.line>a',
                "bugzilla.mozilla.org": ".bz_comment:not(.bz_first_comment):not(.ih_history)",
                "*": '/* Hgweb/Gitweb */ .completecodeline a.codeline, a.linenr'
            },
            {
                getLine: function getLine(doc, line) {
                    let uri = util.newURI(doc.documentURI);
                    for (let filter in values(this.value))
                        if (filter(uri, doc)) {
                            if (/^func:/.test(filter.result))
                                var res = dactyl.userEval("(" + Option.dequote(filter.result.substr(5)) + ")")(doc, line);
                            else
                                res = iter.nth(filter.matcher(doc),
                                               function (elem) (elem.nodeValue || elem.textContent).trim() == line && DOM(elem).display != "none",
                                               0)
                                   || iter.nth(filter.matcher(doc), util.identity, line - 1);
                            if (res)
                                break;
                        }

                    return res;
                },

                keepQuotes: true,

                setter: function (vals) {
                    for (let value in values(vals))
                        if (!/^func:/.test(value.result))
                            value.matcher = DOM.compileMatcher(Option.splitList(value.result));
                    return vals;
                },

                validator: function validate(values) {
                    return this.testValues(values, function (value) {
                        if (/^func:/.test(value))
                            return callable(dactyl.userEval("(" + Option.dequote(value.substr(5)) + ")"));
                        else
                            return DOM.testMatcher(Option.dequote(value));
                    });
                }
            });

        options.add(["nextpattern"],
            "Patterns to use when guessing the next page in a document sequence",
            "regexplist", UTF8(/'^Next [>»]','^Next »','\bnext\b',^>$,^(>>|»)$,^(>|»),(>|»)$,'\bmore\b'/.source),
            { regexpFlags: "i" });

        options.add(["previouspattern"],
            "Patterns to use when guessing the previous page in a document sequence",
            "regexplist", UTF8(/'[<«] Prev$','« Prev$','\bprev(ious)?\b',^<$,^(<<|«)$,^(<|«),(<|«)$/.source),
            { regexpFlags: "i" });

        options.add(["pageinfo", "pa"],
            "Define which sections are shown by the :pageinfo command",
            "charlist", "gesfm",
            { get values() values(Buffer.pageInfo).toObject() });

        options.add(["scroll", "scr"],
            "Number of lines to scroll with <C-u> and <C-d> commands",
            "number", 0,
            { validator: function (value) value >= 0 });

        options.add(["showstatuslinks", "ssli"],
            "Where to show the destination of the link under the cursor",
            "string", "status",
            {
                values: {
                    "": "Don't show link destinations",
                    "status": "Show link destinations in the status line",
                    "command": "Show link destinations in the command line"
                }
            });

        options.add(["scrolltime", "sct"],
            "The time, in milliseconds, in which to smooth scroll to a new position",
            "number", 100);

        options.add(["scrollsteps", "scs"],
            "The number of steps in which to smooth scroll to a new position",
            "number", 5,
            {
                PREF: "general.smoothScroll",

                initValue: function () {},

                getter: function getter(value) !prefs.get(this.PREF) ? 1 : value,

                setter: function setter(value) {
                    prefs.set(this.PREF, value > 1);
                    if (value > 1)
                        return value;
                },

                validator: function (value) value > 0
            });

        options.add(["usermode", "um"],
            "Show current website without styling defined by the author",
            "boolean", false,
            {
                setter: function (value) buffer.contentViewer.authorStyleDisabled = value,
                getter: function () buffer.contentViewer.authorStyleDisabled
            });

        options.add(["yankshort", "ys"],
            "Yank the canonical short URL of a web page where provided",
            "sitelist", ["youtube.com", "bugzilla.mozilla.org"]);
    }
});

Buffer.addPageInfoSection("e", "Search Engines", function (verbose) {
    let n = 1;
    let nEngines = 0;

    for (let { document: doc } in values(this.allFrames())) {
        let engines = DOM("link[href][rel=search][type='application/opensearchdescription+xml']", doc);
        nEngines += engines.length;

        if (verbose)
            for (let link in engines)
                yield [link.title || /*L*/ "Engine " + n++,
                       ["a", { href: link.href, highlight: "URL",
                               onclick: "if (event.button == 0) { window.external.AddSearchProvider(this.href); return false; }" },
                            link.href]];
    }

    if (!verbose && nEngines)
        yield nEngines + /*L*/" engine" + (nEngines > 1 ? "s" : "");
});

Buffer.addPageInfoSection("f", "Feeds", function (verbose) {
    const feedTypes = {
        "application/rss+xml": "RSS",
        "application/atom+xml": "Atom",
        "text/xml": "XML",
        "application/xml": "XML",
        "application/rdf+xml": "XML"
    };

    function isValidFeed(data, principal, isFeed) {
        if (!data || !principal)
            return false;

        if (!isFeed) {
            var type = data.type && data.type.toLowerCase();
            type = type.replace(/^\s+|\s*(?:;.*)?$/g, "");

            isFeed = ["application/rss+xml", "application/atom+xml"].indexOf(type) >= 0 ||
                     // really slimy: general XML types with magic letters in the title
                     type in feedTypes && /\brss\b/i.test(data.title);
        }

        if (isFeed) {
            try {
                services.security.checkLoadURIStrWithPrincipal(principal, data.href,
                        services.security.DISALLOW_INHERIT_PRINCIPAL);
            }
            catch (e) {
                isFeed = false;
            }
        }

        if (type)
            data.type = type;

        return isFeed;
    }

    let nFeed = 0;
    for (let [i, win] in Iterator(this.allFrames())) {
        let doc = win.document;

        for (let link in DOM("link[href][rel=feed], link[href][rel=alternate][type]", doc)) {
            let rel = link.rel.toLowerCase();
            let feed = { title: link.title, href: link.href, type: link.type || "" };
            if (isValidFeed(feed, doc.nodePrincipal, rel == "feed")) {
                nFeed++;
                let type = feedTypes[feed.type] || "RSS";
                if (verbose)
                    yield [feed.title, [template.highlightURL(feed.href, true),
                                        ["span", { class: "extra-info" }, " (" + type + ")"]]];
            }
        }

    }

    if (!verbose && nFeed)
        yield nFeed + /*L*/" feed" + (nFeed > 1 ? "s" : "");
});

Buffer.addPageInfoSection("g", "General Info", function (verbose) {
    let doc = this.focusedFrame.document;

    // get file size
    const ACCESS_READ = Ci.nsICache.ACCESS_READ;
    let cacheKey = doc.documentURI;

    for (let proto in array.iterValues(["HTTP", "FTP"])) {
        try {
            var cacheEntryDescriptor = services.cache.createSession(proto, 0, true)
                                               .openCacheEntry(cacheKey, ACCESS_READ, false);
            break;
        }
        catch (e) {}
    }

    let pageSize = []; // [0] bytes; [1] kbytes
    if (cacheEntryDescriptor) {
        pageSize[0] = util.formatBytes(cacheEntryDescriptor.dataSize, 0, false);
        pageSize[1] = util.formatBytes(cacheEntryDescriptor.dataSize, 2, true);
        if (pageSize[1] == pageSize[0])
            pageSize.length = 1; // don't output "xx Bytes" twice
    }

    let lastModVerbose = new Date(doc.lastModified).toLocaleString();
    let lastMod = new Date(doc.lastModified).toLocaleFormat("%x %X");

    if (lastModVerbose == "Invalid Date" || new Date(doc.lastModified).getFullYear() == 1970)
        lastModVerbose = lastMod = null;

    if (!verbose) {
        if (pageSize[0])
            yield (pageSize[1] || pageSize[0]) + /*L*/" bytes";
        yield lastMod;
        return;
    }

    yield ["Title", doc.title];
    yield ["URL", template.highlightURL(doc.location.href, true)];

    let ref = "referrer" in doc && doc.referrer;
    if (ref)
        yield ["Referrer", template.highlightURL(ref, true)];

    if (pageSize[0])
        yield ["File Size", pageSize[1] ? pageSize[1] + " (" + pageSize[0] + ")"
                                        : pageSize[0]];

    yield ["Mime-Type", doc.contentType];
    yield ["Encoding", doc.characterSet];
    yield ["Compatibility", doc.compatMode == "BackCompat" ? "Quirks Mode" : "Full/Almost Standards Mode"];
    if (lastModVerbose)
        yield ["Last Modified", lastModVerbose];
});

Buffer.addPageInfoSection("m", "Meta Tags", function (verbose) {
    if (!verbose)
        return [];

    // get meta tag data, sort and put into pageMeta[]
    let metaNodes = this.focusedFrame.document.getElementsByTagName("meta");

    return Array.map(metaNodes, function (node) [(node.name || node.httpEquiv),
                                                 template.highlightURL(node.content)])
                .sort(function (a, b) util.compareIgnoreCase(a[0], b[0]));
});

Buffer.addPageInfoSection("s", "Security", function (verbose) {
    let { statusline } = this.modules

    let identity = this.topWindow.gIdentityHandler;

    if (!verbose || !identity)
        return; // For now

    // Modified from Firefox
    function location(data) array.compact([
        data.city, data.state, data.country
    ]).join(", ");

    switch (statusline.security) {
    case "secure":
    case "extended":
        var data = identity.getIdentityData();

        yield ["Host", identity.getEffectiveHost()];

        if (statusline.security === "extended")
            yield ["Owner", data.subjectOrg];
        else
            yield ["Owner", _("pageinfo.s.ownerUnverified", data.subjectOrg)];

        if (location(data).length)
            yield ["Location", location(data)];

        yield ["Verified by", data.caOrg];

        if (identity._overrideService.hasMatchingOverride(identity._lastLocation.hostname,
                                                      (identity._lastLocation.port || 443),
                                                      data.cert, {}, {}))
            yield ["User exception", /*L*/"true"];
        break;
    }
});

// catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

endModule();

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
