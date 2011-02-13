// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

Components.utils.import("resource://dactyl/bootstrap.jsm");
    let frag=1;
defineModule("util", {
    exports: ["frag", "FailedAssertion", "Math", "NS", "Point", "Util", "XBL", "XHTML", "XUL", "util"],
    require: ["services"],
    use: ["commands", "config", "highlight", "storage", "template"]
}, this);

var XBL = Namespace("xbl", "http://www.mozilla.org/xbl");
var XHTML = Namespace("html", "http://www.w3.org/1999/xhtml");
var XUL = Namespace("xul", "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul");
var NS = Namespace("dactyl", "http://vimperator.org/namespaces/liberator");
default xml namespace = XHTML;

var FailedAssertion = Class("FailedAssertion", ErrorBase);
var Point = Struct("x", "y");

var wrapCallback = function wrapCallback(fn) {
    fn.wrapper = function wrappedCallback () {
        try {
            return fn.apply(this, arguments);
        }
        catch (e) {
            util.reportError(e);
            return undefined;
        }
    };
    fn.wrapper.wrapped = fn;
    return fn.wrapper;
}

var getAttr = function getAttr(elem, ns, name)
    elem.hasAttributeNS(ns, name) ? elem.getAttributeNS(ns, name) : null;
var setAttr = function setAttr(elem, ns, name, val) {
    if (val == null)
        elem.removeAttributeNS(ns, name);
    else
        elem.setAttributeNS(ns, name, val);
}

