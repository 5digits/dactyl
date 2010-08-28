// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.

const Config = Module("config", ConfigBase, {
    init: function () {
        // don't wait too long when selecting new messages
        // GetThreadTree()._selectDelay = 300; // TODO: make configurable
    },

    /*** required options, no checks done if they really exist, so be careful ***/
    name: "Muttator",
    hostApplication: "Thunderbird", // TODO: can this be found out otherwise? gBrandBundle.getString("brandShortName");
                                    // Yes, but it will be localized unlike all other strings. So, it's best left until we i18n dactyl. --djk

    get mainWindowId() this.isComposeWindow ? "msgcomposeWindow" : "messengerWindow",

    /*** optional options, there are checked for existence and a fallback provided  ***/
    features: ["hints", "mail", "marks", "addressbook", "tabs"],
    defaults: {
        guioptions: "frb",
        showtabline: 1,
        titlestring: "Muttator"
    },

    guioptions: {
        m: ["MenuBar",            ["mail-toolbar-menubar2"]],
        T: ["Toolbar" ,           ["mail-bar2"]],
        f: ["Folder list",        ["folderPaneBox", "folderpane_splitter"]],
        F: ["Folder list header", ["folderPaneHeader"]]
    },

    get isComposeWindow() window.wintype == "msgcompose",
    get browserModes() [modes.MESSAGE],
    get mailModes() [modes.NORMAL],
    // focusContent() focuses this widget
    get mainWidget() this.isComposeWindow ? document.getElementById("content-frame") : GetThreadTree(),
    get visualbellWindow() document.getElementById(this.mainWindowId),
    styleableChrome: ["chrome://messenger/content/messenger.xul",
                      "chrome://messenger/content/messengercompose/messengercompose.xul"],

    autocommands: [["DOMLoad",         "Triggered when a page's DOM content has fully loaded"],
                   ["FolderLoad",      "Triggered after switching folders in Thunderbird"],
                   ["PageLoadPre",     "Triggered after a page load is initiated"],
                   ["PageLoad",        "Triggered when a page gets (re)loaded/opened"],
                   ["MuttatorEnter",    "Triggered after Thunderbird starts"],
                   ["MuttatorLeave",    "Triggered before exiting Thunderbird"],
                   ["MuttatorLeavePre", "Triggered before exiting Thunderbird"]],
    dialogs: [
        ["about",            "About Thunderbird",
            function () { window.openAboutDialog(); }],
        ["addons",           "Manage Add-ons",
            function () { window.openAddonsMgr(); }],
        ["addressbook",      "Address book",
            function () { window.toAddressBook(); }],
        ["checkupdates",     "Check for updates",
            function () { window.checkForUpdates(); }],
        /*["cleardata",        "Clear private data",
         function () { Cc[GLUE_CID].getService(Ci.nsIBrowserGlue).sanitize(window || null); }],*/
        ["console",          "JavaScript console",
            function () { window.toJavaScriptConsole(); }],
        /*["customizetoolbar", "Customize the Toolbar",
            function () { BrowserCustomizeToolbar(); }],*/
        ["dominspector",     "DOM Inspector",
            function () { window.inspectDOMDocument(content.document); }],
        ["downloads",        "Manage Downloads",
            function () { window.toOpenWindowByType('Download:Manager', 'chrome://mozapps/content/downloads/downloads.xul', 'chrome,dialog=no,resizable'); }],
        /*["import",           "Import Preferences, Bookmarks, History, etc. from other browsers",
            function () { BrowserImport(); }],
        ["openfile",         "Open the file selector dialog",
            function () { BrowserOpenFileWindow(); }],
        ["pageinfo",         "Show information about the current page",
            function () { BrowserPageInfo(); }],
        ["pagesource",       "View page source",
            function () { BrowserViewSourceOfDocument(content.document); }],*/
        ["preferences",      "Show Thunderbird preferences dialog",
            function () { openOptionsDialog(); }],
        /*["printpreview",     "Preview the page before printing",
            function () { PrintUtils.printPreview(onEnterPrintPreview, onExitPrintPreview); }],*/
        ["printsetup",       "Setup the page size and orientation before printing",
            function () { PrintUtils.showPageSetup(); }],
        ["print",            "Show print dialog",
            function () { PrintUtils.print(); }],
        ["saveframe",        "Save frame to disk",
            function () { window.saveFrameDocument(); }],
        ["savepage",         "Save page to disk",
            function () { window.saveDocument(window.content.document); }],
        /*["searchengines",    "Manage installed search engines",
            function () { openDialog("chrome://browser/content/search/engineManager.xul", "_blank", "chrome,dialog,modal,centerscreen"); }],
        ["selectionsource",  "View selection source",
            function () { buffer.viewSelectionSource(); }]*/
    ],

    focusChange: function (win) {
        // we switch to -- MESSAGE -- mode for Muttator, when the main HTML widget gets focus
        if (win && win.document instanceof HTMLDocument || dactyl.focus instanceof HTMLAnchorElement) {
            if (config.isComposeWindow)
                modes.set(modes.INSERT, modes.TEXTAREA);
            else if (dactyl.mode != modes.MESSAGE)
                dactyl.mode = modes.MESSAGE;
        }
    },

    get browser() getBrowser(),
    tabbrowser: {
        __proto__: document.getElementById("tabmail"),
        get mTabContainer() this.tabContainer,
        get mTabs() this.tabContainer.childNodes,
        get mCurrentTab() this.tabContainer.selectedItem,
        get mStrip() this.tabStrip,
        get browsers() [browser for (browser in Iterator(this.mTabs))]
    },

    // they are sorted by relevance, not alphabetically
    helpFiles: ["intro.html", "version.html"],

    modes: [
        ["MESSAGE", { char: "m" }],
        ["COMPOSE"]
    ],

    // NOTE: as I don't use TB I have no idea how robust this is. --djk
    get outputHeight() {
        if (!this.isComposeWindow) {
            let container = document.getElementById("tabpanelcontainer").boxObject;
            let deck      = document.getElementById("displayDeck");
            let box       = document.getElementById("messagepanebox");
            let splitter  = document.getElementById("threadpane-splitter").boxObject;

            if (splitter.width > splitter.height)
                return container.height - deck.minHeight - box.minHeight- splitter.height;
            else
                return container.height - Math.max(deck.minHeight, box.minHeight);
        }
        else
            return document.getElementById("appcontent").boxObject.height;
    },

    get scripts() this.isComposeWindow ? ["compose/compose.js"] : [
        "addressbook.js",
        "mail.js",
        "tabs.js",
    ],

    // to allow Vim to :set ft=mail automatically
    tempFile: "mutt-ator-mail",

}, {
}, {
    commands: function () {
        commands.add(["pref[erences]", "prefs"],
            "Show " + config.hostApplication + " preferences",
            function () { window.openOptionsDialog(); },
            { argCount: "0" });
    },
    modes: function () {
        this.ignoreKeys = {
            "<Return>": modes.NORMAL | modes.INSERT,
            "<Space>": modes.NORMAL | modes.INSERT,
            "<Up>": modes.NORMAL | modes.INSERT,
            "<Down>": modes.NORMAL | modes.INSERT
        };
    },
    optons: function () {
        // FIXME: comment obviously incorrect
        // 0: never automatically edit externally
        // 1: automatically edit externally when message window is shown the first time
        // 2: automatically edit externally, once the message text gets focus (not working currently)
        options.add(["autoexternal", "ae"],
            "Edit message with external editor by default",
            "boolean", false);

        options.add(["online"],
            "Set the 'work offline' option",
            "boolean", true,
            {
                setter: function (value) {
                    if (MailOfflineMgr.isOnline() != value)
                        MailOfflineMgr.toggleOfflineStatus();
                    return value;
                },
                getter: function () MailOfflineMgr.isOnline()
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
