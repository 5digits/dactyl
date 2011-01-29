// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var DEFAULT_FAVICON = "chrome://mozapps/skin/places/defaultFavicon.png";

// also includes methods for dealing with keywords and search engines
var Bookmarks = Module("bookmarks", {
    init: function () {
        storage.addObserver("bookmark-cache", function (key, event, arg) {
            if (["add", "change", "remove"].indexOf(event) >= 0)
                autocommands.trigger("Bookmark" + event[0].toUpperCase() + event.substr(1),
                     iter({
                         bookmark: {
                             toString: function () "bookmarkcache.bookmarks[" + arg.id + "]",
                             valueOf: function () arg
                         }
                     }, arg));
            statusline.updateUrl();
        }, window);
    },

    get format() ({
        anchored: false,
        title: ["URL", "Info"],
        keys: { text: "url", description: "title", icon: "icon", extra: "extra", tags: "tags" },
        process: [template.icon, template.bookmarkDescription]
    }),

    // TODO: why is this a filter? --djk
    get: function get(filter, tags, maxItems, extra) {
        return completion.runCompleter("bookmark", filter, maxItems, tags, extra);
    },

    /**
     * Adds a new bookmark. The first parameter should be an object with
     * any of the following properties:
     *
     * @param {boolean} unfiled If true, the bookmark is added to the
     *      Unfiled Bookmarks Folder.
     * @param {string} title The title of the new bookmark.
     * @param {string} url The URL of the new bookmark.
     * @param {string} keyword The keyword of the new bookmark.
     *      @optional
     * @param {[string]} tags The tags for the new bookmark.
     *      @optional
     * @param {boolean} force If true, a new bookmark is always added.
     *      Otherwise, if a bookmark for the given URL exists it is
     *      updated instead.
     *      @optional
     * @returns {boolean} True if the bookmark was added or updated
     *      successfully.
     */
    add: function add(unfiled, title, url, keyword, tags, force) {
        // FIXME
        if (isObject(unfiled))
            var { unfiled, title, url, keyword, tags, post, charset, force } = unfiled;

        try {
            let uri = util.createURI(url);
            if (!force && this.isBookmarked(uri))
                for (var bmark in bookmarkcache)
                    if (bmark.url == uri.spec) {
                        if (title)
                            bmark.title = title;
                        break;
                    }

            if (tags) {
                PlacesUtils.tagging.untagURI(uri, null);
                PlacesUtils.tagging.tagURI(uri, tags);
            }
            if (bmark == undefined)
                bmark = bookmarkcache.bookmarks[
                    services.bookmarks.insertBookmark(
                         services.bookmarks[unfiled ? "unfiledBookmarksFolder" : "bookmarksMenuFolder"],
                         uri, -1, title || url)];
            if (!bmark)
                return false;

            if (charset !== undefined)
                bmark.charset = charset;
            if (post !== undefined)
                bmark.post = post;
            if (keyword)
                bmark.keyword = keyword;
        }
        catch (e) {
            util.reportError(e);
            return false;
        }

        return true;
    },

    /**
     * Opens the command line in Ex mode pre-filled with a :bmark
     * command to add a new search keyword for the given form element.
     *
     * @param {Element} elem A form element for which to add a keyword.
     */
    addSearchKeyword: function (elem) {
        if (elem instanceof HTMLFormElement || elem.form)
            var [url, post, charset] = util.parseForm(elem);
        else
            var [url, post, charset] = [elem.href || elem.src, null, elem.ownerDocument.characterSet];

        let options = { "-title": "Search " + elem.ownerDocument.title };
        if (post != null)
            options["-post"] = post;
        if (charset != null && charset !== "UTF-8")
            options["-charset"] = charset;

        CommandExMode().open(
            commands.commandToString({ command: "bmark", options: options, arguments: [url] }) + " -keyword ");
    },

    /**
     * Toggles the bookmarked state of the given URL. If the URL is
     * bookmarked, all bookmarks for said URL are removed.
     * If it is not, a new bookmark is added to the Unfiled Bookmarks
     * Folder. The new bookmark has the title of the current buffer if
     * its URL is identical to *url*, otherwise its title will be the
     * value of *url*.
     *
     * @param {string} url The URL of the bookmark to toggle.
     */
    toggle: function toggle(url) {
        if (!url)
            return;

        let count = this.remove(url);
        if (count > 0)
            dactyl.echomsg({ domains: [util.getHost(url)], message: "Removed bookmark: " + url });
        else {
            let title = buffer.uri.spec == url && buffer.title || url;
            let extra = "";
            if (title != url)
                extra = " (" + title + ")";
            this.add({ unfiled: true, title: title, url: url });
            dactyl.echomsg({ domains: [util.getHost(url)], message: "Added bookmark: " + url + extra });
        }
    },

    /**
     * Returns true if the given URL is bookmarked and that bookmark is
     * not a Live Bookmark.
     *
     * @param {nsIURI|string} url The URL of which to check the bookmarked
     *     state.
     * @returns {boolean}
     */
    isBookmarked: function isBookmarked(uri) {
        if (isString(uri))
            uri = util.newURI(uri);
        try {
            return services.bookmarks
                           .getBookmarkIdsForURI(uri, {})
                           .some(bookmarkcache.closure.isRegularBookmark);
        }
        catch (e) {
            return false;
        }
    },

    /**
     * Remove a bookmark or bookmarks. If *ids* is an array, removes the
     * bookmarks with those IDs. If it is a string, removes all
     * bookmarks whose URLs match that string.
     *
     * @param {string|[number]} ids The IDs or URL of the bookmarks to
     *      remove.
     * @returns {number} The number of bookmarks removed.
     */
    remove: function remove(ids) {
        try {
            if (!isArray(ids)) {
                let uri = util.newURI(ids);
                ids = services.bookmarks
                              .getBookmarkIdsForURI(uri, {})
                              .filter(bookmarkcache.closure.isRegularBookmark);
            }
            ids.forEach(function (id) {
                let bmark = bookmarkcache.bookmarks[id];
                if (bmark) {
                    PlacesUtils.tagging.untagURI(bmark.uri, null);
                    bmark.charset = null;
                }
                services.bookmarks.removeItem(id);
            });
            return ids.length;
        }
        catch (e) {
            dactyl.reportError(e, true);
            return 0;
        }
    },

    getSearchEngines: deprecated("bookmarks.searchEngines", function getSearchEngines() this.searchEngines),
    /**
     * Returns a list of all visible search engines in the search
     * services, augmented with keyword, title, and icon properties for
     * use in completion functions.
     */
    get searchEngines() {
        let searchEngines = [];
        let aliases = {};
        return iter(services.browserSearch.getVisibleEngines({})).map(function ([, engine]) {
            let alias = engine.alias;
            if (!alias || !/^[a-z-]+$/.test(alias))
                alias = engine.name.replace(/[^a-z_-]+/gi, "-").replace(/^-|-$/, "").toLowerCase();
            if (!alias)
                alias = "search"; // for search engines which we can't find a suitable alias

            if (set.has(aliases, alias))
                alias += ++aliases[alias];
            else
                aliases[alias] = 0;

            return [alias, { keyword: alias, __proto__: engine, title: engine.description, icon: engine.iconURI && engine.iconURI.spec }];
        }).toObject();
    },

    /**
     * Retrieves a list of search suggestions from the named search
     * engine based on the given *query*. The results are always in the
     * form of an array of strings. If *callback* is provided, the
     * request is executed asynchronously and *callback* is called on
     * completion. Otherwise, the request is executed synchronously and
     * the results are returned.
     *
     * @param {string} engineName The name of the search engine from
     *      which to request suggestions.
     * @param {string} query The query string for which to request
     *      suggestions.
     * @param {function([string])} callback The function to call when
     *      results are returned.
     * @returns {[string] | null}
     */
    getSuggestions: function getSuggestions(engineName, query, callback) {
        const responseType = "application/x-suggestions+json";

        let engine = this.searchEngines[engineName];
        if (engine && engine.supportsResponseType(responseType))
            var queryURI = engine.getSubmission(query, responseType).uri.spec;
        if (!queryURI)
            return (callback || util.identity)([]);

        function process(resp) {
            let results = [];
            try {
                results = JSON.parse(resp.responseText)[1].filter(isString);
            }
            catch (e) {}
            if (callback)
                return callback(results);
            return results;
        }

        let resp = util.httpGet(queryURI, callback && process);
        if (callback)
            return null;
        return process(resp);
    },

    /**
     * Returns an array of bookmark keyword objects.
     * @deprecated
     */
    getKeywords: function getKeywords() bookmarkcache.keywords,

    /**
     * Returns an array containing a search URL and POST data for the
     * given search string. If *useDefsearch* is true, the string is
     * always passed to the default search engine. If it is not, the
     * search engine name is retrieved from the first space-separated
     * token of the given string.
     *
     * Returns null if no search engine is found for the passed string.
     *
     * @param {string} text The text for which to retrieve a search URL.
     * @param {boolean} useDefsearch Whether to use the default search
     *      engine.
     * @returns {[string, string | null] | null}
     */
    getSearchURL: function getSearchURL(text, useDefsearch) {
        let searchString = (useDefsearch ? options["defsearch"] + " " : "") + text;

        // ripped from Firefox
        function getShortcutOrURI(url) {
            var keyword = url;
            var param = "";
            var offset = url.indexOf(" ");
            if (offset > 0) {
                keyword = url.substr(0, offset);
                param = url.substr(offset + 1);
            }

            var engine = bookmarks.searchEngines[keyword];
            if (engine) {
                if (engine.searchForm && !param)
                    return [engine.searchForm, null];
                let submission = engine.getSubmission(param, null);
                return [submission.uri.spec, submission.postData];
            }

            let [shortcutURL, postData] = PlacesUtils.getURLAndPostDataForKeyword(keyword);
            if (!shortcutURL)
                return [url, null];
            let bmark = bookmarkcache.keywords[keyword];

            let data = window.unescape(postData || "");
            if (/%s/i.test(shortcutURL) || /%s/i.test(data)) {
                var charset = "";
                var matches = shortcutURL.match(/^(.*)\&mozcharset=([a-zA-Z][_\-a-zA-Z0-9]+)\s*$/);
                if (matches)
                    [, shortcutURL, charset] = matches;
                else
                    try {
                        charset = services.history.getCharsetForURI(util.newURI(shortcutURL));
                    }
                    catch (e) {}
                if (charset)
                    var encodedParam = escape(window.convertFromUnicode(charset, param));
                else
                    encodedParam = bmark.encodeURIComponent(param);

                shortcutURL = shortcutURL.replace(/%s/g, encodedParam).replace(/%S/g, param);
                if (/%s/i.test(data))
                    postData = window.getPostDataStream(data, param, encodedParam, "application/x-www-form-urlencoded");
            }
            else if (param)
                return [shortcutURL, null];
            return [shortcutURL, postData];
        }

        let [url, postData] = getShortcutOrURI(searchString);

        if (url == searchString)
            return null;
        if (postData)
            return [url, postData];
        return url; // can be null
    },

    /**
     * Lists all bookmarks whose URLs match *filter*, tags match *tags*,
     * and other properties match the properties of *extra*. If
     * *openItems* is true, the items are opened in tabs rather than
     * listed.
     *
     * @param {string} filter A URL filter string which the URLs of all
     *      matched items must contain.
     * @param {[string]} tags An array of tags each of which all matched
     *      items must contain.
     * @param {boolean} openItems If true, items are opened rather than
     *      listed.
     * @param {object} extra Extra properties which must be matched.
     */
    list: function list(filter, tags, openItems, maxItems, extra) {
        // FIXME: returning here doesn't make sense
        //   Why the hell doesn't it make sense? --Kris
        // Because it unconditionally bypasses the final error message
        // block and does so only when listing items, not opening them. In
        // short it breaks the :bmarks command which doesn't make much
        // sense to me but I'm old-fashioned. --djk
        if (!openItems)
            return completion.listCompleter("bookmark", filter, maxItems, tags, extra);
        let items = completion.runCompleter("bookmark", filter, maxItems, tags, extra);

        if (items.length)
            return dactyl.open(items.map(function (i) i.url), dactyl.NEW_TAB);

        if (filter.length > 0 && tags.length > 0)
            dactyl.echoerr("E283: No bookmarks matching tags: " + tags.map(String.quote) + " and string: " + filter.quote());
        else if (filter.length > 0)
            dactyl.echoerr("E283: No bookmarks matching string: " + filter.quote());
        else if (tags.length > 0)
            dactyl.echoerr("E283: No bookmarks matching tags: " + tags.map(String.quote));
        else
            dactyl.echoerr("No bookmarks set");
        return null;
    }
}, {
}, {
    commands: function () {
        commands.add(["ju[mps]"],
            "Show jumplist",
            function () {
                let sh = history.session;
                commandline.commandOutput(template.jumps(sh.index, sh));
            },
            { argCount: "0" });

        // TODO: Clean this up.
        const tags = {
            names: ["-tags", "-T"],
            description: "A comma-separated list of tags",
            completer: function tags(context, args) {
                context.generate = function () array(b.tags for (b in bookmarkcache) if (b.tags)).flatten().uniq().array;
                context.keys = { text: util.identity, description: util.identity };
            },
            type: CommandOption.LIST
        };

        const title = {
            names: ["-title", "-t"],
            description: "Bookmark page title or description",
            completer: function title(context, args) {
                let frames = buffer.allFrames();
                if (!args.bang)
                    return  [
                        [win.document.title, frames.length == 1 ? "Current Location" : "Frame: " + win.location.href]
                        for ([, win] in Iterator(frames))];
                context.keys.text = "title";
                context.keys.description = "url";
                return bookmarks.get(args.join(" "), args["-tags"], null, { keyword: args["-keyword"], title: context.filter });
            },
            type: CommandOption.STRING
        };

        const post = {
            names: ["-post", "-p"],
            description: "Bookmark POST data",
            completer: function post(context, args) {
                context.keys.text = "post";
                context.keys.description = "url";
                return bookmarks.get(args.join(" "), args["-tags"], null, { keyword: args["-keyword"], post: context.filter });
            },
            type: CommandOption.STRING
        };

        const keyword = {
            names: ["-keyword", "-k"],
            description: "Keyword by which this bookmark may be opened (:open {keyword})",
            completer: function keyword(context, args) {
                context.keys.text = "keyword";
                return bookmarks.get(args.join(" "), args["-tags"], null, { keyword: context.filter, title: args["-title"] });
            },
            type: CommandOption.STRING,
            validator: function (arg) /^\S+$/.test(arg)
        };

        commands.add(["bma[rk]"],
            "Add a bookmark",
            function (args) {
                let opts = {
                    force: args.bang,
                    unfiled: false,
                    keyword: args["-keyword"] || null,
                    charset: args["-charset"],
                    post: args["-post"],
                    tags: args["-tags"] || [],
                    title: args["-title"] || (args.length === 0 ? buffer.title : null),
                    url: args.length === 0 ? buffer.uri.spec : args[0]
                };

                if (bookmarks.add(opts)) {
                    let extra = (opts.title == opts.url) ? "" : " (" + opts.title + ")";
                    dactyl.echomsg({ domains: [util.getHost(opts.url)], message: "Added bookmark: " + opts.url + extra },
                                   1, commandline.FORCE_SINGLELINE);
                }
                else
                    dactyl.echoerr("Exxx: Could not add bookmark " + opts.title.quote(), commandline.FORCE_SINGLELINE);
            }, {
                argCount: "?",
                bang: true,
                completer: function (context, args) {
                    if (!args.bang) {
                        context.title = ["Page URL"];
                        let frames = buffer.allFrames();
                        context.completions = [
                            [win.document.documentURI, frames.length == 1 ? "Current Location" : "Frame: " + win.document.title]
                            for ([, win] in Iterator(frames))];
                        return;
                    }
                    completion.bookmark(context, args["-tags"], { keyword: args["-keyword"], title: args["-title"] });
                },
                options: [keyword, title, tags, post,
                    {
                        names: ["-charset", "-c"],
                        description: "The character encoding of the bookmark",
                        type: CommandOption.STRING,
                        completer: function (context) completion.charset(context),
                        validator: Option.validateCompleter
                    }
                ]
            });

        commands.add(["bmarks"],
            "List or open multiple bookmarks",
            function (args) {
                bookmarks.list(args.join(" "), args["-tags"] || [], args.bang, args["-max"],
                               { keyword: args["-keyword"], title: args["-title"] });
            },
            {
                bang: true,
                completer: function completer(context, args) {
                    context.filter = args.join(" ");
                    completion.bookmark(context, args["-tags"], { keyword: args["-keyword"], title: args["-title"] });
                },
                options: [tags, keyword, title,
                    {
                        names: ["-max", "-m"],
                        description: "The maximum number of items to list or open",
                        type: CommandOption.INT
                    }
                ]
                // Not privateData, since we don't treat bookmarks as private
            });

        commands.add(["delbm[arks]"],
            "Delete a bookmark",
            function (args) {
                if (args.bang)
                    commandline.input("This will delete all bookmarks. Would you like to continue? (yes/[no]) ",
                        function (resp) {
                            if (resp && resp.match(/^y(es)?$/i)) {
                                Object.keys(bookmarkcache.bookmarks).forEach(function (id) { services.bookmarks.removeItem(id); });
                                dactyl.echomsg("All bookmarks deleted", 1, commandline.FORCE_SINGLELINE);
                            }
                        });
                else {
                    if (!(args.length || args["-tags"] || args["-keyword"] || args["-title"]))
                        var deletedCount = bookmarks.remove(buffer.uri.spec);
                    else {
                        let context = CompletionContext(args.join(" "));
                        context.fork("bookmark", 0, completion, "bookmark",
                                     args["-tags"], { keyword: args["-keyword"], title: args["-title"] });
                        var deletedCount = bookmarks.remove(context.allItems.items.map(function (item) item.item.id));
                    }

                    dactyl.echomsg({ message: deletedCount + " bookmark(s) deleted" },
                                   1, commandline.FORCE_SINGLELINE);
                }

            },
            {
                argCount: "?",
                bang: true,
                completer: function completer(context, args)
                    completion.bookmark(context, args["-tags"], { keyword: args["-keyword"], title: args["-title"] }),
                domains: function (args) array.compact(args.map(util.getHost)),
                literal: 0,
                options: [tags, title, keyword],
                privateData: true
            });
    },
    mappings: function () {
        var myModes = config.browserModes;

        mappings.add(myModes, ["a"],
            "Open a prompt to bookmark the current URL",
            function () {
                let options = {};

                let url = buffer.uri.spec;
                let bmarks = bookmarks.get(url).filter(function (bmark) bmark.url == url);

                if (bmarks.length == 1) {
                    let bmark = bmarks[0];

                    options["-title"] = bmark.title;
                    if (bmark.charset)
                        options["-charset"] = bmark.charset;
                    if (bmark.keyword)
                        options["-keyword"] = bmark.keyword;
                    if (bmark.post)
                        options["-post"] = bmark.post;
                    if (bmark.tags.length > 0)
                        options["-tags"] = bmark.tags.join(", ");
                }
                else {
                    if (buffer.title != buffer.uri.spec)
                        options["-title"] = buffer.title;
                    if (content.document.characterSet !== "UTF-8")
                        options["-charset"] = content.document.characterSet;
                }

                CommandExMode().open(
                    commands.commandToString({ command: "bmark", options: options, arguments: [buffer.uri.spec] }));
            });

        mappings.add(myModes, ["A"],
            "Toggle bookmarked state of current URL",
            function () { bookmarks.toggle(buffer.uri.spec); });
    },
    options: function () {
        options.add(["defsearch", "ds"],
            "The default search engine",
            "string", "google",
            {
                completer: function completer(context) {
                    completion.search(context, true);
                    context.completions = [{ keyword: "", title: "Don't perform searches by default" }].concat(context.completions);
                }
            });

        options.add(["suggestengines"],
             "Search engines used for search suggestions",
             "stringlist", "google",
             { completer: function completer(context) completion.searchEngine(context, true), });
    },

    completion: function () {
        completion.bookmark = function bookmark(context, tags, extra) {
            context.title = ["Bookmark", "Title"];
            context.format = bookmarks.format;
            iter(extra || {}).forEach(function ([k, v]) {
                if (v != null)
                    context.filters.push(function (item) item.item[k] != null && this.matchString(v, item.item[k]));
            });
            context.generate = function () values(bookmarkcache.bookmarks);
            completion.urls(context, tags);
        };

        completion.search = function search(context, noSuggest) {
            let [, keyword, space, args] = context.filter.match(/^\s*(\S*)(\s*)(.*)$/);
            let keywords = bookmarks.getKeywords();
            let engines = bookmarks.searchEngines;

            context.title = ["Search Keywords"];
            context.completions = iter(values(keywords), values(engines));
            context.keys = { text: "keyword", description: "title", icon: "icon" };

            if (!space || noSuggest)
                return;

            context.fork("suggest", keyword.length + space.length, this, "searchEngineSuggest",
                         keyword, true);

            let item = keywords[keyword];
            if (item && item.url.indexOf("%s") > -1)
                context.fork("keyword/" + keyword, keyword.length + space.length, null, function (context) {
                    context.format = history.format;
                    context.title = [keyword + " Quick Search"];
                    // context.background = true;
                    context.compare = CompletionContext.Sort.unsorted;
                    context.generate = function () {
                        let [begin, end] = item.url.split("%s");

                        return history.get({ uri: util.newURI(begin), uriIsPrefix: true }).map(function (item) {
                            let rest = item.url.length - end.length;
                            let query = item.url.substring(begin.length, rest);
                            if (item.url.substr(rest) == end && query.indexOf("&") == -1)
                                try {
                                    item.url = decodeURIComponent(query.replace(/#.*/, "").replace(/\+/g, " "));
                                    return item;
                                }
                                catch (e) {}
                            return null;
                        }).filter(util.identity);
                    };
                });
        };

        completion.searchEngine = function searchEngine(context, suggest) {
             let engines = services.browserSearch.getEngines({});
             if (suggest)
                 engines = engines.filter(function (e) e.supportsResponseType("application/x-suggestions+json"));

             context.title = ["Suggest Engine", "Description"];
             context.completions = engines.map(function (e) [e.alias, e.description]);
        };

        completion.searchEngineSuggest = function searchEngineSuggest(context, engineAliases, kludge) {
            if (!context.filter)
                return;

            let engineList = (engineAliases || options["suggestengines"].join(",") || "google").split(",");

            engineList.forEach(function (name) {
                let engine = bookmarks.searchEngines[name];
                if (!engine)
                    return;
                let [, word] = /^\s*(\S+)/.exec(context.filter) || [];
                if (!kludge && word == name) // FIXME: Check for matching keywords
                    return;
                let ctxt = context.fork(name, 0);

                ctxt.title = [engine.description + " Suggestions"];
                ctxt.keys = { text: util.identity, description: function () "" };
                ctxt.compare = CompletionContext.Sort.unsorted;
                ctxt.incomplete = true;
                bookmarks.getSuggestions(name, ctxt.filter, function (compl) {
                    ctxt.incomplete = false;
                    ctxt.completions = compl;
                });
            });
        };

        completion.addUrlCompleter("S", "Suggest engines", completion.searchEngineSuggest);
        completion.addUrlCompleter("b", "Bookmarks", completion.bookmark);
        completion.addUrlCompleter("s", "Search engines and keyword URLs", completion.search);
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
