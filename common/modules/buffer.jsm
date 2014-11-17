// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("buffer", {
    exports: ["Buffer", "buffer"],
    require: ["prefs", "services", "util"]
});

lazyRequire("bookmarkcache", ["bookmarkcache"]);
lazyRequire("contexts", ["Group"]);
lazyRequire("io", ["io"]);
lazyRequire("finder", ["RangeFind"]);
lazyRequire("overlay", ["overlay"]);
lazyRequire("promises", ["Promise", "promises"]);
lazyRequire("sanitizer", ["sanitizer"]);
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
                return window.content;
            if (win.top == window)
                return win;
            return win.top;
        }
    }),

    init: function init(win) {
        if (win)
            this.win = win;
    },

    get addPageInfoSection() Buffer.bound.addPageInfoSection,

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
            this.allFrames().map(w => Array.slice(w.document.styleSheets)));

        return stylesheets.filter(
            s => /^(screen|all|)$/i.test(s.media.mediaText) && !/^\s*$/.test(s.title)
        );
    },

    /**
     * The load context of the window bound to this buffer.
     */
    get loadContext() sanitizer.getContext(this.win),

    /**
     * Content preference methods.
     */
    prefs: Class.Memoize(function ()
        let (self = this) ({
            /**
             * Returns a promise for the given preference name.
             *
             * @param {string} pref The name of the preference to return.
             * @returns {Promise<*>}
             */
            get: promises.withCallbacks(function get([resolve, reject], pref) {
                let val = services.contentPrefs.getCachedByDomainAndName(
                    self.uri.spec, pref, self.loadContext);

                let found = false;
                if (val)
                    resolve(val.value);
                else
                    services.contentPrefs.getByDomainAndName(
                        self.uri.spec, pref, self.loadContext,
                        { handleCompletion: () => {
                              if (!found)
                                  resolve(undefined);
                          },
                          handleResult: (pref) => {
                              found = true;
                              resolve(pref.value);
                          },
                          handleError: reject });
            }),

            /**
             * Sets a content preference for the given buffer.
             *
             * @param {string} pref The preference to set.
             * @param {string} value The value to store.
             */
            set: promises.withCallbacks(function set([resolve, reject], pref, value) {
                services.contentPrefs.set(
                    self.uri.spec, pref, value, self.loadContext,
                    { handleCompletion: () => {},
                      handleResult: resolve,
                      handleError: reject });
            }),

            /**
             * Clear a content preference for the given buffer.
             *
             * @param {string} pref The preference to clear.
             */
            clear: promises.withCallbacks(function clear([resolve, reject], pref) {
                services.contentPrefs.removeByDomainAndName(
                    self.uri.spec, pref, self.loadContext,
                    { handleCompletion: () => {},
                      handleResult: resolve,
                      handleError: reject });
            })
        })),

    /**
     * Gets a content preference for the given buffer.
     *
     * @param {string} pref The preference to get.
     * @param {function(string|number|boolean)} callback The callback to
     *      call with the preference value. @optional
     * @returns {string|number|boolean} The value of the preference, if
     *      callback is not provided.
     */
    getPref: deprecated("prefs.get", function getPref(pref, callback) {
        services.contentPrefs.getPref(this.uri, pref,
                                      this.loadContext, callback);
    }),

    /**
     * Sets a content preference for the given buffer.
     *
     * @param {string} pref The preference to set.
     * @param {string} value The value to store.
     */
    setPref: deprecated("prefs.set", function setPref(pref, value) {
        services.contentPrefs.setPref(
            this.uri, pref, value, this.loadContext);
    }),

    /**
     * Clear a content preference for the given buffer.
     *
     * @param {string} pref The preference to clear.
     */
    clearPref: deprecated("prefs.clear", function clearPref(pref) {
        services.contentPrefs.removePref(
            this.uri, pref, this.loadContext);
    }),

    climbUrlPath: function climbUrlPath(count) {
        let { dactyl } = this.modules;

        let url = this.uri.clone();
        dactyl.assert(url instanceof Ci.nsIURL);

        while (count-- && url.path != "/")
            url.path = url.path.replace(/[^\/]*\/*$/, "");

        dactyl.assert(!url.equals(this.uri));
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
            .map(frame => ["loading", "interactive", "complete"]
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
     * @property {nsIURI} The current top-level document's URI, sans
     *  fragment ID.
     */
    get pageURI() {
        let uri = this.uri;
        if (!uri.ref.startsWith("!"))
            uri.ref = "";
        return uri;
    },

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
                                     .QueryInterface(Ci.nsIMarkupDocumentViewer || Ci.nsIContentViewer),

    /**
     * @property {number} The current browser's zoom level, as a
     *     percentage with 100 as 'normal'.
     */
    get zoomLevel() {
        let v = this.contentViewer;
        return v[v.textZoom == 1 ? "fullZoom" : "textZoom"] * 100;
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
            return frames.filter(f => f === this.focusedFrame).concat(
                   frames.filter(f => f !== this.focusedFrame));
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

        let relRev = ["next", "prev"];
        let rev = relRev[1 - relRev.indexOf(rel)];

        function followFrame(frame) {
            function iter(elems) {
                for (let i = 0; i < elems.length; i++)
                    if (elems[i].rel.toLowerCase() === rel || elems[i].rev.toLowerCase() === rev)
                        yield elems[i];
            }

            let elems = frame.document.getElementsByTagName("link");
            for (let elem in iter(elems))
                yield elem;

            function a(regexp, elem) regexp.test(elem.textContent) === regexp.result ||
                            Array.some(elem.childNodes,
                                       child => (regexp.test(child.alt) === regexp.result));

            function b(regexp, elem) regexp.test(elem.title) === regexp.result;

            let res = Array.filter(frame.document.querySelectorAll(selector),
                                   Hints.isVisible);

            for (let test of [a, b])
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
            return Array.filter(nodes, n => n instanceof Ci.nsIDOMText)
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

        var reduce = (a, b) => DOM(a).rect.top < DOM(b).rect.top ? a : b;
        var dir = "forward";
        var y = 0;
        if (reverse) {
            reduce = (a, b) => DOM(b).rect.bottom > DOM(a).rect.bottom ? b : a;
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
     * @property {string|null} The canonical short URL for the current
     *      document.
     */
    get shortURL() {
        let { uri, doc } = this;

        function hashify(url) {
            let newURI = util.newURI(url);

            if (uri.hasRef && !newURI.hasRef)
                newURI.ref = uri.ref;

            return newURI.spec;
        }

        for (let shortener of Buffer.uriShorteners)
            try {
                let shortened = shortener(uri, doc);
                if (shortened)
                    return hashify(shortened.spec);
            }
            catch (e) {
                util.reportError(e);
            }

        let sane = link => {
            let a = [link.href, this.pageURI.spec];
            let b = overlay.getData(link, "link-check");
            return !b
                || a[0] == b[0] && a[1] == b[1]
                || a[0] != b[0] && a[1] != b[1];
        }

        let link = DOM("link[href][rev=canonical], \
                        link[href][rel=shortlink]", doc)
                       .filter(sane)
                       .attr("href");
        if (link)
            return hashify(link);

        return null;
    },

    locationChanged: function locationChanged() {
        // Store current URL to detect tomfoolery. Might go awry if
        // links get updated before `history.pushState`, but better safe
        // than whatever.

        DOM("link[href][rev=canonical], \
             link[href][rel=shortlink]", this.doc)
            .each(elem => {
                overlay.getData(elem, "link-check",
                                () => [elem.href, this.pageURI.spec])
            });
    },

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
                            file.create(File.NORMAL_FILE_TYPE, 0o644);
                    }
                    catch (e) {
                        util.assert(false, _("save.invalidDestination", e.name));
                    }

                    self.saveURI({ uri: uri, file: file, context: elem });
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
    saveURI: function saveURI(params) {
        if (params instanceof Ci.nsIURI)
            // Deprecated?
            params = { uri: arguments[0], file: arguments[1],
                       callback: arguments[2], self: arguments[3] };

        var persist = services.Persist();
        persist.persistFlags = persist.PERSIST_FLAGS_FROM_CACHE
                             | persist.PERSIST_FLAGS_REPLACE_EXISTING_FILES;

        let window = this.topWindow;
        let privacy = sanitizer.getContext(params.context || this.win);
        let file = File(params.file);
        if (!file.exists())
            file.create(Ci.nsIFile.NORMAL_FILE_TYPE, 0o666);

        let downloadListener = new window.DownloadListener(window,
                services.Transfer(params.uri, file.URI, "", null, null, null,
                                  persist, privacy && privacy.usePrivateBrowsing));

        var { callback, self } = params;
        if (callback)
            persist.progressListener = update(Object.create(downloadListener), {
                onStateChange: util.wrapCallback(function onStateChange(progress, request, flags, status) {
                    if (callback && (flags & Ci.nsIWebProgressListener.STATE_STOP) && status == 0)
                        util.trapErrors(callback, self, params.uri, file.file,
                                        progress, request, flags, status);

                    return onStateChange.superapply(this, arguments);
                })
            });
        else
            persist.progressListener = downloadListener;

        persist.saveURI(params.uri, null, null, null, null,
                        file.file, privacy);
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
    scrollToPercent: function scrollToPercent(horizontal, vertical, dir)
        Buffer.scrollToPercent(this.findScrollable(dir || 0, vertical == null), horizontal, vertical),

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
    scrollByScrollSize: function scrollByScrollSize(direction, count=1) {
        let { options } = this.modules;

        direction = direction ? 1 : -1;

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

        if (!elem) {
            let area = -1;
            for (let e in DOM(Buffer.SCROLLABLE_SEARCH_SELECTOR,
                              this.focusedFrame.document)) {
                if (Buffer.isScrollable(e, dir, horizontal)) {
                    let r = DOM(e).rect;
                    let a = r.width * r.height;
                    if (a > area) {
                        area = a;
                        elem = e;
                    }
                }
            }
            if (elem)
                util.trapErrors("focus", elem);
        }
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

        win = this.focusedFrame;
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

        let distance = reverse ? rect => -rect.top
                               : rect => rect.top;

        let elems = [[e, distance(e.getBoundingClientRect())]
                     for (e in path.matcher(this.focusedFrame.document))]
                        .filter(e => e[1] > FUDGE)
                        .sort((a, b) => a[1] - b[1]);

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
        frames = frames.filter(frame => !(frame.document.body instanceof Ci.nsIDOMHTMLFrameSetElement))
                       .filter(frame => !frame.frameElement ||
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

        // Ctrl-g single line output
        if (!verbose) {
            let file = this.win.location.pathname.split("/").pop() || _("buffer.noName");
            let title = this.win.document.title || _("buffer.noTitle");

            let info = template.map(
                (sections || options["pageinfo"])
                    .map((opt) => Buffer.pageInfo[opt].action.call(this)),
                res => (res && iter(res).join(", ") || undefined),
                ", ").join("");

            if (bookmarkcache.isBookmarked(this.URL))
                info += ", " + _("buffer.bookmarked");

            let pageInfoText = [file.quote(), " [", info, "] ", title].join("");
            dactyl.echo(pageInfoText, commandline.FORCE_SINGLELINE);
            return;
        }

        let list = template.map(sections || options["pageinfo"], (option) => {
            let { action, title } = Buffer.pageInfo[option];
            return template.table(title, action.call(this, true));
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
                if (url.startsWith(PREFIX))
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

            if (isString(doc)) {
                var privacyContext = null;
                var uri = util.newURI(doc);
            }
            else {
                privacyContext = sanitizer.getContext(doc);
                uri = util.newURI(doc.location.href);
            }

            let ext = uri.fileExtension || "txt";
            if (doc.contentType)
                try {
                    ext = services.mime.getPrimaryExtension(doc.contentType, ext);
                }
                catch (e) {}

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
                persist.saveURI(uri, null, null, null, null, this.file,
                                privacyContext);
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
        let { dactyl, statusline, storage } = this.modules;
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

        if (prefs.get("browser.zoom.siteSpecific")) {
            var privacy = sanitizer.getContext(this.win);
            if (value == 1) {
                this.prefs.clear("browser.content.full-zoom");
                this.prefs.clear("dactyl.content.full-zoom");
            }
            else {
                this.prefs.set("browser.content.full-zoom", value);
                this.prefs.set("dactyl.content.full-zoom", fullZoom);
            }
        }

        statusline.updateZoomLevel();
    },

    /**
     * Updates the zoom level of this buffer from a content preference.
     */
    updateZoom: promises.task(function updateZoom() {
        let uri = this.uri;

        if (prefs.get("browser.zoom.siteSpecific")) {
            let val = yield this.prefs.get("dactyl.content.full-zoom");

            if (val != null && uri.equals(this.uri) && val != prefs.get("browser.zoom.full"))
                [this.contentViewer.textZoom, this.contentViewer.fullZoom] =
                    [this.contentViewer.fullZoom, this.contentViewer.textZoom];
        }
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
    /**
     * The pattern used to search for a scrollable element when we have
     * no starting point.
     */
    SCROLLABLE_SEARCH_SELECTOR: "html, body, div",

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

    uriShorteners: [],

    /**
     * Adds a new URI shortener for documents matching the given filter.
     *
     * @param {string|function(URI, Document):boolean} filter A site filter
     *      string or a function which accepts a URI and a document and
     *      returns true if it can shorten the document's URI.
     * @param {function(URI, Document):URI} shortener Returns a shortened
     *      URL for the given URI and document.
     */
    addURIShortener: function addURIShortener(filter, shortener) {
        if (isString(filter))
            filter = Group.compileFilter(filter);

        this.uriShorteners.push(function uriShortener(uri, doc) {
            if (filter(uri, doc))
                return shortener(uri, doc);
        });
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

                get scrollLeftMax() this.win.scrollMaxX,
                get scrollRightMax() this.win.scrollMaxY,

                get scrollLeft() this.win.scrollX,
                set scrollLeft(val) { this.win.scrollTo(val, this.win.scrollY); },

                get scrollTop() this.win.scrollY,
                set scrollTop(val) { this.win.scrollTo(this.win.scrollX, val); }
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

        return names.filter(([leaf, title]) => leaf)
                    .map(([leaf, title]) => [leaf.replace(config.OS.illegalCharacters, encodeURIComponent)
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
        let pos = "scrollTop", size = "clientHeight", end = "scrollHeight", layoutSize = "offsetHeight",
            overflow = "overflowX", border1 = "borderTopWidth", border2 = "borderBottomWidth";
        if (horizontal)
            pos = "scrollLeft", size = "clientWidth", end = "scrollWidth", layoutSize = "offsetWidth",
            overflow = "overflowX", border1 = "borderLeftWidth", border2 = "borderRightWidth";

        if (dir < 0)
            return elem[pos] > 0;

        let max = pos + "Max";
        if (max in elem) {
            if (elem[pos] < elem[max])
                return true;
            if (dir > 0)
                return false;
            return elem[pos] > 0;
        }

        let style = DOM(elem).style;
        let borderSize = Math.round(parseFloat(style[border1]) + parseFloat(style[border2]));
        let realSize = elem[size];

        // Stupid Gecko eccentricities. May fail for quirks mode documents.
        if (elem[size] + borderSize >= elem[end] || elem[size] == 0) // Stupid, fallible heuristic.
            return false;

        if (style[overflow] == "hidden")
            realSize += borderSize;
        return dir > 0 && elem[pos] + realSize < elem[end] || !dir && realSize < elem[end];
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
    smoothScrollTo: let (timers = WeakMap())
                    function smoothScrollTo(node, x, y) {
        let { options } = overlay.activeModules;

        let time = options["scrolltime"];
        let steps = options["scrollsteps"];

        let elem = Buffer.Scrollable(node);

        if (timers.has(node))
            timers.get(node).cancel();

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
                timers.set(node, util.timeout(next, time / steps));
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
     * @param {Node} node The node to scroll.
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
        };
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
                dactyl.assert(!arg || arg[0] == ">",
                              _("error.trailingCharacters"));

                let settings = services.printSettings.newPrintSettings;
                settings.printSilent = args.bang;
                if (arg) {
                    settings.printToFile = true;
                    settings.toFileName = io.File(arg.substr(1)).path;
                    settings.outputFormat = settings.kOutputFormatPDF;

                    dactyl.echomsg(_("print.toFile", arg.substr(1)));
                }
                else {
                    dactyl.echomsg(_("print.sending"));
                }

                config.browser.contentWindow
                      .QueryInterface(Ci.nsIInterfaceRequestor)
                      .getInterface(Ci.nsIWebBrowserPrint).print(settings, null);

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

                let titles = buffer.alternateStyleSheets.map(sheet => sheet.title);

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

                    chosenData = { file: file.file, uri: util.newURI(doc.location.href) };
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
                                    doc, true);
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

        events.listen(config.browser, "scroll", buffer.bound._updateBufferPosition, false);
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

                let url = options.get("yankshort").getKey(uri) && buffer.shortURL || uri.spec;
                dactyl.clipboardWrite(url, true);
            });

        mappings.add([modes.NORMAL],
            ["<C-a>", "<increment-url-path>"], "Increment last number in URL",
            function ({ count }) { buffer.incrementURL(Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL],
            ["<C-x>", "<decrement-url-path>"], "Decrement last number in URL",
            function ({ count }) { buffer.incrementURL(-Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["gu", "<open-parent-path>"],
            "Go to parent directory",
            function ({ count }) { buffer.climbUrlPath(Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["gU", "<open-root-path>"],
            "Go to the root of the website",
            function () { buffer.climbUrlPath(-1); });

        mappings.add([modes.COMMAND], [".", "<repeat-key>"],
            "Repeat the last key event",
            function ({ count }) {
                if (mappings.repeat) {
                    for (let i in util.interruptibleRange(0, Math.max(count, 1), 100))
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
            function ({ count }) { buffer.scrollVertical("lines", Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["k", "<Up>", "<C-y>", "<scroll-up-line>"],
            "Scroll document up",
            function ({ count }) { buffer.scrollVertical("lines", -Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], dactyl.has("mail") ? ["h", "<scroll-left-column>"] : ["h", "<Left>", "<scroll-left-column>"],
            "Scroll document to the left",
            function ({ count }) { buffer.scrollHorizontal("columns", -Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], dactyl.has("mail") ? ["l", "<scroll-right-column>"] : ["l", "<Right>", "<scroll-right-column>"],
            "Scroll document to the right",
            function ({ count }) { buffer.scrollHorizontal("columns", Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["0", "^", "<scroll-begin>"],
            "Scroll to the absolute left of the document",
            function () { buffer.scrollToPercent(0, null); });

        mappings.add([modes.NORMAL], ["$", "<scroll-end>"],
            "Scroll to the absolute right of the document",
            function () { buffer.scrollToPercent(100, null); });

        mappings.add([modes.NORMAL], ["gg", "<Home>", "<scroll-top>"],
            "Go to the top of the document",
            function ({ count }) { buffer.scrollToPercent(null, count != null ? count : 0,
                                                     count != null ? 0 : -1); },
            { count: true });

        mappings.add([modes.NORMAL], ["G", "<End>", "<scroll-bottom>"],
            "Go to the end of the document",
            function ({ count }) {
                if (count)
                    var elem = options.get("linenumbers")
                                      .getLine(buffer.focusedFrame.document,
                                               count);
                if (elem)
                    elem.scrollIntoView(true);
                else if (count)
                    buffer.scrollToPosition(null, count);
                else
                    buffer.scrollToPercent(null, 100, 1);
            },
            { count: true });

        mappings.add([modes.NORMAL], ["%", "<scroll-percent>"],
            "Scroll to {count} percent of the document",
            function ({ count }) {
                dactyl.assert(count > 0 && count <= 100);
                buffer.scrollToPercent(null, count);
            },
            { count: true });

        mappings.add([modes.NORMAL], ["<C-d>", "<scroll-down>"],
            "Scroll window downwards in the buffer",
            function ({ count }) { buffer._scrollByScrollSize(count, true); },
            { count: true });

        mappings.add([modes.NORMAL], ["<C-u>", "<scroll-up>"],
            "Scroll window upwards in the buffer",
            function ({ count }) { buffer._scrollByScrollSize(count, false); },
            { count: true });

        mappings.add([modes.NORMAL], ["<C-b>", "<PageUp>", "<S-Space>", "<scroll-up-page>"],
            "Scroll up a full page",
            function ({ count }) { buffer.scrollVertical("pages", -Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["<Space>"],
            "Scroll down a full page",
            function ({ count }) {
                if (isinstance((services.focus.focusedWindow || buffer.win).document.activeElement,
                               [Ci.nsIDOMHTMLInputElement,
                                Ci.nsIDOMHTMLButtonElement,
                                Ci.nsIDOMXULButtonElement]))
                    return Events.PASS;

                buffer.scrollVertical("pages", Math.max(count, 1));
            },
            { count: true });

        mappings.add([modes.NORMAL], ["<C-f>", "<PageDown>", "<scroll-down-page>"],
            "Scroll down a full page",
            function ({ count }) { buffer.scrollVertical("pages", Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["]f", "<previous-frame>"],
            "Focus next frame",
            function ({ count }) { buffer.shiftFrameFocus(Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["[f", "<next-frame>"],
            "Focus previous frame",
            function ({ count }) { buffer.shiftFrameFocus(-Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["["],
            "Jump to the previous element as defined by 'jumptags'",
            function ({ arg, count }) { buffer.findJump(arg, count, true); },
            { arg: true, count: true });

        mappings.add([modes.NORMAL], ["g]"],
            "Jump to the next off-screen element as defined by 'jumptags'",
            function ({ arg, count }) { buffer.findJump(arg, count, false, true); },
            { arg: true, count: true });

        mappings.add([modes.NORMAL], ["]"],
            "Jump to the next element as defined by 'jumptags'",
            function ({ arg, count }) { buffer.findJump(arg, count, false); },
            { arg: true, count: true });

        mappings.add([modes.NORMAL], ["{"],
            "Jump to the previous paragraph",
            function ({ count }) { buffer.findJump("p", count, true); },
            { count: true });

        mappings.add([modes.NORMAL], ["}"],
            "Jump to the next paragraph",
            function ({ count }) { buffer.findJump("p", count, false); },
            { count: true });

        mappings.add([modes.NORMAL], ["]]", "<next-page>"],
            "Follow the link labeled 'next' or '>' if it exists",
            function ({ count }) {
                buffer.findLink("next", options["nextpattern"], (count || 1) - 1, true);
            },
            { count: true });

        mappings.add([modes.NORMAL], ["[[", "<previous-page>"],
            "Follow the link labeled 'prev', 'previous' or '<' if it exists",
            function ({ count }) {
                buffer.findLink("prev", options["previouspattern"], (count || 1) - 1, true);
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
            function ({ count }) {
                let elem = buffer.lastInputField;

                if (count >= 1 || !elem || !events.isContentNode(elem)) {
                    let xpath = ["frame", "iframe", "input", "xul:textbox", "textarea[not(@disabled) and not(@readonly)]"];

                    let frames = buffer.allFrames(null, true);

                    let elements = array.flatten(frames.map(win => [m for (m in DOM.XPath(xpath, win.document))]))
                                        .filter(function (elem) {
                        if (isinstance(elem, [Ci.nsIDOMHTMLFrameElement,
                                              Ci.nsIDOMHTMLIFrameElement]))
                            return Editor.getEditor(elem.contentWindow);

                        elem = DOM(elem);

                        if (elem[0].readOnly || elem[0].disabled || !DOM(elem).isEditable)
                            return false;

                        let style = elem.style;
                        let rect = elem.rect;
                        return elem.isVisible &&
                            (elem[0] instanceof Ci.nsIDOMXULTextBoxElement || style.MozUserFocus != "ignore") &&
                            rect.width && rect.height;
                    });

                    dactyl.assert(elements.length > 0);
                    elem = elements[Math.constrain(count, 1, elements.length) - 1];
                }
                buffer.focusElement(elem);
                DOM(elem).scrollIntoView();
            },
            { count: true });

        function url() {
            let url = dactyl.clipboardRead();
            dactyl.assert(url, _("error.clipboardEmpty"));

            let proto = /^\s*([-\w]+):/.exec(url);
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
            function ({ count }) { buffer.zoomIn(Math.max(count, 1), false); },
            { count: true });

        mappings.add([modes.NORMAL], ["zm", "<text-zoom-more>"],
            "Enlarge text zoom of current web page by a larger amount",
            function ({ count }) { buffer.zoomIn(Math.max(count, 1) * 3, false); },
            { count: true });

        mappings.add([modes.NORMAL], ["zo", "-", "<text-zoom-out>"],
            "Reduce text zoom of current web page",
            function ({ count }) { buffer.zoomOut(Math.max(count, 1), false); },
            { count: true });

        mappings.add([modes.NORMAL], ["zr", "<text-zoom-reduce>"],
            "Reduce text zoom of current web page by a larger amount",
            function ({ count }) { buffer.zoomOut(Math.max(count, 1) * 3, false); },
            { count: true });

        mappings.add([modes.NORMAL], ["zz", "<text-zoom>"],
            "Set text zoom value of current web page",
            function ({ count }) { buffer.setZoom(count > 1 ? count : 100, false); },
            { count: true });

        mappings.add([modes.NORMAL], ["ZI", "zI", "<full-zoom-in>"],
            "Enlarge full zoom of current web page",
            function ({ count }) { buffer.zoomIn(Math.max(count, 1), true); },
            { count: true });

        mappings.add([modes.NORMAL], ["ZM", "zM", "<full-zoom-more>"],
            "Enlarge full zoom of current web page by a larger amount",
            function ({ count }) { buffer.zoomIn(Math.max(count, 1) * 3, true); },
            { count: true });

        mappings.add([modes.NORMAL], ["ZO", "zO", "<full-zoom-out>"],
            "Reduce full zoom of current web page",
            function ({ count }) { buffer.zoomOut(Math.max(count, 1), true); },
            { count: true });

        mappings.add([modes.NORMAL], ["ZR", "zR", "<full-zoom-reduce>"],
            "Reduce full zoom of current web page by a larger amount",
            function ({ count }) { buffer.zoomOut(Math.max(count, 1) * 3, true); },
            { count: true });

        mappings.add([modes.NORMAL], ["zZ", "<full-zoom>"],
            "Set full zoom value of current web page",
            function ({ count }) { buffer.setZoom(count > 1 ? count : 100, true); },
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
                    Task.spawn(function () {
                        try {
                            buffer.docShell.QueryInterface(Ci.nsIDocCharset).charset = val;
                            yield window.PlacesUtils.setCharsetForURI(buffer.uri, val);
                            buffer.docShell.reload(Ci.nsIWebNavigation.LOAD_FLAGS_CHARSET_CHANGE);
                        }
                        catch (e) { dactyl.reportError(e); }
                    });
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
                    && Object.keys(value).every(v => v.length == 1)
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
                                res = iter.find(filter.matcher(doc),
                                                elem => ((elem.nodeValue || elem.textContent).trim() == line &&
                                                         DOM(elem).display != "none"))
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
            "regexplist", UTF8(/'^\s*Next Page\s*$','^\s*Next [>»]','\bnext\b',^>$,^(>>|»)$,^(>|»),(>|»)$,'\bmore\b'/.source),
            { regexpFlags: "i" });

        options.add(["previouspattern"],
            "Patterns to use when guessing the previous page in a document sequence",
            "regexplist", UTF8(/'^\s*Prev(ious)? Page\s*$','[<«] Prev\s*$','\bprev(ious)?\b',^<$,^(<<|«)$,^(<|«),(<|«)$/.source),
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
    let { LoadContextInfo } = Cu.import("resource://gre/modules/LoadContextInfo.jsm", {});
    let contextInfo = LoadContextInfo.fromLoadContext(sanitizer.getContext(doc), false);
    let storage = services.cache.diskCacheStorage(contextInfo, false);
    let pageSize = []; // [0] bytes; [1] kbytes

    storage.asyncOpenURI(util.createURI(doc.documentURI), "",
        Ci.nsICacheStorage.OPEN_READONLY,
        {
            onCacheEntryCheck: () => Ci.nsICacheEntryOpenCallback.ENTRY_WANTED,
            onCacheEntryAvailable: entry => {
                pageSize[0] = util.formatBytes(entry.dataSize, 0, false);
                pageSize[1] = util.formatBytes(entry.dataSize, 2, true);
                if (pageSize[1] == pageSize[0])
                    pageSize.length = 1; // don't output "xx Bytes" twice
        }
    });

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

    let { shortURL } = this;
    if (shortURL)
        yield ["Short URL", template.highlightURL(shortURL, true)];

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

    return Array.map(metaNodes, node => [(node.name || node.httpEquiv),
                                         template.highlightURL(node.content)])
                .sort((a, b) => util.compareIgnoreCase(a[0], b[0]));
});

Buffer.addPageInfoSection("s", "Security", function (verbose) {
    let { statusline } = this.modules;

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

        let { host, port } = identity._lastUri;
        if (port == -1)
            port = 443;

        if (identity._overrideService.hasMatchingOverride(host, port, data.cert, {}, {}))
            yield ["User exception", /*L*/"true"];
        break;
    }
});

// catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

endModule();

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
