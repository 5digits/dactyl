// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("completion", {
    exports: ["CompletionContext", "Completion", "completion"]
}, this);

lazyRequire("dom", ["DOM"]);
lazyRequire("messages", ["_", "messages"]);
lazyRequire("template", ["template"]);

/**
 * Creates a new completion context.
 *
 * @class A class to provide contexts for command completion.
 * Manages the filtering and formatting of completions, and keeps
 * track of the positions and quoting of replacement text. Allows for
 * the creation of sub-contexts with different headers and quoting
 * rules.
 *
 * @param {nsIEditor} editor The editor for which completion is
 *     intended. May be a {CompletionContext} when forking a context,
 *     or a {string} when creating a new one.
 * @param {string} name The name of this context. Used when the
 *     context is forked.
 * @param {number} offset The offset from the parent context.
 * @author Kris Maglione <maglione.k@gmail.com>
 * @constructor
 */
var CompletionContext = Class("CompletionContext", {
    init: function cc_init(editor, name="", offset=0) {
        let self = this;
        if (editor instanceof this.constructor) {
            let parent = editor;
            name = parent.name + "/" + name;

            if (this.options) {
                this.autoComplete = this.options.get("autocomplete").getKey(name);
                this.sortResults  = this.options.get("wildsort").getKey(name);
                this.wildcase     = this.options.get("wildcase").getKey(name);
            }

            this.contexts = parent.contexts;
            if (name in this.contexts)
                self = this.contexts[name];
            else
                self.contexts[name] = this;

            /**
             * @property {CompletionContext} This context's parent. {null} when
             *     this is a top-level context.
             */
            self.parent = parent;

            ["filters", "keys", "process", "title", "quote"]
                .forEach(key => self[key] = parent[key] && util.cloneObject(parent[key]));
            ["anchored", "compare", "editor", "_filter", "filterFunc", "forceAnchored", "top"]
                .forEach(key => self[key] = parent[key]);

            self.__defineGetter__("value", function get_value() this.top.value);

            self.offset = parent.offset;
            self.advance(offset);

            /**
             * @property {boolean} Specifies that this context is not finished
             *     generating results.
             * @default false
             */
            self.incomplete = false;
            self.message = null;
            /**
             * @property {boolean} Specifies that this context is waiting for the
             *     user to press <Tab>. Useful when fetching completions could be
             *     dangerous or slow, and the user has enabled autocomplete.
             */
            self.waitingForTab = false;

            self.hasItems = null;

            delete self._generate;
            delete self.ignoreCase;
            if (self != this)
                return self;
            ["_caret", "contextList", "maxItems", "onUpdate", "selectionTypes", "tabPressed", "updateAsync", "value"].forEach(function fe(key) {
                self.__defineGetter__(key, function () this.top[key]);
                self.__defineSetter__(key, function (val) this.top[key] = val);
            });
        }
        else {
            if (typeof editor == "string")
                this._value = editor;
            else
                this.editor = editor;
            /**
             * @property {boolean} Specifies whether this context results must
             *     match the filter at the beginning of the string.
             * @default true
             */
            this.anchored = true;
            this.forceAnchored = null;

            this.compare = function compare(a, b) String.localeCompare(a.text, b.text);
            /**
             * @property {function} This function is called when we close
             *     a completion window with Esc or Ctrl-c. Usually this callback
             *     is only needed for long, asynchronous completions
             */
            this.cancel = null;
            /**
             * @property {[CompletionContext]} A list of active
             *     completion contexts, in the order in which they were
             *     instantiated.
             */
            this.contextList = [];
            /**
             * @property {Object} A map of all contexts, keyed on their names.
             *    Names are assigned when a context is forked, with its specified
             *    name appended, after a '/', to its parent's name. May
             *    contain inactive contexts. For active contexts, see
             *    {@link #contextList}.
             */
            this.contexts = { "": this };
            /**
             * @property {function} The function used to filter the results.
             * @default Selects all results which match every predicate in the
             *     {@link #filters} array.
             */
            this.filterFunc = function filterFunc(items) {
                return this.filters
                           .reduce((res, filter)
                                        => res.filter((item) => filter.call(this, item)),
                                   items);
            };
            /**
             * @property {Array} An array of predicates on which to filter the
             *     results.
             */
            this.filters = [CompletionContext.Filter.text];
            /**
             * @property {Object} A mapping of keys, for {@link #getKey}. Given
             *      { key: value }, getKey(item, key) will return values as such:
             *      if value is a string, it will return item.item[value]. If it's a
             *      function, it will return value(item.item).
             */
            this.keys = { text: 0, description: 1, icon: "icon" };
            /**
             * @property {number} This context's offset from the beginning of
             *     {@link #editor}'s value.
             */
            this.offset = offset;
            /**
             * @property {function} A function which is called when any subcontext
             *     changes its completion list. Only called when
             *     {@link #updateAsync} is true.
             */
            this.onUpdate = function onUpdate() true;

            this.runCount = 0;

            /**
             * @property {CompletionContext} The top-level completion context.
             */
            this.top = this;
            this.__defineGetter__("incomplete", function get_incomplete() this._incomplete
                || this.contextList.some(c => c.parent && c.incomplete));
            this.__defineGetter__("waitingForTab", function get_waitingForTab() this._waitingForTab
                || this.contextList.some(c => c.parent && c.waitingForTab));
            this.__defineSetter__("incomplete", function get_incomplete(val) { this._incomplete = val; });
            this.__defineSetter__("waitingForTab", function get_waitingForTab(val) { this._waitingForTab = val; });
            this.reset();
        }
        /**
         * @property {Object} A general-purpose store for functions which need to
         *     cache data between calls.
         */
        this.cache = {};
        this._cache = {};
        /**
         * @private
         * @property {Object} A cache for return values of {@link #generate}.
         */
        this.itemCache = {};
        /**
         * @property {string} A key detailing when the cached value of
         *     {@link #generate} may be used. Every call to
         *     {@link #generate} stores its result in {@link #itemCache}.
         *     When itemCache[key] exists, its value is returned, and
         *     {@link #generate} is not called again.
         */
        this.key = "";
        /**
         * @property {string} A message to be shown before any results.
         */
        this.message = null;
        this.name = name || "";
        /** @private */
        this._completions = []; // FIXME
        /**
         * Returns a key, as detailed in {@link #keys}.
         * @function
         */
        this.getKey = function getKey(item, key) (typeof self.keys[key] == "function") ? self.keys[key].call(this, item.item) :
                key in self.keys ? item.item[self.keys[key]]
                                 : item.item[key];
        return this;
    },

    __title: Class.Memoize(function __title() this._title.map(s =>
                typeof s == "string" ? messages.get("completion.title." + s, s)
                                     : s)),

    set title(val) {
        delete this.__title;
        return this._title = val;
    },
    get title() this.__title,

    get activeContexts() this.contextList.filter(function f(c) c.items.length),

    // Temporary
    /**
     * @property {Object}
     *
     * An object describing the results from all sub-contexts. Results are
     * adjusted so that all have the same starting offset.
     *
     * @deprecated
     */
    get allItems() {
        let self = this;

        try {
            let allItems = this.contextList.map(function m(context) context.hasItems && context.items.length);
            if (this.cache.allItems && array.equals(this.cache.allItems, allItems))
                return this.cache.allItemsResult;
            this.cache.allItems = allItems;

            let minStart = Math.min.apply(Math, this.activeContexts.map(function m(c) c.offset));
            if (minStart == Infinity)
                minStart = 0;

            this.cache.allItemsResult = memoize({
                start: minStart,

                get longestSubstring() self.longestAllSubstring,

                get items() array.flatten(self.activeContexts.map(function m(context) {
                    let prefix = self.value.substring(minStart, context.offset);

                    return context.items.map(function m(item) ({
                        text: prefix + item.text,
                        result: prefix + item.result,
                        __proto__: item
                    }));
                }))
            });

            return this.cache.allItemsResult;
        }
        catch (e) {
            util.reportError(e);
            return { start: 0, items: [], longestAllSubstring: "" };
        }
    },
    // Temporary
    get allSubstrings() {
        let contexts = this.activeContexts;
        let minStart = Math.min.apply(Math, contexts.map(function m(c) c.offset));
        let lists = contexts.map(function m(context) {
            let prefix = context.value.substring(minStart, context.offset);
            return context.substrings.map(function m(s) prefix + s);
        });

        /* TODO: Deal with sub-substrings for multiple contexts again.
         * Possibly.
         */
        let substrings = lists.reduce(
                function r(res, list) res.filter(function f(str) list.some(function s_(s) s.substr(0, str.length) == str)),
                lists.pop());
        if (!substrings) // FIXME: How is this undefined?
            return [];
        return array.uniq(Array.slice(substrings));
    },
    // Temporary
    get longestAllSubstring() {
        return this.allSubstrings.reduce(function r(a, b) a.length > b.length ? a : b, "");
    },

    get caret() this._caret - this.offset,
    set caret(val) this._caret = val + this.offset,

    get compare() this._compare || function compare() 0,
    set compare(val) this._compare = val,

    get completions() this._completions || [],
    set completions(items) {
        if (items && isArray(items.array))
            items = items.array;
        // Accept a generator
        if (!isArray(items))
            items = [x for (x in Iterator(items || []))];
        if (this._completions !== items) {
            delete this.cache.filtered;
            delete this.cache.filter;
            this.cache.rows = [];
            this._completions = items;
            this.itemCache[this.key] = items;
        }

        if (this._completions)
            this.hasItems = this._completions.length > 0;

        if (this.updateAsync && !this.noUpdate)
            util.trapErrors("onUpdate", this);
    },

    get createRow() this._createRow || template.completionRow, // XXX
    set createRow(createRow) this._createRow = createRow,

    get filterFunc() this._filterFunc || util.identity,
    set filterFunc(val) this._filterFunc = val,

    get filter() this._filter != null ? this._filter : this.value.substr(this.offset, this.caret),
    set filter(val) {
        delete this.ignoreCase;
        return this._filter = val;
    },

    get format() ({
        anchored: this.anchored,
        title: this.title,
        keys: this.keys,
        process: this.process
    }),
    set format(format) {
        this.anchored = format.anchored,
        this.title = format.title || this.title;
        this.keys = format.keys || this.keys;
        this.process = format.process || this.process;
    },

    /**
     * @property {string | xml | null}
     * The message displayed at the head of the completions for the
     * current context.
     */
    get message() this._message || (this.waitingForTab && this.hasItems !== false ? _("completion.waitingFor", "<Tab>") : null),
    set message(val) this._message = val,

    /**
     * The prototype object for items returned by {@link items}.
     */
    get itemPrototype() {
        let self = this;
        let res = { highlight: "" };

        function result(quote) {
            yield ["context", function p_context() self];
            yield ["result", quote ? function p_result() quote[0] + util.trapErrors(1, quote, this.text) + quote[2]
                                   : function p_result() this.text];
            yield ["texts", function p_texts() Array.concat(this.text)];
        };

        for (let i in iter(this.keys, result(this.quote))) {
            let [k, v] = i;
            if (typeof v == "string" && /^[.[]/.test(v))
                // This is only allowed to be a simple accessor, and shouldn't
                // reference any variables. Don't bother with eval context.
                v = Function("i", "return i" + v);
            if (typeof v == "function")
                res.__defineGetter__(k, function p_gf() Class.replaceProperty(this, k, v.call(this, this.item, self)));
            else
                res.__defineGetter__(k, function p_gp() Class.replaceProperty(this, k, this.item[v]));
            res.__defineSetter__(k, function p_s(val) Class.replaceProperty(this, k, val));
        }
        return res;
    },

    /**
     * Returns true when the completions generated by {@link #generate}
     * must be regenerated. May be set to true to invalidate the current
     * completions.
     */
    get regenerate() this._generate && (!this.completions || !this.itemCache[this.key] || this._cache.offset != this.offset),
    set regenerate(val) { if (val) delete this.itemCache[this.key]; },

    /**
     * A property which may be set to a function to generate the value
     * of {@link completions} only when necessary. The generated
     * completions are linked to the value in {@link #key} and may be
     * invalidated by setting the {@link #regenerate} property.
     */
    get generate() this._generate || null,
    set generate(arg) {
        this.hasItems = true;
        this._generate = arg;
    },
    /**
     * Generates the item list in {@link #completions} via the
     * {@link #generate} method if the previously generated value is no
     * longer valid.
     */
    generateCompletions: function generateCompletions() {
        if (this.offset != this._cache.offset || this.lastActivated != this.top.runCount) {
            this.itemCache = {};
            this._cache.offset = this.offset;
            this.lastActivated = this.top.runCount;
        }
        if (!this.itemCache[this.key] && !this.waitingForTab) {
            try {
                let res = this._generate();
                if (res != null)
                    this.itemCache[this.key] = res;
            }
            catch (e) {
                util.reportError(e);
                this.message = _("error.error", e);
            }
        }
        // XXX
        this.noUpdate = true;
        this.completions = this.itemCache[this.key];
        this.noUpdate = false;
    },

    ignoreCase: Class.Memoize(function M() {
        let mode = this.wildcase;
        if (mode == "match")
            return false;
        else if (mode == "ignore")
            return true;
        else
            return !/[A-Z]/.test(this.filter);
    }),

    /**
     * Returns a list of all completion items which match the current
     * filter. The items returned are objects containing one property
     * for each corresponding property in {@link keys}. The returned
     * list is generated on-demand from the item list in {@link completions}
     * or generated by {@link generate}, and is cached as long as no
     * properties which would invalidate the result are changed.
     */
    get items() {
        // Don't return any items if completions or generator haven't
        // been set during this completion cycle.
        if (!this.hasItems)
            return [];

        // Regenerate completions if we must
        if (this.generate)
            this.generateCompletions();
        let items = this.completions;

        // Check for cache miss
        if (this._cache.completions !== this.completions) {
            this._cache.completions = this.completions;
            this._cache.constructed = null;
            this.cache.filtered = null;
        }

        if (this.cache.filtered && this.cache.filter == this.filter)
            return this.cache.filtered;

        this.cache.rows = [];
        this.cache.filter = this.filter;
        if (items == null)
            return null;

        let self = this;
        delete this._substrings;

        if (!this.forceAnchored && this.options)
            this.anchored = this.options.get("wildanchor").getKey(this.name, this.anchored);

        // Item matchers
        if (this.ignoreCase)
            this.matchString = this.anchored ?
                function matchString(filter, str) String.toLowerCase(str).indexOf(filter.toLowerCase()) == 0 :
                function matchString(filter, str) String.toLowerCase(str).indexOf(filter.toLowerCase()) >= 0;
        else
            this.matchString = this.anchored ?
                function matchString(filter, str) String.indexOf(str, filter) == 0 :
                function matchString(filter, str) String.indexOf(str, filter) >= 0;

        // Item formatters
        this.processor = Array.slice(this.process);
        if (!this.anchored)
            this.processor[0] = function processor_0(item, text) self.process[0].call(self, item,
                    template.highlightFilter(item.text, self.filter, null, item.isURI));

        try {
            // Item prototypes
            if (!this._cache.constructed) {
                let proto = this.itemPrototype;
                this._cache.constructed = items.map(function m(item) ({ __proto__: proto, item: item }));
            }

            // Filters
            let filtered = this.filterFunc(this._cache.constructed);
            if (this.maxItems)
                filtered = filtered.slice(0, this.maxItems);

            // Sorting
            if (this.sortResults && this.compare) {
                filtered.sort(this.compare);
                if (!this.anchored) {
                    let filter = this.filter;
                    filtered.sort(function s(a, b) b.text.startsWith(filter) - a.text.startsWith(filter));
                }
            }

            return this.cache.filtered = filtered;
        }
        catch (e) {
            this.message = _("error.error", e);
            util.reportError(e);
            return [];
        }
    },

    /**
     * Returns a list of all substrings common to all items which
     * include the current filter.
     */
    get substrings() {
        let items = this.items;
        if (items.length == 0 || !this.hasItems)
            return [];
        if (this._substrings)
            return this._substrings;

        let fixCase = this.ignoreCase ? String.toLowerCase : util.identity;
        let text   = fixCase(items[0].text);
        let filter = fixCase(this.filter);

        // Exceedingly long substrings cause Gecko to go into convulsions
        if (text.length > 100)
            text = text.substr(0, 100);

        if (this.anchored) {
            var compare = function compare(text, s) text.substr(0, s.length) == s;
            var substrings = [text];
        }
        else {
            var compare = function compare(text, s) text.contains(s);
            var substrings = [];
            let start = 0;
            let idx;
            let length = filter.length;
            while ((idx = text.indexOf(filter, start)) > -1 && idx < text.length) {
                substrings.push(text.substring(idx));
                start = idx + 1;
            }
        }

        substrings = items.reduce(function r(res, item)
            res.map(function m(substring) {
                // A simple binary search to find the longest substring
                // of the given string which also matches the current
                // item's text.
                let len = substring.length;
                let i = 0, n = len + 1;
                let result = n && fixCase(item.result);
                while (n) {
                    let m = Math.floor(n / 2);
                    let keep = compare(result, substring.substring(0, i + m));
                    if (!keep)
                        len = i + m - 1;
                    if (!keep || m == 0)
                        n = m;
                    else {
                        i += m;
                        n = n - m;
                    }
                }
                return len == substring.length ? substring : substring.substr(0, Math.max(len, 0));
            }),
            substrings);

        let quote = this.quote;
        if (quote)
            substrings = substrings.map(function m(str) quote[0] + quote[1](str));
        return this._substrings = substrings;
    },

    /**
     * Advances the context *count* characters. {@link #filter} is advanced to
     * match. If {@link #quote} is non-null, its prefix and suffix are set to
     * the null-string.
     *
     * This function is still imperfect for quoted strings. When
     * {@link #quote} is non-null, it adjusts the count based on the quoted
     * size of the *count*-character substring of the filter, which is accurate
     * so long as unquoting and quoting a string will always map to the
     * original quoted string, which is often not the case.
     *
     * @param {number} count The number of characters to advance the context.
     */
    advance: function advance(count) {
        delete this.ignoreCase;
        let advance = count;
        if (this.quote && count) {
            advance = this.quote[1](this.filter.substr(0, count)).length;
            count = this.quote[0].length + advance;
            this.quote[0] = "";
            this.quote[2] = "";
        }
        this.offset += count;
        if (this._filter)
            this._filter = this._filter.substr(arguments[0] || 0);
    },

    /**
     * Calls the {@link #cancel} method of all currently active
     * sub-contexts.
     */
    cancelAll: function cancelAll() {
        for (let [, context] in Iterator(this.contextList)) {
            if (context.cancel)
                context.cancel();
        }
    },

    /**
     * Gets a key from {@link #cache}, setting it to *defVal* if it doesn't
     * already exists.
     *
     * @param {string} key
     * @param defVal
     */
    getCache: function getCache(key, defVal) {
        if (!(key in this.cache))
            this.cache[key] = defVal();
        return this.cache[key];
    },

    getItems: function getItems(start, end) {
        let items = this.items;
        let step = start > end ? -1 : 1;
        start = Math.max(0, start || 0);
        end = Math.min(items.length, end ? end : items.length);
        return iter.map(util.range(start, end, step), function m(i) items[i]);
    },

    getRow: function getRow(idx, doc) {
        let cache = this.cache.rows;
        if (cache) {
            if (idx in this.items && !(idx in this.cache.rows))
                try {
                    cache[idx] = DOM.fromJSON(this.createRow(this.items[idx]),
                                              doc || this.doc);
                }
                catch (e) {
                    util.reportError(e);
                    util.dump(util.prettifyJSON(this.createRow(this.items[idx]), null, true));
                    cache[idx] = DOM.fromJSON(
                        ["div", { highlight: "CompItem", style: "white-space: nowrap" },
                            ["li", { highlight: "CompResult" }, this.text + "\u00a0"],
                            ["li", { highlight: "CompDesc ErrorMsg" }, e + "\u00a0"]],
                        doc || this.doc);
                }
            return cache[idx];
        }
    },

    getRows: function getRows(start, end, doc) {
        let items = this.items;
        let cache = this.cache.rows;
        let step = start > end ? -1 : 1;

        start = Math.max(0, start || 0);
        end = Math.min(items.length, end != null ? end : items.length);

        this.doc = doc;
        for (let i in util.range(start, end, step))
            yield [i, this.getRow(i)];
    },

    /**
     * Forks this completion context to create a new sub-context named
     * as {this.name}/{name}. The new context is automatically advanced
     * *offset* characters. If *completer* is provided, it is called
     * with *self* as its 'this' object, the new context as its first
     * argument, and any subsequent arguments after *completer* as its
     * following arguments.
     *
     * If *completer* is provided, this function returns its return
     * value, otherwise it returns the new completion context.
     *
     * @param {string} name The name of the new context.
     * @param {number} offset The offset of the new context relative to
     *      the current context's offset.
     * @param {object} self *completer*'s 'this' object. @optional
     * @param {function|string} completer A completer function to call
     *      for the new context. If a string is provided, it is
     *      interpreted as a method to access on *self*.
     */
    fork: function fork(name, offset, self, completer, ...args) {
        return this.forkapply(name, offset, self, completer, args);
    },

    forkapply: function forkapply(name, offset, self, completer, args) {
        if (isString(completer))
            completer = self[completer];
        let context = this.constructor(this, name, offset);
        if (this.contextList.indexOf(context) < 0)
            this.contextList.push(context);

        if (!context.autoComplete && !context.tabPressed && context.editor)
            context.waitingForTab = true;
        else if (completer) {
            let res = completer.apply(self || this, [context].concat(args));
            if (res && !isArray(res) && !isArray(res.__proto__))
                res = [k for (k in res)];
            if (res)
                context.completions = res;
            return res;
        }
        if (completer)
            return null;
        return context;
    },

    split: function split(name, obj, fn, ...args) {
        let context = this.fork(name);
        let alias = (prop) => {
            context.__defineGetter__(prop, () => this[prop]);
            context.__defineSetter__(prop, (val) => this[prop] = val);
        };
        alias("_cache");
        alias("_completions");
        alias("_generate");
        alias("_regenerate");
        alias("itemCache");
        alias("lastActivated");
        context.hasItems = true;
        this.hasItems = false;
        if (fn)
            return fn.apply(obj || this, [context].concat(args));
        return context;
    },

    /**
     * Highlights text in the nsIEditor associated with this completion
     * context. *length* characters are highlighted from the position
     * *start*, relative to the current context's offset, with the
     * selection type *type* as defined in nsISelectionController.
     *
     * When called with no arguments, all highlights are removed. When
     * called with a 0 length, all highlights of type *type* are
     * removed.
     *
     * @param {number} start The position at which to start
     *      highlighting.
     * @param {number} length The length of the substring to highlight.
     * @param {string} type The selection type to highlight with.
     */
    highlight: function highlight(start, length, type) {
        if (arguments.length == 0) {
            for (let type in this.selectionTypes)
                this.highlight(0, 0, type);
            this.selectionTypes = {};
        }
        try {
            // Requires Gecko >= 1.9.1
            this.selectionTypes[type] = true;
            const selType = Ci.nsISelectionController["SELECTION_" + type];
            let sel = this.editor.selectionController.getSelection(selType);
            if (length == 0)
                sel.removeAllRanges();
            else {
                let range = this.editor.selection.getRangeAt(0).cloneRange();
                range.setStart(range.startContainer, this.offset + start);
                range.setEnd(range.startContainer, this.offset + start + length);
                sel.addRange(range);
            }
        }
        catch (e) {}
    },

    /**
     * Tests the given string for a match against the current filter,
     * taking into account anchoring and case sensitivity rules.
     *
     * @param {string} str The string to match.
     * @returns {boolean} True if the string matches, false otherwise.
     */
    match: function match(str) this.matchString(this.filter, str),

    /**
     * Pushes a new output processor onto the processor chain of
     * {@link #process}. The provided function is called with the item
     * and text to process along with a reference to the processor
     * previously installed in the given *index* of {@link #process}.
     *
     * @param {number} index The index into {@link #process}.
     * @param {function(object, string, function)} func The new
     *      processor.
     */
    pushProcessor: function pushProcess(index, func) {
        let next = this.process[index];
        this.process[index] = function process_(item, text) func(item, text, next);
    },

    /**
     * Resets this completion context and all sub-contexts for use in a
     * new completion cycle. May only be called on the top-level
     * context.
     */
    reset: function reset() {
        if (this.parent)
            throw Error();

        this.offset = 0;
        this.process = [template.icon, function process_1(item, k) k];
        this.filters = [CompletionContext.Filter.text];
        this.tabPressed = false;
        this.title = ["Completions"];
        this.updateAsync = false;

        this.cancelAll();

        if (this.editor) {
            this.value = this.editor.selection.focusNode.textContent;
            this._caret = this.editor.selection.focusOffset;
        }
        else {
            this.value = this._value;
            this._caret = this.value.length;
        }
        //for (let key in (k for ([k, v] in Iterator(this.contexts)) if (v.offset > this.caret)))
        //    delete this.contexts[key];
        for each (let context in this.contexts) {
            context.hasItems = false;
            context.incomplete = false;
        }
        this.waitingForTab = false;
        this.runCount++;
        for (let context of this.contextList)
            context.lastActivated = this.runCount;
        this.contextList = [];
    },

    /**
     * Wait for all subcontexts to complete.
     *
     * @param {number} timeout The maximum time, in milliseconds, to wait.
     *    If 0 or null, wait indefinitely.
     * @param {boolean} interruptible When true, the call may be interrupted
     *    via <C-c>, in which case, "Interrupted" may be thrown.
     */
    wait: function wait(timeout, interruptable) {
        this.allItems;
        return util.waitFor(function wf() !this.incomplete, this, timeout, interruptable);
    }
}, {
    Sort: {
        number: function S_number(a, b) parseInt(a.text) - parseInt(b.text)
                    || String.localeCompare(a.text, b.text),
        unsorted: null
    },

    Filter: {
        text: function F_text(item) {
            let text = item.texts;
            for (let [i, str] in Iterator(text)) {
                if (this.match(String(str))) {
                    item.text = String(text[i]);
                    return true;
                }
            }
            return false;
        },
        textDescription: function F_textDescription(item) {
            return CompletionContext.Filter.text.call(this, item) || this.match(item.description);
        }
    }
});

/**
 * @instance completion
 */
var Completion = Module("completion", {
    init: function init() {
    },

    get setFunctionCompleter() JavaScript.setCompleter, // Backward compatibility

    Local: function Local(dactyl, modules, window) ({
        urlCompleters: {},

        get modules() modules,
        get options() modules.options,

        // FIXME
        _runCompleter: function _runCompleter(name, filter, maxItems, ...args) {
            let context = modules.CompletionContext(filter);
            context.maxItems = maxItems;
            let res = context.fork.apply(context, ["run", 0, this, name].concat(args));
            if (res) {
                if (Components.stack.caller.name === "runCompleter") // FIXME
                    return { items: res.map(function m(i) ({ item: i })) };
                context.contexts["/run"].completions = res;
            }
            context.wait(null, true);
            return context.allItems;
        },

        runCompleter: function runCompleter(name, filter, maxItems) {
            return this._runCompleter.apply(this, arguments)
                       .items.map(function m(i) i.item);
        },

        listCompleter: function listCompleter(name, filter, maxItems, ...args) {
            let context = modules.CompletionContext(filter || "");
            context.maxItems = maxItems;
            context.fork.apply(context, ["list", 0, this, name].concat(args));
            context = context.contexts["/list"];
            context.wait(null, true);

            let contexts = context.activeContexts;
            if (!contexts.length)
                contexts = context.contextList.filter(function f(c) c.hasItems).slice(0, 1);
            if (!contexts.length)
                contexts = context.contextList.slice(-1);

            modules.commandline.commandOutput(
                ["div", { highlight: "Completions" },
                    template.map(contexts, function m(context)
                        [template.completionRow(context.title, "CompTitle"),
                         template.map(context.items, function m(item) context.createRow(item), null, 100)])]);
        }
    }),

    ////////////////////////////////////////////////////////////////////////////////
    ////////////////////// COMPLETION TYPES ////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{

    // filter a list of urls
    //
    // may consist of search engines, filenames, bookmarks and history,
    // depending on the 'complete' option
    // if the 'complete' argument is passed like "h", it temporarily overrides the complete option
    url: function url(context, complete) {
        if (/^jar:[^!]*$/.test(context.filter)) {
            context.advance(4);

            context.quote = context.quote || ["", util.identity, ""];
            let quote = context.quote[1];
            context.quote[1] = function quote_1(str) quote(str.replace(/!/g, escape));
        }

        if (this.options["urlseparator"])
            var skip = util.regexp("^.*" + this.options["urlseparator"] + "\\s*")
                           .exec(context.filter);

        if (skip)
            context.advance(skip[0].length);

        if (/^about:/.test(context.filter))
            context.fork("about", 6, this, function fork_(context) {
                context.title = ["about:"];
                context.generate = function generate_() {
                    return [[k.substr(services.ABOUT.length), ""]
                            for (k in Cc)
                            if (k.startsWith(services.ABOUT))];
                };
            });

        if (complete == null)
            complete = this.options["complete"];

        // Will, and should, throw an error if !(c in opts)
        Array.forEach(complete, function fe(c) {
            let completer = this.urlCompleters[c] || { args: [], completer: this.autocomplete(c.replace(/^native:/, "")) };
            context.forkapply(c, 0, this, completer.completer, completer.args);
        }, this);
    },

    addUrlCompleter: function addUrlCompleter(name, description, completer, ...args) {
        completer = Completion.UrlCompleter(name, description, completer);
        completer.args = args;
        this.urlCompleters[name] = completer;
    },

    autocomplete: curry(function autocomplete(provider, context) {
        let running = context.getCache("autocomplete-search-running", Object);

        let name = "autocomplete:" + provider;
        if (!services.has(name))
            services.add(name, services.AUTOCOMPLETE + provider, "nsIAutoCompleteSearch");
        let service = services[name];

        util.assert(service, _("autocomplete.noSuchProvider", provider), false);

        if (running[provider]) {
            this.completions = this.completions;
            this.cancel();
        }

        context.anchored = false;
        context.compare = CompletionContext.Sort.unsorted;
        context.filterFunc = null;

        let words = context.filter.toLowerCase().split(/\s+/g);
        context.hasItems = true;
        context.completions = context.completions.filter(function f({ url, title })
            words.every(function e(w) (url + " " + title).toLowerCase().indexOf(w) >= 0));

        context.format = this.modules.bookmarks.format;
        context.keys.extra = function k_extra(item) {
            try {
                return bookmarkcache.get(item.url).extra;
            }
            catch (e) {}
            return null;
        };
        context.title = [_("autocomplete.title", provider)];

        context.cancel = function cancel_() {
            this.incomplete = false;
            if (running[provider])
                service.stopSearch();
            running[provider] = false;
        };

        if (!context.waitingForTab) {
            context.incomplete = true;

            service.startSearch(context.filter, "", context.result, {
                onSearchResult: util.wrapCallback(function onSearchResult(search, result) {
                    if (result.searchResult <= result.RESULT_SUCCESS)
                        running[provider] = null;

                    context.incomplete = result.searchResult >= result.RESULT_NOMATCH_ONGOING;
                    context.completions = [
                        { url: result.getValueAt(i), title: result.getCommentAt(i), icon: result.getImageAt(i) }
                        for (i in util.range(0, result.matchCount))
                    ];
                }),
                get onUpdateSearchResult() this.onSearchResult
            });
            running[provider] = true;
        }
    }),

    urls: function urls(context, tags) {
        let compare = String.localeCompare;
        let contains = String.indexOf;
        if (context.ignoreCase) {
            compare = util.compareIgnoreCase;
            contains = function contains_(a, b) a && a.toLowerCase().contains(b.toLowerCase());
        }

        if (tags)
            context.filters.push(function filter_(item) tags.
                every(function e(tag) (item.tags || []).
                    some(function s(t) !compare(tag, t))));

        context.anchored = false;
        if (!context.title)
            context.title = ["URL", "Title"];

        context.fork("additional", 0, this, function fork_(context) {
            context.title[0] += " " + _("completion.additional");
            context.filter = context.parent.filter; // FIXME
            context.completions = context.parent.completions;

            // For items whose URL doesn't exactly match the filter,
            // accept them if all tokens match either the URL or the title.
            // Filter out all directly matching strings.
            let match = context.filters[0];
            context.filters[0] = function filters_0(item) !match.call(this, item);

            // and all that don't match the tokens.
            let tokens = context.filter.split(/\s+/);
            context.filters.push(function filter_(item) tokens.every(
                    function e(tok) contains(item.url, tok) ||
                                   contains(item.title, tok)));

            let re = RegExp(tokens.filter(util.identity).map(util.regexp.escape).join("|"), "g");
            function highlight(item, text, i) process[i].call(this, item, template.highlightRegexp(text, re));
            let process = context.process;
            context.process = [
                function process_0(item, text) highlight.call(this, item, item.text, 0),
                function process_1(item, text) highlight.call(this, item, text, 1)
            ];
        });
    }
    //}}}
}, {
    UrlCompleter: Struct("name", "description", "completer")
}, {
    init: function init(dactyl, modules, window) {
        init.superapply(this, arguments);

        modules.CompletionContext = Class("CompletionContext", CompletionContext, {
            init: function init() {
                this.modules = modules;
                return init.superapply(this, arguments);
            },

            get options() this.modules.options
        });
    },
    commands: function initCommands(dactyl, modules, window) {
        const { commands, completion } = modules;
        commands.add(["contexts"],
            "List the completion contexts used during completion of an Ex command",
            function (args) {
                modules.commandline.commandOutput(
                    ["div", { highlight: "Completions" },
                        template.completionRow(["Context", "Title"], "CompTitle"),
                        template.map(completion.contextList || [],
                                     function m(item) template.completionRow(item, "CompItem"))]);
            },
            {
                argCount: "*",
                completer: function (context) {
                    let PREFIX = "/ex/contexts";
                    context.fork("ex", 0, completion, "ex");
                    completion.contextList = [[k.substr(PREFIX.length), v.title[0]] for ([k, v] in iter(context.contexts)) if (k.substr(0, PREFIX.length) == PREFIX)];
                },
                literal: 0
            });
    },
    options: function initOptions(dactyl, modules, window) {
        const { completion, options } = modules;
        let wildmode = {
            values: {
                // Why do we need ""?
                // Because its description is useful during completion. --Kris
                "":              "Complete only the first match",
                "full":          "Complete the next full match",
                "longest":       "Complete the longest common string",
                "list":          "If more than one match, list all matches",
                "list:full":     "List all and complete first match",
                "list:longest":  "List all and complete the longest common string"
            },
            checkHas: function (value, val) {
                let [first, second] = value.split(":", 2);
                return first == val || second == val;
            },
            has: function () {
                let test = function test(val) this.value.some(function s(value) this.checkHas(value, val), this);
                return Array.some(arguments, test, this);
            }
        };

        options.add(["altwildmode", "awim"],
            "Define the behavior of the c_<A-Tab> key in command-line completion",
            "stringlist", "list:full",
            wildmode);

        options.add(["autocomplete", "au"],
            "Automatically update the completion list on any key press",
            "regexplist", ".*");

        options.add(["complete", "cpt"],
            "Items which are completed at the :open prompts",
            "stringlist", "slf",
            {
                valueMap: {
                    S: "suggestion",
                    b: "bookmark",
                    f: "file",
                    h: "history",
                    l: "location",
                    s: "search"
                },

                get values() values(completion.urlCompleters).toArray()
                                .concat([let (name = k.substr(services.AUTOCOMPLETE.length))
                                            ["native:" + name, _("autocomplete.description", name)]
                                         for (k in Cc)
                                         if (k.startsWith(services.AUTOCOMPLETE))]),

                setter: function setter(values) {
                    if (values.length == 1 && !hasOwnProperty(values[0], this.values)
                            && Array.every(values[0], v => hasOwnProperty(this.valueMap, v)))
                        return Array.map(values[0], v => this.valueMap[v]);

                    return values;
                },

                validator: function validator(values) validator.supercall(this, this.setter(values))
            });

        options.add(["wildanchor", "wia"],
            "Define which completion groups only match at the beginning of their text",
            "regexplist", "!/ex/(back|buffer|ext|forward|help|undo)");

        options.add(["wildcase", "wic"],
            "Completion case matching mode",
            "regexpmap", ".?:smart",
            {
                values: {
                    "smart": "Case is significant when capital letters are typed",
                    "match": "Case is always significant",
                    "ignore": "Case is never significant"
                }
            });

        options.add(["wildmode", "wim"],
            "Define the behavior of the c_<Tab> key in command-line completion",
            "stringlist", "list:full",
            wildmode);

        options.add(["wildsort", "wis"],
            "Define which completion groups are sorted",
            "regexplist", ".*");
    }
});

endModule();

// catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
