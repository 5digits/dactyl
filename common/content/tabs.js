// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

// TODO: many methods do not work with Thunderbird correctly yet

/**
 * @instance tabs
 */
const Tabs = Module("tabs", {
    init: function () {
        this._alternates = [config.tabbrowser.mCurrentTab, null];

        // used for the "gb" and "gB" mappings to remember the last :buffer[!] command
        this._lastBufferSwitchArgs = "";
        this._lastBufferSwitchSpecial = true;

        this.tabBinding = styles.addSheet(true, "tab-binding", "chrome://browser/content/browser.xul", String.replace(<><![CDATA[
                xul|tab { -moz-binding: url(chrome://dactyl/content/bindings.xml#tab-3) !important; }
                #TabsToolbar > xul|tabs > xul|tab { -moz-binding: url(chrome://dactyl/content/bindings.xml#tab-4) !important; }
                // FIXME: better solution for themes?
                .tabbrowser-tab[busy] > .tab-icon > .tab-icon-image { list-style-image: url('chrome://global/skin/icons/loading_16.png') !important; }
        ]]></>, /tab-./g, function (m) util.isOS("Darwin") ? "tab-mac" : m),
        false, true);

        // hide tabs initially to prevent flickering when 'stal' would hide them
        // on startup
        if (config.hasTabbrowser)
            config.tabStrip.collapsed = true;

        this.tabStyle = styles.addSheet(true, "tab-strip-hiding", config.styleableChrome,
                                        (config.tabStrip.id ? "#" + config.tabStrip.id : ".tabbrowser-strip") +
                                            "{ visibility: collapse; }",
                                        false, true)

        dactyl.commands["tabs.select"] = function (event) {
            tabs.select(event.originalTarget.getAttribute("identifier"));
        };
    },

    _updateTabCount: function () {
        statusline.updateTabCount(true);
    },

    _onTabSelect: function () {
        // TODO: is all of that necessary?
        //       I vote no. --Kris
        modes.reset();
        statusline.updateTabCount(true);
        this.updateSelectionHistory();
    },

    get allTabs() Array.slice(config.tabbrowser.tabContainer.childNodes),

    /**
     * @property {Object} The previously accessed tab or null if no tab
     *     other than the current one has been accessed.
     */
    get alternate() this.allTabs.indexOf(this._alternates[1]) > -1 ? this._alternates[1] : null,

    /**
     * @property {Iterator(Object)} A genenerator that returns all browsers
     *     in the current window.
     */
    get browsers() {
        let browsers = config.tabbrowser.browsers;
        for (let i = 0; i < browsers.length; i++)
            yield [i, browsers[i]];
    },

    /**
     * @property {number} The number of tabs in the current window.
     */
    get count() config.tabbrowser.mTabs.length,

    /**
     * @property {Object} The local options store for the current tab.
     */
    get options() {
        let store = this.localStore;
        if (!("options" in store))
            store.options = {};
        return store.options;
    },

    get visibleTabs() config.tabbrowser.visibleTabs || this.allTabs.filter(function (tab) !tab.hidden),

    /**
     * Returns the local state store for the tab at the specified
     * <b>tabIndex</b>. If <b>tabIndex</b> is not specified then the
     * current tab is used.
     *
     * @param {number} tabIndex
     * @returns {Object}
     */
    // FIXME: why not a tab arg? Why this and the property?
    //      : To the latter question, because this works for any tab, the
    //        property doesn't. And the property is so oft-used that it's
    //        convenient. To the former question, because I think this is mainly
    //        useful for autocommands, and they get index arguments. --Kris
    getLocalStore: function (tabIndex) {
        let tab = this.getTab(tabIndex);
        if (!tab.dactylStore)
            tab.dactylStore = {};
        return tab.dactylStore;
    },

    /**
     * @property {Object} The local state store for the currently selected
     *     tab.
     */
    get localStore() this.getLocalStore(),

    /**
     * @property {Object[]} The array of closed tabs for the current
     *     session.
     */
    get closedTabs() services.get("json").decode(services.get("sessionStore").getClosedTabData(window)),

    /**
     * Clones the specified <b>tab</b> and append it to the tab list.
     *
     * @param {Object} tab The tab to clone.
     * @param {boolean} activate Whether to select the newly cloned tab.
     */
    cloneTab: function (tab, activate) {
        let newTab = config.tabbrowser.addTab();
        Tabs.copyTab(newTab, tab);

        if (activate)
            config.tabbrowser.mTabContainer.selectedItem = newTab;

        return newTab;
    },

    /**
     * Detaches the specified <b>tab</b> and open it in a new window. If no
     * tab is specified the currently selected tab is detached.
     *
     * @param {Object} tab The tab to detach.
     */
    detachTab: function (tab) {
        if (!tab)
            tab = config.tabbrowser.mTabContainer.selectedItem;

        services.get("windowWatcher")
                .openWindow(window, window.getBrowserURL(), null, "chrome,dialog=no,all", tab);
    },

    /**
     * Returns the index of the tab containing <b>content</b>.
     *
     * @param {Object} content Either a content window or a content
     *     document.
     */
    // FIXME: Only called once...necessary?
    getContentIndex: function (content) {
        for (let [i, browser] in this.browsers) {
            if (browser.contentWindow == content || browser.contentDocument == content)
                return i;
        }
        return -1;
    },

    /**
     * If TabView exists, returns the Panorama window. If the Panorama
     * is has not yet initialized, this function will not return until
     * it has.
     *
     * @returns {Window}
     */
    getGroups: function () {
        if ("_groups" in this)
            return this._groups;
        if (window.TabView && TabView._initFrame)
            TabView._initFrame();
        let iframe = document.getElementById("tab-view");
        this._groups = this._groups = iframe ? iframe.contentWindow : null;
        while (this._groups && !this._groups.TabItems)
            util.threadYield(false, true);
        return this._groups;
    },

    /**
     * Returns the tab at the specified <b>index</b> or the currently
     * selected tab if <b>index</b> is not specified. This is a 0-based
     * index.
     *
     * @param {number|Node} index The index of the tab required or the tab itself
     * @returns {Object}
     */
    getTab: function (index) {
        if (index instanceof Node)
            return index;
        if (index != null)
            return config.tabbrowser.mTabs[index];
        return config.tabbrowser.mCurrentTab;
    },

    /**
     * Returns the index of <b>tab</b> or the index of the currently
     * selected tab if <b>tab</b> is not specified. This is a 0-based
     * index.
     *
     * @param {<xul:tab/>} tab A tab from the current tab list.
     * @param {boolean} visible Whether to consider only visible tabs.
     * @returns {number}
     */
    index: function (tab, visible) {
        let tabs = this[visible ? "visibleTabs" : "allTabs"];
        return tabs.indexOf(tab || config.tabbrowser.mCurrentTab);
    },

    /**
     * @param spec can either be:
     * - an absolute integer
     * - "" for the current tab
     * - "+1" for the next tab
     * - "-3" for the tab, which is 3 positions left of the current
     * - "$" for the last tab
     */
    indexFromSpec: function (spec, wrap) {
        if (spec instanceof Node)
            return this.allTabs.indexOf(spec);

        let tabs     = this.visibleTabs;
        let position = this.index(null, true);

        if (spec == null || spec === "")
            return position;

        if (typeof spec === "number")
            position = spec;
        else if (spec === "$")
            position = tabs.length - 1;
        else if (/^[+-]\d+$/.test(spec))
            position += parseInt(spec, 10);
        else if (/^\d+$/.test(spec))
            position = parseInt(spec, 10);
        else
            return -1;

        if (position >= tabs.length)
            position = wrap ? position % tabs.length : tabs.length - 1;
        else if (position < 0)
            position = wrap ? (position % tabs.length) + tabs.length : 0;

        return this.allTabs.indexOf(tabs[position]);
    },

    /**
     * Removes all tabs from the tab list except the specified <b>tab</b>.
     *
     * @param {Object} tab The tab to keep.
     */
    keepOnly: function (tab) {
        config.tabbrowser.removeAllTabsBut(tab);
    },

    /**
     * Lists all tabs matching <b>filter</b>.
     *
     * @param {string} filter A filter matching a substring of the tab's
     *     document title or URL.
     */
    list: function (filter) {
        completion.listCompleter("buffer", filter);
    },

    /**
     * Moves a tab to a new position in the tab list.
     *
     * @param {Object} tab The tab to move.
     * @param {string} spec See {@link Tabs.indexFromSpec}.
     * @param {boolean} wrap Whether an out of bounds <b>spec</b> causes
     *     the destination position to wrap around the start/end of the tab
     *     list.
     */
    move: function (tab, spec, wrap) {
        let index = tabs.indexFromSpec(spec, wrap);
        config.tabbrowser.moveTabTo(tab, index);
    },

    /**
     * Removes the specified <b>tab</b> from the tab list.
     *
     * @param {Object} tab The tab to remove.
     * @param {number} count How many tabs to remove.
     * @param {boolean} focusLeftTab Focus the tab to the left of the removed tab.
     */
    remove: function (tab, count, focusLeftTab) {
        count = count || 1;
        let res = this.count > count;

        let tabs = this.visibleTabs;
        if (tabs.indexOf(tab) < 0)
            tabs = this.allTabs;
        let index = tabs.indexOf(tab);

        let next = index + (focusLeftTab ? -count : count);
        if (!(next in tabs))
            next = index + (focusLeftTab ? 1 : -1);
        if (next in tabs) {
            this._alternates[0] = tabs[next];
            config.tabbrowser.mTabContainer.selectedItem = tabs[next];
        }

        if (focusLeftTab)
            tabs.slice(Math.max(0, index + 1 - count), index + 1).forEach(config.removeTab);
        else
            tabs.slice(index, index + count).forEach(config.removeTab);
        return res;
    },

    /**
     * Reloads the specified tab.
     *
     * @param {Object} tab The tab to reload.
     * @param {boolean} bypassCache Whether to bypass the cache when
     *     reloading.
     */
    reload: function (tab, bypassCache) {
        if (bypassCache) {
            const flags = Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_PROXY | Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE;
            config.tabbrowser.getBrowserForTab(tab).reloadWithFlags(flags);
        }
        else
            config.tabbrowser.reloadTab(tab);
    },

    /**
     * Reloads all tabs.
     *
     * @param {boolean} bypassCache Whether to bypass the cache when
     *     reloading.
     */
    reloadAll: function (bypassCache) {
        if (bypassCache) {
            for (let i = 0; i < config.tabbrowser.mTabs.length; i++) {
                try {
                    this.reload(config.tabbrowser.mTabs[i], bypassCache);
                }
                catch (e) {
                    // FIXME: can we do anything useful here without stopping the
                    //        other tabs from reloading?
                }
            }
        }
        else
            config.tabbrowser.reloadAllTabs();
    },

    /**
     * Selects the tab at the position specified by <b>spec</b>.
     *
     * @param {string} spec See {@link Tabs.indexFromSpec}
     * @param {boolean} wrap Whether an out of bounds <b>spec</b> causes
     *     the selection position to wrap around the start/end of the tab
     *     list.
     */
    select: function (spec, wrap) {
        let index = tabs.indexFromSpec(spec, wrap);
        if (index == -1)
            dactyl.beep();
        else
            config.tabbrowser.mTabContainer.selectedIndex = index;
    },

    /**
     * Selects the alternate tab.
     */
    selectAlternateTab: function () {
        dactyl.assert(tabs.alternate != null && tabs.getTab() != tabs.alternate,
            "E23: No alternate page");
        tabs.select(tabs.alternate);
    },

    /**
     * Stops loading the specified tab.
     *
     * @param {Object} tab The tab to stop loading.
     */
    stop: function (tab) {
        if (config.stop)
            config.stop(tab);
        else
            tab.linkedBrowser.stop();
    },

    /**
     * Stops loading all tabs.
     */
    stopAll: function () {
        for (let [, browser] in this.browsers)
            browser.stop();
    },

    /**
     * Selects the tab containing the specified <b>buffer</b>.
     *
     * @param {string} buffer A string which matches the URL or title of a
     *     buffer, if it is null, the last used string is used again.
     * @param {boolean} allowNonUnique Whether to select the first of
     *     multiple matches.
     * @param {number} count If there are multiple matches select the
     *     count'th match.
     * @param {boolean} reverse Whether to search the buffer list in
     *     reverse order.
     *
     */
    // FIXME: help!
    switchTo: function (buffer, allowNonUnique, count, reverse) {
        if (buffer == "")
            return;

        if (buffer != null) {
            // store this command, so it can be repeated with "B"
            this._lastBufferSwitchArgs = buffer;
            this._lastBufferSwitchSpecial = allowNonUnique;
        }
        else {
            buffer = this._lastBufferSwitchArgs;
            if (allowNonUnique == null) // XXX
                allowNonUnique = this._lastBufferSwitchSpecial;
        }

        if (buffer == "#") {
            tabs.selectAlternateTab();
            return;
        }

        count = Math.max(1, count || 1);
        reverse = Boolean(reverse);

        let matches = buffer.match(/^(\d+):?/);
        if (matches) {
            tabs.select(this.allTabs[parseInt(matches[1], 10) - 1], false);
            return;
        }

        matches = [];
        let lowerBuffer = buffer.toLowerCase();
        let first = tabs.index() + (reverse ? 0 : 1);
        let allTabs = tabs.allTabs;
        for (let [i, ] in Iterator(tabs.allTabs)) {
            let tab = allTabs[(i + first) % allTabs.length];
            let url = tab.linkedBrowser.contentDocument.location.href;
            if (url == buffer)
                return tabs.select(index, false);

            if (url.indexOf(buffer) >= 0 || tab.label.toLowerCase().indexOf(lowerBuffer) >= 0)
                matches.push(tab);
        }

        if (matches.length == 0)
            dactyl.echoerr("E94: No matching buffer for " + buffer);
        else if (matches.length > 1 && !allowNonUnique)
            dactyl.echoerr("E93: More than one match for " + buffer);
        else {
            let index = (count - 1) % matches.length;
            if (reverse)
                index = matches.length - count;
            tabs.select(matches[index], false);
        }
    },

    // NOTE: when restarting a session FF selects the first tab and then the
    // tab that was selected when the session was created.  As a result the
    // alternate after a restart is often incorrectly tab 1 when there
    // shouldn't be one yet.
    /**
     * Sets the current and alternate tabs, updating the tab selection
     * history.
     *
     * @param {Array(Object)} tabs The current and alternate tab.
     * @see tabs#alternate
     */
    updateSelectionHistory: function (tabs) {
        if (!tabs) {
            if (this.getTab() == this._alternates[0]
                || this.alternate && this.allTabs.indexOf(this._alternates[0]) == -1
                || this.alternate && config.tabbrowser._removingTabs && config.tabbrowser._removingTabs.indexOf(this._alternates[0]) >= 0)
                tabs = [this.getTab(), this.alternate];
        }
        this._alternates = tabs || [this.getTab(), this._alternates[0]];
    }
}, {
    copyTab: function (to, from) {
        if (!from)
            from = config.tabbrowser.mTabContainer.selectedItem;

        let tabState = services.get("sessionStore").getTabState(from);
        services.get("sessionStore").setTabState(to, tabState);
    }
}, {
    commands: function () {
        commands.add(["bd[elete]", "bw[ipeout]", "bun[load]", "tabc[lose]"],
            "Delete current buffer",
            function (args) {
                let special = args.bang;
                let count   = args.count;
                let arg     = args[0] || "";

                if (arg) {
                    let removed = 0;
                    let matches = arg.match(/^(\d+):?/);

                    if (matches) {
                        tabs.remove(tabs.getTab(parseInt(matches[1], 10) - 1));
                        removed = 1;
                    }
                    else {
                        let str = arg.toLowerCase();
                        let browsers = config.tabbrowser.browsers;

                        for (let i = browsers.length - 1; i >= 0; i--) {
                            let host, title, uri = browsers[i].currentURI.spec;
                            if (browsers[i].currentURI.schemeIs("about")) {
                                host = "";
                                title = "(Untitled)";
                            }
                            else {
                                host = browsers[i].currentURI.host;
                                title = browsers[i].contentTitle;
                            }

                            [host, title, uri] = [host, title, uri].map(String.toLowerCase);

                            if (host.indexOf(str) >= 0 || uri == str ||
                                (special && (title.indexOf(str) >= 0 || uri.indexOf(str) >= 0))) {
                                tabs.remove(tabs.getTab(i));
                                removed++;
                            }
                        }
                    }

                    if (removed > 0)
                        dactyl.echomsg(removed + " fewer tab(s)", 9);
                    else
                        dactyl.echoerr("E94: No matching tab for " + arg);
                }
                else // just remove the current tab
                    tabs.remove(tabs.getTab(), Math.max(count, 1), special);
            }, {
                argCount: "?",
                bang: true,
                count: true,
                completer: function (context) completion.buffer(context),
                literal: 0,
                privateData: true
            });

        commands.add(["keepa[lt]"],
            "Execute a command without changing the current alternate buffer",
            function (args) {
                let alternate = tabs.alternate;

                try {
                    dactyl.execute(args[0] || "", null, true);
                }
                finally {
                    tabs.updateSelectionHistory([tabs.getTab(), alternate]);
                }
            }, {
                argCount: "+",
                completer: function (context) completion.ex(context),
                literal: 0,
                subCommand: 0
            });

        // TODO: this should open in a new tab positioned directly after the current one, not at the end
        commands.add(["tab"],
            "Execute a command and tell it to output in a new tab",
            function (args) {
                try {
                    var force = dactyl.forceNewTab;
                    dactyl.forceNewTab = true;
                    dactyl.execute(args[0] || "", null, true);
                }
                finally {
                    dactyl.forceNewTab = force;
                }
            }, {
                argCount: "+",
                completer: function (context) completion.ex(context),
                literal: 0,
                subCommand: 0
            });

        commands.add(["tabd[o]", "bufd[o]"],
            "Execute a command in each tab",
            function (args) {
                for (let i = 0; i < tabs.count; i++) {
                    tabs.select(i);
                    dactyl.execute(args[0] || "", null, true);
                }
            }, {
                argCount: "1",
                completer: function (context) completion.ex(context),
                literal: 0,
                subCommand: 0
            });

        commands.add(["tabl[ast]", "bl[ast]"],
            "Switch to the last tab",
            function () tabs.select("$", false),
            { argCount: "0" });

        // TODO: "Zero count" if 0 specified as arg
        commands.add(["tabp[revious]", "tp[revious]", "tabN[ext]", "tN[ext]", "bp[revious]", "bN[ext]"],
            "Switch to the previous tab or go [count] tabs back",
            function (args) {
                let count = args.count;
                let arg   = args[0];

                // count is ignored if an arg is specified, as per Vim
                if (arg) {
                    if (/^\d+$/.test(arg))
                        tabs.select("-" + arg, true);
                    else
                        dactyl.echoerr("E488: Trailing characters");
                }
                else if (count > 0)
                    tabs.select("-" + count, true);
                else
                    tabs.select("-1", true);
            }, {
                argCount: "?",
                count: true
            });

        // TODO: "Zero count" if 0 specified as arg
        commands.add(["tabn[ext]", "tn[ext]", "bn[ext]"],
            "Switch to the next or [count]th tab",
            function (args) {
                let count = args.count;
                let arg   = args[0];

                if (arg || count > 0) {
                    let index;

                    // count is ignored if an arg is specified, as per Vim
                    if (arg) {
                        dactyl.assert(/^\d+$/.test(arg), "E488: Trailing characters");
                        index = arg - 1;
                    }
                    else
                        index = count - 1;

                    if (index < tabs.count)
                        tabs.select(index, true);
                    else
                        dactyl.beep();
                }
                else
                    tabs.select("+1", true);
            }, {
                argCount: "?",
                count: true
            });

        commands.add(["tabr[ewind]", "tabfir[st]", "br[ewind]", "bf[irst]"],
            "Switch to the first tab",
            function () { tabs.select(0, false); },
            { argCount: "0" });

        if (config.hasTabbrowser) {
            // TODO: "Zero count" if 0 specified as arg, multiple args and count ranges?
            commands.add(["b[uffer]"],
                "Switch to a buffer",
                function (args) {
                    let special = args.bang;
                    let count   = args.count;
                    let arg     = args[0];

                    // if a numeric arg is specified any count is ignored; if a
                    // count and non-numeric arg are both specified then E488
                    if (arg && count > 0) {
                        dactyl.assert(/^\d+$/.test(arg), "E488: Trailing characters");
                        tabs.switchTo(arg, special);
                    }
                    else if (count > 0)
                        tabs.switchTo(count.toString(), special);
                    else
                        tabs.switchTo(arg, special);
                }, {
                    argCount: "?",
                    bang: true,
                    count: true,
                    completer: function (context) completion.buffer(context),
                    literal: 0,
                    privateData: true
                });

            commands.add(["buffers", "files", "ls", "tabs"],
                "Show a list of all buffers",
                function (args) { tabs.list(args[0] || ""); }, {
                    argCount: "?",
                    literal: 0
                });

            commands.add(["quita[ll]", "qa[ll]"],
                "Quit " + config.appName,
                function (args) { dactyl.quit(false, args.bang); }, {
                    argCount: "0",
                    bang: true
                });

            commands.add(["reloada[ll]"],
                "Reload all tab pages",
                function (args) { tabs.reloadAll(args.bang); }, {
                    argCount: "0",
                    bang: true
                });

            commands.add(["stopa[ll]"],
                "Stop loading all tab pages",
                function () { tabs.stopAll(); },
                { argCount: "0" });

            // TODO: add count support
            commands.add(["tabm[ove]"],
                "Move the current tab after tab N",
                function (args) {
                    let arg = args[0];

                    // FIXME: tabmove! N should probably produce an error
                    dactyl.assert(!arg || /^([+-]?\d+)$/.test(arg),
                        "E488: Trailing characters");

                    // if not specified, move to after the last tab
                    tabs.move(config.tabbrowser.mCurrentTab, arg || "$", args.bang);
                }, {
                    argCount: "?",
                    bang: true
                });

            commands.add(["tabo[nly]"],
                "Close all other tabs",
                function () { tabs.keepOnly(config.tabbrowser.mCurrentTab); },
                { argCount: "0" });

            commands.add(["tabopen", "t[open]", "tabnew"],
                "Open one or more URLs in a new tab",
                function (args) {
                    dactyl.open(args[0] || "about:blank", { from: "tabopen", where: dactyl.NEW_TAB, background: args.bang });
                }, {
                    bang: true,
                    completer: function (context) completion.url(context),
                    domains: function (args) commands.get("open").domains(args),
                    literal: 0,
                    privateData: true
                });

            commands.add(["tabde[tach]"],
                "Detach current tab to its own window",
                function () {
                    dactyl.assert(tabs.count > 1, "Can't detach the last tab");

                    tabs.detachTab(null);
                },
                { argCount: "0" });

            commands.add(["tabdu[plicate]"],
                "Duplicate current tab",
                function (args) {
                    let tab = tabs.getTab();

                    let activate = args.bang ? true : false;
                    if (options.get("activate").has("tabopen"))
                        activate = !activate;

                    for (let i in util.range(0, Math.max(1, args.count)))
                        tabs.cloneTab(tab, activate);
                }, {
                    argCount: "0",
                    bang: true,
                    count: true
                });

            // TODO: match window by title too?
            //     : accept the full :tabmove arg spec for the tab index arg?
            //     : better name or merge with :tabmove?
            commands.add(["taba[ttach]"],
                "Attach the current tab to another window",
                function (args) {
                    dactyl.assert(args.length <= 2 && !args.some(function (i) !/^\d+$/.test(i)),
                        "E488: Trailing characters");

                    let [winIndex, tabIndex] = args.map(parseInt);
                    let win = dactyl.windows[winIndex - 1];

                    dactyl.assert(win, "Window " + winIndex + " does not exist");
                    dactyl.assert(win != window, "Can't reattach to the same window");

                    let browser = win.getBrowser();
                    let dummy = browser.addTab("about:blank");
                    browser.stop();
                    // XXX: the implementation of DnD in tabbrowser.xml suggests
                    // that we may not be guaranteed of having a docshell here
                    // without this reference?
                    browser.docShell;

                    let last = browser.mTabs.length - 1;

                    browser.moveTabTo(dummy, Math.constrain(tabIndex || last, 0, last));
                    browser.selectedTab = dummy; // required
                    browser.swapBrowsersAndCloseOther(dummy, config.tabbrowser.mCurrentTab);
                }, {
                    argCount: "+",
                    completer: function (context, args) {
                        if (args.completeArg == 0) {
                            context.filters.push(function ({ item }) item != window);
                            completion.window(context);
                        }
                    }
                });
        }

        if (dactyl.has("tabs_undo")) {
            commands.add(["u[ndo]"],
                "Undo closing of a tab",
                function (args) {
                    if (args.length)
                        args = args[0];
                    else
                        args = args.count || 0;

                    let m = /^(\d+)(:|$)/.exec(args || '1');
                    if (m)
                        window.undoCloseTab(Number(m[1]) - 1);
                    else if (args) {
                        for (let [i, item] in Iterator(tabs.closedTabs))
                            if (item.state.entries[item.state.index - 1].url == args) {
                                window.undoCloseTab(i);
                                return;
                            }

                        dactyl.echoerr("Exxx: No matching closed tab");
                    }
                }, {
                    argCount: "?",
                    completer: function (context) {
                        context.anchored = false;
                        context.compare = CompletionContext.Sort.unsorted;
                        context.filters = [CompletionContext.Filter.textDescription];
                        context.keys = { text: function ([i, { state: s }]) (i + 1) + ": " + s.entries[s.index - 1].url, description: "[1].title", icon: "[1].image" };
                        context.completions = Iterator(tabs.closedTabs);
                    },
                    count: true,
                    literal: 0,
                    privateData: true
                });

            commands.add(["undoa[ll]"],
                "Undo closing of all closed tabs",
                function (args) {
                    for (let i in Iterator(tabs.closedTabs))
                        window.undoCloseTab(0);

                },
                { argCount: "0" });

        }

        if (dactyl.has("session")) {
            commands.add(["wqa[ll]", "wq", "xa[ll]"],
                "Save the session and quit",
                function () { dactyl.quit(true); },
                { argCount: "0" });
        }
    },
    completion: function () {
        completion.addUrlCompleter("t",
            "Open tabs",
            completion.buffer);
    },
    events: function () {
        let tabContainer = config.tabbrowser.mTabContainer;
        ["TabMove", "TabOpen", "TabClose"].forEach(function (event) {
            events.addSessionListener(tabContainer, event, this.closure._updateTabCount, false);
        }, this);
        events.addSessionListener(tabContainer, "TabSelect", this.closure._onTabSelect, false);
    },
    mappings: function () {
        mappings.add([modes.NORMAL], ["g0", "g^"],
            "Go to the first tab",
            function (count) { tabs.select(0); });

        mappings.add([modes.NORMAL], ["g$"],
            "Go to the last tab",
            function (count) { tabs.select("$"); });

        mappings.add([modes.NORMAL], ["gt"],
            "Go to the next tab",
            function (count) {
                if (count != null)
                    tabs.select(count - 1, false);
                else
                    tabs.select("+1", true);
            },
            { count: true });

        mappings.add([modes.NORMAL], ["<C-n>", "<C-Tab>", "<C-PageDown>"],
            "Go to the next tab",
            function (count) { tabs.select("+" + (count || 1), true); },
            { count: true });

        mappings.add([modes.NORMAL], ["gT", "<C-p>", "<C-S-Tab>", "<C-PageUp>"],
           "Go to previous tab",
            function (count) { tabs.select("-" + (count || 1), true); },
            { count: true });

        if (config.hasTabbrowser) {
            mappings.add([modes.NORMAL], ["b"],
                "Open a prompt to switch buffers",
                function (count) {
                    if (count != null)
                        tabs.switchTo(String(count));
                    else
                        commandline.open(":", "buffer! ", modes.EX);
                },
                { count: true });

            mappings.add([modes.NORMAL], ["B"],
                "Show buffer list",
                function () { tabs.list(false); });

            mappings.add([modes.NORMAL], ["d"],
                "Delete current buffer",
                function (count) { tabs.remove(tabs.getTab(), count, false); },
                { count: true });

            mappings.add([modes.NORMAL], ["D"],
                "Delete current buffer, focus tab to the left",
                function (count) { tabs.remove(tabs.getTab(), count, true); },
                { count: true });

            mappings.add([modes.NORMAL], ["gb"],
                "Repeat last :buffer[!] command",
                function (count) { tabs.switchTo(null, null, count, false); },
                { count: true });

            mappings.add([modes.NORMAL], ["gB"],
                "Repeat last :buffer[!] command in reverse direction",
                function (count) { tabs.switchTo(null, null, count, true); },
                { count: true });

            // TODO: feature dependencies - implies "session"?
            if (dactyl.has("tabs_undo")) {
                mappings.add([modes.NORMAL], ["u"],
                    "Undo closing of a tab",
                    function (count) { commands.get("undo").action({ count: count }); },
                    { count: true });
            }

            mappings.add([modes.NORMAL], ["<C-^>", "<C-6>"],
                "Select the alternate tab or the [count]th tab",
                function (count) {
                    if (count < 1)
                        tabs.selectAlternateTab();
                    else
                        tabs.switchTo(count.toString(), false);
                },
                { count: true });
        }
    },
    options: function () {
        options.add(["showtabline", "stal"],
            "Control when to show the tab bar of opened web pages",
            "number", config.defaults["showtabline"],
            {
                setter: function (value) {
                    let tabStrip = config.tabStrip;

                    if (value == 0)
                        tabs.tabStyle.enabled = true;
                    else {
                        prefs.safeSet("browser.tabs.autoHide", value == 1,
                                      "See 'showtabline' option.");
                        tabs.tabStyle.enabled = false;
                    }

                    tabStrip.collapsed = false;
                    return value;
                },
                completer: function (context) [
                    ["0", "Never show tab bar"],
                    ["1", "Show tab bar only if more than one tab is open"],
                    ["2", "Always show tab bar"]
                ]
            });

        if (config.hasTabbrowser) {
            let activateGroups = [
                ["all", "Activate everything"],
                ["addons", ":addo[ns] command"],
                ["bookmarks", "Tabs loaded from bookmarks", "loadBookmarksInBackground"],
                ["diverted", "Links with targets set to new tabs", "loadDivertedInBackground"],
                ["downloads", ":downl[oads] command"],
                ["extoptions", ":exto[ptions] command"],
                ["help", ":h[elp] command"],
                ["homepage", "gH mapping"],
                ["links", "Middle- or Control-clicked links", "loadInBackground"],
                ["quickmark", "go and gn mappings"],
                ["tabopen", ":tabopen[!] command"],
                ["paste", "P and gP mappings"]
            ];
            options.add(["activate", "act"],
                "Define when tabs are automatically activated",
                "stringlist", [g[0] for (g in values(activateGroups.slice(1))) if (!g[2] || !prefs.get("browser.tabs." + g[2]))].join(","),
                {
                    completer: function (context) activateGroups,
                    has: Option.has.toggleAll,
                    setter: function (newValues) {
                        let valueSet = set(newValues);
                        for (let group in values(activateGroups))
                            if (group[2])
                                prefs.safeSet("browser.tabs." + group[2],
                                              !(valueSet["all"] ^ valueSet[group[0]]),
                                              "See the 'activate' option");
                        return newValues;
                    }
                });

            options.add(["newtab"],
                "Define which commands should output in a new tab by default",
                "stringlist", "",
                {
                    completer: function (context) [
                        ["all", "All commands"],
                        ["addons", ":addo[ns] command"],
                        ["downloads", ":downl[oads] command"],
                        ["extoptions", ":exto[ptions] command"],
                        ["help", ":h[elp] command"],
                        ["javascript", ":javascript! or :js! command"],
                        ["prefs", ":pref[erences]! or :prefs! command"]
                    ],
                    has: Option.has.toggleAll
                });

            // TODO: Is this really applicable to Melodactyl?
            options.add(["popups", "pps"],
                "Where to show requested popup windows",
                "stringlist", "tab",
                {
                    setter: function (values) {
                        let [open, restriction] = [1, 0];
                        for (let [, opt] in Iterator(values)) {
                            if (opt == "tab")
                                open = 3;
                            else if (opt == "window")
                                open = 2;
                            else if (opt == "resized")
                                restriction = 2;
                        }

                        prefs.safeSet("browser.link.open_newwindow", open,
                                      "See 'popups' option.");
                        prefs.safeSet("browser.link.open_newwindow.restriction", restriction,
                                      "See 'popups' option.");
                        return values;
                    },
                    completer: function (context) [
                        ["tab",     "Open popups in a new tab"],
                        ["window",  "Open popups in a new window"],
                        ["resized", "Open resized popups in a new window"]
                    ]
                });
        }
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
