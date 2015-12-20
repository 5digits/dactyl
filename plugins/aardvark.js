/*
Aardvark is BSD licensed.  Use as you wish.  Gimme credit if you wanna.

Copyright (c) 2005-2008, Rob Brown

This work ‘as-is’ we provide.
No warranty, express or implied.
We’ve done our best,
to debug and test.
Liability for damages denied.

Permission is granted hereby,
to copy, share, and modify.
Use as is fit,
free or for profit.
On this notice these rights rely.
*/

/*
 * Copyright © 2011 Kris Maglione
 * Original portions available under the terms of the MIT license.
 */

"use strict";
var INFO =
["plugin", { name: "aardvark",
             version: "0.3",
             href: "http://dactyl.sf.net/pentadactyl/plugins#aardvark-plugin",
             summary: "Aardvark page editor",
             xmlns: "dactyl" },
    ["author", { email: "maglione.k@gmail.com" },
        "Kris Maglione"],
    ["author", {}, "Rob Brown"],
    ["license", {},
        "Some unnamed BSD variant"],
    ["project", { name: "Pentadactyl", "min-version": "1.0" }],
    ["p", {},
        "This plugin is a Pentadactyl port of the Aardvark Firefox add-on ",
        "and bookmarklet. The code is moderately horrendous, but it ",
        "generally works."],
    ["item", {},
        ["tags", {}, ":aardvark"],
        ["spec", {}, ["ex", {}, ":aardvark"]],
        ["description", { short: "true" },
            ["p", {}, "Start Aardvark mode."]]],

    ["item", {},
        ["tags", {}, "A_b"],
        ["spec", {}, "b"],
        ["description", { short: "true" },
            ["p", {}, "Decolorize element."]]],

    ["item", {},
        ["tags", {}, "A_c"],
        ["spec", {}, "c"],
        ["description", { short: "true" },
            ["p", {}, "Colorize element."]]],

    ["item", {},
        ["tags", {}, "A_d"],
        ["spec", {}, "d"],
        ["description", { short: "true" },
            ["p", {}, "Remove width-specifying styles."]]],

    ["item", {},
        ["tags", {}, "A_h"],
        ["spec", {}, "h"],
        ["description", { short: "true" },
            ["p", {}, "Show a list of available keys."]]],

    ["item", {},
        ["tags", {}, "A_i"],
        ["spec", {}, "i"],
        ["description", { short: "true" },
            ["p", {}, "Isolate element."]]],

    ["item", {},
        ["tags", {}, "A_j"],
        ["spec", {}, "j"],
        ["description", { short: "true" },
            ["p", {}, "Convert element to JavaScript source."]]],

    ["item", {},
        ["tags", {}, "A_k"],
        ["spec", {}, "k"],
        ["description", { short: "true" },
            ["p", {}, "Kill an element using the R.I.P. add-on."]]],

    ["item", {},
        ["tags", {}, "A_n"],
        ["spec", {}, "n"],
        ["description", { short: "true" },
            ["p", {}, "Select a lower element."]]],

    ["item", {},
        ["tags", {}, "A_p"],
        ["spec", {}, "p"],
        ["description", { short: "true" },
            ["p", {}, "Paste the last yanked element."]]],

    ["item", {},
        ["tags", {}, "A_r"],
        ["spec", {}, "r"],
        ["description", { short: "true" },
            ["p", {}, "Remove element."]]],

    ["item", {},
        ["tags", {}, "A_s"],
        ["spec", {}, "s"],
        ["description", { short: "true" },
            ["p", {}, "Select the given element or the contents of the frontmost display box."]]],

    ["item", {},
        ["tags", {}, "A_t"],
        ["spec", {}, "t"],
        ["description", { short: "true" },
            ["p", {}, "Thunk the element in a global variable."]]],

    ["item", {},
        ["tags", {}, "A_u"],
        ["spec", {}, "u"],
        ["description", { short: "true" },
            ["p", {}, "Undo the last operation."]]],

    ["item", {},
        ["tags", {}, "A_v"],
        ["spec", {}, "v"],
        ["description", { short: "true" },
            ["p", {}, "View element source."]]],

    ["item", {},
        ["tags", {}, "A_w"],
        ["spec", {}, "w"],
        ["description", { short: "true" },
            ["p", {}, "Select a higher element."]]],

    ["item", {},
        ["tags", {}, "A_x"],
        ["spec", {}, "x"],
        ["description", { short: "true" },
            ["p", {}, "Show the element's XPath."]]]];

