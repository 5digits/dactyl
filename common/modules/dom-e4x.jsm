// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2012 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
/* use strict */

defineModule("dom", {
    exports: ["fromXML"]
});

lazyRequire("highlight", ["highlight"]);

var XBL = Namespace("xbl", "http://www.mozilla.org/xbl");
var XHTML = Namespace("html", "http://www.w3.org/1999/xhtml");
var XUL = Namespace("xul", "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul");
var NS = Namespace("dactyl", "http://vimperator.org/namespaces/liberator");

function fromXML(node, doc, nodes) {
    XML.ignoreWhitespace = XML.prettyPrinting = false;
    if (typeof node === "string") // Sandboxes can't currently pass us XML objects.
        node = XML(node);

    if (node.length() != 1) {
        let domnode = doc.createDocumentFragment();
        for each (let child in node)
            domnode.appendChild(fromXML(child, doc, nodes));
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
            domnode.appendChild(fromXML(child, doc, nodes));
        if (nodes && node.@key)
            nodes[node.@key] = domnode;

        if ("@highlight" in node)
            highlight.highlightNode(domnode, String(node.@highlight), nodes || true);
        return domnode;
    default:
        return null;
    }
}

