// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2010 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/**
 * @instance browser
 */
var Browser = Module("browser", {
}, {
    climbUrlPath: function (count) {
        let url = util.newURI(buffer.URL);
        dactyl.assert(url instanceof Ci.nsIURL);

        while (count-- && url.path != "/")
            url.path = url.path.replace(/[^\/]+\/?$/, "");

        dactyl.assert(url.spec != buffer.URL);
        dactyl.open(url.spec);
    },

    incrementURL: function (count) {
        let matches = buffer.URL.match(/(.*?)(\d+)(\D*)$/);
        dactyl.assert(matches);
        let oldNum = matches[2];

        // disallow negative numbers as trailing numbers are often proceeded by hyphens
        let newNum = String(Math.max(parseInt(oldNum, 10) + count, 0));
        if (/^0/.test(oldNum))
            while (newNum.length < oldNum.length)
                newNum = "0" + newNum;

        matches[2] = newNum;
        dactyl.open(matches.slice(1).join(""));
    }
}, {
    options: function () {
        options.add(["encoding", "enc"],
            "The current buffer's character encoding",
            "string", "UTF-8",
            {
                scope: Option.SCOPE_LOCAL,
                getter: function () config.browser.docShell.QueryInterface(Ci.nsIDocCharset).charset,
                setter: function (val) {
                    if (options["encoding"] == val)
                        return val;

                    // Stolen from browser.jar/content/browser/browser.js, more or less.
                    try {
                        config.browser.docShell.QueryInterface(Ci.nsIDocCharset).charset = val;
                        PlacesUtils.history.setCharsetForURI(getWebNavigation().currentURI, val);
                        getWebNavigation().reload(Ci.nsIWebNavigation.LOAD_FLAGS_CHARSET_CHANGE);
                    }
                    catch (e) { dactyl.reportError(e); }
                    return null;
                },
                completer: function (context) completion.charset(context)
            });
    },

    mappings: function () {
        mappings.add([modes.NORMAL],
            ["y"], "Yank current location to the clipboard",
            function () { dactyl.clipboardWrite(buffer.URL, true); });

        // opening websites
        mappings.add([modes.NORMAL],
            ["o"], "Open one or more URLs",
            function () { commandline.open(":", "open ", modes.EX); });

        mappings.add([modes.NORMAL], ["O"],
            "Open one or more URLs, based on current location",
            function () { commandline.open(":", "open " + buffer.URL, modes.EX); });

        mappings.add([modes.NORMAL], ["t"],
            "Open one or more URLs in a new tab",
            function () { commandline.open(":", "tabopen ", modes.EX); });

        mappings.add([modes.NORMAL], ["T"],
            "Open one or more URLs in a new tab, based on current location",
            function () { commandline.open(":", "tabopen " + buffer.URL, modes.EX); });

        mappings.add([modes.NORMAL], ["w"],
            "Open one or more URLs in a new window",
            function () { commandline.open(":", "winopen ", modes.EX); });

        mappings.add([modes.NORMAL], ["W"],
            "Open one or more URLs in a new window, based on current location",
            function () { commandline.open(":", "winopen " + buffer.URL, modes.EX); });

        mappings.add([modes.NORMAL],
            ["<C-a>"], "Increment last number in URL",
            function (count) { Browser.incrementURL(Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL],
            ["<C-x>"], "Decrement last number in URL",
            function (count) { Browser.incrementURL(-Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["~"],
            "Open home directory",
            function () { dactyl.open("~"); });

        mappings.add([modes.NORMAL], ["gh"],
            "Open homepage",
            function () { BrowserHome(); });

        mappings.add([modes.NORMAL], ["gH"],
            "Open homepage in a new tab",
            function () {
                let homepages = gHomeButton.getHomePage();
                dactyl.open(homepages, { from: "homepage", where: dactyl.NEW_TAB });
            });

        mappings.add([modes.NORMAL], ["gu"],
            "Go to parent directory",
            function (count) { Browser.climbUrlPath(Math.max(count, 1)); },
            { count: true });

        mappings.add([modes.NORMAL], ["gU"],
            "Go to the root of the website",
            function () { Browser.climbUrlPath(-1); });

        mappings.add(modes.all, ["<C-l>"],
            "Redraw the screen",
            function () { ex.redraw(); });
    },

    commands: function () {
        commands.add(["downl[oads]", "dl"],
            "Show progress of current downloads",
            function () {
                dactyl.open("chrome://mozapps/content/downloads/downloads.xul",
                    { from: "downloads"});
            },
            { argCount: "0" });

        commands.add(["o[pen]"],
            "Open one or more URLs in the current tab",
            function (args) { dactyl.open(args[0] || "about:blank"); },
            {
                completer: function (context) completion.url(context),
                domains: function (args) array.compact(dactyl.parseURLs(args[0] || "").map(
                    function (url) util.getHost(url))),
                literal: 0,
                privateData: true
            });

        commands.add(["redr[aw]"],
            "Redraw the screen",
            function () {
                window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils)
                      .redraw();
                statusline.updateUrl();
                commandline.clear();
            },
            { argCount: "0" });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
