// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var Config = Module("config", ConfigBase, {
    Local: function Local(dactyl, modules, window)
        let ({ config } = modules, { document } = window) {
        init: function init() {
            init.superapply(this, arguments);

            if (!("content" in modules))
                modules.__defineGetter__("content", () => window.content);

            util.overlayWindow(window, { append: <><hbox id="statusTextBox" flex=""/></> });
        },

        get browser()
            let (tabmail = document.getElementById('tabmail'))
                tabmail && tabmail.tabInfo.length ? tabmail.getBrowserForSelectedTab()
                                                  : document.getElementById("messagepane"),

        tabbrowser: {
            __proto__: Class.makeClosure.call(window.document.getElementById("tabmail")),
            get mTabContainer() this.tabContainer,
            get mTabs() this.tabContainer.childNodes,
            get mCurrentTab() this.tabContainer.selectedItem,
            get mStrip() this.tabStrip,
            get browsers() [browser for (browser in Iterator(this.mTabs))],

            removeTab: function removeTab(tab) this.closeTab(tab),

            loadOneTab: function loadOneTab(uri) {
                return this.openTab("contentTab", { contentPage: uri });
            },
            loadURIWithFlags: function loadURIWithFlags() {
                return this.mCurrentTab.loadURIWithFlags.apply(this.mCurrentTab, arguments);
            }
        },

        get tabStip() this.tabbrowser.tabContainer,

        get mainWidget() this.isComposeWindow ? document.getElementById("content-frame") : window.GetThreadTree(),

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

        completers: Class.Memoize(function () update({ mailfolder: "mailFolder" }, this.__proto__.completers)),

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

            if (win.top == window)
                return;

            // we switch to -- MESSAGE -- mode for Teledactyl when the main HTML widget gets focus
            if (win && win.document instanceof Ci.nsIDOMHTMLDocument
                    || dactyl.focusedElement instanceof Ci.nsIDOMHTMLAnchorElement) {

                if (this.isComposeWindow)
                    modes.set(modes.INSERT, modes.TEXT_EDIT);
                else if (dactyl.mode != modes.MESSAGE)
                    modes.main = modes.MESSAGE;
            }
        }
    }
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

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
