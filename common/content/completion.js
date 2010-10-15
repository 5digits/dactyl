// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

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
const CompletionContext = Class("CompletionContext", {
    init: function (editor, name, offset) {
        if (!name)
            name = "";

        let self = this;
        if (editor instanceof this.constructor) {
            let parent = editor;
            name = parent.name + "/" + name;

            this.autoComplete = options.get("autocomplete").getKey(name);
            this.sortResults  = options.get("wildsort").getKey(name);
            this.wildcase     = options.get("wildcase").getKey(name);

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

            ["filters", "keys", "title", "quote"].forEach(function (key)
                self[key] = parent[key] && util.cloneObject(parent[key]));
            ["anchored", "compare", "editor", "_filter", "filterFunc", "forceAnchored", "keys", "process", "top"].forEach(function (key)
                self[key] = parent[key]);

            self.__defineGetter__("value", function () this.top.value);

            self.offset = parent.offset;
            self.advance(offset || 0);

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

            delete self._generate;
            delete self._ignoreCase;
            if (self != this)
                return self;
            ["_caret", "contextList", "maxItems", "onUpdate", "selectionTypes", "tabPressed", "updateAsync", "value"].forEach(function (key) {
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

            this.compare = function (a, b) String.localeCompare(a.text, b.text);
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
            this.filterFunc = function (items) {
                    let self = this;
                    return this.filters.
                        reduce(function (res, filter) res.filter(function (item) filter.call(self, item)),
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
            this.offset = offset || 0;
            /**
             * @property {function} A function which is called when any subcontext
             *     changes its completion list. Only called when
             *     {@link #updateAsync} is true.
             */
            this.onUpdate = function () true;

            this.runCount = 0;

            /**
             * @property {CompletionContext} The top-level completion context.
             */
            this.top = this;
            this.__defineGetter__("incomplete", function () this.contextList.some(function (c) c.parent && c.incomplete));
            this.__defineGetter__("waitingForTab", function () this.contextList.some(function (c) c.parent && c.waitingForTab));
            this.__defineSetter__("incomplete", function (val) {});
            this.__defineSetter__("waitingForTab", function (val) {});
            this.reset();
        }
        /**
         * @property {Object} A general-purpose store for functions which need to
         *     cache data between calls.
         */
        this.cache = {};
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
        this.getKey = function (item, key) (typeof self.keys[key] == "function") ? self.keys[key].call(this, item.item) :
                key in self.keys ? item.item[self.keys[key]]
                                 : item.item[key];
        return this;
    },

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
        try {
            let self = this;
            let allItems = this.contextList.map(function (context) context.hasItems && context.items);
            if (this.cache.allItems && array.equals(this.cache.allItems, allItems))
                return this.cache.allItemsResult;
            this.cache.allItems = allItems;

            let minStart = Math.min.apply(Math, [context.offset for ([k, context] in Iterator(this.contexts)) if (context.hasItems && context.items.length)]);
            if (minStart == Infinity)
                minStart = 0;
            let items = this.contextList.map(function (context) {
                if (!context.hasItems)
                    return [];
                let prefix = self.value.substring(minStart, context.offset);
                return context.items.map(function (item) ({
                    text: prefix + item.text,
                    result: prefix + item.result,
                    __proto__: item
                }));
            });
            this.cache.allItemsResult = { start: minStart, items: array.flatten(items) };
            memoize(this.cache.allItemsResult, "longestSubstring", function () self.longestAllSubstring);
            return this.cache.allItemsResult;
        }
        catch (e) {
            dactyl.reportError(e);
            return { start: 0, items: [], longestAllSubstring: "" };
        }
    },
    // Temporary
    get allSubstrings() {
        let contexts = this.contextList.filter(function (c) c.hasItems && c.items.length);
        let minStart = Math.min.apply(Math, contexts.map(function (c) c.offset));
        let lists = contexts.map(function (context) {
            let prefix = context.value.substring(minStart, context.offset);
            return context.substrings.map(function (s) prefix + s);
        });

        /* TODO: Deal with sub-substrings for multiple contexts again.
         * Possibly.
         */
        let substrings = lists.reduce(
                function (res, list) res.filter(function (str) list.some(function (s) s.substr(0, str.length) == str)),
                lists.pop());
        if (!substrings) // FIXME: How is this undefined?
            return [];
        return array.uniq(Array.slice(substrings));
    },
    // Temporary
    get longestAllSubstring() {
        return this.allSubstrings.reduce(function (a, b) a.length > b.length ? a : b, "");
    },

    get caret() this._caret - this.offset,
    set caret(val) this._caret = val + this.offset,

    get compare() this._compare || function () 0,
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
            util.callInMainThread(function () { this.onUpdate(); }, this);
    },

    get createRow() this._createRow || template.completionRow, // XXX
    set createRow(createRow) this._createRow = createRow,

    get filterFunc() this._filterFunc || util.identity,
    set filterFunc(val) this._filterFunc = val,

    get filter() this._filter != null ? this._filter : this.value.substr(this.offset, this.caret),
    set filter(val) {
        delete this._ignoreCase;
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

    get message() this._message || (this.waitingForTab ? "Waiting for <Tab>" : null),
    set message(val) this._message = val,

    get itemPrototype() {
        let res = {};
        function result(quote) {
            yield ["result", quote ? function () quote[0] + quote[1](this.text) + quote[2]
                                   : function () this.text];
        };
        for (let i in iterAll(this.keys, result(this.quote))) {
            let [k, v] = i;
            if (typeof v == "string" && /^[.[]/.test(v))
                // This is only allowed to be a simple accessor, and shouldn't
                // reference any variables. Don't bother with eval context.
                v = Function("i", "return i" + v);
            if (typeof v == "function")
                res.__defineGetter__(k, function () Class.replaceProperty(this, k, v.call(this, this.item)));
            else
                res.__defineGetter__(k, function () Class.replaceProperty(this, k, this.item[v]));
            res.__defineSetter__(k, function (val) Class.replaceProperty(this, k, val));
        }
        return res;
    },

    get regenerate() this._generate && (!this.completions || !this.itemCache[this.key] || this.cache.offset != this.offset),
    set regenerate(val) { if (val) delete this.itemCache[this.key]; },

    get generate() !this._generate ? null : function () {
        if (this.offset != this.cache.offset || this.lastActivated != this.top.runCount) {
            this.itemCache = {};
            this.cache.offset = this.offset;
            this.lastActivated = this.top.runCount;
        }
        if (!this.itemCache[this.key]) {
            try {
                let res = this._generate.call(this);
                if (res != null)
                    this.itemCache[this.key] = res;
            }
            catch (e) {
                dactyl.reportError(e);
                this.message = "Error: " + e;
            }
        }
        return this.itemCache[this.key];
    },
    set generate(arg) {
        this.hasItems = true;
        this._generate = arg;
        if (this.background && this.regenerate) {
            let lock = {};
            this.cache.backgroundLock = lock;
            this.incomplete = true;
            let thread = this.getCache("backgroundThread", util.newThread);
            util.callAsync(thread, this, function () {
                if (this.cache.backgroundLock != lock)
                    return;
                let items = this.generate();
                if (this.cache.backgroundLock != lock)
                    return;
                this.incomplete = false;
                if (items != null)
                    this.completions = items;
            });
        }
    },

    get ignoreCase() {
        if ("_ignoreCase" in this)
            return this._ignoreCase;
        let mode = this.wildcase;
        if (mode == "match")
            return this._ignoreCase = false;
        if (mode == "ignore")
            return this._ignoreCase = true;
        return this._ignoreCase = !/[A-Z]/.test(this.filter);
    },
    set ignoreCase(val) this._ignoreCase = val,

    get items() {
        if (!this.hasItems || this.backgroundLock)
            return [];

        // Regenerate completions if we must
        if (this.generate && !this.background) {
            // XXX
            this.noUpdate = true;
            this.completions = this.generate();
            this.noUpdate = false;
        }
        let items = this.completions;

        // Check for cache miss
        if (this.cache.completions !== this.completions) {
            this.cache.completions = this.completions;
            this.cache.constructed = null;
            this.cache.filtered = null;
        }

        if (this.cache.filtered && this.cache.filter == this.filter)
            return this.cache.filtered;

        this.cache.rows = [];
        this.cache.filter = this.filter;
        if (items == null)
            return items;

        let self = this;
        delete this._substrings;

        if (!this.forceAnchored)
            this.anchored = options.get("wildanchor").getKey(this.name, this.anchored);

        // Item matchers
        if (this.ignoreCase)
            this.matchString = this.anchored ?
                function (filter, str) String.toLowerCase(str).indexOf(filter.toLowerCase()) == 0 :
                function (filter, str) String.toLowerCase(str).indexOf(filter.toLowerCase()) >= 0;
        else
            this.matchString = this.anchored ?
                function (filter, str) String.indexOf(str, filter) == 0 :
                function (filter, str) String.indexOf(str, filter) >= 0;

        // Item formatters
        this.processor = Array.slice(this.process);
        if (!this.anchored)
            this.processor[0] = function (item, text) self.process[0].call(self, item,
                    template.highlightFilter(item.text, self.filter));

        try {
            // Item prototypes
            let proto = this.itemPrototype;
            if (!this.cache.constructed)
                this.cache.constructed = items.map(function (item) ({ __proto__: proto, item: item }));

            // Filters
            let filtered = this.filterFunc(this.cache.constructed);
            if (this.maxItems)
                filtered = filtered.slice(0, this.maxItems);

            // Sorting
            if (this.sortResults && this.compare)
                filtered.sort(this.compare);

            return this.cache.filtered = filtered;
        }
        catch (e) {
            this.message = "Error: " + e;
            dactyl.reportError(e);
            return [];
        }
    },

    get substrings() {
        let items = this.items;
        if (items.length == 0 || !this.hasItems)
            return [];
        if (this._substrings)
            return this._substrings;

        let fixCase = this.ignoreCase ? String.toLowerCase : util.identity;
        let text = fixCase(items[0].text);
        // Exceedingly long substrings cause Gecko to go into convulsions
        if (text.length > 100)
            text = text.substr(0, 100);
        let filter = fixCase(this.filter);
        if (this.anchored) {
            var compare = function compare(text, s) text.substr(0, s.length) == s;
            var substrings = [text];
        }
        else {
            var compare = function compare(text, s) text.indexOf(s) >= 0;
            var substrings = [];
            let start = 0;
            let idx;
            let length = filter.length;
            while ((idx = text.indexOf(filter, start)) > -1 && idx < text.length) {
                substrings.push(text.substring(idx));
                start = idx + 1;
            }
        }
        substrings = items.reduce(function (res, item)
            res.map(function (list) {
                var m, len = list.length;
                var n = list.length;
                var i = 0;
                while (n) {
                    m = Math.floor(n / 2);
                    let s = list[i + m];
                    let keep = compare(fixCase(item.text), list.substring(0, i + m));
                    if (!keep)
                        len = i + m - 1;
                    if (!keep || m == 0)
                        n = m;
                    else {
                        i += m;
                        n = n - m;
                    }
                }
                return len == list.length ? list : list.substr(0, Math.max(len, 0));
            }),
            substrings);
        let quote = this.quote;
        if (quote)
            substrings = substrings.map(function (str) quote[0] + quote[1](str));
        return this._substrings = substrings;
    },

    /**
     * Advances the context <b>count</b> characters. {@link #filter} is
     * advanced to match. If {@link #quote} is non-null, its prefix and suffix
     * are set to the null-string.
     *
     * This function is still imperfect for quoted strings. When
     * {@link #quote} is non-null, it adjusts the count based on the quoted
     * size of the <b>count</b>-character substring of the filter, which is
     * accurate so long as unquoting and quoting a string will always map to
     * the original quoted string, which is often not the case.
     *
     * @param {number} count The number of characters to advance the context.
     */
    advance: function advance(count) {
        delete this._ignoreCase;
        if (this.quote) {
            count = this.quote[0].length + this.quote[1](this.filter.substr(0, count)).length;
            this.quote[0] = "";
            this.quote[2] = "";
        }
        this.offset += count;
        if (this._filter)
            this._filter = this._filter.substr(count);
    },

    cancelAll: function () {
        for (let [, context] in Iterator(this.contextList)) {
            if (context.cancel)
                context.cancel();
        }
    },

    /**
     * Gets a key from {@link #cache}, setting it to <b>defVal</b> if it
     * doesn't already exists.
     *
     * @param {string} key
     * @param defVal
     */
    getCache: function (key, defVal) {
        if (!(key in this.cache))
            this.cache[key] = defVal();
        return this.cache[key];
    },

    getItems: function getItems(start, end) {
        let self = this;
        let items = this.items;
        let step = start > end ? -1 : 1;
        start = Math.max(0, start || 0);
        end = Math.min(items.length, end ? end : items.length);
        return util.map(util.range(start, end, step), function (i) items[i]);
    },

    getRows: function getRows(start, end, doc) {
        let self = this;
        let items = this.items;
        let cache = this.cache.rows;
        let step = start > end ? -1 : 1;
        start = Math.max(0, start || 0);
        end = Math.min(items.length, end != null ? end : items.length);
        for (let i in util.range(start, end, step))
            yield [i, cache[i] = cache[i] || util.xmlToDom(self.createRow(items[i]), doc)];
    },

    fork: function fork(name, offset, self, completer) {
        if (typeof completer == "string")
            completer = self[completer];
        let context = CompletionContext(this, name, offset);
        if (this.contextList.indexOf(context) < 0)
            this.contextList.push(context);

        if (!context.autoComplete && !context.tabPressed && context.editor)
            context.waitingForTab = true;
        else if (completer) {
            let res = completer.apply(self || this, [context].concat(Array.slice(arguments, fork.length)));
            if (res && !isArray(res) && !isArray(res.__proto__))
                return [k for (k in res)];
            return res;
        }
        if (completer)
            return null;
        return context;
    },

    getText: function getText(item) {
        let text = item[self.keys["text"]];
        if (self.quote)
            return self.quote(text);
        return text;
    },

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

    match: function match(str) {
        return this.matchString(this.filter, str);
    },

    pushProcessor: function pushProcess(i, fn) {
        let next = this.process[i];
        this.process[i] = function (item, text) fn(item, text, next);
    },

    reset: function reset() {
        let self = this;
        if (this.parent)
            throw Error();

        this.offset = 0;
        this.process = [template.icon, function (item, k) k];
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
        //for (let key in (k for ([k, v] in Iterator(self.contexts)) if (v.offset > this.caret)))
        //    delete this.contexts[key];
        for each (let context in this.contexts) {
            context.hasItems = false;
            if (context != context.top)
                context.incomplete = false;
        }
        this.runCount++;
        for each (let context in this.contextList)
            context.lastActivated = this.runCount;
        this.contextList = [];
    },

    /**
     * Wait for all subcontexts to complete.
     *
     * @param {boolean} interruptible When true, the call may be interrupted
     *    via <C-c>, in which case, "Interrupted" may be thrown.
     * @param {number} timeout The maximum time, in milliseconds, to wait.
     *    If 0 or null, wait indefinitely.
     */
    wait: function wait(interruptable, timeout) {
        let end = Date.now() + timeout;
        while (this.incomplete && (!timeout || Date.now() > end))
            util.threadYield(false, interruptable);
        return this.incomplete;
    }
}, {
    Sort: {
        number: function (a, b) parseInt(a.text) - parseInt(b.text) || String.localeCompare(a.text, b.text),
        unsorted: null
    },

    Filter: {
        text: function (item) {
            let text = Array.concat(item.text);
            for (let [i, str] in Iterator(text)) {
                if (this.match(String(str))) {
                    item.text = String(text[i]);
                    return true;
                }
            }
            return false;
        },
        textDescription: function (item) {
            return CompletionContext.Filter.text.call(this, item) || this.match(item.description);
        }
    }
});

/**
 * @instance completion
 */
const Completion = Module("completion", {
    init: function () {
    },

    get setFunctionCompleter() JavaScript.setCompleter, // Backward compatibility

    // FIXME
    _runCompleter: function _runCompleter(name, filter, maxItems) {
        let context = CompletionContext(filter);
        context.maxItems = maxItems;
        let res = context.fork.apply(context, ["run", 0, this, name].concat(Array.slice(arguments, 3)));
        if (res) {
            if (Components.stack.caller.name === "runCompleter") // FIXME
                return { items: res.map(function (i) ({ item: i })) };
            context.contexts["/run"].completions = res;
        }
        context.wait(true);
        return context.allItems;
    },

    runCompleter: function runCompleter(name, filter, maxItems) {
        return this._runCompleter.apply(this, Array.slice(arguments))
                   .items.map(function (i) i.item);
    },

    listCompleter: function listCompleter(name, filter, maxItems) {
        let context = CompletionContext(filter || "");
        context.maxItems = maxItems;
        context.fork.apply(context, ["list", 0, completion, name].concat(Array.slice(arguments, 3)));
        context = context.contexts["/list"];
        context.wait();

        commandline.commandOutput(
            <div highlight="Completions">
                { template.map(context.contextList.filter(function (c) c.hasItems && c.items.length),
                    function (context)
                        template.completionRow(context.title, "CompTitle") +
                        template.map(context.items, function (item) context.createRow(item), null, 100)) }
            </div>);
    },

    ////////////////////////////////////////////////////////////////////////////////
    ////////////////////// COMPLETION TYPES ////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////////////{{{

    // filter a list of urls
    //
    // may consist of search engines, filenames, bookmarks and history,
    // depending on the 'complete' option
    // if the 'complete' argument is passed like "h", it temporarily overrides the complete option
    url: function url(context, complete) {
        let numLocationCompletions = 0; // how many async completions did we already return to the caller?
        let start = 0;
        let skip = 0;

        if (options["urlseparator"])
            skip = context.filter.match("^.*" + options["urlseparator"]); // start after the last 'urlseparator'

        if (skip)
            context.advance(skip[0].length);

        if (complete == null)
            complete = options["complete"];

        // Will, and should, throw an error if !(c in opts)
        Array.forEach(complete, function (c) {
            let completer = completion.urlCompleters[c];
            context.fork.apply(context, [c, 0, completion, completer.completer].concat(completer.args));
        });
    },

    urlCompleters: {},

    addUrlCompleter: function addUrlCompleter(opt) {
        let completer = Completion.UrlCompleter.apply(null, Array.slice(arguments));
        completer.args = Array.slice(arguments, completer.length);
        this.urlCompleters[opt] = completer;
    },

    urls: function (context, tags) {
        let compare = String.localeCompare;
        let contains = String.indexOf;
        if (context.ignoreCase) {
            compare = util.compareIgnoreCase;
            contains = function (a, b) a && a.toLowerCase().indexOf(b.toLowerCase()) > -1;
        }

        if (tags)
            context.filters.push(function (item) tags.
                every(function (tag) (item.tags || []).
                    some(function (t) !compare(tag, t))));

        context.anchored = false;
        if (!context.title)
            context.title = ["URL", "Title"];

        context.fork("additional", 0, this, function (context) {
            context.title[0] += " (additional)";
            context.filter = context.parent.filter; // FIXME
            context.completions = context.parent.completions;
            // For items whose URL doesn't exactly match the filter,
            // accept them if all tokens match either the URL or the title.
            // Filter out all directly matching strings.
            let match = context.filters[0];
            context.filters[0] = function (item) !match.call(this, item);
            // and all that don't match the tokens.
            let tokens = context.filter.split(/\s+/);
            context.filters.push(function (item) tokens.every(
                    function (tok) contains(item.url, tok) ||
                                   contains(item.title, tok)));

            let re = RegExp(tokens.filter(util.identity).map(util.escapeRegex).join("|"), "g");
            function highlight(item, text, i) process[i].call(this, item, template.highlightRegexp(text, re));
            let process = context.process;
            context.process = [
                function (item, text) highlight.call(this, item, item.text, 0),
                function (item, text) highlight.call(this, item, text, 1)
            ];
        });
    }
    //}}}
}, {
    UrlCompleter: Struct("name", "description", "completer")
}, {
    commands: function () {
        commands.add(["contexts"],
            "List the completion contexts used during completion of an Ex command",
            function (args) {
                commandline.commandOutput(
                    <div highlight="Completions">
                        { template.completionRow(["Context", "Title"], "CompTitle") }
                        { template.map(completion.contextList || [], function (item) template.completionRow(item, "CompItem")) }
                    </div>);
            },
            {
                argCount: "*",
                completer: function (context, args) {
                    let PREFIX = "/ex/contexts";
                    context.fork("ex", 0, completion, "ex");
                    completion.contextList = [[k.substr(PREFIX.length), v.title[0]] for ([k, v] in iter(context.contexts)) if (k.substr(0, PREFIX.length) == PREFIX)];
                },
                literal: 0
            });
    },
    options: function () {
        let wildmode = {
            completer: function (context) [
                // Why do we need ""?
                // Because its description is useful during completion. --Kris
                ["",              "Complete only the first match"],
                ["full",          "Complete the next full match"],
                ["longest",       "Complete to longest common string"],
                ["list",          "If more than one match, list all matches"],
                ["list:full",     "List all and complete first match"],
                ["list:longest",  "List all and complete common string"]
            ],
            checkHas: function (value, val) {
                let [first, second] = value.split(":", 2);
                return first == val || second == val;
            },
            has: function () {
                test = function (val) this.value.some(function (value) this.checkHas(value, val), this);
                return Array.some(arguments, test, this);
            }
        };

        options.add(["altwildmode", "awim"],
            "Define how command line completion works when the Alt key is pressed",
            "stringlist", "list:full",
            wildmode);

        options.add(["autocomplete", "au"],
            "Automatically update the completion list on any key press",
            "regexlist", ".*");

        options.add(["complete", "cpt"],
            "Items which are completed at the :open prompts",
            "charlist", typeof(config.defaults["complete"]) == "string" ? config.defaults["complete"] : "slf",
            {
                completer: function (context) values(completion.urlCompleters)
            });

        options.add(["wildanchor", "wia"],
            "Regexp list defining which contexts require matches anchored to the begining of the result",
            "regexlist", "!/ex/(back|buffer|ext|forward|help|undo)");

        options.add(["wildcase", "wic"],
            "Completion case matching mode",
            "regexmap", ".?:smart",
            {
                completer: function () [
                    ["smart", "Case is significant when capital letters are typed"],
                    ["match", "Case is always significant"],
                    ["ignore", "Case is never significant"]
                ]
            });

        options.add(["wildmode", "wim"],
            "Define how command line completion works",
            "stringlist", "list:full",
            wildmode);

        options.add(["wildsort", "wis"],
            "Regexp list of which contexts to sort",
            "regexlist", ".*");
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
