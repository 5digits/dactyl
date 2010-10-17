// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

const Point = Struct("x", "y");

/**
 * A class to manage the primary web content buffer. The name comes
 * from Vim's term, 'buffer', which signifies instances of open
 * files.
 * @instance buffer
 */
const Buffer = Module("buffer", {
    init: function () {
        this.evaluateXPath = util.evaluateXPath;
        this.pageInfo = {};

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
                yield nFeed + " feed" + (nFeed > 1 ? "s" : "");
        });

        this.addPageInfoSection("g", "General Info", function (verbose) {
            let doc = buffer.focusedFrame.document;

            // get file size
            const ACCESS_READ = Ci.nsICache.ACCESS_READ;
            let cacheKey = doc.location.toString().replace(/#.*$/, "");

            for (let proto in array.iterValues(["HTTP", "FTP"])) {
                try {
                    var cacheEntryDescriptor = services.get("cache").createSession(proto, 0, true)
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
                    yield (pageSize[1] || pageSize[0]) + " bytes";
                yield lastMod;
                return;
            }

            yield ["Title", doc.title];
            yield ["URL", template.highlightURL(doc.location.toString(), true)];

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
            // get meta tag data, sort and put into pageMeta[]
            let metaNodes = buffer.focusedFrame.document.getElementsByTagName("meta");

            return Array.map(metaNodes, function (node) [(node.name || node.httpEquiv), template.highlightURL(node.content)])
                        .sort(function (a, b) util.compareIgnoreCase(a[0], b[0]));
        });
    },

    destroy: function () {
    },

    _triggerLoadAutocmd: function _triggerLoadAutocmd(name, doc) {
        let args = {
            url:   doc.location.href,
            title: doc.title
        };

        if (dactyl.has("tabs")) {
            args.tab = tabs.getContentIndex(doc) + 1;
            args.doc = "tabs.getTab(" + (args.tab - 1) + ").linkedBrowser.contentDocument";
        }

        autocommands.trigger(name, args);
    },

    // called when the active document is scrolled
    _updateBufferPosition: function _updateBufferPosition() {
        statusline.updateBufferPosition();
        commandline.clear();
    },

    onDOMContentLoaded: function onDOMContentLoaded(event) {
        let doc = event.originalTarget;
        if (doc instanceof HTMLDocument && !doc.defaultView.frameElement)
            this._triggerLoadAutocmd("DOMLoad", doc);
    },

    // TODO: see what can be moved to onDOMContentLoaded()
    // event listener which is is called on each page load, even if the
    // page is loaded in a background tab
    onPageLoad: function onPageLoad(event) {
        if (event.originalTarget instanceof Document)
            if (/^dactyl:/.test(event.originalTarget.location.href)) {
                dactyl.initHelp();
                config.styleHelp();
            }

        if (event.originalTarget instanceof HTMLDocument) {
            let doc = event.originalTarget;

            // mark the buffer as loaded, we can't use buffer.loaded
            // since that always refers to the current buffer, while doc can be
            // any buffer, even in a background tab
            doc.pageIsFullyLoaded = 1;

            if (doc.defaultView.frameElement) {
                // document is part of a frameset

                // hacky way to get rid of "Transferring data from ..." on sites with frames
                // when you click on a link inside a frameset, because asyncUpdateUI
                // is not triggered there (Gecko bug?)
                this.timeout(function () { statusline.updateUrl(); }, 10);
            }
            else {
                // code which should happen for all (also background) newly loaded tabs goes here:
                if (doc != config.browser.contentDocument)
                    dactyl.echomsg({ domains: [util.getHost(doc.location.href)], message: "Background tab loaded: " + doc.title || doc.location.href }, 3);

                this._triggerLoadAutocmd("PageLoad", doc);
            }
        }
    },

    /**
     * @property {Object} The document loading progress listener.
     */
    progressListener: update(Object.create(window.XULBrowserWindow), {
        QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIWebProgressListener]),

        loadCount: 0,

        // XXX: function may later be needed to detect a canceled synchronous openURL()
        onStateChange: function onStateChange(webProgress, request, flags, status) {
            onStateChange.superapply(this, arguments);
            // STATE_IS_DOCUMENT | STATE_IS_WINDOW is important, because we also
            // receive statechange events for loading images and other parts of the web page
            if (flags & (Ci.nsIWebProgressListener.STATE_IS_DOCUMENT | Ci.nsIWebProgressListener.STATE_IS_WINDOW)) {
                // This fires when the load event is initiated
                // only thrown for the current tab, not when another tab changes
                if (flags & Ci.nsIWebProgressListener.STATE_START) {
                    webProgress.DOMWindow.document.pageIsFullyLoaded = 0;
                    statusline.updateProgress(0);

                    autocommands.trigger("PageLoadPre", { url: buffer.URL });

                    // don't reset mode if a frame of the frameset gets reloaded which
                    // is not the focused frame
                    if (document.commandDispatcher.focusedWindow == webProgress.DOMWindow && this.loadCount++) {
                        util.timeout(function () { modes.reset(false); },
                            dactyl.mode == modes.HINTS ? 500 : 0);
                    }
                }
                else if (flags & Ci.nsIWebProgressListener.STATE_STOP) {
                    webProgress.DOMWindow.document.pageIsFullyLoaded = (status == 0 ? 1 : 2);
                    statusline.updateUrl();
                }
            }
        },
        // for notifying the user about secure web pages
        onSecurityChange: function onSecurityChange(webProgress, request, state) {
            onSecurityChange.superapply(this, arguments);
            // TODO: do something useful with STATE_SECURE_MED and STATE_SECURE_LOW
            if (state & Ci.nsIWebProgressListener.STATE_IS_INSECURE)
                statusline.setClass("insecure");
            else if (state & Ci.nsIWebProgressListener.STATE_IS_BROKEN)
                statusline.setClass("broken");
            else if (state & Ci.nsIWebProgressListener.STATE_IDENTITY_EV_TOPLEVEL)
                statusline.setClass("extended");
            else if (state & Ci.nsIWebProgressListener.STATE_SECURE_HIGH)
                statusline.setClass("secure");
        },
        onStatusChange: function onStatusChange(webProgress, request, status, message) {
            onStatusChange.superapply(this, arguments);
            statusline.updateUrl(message);
        },
        onProgressChange: function onProgressChange(webProgress, request, curSelfProgress, maxSelfProgress, curTotalProgress, maxTotalProgress) {
            onProgressChange.superapply(this, arguments);
            statusline.updateProgress(curTotalProgress/maxTotalProgress);
        },
        // happens when the users switches tabs
        onLocationChange: function onLocationChange() {
            onLocationChange.superapply(this, arguments);
            statusline.updateUrl();
            statusline.updateProgress();

            util.timeout(function () {
                autocommands.trigger("LocationChange", { url: buffer.URL });
            });

            // if this is not delayed we get the position of the old buffer
            util.timeout(function () {
                statusline.updateBufferPosition();
                statusline.updateZoomLevel();
                commandline.clear();
            }, 500);
        },
        // called at the very end of a page load
        asyncUpdateUI: function asyncUpdateUI() {
            asyncUpdateUI.superapply(this, arguments);
            util.timeout(function () { statusline.updateUrl(); }, 100);
        },
        setOverLink: function setOverLink(link, b) {
            setOverLink.superapply(this, arguments);
            switch (options["showstatuslinks"]) {
            case 1:
                statusline.updateUrl(link ? "Link: " + link : null);
                break;
            case 2:
                if (link)
                    dactyl.echo("Link: " + link, commandline.DISALLOW_MULTILINE);
                else
                    commandline.clear();
                break;
            }
        },
    }),

    /**
     * @property {Array} The alternative style sheets for the current
     *     buffer. Only returns style sheets for the 'screen' media type.
     */
    get alternateStyleSheets() {
        let stylesheets = window.getAllStyleSheets(buffer.focusedFrame);

        return stylesheets.filter(
            function (stylesheet) /^(screen|all|)$/i.test(stylesheet.media.mediaText) && !/^\s*$/.test(stylesheet.title)
        );
    },

    /**
     * @property {Object} A map of page info sections to their
     *     content generating functions.
     */
    pageInfo: null,

    /**
     * @property {number} A value indicating whether the buffer is loaded.
     *     Values may be:
     *         0 - Loading.
     *         1 - Fully loaded.
     *         2 - Load failed.
     */
    get loaded()
        Math.min.apply(Math,
            buffer.allFrames().map(function (frame)
                frame.document.pageIsFullyLoaded || 0)),

    /**
     * @property {Object} The local state store for the currently selected
     *     tab.
     */
    get localStore() {
        if (!window.content.dactylStore)
            window.content.dactylStore = {};
        return window.content.dactylStore;
    },

    /**
     * @property {Node} The last focused input field in the buffer. Used
     *     by the "gi" key binding.
     */
    get lastInputField() this.localStore.lastInputField && this.localStore.lastInputField.get() || null,
    set lastInputField(value) { this.localStore.lastInputField = value && Cu.getWeakReference(value); },

    /**
     * @property {string} The current top-level document's URL.
     */
    get URL() window.content.location.href,

    /**
     * @property {string} The current top-level document's URL, sans any
     *     fragment identifier.
     */
    get URI() window.content.document.documentURI,

    /**
     * @property {number} The buffer's height in pixels.
     */
    get pageHeight() window.content.innerHeight,

    /**
     * @property {number} The current browser's zoom level, as a
     *     percentage with 100 as 'normal'.
     */
    get zoomLevel() config.browser.markupDocumentViewer[this.fullZoom ? "textZoom" : "fullZoom"] * 100,
    set zoomLevel(value) { Buffer.setZoom(value, this.fullZoom); },

    /**
     * @property {boolean} Whether the current browser is using full
     *     zoom, as opposed to text zoom.
     */
    get fullZoom() ZoomManager.useFullZoom,
    set fullZoom(value) { Buffer.setZoom(this.zoomLevel, value); },

    /**
     * @property {string} The current document's title.
     */
    get title() window.content.document.title,

    /**
     * @property {number} The buffer's horizontal scroll percentile.
     */
    get scrollXPercent() {
        let win = Buffer.findScrollableWindow();
        if (win.scrollMaxX > 0)
            return Math.round(win.scrollX / win.scrollMaxX * 100);
        else
            return 0;
    },

    /**
     * @property {number} The buffer's vertical scroll percentile.
     */
    get scrollYPercent() {
        let win = Buffer.findScrollableWindow();
        if (win.scrollMaxY > 0)
            return Math.round(win.scrollY / win.scrollMaxY * 100);
        else
            return 0;
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
        this.pageInfo[option] = [func, title];
    },

    /**
     * Returns a list of all frames in the given window or current buffer.
     */
    allFrames: function (win, focusedFirst) {
        let frames = [];
        (function rec(frame) {
            if (frame.document.body instanceof HTMLBodyElement)
                frames.push(frame);
            Array.forEach(frame.frames, rec);
        })(win || window.content);
        if (focusedFirst)
            return frames.filter(function (f) f === buffer.focusedFrame).concat(
                    frames.filter(function (f) f !== buffer.focusedFrame))
        return frames;
    },

    /**
     * @property {Window} Returns the currently focused frame.
     */
    get focusedFrame() {
        let frame = (dactyl.has("tabs") ? tabs.localStore : this.localStore).focusedFrame;
        return frame && frame.get();
    },
    set focusedFrame(frame) {
        (dactyl.has("tabs") ? tabs.localStore : this.localStore).focusedFrame = Cu.getWeakReference(frame);
    },

    /**
     * Returns the currently selected word. If the selection is
     * null, it tries to guess the word that the caret is
     * positioned in.
     *
     * NOTE: might change the selection
     *
     * @returns {string}
     */
    // FIXME: getSelection() doesn't always preserve line endings, see:
    // https://www.mozdev.org/bugs/show_bug.cgi?id=19303
    getCurrentWord: function () {
        let win = buffer.focusedFrame || window.content;
        let selection = win.getSelection();
        if (selection.rangeCount == 0)
            return "";

        let range = selection.getRangeAt(0);
        if (selection.isCollapsed) {
            let controller = util.selectionController(win);
            let caretmode = controller.getCaretEnabled();
            controller.setCaretEnabled(true);

            // Only move backwards if the previous character is not a space.
            if (range.startOffset > 0 && !/\s/.test(range.startContainer.textContent[range.startOffset - 1]))
                controller.wordMove(false, false);

            controller.wordMove(true, true);
            controller.setCaretEnabled(caretmode);
            return String.match(selection, /\w*/)[0];
        }
        return util.domToString(range);
    },

    /**
     * Returns true if a scripts are allowed to focus the given input
     * element or input elements in the given window.
     *
     * @param {Node|Window}
     * @returns {boolean}
     */
    focusAllowed: function (elem) {
        let win = elem.ownerDocument && elem.ownerDocument.defaultView || elem;
        return !options["strictfocus"] || win.dactylFocusAllowed;
    },

    /**
     * Focuses the given element. In contrast to a simple
     * elem.focus() call, this function works for iframes and
     * image maps.
     *
     * @param {Node} elem The element to focus.
     */
    focusElement: function (elem) {
        let win = elem.ownerDocument && elem.ownerDocument.defaultView || elem;
        win.dactylFocusAllowed = true;

        if (isinstance(elem, [HTMLFrameElement, HTMLIFrameElement]))
            elem.contentWindow.focus();
        else if (elem instanceof HTMLInputElement && elem.type == "file") {
            Buffer.openUploadPrompt(elem);
            buffer.lastInputField = elem;
        }
        else {
            elem.focus();

            // for imagemap
            if (elem instanceof HTMLAreaElement) {
                try {
                    let [x, y] = elem.getAttribute("coords").split(",").map(parseFloat);

                    elem.dispatchEvent(events.create(elem.ownerDocument, "mouseover", { screenX: x, screenY: y }));
                }
                catch (e) {}
            }
        }
    },

    /**
     * Find the counth last link on a page matching one of the given
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
     * @param {string} path The XPath to use for the search. @optional
     */
    followDocumentRelationship: deprecated("Please use buffer.findLink instead",
        function followDocumentRelationship(rel) {
            this.findLink(rel, options[rel + "pattern"], 0, true);
        }),
    findLink: function (rel, regexps, count, follow, path) {
        path = path || options.get("hinttags").defaultValue;

        function followFrame(frame) {
            function iter(elems) {
                for (let i = 0; i < elems.length; i++)
                    if (elems[i].rel.toLowerCase() === rel || elems[i].rev.toLowerCase() === rel)
                        yield elems[i];
            }

            // <link>s have higher priority than normal <a> hrefs
            let elems = frame.document.getElementsByTagName("link");
            for (let elem in iter(elems))
                yield elem;

            // no links? ok, look for hrefs
            elems = frame.document.getElementsByTagName("a");
            for (let elem in iter(elems))
                yield elem;

            let res = util.evaluateXPath(path, frame.document);
            for (let regex in values(regexps)) {
                for (let i in util.range(res.snapshotLength, 0, -1)) {
                    let elem = res.snapshotItem(i);
                    if (regex.test(elem.textContent) === regex.result || regex.test(elem.title) === regex.result ||
                            Array.some(elem.childNodes, function (child) regex.test(child.alt) === regex.result))
                        yield elem;
                }
            }
        }

        for (let frame in values(buffer.allFrames(null, true)))
            for (let elem in followFrame(frame))
                if (count-- === 0) {
                    if (follow)
                        buffer.followLink(elem, dactyl.CURRENT_TAB);
                    return elem;
                }

        if (follow)
            dactyl.beep();
    },

    /**
     * Fakes a click on a link.
     *
     * @param {Node} elem The element to click.
     * @param {number} where Where to open the link. See
     *     {@link dactyl.open}.
     */
    followLink: function (elem, where) {
        let doc = elem.ownerDocument;
        let view = doc.defaultView;
        let offsetX = 1;
        let offsetY = 1;

        if (isinstance(elem, [HTMLFrameElement, HTMLIFrameElement]))
            return buffer.focusElement(elem);
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
        default:
            dactyl.log("Invalid where argument for followLink()", 0);
        }

        buffer.focusElement(elem);

        prefs.withContext(function () {
            prefs.set("browser.tabs.loadInBackground", true);
            ["mousedown", "mouseup", "click"].forEach(function (event) {
                elem.dispatchEvent(events.create(doc, event, {
                    screenX: offsetX, screenY: offsetY,
                    ctrlKey: ctrlKey, shiftKey: shiftKey, metaKey: ctrlKey
                }));
            });
        });
    },

    /**
     * @property {nsISelectionController} The current document's selection
     *     controller.
     */
    get selectionController() config.browser.docShell
            .QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsISelectionDisplay)
            .QueryInterface(Ci.nsISelectionController),

    /**
     * Opens the appropriate context menu for <b>elem</b>.
     *
     * @param {Node} elem The context element.
     */
    openContextMenu: function (elem) {
        document.popupNode = elem;
        let menu = document.getElementById("contentAreaContextMenu");
        menu.showPopup(elem, -1, -1, "context", "bottomleft", "topleft");
    },

    /**
     * Saves a page link to disk.
     *
     * @param {HTMLAnchorElement} elem The page link to save.
     * @param {boolean} skipPrompt Whether to open the "Save Link As..."
     *     dialog.
     */
    saveLink: function (elem, skipPrompt) {
        let doc  = elem.ownerDocument;
        let url  = window.makeURLAbsolute(elem.baseURI, elem.href);
        let text = elem.textContent;

        try {
            window.urlSecurityCheck(url, doc.nodePrincipal);
            // we always want to save that link relative to the current working directory
            prefs.set("browser.download.lastDir", io.cwd);
            window.saveURL(url, text, null, true, skipPrompt, makeURI(url, doc.characterSet));
        }
        catch (e) {
            dactyl.echoerr(e);
        }
    },

    /**
     * Scrolls to the bottom of the current buffer.
     */
    scrollBottom: function () {
        Buffer.scrollToPercent(null, 100);
    },

    /**
     * Scrolls the buffer laterally <b>cols</b> columns.
     *
     * @param {number} cols The number of columns to scroll. A positive
     *     value scrolls right and a negative value left.
     */
    scrollColumns: function (cols) {
        Buffer.scrollHorizontal(null, "columns", cols);
    },

    /**
     * Scrolls to the top of the current buffer.
     */
    scrollEnd: function () {
        Buffer.scrollToPercent(100, null);
    },

    /**
     * Scrolls the buffer vertically <b>lines</b> rows.
     *
     * @param {number} lines The number of lines to scroll. A positive
     *     value scrolls down and a negative value up.
     */
    scrollLines: function (lines) {
        Buffer.scrollVertical(null, "lines", lines);
    },

    /**
     * Scrolls the buffer vertically <b>pages</b> pages.
     *
     * @param {number} pages The number of pages to scroll. A positive
     *     value scrolls down and a negative value up.
     */
    scrollPages: function (pages) {
        Buffer.scrollVertical(null, "pages", pages);
    },

    /**
     * Scrolls the buffer vertically 'scroll' lines.
     *
     * @param {boolean} direction The direction to scroll. If true then
     *     scroll up and if false scroll down.
     * @param {number} count The multiple of 'scroll' lines to scroll.
     * @optional
     */
    scrollByScrollSize: function (direction, count) {
        direction = direction ? 1 : -1;
        count = count || 1;
        let win = Buffer.findScrollableWindow();

        if (options["scroll"] > 0)
            this.scrollLines(options["scroll"] * direction);
        else
            this.scrollPages(direction / 2);
    },

    _scrollByScrollSize: function _scrollByScrollSize(count, direction) {
        if (count > 0)
            options["scroll"] = count;
        buffer.scrollByScrollSize(direction);
    },

    /**
     * Scrolls the buffer to the specified screen percentiles.
     *
     * @param {number} x The horizontal page percentile.
     * @param {number} y The vertical page percentile.
     */
    scrollToPercent: function (x, y) {
        Buffer.scrollToPercent(x, y);
    },

    /**
     * Scrolls the buffer to the specified screen pixels.
     *
     * @param {number} x The horizontal pixel.
     * @param {number} y The vertical pixel.
     */
    scrollTo: function (x, y) {
        marks.add("'", true);
        window.content.scrollTo(x, y);
    },

    /**
     * Scrolls the current buffer laterally to its leftmost.
     */
    scrollStart: function () {
        Buffer.scrollToPercent(0, null);
    },

    /**
     * Scrolls the current buffer vertically to the top.
     */
    scrollTop: function () {
        Buffer.scrollToPercent(null, 0);
    },

    // TODO: allow callback for filtering out unwanted frames? User defined?
    /**
     * Shifts the focus to another frame within the buffer. Each buffer
     * contains at least one frame.
     *
     * @param {number} count The number of frames to skip through.
     * @param {boolean} forward The direction of motion.
     */
    shiftFrameFocus: function (count, forward) {
        if (!(window.content.document instanceof HTMLDocument))
            return;

        count = Math.max(count, 1);
        let frames = buffer.allFrames();

        if (frames.length == 0) // currently top is always included
            return;

        // remove all unfocusable frames
        // TODO: find a better way to do this - walking the tree is too slow
        let start = document.commandDispatcher.focusedWindow;
        frames = frames.filter(function (frame) {
            frame.focus();
            return document.commandDispatcher.focusedWindow == frame;
        });
        start.focus();

        // find the currently focused frame index
        // TODO: If the window is a frameset then the first _frame_ should be
        //       focused.  Since this is not the current FF behaviour,
        //       we initialize current to -1 so the first call takes us to the
        //       first frame.
        let current = frames.indexOf(document.commandDispatcher.focusedWindow);

        // calculate the next frame to focus
        let next = current;
        if (forward) {
            next = current + count;

            if (next > frames.length - 1) {
                if (current == frames.length - 1)
                    dactyl.beep();
                next = frames.length - 1; // still allow the frame indicator to be activated
            }
        }
        else {
            next = current - count;

            if (next < 0) {
                if (current == 0)
                    dactyl.beep();
                next = 0; // still allow the frame indicator to be activated
            }
        }

        // focus next frame and scroll into view
        frames[next].focus();
        if (frames[next] != window.content)
            frames[next].frameElement.scrollIntoView(false);

        // add the frame indicator
        let doc = frames[next].document;
        let indicator = util.xmlToDom(<div highlight="FrameIndicator"/>, doc);
        doc.body.appendChild(indicator);

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
    showElementInfo: function (elem) {
        dactyl.echo(<>Element:<br/>{util.objectToString(elem, true)}</>, commandline.FORCE_MULTILINE);
    },

    /**
     * Displays information about the current buffer.
     *
     * @param {boolean} verbose Display more verbose information.
     * @param {string} sections A string limiting the displayed sections.
     * @default The value of 'pageinfo'.
     */
    showPageInfo: function (verbose, sections) {
        // Ctrl-g single line output
        if (!verbose) {
            let file = window.content.document.location.pathname.split("/").pop() || "[No Name]";
            let title = window.content.document.title || "[No Title]";

            let info = template.map("gf",
                function (opt) template.map(buffer.pageInfo[opt][0](), util.identity, ", "),
                ", ");

            if (bookmarks.isBookmarked(this.URL))
                info += ", bookmarked";

            let pageInfoText = <>{file.quote()} [{info}] {title}</>;
            dactyl.echo(pageInfoText, commandline.FORCE_SINGLELINE);
            return;
        }

        let option = sections || options["pageinfo"];
        let list = template.map(option, function (option) {
            let opt = buffer.pageInfo[option];
            return opt ? template.table(opt[1], opt[0](true)) : undefined;
        }, <br/>);
        dactyl.echo(list, commandline.FORCE_MULTILINE);
    },

    /**
     * Opens a viewer to inspect the source of the currently selected
     * range.
     */
    viewSelectionSource: function () {
        // copied (and tuned somebit) from browser.jar -> nsContextMenu.js
        let focusedWindow = document.commandDispatcher.focusedWindow;
        if (focusedWindow == window)
            focusedWindow = buffer.focusedFrame;

        let docCharset = null;
        if (focusedWindow)
            docCharset = "charset=" + focusedWindow.document.characterSet;

        let reference = null;
        reference = focusedWindow.getSelection();

        let docUrl = null;
        window.openDialog("chrome://global/content/viewPartialSource.xul",
                "_blank", "scrollbars,resizable,chrome,dialog=no",
                docUrl, docCharset, reference, "selection");
    },

    /**
     * Opens a viewer to inspect the source of the current buffer or the
     * specified <b>url</b>. Either the default viewer or the configured
     * external editor is used.
     *
     * @param {string} url The URL of the source.
     * @default The current buffer.
     * @param {boolean} useExternalEditor View the source in the external editor.
     */
    viewSource: function (url, useExternalEditor) {
        let doc = buffer.focusedFrame.document;

        if (useExternalEditor)
            this.viewSourceExternally(url || doc);
        else {
            url = url || doc.location.href;
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
    },

    /**
     * Launches an editor to view the source of the given document. The
     * contents of the document are saved to a temporary local file and
     * removed when the editor returns. This function returns
     * immediately.
     *
     * @param {Document} doc The document to view.
     */
    /*
     * Derived from code in Mozilla, ©2005 Jason Barnabe,
     * Tri-licensed under MPL 1.1/GPL 2.0/LGPL 2.1
     * Portions copyright Kris Maglione licensable under the
     * MIT license.
     */
    viewSourceExternally: Class("viewSourceExternally",
        XPCOM([Ci.nsIWebProgressListener, Ci.nsISupportsWeakReference]), {
        init: function (doc, callback) {
            this.callback = callback ||
                function (file) editor.editFileExternally(file.path);

            let url = isString(doc) ? doc : doc.location.href;
            let uri = util.newURI(url, charset);
            let charset = isString(doc) ? null : doc.characterSet;

            if (!isString(doc))
                return io.withTempFiles(function (temp) {
                    let encoder = services.create("htmlEncoder");
                    encoder.init(doc, "text/unicode", encoder.OutputRaw|encoder.OutputPreformatted);
                    temp.write(encoder.encodeToString(), ">");
                    this.callback(temp);
                }, this);

            if (uri.scheme == "file")
                this.callback(File(uri.QueryInterface(Ci.nsIFileURL).file));
            else {
                this.file = io.createTempFile();
                var webBrowserPersist = Cc["@mozilla.org/embedding/browser/nsWebBrowserPersist;1"]
                        .createInstance(Ci.nsIWebBrowserPersist);
                webBrowserPersist.persistFlags = webBrowserPersist.PERSIST_FLAGS_REPLACE_EXISTING_FILES;
                webBrowserPersist.progressListener = this;
                webBrowserPersist.saveURI(uri, null, null, null, null, this.file);
            }
            return null;
        },

        onStateChange: function (progress, request, flag, status) {
            if ((flag & Ci.nsIWebProgressListener.STATE_STOP) && status == 0) {
                try {
                    this.callback(this.file);
                }
                finally {
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
    zoomIn: function (steps, fullZoom) {
        Buffer.bumpZoomLevel(steps, fullZoom);
    },

    /**
     * Decreases the zoom level of the current buffer.
     *
     * @param {number} steps The number of zoom levels to jump.
     * @param {boolean} fullZoom Whether to use full zoom or text zoom.
     */
    zoomOut: function (steps, fullZoom) {
        Buffer.bumpZoomLevel(-steps, fullZoom);
    }
}, {
    ZOOM_MIN: "ZoomManager" in window && Math.round(ZoomManager.MIN * 100),
    ZOOM_MAX: "ZoomManager" in window && Math.round(ZoomManager.MAX * 100),

    setZoom: function setZoom(value, fullZoom) {
        dactyl.assert(value >= Buffer.ZOOM_MIN || value <= Buffer.ZOOM_MAX,
            "Zoom value out of range (" + Buffer.ZOOM_MIN + " - " + Buffer.ZOOM_MAX + "%)");

        if (fullZoom !== undefined)
            ZoomManager.useFullZoom = fullZoom;
        try {
            ZoomManager.zoom = value / 100;
        }
        catch (e if e == Cr.NS_ERROR_ILLEGAL_VALUE) {
            return dactyl.echoerr("Illegal value");
        }

        if ("FullZoom" in window)
            FullZoom._applySettingToPref();

        statusline.updateZoomLevel(value, ZoomManager.useFullZoom);
    },

    bumpZoomLevel: function bumpZoomLevel(steps, fullZoom) {
        if (fullZoom === undefined)
            fullZoom = ZoomManager.useFullZoom;

        let values = ZoomManager.zoomValues;
        let cur = values.indexOf(ZoomManager.snap(ZoomManager.zoom));
        let i = Math.constrain(cur + steps, 0, values.length - 1);

        if (i == cur && fullZoom == ZoomManager.useFullZoom)
            dactyl.beep();

        Buffer.setZoom(Math.round(values[i] * 100), fullZoom);
    },

    findScrollableWindow: function findScrollableWindow() {
        win = window.document.commandDispatcher.focusedWindow;
        if (win && (win.scrollMaxX > 0 || win.scrollMaxY > 0))
            return win;

        let win = buffer.focusedFrame;
        if (win && (win.scrollMaxX > 0 || win.scrollMaxY > 0))
            return win;

        win = window.content;
        if (win.scrollMaxX > 0 || win.scrollMaxY > 0)
            return win;

        for (let frame in array.iterValues(win.frames))
            if (frame.scrollMaxX > 0 || frame.scrollMaxY > 0)
                return frame;

        return win;
    },

    findScrollable: function findScrollable(dir, horizontal) {
        let pos = "scrollTop", size = "clientHeight", max = "scrollHeight", layoutSize = "offsetHeight",
            overflow = "overflowX", border1 = "borderTopWidth", border2 = "borderBottomWidth";
        if (horizontal)
            pos = "scrollLeft", size = "clientWidth", max = "scrollWidth", layoutSize = "offsetWidth",
            overflow = "overflowX", border1 = "borderLeftWidth", border2 = "borderRightWidth";

        function find(elem) {
            for (; elem && elem.parentNode instanceof Element; elem = elem.parentNode) {
                let style = util.computedStyle(elem);
                let borderSize = parseInt(style[border1]) + parseInt(style[border2]);
                let realSize = elem[size];
                // Stupid Gecko eccentricities. May fail for quirks mode documents.
                if (elem[size] + borderSize == elem[max] || elem[size] == 0) // Stupid, fallible heuristic.
                    continue;
                if (style[overflow] == "hidden")
                    realSize += borderSize;
                if (dir < 0 && elem[pos] > 0 || dir > 0 && elem[pos] + realSize < elem[max])
                    break;
            }
            return elem;
        }

        if (buffer.focusedFrame.getSelection().rangeCount)
            var elem = find(buffer.focusedFrame.getSelection().getRangeAt(0).startContainer);
        if (!(elem instanceof Element)) {
            let doc = Buffer.findScrollableWindow().document;
            elem = find(doc.body || doc.getElementsByTagName("body")[0] ||
                        doc.documentElement);
        }
        return elem;
    },

    scrollVertical: function scrollVertical(elem, increment, number) {
        elem = elem || Buffer.findScrollable(number, false);
        let fontSize = parseInt(util.computedStyle(elem).fontSize);
        if (increment == "lines")
            increment = fontSize;
        else if (increment == "pages")
            increment = elem.clientHeight - fontSize;
        else
            throw Error();

        if (number < 0 ? elem.scrollTop > 0 : elem.scrollTop < elem.scrollHeight - elem.clientHeight)
            elem.scrollTop += number * increment;
        else
            dactyl.beep();
    },

    scrollHorizontal: function scrollHorizontal(elem, increment, number) {
        elem = elem || Buffer.findScrollable(number, true);
        let fontSize = parseInt(util.computedStyle(elem).fontSize);
        if (increment == "columns")
            increment = fontSize; // Good enough, I suppose.
        else if (increment == "pages")
            increment = elem.clientWidth - fontSize;
        else
            throw Error();

        if (number < 0 ? elem.scrollLeft > 0 : elem.scrollLeft < elem.scrollWidth - elem.clientWidth)
            elem.scrollLeft += number * increment;
        else
            dactyl.beep();
    },

    scrollElemToPercent: function scrollElemToPercent(elem, horizontal, vertical) {
        elem = elem || Buffer.findScrollable();
        marks.add("'", true);

        if (horizontal != null)
            elem.scrollLeft = (elem.scrollWidth - elem.clientWidth) * (horizontal / 100);

        if (vertical != null)
            elem.scrollTop = (elem.scrollHeight - elem.clientHeight) * (vertical / 100);
    },

    scrollToPercent: function scrollToPercent(horizontal, vertical) {
        let win = Buffer.findScrollableWindow();
        let h, v;

        if (horizontal == null)
            h = win.scrollX;
        else
            h = win.scrollMaxX / 100 * horizontal;

        if (vertical == null)
            v = win.scrollY;
        else
            v = win.scrollMaxY / 100 * vertical;

        marks.add("'", true);
        win.scrollTo(h, v);
    },

    openUploadPrompt: function openUploadPrompt(elem) {
        commandline.input("Upload file: ", function (path) {
            let file = io.File(path);
            dactyl.assert(file.exists());

            elem.value = file.path;
        }, {
            completer: completion.file,
            default: elem.value
        });
    }
}, {
    commands: function () {
        commands.add(["frameo[nly]"],
            "Show only the current frame's page",
            function (args) {
                dactyl.open(buffer.focusedFrame.document.documentURI);
            },
            { argCount: "0" });

        commands.add(["ha[rdcopy]"],
            "Print current document",
            function (args) {
                let arg = args[0];

                // FIXME: arg handling is a bit of a mess, check for filename
                dactyl.assert(!arg || arg[0] == ">" && !util.isOS("WINNT"),
                    "E488: Trailing characters");

                prefs.withContext(function () {
                    if (arg) {
                        prefs.set("print.print_to_file", "true");
                        prefs.set("print.print_to_filename", io.File(arg.substr(1)).path);
                        dactyl.echomsg("Printing to file: " + arg.substr(1));
                    }
                    else
                        dactyl.echomsg("Sending to printer...");

                    prefs.set("print.always_print_silent", args.bang);
                    prefs.set("print.show_print_progress", !args.bang);

                    config.browser.contentWindow.print();
                });

                if (arg)
                    dactyl.echomsg("Printed: " + arg.substr(1));
                else
                    dactyl.echomsg("Print job sent.");
            },
            {
                argCount: "?",
                bang: true,
                literal: 0
            });

        commands.add(["pa[geinfo]"],
            "Show various page information",
            function (args) { buffer.showPageInfo(true, args[0]); },
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
                    "E475: Invalid argument: " + arg);

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
                let doc = window.content.document;
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
                        dactyl.assert(args.bang || file.exists() && file.isWritable(), file.path.quote() + ": E212: Can't open file for writing");
                        return buffer.viewSourceExternally(buffer.focusedFrame.document,
                            function (tmpFile) {
                                try {
                                    file.write(tmpFile, ">>");
                                }
                                catch (e) {
                                    dactyl.echoerr(file.path.quote() + ": E212: Can't open file for writing");
                                }
                            });
                    }

                    let file = io.File(filename);

                    dactyl.assert(!file.exists() || args.bang,
                                  "E13: File exists (add ! to override)");

                    chosenData = { file: file, uri: window.makeURI(doc.location.href, doc.characterSet) };
                }

                // if browser.download.useDownloadDir = false then the "Save As"
                // dialog is used with this as the default directory
                // TODO: if we're going to do this shouldn't it be done in setCWD or the value restored?
                prefs.set("browser.download.lastDir", io.cwd);

                try {
                    var contentDisposition = window.content.QueryInterface(Ci.nsIInterfaceRequestor)
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
                    return completion.file(context)
                },
                literal: 0
            });

        commands.add(["st[op]"],
            "Stop loading the current web page",
            function () { tabs.stop(config.browser.mCurrentTab); },
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
                    level = this.zoomLevel + parseInt(arg, 10);
                    // relative args shouldn't take us out of range
                    level = Math.constrain(level, Buffer.ZOOM_MIN, Buffer.ZOOM_MAX);
                }
                else
                    dactyl.assert(false, "E488: Trailing characters");

                Buffer.setZoom(level, args.bang);
            },
            {
                argCount: "?",
                bang: true
            });
    },
    completion: function () {
        completion.alternateStyleSheet = function alternateStylesheet(context) {
            context.title = ["Stylesheet", "Location"];

            // unify split style sheets
            let styles = array.toObject([[s.title, []] for (s in values(buffer.alternateStyleSheets))]);

            buffer.alternateStyleSheets.forEach(function (style) {
                styles[style.title].push(style.href || "inline");
            });

            context.completions = [[title, href.join(", ")] for ([title, href] in Iterator(styles))];
        };

        completion.buffer = function buffer(context) {
            let filter = context.filter.toLowerCase();
            let defItem = { parent: { getTitle: function () "" } };
            let tabGroups = {};
            tabs.getGroups();
            tabs.allTabs.forEach(function (tab, i) {
                let group = (tab.tabItem || defItem).parent || defItem.parent;
                if (!set.has(tabGroups, group.id))
                    tabGroups[group.id] = [group.getTitle(), []];
                group = tabGroups[group.id];
                group[1].push([i, tab.linkedBrowser]);
            });

            context.pushProcessor(0, function (item, text, next) <>
                <span highlight="Indicator" style="display: inline-block;">{item.item.indicator}</span>
                { next.call(this, item, text) }
            </>);
            context.process[1] = function (item, text) template.bookmarkDescription(item, template.highlightFilter(text, this.filter));

            context.anchored = false;
            context.keys = { text: "text", description: "url", icon: "icon", id: "id", command: function () "tabs.select" };
            context.compare = CompletionContext.Sort.number;
            context.filters = [CompletionContext.Filter.textDescription];

            for (let [id, vals] in Iterator(tabGroups))
                context.fork(id, 0, this, function (context, [name, browsers]) {
                    context.title = [name || "Buffers"];
                    context.generate = function ()
                        util.map(array.iterValues(browsers), function ([i, browser]) {
                            let indicator = " ";
                            if (i == tabs.index())
                               indicator = "%"
                            else if (i == tabs.index(tabs.alternate))
                               indicator = "#";

                            let tab = tabs.getTab(i);
                            let url = browser.contentDocument.location.href;
                            i = i + 1;

                            return {
                                text: [i + ": " + (tab.label || "(Untitled)"), i + ": " + url],
                                id: i - 1,
                                url: url,
                                indicator: indicator,
                                icon: tab.image || DEFAULT_FAVICON
                            };
                        });
                }, vals);
        };
    },
    events: function () {
        try {
            config.browser.removeProgressListener(window.XULBrowserWindow);
        }
        catch (e) {} // Why? --djk

        // I hate this whole hack. --Kris
        let obj = window.XULBrowserWindow, getter;
        for (let p in properties(obj))
            if ((getter = obj.__lookupGetter__(p)) && !obj.__lookupSetter__(p)) {
                this.progressListener.__defineGetter__(p, getter);
                delete obj[p];
            }

        config.browser.addProgressListener(this.progressListener, Ci.nsIWebProgress.NOTIFY_ALL);
        window.XULBrowserWindow = this.progressListener;
        window.QueryInterface(Ci.nsIInterfaceRequestor)
              .getInterface(Ci.nsIWebNavigation)
              .QueryInterface(Ci.nsIDocShellTreeItem)
              .treeOwner
              .QueryInterface(Ci.nsIInterfaceRequestor)
              .getInterface(Ci.nsIXULWindow)
              .XULBrowserWindow = this.progressListener;

        let appContent = document.getElementById("appcontent");
        if (appContent) {
            events.addSessionListener(appContent, "DOMContentLoaded", this.closure.onDOMContentLoaded, true);
            events.addSessionListener(appContent, "load", this.closure.onPageLoad, true);
            events.addSessionListener(appContent, "scroll", this.closure._updateBufferPosition, false);
        }
    },
    mappings: function () {
        var myModes = config.browserModes;

        mappings.add(myModes, ["."],
            "Repeat the last key event",
            function (count) {
                if (mappings.repeat) {
                    for (let i in util.interruptibleRange(0, Math.max(count, 1), 100))
                        mappings.repeat();
                }
            },
            { count: true });

        mappings.add(myModes, ["i", "<Insert>"],
            "Start caret mode",
            function () { modes.push(modes.CARET); });

        mappings.add(myModes, ["<C-c>"],
            "Stop loading the current web page",
            function () { tabs.stop(config.browser.mCurrentTab); });

        // scrolling
        mappings.add(myModes, ["j", "<Down>", "<C-e>"],
            "Scroll document down",
            function (count) { buffer.scrollLines(Math.max(count, 1)); },
            { count: true });

        mappings.add(myModes, ["k", "<Up>", "<C-y>"],
            "Scroll document up",
            function (count) { buffer.scrollLines(-Math.max(count, 1)); },
            { count: true });

        mappings.add(myModes, dactyl.has("mail") ? ["h"] : ["h", "<Left>"],
            "Scroll document to the left",
            function (count) { buffer.scrollColumns(-Math.max(count, 1)); },
            { count: true });

        mappings.add(myModes, dactyl.has("mail") ? ["l"] : ["l", "<Right>"],
            "Scroll document to the right",
            function (count) { buffer.scrollColumns(Math.max(count, 1)); },
            { count: true });

        mappings.add(myModes, ["0", "^"],
            "Scroll to the absolute left of the document",
            function () { buffer.scrollStart(); });

        mappings.add(myModes, ["$"],
            "Scroll to the absolute right of the document",
            function () { buffer.scrollEnd(); });

        mappings.add(myModes, ["gg", "<Home>"],
            "Go to the top of the document",
            function (count) { buffer.scrollToPercent(buffer.scrollXPercent, Math.max(count, 0)); },
            { count: true });

        mappings.add(myModes, ["G", "<End>"],
            "Go to the end of the document",
            function (count) { buffer.scrollToPercent(buffer.scrollXPercent, count != null ? count : 100); },
            { count: true });

        mappings.add(myModes, ["%"],
            "Scroll to {count} percent of the document",
            function (count) {
                dactyl.assert(count > 0 && count <= 100);
                buffer.scrollToPercent(buffer.scrollXPercent, count);
            },
            { count: true });

        mappings.add(myModes, ["<C-d>"],
            "Scroll window downwards in the buffer",
            function (count) { buffer._scrollByScrollSize(count, true); },
            { count: true });

        mappings.add(myModes, ["<C-u>"],
            "Scroll window upwards in the buffer",
            function (count) { buffer._scrollByScrollSize(count, false); },
            { count: true });

        mappings.add(myModes, ["<C-b>", "<PageUp>", "<S-Space>"],
            "Scroll up a full page",
            function (count) { buffer.scrollPages(-Math.max(count, 1)); },
            { count: true });

        mappings.add(myModes, ["<C-f>", "<PageDown>", "<Space>"],
            "Scroll down a full page",
            function (count) { buffer.scrollPages(Math.max(count, 1)); },
            { count: true });

        mappings.add(myModes, ["]f"],
            "Focus next frame",
            function (count) { buffer.shiftFrameFocus(Math.max(count, 1), true); },
            { count: true });

        mappings.add(myModes, ["[f"],
            "Focus previous frame",
            function (count) { buffer.shiftFrameFocus(Math.max(count, 1), false); },
            { count: true });

        mappings.add(myModes, ["]]"],
            "Follow the link labeled 'next' or '>' if it exists",
            function (count) {
                buffer.findLink("next", options["nextpattern"], (count || 1) - 1, true);
            },
            { count: true });

        mappings.add(myModes, ["[["],
            "Follow the link labeled 'prev', 'previous' or '<' if it exists",
            function (count) {
                buffer.findLink("previous", options["previouspattern"], (count || 1) - 1, true);
            },
            { count: true });

        mappings.add(myModes, ["gf"],
            "Toggle between rendered and source view",
            function () { buffer.viewSource(null, false); });

        mappings.add(myModes, ["gF"],
            "View source with an external editor",
            function () { buffer.viewSource(null, true); });

        mappings.add(myModes, ["gi"],
            "Focus last used input field",
            function (count) {
                let elem = buffer.lastInputField;

                if (count >= 1 || !elem || !Events.isContentNode(elem)) {
                    let xpath = ["input", "textarea[not(@disabled) and not(@readonly)]"];

                    let frames = buffer.allFrames(null, true);

                    let elements = array.flatten(frames.map(function (win) [m for (m in util.evaluateXPath(xpath, win.document))]))
                                        .filter(function (elem) {

                        if (elem.readOnly || elem instanceof HTMLInputElement && !set.has(util.editableInputs, elem.type))
                            return false;

                        let computedStyle = util.computedStyle(elem);
                        let rect = elem.getBoundingClientRect();
                        return computedStyle.visibility != "hidden" && computedStyle.display != "none" &&
                            computedStyle.MozUserFocus != "ignore" && rect.width && rect.height;
                    });

                    dactyl.assert(elements.length > 0);
                    elem = elements[Math.constrain(count, 1, elements.length) - 1];
                }
                buffer.focusElement(elem);
                util.scrollIntoView(elem);
            },
            { count: true });

        mappings.add(myModes, ["gP"],
            "Open (put) a URL based on the current clipboard contents in a new buffer",
            function () {
                let url = dactyl.clipboardRead();
                dactyl.assert(url, "No clipboard data");
                dactyl.open(url, { from: "paste", where: dactyl.NEW_TAB, background: true });
            });

        mappings.add(myModes, ["p", "<MiddleMouse>"],
            "Open (put) a URL based on the current clipboard contents in the current buffer",
            function () {
                let url = dactyl.clipboardRead();
                dactyl.assert(url, "No clipboard data");
                dactyl.open(url);
            });

        mappings.add(myModes, ["P"],
            "Open (put) a URL based on the current clipboard contents in a new buffer",
            function () {
                let url = dactyl.clipboardRead();
                dactyl.assert(url, "No clipboard data");
                dactyl.open(url, { from: "paste", where: dactyl.NEW_TAB });
            });

        // reloading
        mappings.add(myModes, ["r"],
            "Reload the current web page",
            function () { tabs.reload(config.browser.mCurrentTab, false); });

        mappings.add(myModes, ["R"],
            "Reload while skipping the cache",
            function () { tabs.reload(config.browser.mCurrentTab, true); });

        // yanking
        mappings.add(myModes, ["Y"],
            "Copy selected text or current word",
            function () {
                let sel = buffer.getCurrentWord();
                dactyl.assert(sel);
                dactyl.clipboardWrite(sel, true);
            });

        // zooming
        mappings.add(myModes, ["zi", "+"],
            "Enlarge text zoom of current web page",
            function (count) { buffer.zoomIn(Math.max(count, 1), false); },
            { count: true });

        mappings.add(myModes, ["zm"],
            "Enlarge text zoom of current web page by a larger amount",
            function (count) { buffer.zoomIn(Math.max(count, 1) * 3, false); },
            { count: true });

        mappings.add(myModes, ["zo", "-"],
            "Reduce text zoom of current web page",
            function (count) { buffer.zoomOut(Math.max(count, 1), false); },
            { count: true });

        mappings.add(myModes, ["zr"],
            "Reduce text zoom of current web page by a larger amount",
            function (count) { buffer.zoomOut(Math.max(count, 1) * 3, false); },
            { count: true });

        mappings.add(myModes, ["zz"],
            "Set text zoom value of current web page",
            function (count) { Buffer.setZoom(count > 1 ? count : 100, false) },
            { count: true });

        mappings.add(myModes, ["ZI", "zI"],
            "Enlarge full zoom of current web page",
            function (count) { buffer.zoomIn(Math.max(count, 1), true); },
            { count: true });

        mappings.add(myModes, ["ZM", "zM"],
            "Enlarge full zoom of current web page by a larger amount",
            function (count) { buffer.zoomIn(Math.max(count, 1) * 3, true); },
            { count: true });

        mappings.add(myModes, ["ZO", "zO"],
            "Reduce full zoom of current web page",
            function (count) { buffer.zoomOut(Math.max(count, 1), true); },
            { count: true });

        mappings.add(myModes, ["ZR", "zR"],
            "Reduce full zoom of current web page by a larger amount",
            function (count) { buffer.zoomOut(Math.max(count, 1) * 3, true); },
            { count: true });

        mappings.add(myModes, ["zZ"],
            "Set full zoom value of current web page",
            function (count) { Buffer.setZoom(count > 1 ? count : 100, true) },
            { count: true });

        // page info
        mappings.add(myModes, ["<C-g>"],
            "Print the current file name",
            function (count) { buffer.showPageInfo(false); },
            { count: true });

        mappings.add(myModes, ["g<C-g>"],
            "Print file information",
            function () { buffer.showPageInfo(true); });
    },
    options: function () {
        options.add(["nextpattern"],
            "Patterns to use when guessing the 'next' page in a document sequence",
            "regexlist", UTF8("'\\bnext\\b',^>$,^(>>|»)$,^(>|»),(>|»)$,'\\bmore\\b'"),
            { regexFlags: "i" });

        options.add(["previouspattern"],
            "Patterns to use when guessing the 'previous' page in a document sequence",
            "regexlist", UTF8("'\\bprev|previous\\b',^<$,^(<<|«)$,^(<|«),(<|«)$"),
            { regexFlags: "i" });

        options.add(["pageinfo", "pa"],
            "Desired info in the :pageinfo output",
            "charlist", "gfm",
            {
                completer: function (context) [[k, v[1]] for ([k, v] in Iterator(buffer.pageInfo))]
            });

        options.add(["scroll", "scr"],
            "Number of lines to scroll with <C-u> and <C-d> commands",
            "number", 0,
            { validator: function (value) value >= 0 });

        options.add(["showstatuslinks", "ssli"],
            "Show the destination of the link under the cursor in the status bar",
            "number", 1,
            {
                completer: function (context) [
                    ["0", "Don't show link destination"],
                    ["1", "Show the link in the status line"],
                    ["2", "Show the link in the command line"]
                ]
            });

        options.add(["usermode", "um"],
            "Show current website with a minimal style sheet to make it easily accessible",
            "boolean", false,
            {
                setter: function (value) config.browser.markupDocumentViewer.authorStyleDisabled = value,
                getter: function () config.browser.markupDocumentViewer.authorStyleDisabled
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
