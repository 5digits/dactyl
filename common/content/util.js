// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2009 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

const XHTML = Namespace("html", "http://www.w3.org/1999/xhtml");
const XUL = Namespace("xul", "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul");
const NS = Namespace("liberator", "http://vimperator.org/namespaces/liberator");
default xml namespace = XHTML;

const Util = Module("util", {
    init: function () {
        this.Array = Util.Array;
    },

    /**
     * Returns true if its argument is an Array object, regardless
     * of which context it comes from.
     *
     * @param {object} obj
     */
    isArray: function isArray(obj) Object.prototype.toString.call(obj) == "[object Array]",

    /**
     * Returns a shallow copy of <b>obj</b>.
     *
     * @param {Object} obj
     * @returns {Object}
     */
    cloneObject: function cloneObject(obj) {
        if (obj instanceof Array)
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
        while (node instanceof Text && node.parentNode)
            node = node.parentNode;
        return node.ownerDocument.defaultView.getComputedStyle(node, null);
    },

    /**
     * Copies a string to the system clipboard. If <b>verbose</b> is specified
     * the copied string is also echoed to the command line.
     *
     * @param {string} str
     * @param {boolean} verbose
     */
    copyToClipboard: function copyToClipboard(str, verbose) {
        const clipboardHelper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
        clipboardHelper.copyString(str);

        if (verbose)
            liberator.echo("Yanked " + str, commandline.FORCE_SINGLELINE);
    },

    /**
     * Converts any arbitrary string into an URI object.
     *
     * @param {string} str
     * @returns {Object}
     */
    // FIXME: newURI needed too?
    createURI: function createURI(str) {
        const fixup = Cc["@mozilla.org/docshell/urifixup;1"].getService(Ci.nsIURIFixup);
        return fixup.createFixupURI(str, fixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP);
    },

    /**
     * Converts HTML special characters in <b>str</b> to the equivalent HTML
     * entities.
     *
     * @param {string} str
     * @returns {string}
     */
    escapeHTML: function escapeHTML(str) {
        // XXX: the following code is _much_ slower than a simple .replace()
        // :history display went down from 2 to 1 second after changing
        //
        // var e = window.content.document.createElement("div");
        // e.appendChild(window.content.document.createTextNode(str));
        // return e.innerHTML;
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
     * Returns an XPath union expression constructed from the specified node
     * tests. An expression is built with node tests for both the null and
     * XHTML namespaces. See {@link Buffer#evaluateXPath}.
     *
     * @param nodes {Array(string)}
     * @returns {string}
     */
    makeXPath: function makeXPath(nodes) {
        return util.Array(nodes).map(function (node) [node, "xhtml:" + node]).flatten()
                                .map(function (node) "//" + node).join(" | ");
    },

    /**
     * Memoize the lookup of a property in an object.
     *
     * @param {object} obj The object to alter.
     * @param {string} key The name of the property to memoize.
     * @param {function} getter A function of zero to two arguments which
     *          will return the property's value. <b>obj</b> is
     *          passed as the first argument, <b>key</b> as the
     *          second.
     */
    memoize: function memoize(obj, key, getter) {
        obj.__defineGetter__(key, function () {
            delete obj[key];
            obj[key] = getter(obj, key);
            return obj[key];
        });
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
                cont = true;
                return "";
            });
        }

        results.push(str);
        return results;
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

    exportHelp: function (path) {
        const FILE = io.File(path);
        const PATH = FILE.leafName.replace(/\..*/, "") + "/";
        const TIME = Date.now();

        liberator.initHelp();
        let zip = services.create("zipWriter");
        zip.open(FILE, File.MODE_CREATE | File.MODE_WRONLY | File.MODE_TRUNCATE);
        function addURIEntry(file, uri)
            zip.addEntryChannel(PATH + file, TIME, 9,
                services.get("io").newChannel(uri, null, null), false);
        function addDataEntry(file, data) // Inideal to an extreme.
            addURIEntry(file, "data:text/plain;charset=UTF-8," + encodeURI(data));

        let empty = util.Array.toObject(
            "area base basefont br col frame hr img input isindex link meta param"
            .split(" ").map(Array.concat));

        let chrome = {};
        for (let [file,] in Iterator(services.get("liberator:").FILE_MAP)) {
            liberator.open("liberator://help/" + file);
            events.waitForPageLoad();
            let data = [
                '<?xml version="1.0" encoding="UTF-8"?>\n',
                '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"\n',
                '          "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n'
            ];
            function fix(node) {
                switch(node.nodeType) {
                    case Node.ELEMENT_NODE:
                        if (node instanceof HTMLScriptElement)
                            return;

                        data.push("<"); data.push(node.localName);
                        if (node instanceof HTMLHtmlElement)
                            data.push(" xmlns=" + XHTML.uri.quote());

                        for (let { name: name, value: value } in util.Array.itervalues(node.attributes)) {
                            if (name == "liberator:highlight") {
                                name = "class";
                                value = "hl-" + value;
                            }
                            if (name == "href") {
                                if (value.indexOf("liberator://help-tag/") == 0)
                                    value = services.get("io").newChannel(value, null, null).originalURI.path.substr(1);
                                if (!/[#\/]/.test(value))
                                    value += ".xhtml";
                            }
                            if (name == "src" && value.indexOf(":") > 0) {
                                chrome[value] = value.replace(/.*\//, "");;
                                value = value.replace(/.*\//, "");
                            }
                            data.push(" ");
                            data.push(name);
                            data.push('="');
                            data.push(<>{value}</>.toXMLString());
                            data.push('"')
                        }
                        if (node.localName in empty)
                            data.push(" />");
                        else {
                            data.push(">");
                            if (node instanceof HTMLHeadElement)
                                data.push(<link rel="stylesheet" type="text/css" href="help.css"/>.toXMLString());
                            Array.map(node.childNodes, arguments.callee);
                            data.push("</"); data.push(node.localName); data.push(">");
                        }
                        break;
                    case Node.TEXT_NODE:
                        data.push(<>{node.textContent}</>.toXMLString());
                }
            }
            fix(content.document.documentElement);
            addDataEntry(file + ".xhtml", data.join(""));
        }

        let data = [h.selector.replace(/^\[.*?=(.*?)\]/, ".hl-$1").replace(/html\|/, "") +
                        "\t{" + h.value + "}"
                    for (h in highlight) if (/^Help|^Logo/.test(h.class))];

        data = data.join("\n");
        addDataEntry("help.css", data.replace(/chrome:[^ ")]+\//g, ""));

        let re = /(chrome:[^ ");]+\/)([^ ");]+)/g;
        while ((m = re.exec(data)))
            chrome[m[0]] = m[2];

        for (let [uri, leaf] in Iterator(chrome))
            addURIEntry(leaf, uri);

        zip.close();
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
            let xmlhttp = new XMLHttpRequest();
            xmlhttp.mozBackgroundRequest = true;
            if (callback) {
                xmlhttp.onreadystatechange = function () {
                    if (xmlhttp.readyState == 4)
                        callback(xmlhttp);
                };
            }
            xmlhttp.open("GET", url, !!callback);
            xmlhttp.send(null);
            return xmlhttp;
        }
        catch (e) {
            liberator.log("Error opening " + url + ": " + e, 1);
            return null;
        }
    },

    /**
     * Evaluates an XPath expression in the current or provided
     * document. It provides the xhtml, xhtml2 and liberator XML
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
    evaluateXPath: function (expression, doc, elem, asIterator) {
        if (!doc)
            doc = window.content.document;
        if (!elem)
            elem = doc;
        if (util.isArray(expression))
            expression = util.makeXPath(expression);

        let result = doc.evaluate(expression, elem,
            function lookupNamespaceURI(prefix) {
                return {
                    xhtml: "http://www.w3.org/1999/xhtml",
                    xhtml2: "http://www.w3.org/2002/06/xhtml2",
                    liberator: NS.uri
                }[prefix] || null;
            },
            asIterator ? XPathResult.ORDERED_NODE_ITERATOR_TYPE : XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
        );

        return {
                __proto__: result,
                __iterator__: asIterator
                            ? function () { let elem; while ((elem = this.iterateNext())) yield elem; }
                            : function () { for (let i = 0; i < this.snapshotLength; i++) yield this.snapshotItem(i); }
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

    /**
     * Math utility methods.
     * @singleton
     */
    Math: {
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
    },

    /**
     * Converts a URI string into a URI object.
     *
     * @param {string} uri
     * @returns {nsIURI}
     */
    // FIXME: createURI needed too?
    newURI: function (uri) {
        return services.get("io").newURI(uri, null, null);
    },

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

        if (typeof object != "object")
            return false;

        const NAMESPACES = util.Array.toObject([
            [NS, 'liberator'],
            [XHTML, 'html'],
            [XUL, 'xul']
        ]);
        if (object instanceof Element) {
            let elem = object;
            if (elem.nodeType == elem.TEXT_NODE)
                return elem.data;
            function namespaced(node) {
                var ns = NAMESPACES[node.namespaceURI];
                if (ns)
                    return ns + ":" + node.localName;
                return node.localName.toLowerCase();
            }
            try {
                let tag = "<" + [namespaced(elem)].concat(
                    [namespaced(a) + "=" +  template.highlight(a.value, true)
                     for ([i, a] in util.Array.iteritems(elem.attributes))]).join(" ");

                if (!elem.firstChild || /^\s*$/.test(elem.firstChild) && !elem.firstChild.nextSibling)
                    tag += '/>';
                else
                    tag += '>...</' + namespaced(elem) + '>';
                return tag;
            }
            catch (e) {
                return {}.toString.call(elem);
            }
        }

        try { // for window.JSON
            var obj = String(object);
        }
        catch (e) {
            obj = "[Object]";
        }
        obj = template.highlightFilter(util.clip(obj, 150), "\n", !color ? function () "^J" : function () <span highlight="NonText">^J</span>);
        let string = <><span highlight="Title Object">{obj}</span>::<br/>&#xa;</>;

        let keys = [];
        try { // window.content often does not want to be queried with "var i in object"
            let hasValue = !("__iterator__" in object);
            if (modules.isPrototypeOf(object)) {
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
                    if (i instanceof Array && i.length == 2)
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
                keys.push([i, <>{key}{noVal ? "" : <>: {value}</>}<br/>&#xa;</>]);
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
                liberator.threadYield(true, true);
                endTime = Date.now() + time;
            }
            yield start++;
        }
    },

    /**
     * Reads a string from the system clipboard.
     *
     * This is same as Firefox's readFromClipboard function, but is needed for
     * apps like Thunderbird which do not provide it.
     *
     * @returns {string}
     */
    readFromClipboard: function readFromClipboard() {
        let str;

        try {
            const clipboard = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
            const transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);

            transferable.addDataFlavor("text/unicode");

            if (clipboard.supportsSelectionClipboard())
                clipboard.getData(transferable, clipboard.kSelectionClipboard);
            else
                clipboard.getData(transferable, clipboard.kGlobalClipboard);

            let data = {};
            let dataLen = {};

            transferable.getTransferData("text/unicode", data, dataLen);

            if (data) {
                data = data.value.QueryInterface(Ci.nsISupportsString);
                str = data.data.substring(0, dataLen.value / 2);
            }
        }
        catch (e) {}

        return str;
    },

    /**
     * Scrolls an element into view if and only if it's not already
     * fully visible.
     *
     * @param {Node} elem The element to make visible.
     */
    scrollIntoView: function scrollIntoView(elem) {
        let win = elem.ownerDocument.defaultView;
        let rect = elem.getBoundingClientRect();
        if (!(rect && rect.top < win.innerHeight && rect.bottom >= 0 && rect.left < win.innerWidth && rect.right >= 0))
            elem.scrollIntoView();
    },

    /**
     * Converts an E4X XML literal to a DOM node.
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
                domnode.appendChild(arguments.callee(child, doc, nodes));
            return domnode;
        }
        switch (node.nodeKind()) {
        case "text":
            return doc.createTextNode(String(node));
        case "element":
            let domnode = doc.createElementNS(node.namespace(), node.localName());
            for each (let attr in node.@*)
                domnode.setAttributeNS(attr.name() == "highlight" ? NS.uri : attr.namespace(), attr.name(), String(attr));
            for each (let child in node.*)
                domnode.appendChild(arguments.callee(child, doc, nodes));
            if (nodes && node.@key)
                nodes[node.@key] = domnode;
            return domnode;
        default:
            return null;
        }
    }
}, {
    // TODO: Why don't we just push all util.BuiltinType up into modules? --djk
    /**
     * Array utility methods.
     */
    Array: Class("Array", Array, {
        init: function (ary) {
            return {
                __proto__: ary,
                __iterator__: function () this.iteritems(),
                __noSuchMethod__: function (meth, args) {
                    var res = util.Array[meth].apply(null, [this.__proto__].concat(args));

                    if (util.Array.isinstance(res))
                        return util.Array(res);
                    return res;
                },
                toString: function () this.__proto__.toString(),
                concat: function () this.__proto__.concat.apply(this.__proto__, arguments),
                map: function () this.__noSuchMethod__("map", Array.slice(arguments))
            };
        }
    }, {
        isinstance: function isinstance(obj) {
            return Object.prototype.toString.call(obj) == "[object Array]";
        },

        /**
         * Converts an array to an object. As in lisp, an assoc is an
         * array of key-value pairs, which maps directly to an object,
         * as such:
         *    [["a", "b"], ["c", "d"]] -> { a: "b", c: "d" }
         *
         * @param {Array[]} assoc
         * @... {string} 0 - Key
         * @...          1 - Value
         */
        toObject: function toObject(assoc) {
            let obj = {};
            assoc.forEach(function ([k, v]) { obj[k] = v; });
            return obj;
        },

        /**
         * Compacts an array, removing all elements that are null or undefined:
         *    ["foo", null, "bar", undefined] -> ["foo", "bar"]
         *
         * @param {Array} ary
         * @returns {Array}
         */
        compact: function compact(ary) ary.filter(function (item) item != null),

        /**
         * Flattens an array, such that all elements of the array are
         * joined into a single array:
         *    [["foo", ["bar"]], ["baz"], "quux"] -> ["foo", ["bar"], "baz", "quux"]
         *
         * @param {Array} ary
         * @returns {Array}
         */
        flatten: function flatten(ary) ary.length ? Array.concat.apply([], ary) : [],

        /**
         * Returns an Iterator for an array's values.
         *
         * @param {Array} ary
         * @returns {Iterator(Object)}
         */
        itervalues: function itervalues(ary) {
            let length = ary.length;
            for (let i = 0; i < length; i++)
                yield ary[i];
        },

        /**
         * Returns an Iterator for an array's indices and values.
         *
         * @param {Array} ary
         * @returns {Iterator([{number}, {Object}])}
         */
        iteritems: function iteritems(ary) {
            let length = ary.length;
            for (let i = 0; i < length; i++)
                yield [i, ary[i]];
        },

        /**
         * Filters out all duplicates from an array. If
         * <b>unsorted</b> is false, the array is sorted before
         * duplicates are removed.
         *
         * @param {Array} ary
         * @param {boolean} unsorted
         * @returns {Array}
         */
        uniq: function uniq(ary, unsorted) {
            let ret = [];
            if (unsorted) {
                for (let [, item] in Iterator(ary))
                    if (ret.indexOf(item) == -1)
                        ret.push(item);
            }
            else {
                for (let [, item] in Iterator(ary.sort())) {
                    if (item != last || !ret.length)
                        ret.push(item);
                    var last = item;
                }
            }
            return ret;
        }
    })
});

// vim: set fdm=marker sw=4 ts=4 et:
