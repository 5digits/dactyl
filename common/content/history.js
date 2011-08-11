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

        let _order = /^([+-])(.+)/.exec(order || "+date");
        dactyl.assert(_order, _("error.invalidSort", order));

        _order = "SORT_BY_" + _order[2].toUpperCase() + "_" +
                    (_order[1] == "+" ? "ASCENDING" : "DESCENDING");
        dactyl.assert(_order in options, _("error.invalidSort", order));

        options.sortingMode = options[_order];
        options.resultType = options.RESULTS_AS_URI;
        if (maxItems > 0)
            options.maxResults = maxItems;

        let root = services.history.executeQuery(query, options).root;
        root.containerOpen = true;
        let items = iter(util.range(0, root.childCount)).map(function (i) {
            let node = root.getChild(i);
            return {
                url: node.uri,
                title: node.title,
                icon: node.icon ? node.icon : DEFAULT_FAVICON
            };
        }).toArray();
        root.containerOpen = false;

        return items;
    },

    get session() {
        let webNav = window.getWebNavigation()
        let sh = webNav.sessionHistory;

        let obj = [];
        obj.__defineGetter__("index", function () sh.index);
        obj.__defineSetter__("index", function (val) { webNav.gotoIndex(val) });
        obj.__iterator__ = function () array.iterItems(this);

        for (let item in iter(sh.SHistoryEnumerator, Ci.nsIHistoryEntry))
            obj.push(update(Object.create(item), {
                index: obj.length,
                icon: Class.memoize(function () services.favicon.getFaviconImageForPage(this.URI).spec)
            }));
        return obj;
    },

    /**
     * Step to the given offset in the history stack.
     *
     * @param {number} steps The possibly negative number of steps to
     *      step.
     * @param {boolean} jumps If true, take into account jumps in the
     *      marks stack. @optional
     */
    stepTo: function stepTo(steps, jumps) {
        if (jumps)
            steps -= marks.jump(steps);
        if (steps == 0)
            return;

        let sh = this.session;
        dactyl.assert(steps > 0 && sh.index < sh.length - 1 || steps < 0 && sh.index > 0);

        try {
            sh.index = Math.constrain(sh.index + steps, 0, sh.length - 1);
        }
        catch (e if e.result == Cr.NS_ERROR_FILE_NOT_FOUND) {}
    },

    /**
     * Search for the *steps*th next *item* in the history list.
     *
     * @param {string} item The nebulously defined item to search for.
     * @param {number} steps The number of steps to step.
     */
    search: function search(item, steps) {
        var ctxt;
        var filter = function (item) true;
        if (item == "domain")
            var filter = function (item) {
                let res = item.URI.hostPort != ctxt;
                ctxt = item.URI.hostPort;
                return res;
            };

        let sh = this.session;
        let idx;
        let sign = steps / Math.abs(steps);

        filter(sh[sh.index]);
        for (let i = sh.index + sign; steps && i >= 0 && i < sh.length; i += sign)
            if (filter(sh[i])) {
                idx = i;
                steps -= sign;
            }

        util.dump(idx, sh.index, sh.length, steps);

        dactyl.assert(idx != null);
        sh.index = idx;
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
            dactyl.echoerr(_("history.noMatching", filter.quote()));
        else
            dactyl.echoerr(_("history.none"));
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
                        dactyl.echoerr(_("history.noURL"));
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
                        dactyl.echoerr(_("history.noURL"));
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
                                  ["+" + order.replace(" ", ""), /*L*/"Sort by " + order + " ascending"],
                                  ["-" + order.replace(" ", ""), /*L*/"Sort by " + order + " descending"]
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
                                         .createStatement("SELECT DISTINCT rev_host FROM moz_places WHERE rev_host IS NOT NULL;")))
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
        function bind() mappings.add.apply(mappings, [config.browserModes].concat(Array.slice(arguments)));

        bind(["<C-o>"], "Go to an older position in the jump list",
             function ({ count }) { history.stepTo(-Math.max(count, 1), true); },
             { count: true });

        bind(["<C-i>"], "Go to a newer position in the jump list",
             function ({ count }) { history.stepTo(Math.max(count, 1), true); },
             { count: true });

        bind(["H", "<A-Left>", "<M-Left>"], "Go back in the browser history",
             function ({ count }) { history.stepTo(-Math.max(count, 1)); },
             { count: true });

        bind(["L", "<A-Right>", "<M-Right>"], "Go forward in the browser history",
             function ({ count }) { history.stepTo(Math.max(count, 1)); },
             { count: true });

        bind(["[d"], "Go back to the previous domain in the browser history",
             function ({ count }) { history.search("domain", -Math.max(count, 1)) },
             { count: true });

        bind(["]d"], "Go forward to the next domain in the browser history",
             function ({ count }) { history.search("domain", Math.max(count, 1)) },
             { count: true });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
