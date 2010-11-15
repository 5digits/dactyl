// Copyright (c) 2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2009 by Prathyush Thota <prathyushthota@gmail.com>
// Copyright (c) 2009-2010 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2009-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://gre/modules/utils.js"); // XXX: PlacesUtils

const Config = Module("config", ConfigBase, {
    init: function init() {
        init.supercall(this);

        // TODO: mention this to SB devs, they seem keen to provide these
        // functions to make porting from FF as simple as possible.
        window.toJavaScriptConsole = function () {
            toOpenWindowByType("global:console", "chrome://global/content/console.xul");
        };
    },

    /*** optional options, there are checked for existence and a fallback provided  ***/
    features: ["bookmarks", "hints", "marks", "history", "quickmarks", "session", "tabs", "player"],
    defaults: {
        guioptions: "smprb",
        showtabline: 2,
        get titlestring() config.name
    },

    guioptions: {
        m: ["Menubar",         ["main-menubar"]],
        T: ["Toolbar",         ["nav-bar"]],
        p: ["Player controls", ["player_wrapper"]]
    },

    get isPlayerWindow() SBGetBrowser().mCurrentTab == SBGetBrowser().mediaTab,
    // focusContent() focuses this widget gSongbirdWindowController takes care of the focus.
    get visualbellWindow() document.getElementById(this.mainWindowId),

    styleableChrome: ["chrome://purplerain/content/xul/mainplayer.xul"],

    autocommands: {
        BookmarkAdd: "Triggered after a page is bookmarked",
        ColorScheme: "Triggered after a color scheme has been loaded",
        DOMLoad: "Triggered when a page's DOM content has fully loaded",
        DownloadPost: "Triggered when a download has completed",
        Fullscreen: "Triggered when the browser's fullscreen state changes",
        LocationChange: "Triggered when changing tabs or when navigation to a new location",
        PageLoadPre: "Triggered after a page load is initiated",
        PageLoad: "Triggered when a page gets (re)loaded/opened",
        ShellCmdPost: "Triggered after executing a shell command with :!cmd",
        TrackChangePre: "Triggered before a playing track is changed",
        TrackChange: "Triggered after a playing track has changed",
        ViewChangePre: "Triggered before a sequencer view is changed",
        ViewChange: "Triggered after a sequencer view is changed",
        StreamStart: "Triggered after a stream has started",
        StreamPause: "Triggered after a stream has paused",
        StreamEnd: "Triggered after a stream has ended",
        StreamStop: "Triggered after a stream has stopped",
        Enter: "Triggered after Songbird starts",
        LeavePre: "Triggered before exiting Songbird, just before destroying each module",
        Leave: "Triggered before exiting Songbird"
    },

    dialogs: {
        about: ["About Songbird",
            function () { window.openDialog("chrome://songbird/content/xul/about.xul", "_blank", "chrome,dialog,modal,centerscreen"); }],
        addons: ["Manage Add-ons",
            function () { SBOpenPreferences("paneAddons"); }],
        checkupdates: ["Check for updates",
            function () { window.checkForUpdates(); }],
        cleardata: ["Clear private data",
            function () {  Sanitizer.showUI(); }],
        cookies: ["List your cookies",
            function () { window.toOpenWindowByType("Browser:Cookies", "chrome://browser/content/preferences/cookies.xul", "chrome,dialog=no,resizable"); }],
        console: ["JavaScript console",
            function () { window.toJavaScriptConsole(); }],
        dominspector: ["DOM Inspector",
            function () { try { window.inspectDOMDocument(content.document); } catch (e) { dactyl.echoerr("DOM Inspector extension not installed"); } }],
        downloads: ["Manage Downloads",
            function () { window.toOpenWindowByType("Download:Manager", "chrome://mozapps/content/downloads/downloads.xul", "chrome,dialog=no,resizable"); }],
        newsmartplaylist: ["Open the file selector dialog",
            function () { SBNewSmartPlaylist(); }],
        openfile: ["Open the file selector dialog",
            function () { SBFileOpen(); }],
        pagesource: ["View page source",
            function () { window.BrowserViewSourceOfDocument(content.document); }],
        preferences: ["Show Songbird preferences dialog",
            function () { window.openPreferences(); }],
        printsetup: ["Setup the page size and orientation before printing",
            function () { PrintUtils.showPageSetup(); }],
        print: ["Show print dialog",
            function () { PrintUtils.print(); }],
        saveframe: ["Save frame to disk",
            function () { window.saveFrameDocument(); }],
        savepage: ["Save page to disk",
            function () { window.saveDocument(window.content.document); }],
        searchengines: ["Manage installed search engines",
            function () { window.openDialog("chrome://browser/content/search/engineManager.xul", "_blank", "chrome,dialog,modal,centerscreen"); }],
        selectionsource: ["View selection source",
            function () { buffer.viewSelectionSource(); }],
        subscribe: ["Add a new subscription",
            function () { SBSubscribe(); }]
    },

    // TODO: clean this up
    focusChange: function (win) {
        // Switch to -- PLAYER -- mode for Songbird Media Player.
        if (config.isPlayerWindow)
            modes.set(modes.PLAYER);
        else
            if (modes.main == modes.PLAYER)
                modes.pop();
    },

    hasTabbrowser: true,
    // FIXME: unless I'm seeing double in in the wee small hours gBrowser is
    // first set from getBrowser which they've deprecated in FF.
    get tabbrowser() window.getBrowser(),
    get browser() window.getBrowser(),

    modes: [["PLAYER", { char: "p" }]],

    removeTab: function (tab) {
        if (config.tabbrowser.mTabs.length > 1)
            config.tabbrowser.removeTab(tab);
        else {
            if (buffer.URL != "about:blank" || window.getWebNavigation().sessionHistory.count > 0) {
                dactyl.open("about:blank", dactyl.NEW_BACKGROUND_TAB);
                config.tabbrowser.removeTab(tab);
            }
            else
                dactyl.beep();
        }
    },

    scripts: [
        "browser",
        "bookmarks",
        "history",
        "quickmarks",
        "tabs",
        "player",
        "library"
    ],

    // FIXME: tab arg and media tab exception?
    stop: function (tab) {
        SBGetBrowser().mCurrentBrowser.stop();
    }
}, {

    /**
     * Shows or hides the main service pane.
     *
     * @param {boolean} value Show the service pane if true, hide it if false.
     */
    showServicePane: function (value) {
        const key = "splitter.servicepane_splitter.was_collapsed";
        gServicePane.open = value;
        SBDataSetBoolValue(key, gServicePane.open);
    },

    /**
     * Opens the display panel with the specified *id*.
     *
     * @param {string} id The ID of the display pane.
     */
    openDisplayPane: function (id) {
        if (id == "servicepane")
            this.showServicePane(true);
        else {
            let pane = document.getElementById(id);
            let manager = services.get("displayPaneManager");
            let paneinfo = manager.getPaneInfo(pane._lastURL.stringValue);

            if (!paneinfo)
                paneinfo = manager.defaultPaneInfo;

            pane.loadContent(paneinfo);
        }
    },

    /**
     * Closes the display panel with the specified *id*
     *
     * @param {string} id The ID of the display pane.
     */
    closeDisplayPane: function (id) {
        if (id == "servicepane")
            this.showServicePane(false);
        else
            document.getElementById(id).hide();
    },

    /**
     * @property {object} A map of display pane command argument strings to
     *     panel element IDs.
     */
    displayPanes: {
        "leftservice"  : "servicepane",
        "bottomcontent": "displaypane_contentpane_bottom",
        "bottomservice": "displaypane_servicepane_bottom",
        "rightsidebar" : "displaypane_right_sidebar"
    }
}, {
    commands: function () {
        commands.add(["dpcl[ose]"],
            "Close a display pane",
            function (args) {
                let arg = args.literalArg;
                dactyl.assert(arg in Config.displayPanes, "E475: Invalid argument: " + arg);
                Config.closeDisplayPane(Config.displayPanes[arg]);
            },
            {
                argCount: "1",
                completer: function (context) completion.displayPane(context),
                literal: 0
            });

        // TODO: this should accept a second arg to specify content
        commands.add(["displayp[ane]", "dp[ane]", "dpope[n]"],
            "Open a display pane",
            function (args) {
                let arg = args.literalArg;
                dactyl.assert(arg in Config.displayPanes, "E475: Invalid argument: " + arg);
                // TODO: focus when we have better key handling of these extended modes
                Config.openDisplayPane(Config.displayPanes[arg]);
            },
            {
                argCount: "1",
                completer: function (context) completion.displayPane(context),
                literal: 0
            });

        commands.add(["pref[erences]", "prefs"],
            "Show " + config.host + " preferences",
            function (args) {
                if (args.bang) { // open Songbird settings GUI dialog
                    dactyl.open("about:config",
                        (options["newtab"] && options.get("newtab").has("all", "prefs"))
                                ? dactyl.NEW_TAB : dactyl.CURRENT_TAB);
                }
                else
                    window.openPreferences();
            },
            {
                argCount: "0",
                bang: true
            });
    },
    completion: function () {
        completion.displayPane = function (context) {
            context.title = ["Display Pane"];
            context.completions = Config.displayPanes; // FIXME: useful description etc
        };
    },
    modes: function () {
        this.ignoreKeys = {
            "<Return>": modes.NORMAL | modes.INSERT,
            "<Space>": modes.NORMAL | modes.INSERT,
            "<Up>": modes.NORMAL | modes.INSERT,
            "<Down>": modes.NORMAL | modes.INSERT
        };
        config.modes.forEach(function (mode) { modes.addMode.apply(modes, mode); }); // XXX
    },
    options: function () {
        // TODO: SB doesn't explicitly support an offline mode. Should we? --djk
        options.add(["online"],
            "Set the 'work offline' option",
            "boolean", true,
            {
                setter: function (value) {
                    const ioService = services.get("io");
                    ioService.offline = !value;
                    prefs.set("browser.offline", ioService.offline);
                    return value;
                },
                getter: function () !services.get("io").offline
            });
    },
    services: function () {
        services.add("displayPaneManager", "@songbirdnest.com/Songbird/DisplayPane/Manager;1", Ci.sbIDisplayPaneManager);
        services.add("mediaPageManager", "@songbirdnest.com/Songbird/MediaPageManager;1", Ci.sbIMediaPageManager);
        services.add("propertyManager","@songbirdnest.com/Songbird/Properties/PropertyManager;1", Ci.sbIPropertyManager);
        services.addClass("mutablePropertyArray", "@songbirdnest.com/Songbird/Properties/MutablePropertyArray;1",
            Ci.sbIMutablePropertyArray);
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
