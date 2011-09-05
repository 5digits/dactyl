// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("dom", {
    exports: ["$", "DOM", "NS", "XBL", "XHTML", "XUL"]
}, this);

var XBL = Namespace("xbl", "http://www.mozilla.org/xbl");
var XHTML = Namespace("html", "http://www.w3.org/1999/xhtml");
var XUL = Namespace("xul", "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul");
var NS = Namespace("dactyl", "http://vimperator.org/namespaces/liberator");
default xml namespace = XHTML;

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
    init: function init(val, context) {
        let self;
        let length = 0;

        if (context instanceof Ci.nsIDOMDocument)
            this.document = context;

        if (typeof val == "string")
            val = context.querySelectorAll(val);

        if (val == null)
            ;
        else if (typeof val == "xml")
            this[length++] = DOM.fromXML(val, context, this.nodes);
        else if (val instanceof Ci.nsIDOMNode || val instanceof Ci.nsIDOMWindow)
            this[length++] = val;
        else if ("length" in val)
            for (let i = 0; i < val.length; i++)
                this[length++] = val[i];
        else if ("__iterator__" in val)
            for (let elem in val)
                this[length++] = elem;

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

    get document() this._document || this[0].ownerDocument || this[0].document || this[0],
    set document(val) this._document = val,

    attrHooks: array.toObject([
        ["", {
            href: { get: function (elem) elem.href || elem.getAttribute("href") },
            src:  { get: function (elem) elem.src || elem.getAttribute("src") },
            collapsed: BooleanAttribute("collapsed"),
            disabled: BooleanAttribute("disabled"),
            hidden: BooleanAttribute("hidden"),
            readonly: BooleanAttribute("readonly")
        }]
    ]),

    matcher: function matcher(sel) {
        let res;

        if (/^([a-z0-9_-]+)$/i.exec(sel))
            res = function (elem) elem.localName == val;
        else if (/^#([a-z0-9:_-]+)$/i.exec(sel))
            res = function (elem) elem.id == val;
        else if (/^\.([a-z0-9:_-]+)$/i.exec(sel))
            res = function (elem) elem.classList.contains(val);
        else if (/^\[([a-z0-9:_-]+)\]$/i.exec(sel))
            res = function (elem) elem.hasAttribute(val);
        else
            res = function (elem) ~Array.indexOf(elem.parentNode.querySelectorAll(sel),
                                                 elem);

        let val = RegExp.$1;
        return res;
    },

    each: function each(fn, self) {
        let obj = self || this.Empty();
        for (let i = 0; i < this.length; i++)
            fn.call(self || update(obj, [this[i]]), this[i], i);
        return this;
    },

    eachDOM: function eachDOM(val, fn, self) {
        if (typeof val == "xml")
            return this.each(function (elem, i) {
                fn.call(this, DOM.fromXML(val, elem.ownerDocument), elem, i);
            }, self || this);

        let dom = this;
        function munge(val) {
            if (typeof val == "xml")
                val = dom.constructor(val, dom.document);

            if (isObject(val) && "length" in val) {
                let frag = dom.document.createDocumentFragment();
                for (let i = 0; i < val.length; i++)
                    frag.appendChild(val[i]);
                return frag;
            }
            return val;
        }

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
        return this.map(function (elem) elem.querySelectorAll(val));
    },

    findAnon: function findAnon(attr, val) {
        return this.map(function (elem) elem.ownerDocument.getAnonymousElementByAttribute(elem, attr, val));
    },

    filter: function filter(val, self) {
        let res = this.Empty();

        if (!callable(val))
            val = this.matcher(val);

        this.constructor(Array.filter(this, val, self || this));
        for (let i = 0; i < this.length; i++)
            if (val.call(self, this[i], i))
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
            while(true) {
                elem = fn.call(this, elem)
                if (elem instanceof Ci.nsIDOMElement)
                    res[res.length++] = elem;
                else if (elem && "length" in elem)
                    for (let i = 0; i < tmp.length; i++)
                        res[res.length++] = tmp[j];
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
            if (isObject(tmp) && "length" in tmp)
                for (let j = 0; j < tmp.length; j++)
                    res[res.length++] = tmp[j];
            else if (tmp !== undefined)
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

    get parent() this.map(function (elem) elem.parentNode, this),

    get offsetParent() this.map(function (elem) {
        do {
            var parent = elem.offsetParent;
            if (parent instanceof Ci.nsIDOMElement && DOM(parent).position != "static")
                return parent;
        }
        while (parent);
    }, this),

    get ancestors() this.all(function (elem) elem.parentNode),

    get children() this.map(function (elem) Array.filter(elem.childNodes,
                                                         function (e) e instanceof Ci.nsIDOMElement),
                            this),

    get contents() this.map(function (elem) elem.childNodes, this),

    get siblings() this.map(function (elem) Array.filter(elem.parentNode.childNodes,
                                                         function (e) e != elem && e instanceof Ci.nsIDOMElement),
                            this),

    get siblingsBefore() this.all(function (elem) elem.previousElementSibling),
    get siblingsAfter() this.all(function (elem) elem.nextElementSibling),

    get class() let (self = this) ({
        toString: function () self[0].className,

        get list() Array.slice(self[0].classList),
        set list(val) self.attr("class", val.join(" ")),

        each: function each(meth, arg) {
            return self.each(function (elem) {
                elem.classList[meth](arg);
            })
        },

        add: function add(cls) this.each("add", cls),
        remove: function remove(cls) this.each("remove", cls),
        toggle: function toggle(cls, val) this.each(val == null ? "toggle" : val ? "add" : "remove", cls),

        has: function has(cls) this[0].classList.has(cls)
    }),

    get highlight() let (self = this) ({
        toString: function () self.attrNS(NS, "highlight") || "",

        get list() this.toString().trim().split(/\s+/),
        set list(val) self.attrNS(NS, "highlight", val.join(" ")),

        has: function has(hl) ~this.list.indexOf(hl),

        add: function add(hl) self.each(function () {
            highlight.loaded[hl] = true;
            this.attrNS(NS, "highlight",
                        array.uniq(this.highlight.list.concat(hl)).join(" "));
        }),

        remove: function remove(hl) self.each(function () {
            this.attrNS(NS, "highlight",
                        this.highlight.list.filter(function (h) h != hl));
        }),

        toggle: function toggle(hl, val) self.each(function () {
            let { highlight } = this;
            highlight[val == null ? highlight.has(hl) : val ? "remove" : "add"](hl)
        }),
    }),

    get rect() this[0].getBoundingClientRect(),

    get viewport() {
        let r = this.rect;
        return {
            width: this[0].clientWidth,
            height: this[0].clientHeight,
            top: r.top + this[0].scrollTop + this[0].clientTop,
            get bottom() this.top + this.height,
            left: r.left + this[0].scrollLeft + this[0].clientLeft,
            get right() this.left + this.width
        }
    },

    /**
     * Returns true if the given DOM node is currently visible.
     * @returns {boolean}
     */
    get isVisible() {
        let style = this.style;
        return style.visibility == "visible" && style.display != "none";
    },

    get editor() {
        if (!this.length)
            return;

        this[0] instanceof Ci.nsIDOMNSEditableElement;
        if (this[0].editor instanceof Ci.nsIEditor)
            return this[0].editor;

        try {
            return this[0].QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
                          .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIEditingSession)
                          .getEditorForWindow(this[0]);
        }
        catch (e) {}

        return null;
    },

    get isEditable() !!this.editor,

    get isInput() this[0] instanceof Ci.nsIDOMHTMLInputElement && this.isEditable,

    /**
     * Returns an object representing a Node's computed CSS style.
     * @returns {Object}
     */
    get style() {
        let node = this[0];
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
        for each (let cs in form.acceptCharset.split(/\s*,\s*|\s+/)) {
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
                        || elem.checked && /^(?:checkbox|radio)$/.test(elem.type))
                    elems.push(encode(elem.name, elem.value, elem === field));
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
        XML.ignoreWhitespace = XML.prettyPrinting = false;

        function namespaced(node) {
            var ns = DOM.namespaceNames[node.namespaceURI] || /^(?:(.*?):)?/.exec(node.name)[0];
            if (!ns)
                return node.localName;
            if (color)
                return <><span highlight="HelpXMLNamespace">{ns}</span>{node.localName}</>
            return ns + ":" + node.localName;
        }

        let res = [];
        this.each(function (elem) {
            try {
                let hasChildren = elem.firstChild && (!/^\s*$/.test(elem.firstChild) || elem.firstChild.nextSibling)
                if (color)
                    res.push(<span highlight="HelpXML"><span highlight="HelpXMLTagStart">&lt;{
                            namespaced(elem)} {
                                template.map(array.iterValues(elem.attributes),
                                    function (attr)
                                        <span highlight="HelpXMLAttribute">{namespaced(attr)}</span> +
                                        <span highlight="HelpXMLString">{attr.value}</span>,
                                    <> </>)
                            }{ !hasChildren ? "/>" : ">"
                        }</span>{ !hasChildren ? "" : <>...</> +
                            <span highlight="HtmlTagEnd">&lt;{namespaced(elem)}></span>
                    }</span>);
                else {
                    let tag = "<" + [namespaced(elem)].concat(
                        [namespaced(a) + "=" + template.highlight(a.value, true)
                         for ([i, a] in array.iterItems(elem.attributes))]).join(" ");

                    res.push(tag + (!hasChildren ? "/>" : ">...</" + namespaced(elem) + ">"));
                }
            }
            catch (e) {
                res.push({}.toString.call(elem));
            }
        }, this);
        return template.map(res, util.identity, <>,</>);
    },

    attr: function attr(key, val) {
        return this.attrNS("", key, val);
    },

    attrNS: function attrNS(ns, key, val) {
        if (val !== undefined)
            key = array.toObject([[key, val]]);

        let hooks = this.attrHooks[ns] || {};

        if (isObject(key))
            return this.each(function (elem) {
                for (let [k, v] in Iterator(key)) {
                    if (callable(v))
                        v = v.call(this, elem, i);

                    if (Set.has(hooks, k) && hooks[k].set)
                        hooks[k].set.call(this, elem, v, k);
                    else if (v == null)
                        elem.removeAttributeNS(ns, k);
                    else
                        elem.setAttributeNS(ns, k, v);
                }
            });

        if (!this.length)
            return null;

        if (Set.has(hooks, key) && hooks[key].get)
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
        name: function (property) property.replace(/[A-Z]/g, function (m0) "-" + m0.toLowerCase()),

        property: function (name) name.replace(/-(.)/g, function (m0, m1) m1.toUpperCase())
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

    toggle: function toggle(val, self) {
        if (callable(val))
            return this.each(function (elem, i) {
                this[val.call(self || this, elem, i) ? "show" : "hide"]();
            });

        if (arguments.length)
            return this[val ? "show" : "hide"]();

        let hidden = this.map(function (elem) elem.style.display == "none");
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

    getSet: function getSet(args, get, set) {
        if (!args.length)
            return this[0] && get.call(this, this[0]);

        let [fn, self] = args;
        if (!callable(fn))
            fn = function () args[0];

        return this.each(function (elem, i) {
            set.call(this, elem, fn.call(self || this, elem, i));
        }, this);
    },

    html: function html(txt, self) {
        return this.getSet(arguments,
                           function (elem) elem.innerHTML,
                           function (elem, val) { elem.innerHTML = val });
    },

    text: function text(txt, self) {
        return this.getSet(arguments,
                           function (elem) elem.textContent,
                           function (elem, val) { elem.textContent = val });
    },

    val: function val(txt) {
        return this.getSet(arguments,
                           function (elem) elem.value,
                           function (elem, val) { elem.value = val == null ? "" : val });
    },

    listen: function listen(event, listener, capture) {
        if (isObject(event))
            capture = listener;
        else
            event = array.toObject([[event, listener]]);

        for (let [k, v] in Iterator(event))
            event[k] = util.wrapCallback(v, true);

        return this.each(function (elem) {
            for (let [k, v] in Iterator(event))
                elem.addEventListener(k, v, capture);
        });
    },
    unlisten: function unlisten(event, listener, capture) {
        if (isObject(event))
            capture = listener;
        else
            event = array.toObject([[key, val]]);

        return this.each(function (elem) {
            for (let [k, v] in Iterator(event))
                elem.removeEventListener(k, v.wrapper || v, capture);
        });
    },

    dispatch: function dispatch(event, params, extraProps) {
        this.canceled = false;
        return this.each(function (elem) {
            let evt = DOM.Event(this.document, event, params);
            if (!DOM.Event.dispatch(elem, evt, extraProps))
                this.canceled = true;
        }, this);
    },

    focus: function focus(arg, extra) {
        if (callable(arg))
            return this.listen("focus", arg, extra);
        services.focus.setFocus(this[0], extra || services.focus.FLAG_BYMOUSE);
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
            let rect = this.rect;

            let force = false;
            if (rect)
                for (let parent in this.ancestors.items) {
                    if (!parent[0].clientWidth || !parent[0].clientHeight)
                        continue;

                    let isect = util.intersection(rect, parent.viewport);

                    if (parent[0].clientWidth < rect.width && isect.width ||
                        parent[0].clientHeight < rect.height && isect.height)
                        continue;

                    force = Math.round(isect.width - rect.width) || Math.round(isect.height - rect.height);
                    if (force)
                        break;
                }

            let win = this.document.defaultView;

            if (force || !(rect && rect.bottom <= win.innerHeight && rect.top >= 0 && rect.left < win.innerWidth && rect.right > 0))
                elem.scrollIntoView(alignWithTop !== undefined ? alignWithTop :
                                    rect.bottom < 0            ? true         :
                                    rect.top > win.innerHeight ? false
                                                               : Math.abs(rect.top) < Math.abs(win.innerHeight - rect.bottom));
        });
    },
}, {
    /**
     * Creates an actual event from a pseudo-event object.
     *
     * The pseudo-event object (such as may be retrieved from events.fromString)
     * should have any properties you want the event to have.
     *
     * @param {Document} doc The DOM document to associate this event with
     * @param {Type} type The type of event (keypress, click, etc.)
     * @param {Object} opts The pseudo-event. @optional
     */
    Event: Class("Event", {
        init: function Event(doc, type, opts) {
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
                    screenX: 0, screenY: 0,
                    clientX: 0, clientY: 0,
                    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
                    button: 0,
                    relatedTarget: null
                }
            };

            opts = opts || {};
            var t = this.constructor.types[type];
            var evt = doc.createEvent((t || "HTML") + "Events");

            let defaults = DEFAULTS[t || "HTML"];
            update(defaults, this.constructor.defaults[type]);

            let args = Object.keys(defaults)
                             .map(function (k) k in opts ? opts[k] : defaults[k])

            evt["init" + t + "Event"].apply(evt, args);
            return evt;
        }
    }, {
        defaults: {
            load:   { bubbles: false },
            submit: { cancelable: true }
        },

        types: Class.Memoize(function () iter(
            {
                Mouse: "click mousedown mouseout mouseover mouseup " +
                       "popupshowing popupshown popuphiding popuphidden",
                Key:   "keydown keypress keyup",
                "":    "change command dactyl-input input submit " +
                       "load unload pageshow pagehide DOMContentLoaded"
            }
        ).map(function ([k, v]) v.split(" ").map(function (v) [v, k]))
         .flatten()
         .toObject()),

        /**
         * Dispatches an event to an element as if it were a native event.
         *
         * @param {Node} target The DOM node to which to dispatch the event.
         * @param {Event} event The event to dispatch.
         */
        dispatch: Class.Memoize(function ()
            config.haveGecko("2b")
                ? function dispatch(target, event, extra) {
                    try {
                        this.feedingEvent = extra;

                        if (target instanceof Ci.nsIDOMElement)
                            // This causes a crash on Gecko<2.0, it seems.
                            return (target.ownerDocument || target.document || target).defaultView
                                   .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils)
                                   .dispatchDOMEventViaPresShell(target, event, true);
                        else {
                            target.dispatchEvent(event);
                            return !event.getPreventDefault();
                        }
                    }
                    catch (e) {
                        util.reportError(e);
                    }
                    finally {
                        this.feedingEvent = null;
                    }
                }
                : function dispatch(target, event, extra) {
                    try {
                        this.feedingEvent = extra;
                        target.dispatchEvent(update(event, extra));
                    }
                    finally {
                        this.feedingEvent = null;
                    }
                })
    }),

    /**
     * The set of input element type attribute values that mark the element as
     * an editable field.
     */
    editableInputs: Set(["date", "datetime", "datetime-local", "email", "file",
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
                    for (let [, elem] in iter(node.querySelectorAll(matcher.css)))
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
        let evaluator = services.XPathEvaluator();
        let node = services.XMLDocument();
        return this.testValues(list, function (value) {
            if (/^xpath:/.test(value))
                evaluator.createExpression(value.substr(6), DOM.XPath.resolver);
            else
                node.querySelector(value);
            return true;
        });
    },

    /**
     * Converts HTML special characters in *str* to the equivalent HTML
     * entities.
     *
     * @param {string} str
     * @returns {string}
     */
    escapeHTML: function escapeHTML(str) {
        let map = { "'": "&apos;", '"': "&quot;", "%": "&#x25;", "&": "&amp;", "<": "&lt;", ">": "&gt;" };
        return str.replace(/['"&<>]/g, function (m) map[m]);
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
    fromXML: function fromXML(node, doc, nodes) {
        XML.prettyPrinting = false;
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
     * @returns {Object} Iterable result of the evaluation.
     */
    XPath: update(
        function XPath(expression, elem, asIterator) {
            try {
                let doc = elem.ownerDocument || elem;

                if (isArray(expression))
                    expression = DOM.makeXPath(expression);

                let result = doc.evaluate(expression, elem,
                    XPath.resolver,
                    asIterator ? Ci.nsIDOMXPathResult.ORDERED_NODE_ITERATOR_TYPE : Ci.nsIDOMXPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                    null
                );

                return Object.create(result, {
                    __iterator__: {
                        value: asIterator ? function () { let elem; while ((elem = this.iterateNext())) yield elem; }
                                          : function () { for (let i = 0; i < this.snapshotLength; i++) yield this.snapshotItem(i); }
                    }
                });
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
                           .map(function (node) /^[a-z]+:/.test(node) ? node : [node, "xhtml:" + node]).flatten()
                           .map(function (node) "//" + node).join(" | ");
    },

    namespaces: {
        xul: XUL.uri,
        xhtml: XHTML.uri,
        html: XHTML.uri,
        xhtml2: "http://www.w3.org/2002/06/xhtml2",
        dactyl: NS.uri
    },

    namespaceNames: Class.Memoize(function ()
        iter(this.namespaces).map(function ([k, v]) [v, k]).toObject()),
});

Object.keys(DOM.Event.types).forEach(function (event) {
    DOM.prototype[event.replace(/-(.)/g, function (m, m1) m1.toUpperCase())] =
        function _event(arg, extra) {
            return this[callable(arg) ? "listen" : "dispatch"](event, arg, extra);
        };
});

var $ = DOM;

endModule();

// catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set sw=4 ts=4 et ft=javascript:
