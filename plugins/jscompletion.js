"use strict";
var INFO =
["plugin", { name: "jscompletion",
             version: "1.0.4",
             href: "http://dactyl.sf.net/pentadactyl/plugins#jscompletion-plugin",
             summary: "JavaScript completion enhancements",
             xmlns: "dactyl" },
    ["author", { email: "maglione.k@gmail.com" },
        "Kris Maglione"],
    ["license", { href: "http://people.freebsd.org/~phk/" },
        "BEER-WARE"],
    ["project", { name: "Pentadactyl", "min-version": "1.0" }],
    ["p", {},
        "This plugin provides advanced completion functions for ",
        "DOM functions, eval, and some other special functions. ",
        "For instance, ",
        "", ["ex", {}, ':js content.document.getElementById("',
               ["k", { name: "Tab", link: "c_<Tab>" }], ], " ",
        "should provide you with a list of all element IDs ",
        "present on the current web page. Many other DOM ",
        "methods are provided, along with their namespaced variants."]];

function evalXPath(xpath, doc, namespace) {
    let res = doc.evaluate(xpath, doc,
        function getNamespace(prefix) {
            return {
                html:       "http://www.w3.org/1999/xhtml",
                dactyl:     NS,
                ns:         namespace
            }[prefix];
        },
        XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
        null
    );
    return function* () {
        for (let i = 0; i < res.snapshotLength; i++)
            yield res.snapshotItem(i);
    }();
}

let NAMESPACES = [
    ["http://purl.org/atom/ns#", "Atom 0.3"],
    ["http://www.w3.org/2005/Atom", "Atom 1.0"],
    [NS, "Dactyl"],
    ["http://www.w3.org/2005/Atom", "RSS"],
    ["http://www.w3.org/2000/svg", "SVG"],
    ["http://www.mozilla.org/xbl", "XBL"],
    ["http://www.w3.org/1999/xhtml", "XHTML 1.0"],
    ["http://www.w3.org/2002/06/xhtml2", "XHTML 2.0"],
    ["http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "XUL"]
];

function addCompleter(names, fn) {
    for (let name of util.debrace(names))
        javascript.completers[name] = fn;
}
function* uniq(iter) {
    let seen = new RealSet()
    for (let val of iter)
        if (!seen.add(val))
            yield val;
}

addCompleter("__lookup{Getter,Setter}__", function (context, func, obj, args) {
    if (args.length == 1)
        context.completions =
            [[k, obj[func](k)] for (k of properties(obj))].concat(
            [[k, obj[func](k)] for (k of properties(obj, true))]).filter(
                ([k, v]) => v);
});

addCompleter("eval", function (context, func, obj, args) {
    if (args.length > 1)
        return [];
    if (!context.cache.js) {
        context.cache.js = JavaScript();
        context.cache.context = CompletionContext("");
    }
    let ctxt = context.cache.context;
    context.keys = { text: "text", description: "description" };
    ctxt.filter = context.filter;
    context.cache.js.complete(ctxt);
    context.advance(ctxt.offset);
    context.completions = ctxt.allItems.items;
});

addCompleter("getOwnPropertyDescriptor", function (context, func, obj, args) {
    context.anchored = false;
    context.keys = { text: util.identity, description: () => "" };
    if (args.length == 2)
        return properties(args[0]);
});

addCompleter("getElementById", function (context, func, doc, args) {
    context.anchored = false;
    if (args.length == 1) {
        context.keys = { text: e => e.getAttribute("id"), description: util.objectToString };
        context.generate = () => evalXPath("//*[@id]", doc);
    }
});

function addCompleterNS(names, fn) {
    addCompleter(names + "{,NS}", function checkNS(context, func, obj, args) {
        context.anchored = false;
        context.keys = { text: util.identity, description: () => "" };
        let isNS = /NS$/.test(func);
        if (isNS && args.length == 1)
            return NAMESPACES;
        let prefix = isNS ? "ns:" : "";
        return fn(context, func, obj, args, prefix, isNS && args.shift());
    });
}

addCompleterNS("getElementsByClassName", function (context, func, doc, args, prefix, namespace) {
    if (args.length == 1) {
        let iter = evalXPath("//@" + prefix + "class", doc, namespace);
        return array(e.value.split(" ") for (e of iter)).flatten().uniq().array;
    }
});

addCompleterNS("{getElementsByTagName,createElement}", function (context, func, doc, args, prefix, namespace) {
    if (args.length == 1) {
        let iter = evalXPath("//" + prefix + "*", doc, namespace);
        return uniq(e.localName.toLowerCase() for (e of iter));
    }
});

addCompleterNS("getElementsByAttribute", function (context, func, doc, args, prefix, namespace) {
    switch (args.length) {
    case 1:
        let iter = evalXPath("//@" + prefix + "*", doc, namespace);
        return uniq(e.name for (e of iter));
    case 2:
        iter = evalXPath("//@" + prefix + args[0], doc, namespace);
        return uniq(e.value for (e of iter));
    }
});

addCompleterNS("{get,set,remove}Attribute", function (context, func, node, args, prefix, namespace) {
    context.keys = { text: 0, description: 1 };
    if (args.length == 1)
        return [[a.localName, a.value]
                for (a of array.iterValues(node.attributes))
                if (!namespace || a.namespaceURI == namespace)];
});

/* vim:se sts=4 sw=4 et: */
