// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var Config = Module("config", ConfigBase, {
    name: "pentadactyl",
    appName: "Pentadactyl",
    idName: "PENTADACTYL",
    fileExt: "penta",
    host: "Firefox",
    hostbin: "firefox",

    Local: function Local(dactyl, modules, window)
        let ({ config } = modules) ({

        dialogs: {
            about: ["About Firefox",
                function () { window.openDialog("chrome://browser/content/aboutDialog.xul", "_blank", "chrome,dialog,modal,centerscreen"); }],
            addbookmark: ["Add bookmark for the current page",
                function () { window.PlacesCommandHook.bookmarkCurrentPage(true, window.PlacesUtils.bookmarksRootId); }],
            addons: ["Manage Add-ons",
                function () { window.BrowserOpenAddonsMgr(); }],
            bookmarks: ["List your bookmarks",
                function () { window.openDialog("chrome://browser/content/bookmarks/bookmarksPanel.xul", "Bookmarks", "dialog,centerscreen,width=600,height=600"); }],
            checkupdates: ["Check for updates",
                function () { window.checkForUpdates(); },
                function () "checkForUpdates" in window],
            cleardata: ["Clear private data",
                function () { Cc["@mozilla.org/browser/browserglue;1"].getService(Ci.nsIBrowserGlue).sanitize(window || null); }],
            cookies: ["List your cookies",
                function () { window.toOpenWindowByType("Browser:Cookies", "chrome://browser/content/preferences/cookies.xul", "chrome,dialog=no,resizable"); }],
            console: ["JavaScript console",
                function () { window.toJavaScriptConsole(); }],
            customizetoolbar: ["Customize the Toolbar",
                function () { window.BrowserCustomizeToolbar(); }],
            dominspector: ["DOM Inspector",
                function () { window.inspectDOMDocument(window.content.document); },
                function () "inspectDOMDocument" in window],
            downloads: ["Manage Downloads",
                function () { window.toOpenWindowByType("Download:Manager", "chrome://mozapps/content/downloads/downloads.xul", "chrome,dialog=no,resizable"); }],
            history: ["List your history",
                function () { window.openDialog("chrome://browser/content/history/history-panel.xul", "History", "dialog,centerscreen,width=600,height=600"); }],
            import: ["Import Preferences, Bookmarks, History, etc. from other browsers",
                function () { window.BrowserImport(); }],
            openfile: ["Open the file selector dialog",
                function () { window.BrowserOpenFileWindow(); }],
            pageinfo: ["Show information about the current page",
                function () { window.BrowserPageInfo(); }],
            pagesource: ["View page source",
                function () { window.BrowserViewSourceOfDocument(window.content.document); }],
            passwords: ["Passwords dialog",
                function () { window.openDialog("chrome://passwordmgr/content/passwordManager.xul"); }],
            places: ["Places Organizer: Manage your bookmarks and history",
                function () { window.PlacesCommandHook.showPlacesOrganizer(window.ORGANIZER_ROOT_BOOKMARKS); }],
            preferences: ["Show Firefox preferences dialog",
                function () { window.openPreferences(); }],
            printpreview: ["Preview the page before printing",
                function () { window.PrintUtils.printPreview(window.PrintPreviewListener || window.onEnterPrintPreview, window.onExitPrintPreview); }],
            printsetup: ["Setup the page size and orientation before printing",
                function () { window.PrintUtils.showPageSetup(); }],
            print: ["Show print dialog",
                function () { window.PrintUtils.print(); }],
            saveframe: ["Save frame to disk",
                function () { window.saveFrameDocument(); }],
            savepage: ["Save page to disk",
                function () { window.saveDocument(window.content.document); }],
            searchengines: ["Manage installed search engines",
                function () { window.openDialog("chrome://browser/content/search/engineManager.xul", "_blank", "chrome,dialog,modal,centerscreen"); }],
            selectionsource: ["View selection source",
                function () { modules.buffer.viewSelectionSource(); }],
            venkman: ["The JavaScript debugger",
                function () { dactyl.assert("start_venkman" in window, "Venkman is not installed"); window.start_venkman() },
                function () "start_venkman" in window]
        },

        get visualbellWindow() this.browser.mPanelContainer,

        removeTab: function removeTab(tab) {
            if (this.tabbrowser.mTabs.length > 1)
                this.tabbrowser.removeTab(tab);
            else {
                if (modules.buffer.URL != "about:blank" || window.getWebNavigation().sessionHistory.count > 0) {
                    dactyl.open("about:blank", dactyl.NEW_BACKGROUND_TAB);
                    this.tabbrowser.removeTab(tab);
                }
                else
                    dactyl.beep();
            }
        },

        get tempFile() {
            let prefix = this.name.toLowerCase();
            try {
                prefix += "-" + window.content.document.location.hostname;
            }
            catch (e) {}

            return prefix + ".tmp";
        }
    }),

    overlayChrome: ["chrome://browser/content/browser.xul"],

    styleableChrome: ["chrome://browser/content/browser.xul"],

    autocommands: {
        BookmarkAdd: "Triggered after a page is bookmarked",
        BookmarkChange: "Triggered after a page's bookmark is changed",
        BookmarkRemove: "Triggered after a page's bookmark is removed",
        ColorScheme: "Triggered after a color scheme has been loaded",
        DOMLoad: "Triggered when a page's DOM content has fully loaded",
        DownloadPost: "Triggered when a download has completed",
        Fullscreen: "Triggered when the browser's fullscreen state changes",
        LocationChange: "Triggered when changing tabs or when navigation to a new location",
        PageLoadPre: "Triggered after a page load is initiated",
        PageLoad: "Triggered when a page gets (re)loaded/opened",
        PrivateMode: "Triggered when private mode is activated or deactivated",
        Sanitize: "Triggered when a sanitizeable item is cleared",
        ShellCmdPost: "Triggered after executing a shell command with :!cmd",
        Enter: "Triggered after Firefox starts",
        LeavePre: "Triggered before exiting Firefox, just before destroying each module",
        Leave: "Triggered before exiting Firefox"
    },

    completers: Class.memoize(function () update({ sidebar: "sidebar", window: "window" }, this.__proto__.completers)),

    defaults: {
        complete: "slf",
        guioptions: "bCrs",
        showtabline: "always",
        titlestring: "Pentadactyl"
    },

    features: [
        "bookmarks", "hints", "history", "marks", "quickmarks", "sanitizer",
        "session", "tabs", "tabs_undo", "windows"
    ],

    guioptions: {
        m: ["Menubar",      ["toolbar-menubar"]],
        T: ["Toolbar",      ["nav-bar"]],
        B: ["Bookmark bar", ["PersonalToolbar"]]
    },

    hasTabbrowser: true,

    scripts: [
        "browser",
        "bookmarkcache",
        "bookmarks",
        "history",
        "quickmarks",
        "sanitizer",
        "tabs"
    ],

    sidebars: {
        viewAddons:      ["Add-ons",     "A", "chrome://mozapps/content/extensions/extensions.xul"],
        viewConsole:     ["Console",     "C", "chrome://global/content/console.xul"],
        viewDownloads:   ["Downloads",   "D", "chrome://mozapps/content/downloads/downloads.xul"],
        viewPreferences: ["Preferences", "P", "about:config"]
    }
}, {
}, {
    commands: function (dactyl, modules, window) {
        const { commands, completion } = modules;
        const { document } = window;

        commands.add(["winon[ly]"],
            "Close all other windows",
            function () {
                dactyl.windows.forEach(function (win) {
                    if (win != window)
                        win.close();
                });
            },
            { argCount: "0" });

        commands.add(["pref[erences]", "prefs"],
            "Show " + config.host + " preferences",
            function (args) {
                if (args.bang) // open Firefox settings GUI dialog
                    dactyl.open("about:config", { from: "prefs" });
                else
                    window.openPreferences();
            },
            {
                argCount: "0",
                bang: true
            });

        commands.add(["sbcl[ose]"],
            "Close the sidebar window",
            function () {
                if (!document.getElementById("sidebar-box").hidden)
                    window.toggleSidebar();
            },
            { argCount: "0" });

        commands.add(["sideb[ar]", "sb[ar]", "sbop[en]"],
            "Open the sidebar window",
            function (args) {
                function compare(a, b) util.compareIgnoreCase(a, b) == 0

                // focus if the requested sidebar is already open
                if (compare(document.getElementById("sidebar-title").value, args[0]))
                    return dactyl.focus(document.getElementById("sidebar-box"));

                let menu = document.getElementById("viewSidebarMenu");

                for (let [, panel] in Iterator(menu.childNodes))
                    if (compare(panel.getAttribute("label"), args[0])) {
                        let elem = document.getElementById(panel.observes);
                        if (elem)
                            elem.doCommand();
                        return;
                    }

                return dactyl.echoerr("No sidebar " + args[0] + " found");
            },
            {
                argCount: "1",
                completer: function (context) {
                    context.ignoreCase = true;
                    return completion.sidebar(context);
                },
                literal: 0
            });

        commands.add(["wind[ow]"],
            "Execute a command and tell it to output in a new window",
            function (args) {
                dactyl.withSavedValues(["forceNewWindow"], function () {
                    this.forceNewWindow = true;
                    this.execute(args[0], null, true);
                });
            },
            {
                argCount: "+",
                completer: function (context) completion.ex(context),
                literal: 0,
                subCommand: 0
            });

        commands.add(["winc[lose]", "wc[lose]"],
            "Close window",
            function () { window.close(); },
            { argCount: "0" });

        commands.add(["wino[pen]", "wo[pen]"],
            "Open one or more URLs in a new window",
            function (args) {
                if (args[0])
                    dactyl.open(args[0], dactyl.NEW_WINDOW);
                else
                    dactyl.open("about:blank", dactyl.NEW_WINDOW);
            },
            {
                completer: function (context) completion.url(context),
                domains: function (args) commands.get("open").domains(args),
                literal: 0,
                privateData: true
            });
    },
    completion: function (dactyl, modules, window) {
        const { CompletionContext, bookmarkcache, bookmarks, completion } = modules;
        const { document } = window;

        var searchRunning = false; // only until Firefox fixes https://bugzilla.mozilla.org/show_bug.cgi?id=510589
        completion.location = function location(context) {
            if (!services.autoCompleteSearch)
                return;

            context.anchored = false;
            context.compare = CompletionContext.Sort.unsorted;
            context.filterFunc = null;
            context.hasItems = context.completions.length > 0; // XXX
            context.incomplete = true;

            context.format = bookmarks.format;
            context.keys.extra = function (item) (bookmarkcache.get(item.url) || {}).extra;
            context.title = ["Smart Completions"];

            context.cancel = function () {
                if (searchRunning) {
                    services.autoCompleteSearch.stopSearch();
                    searchRunning = false;
                }
            };
            if (searchRunning)
                services.autoCompleteSearch.stopSearch();
            let timer = new Timer(50, 100, function (result) {
                context.incomplete = result.searchResult >= result.RESULT_NOMATCH_ONGOING;
                context.completions = [
                    { url: result.getValueAt(i), title: result.getCommentAt(i), icon: result.getImageAt(i) }
                    for (i in util.range(0, result.matchCount))
                ];
            });
            services.autoCompleteSearch.startSearch(context.filter, "", context.result, {
                onSearchResult: function onSearchResult(search, result) {
                    timer.tell(result);
                    if (result.searchResult <= result.RESULT_SUCCESS) {
                        searchRunning = false;
                        timer.flush();
                    }
                }
            });
            searchRunning = true;
        };

        completion.sidebar = function sidebar(context) {
            let menu = document.getElementById("viewSidebarMenu");
            context.title = ["Sidebar Panel"];
            context.completions = Array.map(menu.childNodes, function (n) [n.getAttribute("label"), ""]);
        };

        completion.addUrlCompleter("l",
            "Firefox location bar entries (bookmarks and history sorted in an intelligent way)",
            completion.location);
    },
    modes: function (dactyl, modules, window) {
        const { config, modes } = modules;
        config.ignoreKeys = {
            "<Return>": modes.NORMAL | modes.INSERT,
            "<Space>": modes.NORMAL | modes.INSERT,
            "<Up>": modes.NORMAL | modes.INSERT,
            "<Down>": modes.NORMAL | modes.INSERT
        };
        config.modes.forEach(function (mode) { modes.addMode.apply(this, mode); });
    },
    options: function (dactyl, modules, window) {
        modules.options.add(["online"],
            "Set the 'work offline' option",
            "boolean", true,
            {
                setter: function (value) {
                    if (services.io.offline == value)
                        window.BrowserOffline.toggleOfflineStatus();
                    return value;
                },
                getter: function () !services.io.offline
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
