// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var Config = Module("config", ConfigBase, {
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
                () => "checkForUpdates" in window],
            cookies: ["List your cookies",
                function () { window.toOpenWindowByType("Browser:Cookies", "chrome://browser/content/preferences/cookies.xul", "chrome,dialog=no,resizable"); }],
            console: ["Browser console",
                function () { window.HUDService.toggleBrowserConsole(); }],
            customizetoolbar: ["Customize the Toolbar",
                function () { window.BrowserCustomizeToolbar(); }],
            dominspector: ["DOM Inspector",
                function () { window.inspectDOMDocument(window.content.document); },
                () => "inspectDOMDocument" in window],
            downloads: ["Manage Downloads",
                function () { window.BrowserDownloadsUI(); }],
            history: ["List your history",
                function () { window.openDialog("chrome://browser/content/history/history-panel.xul", "History", "dialog,centerscreen,width=600,height=600"); }],
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
                () => "start_venkman" in window]
        },

        removeTab: function removeTab(tab) {
            if (window.gInPrintPreviewMode)
                window.PrintUtils.exitPrintPreview();
            else if (this.tabbrowser.mTabs.length > 1)
                this.tabbrowser.removeTab(tab);
            else {
                if (modules.buffer.uri.spec !== "about:blank" || window.getWebNavigation().sessionHistory.count > 0) {
                    dactyl.open("about:blank", dactyl.NEW_BACKGROUND_TAB);
                    this.tabbrowser.removeTab(tab);
                }
                else
                    dactyl.beep();
            }
        }
    })

}, {
}, {
    commands: function initCommands(dactyl, modules, window) {
        const { commands, completion, config } = modules;
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
                let title = document.getElementById("sidebar-title");

                dactyl.assert(args.length || title.value || args.bang && config.lastSidebar,
                              _("error.argumentRequired"));

                if (!args.length)
                    return window.toggleSidebar(title.value ? null : config.lastSidebar);

                // focus if the requested sidebar is already open
                if (compare(title.value, args[0])) {
                    if (args.bang)
                        return window.toggleSidebar();
                    return dactyl.focus(document.getElementById("sidebar-box"));
                }

                let menu = document.getElementById("viewSidebarMenu");

                for (let [, panel] in Iterator(menu.childNodes))
                    if (compare(panel.getAttribute("label"), args[0])) {
                        let elem = document.getElementById(panel.observes);
                        if (elem)
                            elem.doCommand();
                        return;
                    }

                return dactyl.echoerr(_("error.invalidArgument", args[0]));
            },
            {
                argCount: "?",
                bang: true,
                completer: function (context) {
                    context.ignoreCase = true;
                    return completion.sidebar(context);
                },
                literal: 0
            });

        commands.add(["wind[ow]"],
            "Execute a command and tell it to output in a new window",
            function (args) {
                dactyl.withSavedValues(["forceTarget"], function () {
                    this.forceTarget = dactyl.NEW_WINDOW;
                    this.execute(args[0], null, true);
                });
            },
            {
                argCount: "1",
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
    completion: function initCompletion(dactyl, modules, window) {
        const { CompletionContext, bookmarkcache, completion } = modules;
        const { document } = window;

        completion.location = function location(context) {
            completion.autocomplete("history", context);
            context.title = ["Smart Completions"];
        };

        completion.addUrlCompleter("location",
            "Firefox location bar entries (bookmarks and history sorted in an intelligent way)",
            completion.location);

        completion.sidebar = function sidebar(context) {
            let menu = document.getElementById("viewSidebarMenu");
            context.title = ["Sidebar Panel"];
            context.completions = Array.filter(menu.childNodes, n => n.hasAttribute("label"))
                                       .map(n => [n.getAttribute("label"), ""]);
        };
    },
    events: function initEvents(dactyl, modules, window) {
        modules.events.listen(window, "SidebarFocused", function (event) {
            modules.config.lastSidebar = window.document.getElementById("sidebar-box")
                                               .getAttribute("sidebarcommand");
        }, false);
    },
    mappings: function initMappings(dactyl, modules, window) {
        const { Events, mappings, modes } = modules;
        mappings.add([modes.NORMAL],
                     ["<Return>", "<Up>", "<Down>"],
                     "Handled by " + config.host,
                     () => Events.PASS_THROUGH);
    },
    options: function initOptions(dactyl, modules, window) {
        modules.options.add(["online"],
            "Enables or disables offline mode",
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

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
