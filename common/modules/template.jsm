// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/base.jsm");
defineModule("template", {
    exports: ["Template", "template"],
    require: ["util"]
});

default xml namespace = XHTML;

const Template = Module("Template", {
    add: function add(a, b) a + b,
    join: function join(c) function (a, b) a + c + b,

    map: function map(iter, func, sep, interruptable) {
        XML.ignoreWhitespace = false; XML.prettyPrinting = false;
        if (iter.length) // FIXME: Kludge?
            iter = array.iterValues(iter);
        let ret = <></>;
        let n = 0;
        for each (let i in Iterator(iter)) {
            let val = func(i);
            if (val == undefined)
                continue;
            if (sep && n++)
                ret += sep;
            if (interruptable && n % interruptable == 0)
                util.threadYield(true, true);
            ret += val;
        }
        return ret;
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
        <a xmlns:dactyl={NS} identifier={item.id} dactyl:command={item.command}
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

        XML.ignoreWhitespace = false; XML.prettyPrinting = false;
        // <e4x>
        return <div highlight={highlightGroup || "CompItem"} style="white-space: nowrap">
                   <!-- The non-breaking spaces prevent empty elements
                      - from pushing the baseline down and enlarging
                      - the row.
                      -->
                   <li highlight="CompResult">{text}&#xa0;</li>
                   <li highlight="CompDesc">{desc}&#xa0;</li>
               </div>;
        // </e4x>
    },

    // if "processStrings" is true, any passed strings will be surrounded by " and
    // any line breaks are displayed as \n
    highlight: function highlight(arg, processStrings, clip) {
        XML.ignoreWhitespace = false; XML.prettyPrinting = false;
        // some objects like window.JSON or getBrowsers()._browsers need the try/catch
        try {
            let str = clip ? util.clip(String(arg), clip) : String(arg);
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
                // Vim generally doesn't like /foo*/, because */ looks like a comment terminator.
                // Using /foo*(:?)/ instead.
                if (processStrings)
                    return <span highlight="Function">{str.replace(/\{(.|\n)*(?:)/g, "{ ... }")}</span>;
                    <>}</>; /* Vim */
                return <>{arg}</>;
            case "undefined":
                return <span highlight="Null">{arg}</span>;
            case "object":
                if (arg instanceof Ci.nsIDOMElement)
                    return util.objectToString(arg, false);
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

    highlightRegexp: function highlightRegexp(str, re, highlight) {
        return this.highlightSubstrings(str, (function () {
            let res;
            while ((res = re.exec(str)) && res[0].length)
                yield [res.index, res[0].length];
        })(), highlight || template.filter);
    },

    highlightSubstrings: function highlightSubstrings(str, iter, highlight) {
        XML.ignoreWhitespace = false; XML.prettyPrinting = false;
        if (typeof str == "xml")
            return str;
        if (str == "")
            return <>{str}</>;

        str = String(str).replace(" ", "\u00a0");
        let s = <></>;
        let start = 0;
        let n = 0;
        for (let [i, length] in iter) {
            if (n++ > 50) // Prevent infinite loops.
                break;
            XML.ignoreWhitespace = false;
            s += <>{str.substring(start, i)}</>;
            s += highlight(str.substr(i, length));
            start = i + length;
        }
        return s + <>{str.substr(start)}</>;
    },

    highlightURL: function highlightURL(str, force) {
        if (force || /^[a-zA-Z]+:\/\//.test(str))
            return <a highlight="URL" href={str}>{str}</a>;
        else
            return str;
    },

    icon: function (item, text) <>
        <span highlight="CompIcon">{item.icon ? <img src={item.icon}/> : <></>}</span><span class="td-strut"/>{text}
    </>,

    jumps: function jumps(index, elems) {
        XML.ignoreWhitespace = false; XML.prettyPrinting = false;
        // <e4x>
        return <table>
                <tr style="text-align: left;" highlight="Title">
                    <th colspan="2">jump</th><th>title</th><th>URI</th>
                </tr>
                {
                    this.map(Iterator(elems), function ([idx, val])
                    <tr>
                        <td class="indicator">{idx == index ? ">" : ""}</td>
                        <td>{Math.abs(idx - index)}</td>
                        <td style="width: 250px; max-width: 500px; overflow: hidden;">{val.title}</td>
                        <td><a href={val.URI.spec} highlight="URL jump-list">{val.URI.spec}</a></td>
                    </tr>)
                }
            </table>;
        // </e4x>
    },

    options: function options(title, opts) {
        XML.ignoreWhitespace = false; XML.prettyPrinting = false;
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
                            }</div>
                        </td>
                    </tr>)
                }
            </table>;
        // </e4x>
    },

    sourceLink: function (frame) {
        let url = (frame.filename || "unknown").replace(/.* -> /, "");
        function getPath(url) {
            try {
                return util.getFile(url).path;
            }
            catch (e) {
                return url;
            }
        }

        XML.ignoreWhitespace = false; XML.prettyPrinting = false;
        return <a xmlns:dactyl={NS} dactyl:command="buffer.viewSource"
            href={url} line={frame.lineNumber}
            highlight="URL">{
            getPath(url) + ":" + frame.lineNumber
        }</a>
    },

    table: function table(title, data, indent) {
        XML.ignoreWhitespace = false; XML.prettyPrinting = false;
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
        return XML();
    },

    tabular: function tabular(headings, style, iter) {
        // TODO: This might be mind-bogglingly slow. We'll see.
        XML.ignoreWhitespace = false; XML.prettyPrinting = false;
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

    usage: function usage(iter) {
        XML.ignoreWhitespace = false; XML.prettyPrinting = false;
        // <e4x>
        return <table>
            {
                this.map(iter, function (item)
                <tr>
                    <td style="padding-right: 20px" highlight="Usage">{
                        let (name = item.name || item.names[0], frame = item.definedAt)
                            !frame ? name :
                                <span highlight="Title">{name}</span> + <> </> +
                                <span highlight="LineInfo">Defined at {template.sourceLink(frame)}</span>
                    }</td>
                    <td>{item.description}</td>
                </tr>)
            }
            </table>;
        // </e4x>
    }
});

endModule();

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