highlight.loadCSS(String.raw`
    AardvarkDBox;;*  {
        padding: 0;
        border: 1px solid #000;
        background-color: #888;
        color: black;
        font-family: arial;
        font-size: 13px;
    }
    AardvarkDragger;;*  {
        font-size: 12px;
        text-align: left;
        color: #000;
        padding: 2px;
        height: 14px;
        margin: 0;
        cursor: move;
        background-color: #d8d7dc;
    }
    AardvarkClose;;*  {
        vertical-align: middle;
        width: 17px;
        height: 17px;
        margin: -2px 4px 0 0;
        cursor: pointer;
    }
    AardvarkSelect;;*  {
        float: right;
        font-size: 11px;
        color: #008;
        margin: 0;
        padding: 0;
        cursor: pointer;
    }
    AardvarkInner;;*  {
        float: left;
        margin: 0;
        border: 0;
        padding: 4px;
        font-size: 13px;
        color: #000;
        background: #fff;
    }

    Aardvark;;*  {
        border-color: black;
        border-width: 1px 2px 2px 1px;
        border-style: solid;
        font-family: arial;
        text-align: left;
        color: #000;
        font-size: 12px;
        position: absolute;
        padding: 2px 5px;
    }
    AardvarkLabel;;*;Aardvark  {
        border-top-width: 0;
        border-bottom-left-radius: 6px;
        border-bottom-right-radius: 6px;
        background-color: #fff0cc;
        z-index: 5005;
    }
    AardvarkKeybox;;*;Aardvark  {
        background-color: #dfd;
        z-index: 100006;
    }
    AardvarkBorder;;*  {
        position: absolute;
        z-index: 5001;
        border-color: #f00;
        border-style: solid;
    }

    AardvarkIsolated;;*  {
        float: none;
        position: static;
        padding: 5px;
        margin: 5px;
    }
    AardvarkIsolatedBody;;*  {
        width: 100%;
        background: none;
        background-color: white;
        background-image: none;
        text-align: left;
    }

    AardvarkBW;;*  {
        color: #000 !important;
        background-color: #fff !important;
        font-family: arial !important;
        font-size: 13px !important;
        text-align: left !important;
        background-image: none !important;
    }
    AardvarkBW:-moz-any-link;;*  {
        text-decoration: underline !important;
    }
    AardvarkDewidthified;;*  {
        width: auto !important;
    }
`);

group.styles.add("aardvark", "*", String.raw`
        [dactyl|highlight~=AardvarkDBox] div.vsblock {
            border: 1px solid #ccc;
            border-right: 0;
            margin: -1px 0 -1px 1em;
            padding: 0;
        }
        [dactyl|highlight~=AardvarkDBox] div.vsline {
            border-right: 0;
            margin: 0 0 0 .6em;
            text-indent: -.6em;
            padding: 0;
        }
        [dactyl|highlight~=AardvarkDBox] div.vsindent {
	    border-right: 0;
	    margin: 0 0 0 1.6em;
	    text-indent: -.6em;
	    padding: 0;
        }
        [dactyl|highlight~=AardvarkDBox] span.tag {
	    color: #c00;
	    font-weight:bold;
        }
        [dactyl|highlight~=AardvarkDBox] span.pname {
	    color: #080;
	    font-weight: bold;
        }
        [dactyl|highlight~=AardvarkDBox] span.pval {
	    color:#00a;
	    font-weight: bold;
        }
        [dactyl|highlight~=AardvarkDBox] span.aname {
	    color: #050;
	    font-style: italic;
	    font-weight: normal;
        }
        [dactyl|highlight~=AardvarkDBox] span.aval {
	    color:#007;
	    font-style: italic;
	    font-weight: normal;
        }

        [dactyl|highlight~=AardvarkDBox] a,
        [dactyl|highlight~=AardvarkDBox] a:visited {
	    color: #007;
	    text-decoration: underline;
        }
        [dactyl|highlight~=AardvarkDBox] a:hover {
	    color: #00f;
        }
    `);

let images = {
    close: `data:image/gif;base64,
        R0lGODlhEQARAMMPANuywOyNo+wnUfEENPN1kfFLbre0u/78/P7S28ZWcIdsdaJIXolVY7IyTpKS
        mP///yH5BAEAAA8ALAAAAAARABEAAARw8MkJQAAz5yCGHwKhTcVnglhWDqsnlIIxBV5wEC6CdMnU
        FYcgQYAIIjwywIcQbB52HsVDuXRCPQsD1eXEfbJbovP2Ycg64idTGJV4bdB1qeHweYbLlUImAXRO
        ZXUaCYANCoIjBgoLCwyHfCMTBpOREQA7
    `,
};

for (let k in images)
    images[k] = String(images[k].replace(/\s+/g, ""));

function nodeName(node) {
    if (node.nodeName == node.localName.toUpperCase())
        return node.localName;
    return node.nodeName;
}

