// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("dom", {
    exports: ["$", "DOM", "NS", "XBL", "XHTML", "XUL"]
});

lazyRequire("highlight", ["highlight"]);
lazyRequire("messages", ["_"]);
lazyRequire("overlay", ["overlay"]);
lazyRequire("prefs", ["prefs"]);
lazyRequire("template", ["template"]);

var XBL = "http://www.mozilla.org/xbl";
var XHTML = "http://www.w3.org/1999/xhtml";
var XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
var NS = "http://vimperator.org/namespaces/liberator";

function BooleanAttribute(attr) ({
    get: function (elem) elem.getAttribute(attr) == "true",
    set: function (elem, val) {
        if (val === "false" || !val)
            elem.removeAttribute(attr);
        else
            elem.setAttribute(attr, true);
    }
});

/**
 * @class
 *
 * A jQuery-inspired DOM utility framework.
 *
 * Please note that while this currently implements an Array-like
 * interface, this is *not a defined interface* and is very likely to
 * change in the near future.
 */
var DOM = Class("DOM", {
    init: function init(val, context, nodes) {
        let self;
        let length = 0;

        if (nodes)
            this.nodes = nodes;

        if (context instanceof Ci.nsIDOMDocument)
            this.document = context;

        if (typeof val == "string")
            val = context.querySelectorAll(val);

        if (val == null)
            ;
        else if (DOM.isJSONXML(val)) {
            if (context instanceof Ci.nsIDOMDocument)
                this[length++] = DOM.fromJSON(val, context, this.nodes);
            else
                this[length++] = val;
        }
        else if (val instanceof Ci.nsIDOMNode || val instanceof Ci.nsIDOMWindow)
            this[length++] = val;
        else if ("__iterator__" in val || isinstance(val, ["Iterator", "Generator"]))
            for (let elem in val)
                this[length++] = elem;
        else if ("length" in val)
            for (let i = 0; i < val.length; i++)
                this[length++] = val[i];
        else
            this[length++] = val;

        this.length = length;
        return self || this;
    },

    __iterator__: function __iterator__() {
        for (let i = 0; i < this.length; i++)
            yield this[i];
    },

    Empty: function Empty() this.constructor(null, this.document),

    nodes: Class.Memoize(function () ({})),

    get items() {
        for (let i = 0; i < this.length; i++)
            yield this.eq(i);
    },

    get document() this._document || this[0] && (this[0].ownerDocument || this[0].document || this[0]),
    set document(val) this._document = val,

    attrHooks: array.toObject([
        ["", {
            href: { get: function (elem) elem.href || elem.getAttribute("href") },
            src:  { get: function (elem) elem.src || elem.getAttribute("src") },
            checked: { get: function (elem) elem.hasAttribute("checked") ? elem.getAttribute("checked") == "true" : elem.checked,
                       set: function (elem, val) { elem.setAttribute("checked", !!val); elem.checked = val; } },
            collapsed: BooleanAttribute("collapsed"),
            disabled: BooleanAttribute("disabled"),
            hidden: BooleanAttribute("hidden"),
            readonly: BooleanAttribute("readonly")
        }]
    ]),

    matcher: function matcher(sel) elem => (elem.mozMatchesSelector && elem.mozMatchesSelector(sel)),

    each: function each(fn, self) {
        let obj = self || this.Empty();
        for (let i = 0; i < this.length; i++)
            fn.call(self || update(obj, [this[i]]), this[i], i);
        return this;
    },

    eachDOM: function eachDOM(val, fn, self) {
        let dom = this;
        function munge(val, container, idx) {
            if (val instanceof Ci.nsIDOMRange)
                return val.extractContents();
            if (val instanceof Ci.nsIDOMNode)
                return val;

            if (DOM.isJSONXML(val)) {
                val = dom.constructor(val, dom.document);
                if (container)
                    container[idx] = val[0];
            }

            if (isObject(val) && "length" in val) {
                let frag = dom.document.createDocumentFragment();
                for (let i = 0; i < val.length; i++)
                    frag.appendChild(munge(val[i], val, i));
                return frag;
            }
            return val;
        }

        if (DOM.isJSONXML(val))
            val = (function () this).bind(val);

        if (callable(val))
            return this.each(function (elem, i) {
                util.withProperErrors(fn, this, munge(val.call(this, elem, i)), elem, i);
            }, self || this);

        if (this.length)
            util.withProperErrors(fn, self || this, munge(val), this[0], 0);
        return this;
    },

    eq: function eq(idx) {
        return this.constructor(this[idx >= 0 ? idx : this.length + idx]);
    },

    find: function find(val) {
        return this.map(elem => elem.querySelectorAll(val));
    },

    findAnon: function findAnon(attr, val) {
        return this.map(elem => elem.ownerDocument.getAnonymousElementByAttribute(elem, attr, val));
    },

    filter: function filter(val, self) {
        let res = this.Empty();

        if (!callable(val))
            val = this.matcher(val);

        this.constructor(Array.filter(this, val, self || this));
        let obj = self || this.Empty();
        for (let i = 0; i < this.length; i++)
            if (val.call(self || update(obj, [this[i]]), this[i], i))
                res[res.length++] = this[i];

        return res;
    },

    is: function is(val) {
        return this.some(this.matcher(val));
    },

    reverse: function reverse() {
        Array.reverse(this);
        return this;
    },

    all: function all(fn, self) {
        let res = this.Empty();

        this.each(function (elem) {
            while (true) {
                elem = fn.call(this, elem);
                if (elem instanceof Ci.nsIDOMNode)
                    res[res.length++] = elem;
                else if (elem && "length" in elem)
                    for (let i = 0; i < elem.length; i++)
                        res[res.length++] = elem[j];
                else
                    break;
            }
        }, self || this);
        return res;
    },

    map: function map(fn, self) {
        let res = this.Empty();
        let obj = self || this.Empty();

        for (let i = 0; i < this.length; i++) {
            let tmp = fn.call(self || update(obj, [this[i]]), this[i], i);
            if (isObject(tmp) && !(tmp instanceof Ci.nsIDOMNode) && "length" in tmp)
                for (let j = 0; j < tmp.length; j++)
                    res[res.length++] = tmp[j];
            else if (tmp != null)
                res[res.length++] = tmp;
        }

        return res;
    },

    slice: function eq(start, end) {
        return this.constructor(Array.slice(this, start, end));
    },

    some: function some(fn, self) {
        for (let i = 0; i < this.length; i++)
            if (fn.call(self || this, this[i], i))
                return true;
        return false;
    },

    get parent() this.map(elem => elem.parentNode, this),

    get offsetParent() this.map(function (elem) {
        do {
            var parent = elem.offsetParent;
            if (parent instanceof Ci.nsIDOMElement && DOM(parent).position != "static")
                return parent;
        }
        while (parent);
    }, this),

    get ancestors() this.all(elem => elem.parentNode),

    get children() this.map(elem => Array.filter(elem.childNodes,
                                                 e => e instanceof Ci.nsIDOMElement),
                            this),

    get contents() this.map(elem => elem.childNodes, this),

    get siblings() this.map(elem => Array.filter(elem.parentNode.childNodes,
                                                 e => e != elem && e instanceof Ci.nsIDOMElement),
                            this),

    get siblingsBefore() this.all(elem => elem.previousElementSibling),
    get siblingsAfter() this.all(elem => elem.nextElementSibling),

    get allSiblingsBefore() this.all(elem => elem.previousSibling),
    get allSiblingsAfter() this.all(elem => elem.nextSibling),

    get class() let (self = this) ({
        toString: function () self[0].className,

        get list() Array.slice(self[0].classList),
        set list(val) self.attr("class", val.join(" ")),

        each: function each(meth, arg) {
            return self.each(function (elem) {
                elem.classList[meth](arg);
            });
        },

        add: function add(cls) this.each("add", cls),
        remove: function remove(cls) this.each("remove", cls),
        toggle: function toggle(cls, val, thisObj) {
            if (callable(val))
                return self.each(function (elem, i) {
                    this.class.toggle(cls, val.call(thisObj || this, elem, i));
                });
            return this.each(val == null ? "toggle" : val ? "add" : "remove", cls);
        },

        has: function has(cls) this[0].classList.has(cls)
    }),

    get highlight() let (self = this) ({
        toString: function () self.attrNS(NS, "highlight") || "",

        get list() let (s = this.toString().trim()) s ? s.split(/\s+/) : [],
        set list(val) {
            let str = array.uniq(val).join(" ").trim();
            self.attrNS(NS, "highlight", str || null);
        },

        has: function has(hl) ~this.list.indexOf(hl),

        add: function add(hl) self.each(function () {
            highlight.loaded[hl] = true;
            this.highlight.list = this.highlight.list.concat(hl);
        }),

        remove: function remove(hl) self.each(function () {
            this.highlight.list = this.highlight.list.filter(h => h != hl);
        }),

        toggle: function toggle(hl, val, thisObj) self.each(function (elem, i) {
            let { highlight } = this;
            let v = callable(val) ? val.call(thisObj || this, elem, i) : val;

            highlight[(v == null ? highlight.has(hl) : !v) ? "remove" : "add"](hl);
        }),
    }),

    get rect() this[0] instanceof Ci.nsIDOMWindow ? { width: this[0].scrollMaxX + this[0].innerWidth,
                                                      height: this[0].scrollMaxY + this[0].innerHeight,
                                                      get right() this.width + this.left,
                                                      get bottom() this.height + this.top,
                                                      top: -this[0].scrollY,
                                                      left: -this[0].scrollX } :
               this[0]                            ? this[0].getBoundingClientRect() : {},

    get viewport() {
        let node = this[0];
        if (node instanceof Ci.nsIDOMDocument)
            node = node.defaultView;

        if (node instanceof Ci.nsIDOMWindow)
            return {
                get width() this.right - this.left,
                get height() this.bottom - this.top,
                bottom: node.innerHeight,
                right: node.innerWidth,
                top: 0, left: 0
            };

        let r = this.rect;
        return {
            width: node.clientWidth,
            height: node.clientHeight,
            top: r.top + node.clientTop,
            get bottom() this.top + this.height,
            left: r.left + node.clientLeft,
            get right() this.left + this.width
        };
    },

    scrollPos: function scrollPos(left, top) {
        if (arguments.length == 0) {
            if (this[0] instanceof Ci.nsIDOMElement)
                return { top: this[0].scrollTop, left: this[0].scrollLeft,
                         height: this[0].scrollHeight, width: this[0].scrollWidth,
                         innerHeight: this[0].clientHeight, innerWidth: this[0].innerWidth };

            if (this[0] instanceof Ci.nsIDOMWindow)
                return { top: this[0].scrollY, left: this[0].scrollX,
                         height: this[0].scrollMaxY + this[0].innerHeight,
                         width: this[0].scrollMaxX + this[0].innerWidth,
                         innerHeight: this[0].innerHeight, innerWidth: this[0].innerWidth };

            return null;
        }
        let func = callable(left) && left;

        return this.each(function (elem, i) {
            if (func)
                ({ left, top }) = func.call(this, elem, i);

            if (elem instanceof Ci.nsIDOMWindow)
                elem.scrollTo(left == null ? elem.scrollX : left,
                              top  == null ? elem.scrollY : top);
            else {
                if (left != null)
                    elem.scrollLeft = left;
                if (top != null)
                    elem.scrollTop = top;
            }
        });
    },

    /**
     * Returns true if the given DOM node is currently visible.
     * @returns {boolean}
     */
    get isVisible() {
        let style = this[0] && this.style;
        return style && style.visibility == "visible" && style.display != "none";
    },

    get editor() {
        if (!this.length)
            return;

        this[0] instanceof Ci.nsIDOMNSEditableElement;
        try {
            if (this[0].editor instanceof Ci.nsIEditor)
                var editor = this[0].editor;
        }
        catch (e) {
            util.reportError(e);
        }

        try {
            if (!editor)
                editor = this[0].QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
                                .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIEditingSession)
                                .getEditorForWindow(this[0]);
        }
        catch (e) {}

        editor instanceof Ci.nsIPlaintextEditor;
        editor instanceof Ci.nsIHTMLEditor;
        return editor;
    },

    get isEditable() !!this.editor || this[0] instanceof Ci.nsIDOMElement && this.style.MozUserModify == "read-write",

    get isInput() isinstance(this[0], [Ci.nsIDOMHTMLInputElement,
                                       Ci.nsIDOMHTMLTextAreaElement,
                                       Ci.nsIDOMXULTextBoxElement])
                    && this.isEditable,

    /**
     * Returns an object representing a Node's computed CSS style.
     * @returns {Object}
     */
    get style() {
        let node = this[0];
        if (node instanceof Ci.nsIDOMWindow)
            node = node.document;
        if (node instanceof Ci.nsIDOMDocument)
            node = node.documentElement;
        while (node && !(node instanceof Ci.nsIDOMElement) && node.parentNode)
            node = node.parentNode;

        try {
            var res = node.ownerDocument.defaultView.getComputedStyle(node, null);
        }
        catch (e) {}

        if (res == null) {
            util.dumpStack(_("error.nullComputedStyle", node));
            Cu.reportError(Error(_("error.nullComputedStyle", node)));
            return {};
        }
        return res;
    },

    /**
     * Parses the fields of a form and returns a URL/POST-data pair
     * that is the equivalent of submitting the form.
     *
     * @returns {object} An object with the following elements:
     *      url: The URL the form points to.
     *      postData: A string containing URL-encoded post data, if this
     *                form is to be POSTed
     *      charset: The character set of the GET or POST data.
     *      elements: The key=value pairs used to generate query information.
     */
    // Nuances gleaned from browser.jar/content/browser/browser.js
    get formData() {
        function encode(name, value, param) {
            param = param ? "%s" : "";
            if (post)
                return name + "=" + encodeComponent(value + param);
            return encodeComponent(name) + "=" + encodeComponent(value) + param;
        }

        let field = this[0];
        let form = field.form;
        let doc = form.ownerDocument;

        let charset = doc.characterSet;
        let converter = services.CharsetConv(charset);
        for (let cs of form.acceptCharset.split(/\s*,\s*|\s+/)) {
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

        for (let [, elem] in iter(form.elements))
            if (elem.name && !elem.disabled) {
                if (DOM(elem).isInput
                        || /^(?:hidden|textarea)$/.test(elem.type)
                        || elem.type == "submit" && elem == field
                        || elem.checked && /^(?:checkbox|radio)$/.test(elem.type)) {

                    if (elem !== field)
                        elems.push(encode(elem.name, elem.value));
                    else if (overlay.getData(elem, "had-focus"))
                        elems.push(encode(elem.name, elem.value, true));
                    else
                        elems.push(encode(elem.name, "", true));
                }
                else if (elem instanceof Ci.nsIDOMHTMLSelectElement) {
                    for (let [, opt] in Iterator(elem.options))
                        if (opt.selected)
                            elems.push(encode(elem.name, opt.value));
                }
            }

        if (post)
            return { url: url, postData: elems.join('&'), charset: charset, elements: elems };
        return { url: url + "?" + elems.join('&'), postData: null, charset: charset, elements: elems };
    },

    /**
     * Generates an XPath expression for the given element.
     *
     * @returns {string}
     */
    get xpath() {
        function quote(val) "'" + val.replace(/[\\']/g, "\\$&") + "'";
        if (!(this[0] instanceof Ci.nsIDOMElement))
            return null;

        let res = [];
        let doc = this.document;
        for (let elem = this[0];; elem = elem.parentNode) {
            if (!(elem instanceof Ci.nsIDOMElement))
                res.push("");
            else if (elem.id)
                res.push("id(" + quote(elem.id) + ")");
            else {
                let name = elem.localName;
                if (elem.namespaceURI && (elem.namespaceURI != XHTML || doc.xmlVersion))
                    if (elem.namespaceURI in DOM.namespaceNames)
                        name = DOM.namespaceNames[elem.namespaceURI] + ":" + name;
                    else
                        name = "*[local-name()=" + quote(name) + " and namespace-uri()=" + quote(elem.namespaceURI) + "]";

                res.push(name + "[" + (1 + iter(DOM.XPath("./" + name, elem.parentNode)).indexOf(elem)) + "]");
                continue;
            }
            break;
        }

        return res.reverse().join("/");
    },

    /**
     * Returns a string or XML representation of this node.
     *
     * @param {boolean} color If true, return a colored, XML
     *  representation of this node.
     */
    repr: function repr(color) {
        function namespaced(node) {
            var ns = DOM.namespaceNames[node.namespaceURI] || /^(?:(.*?):)?/.exec(node.name)[1];
            if (!ns)
                return node.localName;
            if (color)
                return [["span", { highlight: "HelpXMLNamespace" }, ns],
                        node.localName];
            return ns + ":" + node.localName;
        }

        let res = [];
        this.each(function (elem) {
            try {
                let hasChildren = elem.firstChild && (!/^\s*$/.test(elem.firstChild) || elem.firstChild.nextSibling);
                if (color)
                    res.push(["span", { highlight: "HelpXML" },
                        ["span", { highlight: "HelpXMLTagStart" },
                            "<", namespaced(elem), " ",
                            template.map(array.iterValues(elem.attributes),
                                attr => [
                                    ["span", { highlight: "HelpXMLAttribute" }, namespaced(attr)],
                                    ["span", { highlight: "HelpXMLString" }, attr.value]
                                ],
                                " "),
                            !hasChildren ? "/>" : ">",
                        ],
                        !hasChildren ? "" :
                            ["", "...",
                             ["span", { highlight: "HtmlTagEnd" }, "<", namespaced(elem), ">"]]
                    ]);
                else {
                    let tag = "<" + [namespaced(elem)].concat(
                        [namespaced(a) + '="' + String.replace(a.value, /["<]/, DOM.escapeHTML) + '"'
                         for ([i, a] in array.iterItems(elem.attributes))]).join(" ");

                    res.push(tag + (!hasChildren ? "/>" : ">...</" + namespaced(elem) + ">"));
                }
            }
            catch (e) {
                res.push({}.toString.call(elem));
            }
        }, this);
        res = template.map(res, util.identity, ",");
        return color ? res : res.join("");
    },

    attr: function attr(key, val) {
        return this.attrNS("", key, val);
    },

    attrNS: function attrNS(ns, key, val) {
        if (val !== undefined)
            key = array.toObject([[key, val]]);

        let hooks = this.attrHooks[ns] || {};

        if (isObject(key))
            return this.each(function (elem, i) {
                for (let [k, v] in Iterator(key)) {
                    if (callable(v))
                        v = v.call(this, elem, i);

                    if (hasOwnProperty(hooks, k) && hooks[k].set)
                        hooks[k].set.call(this, elem, v, k);
                    else if (v == null)
                        elem.removeAttributeNS(ns, k);
                    else
                        elem.setAttributeNS(ns, k, v);
                }
            });

        if (!this.length)
            return null;

        if (hasOwnProperty(hooks, key) && hooks[key].get)
            return hooks[key].get.call(this, this[0], key);

        if (!this[0].hasAttributeNS(ns, key))
            return null;

        return this[0].getAttributeNS(ns, key);
    },

    css: update(function css(key, val) {
        if (val !== undefined)
            key = array.toObject([[key, val]]);

        if (isObject(key))
            return this.each(function (elem) {
                for (let [k, v] in Iterator(key))
                    elem.style[css.property(k)] = v;
            });

        return this[0].style[css.property(key)];
    }, {
        name: function (property) property.replace(/[A-Z]/g, m0 => "-" + m0.toLowerCase()),

        property: function (name) name.replace(/-(.)/g, (m0, m1) => m1.toUpperCase())
    }),

    append: function append(val) {
        return this.eachDOM(val, function (elem, target) {
            target.appendChild(elem);
        });
    },

    prepend: function prepend(val) {
        return this.eachDOM(val, function (elem, target) {
            target.insertBefore(elem, target.firstChild);
        });
    },

    before: function before(val) {
        return this.eachDOM(val, function (elem, target) {
            target.parentNode.insertBefore(elem, target);
        });
    },

    after: function after(val) {
        return this.eachDOM(val, function (elem, target) {
            target.parentNode.insertBefore(elem, target.nextSibling);
        });
    },

    appendTo: function appendTo(elem) {
        if (!(elem instanceof this.constructor))
            elem = this.constructor(elem, this.document);
        elem.append(this);
        return this;
    },

    prependTo: function prependTo(elem) {
        if (!(elem instanceof this.constructor))
            elem = this.constructor(elem, this.document);
        elem.prepend(this);
        return this;
    },

    insertBefore: function insertBefore(elem) {
        if (!(elem instanceof this.constructor))
            elem = this.constructor(elem, this.document);
        elem.before(this);
        return this;
    },

    insertAfter: function insertAfter(elem) {
        if (!(elem instanceof this.constructor))
            elem = this.constructor(elem, this.document);
        elem.after(this);
        return this;
    },

    remove: function remove() {
        return this.each(function (elem) {
            if (elem.parentNode)
                elem.parentNode.removeChild(elem);
        }, this);
    },

    empty: function empty() {
        return this.each(function (elem) {
            while (elem.firstChild)
                elem.removeChild(elem.firstChild);
        }, this);
    },

    fragment: function fragment() {
        let frag = this.document.createDocumentFragment();
        this.appendTo(frag);
        return this;
    },

    clone: function clone(deep)
        this.map(elem => elem.cloneNode(deep)),

    toggle: function toggle(val, self) {
        if (callable(val))
            return this.each(function (elem, i) {
                this[val.call(self || this, elem, i) ? "show" : "hide"]();
            });

        if (arguments.length)
            return this[val ? "show" : "hide"]();

        let hidden = this.map(elem => elem.style.display == "none");
        return this.each(function (elem, i) {
            this[hidden[i] ? "show" : "hide"]();
        });
    },
    hide: function hide() {
        return this.each(function (elem) { elem.style.display = "none"; }, this);
    },
    show: function show() {
        for (let i = 0; i < this.length; i++)
            if (!this[i].dactylDefaultDisplay && this[i].style.display)
                this[i].style.display = "";

        this.each(function (elem) {
            if (!elem.dactylDefaultDisplay)
                elem.dactylDefaultDisplay = this.style.display;
        });

        return this.each(function (elem) {
            elem.style.display = elem.dactylDefaultDisplay == "none" ? "block" : "";
        }, this);
    },

    createContents: function createContents()
        this.each(DOM.createContents, this),

    isScrollable: function isScrollable(direction)
        this.length && DOM.isScrollable(this[0], direction),

    getSet: function getSet(args, get, set) {
        if (!args.length)
            return this[0] && get.call(this, this[0]);

        let [fn, self] = args;
        if (!callable(fn))
            fn = () => args[0];

        return this.each(function (elem, i) {
            set.call(this, elem, fn.call(self || this, elem, i));
        }, this);
    },

    html: function html(txt, self) {
        return this.getSet(arguments,
                           elem => elem.innerHTML,
                           util.wrapCallback((elem, val) => { elem.innerHTML = val; }));
    },

    text: function text(txt, self) {
        return this.getSet(arguments,
                           elem => elem.textContent,
                           (elem, val) => { elem.textContent = val; });
    },

    val: function val(txt) {
        return this.getSet(arguments,
                           elem => elem.value,
                           (elem, val) => { elem.value = val == null ? "" : val; });
    },

    listen: function listen(event, listener, capture) {
        if (isObject(event))
            capture = listener;
        else
            event = array.toObject([[event, listener]]);

        for (let [evt, callback] in Iterator(event))
            event[evt] = util.wrapCallback(callback, true);

        return this.each(function (elem) {
            for (let [evt, callback] in Iterator(event))
                elem.addEventListener(evt, callback, capture);
        });
    },
    unlisten: function unlisten(event, listener, capture) {
        if (isObject(event))
            capture = listener;
        else
            event = array.toObject([[event, listener]]);

        return this.each(function (elem) {
            for (let [k, v] in Iterator(event))
                elem.removeEventListener(k, v.wrapper || v, capture);
        });
    },
    once: function once(event, listener, capture) {
        if (isObject(event))
            capture = listener;
        else
            event = array.toObject([[event, listener]]);

        for (let pair in Iterator(event)) {
            let [evt, callback] = pair;
            event[evt] = util.wrapCallback(function wrapper(event) {
                this.removeEventListener(evt, wrapper.wrapper, capture);
                return callback.apply(this, arguments);
            }, true);
        }

        return this.each(function (elem) {
            for (let [k, v] in Iterator(event))
                elem.addEventListener(k, v, capture);
        });
    },

    dispatch: function dispatch(event, params, extraProps) {
        this.canceled = false;
        return this.each(function (elem) {
            let evt = DOM.Event(this.document, event, params, elem);
            if (!DOM.Event.dispatch(elem, evt, extraProps))
                this.canceled = true;
        }, this);
    },

    focus: function focus(arg, extra) {
        if (callable(arg))
            return this.listen("focus", arg, extra);

        let elem = this[0];
        let flags = arg || services.focus.FLAG_BYMOUSE;
        try {
            if (elem instanceof Ci.nsIDOMDocument)
                elem = elem.defaultView;
            if (elem instanceof Ci.nsIDOMElement)
                services.focus.setFocus(elem, flags);
            else if (elem instanceof Ci.nsIDOMWindow) {
                services.focus.focusedWindow = elem;
                if (services.focus.focusedWindow != elem)
                    services.focus.clearFocus(elem);
            }
        }
        catch (e) {
            util.dump(elem);
            util.reportError(e);
        }
        return this;
    },
    blur: function blur(arg, extra) {
        if (callable(arg))
            return this.listen("blur", arg, extra);
        return this.each(function (elem) { elem.blur(); }, this);
    },

    /**
     * Scrolls an element into view if and only if it's not already
     * fully visible.
     */
    scrollIntoView: function scrollIntoView(alignWithTop) {
        return this.each(function (elem) {
            function getAlignment(viewport) {
                if (alignWithTop !== undefined)
                    return alignWithTop;
                if (rect.bottom < viewport.top)
                    return true;
                if (rect.top > viewport.bottom)
                    return false;
                return Math.abs(rect.top) < Math.abs(viewport.bottom - rect.bottom);
            }

            let rect;
            function fix(parent) {
                if (!(parent[0] instanceof Ci.nsIDOMWindow)
                        && parent.style.overflow == "visible")
                    return;

                ({ rect }) = DOM(elem);
                let { viewport } = parent;
                let isect = util.intersection(rect, viewport);

                if (isect.height < Math.min(viewport.height, rect.height)) {
                    let { top } = parent.scrollPos();
                    if (getAlignment(viewport))
                        parent.scrollPos(null, top - (viewport.top - rect.top));
                    else
                        parent.scrollPos(null, top - (viewport.bottom - rect.bottom));

                }
            }

            for (let parent in this.ancestors.items)
                fix(parent);

            fix(DOM(this.document.defaultView));
        });
    },
}, {
    /**
     * Creates an actual event from a pseudo-event object.
     *
     * The pseudo-event object (such as may be retrieved from
     * DOM.Event.parse) should have any properties you want the event to
     * have.
     *
     * @param {Document} doc The DOM document to associate this event with
     * @param {Type} type The type of event (keypress, click, etc.)
     * @param {Object} opts The pseudo-event. @optional
     */
    Event: Class("Event", {
        init: function Event(doc, type, opts, target) {
            const DEFAULTS = {
                HTML: {
                    type: type, bubbles: true, cancelable: false
                },
                Key: {
                    type: type,
                    bubbles: true, cancelable: true,
                    view: doc.defaultView,
                    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
                    keyCode: 0, charCode: 0
                },
                Mouse: {
                    type: type,
                    bubbles: true, cancelable: true,
                    view: doc.defaultView,
                    detail: 1,
                    get screenX() this.view.mozInnerScreenX
                                + Math.max(0, this.clientX + (DOM(target || opts.target).rect.left || 0)),
                    get screenY() this.view.mozInnerScreenY
                                + Math.max(0, this.clientY + (DOM(target || opts.target).rect.top || 0)),
                    clientX: 0,
                    clientY: 0,
                    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
                    button: 0,
                    relatedTarget: null
                }
            };

            opts = opts || {};
            var t = this.constructor.types[type] || "";
            var evt = doc.createEvent(t + "Events");

            let params = DEFAULTS[t || "HTML"];
            let args = Object.keys(params);
            update(params, this.constructor.defaults[type],
                   iter.toObject([k, opts[k]] for (k in opts) if (k in params)));

            evt["init" + t + "Event"].apply(evt, args.map(k => params[k]));
            return evt;
        }
    }, {
        init: function init() {
            // NOTE: the order of ["Esc", "Escape"] or ["Escape", "Esc"]
            //       matters, so use that string as the first item, that you
            //       want to refer to within dactyl's source code for
            //       comparisons like if (key == "<Esc>") { ... }
            this.keyTable = {
                add: ["+", "Plus", "Add"],
                back_quote: ["`"],
                back_slash: ["\\"],
                back_space: ["BS"],
                comma: [","],
                count: ["count"],
                close_bracket: ["]"],
                delete: ["Del"],
                equals: ["="],
                escape: ["Esc", "Escape"],
                insert: ["Insert", "Ins"],
                leader: ["Leader"],
                left_shift: ["LT", "<"],
                nop: ["Nop"],
                open_bracket: ["["],
                pass: ["Pass"],
                period: ["."],
                quote: ["'"],
                return: ["Return", "CR", "Enter"],
                right_shift: [">"],
                semicolon: [";"],
                slash: ["/"],
                space: ["Space", " "],
                subtract: ["-", "Minus", "Subtract"]
            };

            this.key_key = {};
            this.code_key = {};
            this.key_code = {};
            this.code_nativeKey = {};

            for (let list in values(this.keyTable))
                for (let v in values(list)) {
                    if (v.length == 1)
                        v = v.toLowerCase();
                    this.key_key[v.toLowerCase()] = v;
                }

            for (let [k, v] in Iterator(Ci.nsIDOMKeyEvent)) {
                if (!/^DOM_VK_/.test(k))
                    continue;

                this.code_nativeKey[v] = k.substr(4);

                k = k.substr(7).toLowerCase();
                let names = [k.replace(/(^|_)(.)/g, (m, n1, n2) => n2.toUpperCase())
                              .replace(/^NUMPAD/, "k")];

                if (names[0].length == 1)
                    names[0] = names[0].toLowerCase();

                if (k in this.keyTable)
                    names = this.keyTable[k];

                this.code_key[v] = names[0];
                for (let [, name] in Iterator(names)) {
                    this.key_key[name.toLowerCase()] = name;
                    this.key_code[name.toLowerCase()] = v;
                }
            }

            // HACK: as Gecko does not include an event for <, we must add this in manually.
            if (!("<" in this.key_code)) {
                this.key_code["<"] = 60;
                this.key_code["lt"] = 60;
                this.code_key[60] = "lt";
            }

            return this;
        },

        code_key:       Class.Memoize(function (prop) this.init()[prop]),
        code_nativeKey: Class.Memoize(function (prop) this.init()[prop]),
        keyTable:       Class.Memoize(function (prop) this.init()[prop]),
        key_code:       Class.Memoize(function (prop) this.init()[prop]),
        key_key:        Class.Memoize(function (prop) this.init()[prop]),
        pseudoKeys:     RealSet(["count", "leader", "nop", "pass"]),

        /**
         * Converts a user-input string of keys into a canonical
         * representation.
         *
         * <C-A> maps to <C-a>, <C-S-a> maps to <C-S-A>
         * <C- > maps to <C-Space>, <S-a> maps to A
         * << maps to <lt><lt>
         *
         * <S-@> is preserved, as in Vim, to allow untypeable key-combinations
         * in macros.
         *
         * canonicalKeys(canonicalKeys(x)) == canonicalKeys(x) for all values
         * of x.
         *
         * @param {string} keys Messy form.
         * @param {boolean} unknownOk Whether unknown keys are passed
         *     through rather than being converted to <lt>keyname>.
         *     @default true
         * @returns {string} Canonical form.
         */
        canonicalKeys: function canonicalKeys(keys, unknownOk=true) {
            return this.parse(keys, unknownOk).map(this.bound.stringify).join("");
        },

        iterKeys: function iterKeys(keys) iter(function () {
            let match, re = /<.*?>?>|[^<]/g;
            while (match = re.exec(keys))
                yield match[0];
        }()),

        /**
         * Converts an event string into an array of pseudo-event objects.
         *
         * These objects can be used as arguments to {@link #stringify} or
         * {@link DOM.Event}, though they are unlikely to be much use for other
         * purposes. They have many of the properties you'd expect to find on a
         * real event, but none of the methods.
         *
         * Also may contain two "special" parameters, .dactylString and
         * .dactylShift these are set for characters that can never by
         * typed, but may appear in mappings, for example <Nop> is passed as
         * dactylString, and dactylShift is set when a user specifies
         * <S-@> where @ is a non-case-changeable, non-space character.
         *
         * @param {string} keys The string to parse.
         * @param {boolean} unknownOk Whether unknown keys are passed
         *     through rather than being converted to <lt>keyname>.
         *     @default true
         * @returns {Array[Object]}
         */
        parse: function parse(input, unknownOk=true) {
            if (isArray(input))
                return array.flatten(input.map(k => this.parse(k, unknownOk)));

            let out = [];
            for (let match in util.regexp.iterate(/<.*?>?>|[^<]|<(?!.*>)/g, input)) {
                let evt_str = match[0];

                let evt_obj = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
                                keyCode: 0, charCode: 0, type: "keypress" };

                if (evt_str.length == 1) {
                    evt_obj.charCode = evt_str.charCodeAt(0);
                    evt_obj._keyCode = this.key_code[evt_str[0].toLowerCase()];
                    evt_obj.shiftKey = evt_str !== evt_str.toLowerCase();
                }
                else {
                    let [match, modifier, keyname] = evt_str.match(/^<((?:[*12CASM⌘]-)*)(.+?)>$/i) || [false, '', ''];
                    modifier = RealSet(modifier.toUpperCase());
                    keyname = keyname.toLowerCase();
                    evt_obj.dactylKeyname = keyname;
                    if (/^u[0-9a-f]+$/.test(keyname))
                        keyname = String.fromCharCode(parseInt(keyname.substr(1), 16));

                    if (keyname && (unknownOk || keyname.length == 1 || /mouse$/.test(keyname) ||
                                    this.key_code[keyname] || this.pseudoKeys.has(keyname))) {
                        evt_obj.globKey  = modifier.has("*");
                        evt_obj.ctrlKey  = modifier.has("C");
                        evt_obj.altKey   = modifier.has("A");
                        evt_obj.shiftKey = modifier.has("S");
                        evt_obj.metaKey  = modifier.has("M") || modifier.has("⌘");
                        evt_obj.dactylShift = evt_obj.shiftKey;

                        if (keyname.length == 1) { // normal characters
                            if (evt_obj.shiftKey)
                                keyname = keyname.toUpperCase();

                            evt_obj.dactylShift = evt_obj.shiftKey && keyname.toUpperCase() == keyname.toLowerCase();
                            evt_obj.charCode = keyname.charCodeAt(0);
                            evt_obj.keyCode = this.key_code[keyname.toLowerCase()];
                        }
                        else if (this.pseudoKeys.has(keyname)) {
                            evt_obj.dactylString = "<" + this.key_key[keyname] + ">";
                        }
                        else if (/mouse$/.test(keyname)) { // mouse events
                            evt_obj.type = (modifier.has("2") ? "dblclick" : "click");
                            evt_obj.button = ["leftmouse", "middlemouse", "rightmouse"].indexOf(keyname);
                            delete evt_obj.keyCode;
                            delete evt_obj.charCode;
                        }
                        else { // spaces, control characters, and <
                            evt_obj.keyCode = this.key_code[keyname];
                            evt_obj.charCode = 0;
                        }
                    }
                    else { // an invalid sequence starting with <, treat as a literal
                        out = out.concat(this.parse("<lt>" + evt_str.substr(1)));
                        continue;
                    }
                }

                // TODO: make a list of characters that need keyCode and charCode somewhere
                if (evt_obj.keyCode == 32 || evt_obj.charCode == 32)
                    evt_obj.charCode = evt_obj.keyCode = 32; // <Space>
                if (evt_obj.keyCode == 60 || evt_obj.charCode == 60)
                    evt_obj.charCode = evt_obj.keyCode = 60; // <lt>

                evt_obj.modifiers = (evt_obj.ctrlKey  && Ci.nsIDOMNSEvent.CONTROL_MASK)
                                  | (evt_obj.altKey   && Ci.nsIDOMNSEvent.ALT_MASK)
                                  | (evt_obj.shiftKey && Ci.nsIDOMNSEvent.SHIFT_MASK)
                                  | (evt_obj.metaKey  && Ci.nsIDOMNSEvent.META_MASK);

                out.push(evt_obj);
            }
            return out;
        },

        /**
         * Converts the specified event to a string in dactyl key-code
         * notation. Returns null for an unknown event.
         *
         * @param {Event} event
         * @returns {string}
         */
        stringify: function stringify(event) {
            if (isArray(event))
                return event.map(e => this.stringify(e)).join("");

            if (event.dactylString)
                return event.dactylString;

            let key = null;
            let modifier = "";

            if (event.globKey)
                modifier += "*-";
            if (event.ctrlKey)
                modifier += "C-";
            if (event.altKey)
                modifier += "A-";
            if (event.metaKey)
                modifier += "M-";

            if (/^key/.test(event.type)) {
                let charCode = event.type == "keyup" ? 0 : event.charCode; // Why? --Kris
                if (charCode == 0) {
                    if (event.keyCode in this.code_key) {
                        key = this.code_key[event.keyCode];

                        if (event.shiftKey && (key.length > 1 || key.toUpperCase() == key.toLowerCase()
                                               || event.ctrlKey || event.altKey || event.metaKey)
                                || event.dactylShift)
                            modifier += "S-";
                        else if (!modifier && key.length === 1)
                            if (event.shiftKey)
                                key = key.toUpperCase();
                            else
                                key = key.toLowerCase();

                        if (!modifier && key.length == 1)
                            return key;
                    }
                }
                // [Ctrl-Bug] special handling of mysterious <C-[>, <C-\\>, <C-]>, <C-^>, <C-_> bugs (OS/X)
                //            (i.e., cntrl codes 27--31)
                // ---
                // For more information, see:
                //     [*] Referenced mailing list msg: http://www.mozdev.org/pipermail/pentadactyl/2008-May/001548.html
                //     [*] Mozilla bug 416227: event.charCode in keypress handler has unexpected values on Mac for Ctrl with chars in "[ ] _ \"
                //         https://bugzilla.mozilla.org/show_bug.cgi?id=416227
                //     [*] Mozilla bug 432951: Ctrl+'foo' doesn't seem same charCode as Meta+'foo' on Cocoa
                //         https://bugzilla.mozilla.org/show_bug.cgi?id=432951
                // ---
                //
                // The following fixes are only activated if config.OS.isMacOSX.
                // Technically, they prevent mappings from <C-Esc> (and
                // <C-C-]> if your fancy keyboard permits such things<?>), but
                // these <C-control> mappings are probably pathological (<C-Esc>
                // certainly is on Windows), and so it is probably
                // harmless to remove the config.OS.isMacOSX if desired.
                //
                else if (config.OS.isMacOSX && event.ctrlKey && charCode >= 27 && charCode <= 31) {
                    if (charCode == 27) { // [Ctrl-Bug 1/5] the <C-[> bug
                        key = "Esc";
                        modifier = modifier.replace("C-", "");
                    }
                    else // [Ctrl-Bug 2,3,4,5/5] the <C-\\>, <C-]>, <C-^>, <C-_> bugs
                        key = String.fromCharCode(charCode + 64);
                }
                // a normal key like a, b, c, 0, etc.
                else if (charCode) {
                    key = String.fromCharCode(charCode);

                    if (!/^[^<\s]$/i.test(key) && key in this.key_code) {
                        // a named charCode key (<Space> and <lt>) space can be shifted, <lt> must be forced
                        if ((key.match(/^\s$/) && event.shiftKey) || event.dactylShift)
                            modifier += "S-";

                        key = this.code_key[this.key_code[key]];
                    }
                    else {
                        // a shift modifier is only allowed if the key is alphabetical and used in a C-A-M- mapping in the uppercase,
                        // or if the shift has been forced for a non-alphabetical character by the user while :map-ping
                        if (key !== key.toLowerCase() && (event.ctrlKey || event.altKey || event.metaKey) || event.dactylShift)
                            modifier += "S-";
                        if (/^\s$/.test(key))
                            key = let (s = charCode.toString(16)) "U" + "0000".substr(4 - s.length) + s;
                        else if (modifier.length == 0)
                            return key;
                    }
                }
                if (key == null) {
                    if (event.shiftKey)
                        modifier += "S-";
                    key = this.key_key[event.dactylKeyname] || event.dactylKeyname;
                }
                if (key == null)
                    return null;
            }
            else if (event.type == "click" || event.type == "dblclick") {
                if (event.shiftKey)
                    modifier += "S-";
                if (event.type == "dblclick")
                    modifier += "2-";
                // TODO: triple and quadruple click

                switch (event.button) {
                case 0:
                    key = "LeftMouse";
                    break;
                case 1:
                    key = "MiddleMouse";
                    break;
                case 2:
                    key = "RightMouse";
                    break;
                }
            }

            if (key == null)
                return null;

            return "<" + modifier + key + ">";
        },

        defaults: {
            load:   { bubbles: false },
            submit: { cancelable: true }
        },

        types: Class.Memoize(() => iter(
            {
                Mouse: "click mousedown mouseout mouseover mouseup dblclick " +
                       "hover " +
                       "popupshowing popupshown popuphiding popuphidden " +
                       "contextmenu",
                Key:   "keydown keypress keyup",
                "":    "change command dactyl-input input submit " +
                       "load unload pageshow pagehide DOMContentLoaded " +
                       "resize scroll"
            }
        ).map(([k, v]) => v.split(" ").map(v => [v, k]))
         .flatten()
         .toObject()),

        /**
         * Dispatches an event to an element as if it were a native event.
         *
         * @param {Node} target The DOM node to which to dispatch the event.
         * @param {Event} event The event to dispatch.
         */
        dispatch: function dispatch(target, event, extra) {
            try {
                this.feedingEvent = extra;

                if (target instanceof Ci.nsIDOMElement)
                    return (target.ownerDocument || target.document || target).defaultView
                           .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils)
                           .dispatchDOMEventViaPresShell(target, event, true);
                else {
                    target.dispatchEvent(event);
                    return !event.defaultPrevented;
                }
            }
            catch (e) {
                util.reportError(e);
            }
            finally {
                this.feedingEvent = null;
            }
        }
    }),

    createContents: Class.Memoize(() => services.has("dactyl") && services.dactyl.createContents
        || (elem => {})),

    isScrollable: Class.Memoize(() => services.has("dactyl") && services.dactyl.getScrollable
        ? (elem, dir) => services.dactyl.getScrollable(elem) & (dir ? services.dactyl["DIRECTION_" + dir.toUpperCase()] : ~0)
        : (elem, dir) => true),

    isJSONXML: function isJSONXML(val) isArray(val) && isinstance(val[0], ["String", "Array", "XML", DOM.DOMString])
                                    || isObject(val) && "toDOM" in val,

    DOMString: function DOMString(val) ({
        __proto__: DOMString.prototype,

        toDOM: function toDOM(doc) doc.createTextNode(val),

        toString: function () val
    }),

    /**
     * The set of input element type attribute values that mark the element as
     * an editable field.
     */
    editableInputs: RealSet(["date", "datetime", "datetime-local", "email", "file",
                             "month", "number", "password", "range", "search",
                             "tel", "text", "time", "url", "week"]),

    /**
     * Converts a given DOM Node, Range, or Selection to a string. If
     * *html* is true, the output is HTML, otherwise it is presentation
     * text.
     *
     * @param {nsIDOMNode | nsIDOMRange | nsISelection} node The node to
     *      stringify.
     * @param {boolean} html Whether the output should be HTML rather
     *      than presentation text.
     */
    stringify: function stringify(node, html) {
        if (node instanceof Ci.nsISelection && node.isCollapsed)
            return "";

        if (node instanceof Ci.nsIDOMNode) {
            let range = node.ownerDocument.createRange();
            range.selectNode(node);
            node = range;
        }
        let doc = (node.getRangeAt ? node.getRangeAt(0) : node).startContainer;
        doc = doc.ownerDocument || doc;

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
     * Compiles a CSS spec and XPath pattern matcher based on the given
     * list. List elements prefixed with "xpath:" are parsed as XPath
     * patterns, while other elements are parsed as CSS specs. The
     * returned function will, given a node, return an iterator of all
     * descendants of that node which match the given specs.
     *
     * @param {[string]} list The list of patterns to match.
     * @returns {function(Node)}
     */
    compileMatcher: function compileMatcher(list) {
        let xpath = [], css = [];
        for (let elem in values(list))
            if (/^xpath:/.test(elem))
                xpath.push(elem.substr(6));
            else
                css.push(elem);

        return update(
            function matcher(node) {
                if (matcher.xpath)
                    for (let elem in DOM.XPath(matcher.xpath, node))
                        yield elem;

                if (matcher.css)
                    for (let [, elem] in iter(util.withProperErrors("querySelectorAll", node, matcher.css)))
                        yield elem;
            }, {
                css: css.join(", "),
                xpath: xpath.join(" | ")
            });
    },

    /**
     * Validates a list as input for {@link #compileMatcher}. Returns
     * true if and only if every element of the list is a valid XPath or
     * CSS selector.
     *
     * @param {[string]} list The list of patterns to test
     * @returns {boolean} True when the patterns are all valid.
     */
    validateMatcher: function validateMatcher(list) {
        return this.testValues(list, DOM.bound.testMatcher);
    },

    testMatcher: function testMatcher(value) {
        let evaluator = services.XPathEvaluator();
        let node = services.XMLDocument();
        if (/^xpath:/.test(value))
            util.withProperErrors("createExpression", evaluator, value.substr(6), DOM.XPath.resolver);
        else
            util.withProperErrors("querySelector", node, value);
        return true;
    },

    /**
     * Converts HTML special characters in *str* to the equivalent HTML
     * entities.
     *
     * @param {string} str
     * @param {boolean} simple If true, only escape for the simple case
     *     of text nodes.
     * @returns {string}
     */
    escapeHTML: function escapeHTML(str, simple) {
        let map = { "'": "&apos;", '"': "&quot;", "%": "&#x25;", "&": "&amp;", "<": "&lt;", ">": "&gt;" };
        let regexp = simple ? /[<>]/g : /['"&<>]/g;
        return str.replace(regexp, m => map[m]);
    },

    fromJSON: update(function fromJSON(xml, doc, nodes, namespaces) {
        if (!doc)
            doc = document;

        function tag(args, namespaces) {
            let _namespaces = namespaces;

            // Deal with common error case
            if (args == null) {
                util.reportError(Error("Unexpected null when processing XML."));
                args = ["html:i", {}, "[NULL]"];
            }

            if (isinstance(args, ["String", "Number", "Boolean", _]))
                return doc.createTextNode(args);
            if (isObject(args) && "toDOM" in args)
                return args.toDOM(doc, namespaces, nodes);
            if (args instanceof Ci.nsIDOMNode)
                return args;
            if (args instanceof DOM)
                return args.fragment();
            if ("toJSONXML" in args)
                args = args.toJSONXML();

            let [name, attr] = args;

            if (!isString(name) || args.length == 0 || name === "") {
                var frag = doc.createDocumentFragment();
                Array.forEach(args, function (arg) {
                    if (!isArray(arg[0]))
                        arg = [arg];
                    arg.forEach(function (arg) {
                        frag.appendChild(tag(arg, namespaces));
                    });
                });
                return frag;
            }

            attr = attr || {};

            function parseNamespace(name) DOM.parseNamespace(name, namespaces);

            // FIXME: Surely we can do better.
            for (var key in attr) {
                if (/^xmlns(?:$|:)/.test(key)) {
                    if (_namespaces === namespaces)
                        namespaces = Object.create(namespaces);

                    namespaces[key.substr(6)] = namespaces[attr[key]] || attr[key];
                }}

            var args = Array.slice(args, 2);
            var vals = parseNamespace(name);
            var elem = doc.createElementNS(vals[0] || namespaces[""],
                                           name);

            for (var key in attr)
                if (!/^xmlns(?:$|:)/.test(key)) {
                    var val = attr[key];
                    if (nodes && key == "key")
                        nodes[val] = elem;

                    vals = parseNamespace(key);
                    if (key == "highlight")
                        ;
                    else if (typeof val == "function")
                        elem.addEventListener(key.replace(/^on/, ""), val, false);
                    else
                        elem.setAttributeNS(vals[0] || "", key, val);
                }
            args.forEach(function (e) {
                elem.appendChild(tag(e, namespaces));
            });

            if ("highlight" in attr)
                highlight.highlightNode(elem, attr.highlight, nodes || true);
            return elem;
        }

        if (namespaces)
            namespaces = update({}, fromJSON.namespaces, namespaces);
        else
            namespaces = fromJSON.namespaces;

        return tag(xml, namespaces);
    }, {
        namespaces: {
            "": "http://www.w3.org/1999/xhtml",
            dactyl: String(NS),
            html: "http://www.w3.org/1999/xhtml",
            xmlns: "http://www.w3.org/2000/xmlns/",
            xul: "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
        }
    }),

    toXML: function toXML(xml) {
        // Meh. For now.
        let doc = services.XMLDocument();
        let node = this.fromJSON(xml, doc);
        return services.XMLSerializer()
                       .serializeToString(node);
    },

    toPrettyXML: function toPrettyXML(xml, asXML, indent, namespaces) {
        const INDENT = indent || "    ";

        const EMPTY = RealSet("area base basefont br col frame hr img input isindex link meta param"
                            .split(" "));

        function namespaced(namespaces, namespace, localName) {
            for (let [k, v] in Iterator(namespaces))
                if (v == namespace)
                    return (k ? k + ":" + localName : localName);

            throw Error("No such namespace");
        }

        function isFragment(args) !isString(args[0]) || args.length == 0 || args[0] === "";

        function hasString(args) {
            return args.some(a => (isString(a) || isFragment(a) && hasString(a)));
        }

        function isStrings(args) {
            if (!isArray(args))
                return util.dump("ARGS: " + {}.toString.call(args) + " " + args), false;
            return args.every(a => (isinstance(a, ["String", DOM.DOMString]) || isFragment(a) && isStrings(a)));
        }

        function tag(args, namespaces, indent) {
            let _namespaces = namespaces;

            if (args == "")
                return "";

            if (isinstance(args, ["String", "Number", "Boolean", _, DOM.DOMString]))
                return indent +
                       DOM.escapeHTML(String(args), true);

            if (isObject(args) && "toDOM" in args)
                return indent +
                       services.XMLSerializer()
                               .serializeToString(args.toDOM(services.XMLDocument()))
                               .replace(/^/m, indent);

            if (args instanceof Ci.nsIDOMNode)
                return indent +
                       services.XMLSerializer()
                               .serializeToString(args)
                               .replace(/^/m, indent);

            if ("toJSONXML" in args)
                args = args.toJSONXML();

            // Deal with common error case
            if (args == null) {
                util.reportError(Error("Unexpected null when processing XML."));
                return "[NULL]";
            }

            let [name, attr] = args;

            if (isFragment(args)) {
                let res = [];
                let join = isArray(args) && isStrings(args) ? "" : "\n";
                Array.forEach(args, function (arg) {
                    if (!isArray(arg[0]))
                        arg = [arg];

                    let contents = [];
                    arg.forEach(function (arg) {
                        let string = tag(arg, namespaces, indent);
                        if (string)
                            contents.push(string);
                    });
                    if (contents.length)
                        res.push(contents.join("\n"), join);
                });
                if (res[res.length - 1] == join)
                    res.pop();
                return res.join("");
            }

            attr = attr || {};

            function parseNamespace(name) {
                var m = /^(?:(.*):)?(.*)$/.exec(name);
                return [namespaces[m[1]], m[2]];
            }

            // FIXME: Surely we can do better.
            let skipAttr = {};
            for (var key in attr) {
                if (/^xmlns(?:$|:)/.test(key)) {
                    if (_namespaces === namespaces)
                        namespaces = update({}, namespaces);

                    let ns = namespaces[attr[key]] || attr[key];
                    if (ns == namespaces[key.substr(6)])
                        skipAttr[key] = true;

                    attr[key] = namespaces[key.substr(6)] = ns;
                }}

            var args = Array.slice(args, 2);
            var vals = parseNamespace(name);

            let res = [indent, "<", name];

            for (let [key, val] in Iterator(attr)) {
                if (hasOwnProperty(skipAttr, key))
                    continue;

                let vals = parseNamespace(key);
                if (typeof val == "function") {
                    key = key.replace(/^(?:on)?/, "on");
                    val = val.toSource() + "(event)";
                }

                if (key != "highlight" || vals[0] == String(NS))
                    res.push(" ", key, '="', DOM.escapeHTML(val), '"');
                else
                    res.push(" ", namespaced(namespaces, String(NS), "highlight"),
                             '="', DOM.escapeHTML(val), '"');
            }

            if ((vals[0] || namespaces[""]) == String(XHTML) && EMPTY.has(vals[1])
                    || asXML && !args.length)
                res.push("/>");
            else {
                res.push(">");

                if (isStrings(args))
                    res.push(args.map(e => tag(e, namespaces, "")).join(""),
                             "</", name, ">");
                else {
                    let contents = [];
                    args.forEach(function (e) {
                        let string = tag(e, namespaces, indent + INDENT);
                        if (string)
                            contents.push(string);
                    });

                    res.push("\n", contents.join("\n"), "\n", indent, "</", name, ">");
                }
            }

            return res.join("");
        }

        if (namespaces)
            namespaces = update({}, DOM.fromJSON.namespaces, namespaces);
        else
            namespaces = DOM.fromJSON.namespaces;

        return tag(xml, namespaces, "");
    },

    parseNamespace: function parseNamespace(name, namespaces) {
        if (name == "xmlns")
            return [DOM.fromJSON.namespaces.xmlns, "xmlns"];

        var m = /^(?:(.*):)?(.*)$/.exec(name);
        return [(namespaces || DOM.fromJSON.namespaces)[m[1]],
                m[2]];
    },

    /**
     * Evaluates an XPath expression in the current or provided
     * document. It provides the xhtml, xhtml2 and dactyl XML
     * namespaces. The result may be used as an iterator.
     *
     * @param {string} expression The XPath expression to evaluate.
     * @param {Node} elem The context element.
     * @param {boolean} asIterator Whether to return the results as an
     *     XPath iterator.
     * @param {object} namespaces Additional namespaces to recognize.
     *     @optional
     * @returns {Object} Iterable result of the evaluation.
     */
    XPath: update(
        function XPath(expression, elem, asIterator, namespaces) {
            try {
                let doc = elem.ownerDocument || elem;

                if (isArray(expression))
                    expression = DOM.makeXPath(expression);

                let resolver = XPath.resolver;
                if (namespaces) {
                    namespaces = update({}, DOM.namespaces, namespaces);
                    resolver = prefix => namespaces[prefix] || null;
                }

                let result = doc.evaluate(expression, elem,
                    resolver,
                    asIterator ? Ci.nsIDOMXPathResult.ORDERED_NODE_ITERATOR_TYPE : Ci.nsIDOMXPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                    null
                );

                let res = {
                    iterateNext: function () result.iterateNext(),
                    get resultType() result.resultType,
                    get snapshotLength() result.snapshotLength,
                    snapshotItem: function (i) result.snapshotItem(i),
                    __iterator__:
                        asIterator ? function () { let elem; while ((elem = this.iterateNext())) yield elem; }
                                   : function () { for (let i = 0; i < this.snapshotLength; i++) yield this.snapshotItem(i); }
                };
                return res;
            }
            catch (e) {
                throw e.stack ? e : Error(e);
            }
        },
        {
            resolver: function lookupNamespaceURI(prefix) (DOM.namespaces[prefix] || null)
        }),

    /**
     * Returns an XPath union expression constructed from the specified node
     * tests. An expression is built with node tests for both the null and
     * XHTML namespaces. See {@link DOM.XPath}.
     *
     * @param nodes {Array(string)}
     * @returns {string}
     */
    makeXPath: function makeXPath(nodes) {
        return array(nodes).map(util.debrace).flatten()
                           .map(node => /^[a-z]+:/.test(node) ? node
                                                              : [node, "xhtml:" + node])
                           .flatten()
                           .map(node => "//" + node).join(" | ");
    },

    namespaces: {
        xul: XUL,
        xhtml: XHTML,
        html: XHTML,
        xhtml2: "http://www.w3.org/2002/06/xhtml2",
        dactyl: NS
    },

    namespaceNames: Class.Memoize(function ()
        iter(this.namespaces).map(([k, v]) => ([v, k])).toObject()),
});

Object.keys(DOM.Event.types).forEach(function (event) {
    let name = event.replace(/-(.)/g, (m, m1) => m1.toUpperCase());
    if (!hasOwnProperty(DOM.prototype, name))
        DOM.prototype[name] =
            function _event(arg, extra) {
                return this[callable(arg) ? "listen" : "dispatch"](event, arg, extra);
            };
});

var $ = DOM;

endModule();

// catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
