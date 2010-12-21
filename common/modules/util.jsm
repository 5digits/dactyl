// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2010 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

Components.utils.import("resource://dactyl/base.jsm");
defineModule("util", {
    exports: ["FailedAssertion", "Math", "NS", "Util", "XBL", "XHTML", "XUL", "util"],
    require: ["services"],
    use: ["highlight", "storage", "template"]
});

const XBL = Namespace("xbl", "http://www.mozilla.org/xbl");
const XHTML = Namespace("html", "http://www.w3.org/1999/xhtml");
const XUL = Namespace("xul", "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul");
const NS = Namespace("dactyl", "http://vimperator.org/namespaces/liberator");
default xml namespace = XHTML;

memoize(this, "Commands", function () {
    // FIXME
    let obj = {};
    services.subscriptLoader.loadSubScript("chrome://dactyl/content/commands.js", obj);
    return obj.Commands;
});

const FailedAssertion = Class("FailedAssertion", Error, {
    init: function (message) {
        update(this, Error(message))
    }
});

function wrapCallback(fn)
    fn.wrapper = function wrappedCallback () {
        try {
            return fn.apply(this, arguments);
        }
        catch (e) {
            util.reportError(e);
            return undefined;
        }
    }

const Util = Module("Util", XPCOM([Ci.nsIObserver, Ci.nsISupportsWeakReference]), {
    init: function () {
        this.Array = array;

        this.addObserver(this);
        this.overlays = {};
    },

    // FIXME: Only works for Pentadactyl
    get activeWindow() services.windowMediator.getMostRecentWindow("navigator:browser"),
    dactyl: {
        __noSuchMethod__: function (meth, args) {
            let win = util.activeWindow;
            if (win && win.dactyl)
                return win.dactyl[meth].apply(win.dactyl, args);
            return null;
        }
    },

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
        let observers = obj.observe;
        function register(meth) {
            services.observer[meth](obj, "quit-application", true);
            for (let target in keys(observers))
                services.observer[meth](obj, target, true);
        }
        Class.replaceProperty(obj, "observe",
            function (subject, target, data) {
                if (target == "quit-application")
                    register("removeObserver");
                if (observers[target])
                    observers[target].call(obj, subject, data);
            });
        obj.observe.unRegister = function () register("removeObserver");
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
            throw FailedAssertion(message);
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

        let match, end = 0, re = /(.*?)%(.)/gy;
        while (match = re.exec(format)) {
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

    compileMacro: function compileFormat(macro) {
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

        let defaults = { lt: "<", gt: ">" };

        let match, end = 0;
        let re = util.regexp(<![CDATA[
            (.*?) // 1
            (?:
                (<\[) | // 2
                < (.*?) > | // 3
                (\]>) // 4
            )
        ]]>, "gy");
        while (match = re.exec(macro)) {
            let [, prefix, open, macro, close] = match;
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
                    quote = function quote(obj) typeof obj === "number" ? obj : Commands.quote(obj);

                if (set.has(defaults, name))
                    stack.top.elements.push(quote(defaults[name]));
                else {
                    stack.top.elements.push(update(
                        function (obj) obj[name] != null ? quote(obj[name]) : "",
                        { test: function (obj) obj[name] != null }));

                    for (let elem in array.iterValues(stack))
                        elem.seen[name] = true;
                }
            }
        }
        if (end < macro.length)
            stack.top.elements.push(macro.substr(end));

        util.assert(stack.length === 1, "Unmatched <[ in macro");
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
            return node.ownerDocument.defaultView.getComputedStyle(node, null);
        }
        catch (e) {
            util.reportError(e);
            util.dump(String(node));
            return {};
        }
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

        let str = services.String();
        str.data = encoder.encodeToString();
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

    /**
     * Dumps a stack trace to the console.
     *
     * @param {string} msg The trace message.
     * @param {number} frames The number of frames to print.
     */
    dumpStack: function dumpStack(msg, frames) {
        let stack = Error().stack.replace(/(?:.*\n){2}/, "");
        if (frames != null)
            [stack] = stack.match(RegExp("(?:.*\n){0," + frames + "}"));
        util.dump((arguments.length == 0 ? "Stack" : msg) + "\n" + stack + "\n");
    },

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
     * @param {Document} doc The document to evaluate the expression in.
     * @default The current document.
     * @param {Node} elem The context element.
     * @default *doc*
     * @param {boolean} asIterator Whether to return the results as an
     *     XPath iterator.
     */
    evaluateXPath: update(
        function evaluateXPath(expression, doc, elem, asIterator) {
            if (!doc)
                doc = util.activeWindow.content.document;
            if (!elem)
                elem = doc;
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
     * Returns the file which backs a given URL, if available.
     *
     * @param {nsIURI} uri The URI for which to find a file.
     */
    getFile: function getFile(uri) {
        try {
            if (isString(uri))
                uri = util.newURI(uri);

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
    httpGet: function httpGet(url, callback) {
        try {
            let xmlhttp = services.Xmlhttp();
            xmlhttp.mozBackgroundRequest = true;
            if (callback)
                xmlhttp.onreadystatechange = function () {
                    if (xmlhttp.readyState == 4)
                        callback(xmlhttp);
                };
            xmlhttp.open("GET", url, !!callback);
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
    OS: {
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
        get illegalCharacters() this.isWindows ? /[<>:"/\\|?*\x00-\x1f]/ : /\//
    },

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
     */
    isVisible: function (node) {
        let style = util.computedStyle(node);
        return style.visibility == "visible" && style.display != "none";
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

    /**
     * Returns the array that results from applying *func* to each property of
     * *obj*.
     *
     * @param {Object} obj
     * @param {function} func
     * @returns {Array}
     */
    map: function map(obj, func) {
        let ary = [];
        for (let i in Iterator(obj))
            ary.push(func(i));
        return ary;
    },

    /**
     * Converts a URI string into a URI object.
     *
     * @param {string} uri
     * @returns {nsIURI}
     */
    // FIXME: createURI needed too?
    newURI: function (uri, charset, base) services.io.newURI(uri.replace(/.* -> /, ""), charset, base),

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

        if (object instanceof Ci.nsIDOMElement) {
            const NAMESPACES = array.toObject([
                [NS, "dactyl"],
                [XHTML, "html"],
                [XUL, "xul"]
            ]);
            let elem = object;
            if (elem.nodeType == elem.TEXT_NODE)
                return elem.data;

            function namespaced(node) {
                var ns = NAMESPACES[node.namespaceURI] || /^(?:(.*?):)?/.exec(node.name)[0];
                if (!ns)
                    return node.localName;
                if (color)
                    return <><span highlight="HelpXMLNamespace">{ns}</span>{node.localName}</>
                return ns + ":" + node.localName;
            }
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
                return tag + (hasChildren ? "/>" : ">...</" + namespaced(elem) + ">");
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

    observe: {
        "toplevel-window-ready": function (window, data) {
            window.addEventListener("DOMContentLoaded", wrapCallback(function listener(event) {
                window.removeEventListener("DOMContentLoaded", listener.wrapper, true);

                if (event.originalTarget !== window.document)
                    return;

                let obj = util.overlays[window.document.documentURI];
                if (obj) {
                    obj = obj(window);

                    function overlay(key, fn) {
                        for (let [elem, xml] in Iterator(obj[key] || {}))
                            if (elem = window.document.getElementById(elem))
                                fn(elem, util.xmlToDom(xml, window.document));
                    }

                    overlay("before", function (elem, dom) elem.parentNode.insertBefore(dom, elem));
                    overlay("after", function (elem, dom) elem.parentNode.insertBefore(dom, elem.nextSibling));
                    overlay("append", function (elem, dom) elem.appendChild(dom));
                    overlay("prepend", function (elem, dom) elem.insertBefore(dom, elem.firstChild));
                    if (obj.init)
                        obj.init(window, event);

                    if (obj.load)
                        window.document.addEventListener("load", function (event) {
                            if (event.originalTarget === event.target)
                                obj.load(window, event);
                        }, true);
                }
            }), true)
        }
    },

    overlayWindow: function (url, fn) {
        Array.concat(url).forEach(function (url) {
            this.overlays[url] = fn;
        }, this);
    },

    /**
     * Parses the fields of a form and returns a URL/POST-data pair
     * that is the equivalent of submitting the form.
     *
     * @param {nsINode} field One of the fields of the given form.
     */
    // Nuances gleaned from browser.jar/content/browser/browser.js
    parseForm: function parseForm(field) {
        function encode(name, value, param) {
            if (param)
                value = value + "%s";
            if (post)
                return name + "=" + value;
            return encodeURIComponent(name) + "=" + (param ? value : encodeURIComponent(value));
        }

        let form = field.form;
        let doc = form.ownerDocument;
        let charset = doc.charset;
        let uri = util.newURI(doc.baseURI.replace(/\?.*/, ""), charset);
        let url = util.newURI(form.action, charset, uri).spec;

        let post = form.method.toUpperCase() == "POST";

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
            return [url, elems.map(encodeURIComponent).join('&'), elems];
        return [url + "?" + elems.join('&'), null];
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
     */
    regexp: update(function (expr, flags, tokens) {
        if (tokens)
            expr = String.replace(expr, /<(\w+)>/g, function (m, n1) set.has(tokens, n1) ? tokens[n1].source || tokens[n1] : m);
        expr = String.replace(expr, /\/\/[^\n]*|\/\*[^]*?\*\//gm, "")
                     .replace(/\s+/g, "");
        return RegExp(expr, flags);
    }, {
        /**
         * Escapes Regular Expression special characters in *str*.
         *
         * @param {string} str
         * @returns {string}
         */
        escape: function regexp_escape(str) str.replace(/([\\{}()[\].?*+])/g, "\\$1"),

        /**
         * Given a RegExp, returns its source in the form showable to the user.
         *
         * @param {RegExp} re The regexp showable source of which is to be returned.
         * @returns {string}
         */
        getSource: function regexp_getSource(re) re.source.replace(/\\(.)/g, function (m0, m1) m1 === "/" ? "/" : m0)
    }),

    maxErrors: 15,
    errors: Class.memoize(function () []),
    reportError: function (error) {
        if (Cu.reportError)
            Cu.reportError(error);

        try {
            let obj = update({}, error, {
                toString: function () String(error),
                stack: <>{String.replace(error.stack || Error().stack, /^/mg, "\t")}</>
            });

            this.errors.push([new Date, obj + "\n" + obj.stack]);
            this.errors = this.errors.slice(-this.maxErrors);
            this.errors.toString = function () [k + "\n" + v for ([k, v] in array.iterValues(this))].join("\n\n");

            this.dump(String(error));
            this.dump(obj);
            this.dump("");
        }
        catch (e) {
            this.dump(e);
        }
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

    threadYield: function (flush, interruptable) {
        let mainThread = services.threading.mainThread;
        /* FIXME */
        util.interrupted = false;
        do {
            mainThread.processNextEvent(!flush);
            if (util.interrupted)
                throw new Error("Interrupted");
        }
        while (flush === true && mainThread.hasPendingEvents());
    },

    /**
     * Traps errors in the called function, possibly reporting them.
     *
     * @param {function} func The function to call
     * @param {object} self The 'this' object for the function.
     */
    trapErrors: function trapErrors(func, self) {
        try {
            return func.apply(self || this, Array.slice(arguments, 2));
        }
        catch (e) {
            util.reportError(e);
            return undefined;
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
                else {
                    domnode.setAttributeNS(NS.uri, "highlight", String(attr));
                    for each (let h in String.split(attr, " "))
                        highlight.loaded[h] = true;
                }

            for each (let child in node.*::*)
                domnode.appendChild(xmlToDom(child, doc, nodes));
            if (nodes && node.@key)
                nodes[node.@key] = domnode;
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
const GlobalMath = Math;
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

} catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
