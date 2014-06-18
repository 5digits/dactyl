// Copyright (c) 2008-2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

let global = this;
defineModule("template", {
    exports: ["Binding", "Template", "template"],
    require: ["util"]
});

lazyRequire("help", ["help"]);

var Binding = Class("Binding", {
    init: function (node, nodes) {
        this.node = node;
        this.nodes = nodes;
        node.dactylBinding = this;

        Object.defineProperties(node, this.constructor.properties);

        for (let [event, handler] in values(this.constructor.events))
            node.addEventListener(event, util.wrapCallback(handler, true), false);
    },

    set collapsed(collapsed) {
        if (collapsed)
            this.setAttribute("collapsed", "true");
        else
            this.removeAttribute("collapsed");
    },
    get collapsed() !!this.getAttribute("collapsed"),

    __noSuchMethod__: Class.Property({
        configurable: true,
        writeable: true,
        value: function __noSuchMethod__(meth, args) {
            return this.node[meth].apply(this.node, args);
        }
    })
}, {
    get bindings() {
        let bindingProto = Object.getPrototypeOf(Binding.prototype);
        for (let obj = this.prototype; obj !== bindingProto; obj = Object.getPrototypeOf(obj))
            yield obj;
    },

    bind: function bind(func) function bound() {
        try {
            return func.apply(this.dactylBinding, arguments);
        }
        catch (e) {
            util.reportError(e);
            throw e;
        }
    },

    events: Class.Memoize(function () {
        let res = [];
        for (let obj in this.bindings)
            if (Object.getOwnPropertyDescriptor(obj, "events"))
                for (let [event, handler] in Iterator(obj.events))
                    res.push([event, this.bind(handler)]);
        return res;
    }),

    properties: Class.Memoize(function () {
        let res = {};
        for (let obj in this.bindings)
            for (let prop in properties(obj)) {
                let desc = Object.getOwnPropertyDescriptor(obj, prop);
                if (desc.enumerable) {
                    for (let k in values(["get", "set", "value"]))
                        if (typeof desc[k] === "function")
                            desc[k] = this.bind(desc[k]);
                    res[prop] = desc;
                }
            }
        return res;
    })
});

["appendChild", "getAttribute", "insertBefore", "setAttribute"].forEach(function (key) {
    Object.defineProperty(Binding.prototype, key, {
        configurable: true,
        enumerable: false,
        value: function () this.node[key].apply(this.node, arguments),
        writable: true
    });
});

