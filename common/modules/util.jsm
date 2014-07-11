// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

defineModule("util", {
    exports: ["DOM", "$", "FailedAssertion", "Math", "NS", "Point", "Util", "XBL", "XHTML", "XUL", "util"],
    require: ["dom", "promises", "services"]
});

lazyRequire("overlay", ["overlay"]);
lazyRequire("storage", ["File", "storage"]);
lazyRequire("template", ["template"]);

var Magic = Class("Magic", {
    init: function init(str) {
        this.str = str;
    },

    get message() this.str,

    toString: function () this.str
});

var FailedAssertion = Class("FailedAssertion", ErrorBase, {
    init: function init(message, level, noTrace) {
        if (noTrace !== undefined)
            this.noTrace = noTrace;
        init.supercall(this, message, level);
    },

    level: 3,

    noTrace: true
});

var Point = Struct("Point", "x", "y");

var wrapCallback = function wrapCallback(fn, isEvent) {
    if (!fn.wrapper)
        fn.wrapper = function wrappedCallback() {
            try {
                let res = fn.apply(this, arguments);
                if (isEvent && res === false) {
                    arguments[0].preventDefault();
                    arguments[0].stopPropagation();
                }
                return res;
            }
            catch (e) {
                util.reportError(e);
                return undefined;
            }
        };
    fn.wrapper.wrapped = fn;
    return fn.wrapper;
}