var Util = Module("Util", XPCOM([Ci.nsIObserver, Ci.nsISupportsWeakReference]), {
    init: function () {
        this.Array = array;

        this.addObserver(this);
        this.overlays = {};
    },

    cleanup: function cleanup() {
        for (let { document: doc } in iter(services.windowMediator.getEnumerator(null))) {
            for (let elem in values(doc.dactylOverlayElements || []))
                if (elem.parentNode)
                    elem.parentNode.removeChild(elem);

            for (let [elem, ns, name, orig, value] in values(doc.dactylOverlayAttributes || []))
                if (getAttr(elem, ns, name) === value)
                    setAttr(elem, ns, name, orig);

            delete doc.dactylOverlayElements;
            delete doc.dactylOverlayAttributes;
            delete doc.dactylOverlays;
        }
    },

    // FIXME: Only works for Pentadactyl
    get activeWindow() services.windowMediator.getMostRecentWindow("navigator:browser"),
    dactyl: update(function dactyl(obj) {
        if (obj)
            var global = Class.objectGlobal(obj);
        return {
            __noSuchMethod__: function (meth, args) {
                let win = util.activeWindow;
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
        __noSuchMethod__: function () this().__noSuchMethod__.apply(null, arguments)
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
    addObserver: function (obj) {
        if (!obj.observers)
            obj.observers = obj.observe;

        function register(meth) {
            for (let target in set(["dactyl-cleanup-modules", "quit-application"].concat(Object.keys(obj.observers))))
                try {
                    services.observer[meth](obj, target, true);
                }
                catch (e) {}
        }

        Class.replaceProperty(obj, "observe",
            function (subject, target, data) {
                try {
                    if (target == "quit-application" || target == "dactyl-cleanup-modules")
                        register("removeObserver");
                    if (obj.observers[target])
                        obj.observers[target].call(obj, subject, data);
                }
                catch (e) {
                    if (typeof util === "undefined")
                        dump("dactyl: error: " + e + "\n" + (e.stack || Error().stack).replace(/^/gm, "dactyl:    "));
                    else
                        util.reportError(e);
                }
            });

        obj.observe.unregister = function () register("removeObserver");
        register("addObserver");
    },

    /*
     * Tests a condition and throws a FailedAssertion error on
     * failure.
     *
     * @param {boolean} condition The condition to test.
     * @param {string} message The message to present to the
     *     user on failure.
     */
    assert: function (condition, message) {
        if (!condition)
            throw FailedAssertion(message, 1);
    },

    /**
     * Capitalizes the first character of the given string.
     * @param {string} str The string to capitalize
     * @returns {string}
     */
    capitalize: function capitalize(str) str && str[0].toUpperCase() + str.slice(1),

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
        let list = list.replace(/\s+/g, "");

        // check for chars not in the accepted range
        this.assert(RegExp("^[" + accepted + "-]+$").test(list),
                "Character list outside the range " + accepted.quote());

        // check for illegal ranges
        let matches = list.match(RegExp("[" + accepted + "]-[" + accepted + "]", "g"));
        if (matches) {
            for (let match in values(matches))
                this.assert(match[0] <= match[2],
                    "Invalid character range: " + list.match(match + ".*")[0]);
        }
        return RegExp("[" + list + "]");
    },

    get chromePackages() {
        // Horrible hack.
        let res = {};
        function process(manifest) {
            for each (let line in manifest.split(/\n+/)) {
                let match = /^\s*(content|skin|locale|resource)\s+([^\s#]+)\s/.exec(line);
                if (match)
                    res[match[2]] = true;
            }
        }
        function processJar(file) {
            let jar = services.ZipReader(file);
            if (jar) {
                if (jar.hasEntry("chrome.manifest"))
                    process(File.readStream(jar.getInputStream("chrome.manifest")));
                jar.close();
            }
        }

        for each (let dir in ["UChrm", "AChrom"]) {
            dir = File(services.directory.get(dir, Ci.nsIFile));
            if (dir.exists() && dir.isDirectory())
                for (let file in dir.iterDirectory())
                    if (/\.manifest$/.test(file.leafName))
                        process(file.read());

            dir = File(dir.parent);
            if (dir.exists() && dir.isDirectory())
                for (let file in dir.iterDirectory())
                    if (/\.jar$/.test(file.leafName))
                        processJar(file);

            dir = dir.child("extensions");
            if (dir.exists() && dir.isDirectory())
                for (let ext in dir.iterDirectory()) {
                    if (/\.xpi$/.test(ext.leafName))
                        processJar(ext);
                    else {
                        if (ext.isFile())
                            ext = File(ext.read().replace(/\n*$/, ""));
                        let mf = ext.child("chrome.manifest");
                        if (mf.exists())
                            process(mf.read());
                    }
                }
        }
        return Object.keys(res).sort();
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
                _frame === stack.top || _frame.valid(obj) ?
                    _frame.elements.map(function (e) callable(e) ? e(obj) : e).join("") : "",
            {
                elements: [],
                seen: {},
                valid: function (obj) this.elements.every(function (e) !e.test || e.test(obj))
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
                util.assert(stack.length, "Unmatched %] in format");
            }
            else {
                let quote = function quote(obj, char) obj[char];
                if (char !== char.toLowerCase())
                    quote = function quote(obj, char) Commands.quote(obj[char]);
                char = char.toLowerCase();

                stack.top.elements.push(update(
                    function (obj) obj[char] != null ? quote(obj, char) : "",
                    { test: function (obj) obj[char] != null }));

                for (let elem in array.iterValues(stack))
                    elem.seen[char] = true;
            }
        }
        if (end < format.length)
            stack.top.elements.push(format.substr(end));

        util.assert(stack.length === 1, "Unmatched %[ in format");
        return stack.top;
    },

    compileMacro: function compileMacro(macro, keepUnknown) {
        let stack = [frame()];
        stack.__defineGetter__("top", function () this[this.length - 1]);

        let unknown = util.identity;
        if (!keepUnknown)
            unknown = function () "";

        function frame() update(
            function _frame(obj)
                _frame === stack.top || _frame.valid(obj) ?
                    _frame.elements.map(function (e) callable(e) ? e(obj) : e).join("") : "",
            {
                elements: [],
                seen: {},
                valid: function (obj) this.elements.every(function (e) !e.test || e.test(obj))
            });

        let defaults = { lt: "<", gt: ">" };

        let re = util.regexp(<![CDATA[
            ([^]*?) // 1
            (?:
                (<\{) | // 2
                (< ((?:[a-z]-)?[a-z-]+?) >) | // 3 4
                (\}>) // 5
            )
        ]]>, "giy");
        macro = String(macro);
        let end = 0;
        for (let match in re.iterate(macro)) {
            let [, prefix, open, full, macro, close] = match;
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
                util.assert(stack.length, "Unmatched %] in macro");
            }
            else {
                let [, flags, name] = /^((?:[a-z]-)*)(.*)/.exec(macro);
                flags = set(flags);

                let quote = util.identity;
                if (flags.q)
                    quote = function quote(obj) typeof obj === "number" ? obj : String.quote(obj);
                if (flags.e)
                    quote = function quote(obj) "";

                if (set.has(defaults, name))
                    stack.top.elements.push(quote(defaults[name]));
                else {
                    stack.top.elements.push(update(
                        function (obj) obj[name] != null ? quote(obj[name]) : set.has(obj, name) ? "" : unknown(full),
                        { test: function (obj) obj[name] != null && obj[name] !== false && (!flags.e || obj[name] != "") }));

                    for (let elem in array.iterValues(stack))
                        elem.seen[name] = true;
                }
            }
        }
        if (end < macro.length)
            stack.top.elements.push(macro.substr(end));

        util.assert(stack.length === 1, "Unmatched <{ in macro");
        return stack.top;
    },

    /**
     * Returns an object representing a Node's computed CSS style.
     *
     * @param {Node} node
     * @returns {Object}
     */
    computedStyle: function computedStyle(node) {
        while (!(node instanceof Ci.nsIDOMElement) && node.parentNode)
            node = node.parentNode;
        try {
            var res = node.ownerDocument.defaultView.getComputedStyle(node, null);
        }
        catch (e) {}
        if (res == null) {
            util.dumpStack("Computed style is null: " + node);
            Cu.reportError(Error("Computed style is null: " + node));
            return {};
        }
        return res;
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
            return services.urifixup.createFixupURI(str, services.urifixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP);
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
     * @param {string} pattern The pattern to deglob.
     * @returns [string] The resulting strings.
     */
    debrace: function debrace(pattern) {
        if (pattern.indexOf("{") == -1)
            return [pattern];

        function split(pattern, re, fn, dequote) {
            let end = 0, match, res = [];
            while (match = re.exec(pattern)) {
                end = match.index + match[0].length;
                res.push(match[1]);
                if (fn)
                    fn(match);
            }
            res.push(pattern.substr(end));
            return res.map(function (s) util.dequote(s, dequote));
        }
        let patterns = [], res = [];
        let substrings = split(pattern, /((?:[^\\{]|\\.)*)\{((?:[^\\}]|\\.)*)\}/gy,
            function (match) {
                patterns.push(split(match[2], /((?:[^\\,]|\\.)*),/gy,
                    null, ",{}"));
            }, "{}");
        function rec(acc) {
            if (acc.length == patterns.length)
                res.push(array(substrings).zip(acc).flatten().join(""));
            else
                for (let [, pattern] in Iterator(patterns[acc.length]))
                    rec(acc.concat(pattern));
        }
        rec([]);
        return res;
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
        pattern.replace(/\\(.)/, function (m0, m1) chars.indexOf(m1) >= 0 ? m1 : m0),

    domToString: function (node, html) {
        if (node instanceof Ci.nsISelection && node.isCollapsed)
            return "";

        if (node instanceof Ci.nsIDOMNode) {
            let range = node.ownerDocument.createRange();
            range.selectNode(node);
            node = range;
        }
        let doc = (node.getRangeAt ? node.getRangeAt(0) : node).startContainer.ownerDocument;

        let encoder = services.HtmlEncoder();
        encoder.init(doc, "text/unicode", encoder.OutputRaw|encoder.OutputPreformatted);
        if (node instanceof Ci.nsISelection)
            encoder.setSelection(node);
        else if (node instanceof Ci.nsIDOMRange)
            encoder.setRange(node);

        let str = services.String(encoder.encodeToString());
        if (html)
            return str.data;

        let [result, length] = [{}, {}];
        services.HtmlConverter().convert("text/html", str, str.data.length*2, "text/unicode", result, length);
        return result.value.QueryInterface(Ci.nsISupportsString).data;
    },

    /**
     * Prints a message to the console. If *msg* is an object it is pretty
     * printed.
     *
     * @param {string|Object} msg The message to print.
     */
    dump: defineModule.dump,

    stackLines: function (stack) {
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
    dumpStack: function dumpStack(msg, frames) {
        let stack = util.stackLines(Error().stack);
        stack = stack.slice(1, 1 + (frames || stack.length)).join("\n").replace(/^/gm, "    ");
        util.dump((arguments.length == 0 ? "Stack" : msg) + "\n" + stack + "\n");
    },

    /**
     * The set of input element type attribute values that mark the element as
     * an editable field.
     */
    editableInputs: set(["date", "datetime", "datetime-local", "email", "file",
                         "month", "number", "password", "range", "search",
                         "tel", "text", "time", "url", "week"]),

    /**
     * Converts HTML special characters in *str* to the equivalent HTML
     * entities.
     *
     * @param {string} str
     * @returns {string}
     */
    escapeHTML: function escapeHTML(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;");
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
     * Evaluates an XPath expression in the current or provided
     * document. It provides the xhtml, xhtml2 and dactyl XML
     * namespaces. The result may be used as an iterator.
     *
     * @param {string} expression The XPath expression to evaluate.
     * @param {Node} elem The context element.
     * @default The current document.
     * @param {boolean} asIterator Whether to return the results as an
     *     XPath iterator.
     * @returns {Object} Iterable result of the evaluation.
     */
    evaluateXPath: update(
        function evaluateXPath(expression, elem, asIterator) {
            try {
                if (!elem)
                    elem = util.activeWindow.content.document;
                let doc = elem.ownerDocument || elem;
                if (isArray(expression))
                    expression = util.makeXPath(expression);

                let result = doc.evaluate(expression, elem,
                    evaluateXPath.resolver,
                    asIterator ? Ci.nsIDOMXPathResult.ORDERED_NODE_ITERATOR_TYPE : Ci.nsIDOMXPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                    null
                );

                return Object.create(result, {
                    __iterator__: {
                        value: asIterator ? function () { let elem; while ((elem = this.iterateNext())) yield elem; }
                                          : function () { for (let i = 0; i < this.snapshotLength; i++) yield this.snapshotItem(i); }
                    }
                });
            }
            catch (e) {
                throw e.stack ? e : Error(e);
            }
        },
        {
            resolver: function lookupNamespaceURI(prefix) ({
                    xul: XUL.uri,
                    xhtml: XHTML.uri,
                    xhtml2: "http://www.w3.org/2002/06/xhtml2",
                    dactyl: NS.uri
                }[prefix] || null)
        }),

    extend: function extend(dest) {
        Array.slice(arguments, 1).filter(util.identity).forEach(function (src) {
            for (let [k, v] in Iterator(src)) {
                let get = src.__lookupGetter__(k),
                    set = src.__lookupSetter__(k);
                if (!get && !set)
                    dest[k] = v;
                if (get)
                    dest.__defineGetter__(k, get);
                if (set)
                    dest.__defineSetter__(k, set);
            }
        });
        return dest;
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
        function div(num, denom) [Math.round(num / denom), Math.round(num % denom)];
        let days, hours, minutes;

        [minutes, seconds] = div(seconds, 60);
        [hours, minutes]   = div(minutes, 60);
        [days, hours]      = div(hours,   24);
        if (days)
            return days + " days " + hours + " hours"
        if (hours)
            return hours + "h " + minutes + "m";
        if (minutes)
            return minutes + ":" + pad(2, seconds);
        return seconds + "s";
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
                uri = util.newURI(util.fixURI(uri));

            if (uri instanceof Ci.nsIFileURL)
                return File(uri.QueryInterface(Ci.nsIFileURL).file);

            let channel = services.io.newChannelFromURI(uri);
            channel.cancel(Cr.NS_BINDING_ABORTED);
            if (channel instanceof Ci.nsIFileChannel)
                return File(channel.QueryInterface(Ci.nsIFileChannel).file);
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
    getHost: function (url) {
        try {
            return util.createURI(url).host;
        }
        catch (e) {}
        return null;
    },

    /**
     * Returns true if the current Gecko runtime is of the given version
     * or greater.
     *
     * @param {string} ver The required version.
     * @returns {boolean}
     */
    haveGecko: function (ver) services.versionCompare.compare(services.runtime.platformVersion, ver) >= 0,

    /**
     * Sends a synchronous or asynchronous HTTP request to *url* and returns
     * the XMLHttpRequest object. If *callback* is specified the request is
     * asynchronous and the *callback* is invoked with the object as its
     * argument.
     *
     * @param {string} url
     * @param {function(XMLHttpRequest)} callback
     * @returns {XMLHttpRequest}
     */
    httpGet: function httpGet(url, callback, self) {
        let params = callback;
        if (!isObject(params))
            params = { callback: params && function () callback.apply(self, arguments) };

        try {
            let xmlhttp = services.Xmlhttp();
            xmlhttp.mozBackgroundRequest = true;

            let async = params.callback || params.onload || params.onerror;
            if (async) {
                xmlhttp.onload = function handler(event) { util.trapErrors(params.onload || params.callback, params, xmlhttp, event) };
                xmlhttp.onerror = function handler(event) { util.trapErrors(params.onerror || params.callback, params, xmlhttp, event) };
            }
            if (params.mimeType)
                xmlhttp.overrideMimeType(params.mimeType);

            xmlhttp.open(params.method || "GET", url, async,
                         params.user, params.pass);

            xmlhttp.send(null);
            return xmlhttp;
        }
        catch (e) {
            util.dactyl.log("Error opening " + String.quote(url) + ": " + e, 1);
            return null;
        }
    },

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
    intersection: function (r1, r2) ({
        get width()  this.right - this.left,
        get height() this.bottom - this.top,
        left: Math.max(r1.left, r2.left),
        right: Math.min(r1.right, r2.right),
        top: Math.max(r1.top, r2.top),
        bottom: Math.min(r1.bottom, r2.bottom)
    }),

    /**
     * Returns true if *url* is in the domain *domain*.
     *
     * @param {string} url
     * @param {string} domain
     * @returns {boolean}
     */
    isDomainURL: function isDomainURL(url, domain) util.isSubdomain(util.getHost(url), domain),

    /** Dactyl's notion of the current operating system platform. */
    OS: memoize({
        _arch: services.runtime.OS,
        /**
         * @property {string} The normalised name of the OS. This is one of
         *     "Windows", "Mac OS X" or "Unix".
         */
        get name() this.isWindows ? "Windows" : this.isMacOSX ? "Mac OS X" : "Unix",
        /** @property {boolean} True if the OS is Windows. */
        get isWindows() this._arch == "WINNT",
        /** @property {boolean} True if the OS is Mac OS X. */
        get isMacOSX() this._arch == "Darwin",
        /** @property {boolean} True if the OS is some other *nix variant. */
        get isUnix() !this.isWindows && !this.isMacOSX,
        /** @property {RegExp} A RegExp which matches illegal characters in path components. */
        get illegalCharacters() this.isWindows ? /[<>:"/\\|?*\x00-\x1f]/g : /\//g
    }),

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
     * Returns true if the given DOM node is currently visible.
     *
     * @param {Node} node
     * @returns {boolean}
     */
    isVisible: function (node) {
        let style = util.computedStyle(node);
        return style.visibility == "visible" && style.display != "none";
    },

    /**
     * Iterates over all currently open documents, including all
     * top-level window and sub-frames thereof.
     */
    iterDocuments: function iterDocuments() {
        let windows = services.windowMediator.getXULWindowEnumerator(null);
        while (windows.hasMoreElements()) {
            let window = windows.getNext().QueryInterface(Ci.nsIXULWindow);
            for each (let type in ["typeChrome", "typeContent"]) {
                let docShells = window.docShell.getDocShellEnumerator(Ci.nsIDocShellTreeItem[type],
                                                                      Ci.nsIDocShell.ENUMERATE_FORWARDS);
                while (docShells.hasMoreElements())
                    yield docShells.getNext().QueryInterface(Ci.nsIDocShell).contentViewer.DOMDocument;
            }
        }
    },

    /**
     * Returns an XPath union expression constructed from the specified node
     * tests. An expression is built with node tests for both the null and
     * XHTML namespaces. See {@link Buffer#evaluateXPath}.
     *
     * @param nodes {Array(string)}
     * @returns {string}
     */
    makeXPath: function makeXPath(nodes) {
        return array(nodes).map(util.debrace).flatten()
                           .map(function (node) [node, "xhtml:" + node]).flatten()
                           .map(function (node) "//" + node).join(" | ");
    },

    map: deprecated("iter.map", function map(obj, fn, self) iter(obj).map(fn, self).toArray()),
    writeToClipboard: deprecated("dactyl.clipboardWrite", function writeToClipboard(str, verbose) util.dactyl.clipboardWrite(str, verbose)),
    readFromClipboard: deprecated("dactyl.clipboardRead", function readFromClipboard() util.dactyl.clipboardRead(false)),

    /**
     * Converts a URI string into a URI object.
     *
     * @param {string} uri
     * @returns {nsIURI}
     */
    // FIXME: createURI needed too?
    newURI: function (uri, charset, base) services.io.newURI(uri, charset, base),

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
        // Use E4X literals so html is automatically quoted
        // only when it's asked for. No one wants to see &lt;
        // on their console or :map :foo in their buffer
        // when they expect :map <C-f> :foo.
        XML.prettyPrinting = false;
        XML.ignoreWhitespace = false;

        if (object == null)
            return object + "\n";

        if (!isObject(object))
            return String(object);

        function namespaced(node) {
            var ns = NAMESPACES[node.namespaceURI] || /^(?:(.*?):)?/.exec(node.name)[0];
            if (!ns)
                return node.localName;
            if (color)
                return <><span highlight="HelpXMLNamespace">{ns}</span>{node.localName}</>
            return ns + ":" + node.localName;
        }

        if (object instanceof Ci.nsIDOMElement) {
            const NAMESPACES = array.toObject([
                [NS, "dactyl"],
                [XHTML, "html"],
                [XUL, "xul"]
            ]);
            let elem = object;
            if (elem.nodeType == elem.TEXT_NODE)
                return elem.data;

            try {
                let hasChildren = elem.firstChild && (!/^\s*$/.test(elem.firstChild) || elem.firstChild.nextSibling)
                if (color)
                    return <span highlight="HelpXMLBlock"><span highlight="HelpXMLTagStart">&lt;{
                            namespaced(elem)} {
                                template.map(array.iterValues(elem.attributes),
                                    function (attr)
                                        <span highlight="HelpXMLAttribute">{namespaced(attr)}</span> +
                                        <span highlight="HelpXMLString">{attr.value}</span>,
                                    <> </>)
                            }{ !hasChildren ? "/>" : ">"
                        }</span>{ !hasChildren ? "" : <>...</> +
                            <span highlight="HtmlTagEnd">&lt;{namespaced(elem)}></span>
                    }</span>;

                let tag = "<" + [namespaced(elem)].concat(
                    [namespaced(a) + "=" +  template.highlight(a.value, true)
                     for ([i, a] in array.iterItems(elem.attributes))]).join(" ");
                return tag + (!hasChildren ? "/>" : ">...</" + namespaced(elem) + ">");
            }
            catch (e) {
                return {}.toString.call(elem);
            }
        }

        try { // for window.JSON
            var obj = String(object);
        }
        catch (e) {
            obj = Object.prototype.toString.call(obj);
        }
        obj = template.highlightFilter(util.clip(obj, 150), "\n", !color ? function () "^J" : function () <span highlight="NonText">^J</span>);
        let string = <><span highlight="Title Object">{obj}</span>::<br/>&#x0a;</>;

        let keys = [];

        // window.content often does not want to be queried with "var i in object"
        try {
            let hasValue = !("__iterator__" in object || isinstance(object, ["Generator", "Iterator"]));
            if (object.dactyl && object.modules && object.modules.modules == object.modules) {
                object = Iterator(object);
                hasValue = false;
            }
            for (let i in object) {
                let value = <![CDATA[<no value>]]>;
                try {
                    value = object[i];
                }
                catch (e) {}
                if (!hasValue) {
                    if (isArray(i) && i.length == 2)
                        [i, value] = i;
                    else
                        var noVal = true;
                }

                value = template.highlight(value, true, 150);
                let key = <span highlight="Key">{i}</span>;
                if (!isNaN(i))
                    i = parseInt(i);
                else if (/^[A-Z_]+$/.test(i))
                    i = "";
                keys.push([i, <>{key}{noVal ? "" : <>: {value}</>}<br/>&#x0a;</>]);
            }
        }
        catch (e) {}

        function compare(a, b) {
            if (!isNaN(a[0]) && !isNaN(b[0]))
                return a[0] - b[0];
            return String.localeCompare(a[0], b[0]);
        }
        string += template.map(keys.sort(compare), function (f) f[1]);
        return color ? string : [s for each (s in string)].join("");
    },

    observers: {
        "dactyl-cleanup-modules": function () {
            defineModule.loadLog.push("dactyl: util: observe: dactyl-cleanup-modules");

            for (let module in values(defineModule.modules))
                if (module.cleanup) {
                    util.dump("cleanup: " + module.constructor.className);
                    util.trapErrors(module.cleanup, module);
                }

            JSMLoader.cleanup();

            if (!this.rehashing)
                services.observer.addObserver(this, "dactyl-rehash", true);
        },
        "dactyl-rehash": function () {
            services.observer.removeObserver(this, "dactyl-rehash");

            defineModule.loadLog.push("dactyl: util: observe: dactyl-rehash");
            if (!this.rehashing)
                for (let module in values(defineModule.modules)) {
                    defineModule.loadLog.push("dactyl: util: init(" + module + ")");
                    if (module.reinit)
                        module.reinit();
                    else
                        module.init();
                }
        },
        "dactyl-purge": function () {
            this.rehashing = 1;
        },
        "toplevel-window-ready": function (window, data) {
            window.addEventListener("DOMContentLoaded", wrapCallback(function listener(event) {
                if (event.originalTarget === window.document) {
                    window.removeEventListener("DOMContentLoaded", listener.wrapper, true);
                    util._loadOverlays(window);
                }
            }), true);
        },
        "chrome-document-global-created": function (window, uri) { this.observe(window, "toplevel-window-ready", null); },
        "content-document-global-created": function (window, uri) { this.observe(window, "toplevel-window-ready", null); }
    },

    _loadOverlays: function _loadOverlays(window) {
        if (!window.dactylOverlays)
            window.dactylOverlays = [];

        for each (let obj in util.overlays[window.document.documentURI] || []) {
            if (window.dactylOverlays.indexOf(obj) >= 0)
                continue;
            window.dactylOverlays.push(obj);
            this._loadOverlay(window, obj(window));
        }
    },

    _loadOverlay: function _loadOverlay(window, obj) {
        let doc = window.document;
        if (!doc.dactylOverlayElements) {
            doc.dactylOverlayElements = [];
            doc.dactylOverlayAttributes = [];
        }

        function overlay(key, fn) {
            if (obj[key]) {
                let iterator = Iterator(obj[key]);
                if (!isObject(obj[key]))
                    iterator = ([elem.@id, elem.elements(), elem.@*::*.(function::name() != "id")] for each (elem in obj[key]));

                for (let [elem, xml, attr] in iterator) {
                    if (elem = doc.getElementById(elem)) {
                        let node = util.xmlToDom(xml, doc, obj.objects);
                        if (!(node instanceof Ci.nsIDOMDocumentFragment))
                            doc.dactylOverlayElements.push(node);
                        else
                            for (let n in array.iterValues(node.childNodes))
                                doc.dactylOverlayElements.push(n);

                        fn(elem, node);
                        for each (let attr in attr || []) {
                            let ns = attr.namespace(), name = attr.localName();
                            doc.dactylOverlayAttributes.push([elem, ns, name, getAttr(elem, ns, name), String(attr)]);
                            if (attr.name() != "highlight")
                                elem.setAttributeNS(ns, name, String(attr));
                            else
                                highlight.highlightNode(elem, String(attr));
                        }
                    }
                }
            }
        }

        overlay("before", function (elem, dom) elem.parentNode.insertBefore(dom, elem));
        overlay("after", function (elem, dom) elem.parentNode.insertBefore(dom, elem.nextSibling));
        overlay("append", function (elem, dom) elem.appendChild(dom));
        overlay("prepend", function (elem, dom) elem.insertBefore(dom, elem.firstChild));
        if (obj.init)
            obj.init(window);

        if (obj.load)
            if (doc.readyState === "complete")
                obj.load(window);
            else
                doc.addEventListener("load", wrapCallback(function load(event) {
                    if (event.originalTarget === event.target) {
                        doc.removeEventListener("load", load.wrapper, true);
                        obj.load(window, event);
                    }
                }), true);
    },

    overlayObject: function (object, overrides) {
        let original = Object.create(object);
        overrides = update(Object.create(original), overrides);

        Object.getOwnPropertyNames(overrides).forEach(function (k) {
            let orig, desc = Object.getOwnPropertyDescriptor(overrides, k);
            if (desc.value instanceof Class.Property)
                desc = desc.value.init(k) || desc.value;

            for (let obj = object; obj && !orig; obj = Object.getPrototypeOf(obj))
                if (orig = Object.getOwnPropertyDescriptor(obj, k))
                    Object.defineProperty(original, k, orig);

            // Guard against horrible add-ons that use eval-based monkey
            // patching.
            if (callable(desc.value)) {
                let value = desc.value;

                let sentinel = "(function DactylOverlay() {}())"
                value.toString = function toString() toString.toString.call(this).replace(/\}?$/, sentinel + "; $&");
                value.toSource = function toSource() toString.toSource.call(this).replace(/\}?$/, sentinel + "; $&");

                delete desc.value;
                delete desc.writable;
                desc.get = function get() value;
                desc.set = function set(val) {
                    if (String(val).indexOf(sentinel) < 0)
                        Class.replaceProperty(this, k, val);
                    else {
                        let package_ = util.newURI(util.fixURI(Components.stack.caller.filename)).host;
                        util.reportError(Error("Not replacing property with eval-generated overlay by " + package_));
                        util.dactyl.echoerr("Not replacing property with eval-generated overlay by " + package_);
                    }
                };
            }

            Object.defineProperty(object, k, desc);
        }, this);

        return function unwrap() {
            for each (let k in Object.getOwnPropertyNames(original))
                Object.defineProperty(object, k, Object.getOwnPropertyDescriptor(original, k));
        };
    },

    overlayWindow: function (url, fn) {
        if (url instanceof Ci.nsIDOMWindow)
            util._loadOverlay(url, fn);
        else {
            Array.concat(url).forEach(function (url) {
                if (!this.overlays[url])
                    this.overlays[url] = [];
                this.overlays[url].push(fn);
            }, this);

            for (let doc in util.iterDocuments())
                if (["interactive", "complete"].indexOf(doc.readyState) >= 0)
                    this._loadOverlays(doc.defaultView);
                else
                    this.observe(doc.defaultView, "toplevel-window-ready");
        }
    },

    /**
     * Parses the fields of a form and returns a URL/POST-data pair
     * that is the equivalent of submitting the form.
     *
     * @param {nsINode} field One of the fields of the given form.
     * @returns {array}
     */
    // Nuances gleaned from browser.jar/content/browser/browser.js
    parseForm: function parseForm(field) {
        function encode(name, value, param) {
            param = param ? "%s" : "";
            if (post)
                return name + "=" + encodeComponent(value + param);
            return encodeComponent(name) + "=" + encodeComponent(value) + param;
        }

        let form = field.form;
        let doc = form.ownerDocument;

        let charset = doc.characterSet;
        let converter = services.CharsetConv(charset);
        for each (let cs in form.acceptCharset.split(/\s*,\s*|\s+/)) {
            let c = services.CharsetConv(cs);
            if (c) {
                converter = services.CharsetConv(cs);
                charset = cs;
            }
        }

        let uri = util.newURI(doc.baseURI.replace(/\?.*/, ""), charset);
        let url = util.newURI(form.action, charset, uri).spec;

        let post = form.method.toUpperCase() == "POST";

        let encodeComponent = encodeURIComponent;
        if (charset !== "UTF-8")
            encodeComponent = function encodeComponent(str)
                escape(converter.ConvertFromUnicode(str) + converter.Finish());

        let elems = [];
        if (field instanceof Ci.nsIDOMHTMLInputElement && field.type == "submit")
            elems.push(encode(field.name, field.value));

        for (let [, elem] in iter(form.elements)) {
            if (set.has(util.editableInputs, elem.type)
                    || /^(?:hidden|textarea)$/.test(elem.type)
                    || elem.checked && /^(?:checkbox|radio)$/.test(elem.type))
                elems.push(encode(elem.name, elem.value, elem === field));
            else if (elem instanceof Ci.nsIDOMHTMLSelectElement) {
                for (let [, opt] in Iterator(elem.options))
                    if (opt.selected)
                        elems.push(encode(elem.name, opt.value));
            }
        }
        if (post)
            return [url, elems.join('&'), charset, elems];
        return [url + "?" + elems.join('&'), null, charset, elems];
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
     * @param {string|XML} expr The expression to compile into a RegExp.
     * @param {string} flags Flags to apply to the new RegExp.
     * @param {object} tokens The tokens to substitute. @optional
     * @returns {RegExp} A custom regexp object.
     */
    regexp: update(function (expr, flags, tokens) {
        if (isinstance(expr, ["RegExp"]))
            expr = expr.source;

        if (tokens)
            expr = String.replace(expr, /(\(?P)?<(\w+)>/g, function (m, n1, n2) !n1 && set.has(tokens, n2) ? tokens[n2].dactylSource || tokens[n2].source || tokens[n2] : m);

        expr = String.replace(expr, /(\\.)|\/\/[^\n]*|\/\*[^]*?\*\/|\s+/gm, function (m, m1) m1 || "");

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

        let res = update(RegExp(expr, flags), {
            closure: Class.Property(Object.getOwnPropertyDescriptor(Class.prototype, "closure")),
            dactylPropertyNames: ["exec", "match", "test", "toSource", "toString", "global", "ignoreCase", "lastIndex", "multiLine", "source", "sticky"],
            iterate: function (str, idx) util.regexp.iterate(this, str, idx)
        });
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
        getSource: function regexp_getSource(re) re.source.replace(/\\(.)/g, function (m0, m1) m1 === "/" ? "/" : m0),

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

    rehash: function (args) {
        if (services.fuel)
            services.fuel.storage.set("dactyl.commandlineArgs", args);
        this.timeout(function () {
            this.rehashing = true;
            let addon = config.addon;
            addon.userDisabled = true;
            addon.userDisabled = false;
        });
    },

    errorCount: 0,
    errors: Class.memoize(function () []),
    maxErrors: 15,
    reportError: function (error) {
        if (Cu.reportError)
            Cu.reportError(error);

        try {
            this.errorCount++;

            let obj = update({}, error, {
                toString: function () String(error),
                stack: <>{util.stackLines(String(error.stack || Error().stack)).join("\n").replace(/^/mg, "\t")}</>
            });

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
        ary = [ary.slice(i).join(".") for (i in util.range(ary.length - 1, 0, -1))];
        return ary.filter(function (h) h.length >= base.length);
    },

    /**
     * Scrolls an element into view if and only if it's not already
     * fully visible.
     *
     * @param {Node} elem The element to make visible.
     */
    scrollIntoView: function scrollIntoView(elem, alignWithTop) {
        let win = elem.ownerDocument.defaultView;
        let rect = elem.getBoundingClientRect();
        if (!(rect && rect.bottom <= win.innerHeight && rect.top >= 0 && rect.left < win.innerWidth && rect.right > 0))
            elem.scrollIntoView(arguments.length > 1 ? alignWithTop : Math.abs(rect.top) < Math.abs(win.innerHeight - rect.bottom));
    },

    /**
     * Returns the selection controller for the given window.
     *
     * @param {Window} window
     * @returns {nsISelectionController}
     */
    selectionController: function (win)
        win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
           .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsISelectionDisplay)
           .QueryInterface(Ci.nsISelectionController),

    /**
     * Suspend execution for at least *delay* milliseconds. Functions by
     * yielding execution to the next item in the main event queue, and
     * so may lead to unexpected call graphs, and long delays if another
     * handler yields execution while waiting.
     *
     * @param {number} delay The time period for which to sleep in milliseconds.
     */
    sleep: function (delay) {
        let mainThread = services.threading.mainThread;

        let end = Date.now() + delay;
        while (Date.now() < end)
            mainThread.processNextEvent(true);
        return true;
    },

    highlightFilter: function highlightFilter(str, filter, highlight) {
        return this.highlightSubstrings(str, (function () {
            if (filter.length == 0)
                return;
            let lcstr = String.toLowerCase(str);
            let lcfilter = filter.toLowerCase();
            let start = 0;
            while ((start = lcstr.indexOf(lcfilter, start)) > -1) {
                yield [start, filter.length];
                start += filter.length;
            }
        })(), highlight || template.filter);
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
    split: function (str, re, limit) {
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
    threadYield: function (flush, interruptable) {
        this.yielders++;
        try {
            let mainThread = services.threading.mainThread;
            /* FIXME */
            util.interrupted = false;
            do {
                mainThread.processNextEvent(!flush);
                if (util.interrupted)
                    throw new Error("Interrupted");
            }
            while (flush === true && mainThread.hasPendingEvents());
        }
        finally {
            this.yielders--;
        }
    },

    waitFor: function waitFor(test, self, timeout, interruptable) {
        let end = timeout && Date.now() + timeout, result;

        let timer = services.Timer(function () {}, 10, services.Timer.TYPE_REPEATING_SLACK);
        try {
            while (!(result = test.call(self)) && (!end || Date.now() < end))
                this.threadYield(false, interruptable);
        }
        finally {
            timer.cancel();
        }
        return result;
    },

    yieldable: function yieldable(func)
        function magic() {
            let gen = func.apply(this, arguments);
            (function next() {
                try {
                    util.timeout(next, gen.next());
                }
                catch (e if e instanceof StopIteration) {};
            })();
        },

    wrapCallback: wrapCallback,

    /**
     * Traps errors in the called function, possibly reporting them.
     *
     * @param {function} func The function to call
     * @param {object} self The 'this' object for the function.
     */
    trapErrors: function trapErrors(func, self) {
        try {
            if (isString(func))
                func = self[func];
            return func.apply(self || this, Array.slice(arguments, 2));
        }
        catch (e) {
            util.reportError(e);
            return undefined;
        }
    },

    urlPath: function urlPath(url) {
        try {
            return util.getFile(url).path;
        }
        catch (e) {
            return url;
        }
    },

    visibleHosts: function (win) {
        let res = [], seen = {};
        (function rec(frame) {
            try {
                res = res.concat(util.subdomains(frame.location.host));
            }
            catch (e) {}
            Array.forEach(frame.frames, rec);
        })(win);
        return res.filter(function (h) !set.add(seen, h));
    },

    visibleURIs: function (win) {
        let res = [], seen = {};
        (function rec(frame) {
            try {
                res = res.concat(util.newURI(frame.location.href));
            }
            catch (e) {}
            Array.forEach(frame.frames, rec);
        })(win);
        return res.filter(function (h) !set.add(seen, h.spec));
    },

    /**
     * Converts an E4X XML literal to a DOM node. Any attribute named
     * highlight is present, it is transformed into dactyl:highlight,
     * and the named highlight groups are guaranteed to be loaded.
     *
     * @param {Node} node
     * @param {Document} doc
     * @param {Object} nodes If present, nodes with the "key" attribute are
     *     stored here, keyed to the value thereof.
     * @returns {Node}
     */
    xmlToDom: function xmlToDom(node, doc, nodes) {
        XML.prettyPrinting = false;
        if (typeof node === "string") // Sandboxes can't currently pass us XML objects.
            node = XML(node);

        if (node.length() != 1) {
            let domnode = doc.createDocumentFragment();
            for each (let child in node)
                domnode.appendChild(xmlToDom(child, doc, nodes));
            return domnode;
        }

        switch (node.nodeKind()) {
        case "text":
            return doc.createTextNode(String(node));
        case "element":
            let domnode = doc.createElementNS(node.namespace(), node.localName());

            for each (let attr in node.@*::*)
                if (attr.name() != "highlight")
                    domnode.setAttributeNS(attr.namespace(), attr.localName(), String(attr));

            for each (let child in node.*::*)
                domnode.appendChild(xmlToDom(child, doc, nodes));
            if (nodes && node.@key)
                nodes[node.@key] = domnode;

            if ("@highlight" in node)
                highlight.highlightNode(domnode, String(node.@highlight), nodes || true);
            return domnode;
        default:
            return null;
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
var Math = update(Object.create(GlobalMath), {
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

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
