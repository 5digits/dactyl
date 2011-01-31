// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var History = Module("history", {
    get format() bookmarks.format,

    get service() services.history,

    get: function get(filter, maxItems, order) {
        // no query parameters will get all history
        let query = services.history.getNewQuery();
        let options = services.history.getNewQueryOptions();

        if (typeof filter == "string")
            filter = { searchTerms: filter };
        for (let [k, v] in Iterator(filter))
            query[k] = v;

        order = order || "+date";
        dactyl.assert((order = /^([+-])(.+)/.exec(order)) &&
                      (order = "SORT_BY_" + order[2].toUpperCase() + "_" +
                        (order[1] == "+" ? "ASCENDING" : "DESCENDING")) &&
                      order in options,
                     "Invalid sort order");

        options.sortingMode = options[order];
        options.resultType = options.RESULTS_AS_URI;
        if (maxItems > 0)
            options.maxResults = maxItems;

        // execute the query
        let root = services.history.executeQuery(query, options).root;
        root.containerOpen = true;
        let items = iter(util.range(0, root.childCount)).map(function (i) {
            let node = root.getChild(i);
            return {
                url: node.uri,
                title: node.title,
                icon: node.icon ? node.icon.spec : DEFAULT_FAVICON
            };
        }).toArray();
        root.containerOpen = false; // close a container after using it!

        return items;
    },

    get session() {
        let sh = window.getWebNavigation().sessionHistory;
        let obj = [];
        obj.index = sh.index;
        obj.__iterator__ = function () array.iterItems(this);
        for (let i in util.range(0, sh.count)) {
            obj[i] = update(Object.create(sh.getEntryAtIndex(i, false)),
                            { index: i });
            memoize(obj[i], "icon",
                function () services.favicon.getFaviconImageForPage(this.URI).spec);
        }
        return obj;
    },

    stepTo: function stepTo(steps) {
        let start = 0;
        let end = window.getWebNavigation().sessionHistory.count - 1;
        let current = window.getWebNavigation().sessionHistory.index;

        if (current == start && steps < 0 || current == end && steps > 0)
            dactyl.beep();
        else {
            let index = Math.constrain(current + steps, start, end);
            try {
                window.getWebNavigation().gotoIndex(index);
            }
            catch (e) {} // We get NS_ERROR_FILE_NOT_FOUND if files in history don't exist
        }
    },

    goToStart: function goToStart() {
        let index = window.getWebNavigation().sessionHistory.index;

        if (index > 0)
            window.getWebNavigation().gotoIndex(0);
        else
            dactyl.beep();

    },

    goToEnd: function goToEnd() {
        let sh = window.getWebNavigation().sessionHistory;
        let max = sh.count - 1;

        if (sh.index < max)
            window.getWebNavigation().gotoIndex(max);
        else
            dactyl.beep();

    },

    // if openItems is true, open the matching history items in tabs rather than display
    list: function list(filter, openItems, maxItems, sort) {
        // FIXME: returning here doesn't make sense
        //   Why the hell doesn't it make sense? --Kris
        // See comment at bookmarks.list --djk
        if (!openItems)
            return completion.listCompleter("history", filter, maxItems, maxItems, sort);
        let items = completion.runCompleter("history", filter, maxItems, maxItems, sort);

        if (items.length)
            return dactyl.open(items.map(function (i) i.url), dactyl.NEW_TAB);

        if (filter.length > 0)
            dactyl.echoerr("E283: No history matching " + filter.quote());
        else
            dactyl.echoerr("No history set");
        return null;
    }
}, {
}, {
    commands: function () {
        commands.add(["ba[ck]"],
            "Go back in the browser history",
            function (args) {
                let url = args[0];

                if (args.bang)
                    history.goToStart();
                else {
                    if (url) {
                        let sh = history.session;
                        if (/^\d+(:|$)/.test(url) && sh.index - parseInt(url) in sh)
                            return void window.getWebNavigation().gotoIndex(sh.index - parseInt(url));

                        for (let [i, ent] in Iterator(sh.slice(0, sh.index).reverse()))
                            if (ent.URI.spec == url)
                                return void window.getWebNavigation().gotoIndex(i);
                        dactyl.echoerr("Exxx: URL not found in history");
                    }
                    else
                        history.stepTo(-Math.max(args.count, 1));
                }
                return null;
            },
            {
                argCount: "?",
                bang: true,
                completer: function completer(context) {
                    let sh = history.session;

                    context.anchored = false;
                    context.compare = CompletionContext.Sort.unsorted;
                    context.filters = [CompletionContext.Filter.textDescription];
                    context.completions = sh.slice(0, sh.index).reverse();
                    context.keys = { text: function (item) (sh.index - item.index) + ": " + item.URI.spec, description: "title", icon: "icon" };
                },
                count: true,
                literal: 0,
                privateData: true
            });

        commands.add(["fo[rward]", "fw"],
            "Go forward in the browser history",
            function (args) {
                let url = args.literalArg;

                if (args.bang)
                    history.goToEnd();
                else {
                    if (url) {
                        let sh = history.session;
                        if (/^\d+(:|$)/.test(url) && sh.index + parseInt(url) in sh)
                            return void window.getWebNavigation().gotoIndex(sh.index + parseInt(url));

                        for (let [i, ent] in Iterator(sh.slice(sh.index + 1)))
                            if (ent.URI.spec == url)
                                return void window.getWebNavigation().gotoIndex(i);
                        dactyl.echoerr("Exxx: URL not found in history");
                    }
                    else
                        history.stepTo(Math.max(args.count, 1));
                }
                return null;
            },
            {
                argCount: "?",
                bang: true,
                completer: function completer(context) {
                    let sh = history.session;

                    context.anchored = false;
                    context.compare = CompletionContext.Sort.unsorted;
                    context.filters = [CompletionContext.Filter.textDescription];
                    context.completions = sh.slice(sh.index + 1);
                    context.keys = { text: function (item) (item.index - sh.index) + ": " + item.URI.spec, description: "title", icon: "icon" };
                },
                count: true,
                literal: 0,
                privateData: true
            });

        commands.add(["hist[ory]", "hs"],
            "Show recently visited URLs",
            function (args) { history.list(args.join(" "), args.bang, args["-max"], args["-sort"]); }, {
                bang: true,
                completer: function (context, args) completion.history(context, args["-max"], args["-sort"]),
                options: [
                    {
                        names: ["-max", "-m"],
                        description: "The maximum number of items to list",
                        default: 1000,
                        type: CommandOption.INT
                    },
                    {
                        names: ["-sort", "-s"],
                        type: CommandOption.STRING,
                        description: "The sort order of the results",
                        completer: function (context, args) {
                            context.compare = CompletionContext.Sort.unsorted;
                            return array.flatten([
                                "annotation",
                                "date",
                                "date added",
                                "keyword",
                                "last modified",
                                "tags",
                                "title",
                                "uri",
                                "visitcount"
                            ].map(function (order) [
                                  ["+" + order.replace(" ", ""), "Sort by " + order + " ascending"],
                                  ["-" + order.replace(" ", ""), "Sort by " + order + " descending"]
                            ]));
                        }
                    }
                ],
                privateData: true
            });
    },
    completion: function () {
        completion.domain = function (context) {
            context.anchored = false;
            context.compare = function (a, b) String.localeCompare(a.key, b.key);
            context.keys = { text: util.identity, description: util.identity,
                key: function (host) host.split(".").reverse().join(".") };

            // FIXME: Schema-specific
            context.generate = function () [
                Array.slice(row.rev_host).reverse().join("").slice(1)
                for (row in iter(services.history.DBConnection
                                         .createStatement("SELECT DISTINCT rev_host FROM moz_places;")))
            ].slice(2);
        };

        completion.history = function _history(context, maxItems, sort) {
            context.format = history.format;
            context.title = ["History"];
            context.compare = CompletionContext.Sort.unsorted;
            //context.background = true;
            if (maxItems == null)
                context.maxItems = maxItems;
            if (maxItems && context.maxItems == null)
                context.maxItems = 100;
            context.regenerate = true;
            context.generate = function () history.get(context.filter, this.maxItems, sort);
        };

        completion.addUrlCompleter("h", "History", completion.history);
    },
    mappings: function () {
        var myModes = config.browserModes;

        mappings.add(myModes,
            ["<C-o>"], "Go to an older position in the jump list",
            function (args) { history.stepTo(-Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes,
            ["<C-i>"], "Go to a newer position in the jump list",
            function (args) { history.stepTo(Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes,
            ["H", "<A-Left>", "<M-Left>"], "Go back in the browser history",
            function (args) { history.stepTo(-Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes,
            ["L", "<A-Right>", "<M-Right>"], "Go forward in the browser history",
            function (args) { history.stepTo(Math.max(args.count, 1)); },
            { count: true });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
