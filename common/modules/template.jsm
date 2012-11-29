// Copyright (c) 2008-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
/* use strict */

let global = this;
defineModule("template", {
    exports: ["Binding", "Template", "template", "template_"],
    require: ["util"]
});

lazyRequire("help", ["help"]);

default xml namespace = XHTML;

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
    add: function add(a, b) a + b,
    join: function join(c) function (a, b) a + c + b,

    map: function map(iter, func, sep, interruptable) {
        XML.ignoreWhitespace = XML.prettyPrinting = false;
        if (typeof iter.length == "number") // FIXME: Kludge?
            iter = array.iterValues(iter);
        let res = <></>;
        let n = 0;
        for each (let i in Iterator(iter)) {
            let val = func(i, n);
            if (val == undefined)
                continue;
            if (n++ && sep)
                res += sep;
            if (interruptable && n % interruptable == 0)
                util.threadYield(true, true);
            res += val;
        }
        return res;
    },

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
                        if (Set.has(this.target.commands || {}, this.command))
                            this.target.commands[this.command].call(this.target);
                        else
                            this.target.command(this.command);
                    }
                }
            },

            get commandAllowed() {
                if (Set.has(this.target.allowedCommands || {}, this.command))
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
                if (Set.has(events, "input"))
                    events["dactyl-input"] = events["input"];

                for (let [event, handler] in Iterator(events))
                    node.addEventListener(event, util.wrapCallback(obj.closure(handler), true), false);
            }
        })
    },

    bookmarkDescription: function (item, text)
    <>
        {
            !(item.extra && item.extra.length) ? "" :
            <span highlight="URLExtra">
                ({
                    template.map(item.extra, function (e)
                    <>{e[0]}: <span highlight={e[2]}>{e[1]}</span></>,
                    <>&#xa0;</>)
                })&#xa0;</span>
        }
        <a xmlns:dactyl={NS} identifier={item.id == null ? "" : item.id} dactyl:command={item.command || ""}
           href={item.item.url} highlight="URL">{text || ""}</a>
    </>,

    filter: function (str) <span highlight="Filter">{str}</span>,

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

        XML.ignoreWhitespace = XML.prettyPrinting = false;
        // <e4x>
        return <div highlight={highlightGroup || "CompItem"} style="white-space: nowrap">
                   <!-- The non-breaking spaces prevent empty elements
                      - from pushing the baseline down and enlarging
                      - the row.
                      -->
                   <li highlight={"CompResult " + item.highlight}>{text}&#xa0;</li>
                   <li highlight="CompDesc">{desc}&#xa0;</li>
               </div>;
        // </e4x>
    },

    helpLink: function (token, text, type) {
        if (!help.initialized)
            util.dactyl.initHelp();

        let topic = token; // FIXME: Evil duplication!
        if (/^\[.*\]$/.test(topic))
            topic = topic.slice(1, -1);
        else if (/^n_/.test(topic))
            topic = topic.slice(2);

        if (help.initialized && !Set.has(help.tags, topic))
            return <span highlight={type || ""}>{text || token}</span>;

        XML.ignoreWhitespace = XML.prettyPrinting = false;
        type = type || (/^'.*'$/.test(token)   ? "HelpOpt" :
                        /^\[.*\]$|^E\d{3}$/.test(token) ? "HelpTopic" :
                        /^:\w/.test(token)     ? "HelpEx"  : "HelpKey");

        return <a highlight={"InlineHelpLink " + type} tag={topic} href={"dactyl://help-tag/" + topic} dactyl:command="dactyl.help" xmlns:dactyl={NS}>{text || topic}</a>;
    },
    HelpLink: function (token) {
        if (!help.initialized)
            util.dactyl.initHelp();

        let topic = token; // FIXME: Evil duplication!
        if (/^\[.*\]$/.test(topic))
            topic = topic.slice(1, -1);
        else if (/^n_/.test(topic))
            topic = topic.slice(2);

        if (help.initialized && !Set.has(help.tags, topic))
            return <>{token}</>;

        XML.ignoreWhitespace = XML.prettyPrinting = false;
        let tag = (/^'.*'$/.test(token)            ? "o" :
                   /^\[.*\]$|^E\d{3}$/.test(token) ? "t" :
                   /^:\w/.test(token)              ? "ex"  : "k");

        topic = topic.replace(/^'(.*)'$/, "$1");
        return <{tag} xmlns={NS}>{topic}</{tag}>;
    },
    linkifyHelp: function linkifyHelp(str, help) {
        let re = util.regexp(<![CDATA[
            (?P<pre> [/\s]|^)
            (?P<tag> '[\w-]+' | :(?:[\w-]+!?|!) | (?:._)?<[\w-]+>\w* | \b[a-zA-Z]_(?:[\w[\]]+|.) | \[[\w-;]+\] | E\d{3} )
            (?=      [[\)!,:;./\s]|$)
        ]]>, "gx");
        return this.highlightSubstrings(str, (function () {
            for (let res in re.iterate(str))
                yield [res.index + res.pre.length, res.tag.length];
        })(), template[help ? "HelpLink" : "helpLink"]);
    },

    // Fixes some strange stack rewinds on NS_ERROR_OUT_OF_MEMORY
    // exceptions that we can't catch.
    stringify: function stringify(arg) {
        if (!callable(arg))
            return String(arg);

        try {
            this._sandbox.arg = arg;
            return Cu.evalInSandbox("String(arg)", this._sandbox);
        }
        finally {
            this._sandbox.arg = null;
        }
    },

    _sandbox: Class.Memoize(function () Cu.Sandbox(Cu.getGlobalForObject(global),
                                                   { wantXrays: false })),

    // if "processStrings" is true, any passed strings will be surrounded by " and
    // any line breaks are displayed as \n
    highlight: function highlight(arg, processStrings, clip, bw) {
        XML.ignoreWhitespace = XML.prettyPrinting = false;
        // some objects like window.JSON or getBrowsers()._browsers need the try/catch
        try {
            let str = this.stringify(arg);
            if (clip)
                str = util.clip(str, clip);
            switch (arg == null ? "undefined" : typeof arg) {
            case "number":
                return <span highlight="Number">{str}</span>;
            case "string":
                if (processStrings)
                    str = str.quote();
                return <span highlight="String">{str}</span>;
            case "boolean":
                return <span highlight="Boolean">{str}</span>;
            case "function":
                if (arg instanceof Ci.nsIDOMElement) // wtf?
                    return util.objectToString(arg, !bw);

                str = str.replace("/* use strict */ \n", "/* use strict */ ");
                if (processStrings)
                    return <span highlight="Function">{str.replace(/\{(.|\n)*(?:)/g, "{ ... }")}</span>;
                    <>}</>; /* Vim */
                arg = String(arg).replace("/* use strict */ \n", "/* use strict */ ");
                return <>{arg}</>;
            case "undefined":
                return <span highlight="Null">{arg}</span>;
            case "object":
                if (arg instanceof Ci.nsIDOMElement)
                    return util.objectToString(arg, !bw);

                // for java packages value.toString() would crash so badly
                // that we cannot even try/catch it
                if (/^\[JavaPackage.*\]$/.test(arg))
                    return <>[JavaPackage]</>;
                if (processStrings && false)
                    str = template.highlightFilter(str, "\n", function () <span highlight="NonText">^J</span>);
                return <span highlight="Object">{str}</span>;
            case "xml":
                return arg;
            default:
                return <![CDATA[<unknown type>]]>;
            }
        }
        catch (e) {
            return <![CDATA[<unknown>]]>;
        }
    },

    highlightFilter: function highlightFilter(str, filter, highlight, isURI) {
        if (isURI)
            str = util.losslessDecodeURI(str);

        return this.highlightSubstrings(str, (function () {
            if (filter.length == 0)
                return;

            XML.ignoreWhitespace = XML.prettyPrinting = false;
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
        XML.ignoreWhitespace = XML.prettyPrinting = false;
        if (typeof str == "xml")
            return str;
        if (str == "")
            return <>{str}</>;

        str = String(str).replace(" ", "\u00a0");
        let s = <></>;
        let start = 0;
        let n = 0, _i;
        for (let [i, length, args] in iter) {
            if (i == _i || i < _i)
                break;
            _i = i;

            XML.ignoreWhitespace = false;
            s += <>{str.substring(start, i)}</>;
            s += highlight.apply(this, Array.concat(args || str.substr(i, length)));
            start = i + length;
        }
        return s + <>{str.substr(start)}</>;
    },

    highlightURL: function highlightURL(str, force) {
        if (force || /^[a-zA-Z]+:\/\//.test(str))
            return <a highlight="URL" href={str}>{util.losslessDecodeURI(str)}</a>;
        else
            return str;
    },

    icon: function (item, text) <>
        <span highlight="CompIcon">{item.icon ? <img src={item.icon}/> : <></>}</span><span class="td-strut"/>{text}
    </>,

    jumps: function jumps(index, elems) {
        XML.ignoreWhitespace = XML.prettyPrinting = false;
        // <e4x>
        return <table>
                <tr style="text-align: left;" highlight="Title">
                    <th colspan="2">{_("title.Jump")}</th>
                    <th>{_("title.HPos")}</th>
                    <th>{_("title.VPos")}</th>
                    <th>{_("title.Title")}</th>
                    <th>{_("title.URI")}</th>
                </tr>
                {
                    this.map(Iterator(elems), function ([idx, val])
                    <tr>
                        <td class="indicator">{idx == index ? ">" : ""}</td>
                        <td>{Math.abs(idx - index)}</td>
                        <td>{val.offset ? val.offset.x : ""}</td>
                        <td>{val.offset ? val.offset.y : ""}</td>
                        <td style="width: 250px; max-width: 500px; overflow: hidden;">{val.title}</td>
                        <td><a href={val.URI.spec} highlight="URL jump-list">{util.losslessDecodeURI(val.URI.spec)}</a></td>
                    </tr>)
                }
            </table>;
        // </e4x>
    },

    options: function options(title, opts, verbose) {
        XML.ignoreWhitespace = XML.prettyPrinting = false;
        // <e4x>
        return <table>
                <tr highlight="Title" align="left">
                    <th>--- {title} ---</th>
                </tr>
                {
                    this.map(opts, function (opt)
                    <tr>
                        <td>
                            <div highlight="Message"
                            ><span style={opt.isDefault ? "" : "font-weight: bold"}>{opt.pre}{opt.name}</span><span>{opt.value}</span>{
                                opt.isDefault || opt.default == null ? "" : <span class="extra-info"> (default: {opt.default})</span>
                            }</div>{
                                verbose && opt.setFrom ? <div highlight="Message">       Last set from {template.sourceLink(opt.setFrom)}</div> : <></>
                            }
                        </td>
                    </tr>)
                }
            </table>;
        // </e4x>
    },

    sourceLink: function (frame) {
        let url = util.fixURI(frame.filename || "unknown");
        let path = util.urlPath(url);

        XML.ignoreWhitespace = XML.prettyPrinting = false;
        return <a xmlns:dactyl={NS} dactyl:command="buffer.viewSource"
            href={url} path={path} line={frame.lineNumber}
            highlight="URL">{
            path + ":" + frame.lineNumber
        }</a>;
    },

    table: function table(title, data, indent) {
        XML.ignoreWhitespace = XML.prettyPrinting = false;
        let table = // <e4x>
            <table>
                <tr highlight="Title" align="left">
                    <th colspan="2">{title}</th>
                </tr>
                {
                    this.map(data, function (datum)
                    <tr>
                       <td style={"font-weight: bold; min-width: 150px; padding-left: " + (indent || "2ex")}>{datum[0]}</td>
                       <td>{datum[1]}</td>
                    </tr>)
                }
            </table>;
        // </e4x>
        if (table.tr.length() > 1)
            return table;
    },

    tabular: function tabular(headings, style, iter) {
        // TODO: This might be mind-bogglingly slow. We'll see.
        XML.ignoreWhitespace = XML.prettyPrinting = false;
        // <e4x>
        return <table>
                <tr highlight="Title" align="left">
                {
                    this.map(headings, function (h)
                    <th>{h}</th>)
                }
                </tr>
                {
                    this.map(iter, function (row)
                    <tr>
                    {
                        template.map(Iterator(row), function ([i, d])
                        <td style={style[i] || ""}>{d}</td>)
                    }
                    </tr>)
                }
            </table>;
        // </e4x>
    },

    usage: function usage(iter, format) {
        XML.ignoreWhitespace = XML.prettyPrinting = false;
        format = format || {};
        let desc = format.description || function (item) template.linkifyHelp(item.description);
        let help = format.help || function (item) item.name;
        function sourceLink(frame) {
            let source = template.sourceLink(frame);
            source.@NS::hint = source.text();
            return source;
        }
        // <e4x>
        return <table>
            { format.headings ?
                <thead highlight="UsageHead">
                    <tr highlight="Title" align="left">
                    {
                        this.map(format.headings, function (h) <th>{h}</th>)
                    }
                    </tr>
                </thead> : ""
            }
            { format.columns ?
                <colgroup>
                {
                    this.map(format.columns, function (c) <col style={c}/>)
                }
                </colgroup> : ""
            }
            <tbody highlight="UsageBody">{
                this.map(iter, function (item)
                <tr highlight="UsageItem">
                    <td style="padding-right: 2em;">
                        <span highlight="Usage Link">{
                            let (name = item.name || item.names[0], frame = item.definedAt)
                                !frame ? name :
                                    template.helpLink(help(item), name, "Title") +
                                    <span highlight="LinkInfo" xmlns:dactyl={NS}>{_("io.definedAt")} {sourceLink(frame)}</span>
                        }</span>
                    </td>
                    { item.columns ? template.map(item.columns, function (c) <td>{c}</td>) : "" }
                    <td>{desc(item)}</td>
                </tr>)
            }</tbody>
        </table>;
        // </e4x>
    }
});

var Template_ = Module("Template_", {
    map: function map(iter, func, sep, interruptable) {
        if (typeof iter.length == "number") // FIXME: Kludge?
            iter = array.iterValues(iter);

        let res = [];
        let n = 0;
        for each (let i in Iterator(iter)) {
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

            XML.ignoreWhitespace = false;
            s.push(str.substring(start, i),
                   highlight.apply(this, Array.concat(args || str.substr(i, length))));
            start = i + length;
        }
        s.push(str.substr(start));
        return s;
    },

    table: function table(title, data, indent) {
        let table = ["table", {},
            ["tr", { highlight: "Title", align: "left" },
                ["th", { colspan: "2" }, title]],
            this.map(data, function (datum)
                ["tr", {},
                    ["td", { style: "font-weight: bold; min-width: 150px; padding-left: " + (indent || "2ex") }, datum[0]],
                    ["td", {}, datum[1]]])];

        if (table[3].length)
            return table;
    },

    tabular: function tabular(headings, style, iter) {
        let self = this;
        // TODO: This might be mind-bogglingly slow. We'll see.
        return ["table", {},
            ["tr", { highlight: "Title", align: "left" },
                this.map(headings, function (h)
                    ["th", {}, h])],
            this.map(iter, function (row)
                ["tr", {},
                    self.map(Iterator(row), function ([i, d])
                        ["td", { style: style[i] || "" }, d])])];
    },
});

endModule();

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
