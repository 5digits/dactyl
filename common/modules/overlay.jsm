// Copyright (c) 2009-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

defineModule("overlay", {
    exports: ["overlay"],
    require: ["util"]
});

lazyRequire("highlight", ["highlight"]);

var getAttr = function getAttr(elem, ns, name)
    elem.hasAttributeNS(ns, name) ? elem.getAttributeNS(ns, name) : null;
var setAttr = function setAttr(elem, ns, name, val) {
    if (val == null)
        elem.removeAttributeNS(ns, name);
    else
        elem.setAttributeNS(ns, name, val);
};

var Overlay = Class("Overlay", {
    init: function init(window) {
        this.window = window;
    },

    cleanups: Class.Memoize(() => []),
    objects: Class.Memoize(() => ({})),

    get doc() this.window.document,

    get win() this.window,

    $: function $(sel, node) DOM(sel, node || this.doc),

    cleanup: function cleanup(window, reason) {
        for (let fn in values(this.cleanups))
            util.trapErrors(fn, this, window, reason);
    }
});

var Overlay = Module("Overlay", XPCOM([Ci.nsIObserver, Ci.nsISupportsWeakReference]), {
    init: function init() {
        util.addObserver(this);
        this.overlays = {};

        this.weakMap = WeakMap();

        this.onWindowVisible = [];
    },

    id: Class.Memoize(() => config.addon.id),

    /**
     * Adds an event listener for this session and removes it on
     * dactyl shutdown.
     *
     * @param {Element} target The element on which to listen.
     * @param {string} event The event to listen for.
     * @param {function} callback The function to call when the event is received.
     * @param {boolean} capture When true, listen during the capture
     *      phase, otherwise during the bubbling phase.
     * @param {boolean} allowUntrusted When true, allow capturing of
     *      untrusted events.
     */
    listen: function (target, event, callback, capture, allowUntrusted) {
        let doc = target.ownerDocument || target.document || target;
        let listeners = this.getData(doc, "listeners");

        if (!isObject(event))
            var [self, events] = [null, array.toObject([[event, callback]])];
        else
            [self, events] = [event, event[callback || "events"]];

        for (let [event, callback] in Iterator(events)) {
            let args = [util.weakReference(target),
                        event,
                        util.wrapCallback(callback, self),
                        capture,
                        allowUntrusted];

            target.addEventListener.apply(target, args.slice(1));
            listeners.push(args);
        }
    },

    /**
     * Remove an event listener.
     *
     * @param {Element} target The element on which to listen.
     * @param {string} event The event to listen for.
     * @param {function} callback The function to call when the event is received.
     * @param {boolean} capture When true, listen during the capture
     *      phase, otherwise during the bubbling phase.
     */
    unlisten: function (target, event, callback, capture) {
        let doc = target.ownerDocument || target.document || target;
        let listeners = this.getData(doc, "listeners");
        if (event === true)
            target = null;

        this.setData(doc, "listeners", listeners.filter(function (args) {
            let elem = args[0].get();
            if (target == null || elem == target && args[1] == event && args[2].wrapped == callback && args[3] == capture) {
                elem.removeEventListener.apply(elem, args.slice(1));
                return false;
            }
            return elem;
        }));
    },

    cleanup: function cleanup(reason) {
        for (let doc in util.iterDocuments()) {
            for (let callback in values(this.getData(doc, "cleanup")))
                util.trapErrors(callback, doc, reason);

            for (let elem in values(this.getData(doc, "overlayElements")))
                if (elem.parentNode)
                    elem.parentNode.removeChild(elem);

            for (let [elem, ns, name, orig, value] in values(this.getData(doc, "overlayAttributes")))
                if (getAttr(elem, ns, name) === value)
                    setAttr(elem, ns, name, orig);

            this.unlisten(doc, true);

            delete doc[this.id];
            delete doc.defaultView[this.id];
        }
    },

    observers: {
        "toplevel-window-ready": function (window, data) {
            let listener = util.wrapCallback(function listener(event) {
                if (event.originalTarget === window.document) {
                    window.removeEventListener("DOMContentLoaded", listener.wrapper, true);
                    window.removeEventListener("load", listener.wrapper, true);
                    overlay._loadOverlays(window);
                }
            });

            window.addEventListener("DOMContentLoaded", listener, true);
            window.addEventListener("load", listener, true);
        },
        "chrome-document-global-created": function (window, uri) { this.observe(window, "toplevel-window-ready", null); },
        "content-document-global-created": function (window, uri) { this.observe(window, "toplevel-window-ready", null); },
        "xul-window-visible": function () {
            if (this.onWindowVisible)
                this.onWindowVisible.forEach(f => { f.call(this); });
            this.onWindowVisible = null;
        }
    },

    getData: function getData(obj, key, constructor) {

        if (!this.weakMap.has(obj))
            try {
                this.weakMap.set(obj, {});
            }
            catch (e if e instanceof TypeError) {
                // util.dump("Bad WeakMap key: " + obj + " " + Components.stack.caller);
                let { id } = this;

                if (!(id in obj && obj[id]))
                    obj[id] = {};

                var data = obj[id];
            }

        data = data || this.weakMap.get(obj);

        if (arguments.length == 1)
            return data;

        if (data[key] === undefined)
            if (constructor === undefined || callable(constructor))
                data[key] = (constructor || Array)();
            else
                data[key] = constructor;

        return data[key];
    },

    setData: function setData(obj, key, val) {
        let data = this.getData(obj);
        if (val !== undefined)
            return data[key] = val;

        delete data[key];
    },

    overlayWindow: function overlayWindow(url, fn) {
        if (url instanceof Ci.nsIDOMWindow)
            overlay._loadOverlay(url, fn);
        else {
            Array.concat(url).forEach(function (url) {
                if (!this.overlays[url])
                    this.overlays[url] = [];
                this.overlays[url].push(fn);
            }, this);

            for (let doc in util.iterDocuments())
                if (~["interactive", "complete"].indexOf(doc.readyState)) {
                    this.observe(doc.defaultView, "xul-window-visible");
                    this._loadOverlays(doc.defaultView);
                }
                else {
                    if (!this.onWindowVisible)
                        this.onWindowVisible = [];
                    this.observe(doc.defaultView, "toplevel-window-ready");
                }
        }
    },

    _loadOverlays: function _loadOverlays(window) {
        let overlays = this.getData(window, "overlays");

        for (let obj of overlay.overlays[window.document.documentURI] || []) {
            if (~overlays.indexOf(obj))
                continue;
            overlays.push(obj);
            this._loadOverlay(window, obj(window));
        }
    },

    _loadOverlay: function _loadOverlay(window, obj) {
        let doc = window.document;
        let savedElems = this.getData(doc, "overlayElements");
        let savedAttrs = this.getData(doc, "overlayAttributes");

        function insert(key, fn) {
            if (obj[key]) {
                let iterator = Iterator(obj[key]);
                if (isArray(obj[key])) {
                    iterator = ([elem[1].id, elem.slice(2), elem[1]]
                                for each (elem in obj[key]));
                }

                for (let [elem, xml, attrs] in iterator) {
                    if (elem = doc.getElementById(String(elem))) {
                        // Urgh. Hack.
                        let namespaces;
                        if (attrs)
                            namespaces = iter([k.slice(6), DOM.fromJSON.namespaces[v] || v]
                                              for ([k, v] in Iterator(attrs))
                                              if (/^xmlns(?:$|:)/.test(k))).toObject();

                        let node = DOM.fromJSON(xml, doc, obj.objects, namespaces);

                        if (!(node instanceof Ci.nsIDOMDocumentFragment))
                            savedElems.push(node);
                        else
                            for (let n in array.iterValues(node.childNodes))
                                savedElems.push(n);

                        fn(elem, node);

                        for (let attr in attrs || []) {
                            let [ns, localName] = DOM.parseNamespace(attr);
                            let name = attr;
                            let val = attrs[attr];

                            savedAttrs.push([elem, ns, name, getAttr(elem, ns, name), val]);
                            if (name === "highlight")
                                highlight.highlightNode(elem, val);
                            else
                                elem.setAttributeNS(ns || "", name, val);
                        }
                    }
                }
            }
        }

        insert("before", (elem, dom) => elem.parentNode.insertBefore(dom, elem));
        insert("after", (elem, dom) => elem.parentNode.insertBefore(dom, elem.nextSibling));
        insert("append", (elem, dom) => elem.appendChild(dom));
        insert("prepend", (elem, dom) => elem.insertBefore(dom, elem.firstChild));
        if (obj.ready)
            util.trapErrors("ready", obj, window);

        function load(event) {
            util.trapErrors("load", obj, window, event);
            if (obj.visible)
                if (!event || !overlay.onWindowVisible || window != util.topWindow(window))
                    util.trapErrors("visible", obj, window);
                else
                    overlay.onWindowVisible.push(function () { obj.visible(window) });
        }

        if (obj.load)
            if (doc.readyState === "complete")
                load();
            else
                window.addEventListener("load", util.wrapCallback(function onLoad(event) {
                    if (event.originalTarget === doc) {
                        window.removeEventListener("load", onLoad.wrapper, true);
                        load(event);
                    }
                }), true);

        if (obj.unload || obj.cleanup)
            this.listen(window, "unload", function unload(event) {
                if (event.originalTarget === doc) {
                    overlay.unlisten(window, "unload", unload);
                    if (obj.unload)
                        util.trapErrors("unload", obj, window, event);

                    if (obj.cleanup)
                        util.trapErrors("cleanup", obj, window, "unload", event);
                }
            });

        if (obj.cleanup)
            this.getData(doc, "cleanup").push(bind("cleanup", obj, window));
    },

    /**
     * Overlays an object with the given property overrides. Each
     * property in *overrides* is added to *object*, replacing any
     * original value. Functions in *overrides* are augmented with the
     * new properties *super*, *supercall*, and *superapply*, in the
     * same manner as class methods, so that they may call their
     * overridden counterparts.
     *
     * @param {object} object The object to overlay.
     * @param {object} overrides An object containing properties to
     *      override.
     * @returns {function} A function which, when called, will remove
     *      the overlay.
     */
    overlayObject: function (object, overrides) {
        let original = Object.create(object);
        overrides = update(Object.create(original), overrides);

        Object.getOwnPropertyNames(overrides).forEach(function (k) {
            let desc = Object.getOwnPropertyDescriptor(overrides, k);

            if (desc.value instanceof Class.Property)
                desc = desc.value.init(k) || desc.value;

            if (k in object) {
                for (let obj = object; obj && !orig; obj = Object.getPrototypeOf(obj)) {
                    var orig = Object.getOwnPropertyDescriptor(obj, k);
                    if (orig)
                        Object.defineProperty(original, k, orig);
                }

                if (!orig) {
                    orig = Object.getPropertyDescriptor(object, k);
                    if (orig)
                        Object.defineProperty(original, k, orig);
                }
            }

            // Guard against horrible add-ons that use eval-based monkey
            // patching.
            let value = desc.value;
            if (callable(desc.value)) {

                delete desc.value;
                delete desc.writable;
                desc.get = function get() value;
                desc.set = function set(val) {
                    if (!callable(val) || !Function.prototype.toString(val).contains(sentinel))
                        Class.replaceProperty(this, k, val);
                    else {
                        let package_ = util.newURI(Components.stack.caller.filename).host;
                        util.reportError(Error(_("error.monkeyPatchOverlay", package_)));
                        util.dactyl.echoerr(_("error.monkeyPatchOverlay", package_));
                    }
                };
            }

            try {
                Object.defineProperty(object, k, desc);

                if (callable(value)) {
                    var sentinel = "(function DactylOverlay() {}())";
                    value.toString = function toString() toString.toString.call(this).replace(/\}?$/, sentinel + "; $&");
                    value.toSource = function toSource() toSource.toSource.call(this).replace(/\}?$/, sentinel + "; $&");
                }
            }
            catch (e) {
                try {
                    if (value) {
                        object[k] = value;
                        return;
                    }
                }
                catch (f) {}
                util.reportError(e);
            }
        }, this);

        return function unwrap() {
            for (let k of Object.getOwnPropertyNames(original))
                if (Object.getOwnPropertyDescriptor(object, k).configurable)
                    Object.defineProperty(object, k, Object.getOwnPropertyDescriptor(original, k));
                else {
                    try {
                        object[k] = original[k];
                    }
                    catch (e) {}
                }
        };
    },

    get activeModules() this.activeWindow && this.activeWindow.dactyl.modules,

    get modules() [w.dactyl.modules for (w of this.windows)],

    /**
     * The most recently active dactyl window.
     */
    get activeWindow() {
        let win = this._activeWindow && this._activeWindow.get();
        return this.windows.has(win) && win;
    },

    set activeWindow(win) this._activeWindow = util.weakReference(win),

    /**
     * A list of extant dactyl windows.
     */
    windows: Class.Memoize(() => RealSet())
});

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