var AardvarkDBox = Class("AardvarkDBox", {
    init: function (aardvark, params) {
        if (!("dragger" in params))
            params.dragger = true;

        this.aardvark = aardvark;

        this.bgColor = params.bgColor || "";
        this.position = params.position;
        this.id = aardvark.dBoxId++;

        var dims = aardvark.getWindowDimensions();
        dims.width -= 15;
        dims.height -= 15;
        this.dims = dims;

        let style = "position: absolute; z-index: 100000;" +
                    "top: " + dims.scrollY + "px;" +
                    "left: " + dims.scrollX + "px;" +
                    "max-width: " + (dims.width - 20) + "px;" +
                    "max-height: " + (dims.height - 20) + "px;"

        let outerDiv =
            ["div", { key: "outerContainer",
                      highlight: "AardvarkDBox",
                      style: style,
                      id: "aardvarkdbox-" + aardvark.dBoxId },
                !params.dragger ? [] :
                ["div", { command: "drag", key: "dragBar",
                          highlight: "AardvarkDragger" },
                    ["img", { src: images.close,
                              command: "kill",
                              highlight: "AardvarkClose",
                              alt: "close" }],
                    !params.selectLink ? [] :
                        ["a", { highlight: "AardvarkSelect", command: "select" },
                            "select all"],
                    params.title || ""],
                ["div", { key: "innerContainer", highlight: "AardvarkInner",
                          style: "overflow: " + (params.hideScrollbar ? "hidden" : "auto") },
                    content || ""]];

        outerDiv = DOM.fromJSON(outerDiv, aardvark.doc, this);
        outerDiv.isAardvark = true;
        outerDiv.dbox = this;
        DOM(outerDiv).mousedown(this.closure.onMouseDown)
                     .appendTo(aardvark.container);

        if (params.data)
            DOM(this.innerContainer).empty().append(params.data);

        aardvark.dBoxId++;
        return this;
    },

    onMouseDown: function onMouseDown(event) {
        let command = DOM(event.target).attr("command");
        if (command in this && event.button == 0) {
            this[command](event);
            event.preventDefault();
        }
    },

    kill: function kill() {
        if (!this.outerContainer.parentNode)
            return false;
        DOM(this.outerContainer).remove();
        return true;
    },

    select: function select() {
        this.aardvark.highlightText(this.innerContainer);
    },

    drag: function drag() {
        let elem = this.outerContainer;
        this.aardvark.dragElement = elem;
        this.aardvark.dragStartPos = this.aardvark.getPos(elem);
        this.aardvark.dragClickX = this.aardvark.mousePosX;
        this.aardvark.dragClickY = this.aardvark.mousePosY;
    },

    show: function show() {
        var dims = this.dims;
        var draggerHeight = 1;
        if (this.dragBar) {
            draggerHeight = 18;
        }
        var w = this.innerContainer.offsetWidth;
        if (!this.innerContainer.style.width || this.innerContainer.style.width != "")
            w += 25;

        if (this.dragBar)
            w = Math.max(w, this.dragBar.offsetWidth + 12);
        w = Math.min(w, dims.width - 20);

        this.outerContainer.style.width = w + "px";
        this.innerContainer.style.width = w + "px";

        var diff;
        if ((diff = this.innerContainer.offsetWidth - w) > 0)
            this.innerContainer.style.width = (w - diff) + "px";

        var h = Math.min(dims.height - 25,
                         this.innerContainer.offsetHeight);

        this.outerContainer.style.height = (h + draggerHeight) + "px";
        this.innerContainer.style.height = h + "px";
        if ((diff = this.innerContainer.offsetHeight - h) > 0)
            this.innerContainer.style.height = (h - diff) + "px";

        this.innerContainer.style.backgroundColor = this.bgColor;

        if (this.position) {
            var { x, y } = this.position;
        }
        else {
            x = dims.width / 2 - w / 2;
            y = dims.height / 2 - h / 2;
        }
        x += dims.scrollX;
        y += dims.scrollY;

        this.aardvark.moveElem(this.outerContainer, x, y);
    }
});