var Util = Module("Util", XPCOM([Ci.nsIObserver, Ci.nsISupportsWeakReference]), {
    Magic: Magic,

    init: function init() {
        this.Array = array;

        this.addObserver(this);
        this.windows = [];
    },

    activeWindow: deprecated("overlay.activeWindow", { get: function activeWindow() overlay.activeWindow }),
    overlayObject: deprecated("overlay.overlayObject", { get: function overlayObject() overlay.bound.overlayObject }),
    overlayWindow: deprecated("overlay.overlayWindow", { get: function overlayWindow() overlay.bound.overlayWindow }),

    compileMatcher: deprecated("DOM.compileMatcher", { get: function compileMatcher() DOM.compileMatcher }),
    computedStyle: deprecated("DOM#style", function computedStyle(elem) DOM(elem).style),
    domToString: deprecated("DOM.stringify", { get: function domToString() DOM.stringify }),
    editableInputs: deprecated("DOM.editableInputs", { get: function editableInputs(elem) DOM.editableInputs }),
    escapeHTML: deprecated("DOM.escapeHTML", { get: function escapeHTML(elem) DOM.escapeHTML }),
    evaluateXPath: deprecated("DOM.XPath",
        function evaluateXPath(path, elem, asIterator) DOM.XPath(path, elem || util.activeWindow.content.document, asIterator)),
    isVisible: deprecated("DOM#isVisible", function isVisible(elem) DOM(elem).isVisible),
    makeXPath: deprecated("DOM.makeXPath", { get: function makeXPath(elem) DOM.makeXPath }),
    namespaces: deprecated("DOM.namespaces", { get: function namespaces(elem) DOM.namespaces }),
    namespaceNames: deprecated("DOM.namespaceNames", { get: function namespaceNames(elem) DOM.namespaceNames }),
    parseForm: deprecated("DOM#formData", function parseForm(elem) values(DOM(elem).formData).toArray()),
    scrollIntoView: deprecated("DOM#scrollIntoView", function scrollIntoView(elem, alignWithTop) DOM(elem).scrollIntoView(alignWithTop)),
    validateMatcher: deprecated("DOM.validateMatcher", { get: function validateMatcher() DOM.validateMatcher }),

    map: deprecated("iter.map", function map(obj, fn, self) iter(obj).map(fn, self).toArray()),
    writeToClipboard: deprecated("dactyl.clipboardWrite", function writeToClipboard(str, verbose) util.dactyl.clipboardWrite(str, verbose)),
    readFromClipboard: deprecated("dactyl.clipboardRead", function readFromClipboard() util.dactyl.clipboardRead(false)),

    chromePackages: deprecated("config.chromePackages", { get: function chromePackages() config.chromePackages }),
    haveGecko: deprecated("config.haveGecko", { get: function haveGecko() config.bound.haveGecko }),
    OS: deprecated("config.OS", { get: function OS() config.OS }),

    dactyl: update(function dactyl(obj) {
        if (obj)
            var global = Class.objectGlobal(obj);

        return {
            __noSuchMethod__: function __noSuchMethod__(meth, args) {
                let win = overlay.activeWindow;

                var dactyl = global && global.dactyl || win && win.dactyl;
                if (!dactyl)
                    return null;

                let prop = dactyl[meth];
                if (callable(prop))
                    return prop.apply(dactyl, args);
                return prop;
            }
        };
    }, {
        __noSuchMethod__: function __noSuchMethod__() this().__noSuchMethod__.apply(null, arguments)
    }),

    /**
     * Registers a obj as a new observer with the observer service. obj.observe
     * must be an object where each key is the name of a target to observe and
     * each value is a function(subject, data) to be called when the given
     * target is broadcast. obj.observe will be replaced with a new opaque
     * function. The observer is automatically unregistered on application
     * shutdown.
     *
     * @param {object} obj
     */
    addObserver: update(function addObserver(obj) {
        if (!obj.observers)
            obj.observers = obj.observe;

        let cleanup = ["dactyl-cleanup-modules", "quit-application"];

        function register(meth) {
            for (let target of RealSet(cleanup.concat(Object.keys(obj.observers))))
                try {
                    services.observer[meth](obj, target, true);
                }
                catch (e) {}
        }

        Class.replaceProperty(obj, "observe",
            function (subject, target, data) {
                try {
                    if (~cleanup.indexOf(target))
                        register("removeObserver");
                    if (obj.observers[target])
                        obj.observers[target].call(obj, subject, data);
                }
                catch (e) {
                    if (typeof util === "undefined")
                        addObserver.dump("dactyl: error: " + e + "\n" + (e.stack || addObserver.Error().stack).replace(/^/gm, "dactyl:    "));
                    else
                        util.reportError(e);
                }
            });

        obj.observe.unregister = () => register("removeObserver");
        register("addObserver");
    }, { dump: dump, Error: Error }),

    /*
     * Tests a condition and throws a FailedAssertion error on
     * failure.
     *
     * @param {boolean} condition The condition to test.
     * @param {string} message The message to present to the
     *     user on failure.
     */
    assert: function assert(condition, message, quiet) {
        if (!condition)
            throw FailedAssertion(message, 1, quiet === undefined ? true : quiet);
        return condition;
    },

    /**
     * CamelCases a -non-camel-cased identifier name.
     *
     * @param {string} name The name to mangle.
     * @returns {string} The mangled name.
     */
    camelCase: function camelCase(name) String.replace(name, /-(.)/g,
                                                       (m, m1) => m1.toUpperCase()),

    /**
     * Capitalizes the first character of the given string.
     * @param {string} str The string to capitalize
     * @returns {string}
     */
    capitalize: function capitalize(str) str && str[0].toUpperCase() + str.slice(1).toLowerCase(),

    /**
     * Returns a RegExp object that matches characters specified in the range
     * expression *list*, or signals an appropriate error if *list* is invalid.
     *
     * @param {string} list Character list, e.g., "a b d-xA-Z" produces /[abd-xA-Z]/.
     * @param {string} accepted Character range(s) to accept, e.g. "a-zA-Z" for
     *     ASCII letters. Used to validate *list*.
     * @returns {RegExp}
     */
    charListToRegexp: function charListToRegexp(list, accepted) {
        list = list.replace(/\s+/g, "");

        // check for chars not in the accepted range
        this.assert(RegExp("^[" + accepted + "-]+$").test(list),
                    _("error.charactersOutsideRange", accepted.quote()));

        // check for illegal ranges
        for (let [match] in this.regexp.iterate(/.-./g, list))
            this.assert(match.charCodeAt(0) <= match.charCodeAt(2),
                        _("error.invalidCharacterRange", list.slice(list.indexOf(match))));

        return RegExp("[" + util.regexp.escape(list) + "]");
    },

    /**
     * Returns a shallow copy of *obj*.
     *
     * @param {Object} obj
     * @returns {Object}
     */
    cloneObject: function cloneObject(obj) {
        if (isArray(obj))
            return obj.slice();
        let newObj = {};
        for (let [k, v] in Iterator(obj))
            newObj[k] = v;
        return newObj;
    },

    /**
     * Clips a string to a given length. If the input string is longer
     * than *length*, an ellipsis is appended.
     *
     * @param {string} str The string to truncate.
     * @param {number} length The length of the returned string.
     * @returns {string}
     */
    clip: function clip(str, length) {
        return str.length <= length ? str : str.substr(0, length - 3) + "...";
    },

    /**
     * Compares two strings, case insensitively. Return values are as
     * in String#localeCompare.
     *
     * @param {string} a
     * @param {string} b
     * @returns {number}
     */
    compareIgnoreCase: function compareIgnoreCase(a, b) String.localeCompare(a.toLowerCase(), b.toLowerCase()),

    compileFormat: function compileFormat(format) {
        let stack = [frame()];
        stack.__defineGetter__("top", function () this[this.length - 1]);

        function frame() update(
            function _frame(obj)
                _frame === stack.top || _frame.valid(obj)
                    ? _frame.elements.map(e => callable(e) ? e(obj) : e)
                                     .join("")
                    : "",
            {
                elements: [],
                seen: {},
                valid: function valid(obj) this.elements.every(e => !e.test || e.test(obj))
            });

        let end = 0;
        for (let match in util.regexp.iterate(/(.*?)%(.)/gy, format)) {

            let [, prefix, char] = match;
            end += match[0].length;

            if (prefix)
                stack.top.elements.push(prefix);
            if (char === "%")
                stack.top.elements.push("%");
            else if (char === "[") {
                let f = frame();
                stack.top.elements.push(f);
                stack.push(f);
            }
            else if (char === "]") {
                stack.pop();
                util.assert(stack.length, /*L*/"Unmatched %] in format");
            }
            else {
                let quote = function quote(obj, char) obj[char];
                if (char !== char.toLowerCase())
                    quote = function quote(obj, char) Commands.quote(obj[char]);
                char = char.toLowerCase();

                stack.top.elements.push(update(
                    function (obj) obj[char] != null ? quote(obj, char)
                                                     : "",
                    { test: function test(obj) obj[char] != null }));

                for (let elem in array.iterValues(stack))
                    elem.seen[char] = true;
            }
        }
        if (end < format.length)
            stack.top.elements.push(format.substr(end));

        util.assert(stack.length === 1, /*L*/"Unmatched %[ in format");
        return stack.top;
    },

    /**
     * Compiles a macro string into a function which generates a string
     * result based on the input *macro* and its parameters. The
     * definitive documentation for macro strings resides in :help
     * macro-string.
     *
     * Macro parameters may have any of the following flags:
     *     e: The parameter is only tested for existence. Its
     *        interpolation is always empty.
     *     q: The result is quoted such that it is parsed as a single
     *        argument by the Ex argument parser.
     *
     * The returned function has the following additional properties:
     *
     *     seen {set}: The set of parameters used in this macro.
     *
     *     valid {function(object)}: Returns true if every parameter of
     *          this macro is provided by the passed object.
     *
     * @param {string} macro The macro string to compile.
     * @param {boolean} keepUnknown If true, unknown macro parameters
     *      are left untouched. Otherwise, they are replaced with the null
     *      string.
     * @returns {function}
     */
    compileMacro: function compileMacro(macro, keepUnknown) {
        let stack = [frame()];
        stack.__defineGetter__("top", function () this[this.length - 1]);

        let unknown = util.identity;
        if (!keepUnknown)
            unknown = () => "";

        function frame() update(
            function _frame(obj)
                _frame === stack.top || _frame.valid(obj)
                    ? _frame.elements.map(e => callable(e) ? e(obj) : e)
                            .join("")
                    : "",
            {
                elements: [],
                seen: RealSet(),
                valid: function valid(obj) this.elements.every(e => (!e.test || e.test(obj)))
            });

        let defaults = { lt: "<", gt: ">" };

        let re = util.regexp(literal(function () /*
            ([^]*?) // 1
            (?:
                (<\{) | // 2
                (< ((?:[a-z]-)?[a-z-]+?) (?:\[([0-9]+)\])? >) | // 3 4 5
                (\}>) // 6
            )
        */$), "gixy");
        macro = String(macro);
        let end = 0;
        for (let match in re.iterate(macro)) {
            let [, prefix, open, full, macro, idx, close] = match;
            end += match[0].length;

            if (prefix)
                stack.top.elements.push(prefix);
            if (open) {
                let f = frame();
                stack.top.elements.push(f);
                stack.push(f);
            }
            else if (close) {
                stack.pop();
                util.assert(stack.length, /*L*/"Unmatched }> in macro");
            }
            else {
                let [, flags, name] = /^((?:[a-z]-)*)(.*)/.exec(macro);
                flags = RealSet(flags);

                let quote = util.identity;
                if (flags.has("q"))
                    quote = function quote(obj) typeof obj === "number" ? obj : String.quote(obj);
                if (flags.has("e"))
                    quote = function quote(obj) "";

                if (hasOwnProperty(defaults, name))
                    stack.top.elements.push(quote(defaults[name]));
                else {
                    let index = idx;
                    if (idx) {
                        idx = Number(idx) - 1;
                        stack.top.elements.push(update(
                            obj => obj[name] != null && idx in obj[name] ? quote(obj[name][idx])
                                                                         : hasOwnProperty(obj, name) ? "" : unknown(full),
                            {
                                test: function test(obj) obj[name] != null && idx in obj[name]
                                                      && obj[name][idx] !== false
                                                      && (!flags.e || obj[name][idx] != "")
                            }));
                    }
                    else {
                        stack.top.elements.push(update(
                            obj => obj[name] != null ? quote(obj[name])
                                                     : hasOwnProperty(obj, name) ? "" : unknown(full),
                            {
                                test: function test(obj) obj[name] != null
                                                      && obj[name] !== false
                                                      && (!flags.e || obj[name] != "")
                            }));
                    }

                    for (let elem in array.iterValues(stack))
                        elem.seen.add(name);
                }
            }
        }
        if (end < macro.length)
            stack.top.elements.push(macro.substr(end));

        util.assert(stack.length === 1, /*L*/"Unmatched <{ in macro");
        return stack.top;
    },

    /**
     * Converts any arbitrary string into an URI object. Returns null on
     * failure.
     *
     * @param {string} str
     * @returns {nsIURI|null}
     */
    createURI: function createURI(str) {
        try {
            let uri = services.urifixup.createFixupURI(str, services.urifixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP);
            uri instanceof Ci.nsIURL;
            return uri;
        }
        catch (e) {
            return null;
        }
    },

    /**
     * Expands brace globbing patterns in a string.
     *
     * Example:
     *     "a{b,c}d" => ["abd", "acd"]
     *
     * @param {string|[string|Array]} pattern The pattern to deglob.
     * @returns [string] The resulting strings.
     */
    debrace: function debrace(pattern) {
        try {
            if (isArray(pattern)) {
                // Jägermonkey hates us.
                let obj = ({
                    res: [],
                    rec: function rec(acc) {
                        let vals;

                        while (isString(vals = pattern[acc.length]))
                            acc.push(vals);

                        if (acc.length == pattern.length)
                            this.res.push(acc.join(""));
                        else
                            for (let val in values(vals))
                                this.rec(acc.concat(val));
                    }
                });
                obj.rec([]);
                return obj.res;
            }

            if (!pattern.contains("{"))
                return [pattern];

            let res = [];

            let split = function split(pattern, re, fn, dequote) {
                let end = 0, match, res = [];
                while (match = re.exec(pattern)) {
                    end = match.index + match[0].length;
                    res.push(match[1]);
                    if (fn)
                        fn(match);
                }
                res.push(pattern.substr(end));
                return res.map(s => util.dequote(s, dequote));
            };

            let patterns = [];
            let substrings = split(pattern, /((?:[^\\{]|\\.)*)\{((?:[^\\}]|\\.)*)\}/gy,
                function (match) {
                    patterns.push(split(match[2], /((?:[^\\,]|\\.)*),/gy,
                        null, ",{}"));
                }, "{}");

            let rec = function rec(acc) {
                if (acc.length == patterns.length)
                    res.push(array(substrings).zip(acc).flatten().join(""));
                else
                    for (let [, pattern] in Iterator(patterns[acc.length]))
                        rec(acc.concat(pattern));
            };
            rec([]);
            return res;
        }
        catch (e if e.message && e.message.contains("res is undefined")) {
            // prefs.safeSet() would be reset on :rehash
            prefs.set("javascript.options.methodjit.chrome", false);
            util.dactyl.warn(_(UTF8("error.damnYouJägermonkey")));
            return [];
        }
    },

    /**
     * Briefly delay the execution of the passed function.
     *
     * @param {function} callback The function to delay.
     */
    delay: function delay(callback) {
        let { mainThread } = services.threading;
        mainThread.dispatch(callback,
                            mainThread.DISPATCH_NORMAL);
    },

    /**
     * Removes certain backslash-quoted characters while leaving other
     * backslash-quoting sequences untouched.
     *
     * @param {string} pattern The string to unquote.
     * @param {string} chars The characters to unquote.
     * @returns {string}
     */
    dequote: function dequote(pattern, chars)
        pattern.replace(/\\(.)/, (m0, m1) => chars.contains(m1) ? m1 : m0),

    /**
     * Returns the nsIDocShell for the given window.
     *
     * @param {Window} win The window for which to get the docShell.
     * @returns {nsIDocShell}
     */

     docShell: function docShell(win)
            win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
               .QueryInterface(Ci.nsIDocShell),

    /**
     * Prints a message to the console. If *msg* is an object it is pretty
     * printed.
     *
     * @param {string|Object} msg The message to print.
     */
    dump: defineModule.dump,

    /**
     * Returns a list of reformatted stack frames from
     * {@see Error#stack}.
     *
     * @param {string} stack The stack trace from an Error.
     * @returns {[string]} The stack frames.
     */
    stackLines: function stackLines(stack) {
        let lines = [];
        let match, re = /([^]*?)@([^@\n]*)(?:\n|$)/g;
        while (match = re.exec(stack))
            lines.push(match[1].replace(/\n/g, "\\n").substr(0, 80) + "@" +
                       util.fixURI(match[2]));
        return lines;
    },

    /**
     * Dumps a stack trace to the console.
     *
     * @param {string} msg The trace message.
     * @param {number} frames The number of frames to print.
     */
    dumpStack: function dumpStack(msg="Stack", frames=null) {
        let stack = util.stackLines(Error().stack);
        stack = stack.slice(1, 1 + (frames || stack.length)).join("\n").replace(/^/gm, "    ");
        util.dump(msg + "\n" + stack + "\n");
    },

    /**
     * Escapes quotes, newline and tab characters in *str*. The returned string
     * is delimited by *delimiter* or " if *delimiter* is not specified.
     * {@see String#quote}.
     *
     * @param {string} str
     * @param {string} delimiter
     * @returns {string}
     */
    escapeString: function escapeString(str, delimiter) {
        if (delimiter == undefined)
            delimiter = '"';
        return delimiter + str.replace(/([\\'"])/g, "\\$1").replace("\n", "\\n", "g").replace("\t", "\\t", "g") + delimiter;
    },

    /**
     * Converts *bytes* to a pretty printed data size string.
     *
     * @param {number} bytes The number of bytes.
     * @param {string} decimalPlaces The number of decimal places to use if
     *     *humanReadable* is true.
     * @param {boolean} humanReadable Use byte multiples.
     * @returns {string}
     */
    formatBytes: function formatBytes(bytes, decimalPlaces, humanReadable) {
        const unitVal = ["Bytes", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
        let unitIndex = 0;
        let tmpNum = parseInt(bytes, 10) || 0;
        let strNum = [tmpNum + ""];

        if (humanReadable) {
            while (tmpNum >= 1024) {
                tmpNum /= 1024;
                if (++unitIndex > (unitVal.length - 1))
                    break;
            }

            let decPower = Math.pow(10, decimalPlaces);
            strNum = ((Math.round(tmpNum * decPower) / decPower) + "").split(".", 2);

            if (!strNum[1])
                strNum[1] = "";

            while (strNum[1].length < decimalPlaces) // pad with "0" to the desired decimalPlaces)
                strNum[1] += "0";
        }

        for (let u = strNum[0].length - 3; u > 0; u -= 3) // make a 10000 a 10,000
            strNum[0] = strNum[0].substr(0, u) + "," + strNum[0].substr(u);

        if (unitIndex) // decimalPlaces only when > Bytes
            strNum[0] += "." + strNum[1];

        return strNum[0] + " " + unitVal[unitIndex];
    },

    /**
     * Converts *seconds* into a human readable time string.
     *
     * @param {number} seconds
     * @returns {string}
     */
    formatSeconds: function formatSeconds(seconds) {
        function pad(n, val) ("0000000" + val).substr(-Math.max(n, String(val).length));
        function div(num, denom) [Math.floor(num / denom), Math.round(num % denom)];
        let days, hours, minutes;

        [minutes, seconds] = div(Math.round(seconds), 60);
        [hours, minutes]   = div(minutes, 60);
        [days, hours]      = div(hours,   24);
        if (days)
            return /*L*/days + " days " + hours + " hours";
        if (hours)
            return /*L*/hours + "h " + minutes + "m";
        if (minutes)
            return /*L*/minutes + ":" + pad(2, seconds);
        return /*L*/seconds + "s";
    },

    /**
     * Returns the file which backs a given URL, if available.
     *
     * @param {nsIURI} uri The URI for which to find a file.
     * @returns {File|null}
     */
    getFile: function getFile(uri) {
        try {
            if (isString(uri))
                uri = util.newURI(uri);

            if (uri instanceof Ci.nsIFileURL)
                return File(uri.file);

            if (uri instanceof Ci.nsIFile)
                return File(uri);

            let channel = services.io.newChannelFromURI(uri);
            try { channel.cancel(Cr.NS_BINDING_ABORTED); } catch (e) {}
            if (channel instanceof Ci.nsIFileChannel)
                return File(channel.file);
        }
        catch (e) {}
        return null;
    },

    /**
     * Returns the host for the given URL, or null if invalid.
     *
     * @param {string} url
     * @returns {string|null}
     */
    getHost: function getHost(url) {
        try {
            return util.createURI(url).host;
        }
        catch (e) {}
        return null;
    },

    /**
     * Sends a synchronous or asynchronous HTTP request to *url* and returns
     * the XMLHttpRequest object. If *callback* is specified the request is
     * asynchronous and the *callback* is invoked with the object as its
     * argument.
     *
     * @param {string} url
     * @param {object} params Optional parameters for this request:
     *    method: {string} The request method. @default "GET"
     *
     *    params: {object} Parameters to append to *url*'s query string.
     *    data: {*} POST data to send to the server. Ordinary objects
     *              are converted to FormData objects, with one datum
     *              for each property/value pair.
     *
     *    onload:   {function(XMLHttpRequest, Event)} The request's load event handler.
     *    onerror:  {function(XMLHttpRequest, Event)} The request's error event handler.
     *    callback: {function(XMLHttpRequest, Event)} An event handler
     *              called for either error or load events.
     *
     *    background: {boolean} Whether to perform the request in the
     *                background. @default true
     *
     *    mimeType: {string} Override the response mime type with the
     *              given value.
     *    responseType: {string} Override the type of the "response"
     *                  property.
     *
     *    headers: {objects} Extra request headers.
     *
     *    user: {string} The user name to send via HTTP Authentication.
     *    pass: {string} The password to send via HTTP Authentication.
     *
     *    quiet: {boolean} If true, don't report errors.
     *
     * @returns {XMLHttpRequest}
     */
    httpGet: function httpGet(url, params={}, self=null) {
        if (callable(params))
            // Deprecated.
            params = { callback: params.bind(self) };

        try {
            let xmlhttp = services.Xmlhttp();
            xmlhttp.mozBackgroundRequest = hasOwnProperty(params, "background") ? params.background : true;

            let async = params.callback || params.onload || params.onerror;
            if (async) {
                xmlhttp.addEventListener("load",  event => { util.trapErrors(params.onload  || params.callback, params, xmlhttp, event); }, false);
                xmlhttp.addEventListener("error", event => { util.trapErrors(params.onerror || params.callback, params, xmlhttp, event); }, false);
            }

            if (isObject(params.params)) {
                let data = [encodeURIComponent(k) + "=" + encodeURIComponent(v)
                            for ([k, v] in iter(params.params))];
                let uri = util.newURI(url);
                uri.query += (uri.query ? "&" : "") + data.join("&");

                url = uri.spec;
            }

            if (isObject(params.data) && !(params.data instanceof Ci.nsISupports)) {
                let data = services.FormData();
                for (let [k, v] in iter(params.data))
                    data.append(k, v);
                params.data = data;
            }

            if (params.mimeType)
                xmlhttp.overrideMimeType(params.mimeType);

            let args = [params.method || "GET", url, async];
            if (params.user != null || params.pass != null)
                args.push(params.user);
            if (params.pass != null)
                args.push(prams.pass);
            xmlhttp.open.apply(xmlhttp, args);

            for (let [header, val] in Iterator(params.headers || {}))
                xmlhttp.setRequestHeader(header, val);

            if (params.responseType)
                xmlhttp.responseType = params.responseType;

            if (params.notificationCallbacks)
                xmlhttp.channel.notificationCallbacks = params.notificationCallbacks;

            xmlhttp.send(params.data);
            return xmlhttp;
        }
        catch (e) {
            if (!params.quiet)
                util.reportError(e);
            return null;
        }
    },

    /**
     * Like #httpGet, but returns a promise rather than accepting
     * callbacks.
     *
     * @param {string} url The URL to fetch.
     * @param {object} params Parameter object, as in #httpGet.
     */
    fetchUrl: promises.withCallbacks(function fetchUrl([accept, reject, deferred], url, params) {
        params = update({}, params);
        params.onload = accept;
        params.onerror = reject;

        let req = this.httpGet(url, params);
        promises.oncancel(deferred, req.cancel);
    }),

    /**
     * The identity function.
     *
     * @param {Object} k
     * @returns {Object}
     */
    identity: function identity(k) k,

    /**
     * Returns the intersection of two rectangles.
     *
     * @param {Object} r1
     * @param {Object} r2
     * @returns {Object}
     */
    intersection: function intersection(r1, r2) ({
        get width()  this.right - this.left,
        get height() this.bottom - this.top,
        left: Math.max(r1.left, r2.left),
        right: Math.min(r1.right, r2.right),
        top: Math.max(r1.top, r2.top),
        bottom: Math.min(r1.bottom, r2.bottom)
    }),

    /**
     * Returns true if the given stack frame resides in Dactyl code.
     *
     * @param {nsIStackFrame} frame
     * @returns {boolean}
     */
    isDactyl: Class.Memoize(function () {
        let base = util.regexp.escape(Components.stack.filename.replace(/[^\/]+$/, ""));
        let re = RegExp("^(?:.* -> )?(?:resource://dactyl(?!-content/eval.js)|" + base + ")\\S+$");
        return function isDactyl(frame) re.test(frame.filename);
    }),

    /**
     * Returns true if *url* is in the domain *domain*.
     *
     * @param {string} url
     * @param {string} domain
     * @returns {boolean}
     */
    isDomainURL: function isDomainURL(url, domain) util.isSubdomain(util.getHost(url), domain),

    /**
     * Returns true if *host* is a subdomain of *domain*.
     *
     * @param {string} host The host to check.
     * @param {string} domain The base domain to check the host against.
     * @returns {boolean}
     */
    isSubdomain: function isSubdomain(host, domain) {
        if (host == null)
            return false;
        let idx = host.lastIndexOf(domain);
        return idx > -1 && idx + domain.length == host.length && (idx == 0 || host[idx - 1] == ".");
    },

    /**
     * Iterates over all currently open documents, including all
     * top-level window and sub-frames thereof.
     */
    iterDocuments: function iterDocuments(types) {
        types = types ? types.map(s => "type" + util.capitalize(s))
                      : ["typeChrome", "typeContent"];

        let windows = services.windowMediator.getXULWindowEnumerator(null);
        while (windows.hasMoreElements()) {
            let window = windows.getNext().QueryInterface(Ci.nsIXULWindow);
            for (let type of types) {
                let docShells = window.docShell.getDocShellEnumerator(Ci.nsIDocShellTreeItem[type],
                                                                      Ci.nsIDocShell.ENUMERATE_FORWARDS);
                while (docShells.hasMoreElements())
                    let (viewer = docShells.getNext().QueryInterface(Ci.nsIDocShell).contentViewer) {
                        if (viewer)
                            yield viewer.DOMDocument;
                    };
            }
        }
    },

    // ripped from Firefox; modified
    unsafeURI: Class.Memoize(() => util.regexp(String.replace(literal(function () /*
            [
                \s
                // Invisible characters (bug 452979)
                U001C U001D U001E U001F // file/group/record/unit separator
                U00AD // Soft hyphen
                UFEFF // BOM
                U2060 // Word joiner
                U2062 U2063 // Invisible times/separator
                U200B UFFFC // Zero-width space/no-break space

                // Bidi formatting characters. (RFC 3987 sections 3.2 and 4.1 paragraph 6)
                U200E U200F U202A U202B U202C U202D U202E
            ]
        */$), /U/g, "\\u"),
        "gx")),
    losslessDecodeURI: function losslessDecodeURI(url) {
        return url.split("%25").map(function (url) {
                // Non-UTF-8 compliant URLs cause "malformed URI sequence" errors.
                try {
                    return decodeURI(url).replace(this.unsafeURI, encodeURIComponent);
                }
                catch (e) {
                    return url;
                }
            }, this).join("%25").replace(/[\s.,>)]$/, encodeURIComponent);
    },

    /**
     * Creates a DTD fragment from the given object. Each property of
     * the object is converted to an ENTITY declaration. SGML special
     * characters other than ' and % are left intact.
     *
     * @param {object} obj The object to convert.
     * @returns {string} The DTD fragment containing entity declaration
     *      for *obj*.
     */
    makeDTD: let (map = { "'": "&apos;", '"': "&quot;", "%": "&#x25;", "&": "&amp;", "<": "&lt;", ">": "&gt;" })
        function makeDTD(obj) {
            function escape(val) {
               let isDOM = DOM.isJSONXML(val);
               return String.replace(val == null ? "null" :
                                     isDOM       ? DOM.toXML(val)
                                                 : val,
                                     isDOM ? /['%]/g
                                           : /['"%&<>]/g,
                                     m => map[m]);
            }

            return iter(obj).map(([k, v]) =>
                                 ["<!ENTITY ", k, " '", escape(v), "'>"].join(""))
                            .join("\n");
        },

    /**
     * Converts a URI string into a URI object.
     *
     * @param {string} uri
     * @returns {nsIURI}
     */
    newURI: function newURI(uri, charset, base) {
        if (uri instanceof Ci.nsIURI)
            var res = uri.clone();
        else {
            let idx = uri.lastIndexOf(" -> ");
            if (~idx)
                uri = uri.slice(idx + 4);

            res = this.withProperErrors("newURI", services.io, uri, charset, base);
        }
        res instanceof Ci.nsIURL;
        return res;
    },

    /**
     * Removes leading garbage prepended to URIs by the subscript
     * loader.
     */
    fixURI: function fixURI(url) String.replace(url, /.* -> /, ""),

    /**
     * Pretty print a JavaScript object. Use HTML markup to color certain items
     * if *color* is true.
     *
     * @param {Object} object The object to pretty print.
     * @param {boolean} color Whether the output should be colored.
     * @returns {string}
     */
    objectToString: function objectToString(object, color) {
        if (object == null)
            return object + "\n";

        if (!isObject(object))
            return String(object);

        if (object instanceof Ci.nsIDOMElement) {
            let elem = object;
            if (elem.nodeType == elem.TEXT_NODE)
                return elem.data;

            return DOM(elem).repr(color);
        }

        try { // for window.JSON
            var obj = String(object);
        }
        catch (e) {
            obj = Object.prototype.toString.call(obj);
        }

        if (color) {
            obj = template.highlightFilter(util.clip(obj, 150), "\n",
                                           () => ["span", { highlight: "NonText" },
                                                      "^J"]);

            var head = ["span", { highlight: "Title Object" }, obj, "::\n"];
        }
        else
            head = util.clip(obj, 150).replace(/\n/g, "^J") + "::\n";

        let keys = [];

        // window.content often does not want to be queried with "var i in object"
        try {
            let hasValue = !("__iterator__" in object || isinstance(object, ["Generator", "Iterator"]));

            if (object.dactyl && object.modules && object.modules.modules == object.modules) {
                object = Iterator(object);
                hasValue = false;
            }

            let keyIter = object;
            if (iter.iteratorProp in object) {
                keyIter = (k for (k of object));
                hasValue = false;
            }
            else if ("__iterator__" in object && !callable(object.__iterator__))
                keyIter = keys(object);

            for (let i in keyIter) {
                let value = Magic("<no value>");
                try {
                    value = object[i];
                }
                catch (e) {}

                if (!hasValue) {
                    if (isArray(i) && i.length == 2)
                        [i, value] = i;
                    else {
                        var noVal = true;
                        value = i;
                    }
                }

                let key = i;
                if (!isNaN(i))
                    i = parseInt(i);
                else if (/^[A-Z_]+$/.test(i))
                    i = "";

                if (color)
                    value = template.highlight(value, true, 150, !color);
                else if (value instanceof Magic)
                    value = String(value);
                else
                    value = util.clip(String(value).replace(/\n/g, "^J"), 150);

                if (noVal)
                    var val = value;
                else if (color)
                    val = [["span", { highlight: "Key" }, key], ": ", value];
                else
                    val = key + ": " + value;

                keys.push([i, val]);
            }
        }
        catch (e) {
            util.reportError(e);
        }

        function compare(a, b) {
            if (!isNaN(a[0]) && !isNaN(b[0]))
                return a[0] - b[0];
            return String.localeCompare(String(a[0]),
                                        String(b[0]));
        }

        let vals = template.map(keys.sort(compare), f => f[1],
                                "\n");

        if (color) {
            return ["div", { style: "white-space: pre-wrap" }, head, vals];
        }
        return head + vals.join("");
    },

    prettifyJSON: function prettifyJSON(data, indent, invalidOK) {
        const INDENT = indent || "    ";

        function rec(data, level, seen) {
            if (isObject(data)) {
                seen = RealSet(seen);
                if (seen.add(data))
                    throw Error("Recursive object passed");
            }

            let prefix = level + INDENT;

            if (data === undefined)
                data = null;

            if (~["boolean", "number"].indexOf(typeof data) || data === null)
                res.push(String(data));
            else if (isinstance(data, ["String", _]))
                res.push(JSON.stringify(String(data)));
            else if (isArray(data)) {
                if (data.length == 0)
                    res.push("[]");
                else {
                    res.push("[\n");
                    for (let [i, val] in Iterator(data)) {
                        if (i)
                            res.push(",\n");
                        res.push(prefix);
                        rec(val, prefix, seen);
                    }
                    res.push("\n", level, "]");
                }
            }
            else if (isObject(data)) {
                res.push("{\n");

                let i = 0;
                for (let [key, val] in Iterator(data)) {
                    if (i++)
                        res.push(",\n");
                    res.push(prefix, JSON.stringify(key), ": ");
                    rec(val, prefix, seen);
                }
                if (i > 0)
                    res.push("\n", level, "}");
                else
                    res[res.length - 1] = "{}";
            }
            else if (invalidOK)
                res.push({}.toString.call(data));
            else
                throw Error("Invalid JSON object");
        }

        let res = [];
        rec(data, "", RealSet());
        return res.join("");
    },

    observers: {
        "dactyl-cleanup-modules": function cleanupModules(subject, reason) {
            defineModule.loadLog.push("dactyl: util: observe: dactyl-cleanup-modules " + reason);

            for (let module in values(defineModule.modules))
                if (module.cleanup) {
                    util.dump("cleanup: " + module.constructor.className);
                    util.trapErrors(module.cleanup, module, reason);
                }
        }
    },

    /**
     * A generator that returns the values between *start* and *end*, in *step*
     * increments.
     *
     * @param {number} start The interval's start value.
     * @param {number} end The interval's end value.
     * @param {boolean} step The value to step the range by. May be
     *     negative. @default 1
     * @returns {Iterator(Object)}
     */
    range: function range(start, end, step) {
        if (!step)
            step = 1;
        if (step > 0) {
            for (; start < end; start += step)
                yield start;
        }
        else {
            while (start > end)
                yield start += step;
        }
    },

    /**
     * An interruptible generator that returns all values between *start* and
     * *end*. The thread yields every *time* milliseconds.
     *
     * @param {number} start The interval's start value.
     * @param {number} end The interval's end value.
     * @param {number} time The time in milliseconds between thread yields.
     * @returns {Iterator(Object)}
     */
    interruptibleRange: function interruptibleRange(start, end, time) {
        let endTime = Date.now() + time;
        while (start < end) {
            if (Date.now() > endTime) {
                util.threadYield(true, true);
                endTime = Date.now() + time;
            }
            yield start++;
        }
    },

    /**
     * Creates a new RegExp object based on the value of expr stripped
     * of all white space and interpolated with the values from tokens.
     * If tokens, any string in the form of <key> in expr is replaced
     * with the value of the property, 'key', from tokens, if that
     * property exists. If the property value is itself a RegExp, its
     * source is substituted rather than its string value.
     *
     * Additionally, expr is stripped of all JavaScript comments.
     *
     * This is similar to Perl's extended regular expression format.
     *
     * @param {string} expr The expression to compile into a RegExp.
     * @param {string} flags Flags to apply to the new RegExp.
     * @param {object} tokens The tokens to substitute. @optional
     * @returns {RegExp} A custom regexp object.
     */
    regexp: update(function (expr, flags, tokens) {
        flags = flags || [k for ([k, v] in Iterator({ g: "global", i: "ignorecase", m: "multiline", y: "sticky" }))
                          if (expr[v])].join("");

        if (isinstance(expr, ["RegExp"]))
            expr = expr.source;

        expr = String.replace(expr, /\\(.)/, function (m, m1) {
            if (m1 === "c")
                flags = flags.replace(/i/g, "") + "i";
            else if (m1 === "C")
                flags = flags.replace(/i/g, "");
            else
                return m;
            return "";
        });

        // Replace replacement <tokens>.
        if (tokens)
            expr = String.replace(expr, /(\(?P)?<(\w+)>/g,
                                  (m, n1, n2) => !n1 && hasOwnProperty(tokens, n2) ?    tokens[n2].dactylSource
                                                                                     || tokens[n2].source
                                                                                     || tokens[n2]
                                                                                   : m);

        // Strip comments and white space.
        if (/x/.test(flags))
            expr = String.replace(expr, /(\\.)|\/\/[^\n]*|\/\*[^]*?\*\/|\s+/gm,
                                  (m, m1) => m1 || "");

        // Replace (?P<named> parameters)
        if (/\(\?P</.test(expr)) {
            var source = expr;
            let groups = ["wholeMatch"];
            expr = expr.replace(/((?:[^[(\\]|\\.|\[(?:[^\]]|\\.)*\])*)\((?:\?P<([^>]+)>|(\?))?/gy,
                function (m0, m1, m2, m3) {
                    if (!m3)
                        groups.push(m2 || "-group-" + groups.length);
                    return m1 + "(" + (m3 || "");
                });
            var struct = Struct.apply(null, groups);
        }

        let res = update(RegExp(expr, flags.replace("x", "")), {
            bound: Class.Property(Object.getOwnPropertyDescriptor(Class.prototype, "bound")),
            closure: Class.Property(Object.getOwnPropertyDescriptor(Class.prototype, "bound")),
            dactylPropertyNames: ["exec", "match", "test", "toSource", "toString", "global", "ignoreCase", "lastIndex", "multiLine", "source", "sticky"],
            iterate: function iterate(str, idx) util.regexp.iterate(this, str, idx)
        });

        // Return a struct with properties for named parameters if we
        // have them.
        if (struct)
            update(res, {
                exec: function exec() let (match = exec.superapply(this, arguments)) match && struct.fromArray(match),
                dactylSource: source, struct: struct
            });
        return res;
    }, {
        /**
         * Escapes Regular Expression special characters in *str*.
         *
         * @param {string} str
         * @returns {string}
         */
        escape: function regexp_escape(str) str.replace(/([\\{}()[\]^$.?*+|])/g, "\\$1"),

        /**
         * Given a RegExp, returns its source in the form showable to the user.
         *
         * @param {RegExp} re The regexp showable source of which is to be returned.
         * @returns {string}
         */
        getSource: function regexp_getSource(re) re.source.replace(/\\(.)/g,
                                                                   (m0, m1) => m1 === "/" ? m1
                                                                                          : m0),

        /**
         * Iterates over all matches of the given regexp in the given
         * string.
         *
         * @param {RegExp} regexp The regular expression to execute.
         * @param {string} string The string to search.
         * @param {number} lastIndex The index at which to begin searching. @optional
         */
        iterate: function iterate(regexp, string, lastIndex) iter(function () {
            regexp.lastIndex = lastIndex = lastIndex || 0;
            let match;
            while (match = regexp.exec(string)) {
                lastIndex = regexp.lastIndex;
                yield match;
                regexp.lastIndex = lastIndex;
                if (match[0].length == 0 || !regexp.global)
                    break;
            }
        }())
    }),

    /**
     * Flushes the startup or jar cache.
     */
    flushCache: function flushCache(file) {
        if (file)
            services.observer.notifyObservers(file, "flush-cache-entry", "");
        else
            services.observer.notifyObservers(null, "startupcache-invalidate", "");
    },

    /**
     * Reloads dactyl in entirety by disabling the add-on and
     * re-enabling it.
     */
    rehash: function rehash(args) {
        storage.storeForSession("commandlineArgs", args);
        this.timeout(function () {
            this.flushCache();
            cache.flush(bind("test", /^literal:/));
            let addon = config.addon;
            addon.userDisabled = true;
            addon.userDisabled = false;
        });
    },

    errorCount: 0,
    errors: Class.Memoize(() => []),
    maxErrors: 15,
    /**
     * Reports an error to the Error Console and the standard output,
     * along with a stack trace and other relevant information. The
     * error is appended to {@see #errors}.
     */
    reportError: function reportError(error) {
        if (error.noTrace)
            return;

        if (isString(error))
            error = Error(error);

        Cu.reportError(error);

        try {
            this.errorCount++;

            let obj = update({}, error, {
                toString: function () String(error),
                stack: Magic(util.stackLines(String(error.stack || Error().stack)).join("\n").replace(/^/mg, "\t"))
            });

            services.console.logStringMessage(obj.stack);

            this.errors.push([new Date, obj + "\n" + obj.stack]);
            this.errors = this.errors.slice(-this.maxErrors);
            this.errors.toString = function () [k + "\n" + v for ([k, v] in array.iterValues(this))].join("\n\n");

            this.dump(String(error));
            this.dump(obj);
            this.dump("");
        }
        catch (e) {
            try {
                this.dump(String(error));
                this.dump(util.stackLines(error.stack).join("\n"));
            }
            catch (e) { dump(e + "\n"); }
        }

        // ctypes.open("libc.so.6").declare("kill", ctypes.default_abi, ctypes.void_t, ctypes.int, ctypes.int)(
        //     ctypes.open("libc.so.6").declare("getpid", ctypes.default_abi, ctypes.int)(), 2)
    },

    /**
     * Given a domain, returns an array of all non-toplevel subdomains
     * of that domain.
     *
     * @param {string} host The host for which to find subdomains.
     * @returns {[string]}
     */
    subdomains: function subdomains(host) {
        if (/(^|\.)\d+$|:.*:/.test(host))
            // IP address or similar
            return [host];

        let base = host.replace(/.*\.(.+?\..+?)$/, "$1");
        try {
            base = services.tld.getBaseDomainFromHost(host);
        }
        catch (e) {}

        let ary = host.split(".");
        ary = [ary.slice(i).join(".") for (i in util.range(ary.length, 0, -1))];
        return ary.filter(h => h.length >= base.length);
    },

    /**
     * Returns the selection controller for the given window.
     *
     * @param {Window} window
     * @returns {nsISelectionController}
     */
    selectionController: function selectionController(win)
        win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
           .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsISelectionDisplay)
           .QueryInterface(Ci.nsISelectionController),

    /**
     * Escapes a string against shell meta-characters and argument
     * separators.
     */
    shellEscape: function shellEscape(str) '"' + String.replace(str, /[\\"$`]/g, "\\$&") + '"',

    /**
     * Suspend execution for at least *delay* milliseconds. Functions by
     * yielding execution to the next item in the main event queue, and
     * so may lead to unexpected call graphs, and long delays if another
     * handler yields execution while waiting.
     *
     * @param {number} delay The time period for which to sleep in milliseconds.
     */
    sleep: function sleep(delay) {
        let mainThread = services.threading.mainThread;

        let end = Date.now() + delay;
        while (Date.now() < end)
            mainThread.processNextEvent(true);
        return true;
    },

    /**
     * Behaves like String.split, except that when *limit* is reached,
     * the trailing element contains the entire trailing portion of the
     * string.
     *
     *     util.split("a, b, c, d, e", /, /, 3) -> ["a", "b", "c, d, e"]
     *
     * @param {string} str The string to split.
     * @param {RegExp|string} re The regular expression on which to split the string.
     * @param {number} limit The maximum number of elements to return.
     * @returns {[string]}
     */
    split: function split(str, re, limit) {
        re.lastIndex = 0;
        if (!re.global)
            re = RegExp(re.source || re, "g");
        let match, start = 0, res = [];
        while (--limit && (match = re.exec(str)) && match[0].length) {
            res.push(str.substring(start, match.index));
            start = match.index + match[0].length;
        }
        res.push(str.substring(start));
        return res;
    },

    /**
     * Split a string on literal occurrences of a marker.
     *
     * Specifically this ignores occurrences preceded by a backslash, or
     * contained within 'single' or "double" quotes.
     *
     * It assumes backslash escaping on strings, and will thus not count quotes
     * that are preceded by a backslash or within other quotes as starting or
     * ending quoted sections of the string.
     *
     * @param {string} str
     * @param {RegExp} marker
     * @returns {[string]}
     */
    splitLiteral: function splitLiteral(str, marker) {
        let results = [];
        let resep = RegExp(/^(([^\\'"]|\\.|'([^\\']|\\.)*'|"([^\\"]|\\.)*")*?)/.source + marker.source);
        let cont = true;

        while (cont) {
            cont = false;
            str = str.replace(resep, function (match, before) {
                results.push(before);
                cont = match !== "";
                return "";
            });
        }

        results.push(str);
        return results;
    },

    yielders: 0,
    /**
     * Yields execution to the next event in the current thread's event
     * queue. This is a potentially dangerous operation, since any
     * yielders higher in the event stack will prevent execution from
     * returning to the caller until they have finished their wait. The
     * potential for deadlock is high.
     *
     * @param {boolean} flush If true, flush all events in the event
     *      queue before returning. Otherwise, wait for an event to
     *      process before proceeding.
     * @param {boolean} interruptable If true, this yield may be
     *      interrupted by pressing <C-c>, in which case,
     *      Error("Interrupted") will be thrown.
     */
    threadYield: function threadYield(flush, interruptable) {
        this.yielders++;
        try {
            let mainThread = services.threading.mainThread;
            /* FIXME */
            util.interrupted = false;
            do {
                mainThread.processNextEvent(!flush);
                if (util.interrupted)
                    throw Error("Interrupted");
            }
            while (flush === true && mainThread.hasPendingEvents());
        }
        finally {
            this.yielders--;
        }
    },

    /**
     * Waits for the function *test* to return true, or *timeout*
     * milliseconds to expire.
     *
     * @param {function|Promise} test The predicate on which to wait.
     * @param {object} self The 'this' object for *test*.
     * @param {Number} timeout The maximum number of milliseconds to
     *      wait.
     *      @optional
     * @param {boolean} interruptable If true, may be interrupted by
     *      pressing <C-c>, in which case, Error("Interrupted") will be
     *      thrown.
     */
    waitFor: function waitFor(test, self, timeout, interruptable) {
        if (!callable(test)) {
            let done = false;
            var promise = test,
                retVal;
            promise.then((arg) => { retVal = arg; done = true; },
                         (arg) => { retVal = arg; done = true; });
            test = () => done;
        }

        let end = timeout && Date.now() + timeout, result;

        let timer = services.Timer(function () {}, 10, services.Timer.TYPE_REPEATING_SLACK);
        try {
            while (!(result = test.call(self)) && (!end || Date.now() < end))
                this.threadYield(false, interruptable);
        }
        finally {
            timer.cancel();
        }
        return promise ? retVal: result;
    },

    /**
     * Makes the passed function yieldable. Each time the function calls
     * yield, execution is suspended for the yielded number of
     * milliseconds.
     *
     * Example:
     *      let func = yieldable(function () {
     *          util.dump(Date.now()); // 0
     *          yield 1500;
     *          util.dump(Date.now()); // 1500
     *      });
     *      func();
     *
     * @param {function} func The function to mangle.
     * @returns {function} A new function which may not execute
     *      synchronously.
     */
    yieldable: deprecated("Task.spawn", function yieldable(func)
        function magic() {
            let gen = func.apply(this, arguments);
            (function next() {
                try {
                    util.timeout(next, gen.next());
                }
                catch (e if e instanceof StopIteration) {};
            })();
        }),

    /**
     * Wraps a callback function such that its errors are not lost. This
     * is useful for DOM event listeners, which ordinarily eat errors.
     * The passed function has the property *wrapper* set to the new
     * wrapper function, while the wrapper has the property *wrapped*
     * set to the original callback.
     *
     * @param {function} callback The callback to wrap.
     * @returns {function}
     */
    wrapCallback: wrapCallback,

    /**
     * Returns the top-level chrome window for the given window.
     *
     * @param {Window} win The child window.
     * @returns {Window} The top-level parent window.
     */
    topWindow: function topWindow(win)
            win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
               .QueryInterface(Ci.nsIDocShellTreeItem).rootTreeItem
               .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow),

    /**
     * Traps errors in the called function, possibly reporting them.
     *
     * @param {function} func The function to call
     * @param {object} self The 'this' object for the function.
     */
    trapErrors: function trapErrors(func, self, ...args) {
        try {
            if (!callable(func))
                func = self[func];
            return func.apply(self || this, args);
        }
        catch (e) {
            this.reportError(e);
            return undefined;
        }
    },

    /**
     * Returns the file path of a given *url*, for debugging purposes.
     * If *url* points to a file (even if indirectly), the native
     * filesystem path is returned. Otherwise, the URL itself is
     * returned.
     *
     * @param {string} url The URL to mangle.
     * @returns {string} The path to the file.
     */
    urlPath: function urlPath(url) {
        try {
            return util.getFile(url).path;
        }
        catch (e) {
            return url;
        }
    },

    /**
     * Returns a list of all domains and subdomains of documents in the
     * given window and all of its descendant frames.
     *
     * @param {nsIDOMWindow} win The window for which to find domains.
     * @returns {[string]} The visible domains.
     */
    visibleHosts: function visibleHosts(win) {
        let res = [],
            seen = RealSet();
        (function rec(frame) {
            try {
                if (frame.location.hostname)
                    res = res.concat(util.subdomains(frame.location.hostname));
            }
            catch (e) {}
            Array.forEach(frame.frames, rec);
        })(win);
        return res.filter(h => !seen.add(h));
    },

    /**
     * Returns a list of URIs of documents in the given window and all
     * of its descendant frames.
     *
     * @param {nsIDOMWindow} win The window for which to find URIs.
     * @returns {[nsIURI]} The visible URIs.
     */
    visibleURIs: function visibleURIs(win) {
        let res = [],
            seen = RealSet();
        (function rec(frame) {
            try {
                res = res.concat(util.newURI(frame.location.href));
            }
            catch (e) {}
            Array.forEach(frame.frames, rec);
        })(win);
        return res.filter(h => !seen.add(h.spec));
    },

    /**
     * Like Cu.getWeakReference, but won't crash if you pass null.
     */
    weakReference: function weakReference(jsval) {
        if (jsval == null)
            return { get: function get() null };
        return Cu.getWeakReference(jsval);
    },

    /**
     * Wraps native exceptions thrown by the called function so that a
     * proper stack trace may be retrieved from them.
     *
     * @param {function|string} meth The method to call.
     * @param {object} self The 'this' object of the method.
     * @param ... Arguments to pass to *meth*.
     */
    withProperErrors: function withProperErrors(meth, self, ...args) {
        try {
            return (callable(meth) ? meth : self[meth]).apply(self, args);
        }
        catch (e) {
            throw e.stack ? e : Error(e);
        }
    }
}, {
    Array: array
});

/**
 * Math utility methods.
 * @singleton
 */
var GlobalMath = Math;
this.Math = update(Object.create(GlobalMath), {
    /**
     * Returns the specified *value* constrained to the range *min* - *max*.
     *
     * @param {number} value The value to constrain.
     * @param {number} min The minimum constraint.
     * @param {number} max The maximum constraint.
     * @returns {number}
     */
    constrain: function constrain(value, min, max) Math.min(Math.max(min, value), max)
});

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
