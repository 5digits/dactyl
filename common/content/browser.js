// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/**
 * @instance browser
 */
var Browser = Module("browser", XPCOM(Ci.nsISupportsWeakReference, ModuleBase), {
    init: function init() {
        this.cleanupProgressListener = overlay.overlayObject(window.XULBrowserWindow,
                                                             this.progressListener);
        util.addObserver(this);

        this._unoverlay = overlay.overlayObject(FullZoom, {
            get siteSpecific() false,
            set siteSpecific(val) {}
        });

        config.tabbrowser.addTabsProgressListener(this.tabsProgressListener);
    },

    destroy: function () {
        this.cleanupProgressListener();
        this.observe.unregister();
        this._unoverlay();
        config.tabbrowser.removeTabsProgressListener(this.tabsProgressListener);
    },

    observers: {
        "chrome-document-global-created": function (win, uri) { this.observe(win, "content-document-global-created", uri); },
        "content-document-global-created": function (win, uri) {
            let top = util.topWindow(win);

            if (uri == "null")
                uri = null;

            if (top == window && (win.location.href || uri))
                this._triggerLoadAutocmd("PageLoadPre", win.document, win.location.href || uri);
        }
    },

    _triggerLoadAutocmd: function _triggerLoadAutocmd(name, doc, uri) {
        if (!(uri || doc.location))
            return;

        uri = isObject(uri) ? uri : util.newURI(uri || doc.location.href);
        let args = {
            url: { toString: function () uri.spec, valueOf: function () uri },
            title: doc.title
        };

        if (!dactyl.has("tabs"))
            update(args, { doc: doc, win: doc.defaultView });
        else {
            args.tab = tabs.getContentIndex(doc) + 1;
            args.doc = {
                valueOf: function () doc,
                toString: function () "tabs.getTab(" + (args.tab - 1) + ").linkedBrowser.contentDocument"
            };
            args.win = {
                valueOf: function () doc.defaultView,
                toString: function () "tabs.getTab(" + (args.tab - 1) + ").linkedBrowser.contentWindow"
            };
        }

        autocommands.trigger(name, args);
    },

    events: {
        DOMContentLoaded: function onDOMContentLoaded(event) {
            let doc = event.originalTarget;
            if (doc instanceof Ci.nsIDOMHTMLDocument)
                this._triggerLoadAutocmd("DOMLoad", doc);
        },

        // TODO: see what can be moved to onDOMContentLoaded()
        // event listener which is is called on each page load, even if the
        // page is loaded in a background tab
        load: function onLoad(event) {
            let doc = event.originalTarget;
            if (doc instanceof Ci.nsIDOMDocument)
                dactyl.initDocument(doc);

            if (doc instanceof Ci.nsIDOMHTMLDocument) {
                if (doc.defaultView.frameElement) {
                    // document is part of a frameset

                    // hacky way to get rid of "Transferring data from ..." on sites with frames
                    // when you click on a link inside a frameset, because asyncUpdateUI
                    // is not triggered there (Gecko bug?)
                    this.timeout(function () { statusline.updateStatus(); }, 10);
                }
                else {
                    // code which should happen for all (also background) newly loaded tabs goes here:
                    if (doc != config.browser.contentDocument)
                        dactyl.echomsg({ domains: [util.getHost(doc.location)], message: _("buffer.backgroundLoaded", (doc.title || doc.location.href)) }, 3);

                    this._triggerLoadAutocmd("PageLoad", doc);
                }
            }
        }
    },

    /**
     * @property {Object} The document loading progress listener.
     */
    progressListener: {
        onStateChange: util.wrapCallback(function onStateChange(webProgress, request, flags, status) {
            const L = Ci.nsIWebProgressListener;

            if (request)
                dactyl.applyTriggerObserver("browser.stateChange", arguments);

            if (flags & (L.STATE_IS_DOCUMENT | L.STATE_IS_WINDOW)) {
                // This fires when the load event is initiated
                // only thrown for the current tab, not when another tab changes
                if (flags & L.STATE_START) {
                    while (document.commandDispatcher.focusedWindow == webProgress.DOMWindow
                           && modes.have(modes.INPUT))
                        modes.pop();

                }
                else if (flags & L.STATE_STOP) {
                    // Workaround for bugs 591425 and 606877, dactyl bug #81
                    config.browser.mCurrentBrowser.collapsed = false;
                    if (!dactyl.focusedElement || dactyl.focusedElement === document.documentElement)
                        dactyl.focusContent();
                }
            }

            onStateChange.superapply(this, arguments);
        }),
        onSecurityChange: util.wrapCallback(function onSecurityChange(webProgress, request, state) {
            onSecurityChange.superapply(this, arguments);
            dactyl.applyTriggerObserver("browser.securityChange", arguments);
        }),
        onStatusChange: util.wrapCallback(function onStatusChange(webProgress, request, status, message) {
            onStatusChange.superapply(this, arguments);
            dactyl.applyTriggerObserver("browser.statusChange", arguments);
        }),
        onProgressChange: util.wrapCallback(function onProgressChange(webProgress, request, curSelfProgress, maxSelfProgress, curTotalProgress, maxTotalProgress) {
            onProgressChange.superapply(this, arguments);
            dactyl.applyTriggerObserver("browser.progressChange", arguments);
        }),
        onLocationChange: util.wrapCallback(function onLocationChange(webProgress, request, uri) {
            onLocationChange.superapply(this, arguments);

            dactyl.applyTriggerObserver("browser.locationChange", arguments);

            let win = webProgress.DOMWindow;
            if (win && uri) {
                Buffer(win).updateZoom();

                let oldURI = overlay.getData(win.document)["uri"];
                if (overlay.getData(win.document)["load-idx"] === webProgress.loadedTransIndex
                    || !oldURI || uri.spec.replace(/#.*/, "") !== oldURI.replace(/#.*/, ""))
                    for (let frame in values(buffer.allFrames(win)))
                        overlay.setData(frame.document, "focus-allowed", false);

                overlay.setData(win.document, "uri", uri.spec);
                overlay.setData(win.document, "load-idx", webProgress.loadedTransIndex);
            }

            // Workaround for bugs 591425 and 606877, dactyl bug #81
            let collapse = uri && uri.scheme === "dactyl" && webProgress.isLoadingDocument;
            if (collapse)
                dactyl.focus(document.documentElement);
            config.browser.mCurrentBrowser.collapsed = collapse;

            util.timeout(function () {
                browser._triggerLoadAutocmd("LocationChange",
                                            (win || content).document,
                                            uri);
            });
        }),
        // called at the very end of a page load
        asyncUpdateUI: util.wrapCallback(function asyncUpdateUI() {
            asyncUpdateUI.superapply(this, arguments);
            util.timeout(function () { statusline.updateStatus(); }, 100);
        }),
        setOverLink: util.wrapCallback(function setOverLink(link, b) {
            setOverLink.superapply(this, arguments);
            dactyl.triggerObserver("browser.overLink", link);
        })
    },

    tabsProgressListener: {
        onStateChange: function onStateChange(webProgress, request, flags, status) {},
        onSecurityChange: function onSecurityChange(webProgress, request, state) {},
        onStatusChange: function onStatusChange(webProgress, request, status, message) {},
        onProgressChange: function onProgressChange(webProgress, request, curSelfProgress, maxSelfProgress, curTotalProgress, maxTotalProgress) {},

        onLocationChange: util.wrapCallback(function onLocationChange(browser) {
            Buffer(browser.contentWindow).locationChanged();
        }),
    }
}, {
}, {
    events: function initEvents(dactyl, modules, window) {
        events.listen(config.browser, browser, "events", true);
    },
    commands: function initCommands(dactyl, modules, window) {
        commands.add(["o[pen]"],
            "Open one or more URLs in the current tab",
            function (args) { dactyl.open(args[0] || "about:blank"); },
            {
                completer: function (context) completion.url(context),
                domains: function (args) array.compact(dactyl.parseURLs(args[0] || "")
                                                             .map(url => util.getHost(url))),
                literal: 0,
                privateData: true
            });

        commands.add(["redr[aw]"],
            "Redraw the screen",
            function () {
                statusline.overLink = null;
                statusline.updateStatus();
                commandline.clear();
                window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils)
                      .redraw();
            },
            { argCount: "0" });
    },
    mappings: function initMappings(dactyl, modules, window) {
        let openModes = array.toObject([
            [dactyl.CURRENT_TAB, ""],
            [dactyl.NEW_TAB, "tab"],
            [dactyl.NEW_BACKGROUND_TAB, "background tab"],
            [dactyl.NEW_WINDOW, "win"]
        ]);

        function open(mode, args) {
            if (dactyl.forceTarget in openModes)
                mode = openModes[dactyl.forceTarget];

            CommandExMode().open(mode + "open " + (args || ""));
        }

        function decode(uri) util.losslessDecodeURI(uri)
                                 .replace(/%20(?!(?:%20)*$)/g, " ")
                                 .replace(RegExp(options["urlseparator"], "g"), encodeURIComponent);

        mappings.add([modes.NORMAL],
            ["o"], "Open one or more URLs",
            function () { open(""); });

        mappings.add([modes.NORMAL], ["O"],
            "Open one or more URLs, based on current location",
            function () { open("", decode(buffer.uri.spec)); });

        mappings.add([modes.NORMAL], ["s"],
            "Open a search prompt",
            function () { open("", options["defsearch"] + " "); });

        mappings.add([modes.NORMAL], ["S"],
            "Open a search prompt for a new tab",
            function () { open("tab", options["defsearch"] + " "); });

        mappings.add([modes.NORMAL], ["t"],
            "Open one or more URLs in a new tab",
            function () { CommandExMode().open("tabopen "); });

        mappings.add([modes.NORMAL], ["T"],
            "Open one or more URLs in a new tab, based on current location",
            function () { open("tab", decode(buffer.uri.spec)); });

        mappings.add([modes.NORMAL], ["w"],
            "Open one or more URLs in a new window",
            function () { open("win"); });

        mappings.add([modes.NORMAL], ["W"],
            "Open one or more URLs in a new window, based on current location",
            function () { open("win", decode(buffer.uri.spec)); });

        mappings.add([modes.NORMAL], ["<open-home-directory>", "~"],
            "Open home directory",
            function () { dactyl.open("~"); });

        mappings.add([modes.NORMAL], ["<open-homepage>", "gh"],
            "Open homepage",
            function () { window.BrowserHome(); });

        mappings.add([modes.NORMAL], ["<tab-open-homepage>", "gH"],
            "Open homepage in a new tab",
            function () {
                let homepages = window.gHomeButton.getHomePage();
                dactyl.open(homepages, { from: "homepage", where: dactyl.NEW_TAB });
            });

        mappings.add([modes.MAIN], ["<redraw-screen>", "<C-l>"],
            "Redraw the screen",
            function () { ex.redraw(); });
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