var Aardvark = Class("Aardvark", {
    init: function init(window) {
        this.window = window;
        this.doc = window.document;

        this.top = DOM(["div", { highlight: "hints" }], this.doc)
                        .appendTo(this.doc.body);
        this.top.style.height;
        this.top[0].isAardvark = true;

        this.container = this.top.findAnon("anonid", "hints") || this.container;

        modes.push(modes.AARDVARK, null, this.closure);

        this.undoStack = [];

        this.makeElems();
        this.selectedElem = null;
    },

    get mappingSelf() { return this; },

    enter: function enter() {
        group.events.listen(this.doc, this, "events");
    },

    leave: function leave(stack) {
        group.events.unlisten(this.doc, this, "events");
        if (!stack.push)
            this.top.remove();
    },

    closePanels: function closePanels() {
        let panels = this.container.children
                         .filter((elem) => DOM(elem).highlight.has("AardvarkDBox"));
        panels.remove();
        return panels.length;
    },

    rip: function rip(elem) {
        if (window.RemoveItPermanently)
            RemoveItPermanently.doRipNode(elem);
        else {
            var dbox = AardvarkDBox(this, { data: this.strings.ripHelp });
            dbox.show();
        }
        return true;
    },

    wider: function wider(elem) {
        if (elem && elem.parentNode) {
            var newElem = this.findValidElement(elem.parentNode);
            if (!newElem)
                return false;

            if (this.widerStack &&
                this.widerStack.length > 0 &&
                this.widerStack[this.widerStack.length - 1] == elem) {
                this.widerStack.push(newElem);
            }
            else {
                this.widerStack = [elem, newElem];
            }
            this.selectedElem = newElem;
            this.showBoxAndLabel(newElem, this.makeElementLabelString(newElem));
            this.didWider = true;
            return true;
        }
        return false;
    },

    narrower: function narrower(elem) {
        if (elem) {
            if (this.widerStack &&
                this.widerStack.length > 1 &&
                this.widerStack[this.widerStack.length - 1] == elem) {

                this.widerStack.pop();
                let newElem = this.widerStack[this.widerStack.length - 1];
                this.selectedElem = newElem;
                this.showBoxAndLabel(newElem, this.makeElementLabelString(newElem));
                this.didWider = true;
                return true;
            }
        }
        return false;
    },

    select: function select(elem) {
        let panels = this.container.children
                         .filter(elem => elem.dbox);
        if (panels.length)
            panels[panels.length - 1].dbox.select();
        else if (elem)
            this.highlightText(elem);
    },

    viewSource: function viewSource(elem) {
        var dbox = AardvarkDBox(this, {
            selectLink: true,
            title: this.strings.viewHtmlSource,
            data: this.getOuterHtmlFormatted(elem, 0)
        });
        dbox.show();
        return true;
    },

    colorize: function colorize(elem) {
        let val = () => Math.round(Math.random() * 16).toString(16);

        this.undoStack.push({
            styles: {
                backgroundColor: elem.style.backgroundColor,
                backgroundImage: elem.style.backgroundImage
            },
            undo: function undo() { DOM(elem).css(this.styles); }
        });

        DOM(elem).css({
            backgroundColor: "#" + val() + val() + val(),
            backgroundImage: ""
        });
        return true;
    },

    removeElement: function removeElement(elem) {
        if (elem.parentNode != null) {
            DOM(elem).hide();
            this.undoStack.push({
                mode: "R",
                elem: elem,
                undo: function () { DOM(this.elem).show() }
            });
            this.clearBox();
            return true;
        }
        return false;
    },

    paste: function paste(target) {
        if (target.parentNode != null) {
            if (this.undoStack.length && this.undoStack.slice(-1)[0].mode == "R") {
                let src = this.undoStack.pop().elem;

                if (src.localName == "tr" && target.localName != "tr") {
                    var t = DOM(["table", {}, ["tbody"]], this.doc)[0];
                    t.firstChild.appendChild(src);
                    DOM(src).show();
                    src = t;
                }
                else if (src.localName == "td" && target.localName != "td")
                    src = DOM(["div"], this.doc).append(DOM(src).contents()).append(src)[0];
                else {
                    src.parentNode.removeChild(src);
                    DOM(src).show();
                }

                if (target.localName == "td" && src.localName != "td")
                    target.insertBefore(src, target.firstChild);
                else if (target.localName == "tr" && src.localName != "tr")
                    target.insertBefore(src, target.firstChild.firstChild);
                else
                    target.parentNode.insertBefore(src, target);

                this.clearBox();
            }
        }
        return true;
    },

    global: function xpath(target) {
        commandline.input("Variable name: ", function (res) {
            if (res) {
                userContext[res] = target;
                DOM(target.ownerDocument.defaultView).unload(function () {
                    if (userContext[res] == target)
                        delete userContext[res];
                });
            }
        });
    },

    xpath: function xpath(target) {
        AardvarkDBox(this, {
            selectLink: true,
            title: this.strings.viewXPath,
            data: DOM(target).xpath
        }).show();
    },

    isolateElement: function isolateElement(elem) {
        let { body } = this.doc;
        if (elem.parentNode != null) {
            this.clearBox();
            var clone = elem.cloneNode(true);
            DOM(clone).highlight.add("AardvarkIsolated");

            if (clone.localName == "tr" || clone.localName == "td") {
                if (clone.localName == "td")
                    clone = DOM(["tr"], this.doc).append(clone)[0];

                t = DOM(["table", {}, ["tbody"]], this.doc)[0];
                t.firstChild.appendChild(clone);
                clone = t;
            }

            var undoData = Array.filter(this.doc.body.childNodes,
                                        e => !e.isAardvark);
            DOM(undoData).remove();
            undoData.mode = "I";
            undoData.isolated = DOM(body).highlight.has("AardvarkIsolatedBody");
            undoData.undo = function () {
                DOM(body.childNodes).filter(e => !e.isAardvark)
                    .remove();

                DOM(body).highlight.toggle("AardvarkIsolatedBody", this.isolated)
                         .prepend(this);
            };
            this.undoStack.push(undoData);

            DOM(this.doc.body).highlight.add("AardvarkIsolatedBody")
                              .append(clone);

            this.window.scroll(0, 0);
        }
        return true;
    },

    _undo: function _undo(group) {
        return function undo() {
            (function rec(node) {
                DOM(node).highlight.remove(group)
                         .children.each(rec);
            })(this.elem);
        };
    },

    deWidthify: function deWidthify(node) {
        if (node instanceof Element) {
            if (node.localName != "img") {
                DOM(node).highlight.add("AardvarkDewidthified")
                         .children.each(this.closure.deWidthify);

                if (arguments.length == 1) {
                    this.clearBox();
                    this.undoStack.push({ elem: node, undo: this._undo("AardvarkDewidthified") });
                }
            }
        }
        return true;
    },

    blackOnWhite: function blackOnWhite(node) {
        if (node instanceof Element) {
            if (node.localName != "img") {
                DOM(node).highlight.add("AardvarkBW")
                         .children.each(this.closure.blackOnWhite);

                if (arguments.length == 1)
                    this.undoStack.push({ elem: node, undo: this._undo("AardvarkBW") });
            }
        }
        return true;
    },

    getOuterHtmlFormatted: function getOuterHtmlFormatted(node, indent) {
        var res = [];
        switch (node.nodeType) {
        case Node.ELEMENT_NODE:
            if (node.style.display == "none")
                break;

            var isLeaf = node.childNodes.length == 0
                      && this.leafElems[node.localName];
            var isTbody = node.localName == "tbody" && node.attributes.length == 0;
            if (isTbody) {
                for (let node of node.childNodes)
                    res.push(this.getOuterHtmlFormatted(node, indent));
            }
            else {
                let inner = ["", "<",
                             ["span", { class: "tag" }, nodeName(node)]];
                Array.forEach(node.attributes, function (attr) {
                    if (attr.value != null) {
                        let value = ["span", { class: "pval" }, attr.value];
                        if (attr.localName == "style")
                            value = template.map(Styles.propertyIter(value),
                                ({ name, value }) =>
                                    [["span", { class: "aname" }, name],
                                     ": ",
                                     ["span", { class: "aval" }, value],
                                     ";"],
                                " ");

                        inner.push(" ",
                                   ["span", { class: "pname" }, nodeName(attr)],
                                   '="',
                                   value,
                                   '"');
                    }
                }, this)

                if (isLeaf)
                    res.push(["div", { class: "vsindent" },
                                inner,
                                "/>"]);
                else {
                    inner = [["div", { class: "vsline" },
                                inner]];

                    for (let node of node.childNodes)
                        inner.push(this.getOuterHtmlFormatted(node, indent + 1));

                    res.push(["div", { class: "vsline" },
                                "</",
                                ["span", { class: "tag" },
                                    nodeName(node)],
                                ">"]);

                    if (indent > 0)
                        res.push(["div", { class: "vsblock" }, inner]);
                    else
                        res.push(inner);
                }
            }
            break;
        case Node.TEXT_NODE:
            var v = DOM.escapeHTML(node.nodeValue).trim();
            if (v)
                res.push(["div", { class: "vsindent" },
                            v]);
            break;
        case Node.CDATA_SECTION_NODE:
            res.push(["div", { class: "vsindent" },
                        "<![CDATA[" + node.nodeValue + "]]>"]);
            break;
        case Node.ENTITY_REFERENCE_NODE:
            res.push(["", "&", nodeName(node)], ["br"]);
            break;
        case Node.COMMENT_NODE:
            res.push(["div", { class: "vsindent" },
                        "<!--" + node.nodeValue + "-->"]);
            break;
        }
        return res;
    },

    camelCaseProps: {
    },

    domJavascript: function domJavascript(node, indent) {
        let FmtString = (str, color) => ["", '"',
                                         ["span", { style: "color:" + (color || "#00b") + "; font-weight: bold" },
                                             util.escapeString(str, "")],
                                         '"'];

        let self = this;
        var indentStr = "";
        for (var c = 0; c < indent; c++)
            indentStr += "  ";

        switch (node.nodeType) {
        case Node.ELEMENT_NODE:
            if (node.style.display == "none")
                break;

            var isLeaf = node.childNodes.length == 0
                      && this.leafElems[node.localName];
            var children = [];
            var numChildren = 0;
            if (!isLeaf) {
                numChildren = node.childNodes.length;
                children = template.map(node.childNodes,
                    node => ["", indentStr, "  ",
                             self.domJavascript(node, indent + 1)],
                    ["", ",", ["br"]]);
            }

            var properties = [];
            var styles = [];
            Array.forEach(node.attributes, function ({ nodeName, value }) {
                if (value != null) {
                    switch (nodeName) {
                    case "style":
                        for (let { name, value } of Styles.propertyIter(value))
                            styles.push(["", FmtString(util.camelCase(name), "#060"), ":",
                                             FmtString(value.trim(), "#008")]);
                        break;
                    default:
                        nodeName = this.camelCaseProps[n] || nodeName;

                        properties.push(["", FmtString(nodeName, "#080"), ":",
                                             FmtString(value, "#00b")]);
                        break;
                    }
                }
            }, this);

            if (styles.length) {
                styles = template.map(styles, util.identity, ", ");
                properties.unshift(["", FmtString("style", "080"), ":",
                                    "{", styles, "}"]);
            }

            let numProps = properties.length;
            properties = template.map(properties, util.identity, ", ");
            properties = ["", "{", properties, "}"];

            let xml = ["", "[", FmtString(nodeName(node), "red")];
            if (numChildren) {
                if (numProps)
                    return ["", xml, ", ", properties, ",\u000a;", children, "]"];
                else
                    return ["", xml, ",'\u000a", children, "]"];
            }
            else if (numProps)
                return ["", xml, ", ", properties, "]"];
            else
                return ["", xml, "]"];
            break;
        case Node.TEXT_NODE:
            var n = node.nodeValue;
            if (node.nodeValue != "")
                n = util.escapeString(n, "");

            n = n.trim();
            if (n.length > 0)
                return ["", '"', ["b", {}, n], '"'];
            break;
        case Node.CDATA_SECTION_NODE:
        case Node.ENTITY_REFERENCE_NODE:
        case Node.COMMENT_NODE:
            break;
        }
        return null;
    },

    makeJavascript: function makeJavascript(elem) {
        var dbox = AardvarkDBox(this, {
            selectLink: true,
            title: this.strings.javascriptDomCode,
            data: [
                ["pre", { style: "margin:0; width: 97%" },
                    this.domJavascript(elem, 0)],
                ["br"]
            ]
        });
        dbox.show();
        return true;
    },

    undo: function undo() {
        if (!this.undoStack.length)
            return false;

        this.clearBox();
        this.undoStack.pop().undo();
        return true;
    },

    showMenu: function showMenu() {
        if (this.helpBox && this.helpBox.kill()) {
            delete this.helpBox;
            return;
        }

        var s = ["table", { style: "margin:5px 10px 0 10px;" }];
        for (let map of mappings.iterate(modes.AARDVARK))
            if (map.name != "<Esc>")
                s.push(["tr", {},
                    ["td", { style: "padding: 3px 7px; border: 1px solid black; font-family: courier; font-weight: bold; background-color: #fff" },
                        map.name],
                    ["td", { style: "padding: 3px 7px; font-size: .9em; text-align: left;" },
                        map.description]
                ]);

        var dbox = AardvarkDBox(this, {
            bgColor: "#fff2db",
            selectLink: true,
            position: { x: 20, y: 20 },
            title: this.strings.aardvarkKeystrokes,
            data: s
        });
        dbox.show();
        this.helpBox = dbox;
        return true;
    },

    highlightText: function highlightText(elem) {
        let s = this.window.getSelection();
        s.removeAllRanges();
        s.addRange(RangeFind.nodeRange(elem));
        dactyl.clipboardWrite(DOM.stringify(s), false, "selection");
    },

    strings: {
        aardvarkKeystrokes: 'Aardvark keystrokes',
        blackOnWhite: 'black on white',
        deWidthify: 'de-widthify',
        description: 'Utility for cleaning up a page prior to printing, and for analyzing a page.',
        help: 'toggle &help',
        javascriptDomCode: 'Javascript DOM code',
        ripHelp: ["center", {},
            "If you install the excellent ",
            "", ["a", { href: "http://addons.mozilla.org/addon/521/", target: "_blank" }, "R.I.P."], ["br"],
            "(Remove It Permanently), the K command will", ["br"],
            "permanently remove items from a page."],
        undo: 'undo',
        viewHtmlSource: 'View HTML source',
        viewSource: 'view source',
        viewXPath: 'View XPath'
    },

//-------------------------------------------------
// create the box and tag etc (done once and saved)
    makeElems: function makeElems() {
        this.borderElems = {};

        for (let side of ["top", "bottom", "left", "right"]) {
            this.borderElems[side] = DOM(["div", { style: "display: none; border-width: 0; border-" + side + "-width: 2px;",
                                                   highlight: "AardvarkBorder" }],
                                         this.doc).appendTo(this.container);
        }

        this.labelElem = DOM(["div", { style: "display: none;", highlight: "AardvarkLabel" }],
                             this.doc).appendTo(this.container)[0];

        this.keyboxElem = DOM(["div", { style: "display: none;", highlight: "AardvarkKeybox" }],
                              this.doc).appendTo(this.container);
    },

//-------------------------------------------------
// show the red box around the element, and display
// the string in the little tag
    showBoxAndLabel: function showBoxAndLabel(elem, label) {
        var pos = this.getPos(elem);
        var dims = this.getWindowDimensions();
        var y = pos.y;

        let width = parseFloat(this.borderElems.left.style.borderLeftWidth);
        DOM(values(this.borderElems).map(e => e[0])).css({
            left: pos.x - width + "px",
            top: pos.y - width + "px",
            width: elem.offsetWidth + 2 * width + "px",
            height: elem.offsetHeight + 2 * width + "px"
        }).show();

        this.borderElems.left.css({
            width: 0
        });
        this.borderElems.right.css({
            width: 0,
            left: (pos.x + elem.offsetWidth) + "px"
        });
        this.borderElems.top.css({
            height: 0
        });
        this.borderElems.bottom.css({
            height: 0,
            top: (pos.y + elem.offsetHeight) + "px"
        });

        y += elem.offsetHeight + 2;
        DOM(this.labelElem).empty().append(label).show();

        this.labelElem.style.borderTopWidth = "";
        this.labelElem.style.borderTopLeftRadius = "";
        this.labelElem.style.borderTopRightRadius = "";
        if ((y + this.labelElem.offsetHeight) >= dims.scrollY + dims.height) {
            this.labelElem.style.cssText += "border-top-width: 1px !important; \
                                             border-top-left-radius: 6px !important; \
                                             border-top-right-radius: 6px !important;";
            y = (dims.scrollY + dims.height) - this.labelElem.offsetHeight;
        }
        else if (this.labelElem.offsetWidth > elem.offsetWidth) {
            this.labelElem.style.cssText += "border-top-width: 1px !important; \
                                             border-top-right-radius: 6px !important;";
        }
        this.moveElem(this.labelElem, pos.x + 2, y);
    },

//-------------------------------------------------
// remove the red box and tag
    clearBox: function clearBox() {
        this.selectedElem = null;
        if (this.borderElems != null) {
            for (let elem of values(this.borderElems))
                elem.hide();
            DOM(this.labelElem).hide();
        }
    },

//-------------------------------------------------
    hideKeybox: function hideKeybox() {
        this.keyboxElem.hide();
        this.keyboxTimeout = null;
    },

//-------------------------------------------------
    showKeybox: function showKeybox(key){
        if (this.keyboxElem == null)
            return;

        this.keyboxElem.empty().append(
            template.highlightRegexp(key.aardvarkSpec || key.description, /&(.)/g,
                (m, m1) => ["b", { style: "font-size: 2em" }, m1]));

        var dims = this.getWindowDimensions();
        var y = Math.max(0, dims.scrollY + this.mousePosY + 10);
        if (y > (dims.scrollY + dims.height) - 30)
            y = (dims.scrollY + dims.height) - 60;

        var x = Math.max(0, this.mousePosX + 10);
        if (x > (dims.scrollX + dims.width) - 60)
            x = (dims.scrollX + dims.width) - 100;

        this.moveElem(this.keyboxElem, x, y);

        this.keyboxElem.show();
        if (this.keyboxTimeout)
            this.keyboxTimeout.cancel();
        this.keyboxTimeout = this.timeout(this.hideKeybox, 400);
    },

//-------------------------------------------------
    makeElementLabelString: function makeElementLabelString(elem) {
        var s = [["b", { style: "color:#000" }, nodeName(elem)]];
        if (elem.id != "")
            s.push(["b", {}, "#"], ["i", {}, elem.id]);

        if (elem.className != "")
            s.push(template.map(Array.slice(elem.classList),
                                clas => [["b", {}, "."], ["i", {}, clas]]));
        return s;
    },

    events: {
        mouseup: function onMouseUp(evt) {
            if (this.dragElement) {
                delete this.dragElement;
                delete this.dragClickX;
                delete this.dragClickY;
                delete this.dragStartPos;
            }
            return false;
        },

    // the following three functions are the main event handlers
    //-------------------------------------------------
        mousemove: function onMouseMove(evt) {
            if (this.mousePosX == evt.clientX &&
                this.mousePosY == evt.clientY) {
                this.moved = false;
                return;
            }
            this.mousePosX = evt.clientX;
            this.mousePosY = evt.clientY;
            if (this.dragElement) {
                this.moveElem(this.dragElement,
                    (this.mousePosX - this.dragClickX) + this.dragStartPos.x,
                    (this.mousePosY - this.dragClickY) + this.dragStartPos.y);
                this.moved = false;
            }
            else {
                this.moved = true;
            }
            evt.preventDefault();
        },

    //-------------------------------------------------
        mouseover: function onMouseOver(evt) {
            if (!this.moved)
                return;

            this.choose(evt.target);
        },

        click: function click(evt) {
            this.choose(evt.target);
        }
    },

    choose: function choose(elem) {
        if (elem == this.labelElem || ~values(this.borderElems).indexOf(elem))
            this.clearBox();

        if (elem.isAardvark || DOM(elem).ancestors.some(e => e.isAardvark))
            return;

        if (elem == null) {
            this.clearBox();
            return;
        }
        elem = this.findValidElement(elem);
        if (elem == null) {
            this.clearBox();
            return;
        }
        this.didWider = false;
        if (elem != this.selectedElem) {
            this.widerStack = null;
            this.selectedElem = elem;
            this.showBoxAndLabel(elem, this.makeElementLabelString(elem));
            this.innerItem = null;
            this.moved = false;
        }
    },

//-------------------------------------------------
// given an element, walk upwards to find the first
// valid selectable element
    findValidElement: function findValidElement(elem) {
        for (; elem; elem = elem.parentNode) {
            if (Set.has(this.alwaysValidElements, elem.localName))
                break;

            let { display } = DOM(elem).style;
            if (Set.has(this.validIfBlockElements, elem.localName) && display == "block")
                break;
            if (Set.has(this.validIfNotInlineElements, elem.localName) && display != "inline")
                break;
        }
        return elem;
    },

//-----------------------------------------------------
    getPos: function getPos(elem) {
        let body = this.doc.body || this.doc.documentElement;
        let style = DOM(body).style;

        if (~["absolute", "fixed", "relative"].indexOf(style.position)) {
            let rect = body.getClientRects()[0];
            var offsets =  [-rect.left, -rect.top];
        }
        else
            var offsets =  [this.doc.defaultView.scrollX, this.doc.defaultView.scrollY];

        let rect = DOM(elem).rect;
        var pos = {
            x: rect.left + offsets[0],
            y: rect.top + offsets[1]
        };
        return pos;
    },

//-----------------------------------------------------
// move a div (or whatever) to an x y location
    moveElem: function moveElem(elem, x, y) {
        DOM(elem).css({ left: x + "px", top: y + "px" });
    },

//-------------------------------------------------
    getWindowDimensions: function getWindowDimensions() {
        var out = {};
        out.scrollX = this.window.pageXOffset;
        out.scrollY = this.window.pageYOffset;
        if (this.doc.compatMode == "BackCompat") {
            out.width = this.doc.body.clientWidth;
            out.height = this.doc.body.clientHeight;
        }
        else {
            out.width = this.doc.documentElement.clientWidth;
            out.height = this.doc.documentElement.clientHeight;
        }
        return out;
    },

    dBoxId: 0,

    alwaysValidElements: Set(["applet", "blockquote", "div", "form",
                              "h1", "h2", "h3", "iframe", "img", "object",
                              "p", "table", "td", "th", "tr"]),

    validIfBlockElements: Set(["a", "span"]),

    validIfNotInlineElements: Set(["code", "li", "ol", "pre", "ul"]),

    leafElems: Set(["area", "base", "basefont", "br", "col", "frame", "hr",
                    "img", "input", "isindex", "link", "meta", "param"])
});