var Template = Module("Template", {

    bindings: {
        Button: Class("Button", Binding, {
            init: function init(node, params) {
                init.supercall(this, node);

                this.target = params.commandTarget;
            },

            get command() this.getAttribute("command") || this.getAttribute("key"),

            events: {
                "click": function onClick(event) {
                    event.preventDefault();
                    if (this.commandAllowed) {
                        if (hasOwnProperty(this.target.commands || {}, this.command))
                            this.target.commands[this.command].call(this.target);
                        else
                            this.target.command(this.command);
                    }
                }
            },

            get commandAllowed() {
                if (hasOwnProperty(this.target.allowedCommands || {}, this.command))
                    return this.target.allowedCommands[this.command];
                if ("commandAllowed" in this.target)
                    return this.target.commandAllowed(this.command);
                return true;
            },

            update: function update() {
                let collapsed = this.collapsed;
                this.collapsed = !this.commandAllowed;

                if (collapsed == this.commandAllowed) {
                    let event = this.node.ownerDocument.createEvent("Events");
                    event.initEvent("dactyl-commandupdate", true, false);
                    this.node.ownerDocument.dispatchEvent(event);
                }
            }
        }),

        Events: Class("Events", Binding, {
            init: function init(node, params) {
                init.supercall(this, node);

                let obj = params.eventTarget;
                let events = obj[this.getAttribute("events") || "events"];
                if (hasOwnProperty(events, "input"))
                    events["dactyl-input"] = events["input"];

                for (let [event, handler] in Iterator(events))
                    node.addEventListener(event, util.wrapCallback(handler.bind(obj), true), false);
            }
        })
    },

    map: function map(iter, func, sep, interruptable) {
        if (typeof iter.length == "number") // FIXME: Kludge?
            iter = array.iterValues(iter);

        let res = [];
        let n = 0;
        for (let i in Iterator(iter)) {
            let val = func(i, n);
            if (val == undefined)
                continue;
            if (n++ && sep)
                res.push(sep);
            if (interruptable && n % interruptable == 0)
                util.threadYield(true, true);
            res.push(val);
        }
        return res;
    },

    bookmarkDescription: function (item, text) [
        !(item.extra && item.extra.length) ? [] :
        ["span", { highlight: "URLExtra" },
            " (",
            template.map(item.extra, e =>
                ["", e[0], ": ",
                 ["span", { highlight: e[2] }, e[1]]],
                "\u00a0"),
            ")\u00a0"],
        ["a", { identifier: item.id == null ? "" : item.id,
                "dactyl:command": item.command || "",
                href: item.item.url, highlight: "URL" },
            text || ""]
    ],

    filter: function (str) ["span", { highlight: "Filter" }, str],

    completionRow: function completionRow(item, highlightGroup) {
        if (typeof icon == "function")
            icon = icon();

        if (highlightGroup) {
            var text = item[0] || "";
            var desc = item[1] || "";
        }
        else {
            var text = this.processor[0].call(this, item, item.result);
            var desc = this.processor[1].call(this, item, item.description);
        }

        return ["div", { highlight: highlightGroup || "CompItem", style: "white-space: nowrap" },
                   /* The non-breaking spaces prevent empty elements
                    * from pushing the baseline down and enlarging
                    * the row.
                    */
                   ["li", { highlight: "CompResult " + item.highlight },
                       text, "\u00a0"],
                   ["li", { highlight: "CompDesc" },
                       desc, "\u00a0"]];
    },

    helpLink: function (token, text, type) {
        if (!help.initialized)
            util.dactyl.initHelp();

        let topic = token; // FIXME: Evil duplication!
        if (/^\[.*\]$/.test(topic))
            topic = topic.slice(1, -1);
        else if (/^n_/.test(topic))
            topic = topic.slice(2);

        if (help.initialized && !hasOwnProperty(help.tags, topic))
            return ["span", { highlight: type || ""}, text || token];

        type = type || (/^'.*'$/.test(token)   ? "HelpOpt" :
                        /^\[.*\]$|^E\d{3}$/.test(token) ? "HelpTopic" :
                        /^:\w/.test(token)     ? "HelpEx"  : "HelpKey");

        return ["a", { highlight: "InlineHelpLink " + type, tag: topic,
                       href: "dactyl://help-tag/" + topic,
                       "dactyl:command": "dactyl.help" },
                    text || topic];
    },
    HelpLink: function (token) {
        if (!help.initialized)
            util.dactyl.initHelp();

        let topic = token; // FIXME: Evil duplication!
        if (/^\[.*\]$/.test(topic))
            topic = topic.slice(1, -1);
        else if (/^n_/.test(topic))
            topic = topic.slice(2);

        if (help.initialized && !hasOwnProperty(help.tags, topic))
            return token;

        let tag = (/^'.*'$/.test(token)            ? "o" :
                   /^\[.*\]$|^E\d{3}$/.test(token) ? "t" :
                   /^:\w/.test(token)              ? "ex"  : "k");

        topic = topic.replace(/^'(.*)'$/, "$1");
        return [tag, { xmlns: "dactyl" }, topic];
    },
    linkifyHelp: function linkifyHelp(str, help) {
        let re = util.regexp(literal(function () /*
            (?P<pre> [/\s]|^)
            (?P<tag> '[\w-]+' | :(?:[\w-]+!?|!) | (?:._)?<[\w-]+>\w* | \b[a-zA-Z]_(?:[\w[\]]+|.) | \[[\w-;]+\] | E\d{3} )
            (?=      [[\)!,:;./\s]|$)
        */$), "gx");
        return this.highlightSubstrings(str, (function () {
            for (let res in re.iterate(str))
                yield [res.index + res.pre.length, res.tag.length];
        })(), this[help ? "HelpLink" : "helpLink"]);
    },

    // if "processStrings" is true, any passed strings will be surrounded by " and
    // any line breaks are displayed as \n
    highlight: function highlight(arg, processStrings, clip, bw) {
        // some objects like window.JSON or getBrowsers()._browsers need the try/catch
        try {
            let str = String(arg);
            if (clip)
                str = util.clip(str, clip);
            switch (arg == null ? "undefined" : typeof arg) {
            case "number":
                return ["span", { highlight: "Number" }, str];
            case "string":
                if (processStrings)
                    str = str.quote();
                return ["span", { highlight: "String" }, str];
            case "boolean":
                return ["span", { highlight: "Boolean" }, str];
            case "function":
                if (arg instanceof Ci.nsIDOMElement) // wtf?
                    return util.objectToString(arg, !bw);

                str = str.replace("/* use strict */ \n", "/* use strict */ ");
                if (processStrings)
                    return ["span", { highlight: "Function" },
                                str.replace(/\{(.|\n)*(?:)/g, "{ ... }")];
                arg = String(arg).replace("/* use strict */ \n", "/* use strict */ ");
                return arg;
            case "undefined":
                return ["span", { highlight: "Null" }, "undefined"];
            case "object":
                if (arg instanceof Ci.nsIDOMElement)
                    return util.objectToString(arg, !bw);
                if (arg instanceof util.Magic)
                    return String(arg);

                if (processStrings && false)
                    str = template._highlightFilter(str, "\n",
                                                    function () ["span", { highlight: "NonText" },
                                                                     "^J"]);
                return ["span", { highlight: "Object" }, str];
            case "xml":
                return arg;
            default:
                return "<unknown type>";
            }
        }
        catch (e) {
            return "<error: " + e + ">";
        }
    },

    highlightFilter: function highlightFilter(str, filter, highlight, isURI) {
        if (isURI)
            str = util.losslessDecodeURI(str);

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

    highlightRegexp: function highlightRegexp(str, re, highlight) {
        return this.highlightSubstrings(str, (function () {
            for (let res in util.regexp.iterate(re, str))
                yield [res.index, res[0].length, res.wholeMatch ? [res] : res];
        })(), highlight || template.filter);
    },

    highlightSubstrings: function highlightSubstrings(str, iter, highlight) {
        if (!isString(str))
            return str;

        if (str == "")
            return DOM.DOMString(str);

        let s = [""];
        let start = 0;
        let n = 0, _i;
        for (let [i, length, args] in iter) {
            if (i == _i || i < _i)
                break;
            _i = i;

            s.push(str.substring(start, i),
                   highlight.apply(this, Array.concat(args || str.substr(i, length))));
            start = i + length;
        }
        s.push(str.substr(start));
        return s;
    },

    highlightURL: function highlightURL(str, force) {
        if (force || /^[a-zA-Z]+:\/\//.test(str))
            return ["a", { highlight: "URL", href: str },
                        util.losslessDecodeURI(str)];
        else
            return str;
    },

    icon: function (item, text) [
        ["span", { highlight: "CompIcon" },
            item.icon ? ["img", { src: item.icon }] : []],
        ["span", { class: "td-strut" }],
        text
    ],

    jumps: function jumps(index, elems) {
        return ["table", {},
                ["tr", { style: "text-align: left;", highlight: "Title" },
                    ["th", { colspan: "2" }, _("title.Jump")],
                    ["th", {}, _("title.HPos")],
                    ["th", {}, _("title.VPos")],
                    ["th", {}, _("title.Title")],
                    ["th", {}, _("title.URI")]],
                this.map(Iterator(elems), ([idx, val]) =>
                    ["tr", {},
                        ["td", { class: "indicator" }, idx == index ? ">" : ""],
                        ["td", {}, Math.abs(idx - index)],
                        ["td", {}, val.offset ? val.offset.x : ""],
                        ["td", {}, val.offset ? val.offset.y : ""],
                        ["td", { style: "width: 250px; max-width: 500px; overflow: hidden;" }, val.title],
                        ["td", {},
                            ["a", { href: val.URI.spec, highlight: "URL jump-list" },
                                util.losslessDecodeURI(val.URI.spec)]]])];
    },

    options: function options(title, opts, verbose) {
        return ["table", {},
                ["tr", { highlight: "Title", align: "left" },
                    ["th", {}, "--- " + title + " ---"]],
                this.map(opts, opt =>
                    ["tr", {},
                        ["td", {},
                            ["div", { highlight: "Message" },
                                ["span", { style: opt.isDefault ? "" : "font-weight: bold" },
                                    opt.pre, opt.name],
                                ["span", {}, opt.value],
                                opt.isDefault || opt.default == null ? "" : ["span", { class: "extra-info" }, " (default: ", opt.default, ")"]],
                            verbose && opt.setFrom ? ["div", { highlight: "Message" },
                                                         "       Last set from ",
                                                         template.sourceLink(opt.setFrom)] : ""]])];
    },

    sourceLink: function (frame) {
        let url = util.fixURI(frame.filename || "unknown");
        let path = util.urlPath(url);

        return ["a", { "dactyl:command": "buffer.viewSource",
                        href: url, path: path, line: frame.lineNumber,
                        highlight: "URL" },
            path + ":" + frame.lineNumber];
    },

    table: function table(title, data, indent) {
        let table = ["table", {},
            ["tr", { highlight: "Title", align: "left" },
                ["th", { colspan: "2" }, title]],
            this.map(data, datum =>
                ["tr", {},
                    ["td", { style: "font-weight: bold; min-width: 150px; padding-left: " + (indent || "2ex") }, datum[0]],
                    ["td", {}, datum[1]]])];

        if (table[3].length)
            return table;
    },

    tabular: function tabular(headings, style, iter) {
        // TODO: This might be mind-bogglingly slow. We'll see.
        return ["table", {},
            ["tr", { highlight: "Title", align: "left" },
                this.map(headings, function (h)
                    ["th", {}, h])],
            this.map(iter, (row) =>
                ["tr", {},
                    this.map(Iterator(row), ([i, d]) =>
                        ["td", { style: style[i] || "" }, d])])];
    },

    usage: function usage(iter, format={}) {
        let desc = format.description || (item => this.linkifyHelp(item.description));
        let help = format.help || (item => item.name);
        let sourceLink = (frame) => {
            let source = this.sourceLink(frame);
            source[1]["dactyl:hint"] = source[2];
            return source;
        }
        return ["table", {},
            format.headings ?
                ["thead", { highlight: "UsageHead" },
                    ["tr", { highlight: "Title", align: "left" },
                        this.map(format.headings, (h) => ["th", {}, h])]] :
                [],
            format.columns ?
                ["colgroup", {},
                    this.map(format.columns, (c) => ["col", { style: c }])] :
                [],
            ["tbody", { highlight: "UsageBody" },
                this.map(iter, (item) =>
                    // Urgh.
                    let (name = item.name || item.names[0], frame = item.definedAt)
                        ["tr", { highlight: "UsageItem" },
                            ["td", { style: "padding-right: 2em;" },
                                ["span", { highlight: "Usage Link" },
                                    !frame ? name :
                                        [this.helpLink(help(item), name, "Title"),
                                         ["span", { highlight: "LinkInfo" },
                                            _("io.definedAt"), " ",
                                            sourceLink(frame)]]]],
                            item.columns ? this.map(item.columns, (c) => ["td", {}, c]) : [],
                            ["td", {}, desc(item)]])]];
    }
});

endModule();

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
