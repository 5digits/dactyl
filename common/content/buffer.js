// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/**
 * A class to manage the primary web content buffer. The name comes
 * from Vim's term, 'buffer', which signifies instances of open
 * files.
 * @instance buffer
 */
var Buffer = Module("buffer", {
    init: function init() {
        this.evaluateXPath = util.evaluateXPath;
        this.pageInfo = {};

        this.addPageInfoSection("e", "Search Engines", function (verbose) {

            let n = 1;
            let nEngines = 0;
            for (let { document: doc } in values(buffer.allFrames())) {
                let engines = util.evaluateXPath(["link[@href and @rel='search' and @type='application/opensearchdescription+xml']"], doc);
                nEngines += engines.snapshotLength;

                if (verbose)
                    for (let link in engines)
                        yield [link.title || /*L*/ "Engine " + n++,
                               <a xmlns={XHTML} href={link.href} onclick="if (event.button == 0) { window.external.AddSearchProvider(this.href); return false; }" highlight="URL">{link.href}</a>];
            }

            if (!verbose && nEngines)
                yield nEngines + /*L*/" engine" + (nEngines > 1 ? "s" : "");
        });

        this.addPageInfoSection("f", "Feeds", function (verbose) {
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
                        window.urlSecurityCheck(data.href, principal,
                                Ci.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL);
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
            for (let [i, win] in Iterator(buffer.allFrames())) {
                let doc = win.document;

                for (let link in util.evaluateXPath(["link[@href and (@rel='feed' or (@rel='alternate' and @type))]"], doc)) {
                    let rel = link.rel.toLowerCase();
                    let feed = { title: link.title, href: link.href, type: link.type || "" };
                    if (isValidFeed(feed, doc.nodePrincipal, rel == "feed")) {
                        nFeed++;
                        let type = feedTypes[feed.type] || "RSS";
                        if (verbose)
                            yield [feed.title, template.highlightURL(feed.href, true) + <span class="extra-info">&#xa0;({type})</span>];
                    }
                }

            }

            if (!verbose && nFeed)
                yield nFeed + /*L*/" feed" + (nFeed > 1 ? "s" : "");
        });

        this.addPageInfoSection("g", "General Info", function (verbose) {
            let doc = buffer.focusedFrame.document;

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

        this.addPageInfoSection("m", "Meta Tags", function (verbose) {
            if (!verbose)
                return [];

            // get meta tag data, sort and put into pageMeta[]
            let metaNodes = buffer.focusedFrame.document.getElementsByTagName("meta");

            return Array.map(metaNodes, function (node) [(node.name || node.httpEquiv), template.highlightURL(node.content)])
                        .sort(function (a, b) util.compareIgnoreCase(a[0], b[0]));
        });

        let identity = window.gIdentityHandler;
        this.addPageInfoSection("s", "Security", function (verbose) {
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

        dactyl.commands["buffer.viewSource"] = function (event) {
            let elem = event.originalTarget;
            let obj = { url: elem.getAttribute("href"), line: Number(elem.getAttribute("line")) };
            if (elem.hasAttribute("column"))
                obj.column = elem.getAttribute("column");

            buffer.viewSource(obj);
        };
    },

    // called when the active document is scrolled
    _updateBufferPosition: function _updateBufferPosition() {
        statusline.updateBufferPosition();
        commandline.clear(true);
    },

    /**
     * @property {Array} The alternative style sheets for the current
     *     buffer. Only returns style sheets for the 'screen' media type.
     */
    get alternateStyleSheets() {
        let stylesheets = window.getAllStyleSheets(this.focusedFrame);

        return stylesheets.filter(
            function (stylesheet) /^(screen|all|)$/i.test(stylesheet.media.mediaText) && !/^\s*$/.test(stylesheet.title)
        );
    },

    climbUrlPath: function climbUrlPath(count) {
        let url = buffer.documentURI.clone();
        dactyl.assert(url instanceof Ci.nsIURL);

        while (count-- && url.path != "/")
            url.path = url.path.replace(/[^\/]+\/*$/, "");

        dactyl.assert(!url.equals(buffer.documentURI));
        dactyl.open(url.spec);
    },

    incrementURL: function incrementURL(count) {
        let matches = buffer.uri.spec.match(/(.*?)(\d+)(\D*)$/);
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
     * @property {Object} A map of page info sections to their
     *     content generating functions.
     */
    pageInfo: null,

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
        if (!content.document.dactylStore)
            content.document.dactylStore = {};
        return content.document.dactylStore;
    },

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
    set lastInputField(value) { this.localStore.lastInputField = value && Cu.getWeakReference(value); },

    /**
     * @property {nsIURI} The current top-level document.
     */
    get doc() window.content.document,

    /**
     * @property {nsIURI} The current top-level document's URI.
     */
    get uri() util.newURI(content.location.href),

    /**
     * @property {nsIURI} The current top-level document's URI, sans any
     *     fragment identifier.
     */
    get documentURI() let (doc = content.document) doc.documentURIObject || util.newURI(doc.documentURI),

    /**
     * @property {string} The current top-level document's URL.
     */
    get URL() update(new String(content.location.href), util.newURI(content.location.href)),

    /**
     * @property {number} The buffer's height in pixels.
     */
    get pageHeight() content.innerHeight,

    /**
     * @property {number} The current browser's zoom level, as a
     *     percentage with 100 as 'normal'.
     */
    get zoomLevel() config.browser.markupDocumentViewer[this.fullZoom ? "fullZoom" : "textZoom"] * 100,
    set zoomLevel(value) { this.setZoom(value, this.fullZoom); },

    /**
     * @property {boolean} Whether the current browser is using full
     *     zoom, as opposed to text zoom.
     */
    get fullZoom() ZoomManager.useFullZoom,
    set fullZoom(value) { this.setZoom(this.zoomLevel, value); },

    /**
     * @property {string} The current document's title.
     */
    get title() content.document.title,

    /**
     * @property {number} The buffer's horizontal scroll percentile.
     */
    get scrollXPercent() {
        let elem = this.findScrollable(0, true);
        if (elem.scrollWidth - elem.clientWidth === 0)
            return 0;
        return elem.scrollLeft * 100 / (elem.scrollWidth - elem.clientWidth);
    },

    /**
     * @property {number} The buffer's vertical scroll percentile.
     */
    get scrollYPercent() {
        let elem = this.findScrollable(0, false);
        if (elem.scrollHeight - elem.clientHeight === 0)
            return 0;
        return elem.scrollTop * 100 / (elem.scrollHeight - elem.clientHeight);
    },

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

    /**
     * Returns a list of all frames in the given window or current buffer.
     */
    allFrames: function allFrames(win, focusedFirst) {
        let frames = [];
        (function rec(frame) {
            if (true || frame.document.body instanceof HTMLBodyElement)
                frames.push(frame);
            Array.forEach(frame.frames, rec);
        })(win || content);
        if (focusedFirst)
            return frames.filter(function (f) f === buffer.focusedFrame).concat(
                    frames.filter(function (f) f !== buffer.focusedFrame));
        return frames;
    },

    /**
     * @property {Window} Returns the currently focused frame.
     */
    get focusedFrame() {
        let frame = this.localStore.focusedFrame;
        return frame && frame.get() || content;
    },
    set focusedFrame(frame) {
        this.localStore.focusedFrame = Cu.getWeakReference(frame);
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
        if (elem instanceof Window && !Editor.getEditor(elem))
            return true;

        let doc = elem.ownerDocument || elem.document || elem;
        switch (options.get("strictfocus").getKey(doc.documentURIObject || util.newURI(doc.documentURI), "moderate")) {
        case "despotic":
            return elem.dactylFocusAllowed || elem.frameElement && elem.frameElement.dactylFocusAllowed;
        case "moderate":
            return doc.dactylFocusAllowed || elem.frameElement && elem.frameElement.ownerDocument.dactylFocusAllowed;
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
        elem.dactylFocusAllowed = true;
        win.document.dactylFocusAllowed = true;

        if (isinstance(elem, [HTMLFrameElement, HTMLIFrameElement]))
            elem = elem.contentWindow;
        if (elem.document)
            elem.document.dactylFocusAllowed = true;

        if (elem instanceof HTMLInputElement && elem.type == "file") {
            Buffer.openUploadPrompt(elem);
            this.lastInputField = elem;
        }
        else {
            if (isinstance(elem, [HTMLInputElement, XULTextBoxElement]))
                var flags = services.focus.FLAG_BYMOUSE;
            else
                flags = services.focus.FLAG_SHOWRING;
            dactyl.focus(elem, flags);

            if (elem instanceof Window) {
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
            if (elem instanceof HTMLAreaElement) {
                try {
                    let [x, y] = elem.getAttribute("coords").split(",").map(parseFloat);

                    events.dispatch(elem, events.create(elem.ownerDocument, "mouseover", { screenX: x, screenY: y }));
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
            function b(regexp, elem) regexp.test(elem.title);

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
        let doc = elem.ownerDocument;
        let win = doc.defaultView;
        let { left: offsetX, top: offsetY } = elem.getBoundingClientRect();

        if (isinstance(elem, [HTMLFrameElement, HTMLIFrameElement]))
            return this.focusElement(elem);
        if (isinstance(elem, HTMLLinkElement))
            return dactyl.open(elem.href, where);

        if (elem instanceof HTMLAreaElement) { // for imagemap
            let coords = elem.getAttribute("coords").split(",");
            offsetX = Number(coords[0]) + 1;
            offsetY = Number(coords[1]) + 1;
        }
        else if (elem instanceof HTMLInputElement && elem.type == "file") {
            Buffer.openUploadPrompt(elem);
            return;
        }

        let ctrlKey = false, shiftKey = false;
        switch (where) {
        case dactyl.NEW_TAB:
        case dactyl.NEW_BACKGROUND_TAB:
            ctrlKey = true;
            shiftKey = (where != dactyl.NEW_BACKGROUND_TAB);
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
            ["mousedown", "mouseup", "click"].slice(0, util.haveGecko("2b") ? 2 : 3)
                .forEach(function (event) {
                events.dispatch(elem, events.create(doc, event, {
                    screenX: offsetX, screenY: offsetY,
                    ctrlKey: ctrlKey, shiftKey: shiftKey, metaKey: ctrlKey
                }));
            });
            let sel = util.selectionController(win);
            sel.getSelection(sel.SELECTION_FOCUS_REGION).collapseToStart();
        });
    },

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
    openContextMenu: function openContextMenu(elem) {
        document.popupNode = elem;
        let menu = document.getElementById("contentAreaContextMenu");
        menu.showPopup(elem, -1, -1, "context", "bottomleft", "topleft");
    },

    /**
     * Saves a page link to disk.
     *
     * @param {HTMLAnchorElement} elem The page link to save.
     */
    saveLink: function saveLink(elem) {
        let doc      = elem.ownerDocument;
        let uri      = util.newURI(elem.href || elem.src, null, util.newURI(elem.baseURI));
        let referrer = util.newURI(doc.documentURI, doc.characterSet);

        try {
            window.urlSecurityCheck(uri.spec, doc.nodePrincipal);

            io.CommandFileMode(_("buffer.prompt.saveLink") + " ", {
                onSubmit: function (path) {
                    let file = io.File(path);
                    if (file.exists() && file.isDirectory())
                        file.append(Buffer.getDefaultNames(elem)[0][0]);

                    try {
                        if (!file.exists())
                            file.create(File.NORMAL_FILE_TYPE, octal(644));
                    }
                    catch (e) {
                        util.assert(false, _("save.invalidDestination", e.name));
                    }

                    buffer.saveURI(uri, file);
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

        let downloadListener = new window.DownloadListener(window,
                services.Transfer(uri, File(file).URI, "",
                                  null, null, null, persist));

        persist.progressListener = update(Object.create(downloadListener), {
            onStateChange: util.wrapCallback(function onStateChange(progress, request, flags, status) {
                if (callback && (flags & Ci.nsIWebProgressListener.STATE_STOP) && status == 0)
                    dactyl.trapErrors(callback, self, uri, file, progress, request, flags, status);

                return onStateChange.superapply(this, arguments);
            })
        });

        persist.saveURI(uri, null, null, null, null, file);
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

    _scrollByScrollSize: function _scrollByScrollSize(count, direction) {
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
            while (elem && !(elem instanceof Element) && elem.parentNode)
                elem = elem.parentNode;
            for (; elem && elem.parentNode instanceof Element; elem = elem.parentNode)
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

        if (!(elem instanceof Element)) {
            let doc = this.findScrollableWindow().document;
            elem = find(doc.body || doc.getElementsByTagName("body")[0] ||
                        doc.documentElement);
        }
        let doc = this.focusedFrame.document;
        return dactyl.assert(elem || doc.body || doc.documentElement);
    },

    /**
     * Find the best candidate scrollable frame in the current buffer.
     */
    findScrollableWindow: function findScrollableWindow() {
        win = window.document.commandDispatcher.focusedWindow;
        if (win && (win.scrollMaxX > 0 || win.scrollMaxY > 0))
            return win;

        let win = this.focusedFrame;
        if (win && (win.scrollMaxX > 0 || win.scrollMaxY > 0))
            return win;

        win = content;
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
     */
    findJump: function findJump(arg, count, reverse) {
        const FUDGE = 10;

        let path = options["jumptags"][arg];
        dactyl.assert(path, _("error.invalidArgument", arg));

        let distance = reverse ? function (rect) -rect.top : function (rect) rect.top;
        let elems = [[e, distance(e.getBoundingClientRect())] for (e in path.matcher(this.focusedFrame.document))]
                        .filter(function (e) e[1] > FUDGE)
                        .sort(function (a, b) a[1] - b[1])

        let idx = Math.min((count || 1) - 1, elems.length);
        dactyl.assert(idx in elems);

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
        if (!(content.document instanceof HTMLDocument))
            return;

        let frames = this.allFrames();

        if (frames.length == 0) // currently top is always included
            return;

        // remove all hidden frames
        frames = frames.filter(function (frame) !(frame.document.body instanceof HTMLFrameSetElement))
                       .filter(function (frame) !frame.frameElement ||
            let (rect = frame.frameElement.getBoundingClientRect())
                rect.width && rect.height);

        // find the currently focused frame index
        let current = Math.max(0, frames.indexOf(this.focusedFrame));

        // calculate the next frame to focus
        let next = current + count;
        if (next < 0 || next >= frames.length)
            dactyl.beep();
        next = Math.constrain(next, 0, frames.length - 1);

        // focus next frame and scroll into view
        dactyl.focus(frames[next]);
        if (frames[next] != content)
            frames[next].frameElement.scrollIntoView(false);

        // add the frame indicator
        let doc = frames[next].document;
        let indicator = util.xmlToDom(<div highlight="FrameIndicator"/>, doc);
        (doc.body || doc.documentElement || doc).appendChild(indicator);

        util.timeout(function () { doc.body.removeChild(indicator); }, 500);

        // Doesn't unattach
        //doc.body.setAttributeNS(NS.uri, "activeframe", "true");
        //util.timeout(function () { doc.body.removeAttributeNS(NS.uri, "activeframe"); }, 500);
    },

    // similar to pageInfo
    // TODO: print more useful information, just like the DOM inspector
    /**
     * Displays information about the specified element.
     *
     * @param {Node} elem The element to query.
     */
    showElementInfo: function showElementInfo(elem) {
        dactyl.echo(<><!--L-->Element:<br/>{util.objectToString(elem, true)}</>, commandline.FORCE_MULTILINE);
    },

    /**
     * Displays information about the current buffer.
     *
     * @param {boolean} verbose Display more verbose information.
     * @param {string} sections A string limiting the displayed sections.
     * @default The value of 'pageinfo'.
     */
    showPageInfo: function showPageInfo(verbose, sections) {
        // Ctrl-g single line output
        if (!verbose) {
            let file = content.location.pathname.split("/").pop() || _("buffer.noName");
            let title = content.document.title || _("buffer.noTitle");

            let info = template.map(sections || options["pageinfo"],
                function (opt) template.map(buffer.pageInfo[opt].action(), util.identity, ", "),
                ", ");

            if (bookmarkcache.isBookmarked(this.URL))
                info += ", " + _("buffer.bookmarked");

            let pageInfoText = <>{file.quote()} [{info}] {title}</>;
            dactyl.echo(pageInfoText, commandline.FORCE_SINGLELINE);
            return;
        }

        let list = template.map(sections || options["pageinfo"], function (option) {
            let { action, title } = buffer.pageInfo[option];
            return template.table(title, action(true));
        }, <br/>);
        dactyl.echo(list, commandline.FORCE_MULTILINE);
    },

    /**
     * Stops loading and animations in the current content.
     */
    stop: function stop() {
        if (config.stop)
            config.stop();
        else
            config.browser.mCurrentBrowser.stop();
    },

    /**
     * Opens a viewer to inspect the source of the currently selected
     * range.
     */
    viewSelectionSource: function viewSelectionSource() {
        // copied (and tuned somewhat) from browser.jar -> nsContextMenu.js
        let win = document.commandDispatcher.focusedWindow;
        if (win == window)
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
                    window.getWebNavigation().gotoIndex(sh.index);
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
                    editor.editFileExternally(update({ file: file.path }, callback || {}),
                                              function () { temp && file.remove(false); });
                    return true;
                };

            let uri = isString(doc) ? util.newURI(doc) : util.newURI(doc.location.href);

            if (!isString(doc))
                return io.withTempFiles(function (temp) {
                    let encoder = services.HtmlEncoder();
                    encoder.init(doc, "text/unicode", encoder.OutputRaw|encoder.OutputPreformatted);
                    temp.write(encoder.encodeToString(), ">");
                    return this.callback(temp, true);
                }, this, true);

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
        dactyl.assert(value >= Buffer.ZOOM_MIN || value <= Buffer.ZOOM_MAX,
                      _("zoom.outOfRange", Buffer.ZOOM_MIN, Buffer.ZOOM_MAX));

        if (fullZoom !== undefined)
            ZoomManager.useFullZoom = fullZoom;
        try {
            ZoomManager.zoom = value / 100;
        }
        catch (e if e == Cr.NS_ERROR_ILLEGAL_VALUE) {
            return dactyl.echoerr(_("zoom.illegal"));
        }

        if ("FullZoom" in window)
            FullZoom._applySettingToPref();

        statusline.updateZoomLevel(value, ZoomManager.useFullZoom);
    },

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
        if (fullZoom === undefined)
            fullZoom = ZoomManager.useFullZoom;

        let values = ZoomManager.zoomValues;
        let cur = values.indexOf(ZoomManager.snap(ZoomManager.zoom));
        let i = Math.constrain(cur + steps, 0, values.length - 1);

        dactyl.assert(i != cur || fullZoom != ZoomManager.useFullZoom);

        this.setZoom(Math.round(values[i] * 100), fullZoom);
    },

    getAllFrames: deprecated("buffer.allFrames", "allFrames"),
    scrollTop: deprecated("buffer.scrollToPercent", function scrollTop() buffer.scrollToPercent(null, 0)),
    scrollBottom: deprecated("buffer.scrollToPercent", function scrollBottom() buffer.scrollToPercent(null, 100)),
    scrollStart: deprecated("buffer.scrollToPercent", function scrollStart() buffer.scrollToPercent(0, null)),
    scrollEnd: deprecated("buffer.scrollToPercent", function scrollEnd() buffer.scrollToPercent(100, null)),
    scrollColumns: deprecated("buffer.scrollHorizontal", function scrollColumns(cols) buffer.scrollHorizontal("columns", cols)),
    scrollPages: deprecated("buffer.scrollHorizontal", function scrollPages(pages) buffer.scrollVertical("pages", pages)),
    scrollTo: deprecated("Buffer.scrollTo", function scrollTo(x, y) content.scrollTo(x, y)),
    textZoom: deprecated("buffer.zoomValue/buffer.fullZoom", function textZoom() config.browser.markupDocumentViewer.textZoom * 100)
}, {
    PageInfo: Struct("PageInfo", "name", "title", "action")
                        .localize("title"),

    ZOOM_MIN: Class.memoize(function () prefs.get("zoom.minPercent")),
    ZOOM_MAX: Class.memoize(function () prefs.get("zoom.maxPercent")),

    setZoom: deprecated("buffer.setZoom", function setZoom() buffer.setZoom.apply(buffer, arguments)),
    bumpZoomLevel: deprecated("buffer.bumpZoomLevel", function bumpZoomLevel() buffer.bumpZoomLevel.apply(buffer, arguments)),

    /**
     * Returns the currently selected word in *win*. If the selection is
     * null, it tries to guess the word that the caret is positioned in.
     *
     * @returns {string}
     */
    currentWord: function currentWord(win, select) {
        let selection = win.getSelection();
        if (selection.rangeCount == 0)
            return "";

        let range = selection.getRangeAt(0).cloneRange();
        if (range.collapsed && range.startContainer instanceof Text) {
            let re = options.get("iskeyword").regexp;
            Editor.extendRange(range, true,  re, true);
            Editor.extendRange(range, false, re, true);
        }
        if (select) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
        return util.domToString(range);
    },

    getDefaultNames: function getDefaultNames(node) {
        let url = node.href || node.src || node.documentURI;
        let currExt = url.replace(/^.*?(?:\.([a-z0-9]+))?$/i, "$1").toLowerCase();

        if (isinstance(node, [Document, HTMLImageElement])) {
            let type = node.contentType || node.QueryInterface(Ci.nsIImageLoadingContent)
                                               .getRequest(0).mimeType;

            if (type === "text/plain")
                var ext = "." + (currExt || "txt");
            else
                ext = "." + services.mime.getPrimaryExtension(type, currExt);
        }
        else if (currExt)
            ext = "." + currExt;
        else
            ext = "";
        let re = ext ? RegExp("(\\." + currExt + ")?$", "i") : /$/;

        var names = [];
        if (node.title)
            names.push([node.title, /*L*/"Page Name"]);

        if (node.alt)
            names.push([node.alt, /*L*/"Alternate Text"]);

        if (!isinstance(node, Document) && node.textContent)
            names.push([node.textContent, /*L*/"Link Text"]);

        names.push([decodeURIComponent(url.replace(/.*?([^\/]*)\/*$/, "$1")), "File Name"]);

        return names.filter(function ([leaf, title]) leaf)
                    .map(function ([leaf, title]) [leaf.replace(util.OS.illegalCharacters, encodeURIComponent)
                                                       .replace(re, ext), title]);
    },

    findScrollableWindow: deprecated("buffer.findScrollableWindow", function findScrollableWindow() buffer.findScrollableWindow.apply(buffer, arguments)),
    findScrollable: deprecated("buffer.findScrollable", function findScrollable() buffer.findScrollable.apply(buffer, arguments)),

    isScrollable: function isScrollable(elem, dir, horizontal) {
        let pos = "scrollTop", size = "clientHeight", max = "scrollHeight", layoutSize = "offsetHeight",
            overflow = "overflowX", border1 = "borderTopWidth", border2 = "borderBottomWidth";
        if (horizontal)
            pos = "scrollLeft", size = "clientWidth", max = "scrollWidth", layoutSize = "offsetWidth",
            overflow = "overflowX", border1 = "borderLeftWidth", border2 = "borderRightWidth";

        let style = util.computedStyle(elem);
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
     *   null, to not alter the horizontal scroll offset.
     * @param {number|null} top The top absolute pixel offset. If
     *   null, to not alter the vertical scroll offset.
     */
    scrollTo: function scrollTo(elem, left, top) {
        // Temporary hack. Should be done better.
        if (elem.ownerDocument == buffer.focusedFrame.document)
            marks.add("'");
        if (left != null)
            elem.scrollLeft = left;
        if (top != null)
            elem.scrollTop = top;

        if (util.haveGecko("2.0") && !util.haveGecko("7.*"))
            elem.ownerDocument.defaultView
                .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils)
                .redraw();
    },

    /**
     * Scrolls the currently given element horizontally.
     *
     * @param {Element} elem The element to scroll.
     * @param {string} increment The increment by which to scroll.
     *   Possible values are: "columns", "pages"
     * @param {number} number The possibly fractional number of
     *   increments to scroll. Positive values scroll to the right while
     *   negative values scroll to the left.
     * @throws {FailedAssertion} if scrolling is not possible in the
     *   given direction.
     */
    scrollHorizontal: function scrollHorizontal(elem, increment, number) {
        let fontSize = parseInt(util.computedStyle(elem).fontSize);
        if (increment == "columns")
            increment = fontSize; // Good enough, I suppose.
        else if (increment == "pages")
            increment = elem.clientWidth - fontSize;
        else
            throw Error();

        dactyl.assert(number < 0 ? elem.scrollLeft > 0 : elem.scrollLeft < elem.scrollWidth - elem.clientWidth);

        let left = elem.dactylScrollDestX !== undefined ? elem.dactylScrollDestX : elem.scrollLeft;
        elem.dactylScrollDestX = undefined;

        Buffer.scrollTo(elem, left + number * increment, null);
    },

    /**
     * Scrolls the currently given element vertically.
     *
     * @param {Element} elem The element to scroll.
     * @param {string} increment The increment by which to scroll.
     *   Possible values are: "lines", "pages"
     * @param {number} number The possibly fractional number of
     *   increments to scroll. Positive values scroll upward while
     *   negative values scroll downward.
     * @throws {FailedAssertion} if scrolling is not possible in the
     *   given direction.
     */
    scrollVertical: function scrollVertical(elem, increment, number) {
        let fontSize = parseInt(util.computedStyle(elem).fontSize);
        if (increment == "lines")
            increment = fontSize;
        else if (increment == "pages")
            increment = elem.clientHeight - fontSize;
        else
            throw Error();

        dactyl.assert(number < 0 ? elem.scrollTop > 0 : elem.scrollTop < elem.scrollHeight - elem.clientHeight);

        let top = elem.dactylScrollDestY !== undefined ? elem.dactylScrollDestY : elem.scrollTop;
        elem.dactylScrollDestY = undefined;

        Buffer.scrollTo(elem, null, top + number * increment);
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
    scrollToPercent: function scrollToPercent(elem, horizontal, vertical) {
        Buffer.scrollTo(elem,
                        horizontal == null ? null
                                           : (elem.scrollWidth - elem.clientWidth) * (horizontal / 100),
                        vertical   == null ? null
                                           : (elem.scrollHeight - elem.clientHeight) * (vertical / 100));
    },

    openUploadPrompt: function openUploadPrompt(elem) {
        io.CommandFileMode(_("buffer.prompt.uploadFile") + " ", {
            onSubmit: function onSubmit(path) {
                let file = io.File(path);
                dactyl.assert(file.exists());

                elem.value = file.path;
                events.dispatch(elem, events.create(elem.ownerDocument, "change", {}));
            }
        }).open(elem.value);
    }
}, {
    commands: function initCommands(dactyl, modules, window) {
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
                dactyl.assert(!arg || arg[0] == ">" && !util.OS.isWindows,
                              _("error.trailingCharacters"));

                const PRINTER = "PostScript/default";
                const BRANCH  = "print.printer_" + PRINTER + ".";

                prefs.withContext(function () {
                    if (arg) {
                        prefs.set("print.print_printer", PRINTER);

                        prefs.set(   "print.print_to_file", true);
                        prefs.set(BRANCH + "print_to_file", true);

                        prefs.set(   "print.print_to_filename", io.File(arg.substr(1)).path);
                        prefs.set(BRANCH + "print_to_filename", io.File(arg.substr(1)).path);

                        dactyl.echomsg(_("print.toFile", arg.substr(1)));
                    }
                    else
                        dactyl.echomsg(_("print.sending"));

                    prefs.set("print.always_print_silent", args.bang);
                    prefs.set("print.show_print_progress", !args.bang);

                    config.browser.contentWindow.print();
                });

                if (arg)
                    dactyl.echomsg(_("print.printed", arg.substr(1)));
                else
                    dactyl.echomsg(_("print.sent"));
            },
            {
                argCount: "?",
                bang: true,
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
                    completion.optionValue(context, "pageinfo", "+", "");
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
                completer: function (context) completion.alternateStyleSheet(context),
                literal: 0
            });

        commands.add(["re[load]"],
            "Reload the current web page",
            function (args) { tabs.reload(config.browser.mCurrentTab, args.bang); },
            {
                argCount: "0",
                bang: true
            });

        // TODO: we're prompted if download.useDownloadDir isn't set and no arg specified - intentional?
        commands.add(["sav[eas]", "w[rite]"],
            "Save current document to disk",
            function (args) {
                let doc = content.document;
                let chosenData = null;
                let filename = args[0];

                let command = commandline.command;
                if (filename) {
                    if (filename[0] == "!")
                        return buffer.viewSourceExternally(buffer.focusedFrame.document,
                            function (file) {
                                let output = io.system(filename.substr(1), file);
                                commandline.command = command;
                                commandline.commandOutput(<span highlight="CmdOutput">{output}</span>);
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

                    let file = io.File(filename.replace(RegExp(File.PATH_SEP + "*$"), ""));

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
                    var contentDisposition = content.QueryInterface(Ci.nsIInterfaceRequestor)
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
                    if (context.filter[0] == "!")
                        return;
                    if (/^>>/.test(context.filter))
                        context.advance(/^>>\s*/.exec(context.filter)[0].length);

                    completion.savePage(context, content.document);
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
                completer: function (context) completion.url(context, "bhf")
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
                else if (/^[+-]\d+$/.test(arg)) {
                    level = Math.round(buffer.zoomLevel + parseInt(arg, 10));
                    level = Math.constrain(level, Buffer.ZOOM_MIN, Buffer.ZOOM_MAX);
                }
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
        completion.alternateStyleSheet = function alternateStylesheet(context) {
            context.title = ["Stylesheet", "Location"];

            // unify split style sheets
            let styles = iter([s.title, []] for (s in values(buffer.alternateStyleSheets))).toObject();

            buffer.alternateStyleSheets.forEach(function (style) {
                styles[style.title].push(style.href || _("style.inline"));
            });

            context.completions = [[title, href.join(", ")] for ([title, href] in Iterator(styles))];
        };

        completion.buffer = function buffer(context, visible) {
            let filter = context.filter.toLowerCase();

            let defItem = { parent: { getTitle: function () "" } };

            let tabGroups = {};
            tabs.getGroups();
            tabs[visible ? "visibleTabs" : "allTabs"].forEach(function (tab, i) {
                let group = (tab.tabItem || tab._tabViewTabItem || defItem).parent || defItem.parent;
                if (!Set.has(tabGroups, group.id))
                    tabGroups[group.id] = [group.getTitle(), []];

                group = tabGroups[group.id];
                group[1].push([i, tab.linkedBrowser]);
            });

            context.pushProcessor(0, function (item, text, next) <>
                <span highlight="Indicator" style="display: inline-block;">{item.indicator}</span>
                { next.call(this, item, text) }
            </>);
            context.process[1] = function (item, text) template.bookmarkDescription(item, template.highlightFilter(text, this.filter));

            context.anchored = false;
            context.keys = {
                text: "text",
                description: "url",
                indicator: function (item) item.tab === tabs.getTab()  ? "%" :
                                           item.tab === tabs.alternate ? "#" : " ",
                icon: "icon",
                id: "id",
                command: function () "tabs.select"
            };
            context.compare = CompletionContext.Sort.number;
            context.filters[0] = CompletionContext.Filter.textDescription;

            for (let [id, vals] in Iterator(tabGroups))
                context.fork(id, 0, this, function (context, [name, browsers]) {
                    context.title = [name || "Buffers"];
                    context.generate = function ()
                        Array.map(browsers, function ([i, browser]) {
                            let indicator = " ";
                            if (i == tabs.index())
                                indicator = "%";
                            else if (i == tabs.index(tabs.alternate))
                                indicator = "#";

                            let tab = tabs.getTab(i, visible);
                            let url = browser.contentDocument.location.href;
                            i = i + 1;

                            return {
                                text: [i + ": " + (tab.label || /*L*/"(Untitled)"), i + ": " + url],
                                tab: tab,
                                id: i,
                                url: url,
                                icon: tab.image || DEFAULT_FAVICON
                            };
                        });
                }, vals);
        };

        completion.savePage = function savePage(context, node) {
            context.fork("generated", context.filter.replace(/[^/]*$/, "").length,
                         this, function (context) {
                context.completions = Buffer.getDefaultNames(node);
            });
        };
    },
    events: function initEvents(dactyl, modules, window) {
        events.listen(config.browser, "scroll", buffer.closure._updateBufferPosition, false);
    },
    mappings: function initMappings(dactyl, modules, window) {
        mappings.add([modes.NORMAL],
            ["y", "<yank-location>"], "Yank current location to the clipboard",
            function () { dactyl.clipboardWrite(buffer.uri.spec, true); });

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
            function (args) { buffer.scrollToPercent(null, args.count != null ? args.count : 100); },
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
                if (isinstance(services.focus.activeWindow.document.activeElement,
                               [HTMLInputElement, HTMLButtonElement, Ci.nsIDOMXULButtonElement]))
                    return Events.PASS;

                if (isinstance(buffer.focusedFrame.document.activeElement,
                               [HTMLInputElement, HTMLButtonElement, Ci.nsIDOMXULButtonElement]))
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
                buffer.findLink("previous", options["previouspattern"], (args.count || 1) - 1, true);
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

                    let elements = array.flatten(frames.map(function (win) [m for (m in util.evaluateXPath(xpath, win.document))]))
                                        .filter(function (elem) {
                        if (isinstance(elem, [HTMLFrameElement, HTMLIFrameElement]))
                            return Editor.getEditor(elem.contentWindow);

                        if (elem.readOnly || elem instanceof HTMLInputElement && !Set.has(util.editableInputs, elem.type))
                            return false;

                        let computedStyle = util.computedStyle(elem);
                        let rect = elem.getBoundingClientRect();
                        return computedStyle.visibility != "hidden" && computedStyle.display != "none" &&
                            (elem instanceof Ci.nsIDOMXULTextBoxElement || computedStyle.MozUserFocus != "ignore") &&
                            rect.width && rect.height;
                    });

                    dactyl.assert(elements.length > 0);
                    elem = elements[Math.constrain(args.count, 1, elements.length) - 1];
                }
                buffer.focusElement(elem);
                util.scrollIntoView(elem);
            },
            { count: true });

        function url() {
            let url = dactyl.clipboardRead();
            dactyl.assert(url, _("error.clipboardEmpty"));

            let proto = /^([-\w]+):/.exec(url);
            if (proto && "@mozilla.org/network/protocol;1?name=" + proto[1] in Cc && !RegExp(options["urlseparator"]).test(url))
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
        mappings.add([modes.COMMAND], ["Y", "<yank-word>"],
            "Copy selected text or current word",
            function () {
                let sel = buffer.currentWord;
                dactyl.assert(sel);
                dactyl.clipboardWrite(sel, true);
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
        options.add(["encoding", "enc"],
            "The current buffer's character encoding",
            "string", "UTF-8",
            {
                scope: Option.SCOPE_LOCAL,
                getter: function () config.browser.docShell.QueryInterface(Ci.nsIDocCharset).charset,
                setter: function (val) {
                    if (options["encoding"] == val)
                        return val;

                    // Stolen from browser.jar/content/browser/browser.js, more or less.
                    try {
                        config.browser.docShell.QueryInterface(Ci.nsIDocCharset).charset = val;
                        PlacesUtils.history.setCharsetForURI(getWebNavigation().currentURI, val);
                        window.getWebNavigation().reload(Ci.nsIWebNavigation.LOAD_FLAGS_CHARSET_CHANGE);
                    }
                    catch (e) { dactyl.reportError(e); }
                    return null;
                },
                completer: function (context) completion.charset(context)
            });

        options.add(["iskeyword", "isk"],
            "Regular expression defining which characters constitute word characters",
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
                        vals[k] = update(new String(v), { matcher: util.compileMatcher(Option.splitList(v)) });
                    return vals;
                },
                validator: function (value) util.validateMatcher.call(this, value)
                    && Object.keys(value).every(function (v) v.length == 1)
            });

        options.add(["nextpattern"],
            "Patterns to use when guessing the next page in a document sequence",
            "regexplist", UTF8("'\\bnext\\b',^>$,^(>>|»)$,^(>|»),(>|»)$,'\\bmore\\b'"),
            { regexpFlags: "i" });

        options.add(["previouspattern"],
            "Patterns to use when guessing the previous page in a document sequence",
            "regexplist", UTF8("'\\bprev|previous\\b',^<$,^(<<|«)$,^(<|«),(<|«)$"),
            { regexpFlags: "i" });

        options.add(["pageinfo", "pa"],
            "Define which sections are shown by the :pageinfo command",
            "charlist", "gesfm",
            { get values() values(buffer.pageInfo).toObject() });

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

        options.add(["usermode", "um"],
            "Show current website without styling defined by the author",
            "boolean", false,
            {
                setter: function (value) config.browser.markupDocumentViewer.authorStyleDisabled = value,
                getter: function () config.browser.markupDocumentViewer.authorStyleDisabled
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
