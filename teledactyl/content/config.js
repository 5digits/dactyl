// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

const Config = Module("config", ConfigBase, {
    name: "teledactyl",
    appName: "Teledactyl",
    idName: "TELEDACTYL",
    host: "Thunderbird",
    hostbin: "thunderbird",

    Local: function Local(dactyl, modules, window)
        let ({ config } = modules, { document } = window) {
        init: function init() {
            init.superapply(this, arguments);

            modules.__defineGetter__("content", function () window.content);

            util.overlayWindow(window, { append: <><hbox id="statusTextBox" flex=""/></> });
        },

        get browser() window.getBrowser(),

        get commandContainer() document.documentElement.id,

        tabbrowser: {
            __proto__: Class.makeClosure.call(window.document.getElementById("tabmail")),
            get mTabContainer() this.tabContainer,
            get mTabs() this.tabContainer.childNodes,
            get mCurrentTab() this.tabContainer.selectedItem,
            get mStrip() this.tabStrip,
            get browsers() [browser for (browser in Iterator(this.mTabs))],

            loadOneTab: function loadOneTab(uri) {
                return this.openTab("contentTab", { contentPage: uri });
            },
            loadURIWithFlags: function loadURIWithFlags() {
                return this.mCurrentTab.loadURIWithFlags.apply(this.mCurrentTab, arguments);
            }
        },

        get hasTabbrowser() !this.isComposeWindow,

        get tabStip() this.tabbrowser.tabContainer,

        get isComposeWindow() window.wintype == "msgcompose",

        get mainWidget() this.isComposeWindow ? document.getElementById("content-frame") : window.GetThreadTree(),

        get mainWindowId() this.isComposeWindow ? "msgcomposeWindow" : "messengerWindow",
        get browserModes() [modules.modes.MESSAGE],
        get mailModes() [modules.modes.NORMAL],

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

        removeTab: function removeTab(tab) {
            if (this.tabbrowser.mTabs.length > 1)
                this.tabbrowser.removeTab(tab);
            else
                dactyl.beep();
        },

        completers: Class.memoize(function () update({ mailfolder: "mailFolder" }, this.__proto__.completers)),

        dialogs: {
            about: ["About Thunderbird",
                function () { window.openAboutDialog(); }],
            addons: ["Manage Add-ons",
                function () { window.openAddonsMgr(); }],
            addressbook: ["Address book",
                function () { window.toAddressBook(); }],
            checkupdates: ["Check for updates",
                function () { window.checkForUpdates(); }],
            console: ["JavaScript console",
                function () { window.toJavaScriptConsole(); }],
            dominspector: ["DOM Inspector",
                function () { window.inspectDOMDocument(content.document); }],
            downloads: ["Manage Downloads",
                function () { window.toOpenWindowByType('Download:Manager', 'chrome://mozapps/content/downloads/downloads.xul', 'chrome,dialog=no,resizable'); }],
            preferences: ["Show Thunderbird preferences dialog",
                function () { window.openOptionsDialog(); }],
            printsetup: ["Setup the page size and orientation before printing",
                function () { window.PrintUtils.showPageSetup(); }],
            print: ["Show print dialog",
                function () { window.PrintUtils.print(); }],
            saveframe: ["Save frame to disk",
                function () { window.saveFrameDocument(); }],
            savepage: ["Save page to disk",
                function () { window.saveDocument(window.content.document); }],
        },

        focusChange: function focusChange(win) {
            const { modes } = modules;

            // we switch to -- MESSAGE -- mode for Teledactyl when the main HTML widget gets focus
            if (win && win.document instanceof Ci.nsIHTMLDocument || dactyl.focus instanceof Ci.nsIHTMLAnchorElement) {
                if (this.isComposeWindow)
                    modes.set(modes.INSERT, modes.TEXT_EDIT);
                else if (dactyl.mode != modes.MESSAGE)
                    modes.main = modes.MESSAGE;
            }
        }
    },

    autocommands: {
        DOMLoad: "Triggered when a page's DOM content has fully loaded",
        FolderLoad: "Triggered after switching folders in Thunderbird",
        PageLoadPre: "Triggered after a page load is initiated",
        PageLoad: "Triggered when a page gets (re)loaded/opened",
        Enter: "Triggered after Thunderbird starts",
        Leave: "Triggered before exiting Thunderbird",
        LeavePre: "Triggered before exiting Thunderbird"
    },

    defaults: {
        guioptions: "bCfrs",
        complete: "f",
        showtabline: 1,
        titlestring: "Teledactyl"
    },

    /*** optional options, there are checked for existence and a fallback provided  ***/
    features: Class.memoize(function () Set(
        this.isComposeWindow ? ["addressbook"]
                             : ["hints", "mail", "marks", "addressbook", "tabs"])),

    guioptions: {
        m: ["MenuBar",            ["mail-toolbar-menubar2"]],
        T: ["Toolbar" ,           ["mail-bar2"]],
        f: ["Folder list",        ["folderPaneBox", "folderpane_splitter"]],
        F: ["Folder list header", ["folderPaneHeader"]]
    },

    // they are sorted by relevance, not alphabetically
    helpFiles: ["intro.html", "version.html"],

    modes: [
        ["MESSAGE", { char: "m" }],
        ["COMPOSE"]
    ],

    get scripts() this.isComposeWindow ? ["compose/compose"] : [
        "addressbook",
        "mail",
        "tabs",
    ],

    overlayChrome: ["chrome://messenger/content/messenger.xul",
                      "chrome://messenger/content/messengercompose/messengercompose.xul"],
    styleableChrome: ["chrome://messenger/content/messenger.xul",
                      "chrome://messenger/content/messengercompose/messengercompose.xul"],

    // to allow Vim to :set ft=mail automatically
    tempFile: "teledactyl.eml"
}, {
}, {
    commands: function initCommands(dactyl, modules, window) {
        const { commands } = modules;

        commands.add(["pref[erences]", "prefs"],
            "Show " + config.host + " preferences",
            function () { window.openOptionsDialog(); },
            { argCount: "0" });
    },
    modes: function initModes(dactyl, modules, window) {
        const { modes } = modules;

        this.ignoreKeys = {
            "<Return>": modes.NORMAL | modes.INSERT,
            "<Space>": modes.NORMAL | modes.INSERT,
            "<Up>": modes.NORMAL | modes.INSERT,
            "<Down>": modes.NORMAL | modes.INSERT
        };
    },
    options: function initOptions(dactyl, modules, window) {
        const { options } = modules;

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
                    if (window.MailOfflineMgr.isOnline() != value)
                        window.MailOfflineMgr.toggleOfflineStatus();
                    return value;
                },
                getter: function () window.MailOfflineMgr.isOnline()
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