modes.addMode("AARDVARK", {
    char: "A",
    description: "Aardvark page editing mode",
    bases: [modes.COMMAND],
    ownsBuffer: true
});

let aardvark = Aardvark.prototype;
aardvark.commands = {};

// 0: name (member of aardvark.strings, or literal string)
// 1: function
// 2: needs element
// 3: 'true' for extension only
var commands = [
    ["wider",        "wider",          true],
    ["narrower",     "narrower",       true],
    ["undo",         "undo",           false],
    ["remove",       "removeElement",  true],
    ["kill",         "rip",            true],
    ["isolate",      "isolateElement", true],
    ["blackOnWhite", "blackOnWhite",   true],
    ["deWidthify",   "deWidthify",     true],
    ["colorize",     "colorize",       true],
    ["viewSource",   "viewSource",     true],
    ["javascript",   "makeJavascript", true],
    ["paste",        "paste",          true],
    ["select",       "select",         false],
    ["thunk",        "global",         true],
    ["xpath",        "xpath",          true],
    ["help",         "showMenu",       false],
];

commands.forEach(function([fullname, func, needsElement]) {
    if (aardvark.strings[fullname])
        fullname = aardvark.strings[fullname];

    let name = fullname.replace("&", "");
    if (!/&/.test(fullname))
        fullname = "&" + fullname;
    let key = /&(.)/.exec(fullname)[1];

    aardvark.commands[key] = {
        name: name,
        fullName: fullname,
        func: func,
        needsElement: needsElement,
    };

    group.mappings.add([modes.AARDVARK],
                       [key],
                       name,
        function({ self }) {
            if (needsElement) {
                if (self.selectedElem && self[func](self.selectedElem) == true)
                    self.showKeybox(this);
            }
            else {
                if (self[func](self.selectedElem) == true)
                    self.showKeybox(this);
            }
        }, {
            aardvarkSpec: fullname
        });
});

group.mappings.add([modes.AARDVARK],
    ["<Esc>", "<C-]>"],
    "Close open panels or leave Aardvark mode",
    function ({ self }) {
        if (!self.closePanels())
            modes.remove(modes.AARDVARK);
    });

group.commands.add(["aardvark"],
    "Aardvark page editor",
    function (args) {
        dactyl.assert(!modes.have(modes.AARDVARK))
        Aardvark(buffer.focusedFrame);
    },
    { argCount: 0 },
    true);

function onUnload() {
    modes.removeMode(modes.AARDVARK);
}

