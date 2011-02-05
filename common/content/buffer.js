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
                    yield (pageSize[1] || pageSize[0]) + " bytes";
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
            // get meta tag data, sort and put into pageMeta[]
            let metaNodes = buffer.focusedFrame.document.getElementsByTagName("meta");

            return Array.map(metaNodes, function (node) [(node.name || node.httpEquiv), template.highlightURL(node.content)])
                        .sort(function (a, b) util.compareIgnoreCase(a[0], b[0]));
        });

        dactyl.commands["buffer.viewSource"] = function (event) {
            let elem = event.originalTarget;
            buffer.viewSource([elem.getAttribute("href"), Number(elem.getAttribute("line"))]);
        };

        this.cleanupProgressListener = util.overlayObject(window.XULBrowserWindow,
                                                          this.progressListener);

        if (dactyl.has("tabs"))
            for (let tab in values(tabs.allTabs))
                if (tab.linkedBrowser.contentDocument.readyState === "complete")
                    dactyl.initDocument(tab.linkedBrowser.contentDocument);
    },

    cleanup: function () {
        this.cleanupProgressListener();
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
            names.push([node.title, "Page Name"]);

        if (node.alt)
            names.push([node.alt, "Alternate Text"]);

        if (!isinstance(node, Document) && node.textContent)
            names.push([node.textContent, "Link Text"]);

        names.push([decodeURIComponent(url.replace(/.*?([^\/]*)\/*$/, "$1")), "File Name"]);

        return names.filter(function ([leaf, title]) leaf)
                    .map(function ([leaf, title]) [leaf.replace(util.OS.illegalCharacters, encodeURIComponent)
                                                       .replace(re, ext), title]);
    },

    _triggerLoadAutocmd: function _triggerLoadAutocmd(name, doc, uri) {
        if (!(uri || doc.location))
            return;

        uri = uri || util.newURI(doc.location.href);
        let args = {
            url: { toString: function () uri.spec, valueOf: function () uri },
            title: doc.title
        };

        if (dactyl.has("tabs")) {
            args.tab = tabs.getContentIndex(doc) + 1;
            args.doc = {
                valueOf: function () doc,
                toString: function () "tabs.getTab(" + (args.tab - 1) + ").linkedBrowser.contentDocument"
            };
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
        if (doc instanceof HTMLDocument)
            this._triggerLoadAutocmd("DOMLoad", doc);
    },

    // TODO: see what can be moved to onDOMContentLoaded()
    // event listener which is is called on each page load, even if the
    // page is loaded in a background tab
    onPageLoad: function onPageLoad(event) {
        let doc = event.originalTarget;
        if (doc instanceof Document)
            dactyl.initDocument(doc);

        if (doc instanceof HTMLDocument) {
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
                    dactyl.echomsg({ domains: [util.getHost(doc.location)], message: "Background tab loaded: " + (doc.title || doc.location.href) }, 3);

                this._triggerLoadAutocmd("PageLoad", doc);
            }
        }
    },

    /**
     * @property {Object} The document loading progress listener.
     */
    progressListener: {
        dactylLoadCount: 0,

        // XXX: function may later be needed to detect a canceled synchronous openURL()
        onStateChange: util.wrapCallback(function onStateChange(webProgress, request, flags, status) {
            onStateChange.superapply(this, arguments);
            // STATE_IS_DOCUMENT | STATE_IS_WINDOW is important, because we also
            // receive statechange events for loading images and other parts of the web page
            if (flags & (Ci.nsIWebProgressListener.STATE_IS_DOCUMENT | Ci.nsIWebProgressListener.STATE_IS_WINDOW)) {
                // This fires when the load event is initiated
                // only thrown for the current tab, not when another tab changes
                if (flags & Ci.nsIWebProgressListener.STATE_START) {
                    statusline.progress = 0;

                    buffer._triggerLoadAutocmd("PageLoadPre", webProgress.DOMWindow.document);

                    if (document.commandDispatcher.focusedWindow == webProgress.DOMWindow && this.dactylLoadCount++)
                        util.timeout(function () { modes.reset(false); },
                                     modes.main == modes.HINTS ? 500 : 0);
                }
                else if (flags & Ci.nsIWebProgressListener.STATE_STOP) {
                    // Workaround for bugs 591425 and 606877, dactyl bug #81
                    config.browser.mCurrentBrowser.collapsed = false;
                    if (!dactyl.focusedElement || dactyl.focusedElement === document.documentElement)
                        dactyl.focusContent();
                    statusline.updateUrl();
                }
            }
        }),
        // for notifying the user about secure web pages
        onSecurityChange: util.wrapCallback(function onSecurityChange(webProgress, request, state) {
            onSecurityChange.superapply(this, arguments);
            if (state & Ci.nsIWebProgressListener.STATE_IS_BROKEN)
                statusline.security = "broken";
            else if (state & Ci.nsIWebProgressListener.STATE_IDENTITY_EV_TOPLEVEL)
                statusline.security = "extended";
            else if (state & Ci.nsIWebProgressListener.STATE_SECURE_HIGH)
                statusline.security = "secure";
            else // if (state & Ci.nsIWebProgressListener.STATE_IS_INSECURE)
                statusline.security = "insecure";
            if (webProgress && webProgress.DOMWindow)
                webProgress.DOMWindow.document.dactylSecurity = statusline.security;
        }),
        onStatusChange: util.wrapCallback(function onStatusChange(webProgress, request, status, message) {
            onStatusChange.superapply(this, arguments);
            statusline.updateUrl(message);
        }),
        onProgressChange: util.wrapCallback(function onProgressChange(webProgress, request, curSelfProgress, maxSelfProgress, curTotalProgress, maxTotalProgress) {
            try {
                onProgressChange.superapply(this, arguments);
                if (webProgress && webProgress.DOMWindow)
                    webProgress.DOMWindow.dactylProgress = curTotalProgress / maxTotalProgress;
                statusline.progress = curTotalProgress / maxTotalProgress;
            }
            catch (e) {
                util.reportError(e);
            }
        }),
        // happens when the users switches tabs
        onLocationChange: util.wrapCallback(function onLocationChange(webProgress, request, uri) {
            onLocationChange.superapply(this, arguments);

            delete contexts.groups;

            statusline.updateUrl();
            statusline.progress = "";

            let win = webProgress.DOMWindow;
            if (win && uri) {
                statusline.progress = win.dactylProgress;

                let oldURI = webProgress.document.dactylURI;
                if (webProgress.document.dactylLoadIdx === webProgress.loadedTransIndex
                    || !oldURI || uri.spec.replace(/#.*/, "") !== oldURI.replace(/#.*/, ""))
                    for (let frame in values(buffer.allFrames(win)))
                        frame.document.dactylFocusAllowed = false;
                webProgress.document.dactylURI = uri.spec;
                webProgress.document.dactylLoadIdx = webProgress.loadedTransIndex;
            }

            // Workaround for bugs 591425 and 606877, dactyl bug #81
            let collapse = uri && uri.scheme === "dactyl" && webProgress.isLoadingDocument;
            if (collapse)
                dactyl.focus(document.documentElement);
            config.browser.mCurrentBrowser.collapsed = collapse;

            util.timeout(function () {
                buffer._triggerLoadAutocmd("LocationChange",
                                           (win || content).document,
                                           uri);
            });

            // if this is not delayed we get the position of the old buffer
            util.timeout(function () {
                statusline.updateBufferPosition();
                statusline.updateZoomLevel();
                if (loaded.commandline)
                    commandline.clear();
            }, 500);
        }),
        // called at the very end of a page load
        asyncUpdateUI: util.wrapCallback(function asyncUpdateUI() {
            asyncUpdateUI.superapply(this, arguments);
            util.timeout(function () { statusline.updateUrl(); }, 100);
        }),
        setOverLink: util.wrapCallback(function setOverLink(link, b) {
            setOverLink.superapply(this, arguments);
            switch (options["showstatuslinks"]) {
            case "status":
                statusline.updateUrl(link ? "Link: " + link : null);
                break;
            case "command":
                if (link)
                    dactyl.echo("Link: " + link, commandline.DISALLOW_MULTILINE);
                else
                    commandline.clear();
                break;
            }
        }),
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
        return field && field.ownerDocument == field.ownerDocument.defaultView.document ? field : null;
    },
    set lastInputField(value) { this.localStore.lastInputField = value && Cu.getWeakReference(value); },

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
        this.pageInfo[option] = [func, title]; // TODO: are these reversed intentionally? --djk
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
    getCurrentWord: function (win) {
        let selection = win.getSelection();
        if (selection.rangeCount == 0)
            return "";

        let range = selection.getRangeAt(0).cloneRange();
        if (range.collapsed) {
            let re = options.get("iskeyword").regexp;
            util.dump(String.quote(range));
            Editor.extendRange(range, true,  re, true);
            util.dump(String.quote(range));
            Editor.extendRange(range, false, re, true);
            util.dump(String.quote(range) + "\n\n\n");
        }
        return util.domToString(range);
    },

    get currentWord() this.getCurrentWord(this.focusedFrame),

    /**
     * Returns true if a scripts are allowed to focus the given input
     * element or input elements in the given window.
     *
     * @param {Node|Window}
     * @returns {boolean}
     */
    focusAllowed: function (elem) {
        if (elem instanceof Window && !Editor.getEditor(elem))
            return true;
        let doc = elem.ownerDocument || elem.document || elem;
        return !options["strictfocus"] || doc.dactylFocusAllowed;
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
    followDocumentRelationship: deprecated("buffer.findLink",
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
            for (let regexp in values(regexps)) {
                for (let i in util.range(res.snapshotLength, 0, -1)) {
                    let elem = res.snapshotItem(i);
                    if (regexp.test(elem.textContent) === regexp.result || regexp.test(elem.title) === regexp.result ||
                            Array.some(elem.childNodes, function (child) regexp.test(child.alt) === regexp.result))
                        yield elem;
                }
            }
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
        default:
            dactyl.log("Invalid where argument for followLink()", 0);
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
        });
    },

    /**
     * @property {nsISelectionController} The current document's selection
     *     controller.
     */
    get selectionController() config.browser.docShell
            .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsISelectionDisplay)
            .QueryInterface(Ci.nsISelectionController),

    /**
     * Opens the appropriate context menu for *elem*.
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
     */
    saveLink: function (elem) {
        let doc      = elem.ownerDocument;
        let uri      = util.newURI(elem.href || elem.src, null, util.newURI(elem.baseURI));
        let referrer = util.newURI(doc.documentURI, doc.characterSet);

        try {
            window.urlSecurityCheck(uri.spec, doc.nodePrincipal);

            io.CommandFileMode("Save link: ", {
                onSubmit: function (path) {
                    let file = io.File(path);
                    if (file.exists() && file.isDirectory())
                        file.append(buffer.getDefaultNames(elem)[0][0]);

                    try {
                        if (!file.exists())
                            file.create(File.NORMAL_FILE_TYPE, octal(644));
                    }
                    catch (e) {
                        util.assert(false, "Invalid destination: " + e.name);
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
    saveURI: function (uri, file, callback, self) {
        var persist = services.Persist();
        persist.persistFlags = persist.PERSIST_FLAGS_FROM_CACHE
                             | persist.PERSIST_FLAGS_REPLACE_EXISTING_FILES;

        let downloadListener = new window.DownloadListener(window,
                services.Transfer(uri, services.io.newFileURI(file), "",
                                  null, null, null, persist));

        persist.progressListener = update(Object.create(downloadListener), {
            onStateChange: function onStateChange(progress, request, flag, status) {
                if (callback && (flag & Ci.nsIWebProgressListener.STATE_STOP) && status == 0)
                    dactyl.trapErrors(callback, self, uri, file, progress, request, flag, status);

                return onStateChange.superapply(this, arguments);
            }
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
    scrollByScrollSize: function (direction, count) {
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
            while (!(elem instanceof Element) && elem.parentNode)
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
        return elem || doc.body || doc.documentElement;
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

    // TODO: allow callback for filtering out unwanted frames? User defined?
    /**
     * Shifts the focus to another frame within the buffer. Each buffer
     * contains at least one frame.
     *
     * @param {number} count The number of frames to skip through.  A negative
     *     count skips backwards.
     */
    shiftFrameFocus: function (count) {
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
            let file = content.location.pathname.split("/").pop() || "[No Name]";
            let title = content.document.title || "[No Title]";

            let info = template.map("gf",
                function (opt) template.map(buffer.pageInfo[opt][0](), util.identity, ", "),
                ", ");

            if (bookmarkcache.isBookmarked(this.URL))
                info += ", bookmarked";

            let pageInfoText = <>{file.quote()} [{info}] {title}</>;
            dactyl.echo(pageInfoText, commandline.FORCE_SINGLELINE);
            return;
        }

        let list = template.map(sections || options["pageinfo"], function (option) {
            let [data, title] = buffer.pageInfo[option];
            return template.table(title, data(true));
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
    viewSelectionSource: function () {
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
     * @param {string} url The URL of the source.
     * @default The current buffer.
     * @param {boolean} useExternalEditor View the source in the external editor.
     */
    viewSource: function (url, useExternalEditor) {
        let doc = this.focusedFrame.document;

        if (isArray(url)) {
            if (options.get("editor").has("line"))
                this.viewSourceExternally(url[0] || doc, url[1]);
            else
                window.openDialog("chrome://global/content/viewSource.xul",
                                  "_blank", "all,dialog=no",
                                  url[0], null, null, url[1]);
        }
        else {
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
    viewSourceExternally: Class("viewSourceExternally",
        XPCOM([Ci.nsIWebProgressListener, Ci.nsISupportsWeakReference]), {
        init: function (doc, callback) {
            this.callback = callable(callback) ? callback :
                function (file, temp) {
                    editor.editFileExternally({ file: file.path, line: callback },
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

        onStateChange: function (progress, request, flag, status) {
            if ((flag & this.STATE_STOP) && status == 0) {
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
    zoomIn: function (steps, fullZoom) {
        this.bumpZoomLevel(steps, fullZoom);
    },

    /**
     * Decreases the zoom level of the current buffer.
     *
     * @param {number} steps The number of zoom levels to jump.
     * @param {boolean} fullZoom Whether to use full zoom or text zoom.
     */
    zoomOut: function (steps, fullZoom) {
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
            "Zoom value out of range (" + Buffer.ZOOM_MIN + " - " + Buffer.ZOOM_MAX + "%)");

        if (fullZoom !== undefined)
            ZoomManager.useFullZoom = fullZoom;
        try {
            ZoomManager.zoom = value / 100;
        }
        catch (e if e == Cr.NS_ERROR_ILLEGAL_VALUE) {
            return dactyl.echoerr("Illegal zoom value"); // XXX
        }

        if ("FullZoom" in window)
            FullZoom._applySettingToPref();

        statusline.updateZoomLevel(value, ZoomManager.useFullZoom);
    },

    /**
     * Adjusts the page zoom of the current buffer relative to the
     * current zoom level.
     *
     * @param {number} steps The integral number of natural fractions by
     *   which to adjust the current page zoom. If positive, the zoom
     *   level is increased, if negative it is decreased.
     * @param {boolean} fullZoom If true, zoom all content of the page,
     *   including raster images. If false, zoom only text. If omitted,
     *   use the current zoom function. @optional
     * @throws {FailedAssertion} if the buffer's zoom level is already
     *  at its extreme in the given direction.
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

    getAllFrames: deprecated("buffer.allFrames", function getAllFrames() buffer.getAllFrames.apply(buffer, arguments)),
    scrollTop: deprecated("buffer.scrollToPercent", function scrollTop() buffer.scrollToPercent(null, 0)),
    scrollBottom: deprecated("buffer.scrollToPercent", function scrollBottom() buffer.scrollToPercent(null, 100)),
    scrollStart: deprecated("buffer.scrollToPercent", function scrollStart() buffer.scrollToPercent(0, null)),
    scrollEnd: deprecated("buffer.scrollToPercent", function scrollEnd() buffer.scrollToPercent(100, null)),
    scrollColumns: deprecated("buffer.scrollHorizontal", function scrollColumns(cols) buffer.scrollHorizontal("columns", cols)),
    scrollPages: deprecated("buffer.scrollHorizontal", function scrollPages(pages) buffer.scrollVertical("pages", pages)),
    scrollTo: deprecated("Buffer.scrollTo", function scrollTo(x, y) content.scrollTo(x, y)),
    textZoom: deprecated("buffer.zoomValue and buffer.fullZoom", function textZoom() config.browser.markupDocumentViewer.textZoom * 100)
}, {
    ZOOM_MIN: Class.memoize(function () prefs.get("zoom.minPercent")),
    ZOOM_MAX: Class.memoize(function () prefs.get("zoom.maxPercent")),

    setZoom: deprecated("buffer.setZoom", function setZoom() buffer.setZoom.apply(buffer, arguments)),
    bumpZoomLevel: deprecated("buffer.bumpZoomLevel", function bumpZoomLevel() buffer.bumpZoomLevel.apply(buffer, arguments)),

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

        let left = elem.dactylScrollDestX !== undefined ? elem.dactylScrollDestX : elem.scrollLeft;
        elem.dactylScrollDestX = undefined;

        dactyl.assert(number < 0 ? left > 0 : left < elem.scrollWidth - elem.clientWidth);
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

        let top = elem.dactylScrollDestY !== undefined ? elem.dactylScrollDestY : elem.scrollTop;
        elem.dactylScrollDestY = undefined;

        dactyl.assert(number < 0 ? top > 0 : top < elem.scrollHeight - elem.clientHeight);
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
        io.CommandFileMode("Upload file: ", {
            onSubmit: function (path) {
                let file = io.File(path);
                dactyl.assert(file.exists());

                elem.value = file.path;
                events.dispatch(elem, events.create(elem.ownerDocument, "change", {}));
            }
        }).open(elem.value);
    }
}, {
    commands: function () {
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
            function (args) {
                let arg = args[0];
                let opt = options.get("pageinfo");

                dactyl.assert(!arg || opt.validator(opt.parse(arg)), "E475: Invalid argument: " + arg);
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

                    let file = io.File(filename.replace(RegExp(File.PATH_SEP + "*$"), ""));

                    if (filename.substr(-1) === File.PATH_SEP || file.exists() && file.isDirectory())
                        file.append(buffer.getDefaultNames(doc)[0][0]);

                    dactyl.assert(args.bang || !file.exists(), "E13: File exists (add ! to override)");

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
                    dactyl.assert(false, "E488: Trailing characters");

                buffer.setZoom(level, args.bang);
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
            let styles = iter([s.title, []] for (s in values(buffer.alternateStyleSheets))).toObject();

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
                        Array.map(browsers, function ([i, browser]) {
                            let indicator = " ";
                            if (i == tabs.index())
                                indicator = "%";
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

        completion.savePage = function savePage(context, node) {
            context.fork("generated", context.filter.replace(/[^/]*$/, "").length,
                         this, function (context) {
                context.completions = buffer.getDefaultNames(node);
            });
        };
    },
    events: function () {
        events.addSessionListener(config.browser, "DOMContentLoaded", buffer.closure.onDOMContentLoaded, true);
        events.addSessionListener(config.browser, "load", buffer.closure.onPageLoad, true);
        events.addSessionListener(config.browser, "scroll", buffer.closure._updateBufferPosition, false);
    },
    mappings: function () {
        var myModes = config.browserModes;

        mappings.add(myModes, [".", "<repeat-key>"],
            "Repeat the last key event",
            function (args) {
                if (mappings.repeat) {
                    for (let i in util.interruptibleRange(0, Math.max(args.count, 1), 100))
                        mappings.repeat();
                }
            },
            { count: true });

        mappings.add(myModes, ["i", "<Insert>"],
            "Start caret mode",
            function () { modes.push(modes.CARET); });

        mappings.add(myModes, ["<C-c>"],
            "Stop loading the current web page",
            function () { ex.stop(); });

        // scrolling
        mappings.add(myModes, ["j", "<Down>", "<C-e>", "<scroll-down-line>"],
            "Scroll document down",
            function (args) { buffer.scrollVertical("lines", Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes, ["k", "<Up>", "<C-y>", "<scroll-up-line>"],
            "Scroll document up",
            function (args) { buffer.scrollVertical("lines", -Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes, dactyl.has("mail") ? ["h", "<scroll-left-column>"] : ["h", "<Left>", "<scroll-left-column>"],
            "Scroll document to the left",
            function (args) { buffer.scrollHorizontal("columns", -Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes, dactyl.has("mail") ? ["l", "<scroll-right-column>"] : ["l", "<Right>", "<scroll-right-column>"],
            "Scroll document to the right",
            function (args) { buffer.scrollHorizontal("columns", Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes, ["0", "^", "<scroll-begin>"],
            "Scroll to the absolute left of the document",
            function () { buffer.scrollToPercent(0, null); });

        mappings.add(myModes, ["$", "<scroll-end>"],
            "Scroll to the absolute right of the document",
            function () { buffer.scrollToPercent(100, null); });

        mappings.add(myModes, ["gg", "<Home>"],
            "Go to the top of the document",
            function (args) { buffer.scrollToPercent(null, args.count != null ? args.count : 0); },
            { count: true });

        mappings.add(myModes, ["G", "<End>"],
            "Go to the end of the document",
            function (args) { buffer.scrollToPercent(null, args.count != null ? args.count : 100); },
            { count: true });

        mappings.add(myModes, ["%", "<scroll-percent>"],
            "Scroll to {count} percent of the document",
            function (args) {
                dactyl.assert(args.count > 0 && args.count <= 100);
                buffer.scrollToPercent(null, args.count);
            },
            { count: true });

        mappings.add(myModes, ["<C-d>", "<scroll-down>"],
            "Scroll window downwards in the buffer",
            function (args) { buffer._scrollByScrollSize(args.count, true); },
            { count: true });

        mappings.add(myModes, ["<C-u>", "<scroll-up>"],
            "Scroll window upwards in the buffer",
            function (args) { buffer._scrollByScrollSize(args.count, false); },
            { count: true });

        mappings.add(myModes, ["<C-b>", "<PageUp>", "<S-Space>", "<scroll-page-up>"],
            "Scroll up a full page",
            function (args) { buffer.scrollVertical("pages", -Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes, ["<C-f>", "<PageDown>", "<Space>", "<scroll-page-down>"],
            "Scroll down a full page",
            function (args) { buffer.scrollVertical("pages", Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes, ["]f", "<previous-frame>"],
            "Focus next frame",
            function (args) { buffer.shiftFrameFocus(Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes, ["[f", "<next-frame>"],
            "Focus previous frame",
            function (args) { buffer.shiftFrameFocus(-Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes, ["]]", "<next-page>"],
            "Follow the link labeled 'next' or '>' if it exists",
            function (args) {
                buffer.findLink("next", options["nextpattern"], (args.count || 1) - 1, true);
            },
            { count: true });

        mappings.add(myModes, ["[[", "<previous-page>"],
            "Follow the link labeled 'prev', 'previous' or '<' if it exists",
            function (args) {
                buffer.findLink("previous", options["previouspattern"], (args.count || 1) - 1, true);
            },
            { count: true });

        mappings.add(myModes, ["gf", "<view-source>"],
            "Toggle between rendered and source view",
            function () { buffer.viewSource(null, false); });

        mappings.add(myModes, ["gF", "<view-source-externally>"],
            "View source with an external editor",
            function () { buffer.viewSource(null, true); });

        mappings.add(myModes, ["gi", "<focus-input>"],
            "Focus last used input field",
            function (args) {
                let elem = buffer.lastInputField;

                if (args.count >= 1 || !elem || !events.isContentNode(elem)) {
                    let xpath = ["frame", "iframe", "input", "textarea[not(@disabled) and not(@readonly)]"];

                    let frames = buffer.allFrames(null, true);

                    let elements = array.flatten(frames.map(function (win) [m for (m in util.evaluateXPath(xpath, win.document))]))
                                        .filter(function (elem) {
                        if (isinstance(elem, [HTMLFrameElement, HTMLIFrameElement]))
                            return Editor.getEditor(elem.contentWindow);

                        if (elem.readOnly || elem instanceof HTMLInputElement && !set.has(util.editableInputs, elem.type))
                            return false;

                        let computedStyle = util.computedStyle(elem);
                        let rect = elem.getBoundingClientRect();
                        return computedStyle.visibility != "hidden" && computedStyle.display != "none" &&
                            computedStyle.MozUserFocus != "ignore" && rect.width && rect.height;
                    });

                    dactyl.assert(elements.length > 0);
                    elem = elements[Math.constrain(args.count, 1, elements.length) - 1];
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

        mappings.add(myModes, ["p", "<MiddleMouse>", "<open-clipboard-url>"],
            "Open (put) a URL based on the current clipboard contents in the current buffer",
            function () {
                let url = dactyl.clipboardRead();
                dactyl.assert(url, "No clipboard data");
                dactyl.open(url);
            });

        mappings.add(myModes, ["P", "<tab-open-clipboard-url>"],
            "Open (put) a URL based on the current clipboard contents in a new buffer",
            function () {
                let url = dactyl.clipboardRead();
                dactyl.assert(url, "No clipboard data");
                dactyl.open(url, { from: "paste", where: dactyl.NEW_TAB });
            });

        // reloading
        mappings.add(myModes, ["r", "<reload>"],
            "Reload the current web page",
            function () { tabs.reload(tabs.getTab(), false); });

        mappings.add(myModes, ["R", "<full-reload>"],
            "Reload while skipping the cache",
            function () { tabs.reload(tabs.getTab(), true); });

        // yanking
        mappings.add(myModes, ["Y", "<yank-word>"],
            "Copy selected text or current word",
            function () {
                let sel = buffer.currentWord;
                dactyl.assert(sel);
                dactyl.clipboardWrite(sel, true);
            });

        // zooming
        mappings.add(myModes, ["zi", "+", "<text-zoom-in>"],
            "Enlarge text zoom of current web page",
            function (args) { buffer.zoomIn(Math.max(args.count, 1), false); },
            { count: true });

        mappings.add(myModes, ["zm", "<text-zoom-more>"],
            "Enlarge text zoom of current web page by a larger amount",
            function (args) { buffer.zoomIn(Math.max(args.count, 1) * 3, false); },
            { count: true });

        mappings.add(myModes, ["zo", "-", "<text-zoom-out>"],
            "Reduce text zoom of current web page",
            function (args) { buffer.zoomOut(Math.max(args.count, 1), false); },
            { count: true });

        mappings.add(myModes, ["zr", "<text-zoom-reduce>"],
            "Reduce text zoom of current web page by a larger amount",
            function (args) { buffer.zoomOut(Math.max(args.count, 1) * 3, false); },
            { count: true });

        mappings.add(myModes, ["zz", "<text-zoom>"],
            "Set text zoom value of current web page",
            function (args) { buffer.setZoom(args.count > 1 ? args.count : 100, false); },
            { count: true });

        mappings.add(myModes, ["ZI", "zI", "<full-zoom-in>"],
            "Enlarge full zoom of current web page",
            function (args) { buffer.zoomIn(Math.max(args.count, 1), true); },
            { count: true });

        mappings.add(myModes, ["ZM", "zM", "<full-zoom-more>"],
            "Enlarge full zoom of current web page by a larger amount",
            function (args) { buffer.zoomIn(Math.max(args.count, 1) * 3, true); },
            { count: true });

        mappings.add(myModes, ["ZO", "zO", "<full-zoom-out>"],
            "Reduce full zoom of current web page",
            function (args) { buffer.zoomOut(Math.max(args.count, 1), true); },
            { count: true });

        mappings.add(myModes, ["ZR", "zR", "<full-zoom-reduce>"],
            "Reduce full zoom of current web page by a larger amount",
            function (args) { buffer.zoomOut(Math.max(args.count, 1) * 3, true); },
            { count: true });

        mappings.add(myModes, ["zZ", "<full-zoom>"],
            "Set full zoom value of current web page",
            function (args) { buffer.setZoom(args.count > 1 ? args.count : 100, true); },
            { count: true });

        // page info
        mappings.add(myModes, ["<C-g>", "<page-info>"],
            "Print the current file name",
            function () { buffer.showPageInfo(false); });

        mappings.add(myModes, ["g<C-g>", "<more-page-info>"],
            "Print file information",
            function () { buffer.showPageInfo(true); });
    },
    options: function () {
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
            "charlist", "gfm",
            { get values() [[k, v[1]] for ([k, v] in Iterator(buffer.pageInfo))] });

        options.add(["scroll", "scr"],
            "Number of lines to scroll with <C-u> and <C-d> commands",
            "number", 0,
            { validator: function (value) value >= 0 });

        options.add(["showstatuslinks", "ssli"],
            "Where to show the destination of the link under the cursor",
            "string", "status",
            {
                values: [
                    ["", "Don't show link destinations"],
                    ["status", "Show link destinations in the status line"],
                    ["command", "Show link destinations in the command line"]
                ]
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
