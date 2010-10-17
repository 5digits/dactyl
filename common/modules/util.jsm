// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

Components.utils.import("resource://dactyl/base.jsm");
defineModule("util", {
    exports: ["FailedAssertion", "Math", "NS", "Prefs", "Util", "XHTML", "XUL", "prefs", "util"],
    require: ["services"],
    use: ["highlight", "template"]
});

const XHTML = Namespace("html", "http://www.w3.org/1999/xhtml");
const XUL = Namespace("xul", "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul");
const NS = Namespace("dactyl", "http://vimperator.org/namespaces/liberator");
default xml namespace = XHTML;

const FailedAssertion = Class("FailedAssertion", Error, {
    init: function (message) {
        this.message = message;
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
    get activeWindow() services.get("windowMediator").getMostRecentWindow("navigator:browser"),
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
            services.get("observer")[meth](obj, "quit-application", true);
            for (let target in keys(observers))
                services.get("observer")[meth](obj, target, true);
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
            throw new FailedAssertion(message);
    },

    /**
     * Calls a function synchronously in the main thread. Return values are not
     * preserved.
     *
     * @param {function} callback
     * @param {object} self The this object for the call.
     * @returns {function}
     */
    callInMainThread: function (callback, self) {
        let mainThread = services.get("threadManager").mainThread;
        if (services.get("threadManager").isMainThread)
            callback.call(self);
        else
            mainThread.dispatch(Runnable(self, callback, Array.slice(arguments, 2)), mainThread.DISPATCH_NORMAL);
    },

    /**
     * Calls a function asynchronously on a new thread.
     *
     * @param {nsIThread} thread The thread to call the function on. If no
     *     thread is specified a new one is created.
     * @optional
     * @param {Object} self The 'this' object used when executing the
     *     function.
     * @param {function} func The function to execute.
     *
     */
    callAsync: function (thread, self, func) {
        thread = thread || services.get("threadManager").newThread(0);
        thread.dispatch(Runnable(self, func, Array.slice(arguments, 3)), thread.DISPATCH_NORMAL);
    },

    /**
     * Calls a function synchronously on a new thread.
     *
     * NOTE: Be sure to call GUI related methods like alert() or dump()
     * ONLY in the main thread.
     *
     * @param {nsIThread} thread The thread to call the function on. If no
     *     thread is specified a new one is created.
     * @optional
     * @param {function} func The function to execute.
     */
    callInThread: function (thread, func) {
        thread = thread || services.get("threadManager").newThread(0);
        thread.dispatch(Runnable(null, func, Array.slice(arguments, 2)), thread.DISPATCH_SYNC);
    },

    /**
     * Returns a shallow copy of <b>obj</b>.
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
     * than <b>length</b>, an ellipsis is appended.
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

    /**
     * Returns an object representing a Node's computed CSS style.
     *
     * @param {Node} node
     * @returns {Object}
     */
    computedStyle: function computedStyle(node) {
        while (node instanceof Ci.nsIDOMText && node.parentNode)
            node = node.parentNode;
        return node.ownerDocument.defaultView.getComputedStyle(node, null);
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
            return services.get("urifixup").createFixupURI(str, services.get("urifixup").FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP);
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

    domToString: function (node) {
        if (node instanceof Ci.nsISelection && node.isCollapsed)
            return "";

        if (node instanceof Ci.nsIDOMNode) {
            let range = node.ownerDocument.createRange();
            range.selectNode(node);
            node = range;
        }
        let doc = (node.getRangeAt ? node.getRangeAt(0) : node).startContainer.ownerDocument;

        let encoder = services.create("htmlEncoder");
        encoder.init(doc, "text/unicode", encoder.OutputRaw|encoder.OutputPreformatted);
        if (node instanceof Ci.nsISelection)
            encoder.setSelection(node);
        else if (node instanceof Ci.nsIDOMRange)
            encoder.setRange(node);

        let str = services.create("string");
        str.data = encoder.encodeToString();

        let [result, length] = [{}, {}];
        services.create("htmlConverter").convert("text/html", str, str.data.length*2, "text/unicode", result, length);
        return result.value.QueryInterface(Ci.nsISupportsString).data;
    },

    /**
     * Prints a message to the console. If <b>msg</b> is an object it is
     * pretty printed.
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
     * Converts HTML special characters in <b>str</b> to the equivalent HTML
     * entities.
     *
     * @param {string} str
     * @returns {string}
     */
    escapeHTML: function escapeHTML(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    },

    /**
     * Escapes Regular Expression special characters in <b>str</b>.
     *
     * @param {string} str
     * @returns {string}
     */
    escapeRegex: function escapeRegex(str) {
        return str.replace(/([\\{}()[\].?*+])/g, "\\$1");
    },

    /**
     * Escapes quotes, newline and tab characters in <b>str</b>. The returned
     * string is delimited by <b>delimiter</b> or " if <b>delimiter</b> is not
     * specified. {@see String#quote}.
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
     * @default <b>doc</b>
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
     * Converts <b>bytes</b> to a pretty printed data size string.
     *
     * @param {number} bytes The number of bytes.
     * @param {string} decimalPlaces The number of decimal places to use if
     *     <b>humanReadable</b> is true.
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
     * Sends a synchronous or asynchronous HTTP request to <b>url</b> and
     * returns the XMLHttpRequest object. If <b>callback</b> is specified the
     * request is asynchronous and the <b>callback</b> is invoked with the
     * object as its argument.
     *
     * @param {string} url
     * @param {function(XMLHttpRequest)} callback
     * @returns {XMLHttpRequest}
     */
    httpGet: function httpGet(url, callback) {
        try {
            let xmlhttp = services.create("xmlhttp");
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
     * Returns true if 'url' is in the domain 'domain'.
     *
     * @param {string} url
     * @param {string} domain
     * @returns {boolean}
     */
    isDomainURL: function isDomainURL(url, domain) util.isSubdomain(util.getHost(url), domain),

    /**
     * Returns true if 'os' matches Dactyl's notion of the current operating
     * system platform. This is one of "WINNT", "Darwin" or "Unix".
     *
     * @param {string} os The OS platform to test.
     * @returns {boolean}
     */
    isOS: function isOS(os) {
        let OS = services.get("runtime").OS;
        return (OS == "WINNT" || OS == "Darwin") ? os == OS : os == "Unix";
    },

    /**
     * Returns true if 'host' is a subdomain of 'domain'.
     *
     * @param {string} host The host to check.
     * @param {string} domain The base domain to check the host agains.
     * @returns {boolean}
     */
    isSubdomain: function isSubdomain(host, domain) {
        if (host == null)
            return false;
        let idx = host.lastIndexOf(domain);
        return idx > -1 && idx + domain.length == host.length && (idx == 0 || host[idx-1] == ".");
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
     * Returns the array that results from applying <b>func</b> to each
     * property of <b>obj</b>.
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

    newThread: function () services.get("threadManager").newThread(0),

    /**
     * Converts a URI string into a URI object.
     *
     * @param {string} uri
     * @returns {nsIURI}
     */
    // FIXME: createURI needed too?
    newURI: function (uri, charset, base) services.get("io").newURI(uri, charset, base),

    /**
     * Pretty print a JavaScript object. Use HTML markup to color certain items
     * if <b>color</b> is true.
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

        if (object === null)
            return "null\n";

        if (typeof object !== "object")
            return false;

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
                value = "%s";
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

        for (let [,elem] in iter(form.elements)) {
            if (set.has(util.editableInputs, elem.type)
                    || /^(?:hidden|textarea)$/.test(elem.type)
                    || elem.checked && /^(?:checkbox|radio)$/.test(elem.type))
                elems.push(encode(elem.name, elem.value, elem === field));
            else if (elem instanceof Ci.nsIDOMHTMLSelectElement) {
                for (let [,opt] in Iterator(elem.options))
                    if (opt.selected)
                        elems.push(encode(elem.name, opt.value));
            }
        }
        if (post)
            return [url, elems.map(encodeURIComponent).join('&'), elems];
        return [url + "?" + elems.join('&'), null];
    },

    /**
     * A generator that returns the values between <b>start</b> and <b>end</b>,
     * in <b>step</b> increments.
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
     * An interruptible generator that returns all values between <b>start</b>
     * and <b>end</b>. The thread yields every <b>time</b> milliseconds.
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
            base = services.get("tld").getBaseDomainFromHost(host);
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
        win.QueryInterface(Ci.nsIInterfaceRequestor)
           .getInterface(Ci.nsIWebNavigation)
           .QueryInterface(Ci.nsIInterfaceRequestor)
           .getInterface(Ci.nsISelectionDisplay)
           .QueryInterface(Ci.nsISelectionController),

    /**
     * Suspend execution for at least 'delay' milliseconds. Functions by
     * yielding execution to the next item in the main event queue, and
     * so may lead to unexpected call graphs, and long delays if another
     * handler yields execution while waiting.
     *
     * @param {number} delay The time period for which to sleep in milliseconds.
     */
    sleep: function (delay) {
        let mainThread = services.get("threadManager").mainThread;

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
     * Behaves like String.split, except that when 'limit' is reached,
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
        let mainThread = services.get("threadManager").mainThread;
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

const Prefs = Module("prefs", XPCOM([Ci.nsIObserver, Ci.nsISupportsWeakReference]), {
    SAVED: "extensions.dactyl.saved.",

    init: function () {
        this._prefContexts = [];

        util.addObserver(this);
        this._branch = services.get("pref").getBranch("").QueryInterface(Ci.nsIPrefBranch2);
        this._branch.addObserver("", this, false);
        this._observers = {};
    },

    observe: {
        "nsPref:changed": function (subject, data) {
            let observers = this._observers[data];
            if (observers) {
                let value = this.get(data, false);
                this._observers[data] = observers.filter(function (callback) {
                    if (!callback.get())
                        return false;
                    util.trapErrors(callback.get(), null, value);
                    return true;
                });
            }
        }
    },

    /**
     * Adds a new preference observer for the given preference.
     *
     * @param {string} pref The preference to observe.
     * @param {function(object)} callback The callback, called with the
     *    new value of the preference whenever it changes.
     */
    watch: function (pref, callback, strong) {
        if (!this._observers[pref])
            this._observers[pref] = [];
        this._observers[pref].push(!strong ? Cu.getWeakReference(callback) : { get: function () callback });
    },

    /**
     * Lists all preferences matching <b>filter</b> or only those with
     * changed values if <b>onlyNonDefault</b> is specified.
     *
     * @param {boolean} onlyNonDefault Limit the list to prefs with a
     *     non-default value.
     * @param {string} filter The list filter. A null filter lists all
     *     prefs.
     * @optional
     */
    list: function list(onlyNonDefault, filter) {
        if (!filter)
            filter = "";

        let prefArray = this.getNames();
        prefArray.sort();
        function prefs() {
            for (let [, pref] in Iterator(prefArray)) {
                let userValue = services.get("pref").prefHasUserValue(pref);
                if (onlyNonDefault && !userValue || pref.indexOf(filter) == -1)
                    continue;

                let value = this.get(pref);

                let option = {
                    isDefault: !userValue,
                    default:   this._load(pref, null, true),
                    value:     <>={template.highlight(value, true, 100)}</>,
                    name:      pref,
                    pre:       "\u00a0\u00a0" // Unicode nonbreaking space.
                };

                yield option;
            }
        };

        return template.options(services.get("dactyl:").host + " Preferences", prefs.call(this));
    },

    /**
     * Returns the value of a preference.
     *
     * @param {string} name The preference name.
     * @param {value} defaultValue The value to return if the preference
     *     is unset.
     */
    get: function (name, defaultValue) {
        return this._load(name, defaultValue);
    },

    /**
     * Returns the default value of a preference
     *
     * @param {string} name The preference name.
     * @param {value} defaultValue The value to return if the preference
     *     has no default value.
     */
    getDefault:  function (name, defaultValue) {
        return this._load(name, defaultValue, true);
    },

    /**
     * Returns the names of all preferences.
     *
     * @param {string} branch The branch in which to search preferences.
     *     @default ""
     */
    getNames: function (branch) services.get("pref").getChildList(branch || "", { value: 0 }),

    _checkSafe: function (name, message, value) {
        let curval = this._load(name, null, false);
        if (arguments.length > 2 && curval === value)
            return;
        let defval = this._load(name, null, true);
        let saved  = this._load(this.SAVED + name);

        if (saved == null && curval != defval || curval != saved) {
            let msg = "Warning: setting preference " + name + ", but it's changed from its default value.";
            if (message)
                msg += " " + message;
            util.dactyl.echomsg(msg);
        }
    },

    /**
     * Resets the preference <b>name</b> to </b>value</b> but warns the user
     * if the value is changed from its default.
     *
     * @param {string} name The preference name.
     * @param {value} value The new preference value.
     */
    safeReset: function (name, message) {
        this._checkSafe(name, message);
        this.reset(name);
        this.reset(this.SAVED + name);
    },

    /**
     * Sets the preference <b>name</b> to </b>value</b> but warns the user
     * if the value is changed from its default.
     *
     * @param {string} name The preference name.
     * @param {value} value The new preference value.
     */
    safeSet: function (name, value, message) {
        this._checkSafe(name, message, value);
        this._store(name, value);
        this._store(this.SAVED + name, value);
    },

    /**
     * Sets the preference <b>name</b> to </b>value</b>.
     *
     * @param {string} name The preference name.
     * @param {value} value The new preference value.
     */
    set: function (name, value) {
        this._store(name, value);
    },

    /**
     * Resets the preference <b>name</b> to its default value.
     *
     * @param {string} name The preference name.
     */
    reset: function (name) {
        try {
            services.get("pref").clearUserPref(name);
        }
        catch (e) {} // ignore - thrown if not a user set value
    },

    /**
     * Toggles the value of the boolean preference <b>name</b>.
     *
     * @param {string} name The preference name.
     */
    toggle: function (name) {
        util.assert(services.get("pref").getPrefType(name) === Ci.nsIPrefBranch.PREF_BOOL,
                    "E488: Trailing characters: " + name + "!");
        this.set(name, !this.get(name));
    },

    /**
     * Pushes a new preference context onto the context stack.
     *
     * @see #withContext
     */
    pushContext: function () {
        this._prefContexts.push({});
    },

    /**
     * Pops the top preference context from the stack.
     *
     * @see #withContext
     */
    popContext: function () {
        for (let [k, v] in Iterator(this._prefContexts.pop()))
            this._store(k, v);
    },

    /**
     * Executes <b>func</b> with a new preference context. When <b>func</b>
     * returns, the context is popped and any preferences set via
     * {@link #setPref} or {@link #invertPref} are restored to their
     * previous values.
     *
     * @param {function} func The function to call.
     * @param {Object} func The 'this' object with which to call <b>func</b>
     * @see #pushContext
     * @see #popContext
     */
    withContext: function (func, self) {
        try {
            this.pushContext();
            return func.call(self);
        }
        finally {
            this.popContext();
        }
    },

    _store: function (name, value) {
        if (this._prefContexts.length) {
            let val = this._load(name, null);
            if (val != null)
                this._prefContexts[this._prefContexts.length - 1][name] = val;
        }

        function assertType(needType)
            util.assert(type === Ci.nsIPrefBranch.PREF_INVALID || type === needType,
                type === Ci.nsIPrefBranch.PREF_INT
                                ? "E521: Number required after =: " + name + "=" + value
                                : "E474: Invalid argument: " + name + "=" + value);

        let type = services.get("pref").getPrefType(name);
        switch (typeof value) {
        case "string":
            assertType(Ci.nsIPrefBranch.PREF_STRING);

            let supportString = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
            supportString.data = value;
            services.get("pref").setComplexValue(name, Ci.nsISupportsString, supportString);
            break;
        case "number":
            assertType(Ci.nsIPrefBranch.PREF_INT);

            services.get("pref").setIntPref(name, value);
            break;
        case "boolean":
            assertType(Ci.nsIPrefBranch.PREF_BOOL);

            services.get("pref").setBoolPref(name, value);
            break;
        default:
            throw FailedAssertion("Unknown preference type: " + typeof value + " (" + name + "=" + value + ")");
        }
    },

    _load: function (name, defaultValue, defaultBranch) {
        if (defaultValue == null)
            defaultValue = null;

        let branch = defaultBranch ? services.get("pref").getDefaultBranch("") : services.get("pref");
        let type = services.get("pref").getPrefType(name);
        try {
            switch (type) {
            case Ci.nsIPrefBranch.PREF_STRING:
                let value = branch.getComplexValue(name, Ci.nsISupportsString).data;
                // try in case it's a localized string (will throw an exception if not)
                if (!services.get("pref").prefIsLocked(name) && !services.get("pref").prefHasUserValue(name) &&
                    RegExp("chrome://.+/locale/.+\\.properties").test(value))
                        value = branch.getComplexValue(name, Ci.nsIPrefLocalizedString).data;
                return value;
            case Ci.nsIPrefBranch.PREF_INT:
                return branch.getIntPref(name);
            case Ci.nsIPrefBranch.PREF_BOOL:
                return branch.getBoolPref(name);
            default:
                return defaultValue;
            }
        }
        catch (e) {
            return defaultValue;
        }
    }
}, {
}, {
    completion: function (dactyl, modules) {
        modules.completion.preference = function preference(context) {
            context.anchored = false;
            context.title = [services.get("dactyl:").host + " Preference", "Value"];
            context.keys = { text: function (item) item, description: function (item) prefs.get(item) };
            context.completions = prefs.getNames();
        };
    },
    javascript: function (dactyl, modules) {
        modules.JavaScript.setCompleter([this.get, this.safeSet, this.set, this.reset, this.toggle],
                [function (context) (context.anchored=false, prefs.getNames().map(function (pref) [pref, ""]))]);
    }
});

/**
 * Math utility methods.
 * @singleton
 */
const GlobalMath = Math;
var Math = update(Object.create(GlobalMath), {
    /**
     * Returns the specified <b>value</b> constrained to the range <b>min</b> -
     * <b>max</b>.
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
