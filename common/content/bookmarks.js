// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

// also includes methods for dealing with keywords and search engines
var Bookmarks = Module("bookmarks", {
    init: function () {
        this.timer = Timer(0, 100, function () {
            this.checkBookmarked(buffer.uri);
        }, this);

        storage.addObserver("bookmark-cache", function (key, event, arg) {
            if (["add", "change", "remove"].indexOf(event) >= 0)
                autocommands.trigger("Bookmark" + util.capitalize(event),
                     iter({
                         bookmark: {
                             toString: function () "bookmarkcache.bookmarks[" + arg.id + "]",
                             valueOf: function () arg
                         }
                     }, arg).toObject());
            bookmarks.timer.tell();
        }, window);
    },

    signals: {
        "browser.locationChange": function (webProgress, request, uri) {
            statusline.bookmarked = false;
            this.checkBookmarked(uri);
        }
    },

    get format() ({
        anchored: false,
        title: ["URL", "Info"],
        keys: { text: "url", description: "title", icon: "icon", extra: "extra", tags: "tags", isURI: function () true },
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
     * @returns {boolean} True if the bookmark was updated, false if a
     *      new bookmark was added.
     */
    add: function add(unfiled, title, url, keyword, tags, force) {
        // FIXME
        if (isObject(unfiled))
            var { id, unfiled, title, url, keyword, tags, post, charset, force } = unfiled;

        let uri = util.createURI(url);
        if (id != null)
            var bmark = bookmarkcache.bookmarks[id];
        else if (!force) {
            if (keyword && hasOwnProperty(bookmarkcache.keywords, keyword))
                bmark = bookmarkcache.keywords[keyword];
            else if (bookmarkcache.isBookmarked(uri))
                for (bmark in bookmarkcache)
                    if (bmark.url == uri.spec)
                        break;
        }

        if (tags) {
            PlacesUtils.tagging.untagURI(uri, null);
            PlacesUtils.tagging.tagURI(uri, tags);
        }

        let updated = !!bmark;
        if (bmark == undefined)
            bmark = bookmarkcache.bookmarks[
                services.bookmarks.insertBookmark(
                     services.bookmarks[unfiled ? "unfiledBookmarksFolder" : "bookmarksMenuFolder"],
                     uri, -1, title || url)];
        else {
            if (title)
                bmark.title = title;
            if (!uri.equals(bmark.uri))
                bmark.uri = uri;
        }

        util.assert(bmark);

        if (charset !== undefined)
            bmark.charset = charset;
        if (post !== undefined)
            bmark.post = post;
        if (keyword)
            bmark.keyword = keyword;

        return updated;
    },

    /**
     * Opens the command line in Ex mode pre-filled with a :bmark
     * command to add a new search keyword for the given form element.
     *
     * @param {Element} elem A form element for which to add a keyword.
     */
    addSearchKeyword: function addSearchKeyword(elem) {
        if (elem instanceof Ci.nsIDOMHTMLFormElement || elem.form)
            var { url, postData, charset } = DOM(elem).formData;
        else
            var [url, postData, charset] = [elem.href || elem.src, null, elem.ownerDocument.characterSet];

        let title = elem.title || elem instanceof Ci.nsIDOMHTMLAnchorElement && elem.textContent.trim();
        let options = { "-title": title || "Search " + elem.ownerDocument.title };

        if (postData != null)
            options["-post"] = postData;
        if (charset != null && charset !== "UTF-8")
            options["-charset"] = charset;

        CommandExMode().open(
            commands.commandToString({ command: "bmark", options: options, arguments: [url] }) + " -keyword ");
    },

    checkBookmarked: function checkBookmarked(uri) {
        if (PlacesUtils.asyncGetBookmarkIds)
            PlacesUtils.asyncGetBookmarkIds(uri, function withBookmarkIDs(ids) {
                statusline.bookmarked = ids.length;
            });
        else
            this.timeout(function () {
                statusline.bookmarked = bookmarkcache.isBookmarked(uri);
            });
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
            dactyl.echomsg({ domains: [util.getHost(url)], message: _("bookmark.removed", url) });
        else {
            let title = buffer.uri.spec == url && buffer.title || url;
            let extra = "";
            if (title != url)
                extra = " (" + title + ")";

            this.add({ unfiled: true, title: title, url: url });
            dactyl.echomsg({ domains: [util.getHost(url)], message: _("bookmark.added", url + extra) });
        }
    },

    isBookmarked: deprecated("bookmarkcache.isBookmarked", { get: function isBookmarked() bookmarkcache.bound.isBookmarked }),

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
                              .filter(bookmarkcache.bound.isRegularBookmark);
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
            if (!alias || !/^[a-z0-9-]+$/.test(alias))
                alias = engine.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/, "").toLowerCase();
            if (!alias)
                alias = "search"; // for search engines which we can't find a suitable alias

            if (hasOwnProperty(aliases, alias))
                alias += ++aliases[alias];
            else
                aliases[alias] = 0;

            return [alias, { keyword: alias, __proto__: engine, title: engine.description, icon: engine.iconURI && engine.iconURI.spec }];
        }).toObject();
    },

    /**
     * Returns true if the given search engine provides suggestions.
     * engine based on the given *query*. The results are always in the
     * form of an array of strings. If *callback* is provided, the
     * request is executed asynchronously and *callback* is called on
     * completion. Otherwise, the request is executed synchronously and
     * the results are returned.
     *
     * @param {string} engineName The name of the search engine from
     *      which to request suggestions.
     * @returns {boolean}
     */
    hasSuggestions: function hasSuggestions(engineName, query, callback) {
        const responseType = "application/x-suggestions+json";

        if (hasOwnProperty(this.suggestionProviders, engineName))
            return true;

        let engine = hasOwnProperty(this.searchEngines, engineName) && this.searchEngines[engineName];
        if (engine && engine.supportsResponseType(responseType))
            return true;

        return false;
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

        if (hasOwnProperty(this.suggestionProviders, engineName))
            return this.suggestionProviders[engineName](query, callback);

        let engine = hasOwnProperty(this.searchEngines, engineName) && this.searchEngines[engineName];
        if (engine && engine.supportsResponseType(responseType))
            var queryURI = engine.getSubmission(query, responseType).uri.spec;

        if (!queryURI)
            return Promise.reject();

        function parse(req) JSON.parse(req.responseText)[1].filter(isString);
        return this.makeSuggestions(queryURI, parse, callback);
    },

    /**
     * Given a query URL, response parser, and optionally a callback,
     * fetch and parse search query results for {@link getSuggestions}.
     *
     * @param {string} url The URL to fetch.
     * @param {function(XMLHttpRequest):[string]} parser The function which
     *      parses the response.
     * @returns {Promise<Array>}
     */
    makeSuggestions: function makeSuggestions(url, parser) {
        let deferred = Promise.defer();

        let req = util.fetchUrl(url);
        req.then(function process(req) {
            let results = [];
            try {
                results = parser(req);
            }
            catch (e) {
                deferred.reject(e);
                return;
            }
            deferred.resolve(results);
        });

        promises.oncancel(deferred, reason => promises.cancel(req, reason));
        return deferred.promise;
    },

    suggestionProviders: {},

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
        let query = (useDefsearch ? options["defsearch"] + " " : "") + text;

        // ripped from Firefox
        var keyword = query;
        var param = "";
        var offset = query.indexOf(" ");
        if (offset > 0) {
            keyword = query.substr(0, offset);
            param = query.substr(offset + 1);
        }

        var engine = hasOwnProperty(bookmarks.searchEngines, keyword) && bookmarks.searchEngines[keyword];
        if (engine) {
            if (engine.searchForm && !param)
                return engine.searchForm;
            let submission = engine.getSubmission(param, null);
            return [submission.uri.spec, submission.postData];
        }

        let [url, postData] = PlacesUtils.getURLAndPostDataForKeyword(keyword);
        if (!url)
            return null;

        let data = window.unescape(postData || "");
        if (/%s/i.test(url) || /%s/i.test(data)) {
            var charset = "";
            var matches = url.match(/^(.*)\&mozcharset=([a-zA-Z][_\-a-zA-Z0-9]+)\s*$/);
            if (matches)
                [, url, charset] = matches;
            else
                try {
                    charset = services.annotation.getPageAnnotation(util.newURI(url),
                                                                    PlacesUtils.CHARSET_ANNO);
                }
                catch (e) {}

            if (charset)
                var encodedParam = escape(window.convertFromUnicode(charset, param)).replace(/\+/g, encodeURIComponent);
            else
                encodedParam = bookmarkcache.keywords[keyword.toLowerCase()].encodeURIComponent(param);

            url = url.replace(/%s/g, () => encodedParam)
                     .replace(/%S/g, () => param);
            if (/%s/i.test(data))
                postData = window.getPostDataStream(data, param, encodedParam, "application/x-www-form-urlencoded");
        }
        else if (param)
            postData = null;

        if (postData)
            return [url, postData];
        return url;
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
            return dactyl.open(items.map(i => i.url), dactyl.NEW_TAB);

        if (filter.length > 0 && tags.length > 0)
            dactyl.echoerr(_("bookmark.noMatching", tags.map(String.quote), filter.quote()));
        else if (filter.length > 0)
            dactyl.echoerr(_("bookmark.noMatchingString", filter.quote()));
        else if (tags.length > 0)
            dactyl.echoerr(_("bookmark.noMatchingTags", tags.map(String.quote)));
        else
            dactyl.echoerr(_("bookmark.none"));
        return null;
    }
}, {
}, {
    commands: function initCommands() {
        // TODO: Clean this up.
        const tags = {
            names: ["-tags", "-T"],
            description: "A comma-separated list of tags",
            completer: function tags(context, args) {
                context.generate = function () array(b.tags
                                                     for (b in bookmarkcache)
                                                     if (b.tags))
                                                  .flatten().uniq().array;
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
                    return [
                        [win.document.title, frames.length == 1 ? /*L*/"Current Location" : /*L*/"Frame: " + win.location.href]
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
            validator: bind("test", /^\S+$/)
        };

        commands.add(["bma[rk]"],
            "Add a bookmark",
            function (args) {
                dactyl.assert(!args.bang || args["-id"] == null,
                              _("bookmark.bangOrID"));

                let opts = {
                    force: args.bang,
                    unfiled: false,
                    id: args["-id"],
                    keyword: args["-keyword"] || null,
                    charset: args["-charset"],
                    post: args["-post"],
                    tags: args["-tags"] || [],
                    title: args["-title"] || (args.length === 0 ? buffer.title : null),
                    url: args.length === 0 ? buffer.uri.spec : args[0]
                };

                let updated = bookmarks.add(opts);
                let action  = updated ? "updated" : "added";

                let extra   = (opts.title && opts.title != opts.url) ? " (" + opts.title + ")" : "";

                dactyl.echomsg({ domains: [util.getHost(opts.url)], message: _("bookmark." + action, opts.url + extra) },
                               1, commandline.FORCE_SINGLELINE);
            }, {
                argCount: "?",
                bang: true,
                completer: function (context, args) {
                    if (!args.bang) {
                        context.title = ["Page URL"];
                        let frames = buffer.allFrames();
                        context.completions = [
                            [win.document.documentURI, frames.length == 1 ? /*L*/"Current Location" : /*L*/"Frame: " + win.document.title]
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
                        validator: io.bound.validateCharset
                    },
                    {
                        names: ["-id"],
                        description: "The ID of the bookmark to update",
                        type: CommandOption.INT
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
                    commandline.input(_("bookmark.prompt.deleteAll") + " ").then(
                        function (resp) {
                            if (resp && resp.match(/^y(es)?$/i)) {
                                bookmarks.remove(Object.keys(bookmarkcache.bookmarks));
                                dactyl.echomsg(_("bookmark.allDeleted"));
                            }
                        });
                else {
                    if (!(args.length || args["-tags"] || args["-keyword"] || args["-title"]))
                        var deletedCount = bookmarks.remove(buffer.uri.spec);
                    else {
                        let context = CompletionContext(args.join(" "));
                        context.fork("bookmark", 0, completion, "bookmark",
                                     args["-tags"], { keyword: args["-keyword"], title: args["-title"] });

                        deletedCount = bookmarks.remove(context.allItems.items
                                                               .map(item => item.item.id));
                    }

                    dactyl.echomsg({ message: _("bookmark.deleted", deletedCount) });
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
    mappings: function initMappings() {
        var myModes = config.browserModes;

        mappings.add(myModes, ["a"],
            "Open a prompt to bookmark the current URL",
            function () {
                let options = {};

                let url = buffer.uri.spec;
                let bmarks = bookmarks.get(url).filter(bmark => bmark.url == url);

                if (bmarks.length == 1) {
                    let bmark = bmarks[0];

                    options["-id"] = bmark.id;
                    options["-title"] = bmark.title;
                    if (bmark.charset)
                        options["-charset"] = bmark.charset;
                    if (bmark.keyword)
                        options["-keyword"] = bmark.keyword;
                    if (bmark.post)
                        options["-post"] = bmark.post;
                    if (bmark.tags.length > 0)
                        options["-tags"] = bmark.tags;
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
    options: function initOptions() {
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

    completion: function initCompletion() {
        completion.bookmark = function bookmark(context, tags, extra={}) {
            context.title = ["Bookmark", "Title"];
            context.format = bookmarks.format;
            iter(extra).forEach(function ([k, v]) {
                if (v != null)
                    context.filters.push(function (item) item.item[k] != null && this.matchString(v, item.item[k]));
            });
            context.generate = () => values(bookmarkcache.bookmarks);
            completion.urls(context, tags);
        };

        completion.search = function search(context, noSuggest) {
            let [, keyword, space, args] = context.filter.match(/^\s*(\S*)(\s*)(.*)$/);
            let keywords = bookmarkcache.keywords;
            let engines = bookmarks.searchEngines;

            context.title = ["Search Keywords"];
            context.completions = iter(values(keywords), values(engines));
            context.keys = { text: "keyword", description: "title", icon: "icon" };

            if (!space || noSuggest)
                return;

            context.fork("suggest", keyword.length + space.length, this, "searchEngineSuggest",
                         keyword, true);

            let item = keywords[keyword];
            if (item && item.url.contains("%s"))
                context.fork("keyword/" + keyword, keyword.length + space.length, null, function (context) {
                    context.format = history.format;
                    context.title = [/*L*/keyword + " Quick Search"];
                    context.keys = { text: "url", description: "title", icon: "icon" };
                    // context.background = true;
                    context.compare = CompletionContext.Sort.unsorted;
                    context.generate = function () {
                        let [begin, end] = item.url.split("%s");

                        return history.get({ uri: util.newURI(begin), uriIsPrefix: true }).map(function (item) {
                            let rest = item.url.length - end.length;
                            let query = item.url.substring(begin.length, rest);
                            if (item.url.substr(rest) == end && query.contains("&"))
                                try {
                                    item.url = decodeURIComponent(query.replace(/[&#].*/, "").replace(/\+/g, " "));
                                    return item;
                                }
                                catch (e) {}
                            return null;
                        }).filter(util.identity);
                    };
                });
        };

        completion.searchEngine = function searchEngine(context, suggest) {
             context.title = ["Suggest Engine", "Description"];
             context.keys = { text: "keyword", description: "title", icon: "icon" };
             context.completions = values(bookmarks.searchEngines);
             if (suggest)
                 context.filters.push(({ item }) => item.supportsResponseType("application/x-suggestions+json"));

        };

        completion.searchEngineSuggest = function searchEngineSuggest(context, engineAliases, kludge) {
            if (!context.filter)
                return;

            let engineList = (engineAliases || options["suggestengines"].join(",") || "google").split(",");

            engineList.forEach(function (name) {
                if (!bookmarks.hasSuggestions(name))
                    return;

                var desc = name;
                let engine = bookmarks.searchEngines[name];
                if (engine)
                    desc = engine.description;


                let [, word] = /^\s*(\S+)/.exec(context.filter) || [];
                if (!kludge && word == name) // FIXME: Check for matching keywords
                    return;

                let ctxt = context.fork(name, 0);

                ctxt.title = [/*L*/desc + " Suggestions"];
                ctxt.keys = { text: util.identity, description: function () "" };
                ctxt.compare = CompletionContext.Sort.unsorted;
                ctxt.filterFunc = null;

                if (ctxt.waitingForTab)
                    return;

                let words = ctxt.filter.toLowerCase().split(/\s+/g);
                ctxt.completions = ctxt.completions.filter(i => words.every(w => i.toLowerCase().contains(w)));

                ctxt.hasItems = ctxt.completions.length;
                ctxt.incomplete = true;
                ctxt.cache.request = bookmarks.getSuggestions(name, ctxt.filter);
                ctxt.cache.request.then(function (compl) {
                    ctxt.incomplete = false;
                    ctxt.completions = array.uniq(ctxt.completions.filter(c => ~compl.indexOf(c))
                                                      .concat(compl), true);
                }).catch(function (e) {
                    ctxt.incomplete = false;
                    ctxt.completions = [];
                    if (e)
                        Cu.reportError(e);
                });
            });
        };

        completion.addUrlCompleter("suggestion", "Search engine suggestions", completion.searchEngineSuggest);
        completion.addUrlCompleter("bookmark", "Bookmarks", completion.bookmark);
        completion.addUrlCompleter("search", "Search engines and keyword URLs", completion.search);
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
