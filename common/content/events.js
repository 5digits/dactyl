// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/**
 * A hive used mainly for tracking event listeners and cleaning them up when a
 * group is destroyed.
 */
var EventHive = Class("EventHive", Contexts.Hive, {
    init: function init(group) {
        init.supercall(this, group);
        this.sessionListeners = [];
    },

    cleanup: function cleanup() {
        this.unlisten(null);
    },

    _events: function _events(event, callback) {
        if (!isObject(event))
            var [self, events] = [null, array.toObject([[event, callback]])];
        else
            [self, events] = [event, event[callback || "events"]];

        if (hasOwnProperty(events, "input") && !hasOwnProperty(events, "dactyl-input"))
            events["dactyl-input"] = events.input;

        return [self, events];
    },

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
        var [self, events] = this._events(event, callback);

        for (let [event, callback] in Iterator(events)) {
            let args = [util.weakReference(target),
                        util.weakReference(self),
                        event,
                        this.wrapListener(callback, self),
                        capture,
                        allowUntrusted];

            target.addEventListener.apply(target, args.slice(2));
            this.sessionListeners.push(args);
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
        if (target != null)
            var [self, events] = this._events(event, callback);

        this.sessionListeners = this.sessionListeners.filter(function (args) {
            let elem = args[0].get();
            if (target == null || elem == target
                               && self == args[1].get()
                               && hasOwnProperty(events, args[2])
                               && args[3].wrapped == events[args[2]]
                               && args[4] == capture) {

                elem.removeEventListener.apply(elem, args.slice(2));
                return false;
            }
            return elem;
        });
    },

    get wrapListener() events.bound.wrapListener
});

/**
 * @instance events
 */
var Events = Module("events", {
    dbg: function () {},

    init: function () {
        this.keyEvents = [];

        overlay.overlayWindow(window, {
            append: [
                ["window", { id: document.documentElement.id, xmlns: "xul" },
                    // http://developer.mozilla.org/en/docs/XUL_Tutorial:Updating_Commands
                    ["commandset", { id: "dactyl-onfocus", commandupdater: "true", events: "focus",
                                     commandupdate: this.bound.onFocusChange }],
                    ["commandset", { id: "dactyl-onselect", commandupdater: "true", events: "select",
                                     commandupdate: this.bound.onSelectionChange }]]]
        });

        this._fullscreen = window.fullScreen;
        this._lastFocus = { get: function () null };
        this._macroKeys = [];
        this._lastMacro = "";

        this._macros = storage.newMap("registers", { privateData: true, store: true });
        if (storage.exists("macros")) {
            for (let [k, m] in storage.newMap("macros", { store: true }))
                this._macros.set(k, { text: m.keys, timestamp: m.timeRecorded * 1000 });
            storage.remove("macros");
        }

        this.popups = {
            active: [],

            activeMenubar: null,

            update: function update(elem) {
                if (elem) {
                    if (elem instanceof Ci.nsIAutoCompletePopup
                            || elem.localName == "tooltip"
                            || !elem.popupBoxObject)
                        return;

                    if (!~this.active.indexOf(elem))
                        this.active.push(elem);
                }

                this.active = this.active.filter(e => e.popupBoxObject && e.popupBoxObject.popupState != "closed");

                if (!this.active.length && !this.activeMenubar)
                    modes.remove(modes.MENU, true);
                else if (modes.main != modes.MENU)
                    modes.push(modes.MENU);
            },

            events: {
                DOMMenuBarActive: function onDOMMenuBarActive(event) {
                    this.activeMenubar = event.target;
                    if (modes.main != modes.MENU)
                        modes.push(modes.MENU);
                },

                DOMMenuBarInactive: function onDOMMenuBarInactive(event) {
                    this.activeMenubar = null;
                    modes.remove(modes.MENU, true);
                },

                popupshowing: function onPopupShowing(event) {
                    this.update(event.originalTarget);
                },

                popupshown: function onPopupShown(event) {
                    let elem = event.originalTarget;
                    this.update(elem);

                    if (elem instanceof Ci.nsIAutoCompletePopup) {
                        if (modes.main != modes.AUTOCOMPLETE)
                            modes.push(modes.AUTOCOMPLETE);
                    }
                    else if (elem.hidePopup && elem.localName !== "tooltip"
                                && Events.isHidden(elem)
                                && Events.isHidden(elem.parentNode)) {
                        elem.hidePopup();
                    }
                },

                popuphidden: function onPopupHidden(event) {
                    this.update();
                    modes.remove(modes.AUTOCOMPLETE);
                }
            }
        };

        this.listen(window, this, "events", true);
        this.listen(window, this.popups, "events", true);

        this.grabFocus = 0;
        this.grabFocusTimer = Timer(100, 10000, () => {
            this.grabFocus = 0;
        });
    },

    cleanup: function cleanup() {
        let elem = dactyl.focusedElement;
        if (DOM(elem).isEditable)
            util.trapErrors("removeEditActionListener",
                            DOM(elem).editor, editor);
    },

    signals: {
        "browser.locationChange": function (webProgress, request, uri) {
            options.get("passkeys").flush();
        },
        "modes.change": function (oldMode, newMode) {
            delete this.processor;
        }
    },

    get listen() this.builtin.bound.listen,
    addSessionListener: deprecated("events.listen", { get: function addSessionListener() this.listen }),

    /**
     * Wraps an event listener to ensure that errors are reported.
     */
    wrapListener: function wrapListener(method, self=this) {
        method.wrapper = wrappedListener;
        wrappedListener.wrapped = method;
        function wrappedListener(event) {
            try {
                method.apply(self, arguments);
            }
            catch (e) {
                dactyl.reportError(e);
                if (e.message == "Interrupted")
                    dactyl.echoerr(_("error.interrupted"), commandline.FORCE_SINGLELINE);
                else
                    dactyl.echoerr(_("event.error", event.type, e.echoerr || e),
                                   commandline.FORCE_SINGLELINE);
            }
        };
        return wrappedListener;
    },

    /**
     * @property {boolean} Whether synthetic key events are currently being
     *     processed.
     */
    feedingKeys: false,

    /**
     * Initiates the recording of a key event macro.
     *
     * @param {string} macro The name for the macro.
     */
    _recording: null,
    get recording() this._recording,

    set recording(macro) {
        dactyl.assert(macro == null || /[a-zA-Z0-9]/.test(macro),
                      _("macro.invalid", macro));

        modes.recording = macro;

        if (/[A-Z]/.test(macro)) { // Append.
            macro = macro.toLowerCase();
            this._macroKeys = DOM.Event.iterKeys(editor.getRegister(macro))
                                 .toArray();
        }
        else if (macro) { // Record afresh.
            this._macroKeys = [];
        }
        else if (this.recording) { // Save.
            editor.setRegister(this.recording, this._macroKeys.join(""));

            dactyl.log(_("macro.recorded", this.recording, this._macroKeys.join("")), 9);
            dactyl.echomsg(_("macro.recorded", this.recording));
        }
        this._recording = macro || null;
    },

    /**
     * Replays a macro.
     *
     * @param {string} The name of the macro to replay.
     * @returns {boolean}
     */
    playMacro: function (macro) {
        dactyl.assert(/^[a-zA-Z0-9@]$/.test(macro),
                      _("macro.invalid", macro));

        if (macro == "@")
            dactyl.assert(this._lastMacro, _("macro.noPrevious"));
        else
            this._lastMacro = macro.toLowerCase(); // XXX: sets last played macro, even if it does not yet exist

        let keys = editor.getRegister(this._lastMacro);
        if (keys)
            return modes.withSavedValues(["replaying"], function () {
                this.replaying = true;
                return events.feedkeys(keys, { noremap: true });
            });

        // TODO: ignore this like Vim?
        dactyl.echoerr(_("macro.noSuch", this._lastMacro));
        return false;
    },

    /**
     * Returns all macros matching *filter*.
     *
     * @param {string} filter A regular expression filter string. A null
     *     filter selects all macros.
     */
    getMacros: function (filter) {
        let re = RegExp(filter || "");
        return ([k, m.text] for ([k, m] in editor.registers) if (re.test(k)));
    },

    /**
     * Deletes all macros matching *filter*.
     *
     * @param {string} filter A regular expression filter string. A null
     *     filter deletes all macros.
     */
    deleteMacros: function (filter) {
        let re = RegExp(filter || "");
        for (let [item, ] in editor.registers) {
            if (!filter || re.test(item))
                editor.registers.remove(item);
        }
    },

    /**
     * Feeds a list of events to *target* or the originalTarget member
     * of each event if *target* is null.
     *
     * @param {EventTarget} target The destination node for the events.
     *      @optional
     * @param {[Event]} list The events to dispatch.
     * @param {object} extra Extra properties for processing by dactyl.
     *      @optional
     */
    feedevents: function feedevents(target, list, extra) {
        list.forEach(function _feedevent(event, i) {
            let elem = target || event.originalTarget;
            if (elem) {
                let doc = elem.ownerDocument || elem.document || elem;
                let evt = DOM.Event(doc, event.type, event);
                DOM.Event.dispatch(elem, evt, extra);
            }
            else if (i > 0 && event.type === "keypress")
                events.events.keypress.call(events, event);
        });
    },

    /**
     * Pushes keys onto the event queue from dactyl. It is similar to
     * Vim's feedkeys() method, but cannot cope with 2 partially-fed
     * strings, you have to feed one parseable string.
     *
     * @param {string} keys A string like "2<C-f>" to push onto the event
     *     queue. If you want "<" to be taken literally, prepend it with a
     *     "\\".
     * @param {boolean} noremap Whether recursive mappings should be
     *     disallowed.
     * @param {boolean} silent Whether the command should be echoed to the
     *     command line.
     * @returns {boolean}
     */
    feedkeys: function (keys, noremap, quiet, mode) {
        try {
            var savedEvents = this._processor && this._processor.keyEvents;

            var wasFeeding = this.feedingKeys;
            this.feedingKeys = true;

            var wasQuiet = commandline.quiet;
            if (quiet)
                commandline.quiet = quiet;

            for (let [, evt_obj] in Iterator(DOM.Event.parse(keys))) {
                let now = Date.now();
                let key = DOM.Event.stringify(evt_obj);
                for (let type in values(["keydown", "keypress", "keyup"])) {
                    let evt = update({}, evt_obj, { type: type });
                    if (type !== "keypress" && !evt.keyCode)
                        evt.keyCode = evt._keyCode || 0;

                    if (isObject(noremap))
                        update(evt, noremap);
                    else
                        evt.noremap = !!noremap;
                    evt.isMacro = true;
                    evt.dactylMode = mode;
                    evt.dactylSavedEvents = savedEvents;
                    DOM.Event.feedingEvent = evt;

                    let doc = document.commandDispatcher.focusedWindow.document;

                    let target = dactyl.focusedElement
                              || ["complete", "interactive"].indexOf(doc.readyState) >= 0 && doc.documentElement
                              || doc.defaultView;

                    if (target instanceof Element && !Events.isInputElement(target) &&
                        ["<Return>", "<Space>"].indexOf(key) == -1)
                        target = target.ownerDocument.documentElement;

                    let event = DOM.Event(doc, type, evt);
                    if (!evt_obj.dactylString && !mode)
                        DOM.Event.dispatch(target, event, evt);
                    else if (type === "keypress")
                        events.events.keypress.call(events, event);
                }

                if (!this.feedingKeys)
                    return false;
            }
        }
        catch (e) {
            util.reportError(e);
        }
        finally {
            DOM.Event.feedingEvent = null;
            this.feedingKeys = wasFeeding;
            if (quiet)
                commandline.quiet = wasQuiet;
            dactyl.triggerObserver("events.doneFeeding");
        }
        return true;
    },

    canonicalKeys: deprecated("DOM.Event.canonicalKeys", { get: function canonicalKeys() DOM.Event.bound.canonicalKeys }),
    create:        deprecated("DOM.Event", function create() DOM.Event.apply(null, arguments)),
    dispatch:      deprecated("DOM.Event.dispatch", function dispatch() DOM.Event.dispatch.apply(DOM.Event, arguments)),
    fromString:    deprecated("DOM.Event.parse", { get: function fromString() DOM.Event.bound.parse }),
    iterKeys:      deprecated("DOM.Event.iterKeys", { get: function iterKeys() DOM.Event.bound.iterKeys }),

    toString: function toString() {
        if (!arguments.length)
            return toString.supercall(this);

        deprecated.warn(toString, "toString", "DOM.Event.stringify");
        return DOM.Event.stringify.apply(DOM.Event, arguments);
    },

    get defaultTarget() dactyl.focusedElement || content.document.body || document.documentElement,

    /**
     * Returns true if there's a known native key handler for the given
     * event in the given mode.
     *
     * @param {Event} event A keypress event.
     * @param {Modes.Mode} mode The main mode.
     * @param {boolean} passUnknown Whether unknown keys should be passed.
     */
    hasNativeKey: function hasNativeKey(event, mode, passUnknown) {
        if (mode.input && event.charCode && !(event.ctrlKey || event.metaKey))
            return true;

        if (!passUnknown)
            return false;

        var elements = document.getElementsByTagNameNS(XUL, "key");
        var filters = [];

        if (event.keyCode)
            filters.push(["keycode", this._code_nativeKey[event.keyCode]]);
        if (event.charCode) {
            let key = String.fromCharCode(event.charCode);
            filters.push(["key", key.toUpperCase()],
                         ["key", key.toLowerCase()]);
        }

        let accel = config.OS.isMacOSX ? "metaKey" : "ctrlKey";

        let access = iter({ 1: "shiftKey", 2: "ctrlKey", 4: "altKey", 8: "metaKey" })
                        .filter(function ([k, v]) this & k,
                                prefs.get("ui.key.chromeAccess"))
                        .map(([k, v]) => [v, true])
                        .toObject();

    outer:
        for (let [, key] in iter(elements))
            if (filters.some(([k, v]) => key.getAttribute(k) == v)) {
                let keys = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
                let needed = { ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey };

                let modifiers = (key.getAttribute("modifiers") || "").trim().split(/[\s,]+/);
                for (let modifier in values(modifiers))
                    switch (modifier) {
                    case "access": update(keys, access); break;
                    case "accel":  keys[accel] = true; break;
                    default:       keys[modifier + "Key"] = true; break;
                    case "any":
                        if (!iter.some(keys, ([k, v]) => v && needed[k]))
                            continue outer;
                        for (let [k, v] in iter(keys)) {
                            if (v)
                                needed[k] = false;
                            keys[k] = false;
                        }
                        break;
                    }

                if (iter(needed).every(([k, v]) => (v == keys[k])))
                    return key;
            }

        return false;
    },

    /**
     * Returns true if *key* is a key code defined to accept/execute input on
     * the command line.
     *
     * @param {string} key The key code to test.
     * @returns {boolean}
     */
    isAcceptKey: function (key) key == "<Return>" || key == "<C-j>" || key == "<C-m>",

    /**
     * Returns true if *key* is a key code defined to reject/cancel input on
     * the command line.
     *
     * @param {string} key The key code to test.
     * @returns {boolean}
     */
    isCancelKey: function (key) key == "<Esc>" || key == "<C-[>" || key == "<C-c>",

    /**
     * Returns true if *node* belongs to the current content document or any
     * sub-frame thereof.
     *
     * @param {Node|Document|Window} node The node to test.
     * @returns {boolean}
     */
    isContentNode: function isContentNode(node) {
        let win = (node.ownerDocument || node).defaultView || node;
        return XPCNativeWrapper(win).top == content;
    },

    /**
     * Waits for the current buffer to successfully finish loading. Returns
     * true for a successful page load otherwise false.
     *
     * @returns {boolean}
     */
    waitForPageLoad: function (time) {
        if (buffer.loaded)
            return true;

        dactyl.echo(_("macro.loadWaiting"), commandline.FORCE_SINGLELINE);

        const maxWaitTime = (time || 25);
        util.waitFor(() => buffer.loaded, this,
                     maxWaitTime * 1000, true);

        dactyl.echo("", commandline.FORCE_SINGLELINE);
        if (!buffer.loaded)
            dactyl.echoerr(_("macro.loadFailed", maxWaitTime));

        return buffer.loaded;
    },

    /**
     * Ensures that the currently focused element is visible and blurs
     * it if it's not.
     */
    checkFocus: function () {
        if (dactyl.focusedElement) {
            let rect = dactyl.focusedElement.getBoundingClientRect();
            if (!rect.width || !rect.height) {
                services.focus.clearFocus(window);
                document.commandDispatcher.focusedWindow = content;
                // onFocusChange needs to die.
                this.onFocusChange();
            }
        }
    },

    events: {
        blur: function onBlur(event) {
            let elem = event.originalTarget;
            if (DOM(elem).editor)
                util.trapErrors("removeEditActionListener",
                                DOM(elem).editor, editor);

            if (elem instanceof Window && services.focus.activeWindow == null
                && document.commandDispatcher.focusedWindow !== window) {
                // Deals with circumstances where, after the main window
                // blurs while a collapsed frame has focus, re-activating
                // the main window does not restore focus and we lose key
                // input.
                services.focus.clearFocus(window);
                document.commandDispatcher.focusedWindow = Editor.getEditor(content) ? window : content;
            }

            let hold = modes.topOfStack.params.holdFocus;
            if (elem == hold) {
                dactyl.focus(hold);
                this.timeout(function () { dactyl.focus(hold); });
            }
        },

        // TODO: Merge with onFocusChange
        focus: function onFocus(event) {
            let elem = event.originalTarget;
            if (DOM(elem).editor)
                util.trapErrors("addEditActionListener",
                                DOM(elem).editor, editor);

            if (elem == window)
                overlay.activeWindow = window;

            overlay.setData(elem, "had-focus", true);
            if (event.target instanceof Ci.nsIDOMXULTextBoxElement)
                if (Events.isHidden(elem, true))
                    elem.blur();

            let win = (elem.ownerDocument || elem).defaultView || elem;

            if (!(services.focus.getLastFocusMethod(win) & 0x3000)
                && events.isContentNode(elem)
                && !buffer.focusAllowed(elem)
                && isinstance(elem, [Ci.nsIDOMHTMLInputElement,
                                     Ci.nsIDOMHTMLSelectElement,
                                     Ci.nsIDOMHTMLTextAreaElement,
                                     Ci.nsIDOMWindow])) {
                if (this.grabFocus++ > 5)
                    ; // Something is fighting us. Give up.
                else {
                    this.grabFocusTimer.tell();
                    if (elem.frameElement)
                        dactyl.focusContent(true);
                    else if (!(elem instanceof Window) || Editor.getEditor(elem))
                        dactyl.focus(window);
                }
            }

            if (elem instanceof Element)
                delete overlay.getData(elem)["focus-allowed"];
        },

        /*
        onFocus: function onFocus(event) {
            let elem = event.originalTarget;
            if (!(elem instanceof Element))
                return;
            let win = elem.ownerDocument.defaultView;

            try {
                util.dump(elem, services.focus.getLastFocusMethod(win) & (0x7000));
                if (buffer.focusAllowed(win))
                    win.dactylLastFocus = elem;
                else if (isinstance(elem, [HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement])) {
                    if (win.dactylLastFocus)
                        dactyl.focus(win.dactylLastFocus);
                    else
                        elem.blur();
                }
            }
            catch (e) {
                util.dump(win, String(elem.ownerDocument), String(elem.ownerDocument && elem.ownerDocument.defaultView));
                util.reportError(e);
            }
        },
        */

        input: function onInput(event) {
            event.originalTarget.dactylKeyPress = undefined;
        },

        // this keypress handler gets always called first, even if e.g.
        // the command-line has focus
        // TODO: ...help me...please...
        keypress: function onKeyPress(event) {
            event.dactylDefaultPrevented = event.defaultPrevented;

            let duringFeed = this.duringFeed || [];
            this.duringFeed = [];
            try {
                let ourEvent = DOM.Event.feedingEvent;
                DOM.Event.feedingEvent = null;
                if (ourEvent)
                    for (let [k, v] in Iterator(ourEvent))
                        if (!(k in event))
                            event[k] = v;

                let key = DOM.Event.stringify(ourEvent || event);
                event.dactylString = key;

                // Hack to deal with <BS> and so forth not dispatching input
                // events
                if (key && event.originalTarget instanceof Ci.nsIDOMHTMLInputElement && !modes.main.passthrough) {
                    let elem = event.originalTarget;
                    elem.dactylKeyPress = elem.value;
                    util.timeout(function () {
                        if (elem.dactylKeyPress !== undefined && elem.value !== elem.dactylKeyPress)
                            DOM(elem).dactylInput();
                        elem.dactylKeyPress = undefined;
                    });
                }

                if (!key)
                     return null;

                if (modes.recording && !event.isReplay)
                    events._macroKeys.push(key);

                // feedingKeys needs to be separate from interrupted so
                // we can differentiate between a recorded <C-c>
                // interrupting whatever it's started and a real <C-c>
                // interrupting our playback.
                if (events.feedingKeys && !event.isMacro) {
                    if (key == "<C-c>") {
                        events.feedingKeys = false;
                        if (modes.replaying) {
                            modes.replaying = false;
                            this.timeout(function () { dactyl.echomsg(_("macro.canceled", this._lastMacro)); }, 100);
                        }
                    }
                    else
                        duringFeed.push(event);

                    return Events.kill(event);
                }

                if (this.processor)
                    events.dbg("ON KEYPRESS " + key + " processor: " + this.processor,
                               event.originalTarget instanceof Element ? event.originalTarget : String(event.originalTarget));
                else {
                    let mode = modes.getStack(0);
                    if (event.dactylMode)
                        mode = Modes.StackElement(event.dactylMode);

                    let ignore = false;

                    if (mode.main == modes.PASS_THROUGH)
                        ignore = !Events.isEscape(key) && key != "<C-v>";
                    else if (mode.main == modes.QUOTE) {
                        if (modes.getStack(1).main == modes.PASS_THROUGH) {
                            mode = Modes.StackElement(modes.getStack(2).main);
                            ignore = Events.isEscape(key);
                        }
                        else if (events.shouldPass(event))
                            mode = Modes.StackElement(modes.getStack(1).main);
                        else
                            ignore = true;

                        modes.pop();
                    }
                    else if (!event.isMacro && !event.noremap && events.shouldPass(event))
                        ignore = true;

                    events.dbg("\n\n");
                    events.dbg("ON KEYPRESS " + key + " ignore: " + ignore,
                               event.originalTarget instanceof Element ? event.originalTarget : String(event.originalTarget));

                    if (ignore)
                        return null;

                    // FIXME: Why is this hard coded? --Kris
                    if (key == "<C-c>")
                        util.interrupted = true;

                    this.processor = ProcessorStack(mode, mappings.hives.array, event.noremap);
                    this.processor.keyEvents = this.keyEvents;
                }

                let { keyEvents, processor } = this;
                this._processor = processor;
                this.processor = null;
                this.keyEvents = [];

                if (!processor.process(event)) {
                    this.keyEvents = keyEvents;
                    this.processor = processor;
                }

            }
            catch (e) {
                dactyl.reportError(e);
            }
            finally {
                [duringFeed, this.duringFeed] = [this.duringFeed, duringFeed];
                if (this.feedingKeys)
                    this.duringFeed = this.duringFeed.concat(duringFeed);
                else
                    for (let event in values(duringFeed))
                        try {
                            DOM.Event.dispatch(event.originalTarget, event, event);
                        }
                        catch (e) {
                            util.reportError(e);
                        }
            }
        },

        keyup: function onKeyUp(event) {
            if (event.type == "keydown")
                this.keyEvents.push(event);
            else if (!this.processor)
                this.keyEvents = [];

            let pass = this.passing && !event.isMacro ||
                    DOM.Event.feedingEvent && DOM.Event.feedingEvent.isReplay ||
                    event.isReplay ||
                    modes.main == modes.PASS_THROUGH ||
                    modes.main == modes.QUOTE
                        && modes.getStack(1).main !== modes.PASS_THROUGH
                        && !this.shouldPass(event) ||
                    !modes.passThrough && this.shouldPass(event) ||
                    !this.processor && event.type === "keydown"
                        && options.get("passunknown").getKey(modes.main.allBases)
                        && let (key = DOM.Event.stringify(event))
                            !(modes.main.count && /^\d$/.test(key) ||
                              modes.main.allBases.some(
                                mode => mappings.hives
                                                .some(hive => hive.get(mode, key)
                                                           || hive.getCandidates(mode, key))));

            events.dbg("ON " + event.type.toUpperCase() + " " + DOM.Event.stringify(event) +
                       " passing: " + this.passing + " " +
                       " pass: " + pass +
                       " replay: " + event.isReplay +
                       " macro: " + event.isMacro);

            if (event.type === "keydown")
                this.passing = pass;

            // Prevents certain sites from transferring focus to an input box
            // before we get a chance to process our key bindings on the
            // "keypress" event.
            if (!pass)
                event.stopPropagation();
        },
        keydown: function onKeyDown(event) {
            if (!event.isMacro)
                this.passing = false;
            this.events.keyup.call(this, event);
        },

        mousedown: function onMouseDown(event) {
            let elem = event.target;
            let win = elem.ownerDocument && elem.ownerDocument.defaultView || elem;

            for (; win; win = win != win.parent && win.parent) {
                for (; elem instanceof Element; elem = elem.parentNode)
                    overlay.setData(elem, "focus-allowed", true);
                overlay.setData(win.document, "focus-allowed", true);
            }
        },

        resize: function onResize(event) {
            if (window.fullScreen != this._fullscreen) {
                statusline.statusBar.removeAttribute("moz-collapsed");
                this._fullscreen = window.fullScreen;
                dactyl.triggerObserver("fullscreen", this._fullscreen);
                autocommands.trigger("Fullscreen", { url: this._fullscreen ? "on" : "off", state: this._fullscreen });
            }
            statusline.updateZoomLevel();
        }
    },

    // argument "event" is deliberately not used, as i don't seem to have
    // access to the real focus target
    // Huh? --djk
    onFocusChange: util.wrapCallback(function onFocusChange(event) {
        function hasHTMLDocument(win) win && win.document && win.document instanceof Ci.nsIDOMHTMLDocument
        if (dactyl.ignoreFocus)
            return;

        let win  = window.document.commandDispatcher.focusedWindow;
        let elem = window.document.commandDispatcher.focusedElement;

        if (elem == null && Editor.getEditor(win))
            elem = win;

        if (win && win.top == content && dactyl.has("tabs"))
            buffer.focusedFrame = win;

        try {
            if (elem && elem.readOnly)
                return;

            if (isinstance(elem, [Ci.nsIDOMHTMLEmbedElement, Ci.nsIDOMHTMLEmbedElement])) {
                if (!modes.main.passthrough && modes.main != modes.EMBED)
                    modes.push(modes.EMBED);
                return;
            }

            let haveInput = modes.stack.some(m => m.main.input);

            if (DOM(elem || win).isEditable) {
                let e = elem || win;
                if (!(e instanceof Ci.nsIDOMWindow &&
                        DOM(e.document.activeElement).style.MozUserModify != "read-write")) {
                    if (!haveInput)
                        if (!isinstance(modes.main, [modes.INPUT, modes.TEXT_EDIT, modes.VISUAL]))
                            if (options["insertmode"])
                                modes.push(modes.INSERT);
                            else {
                                modes.push(modes.TEXT_EDIT);
                                if (elem.selectionEnd - elem.selectionStart > 0)
                                    modes.push(modes.VISUAL);
                            }

                    if (hasHTMLDocument(win))
                        buffer.lastInputField = elem || win;
                    return;
                }
            }

            if (elem && Events.isInputElement(elem)) {
                if (!haveInput)
                    modes.push(modes.INSERT);

                if (hasHTMLDocument(win))
                    buffer.lastInputField = elem;
                return;
            }

            if (config.focusChange) {
                config.focusChange(win);
                return;
            }

            let urlbar = document.getElementById("urlbar");
            if (elem == null && urlbar && urlbar.inputField == this._lastFocus.get())
                util.threadYield(true); // Why? --Kris

            while (modes.main.ownsFocus
                    && let ({ ownsFocus } = modes.topOfStack.params)
                         (!ownsFocus ||
                             ownsFocus.get() != elem &&
                             ownsFocus.get() != win)
                    && !modes.topOfStack.params.holdFocus)
                 modes.pop(null, { fromFocus: true });
        }
        finally {
            this._lastFocus = util.weakReference(elem);

            if (modes.main.ownsFocus)
                modes.topOfStack.params.ownsFocus = util.weakReference(elem);
        }
    }),

    onSelectionChange: function onSelectionChange(event) {
        // Ignore selection events caused by editor commands.
        if (editor.inEditMap || modes.main == modes.OPERATOR)
            return;

        let controller = document.commandDispatcher.getControllerForCommand("cmd_copy");
        let couldCopy = controller && controller.isCommandEnabled("cmd_copy");

        if (couldCopy) {
            if (modes.main == modes.TEXT_EDIT)
                modes.push(modes.VISUAL);
            else if (modes.main == modes.CARET)
                modes.push(modes.VISUAL);
        }
    },

    shouldPass: function shouldPass(event)
        !event.noremap && (!dactyl.focusedElement || events.isContentNode(dactyl.focusedElement)) &&
        options.get("passkeys").has(DOM.Event.stringify(event))
}, {
    ABORT: {},
    KILL: true,
    PASS: false,
    PASS_THROUGH: {},
    WAIT: null,

    isEscape: function isEscape(event)
        let (key = isString(event) ? event : DOM.Event.stringify(event))
            key === "<Esc>" || key === "<C-[>",

    isHidden: function isHidden(elem, aggressive) {
        if (DOM(elem).style.visibility !== "visible")
            return true;

        if (aggressive)
            for (let e = elem; e instanceof Element; e = e.parentNode) {
                if (!/set$/.test(e.localName) && e.boxObject && e.boxObject.height === 0)
                    return true;
                else if (e.namespaceURI == XUL && e.localName === "panel")
                    break;
            }
        return false;
    },

    isInputElement: function isInputElement(elem) {
        return elem instanceof Ci.nsIDOMElement && DOM(elem).isEditable ||
               isinstance(elem, [Ci.nsIDOMHTMLEmbedElement,
                                 Ci.nsIDOMHTMLObjectElement,
                                 Ci.nsIDOMHTMLSelectElement]);
    },

    kill: function kill(event) {
        event.stopPropagation();
        event.preventDefault();
    }
}, {
    contexts: function initContexts(dactyl, modules, window) {
        update(Events.prototype, {
            hives: contexts.Hives("events", EventHive),
            user: contexts.hives.events.user,
            builtin: contexts.hives.events.builtin
        });
    },

    commands: function initCommands() {
        commands.add(["delmac[ros]"],
            "Delete macros",
            function (args) {
                dactyl.assert(!args.bang || !args[0], _("error.invalidArgument"));

                if (args.bang)
                    events.deleteMacros();
                else if (args[0])
                    events.deleteMacros(args[0]);
                else
                    dactyl.echoerr(_("error.argumentRequired"));
            }, {
                argCount: "?",
                bang: true,
                completer: function (context) completion.macro(context),
                literal: 0
            });

        commands.add(["mac[ros]"],
            "List all macros",
            function (args) { completion.listCompleter("macro", args[0]); }, {
                argCount: "?",
                completer: function (context) completion.macro(context)
            });
    },
    completion: function initCompletion() {
        completion.macro = function macro(context) {
            context.title = ["Macro", "Keys"];
            context.completions = [item for (item in events.getMacros())];
        };
    },
    mappings: function initMappings() {

        mappings.add([modes.MAIN],
            ["<A-b>", "<pass-next-key-builtin>"], "Process the next key as a builtin mapping",
            function () {
                events.processor = ProcessorStack(modes.getStack(0), mappings.hives.array, true);
                events.processor.keyEvents = events.keyEvents;
            });

        mappings.add([modes.MAIN],
            ["<C-z>", "<pass-all-keys>"], "Temporarily ignore all " + config.appName + " key bindings",
            function () {
                if (modes.main != modes.PASS_THROUGH)
                    modes.push(modes.PASS_THROUGH);
            });

        mappings.add([modes.MAIN, modes.PASS_THROUGH, modes.QUOTE],
            ["<C-v>", "<pass-next-key>"], "Pass through next key",
            function () {
                if (modes.main == modes.QUOTE)
                    return Events.PASS;
                modes.push(modes.QUOTE);
            });

        mappings.add([modes.BASE],
            ["<CapsLock>"], "Do Nothing",
            function () {});

        mappings.add([modes.BASE],
            ["<Nop>"], "Do nothing",
            function () {});

        mappings.add([modes.BASE],
            ["<Pass>"], "Pass the events consumed by the last executed mapping",
            function ({ keypressEvents: [event] }) {
                dactyl.assert(event.dactylSavedEvents,
                              _("event.nothingToPass"));
                return function () {
                    events.feedevents(null, event.dactylSavedEvents,
                                      { skipmap: true, isMacro: true, isReplay: true });
                };
            });

        // macros
        mappings.add([modes.COMMAND],
            ["q", "<record-macro>"], "Record a key sequence into a macro",
            function ({ arg }) {
                util.assert(arg == null || /^[a-z]$/i.test(arg));
                events._macroKeys.pop();
                events.recording = arg;
            },
            { get arg() !modes.recording });

        mappings.add([modes.COMMAND],
            ["@", "<play-macro>"], "Play a macro",
            function ({ arg, count }) {
                count = Math.max(count, 1);
                while (count--)
                    events.playMacro(arg);
            },
            { arg: true, count: true });

        mappings.add([modes.COMMAND],
            ["<A-m>s", "<sleep>"], "Sleep for {count} milliseconds before continuing macro playback",
            function ({ command, count }) {
                let now = Date.now();
                dactyl.assert(count, _("error.countRequired", command));
                if (events.feedingKeys)
                    util.sleep(count);
            },
            { count: true });

        mappings.add([modes.COMMAND],
            ["<A-m>l", "<wait-for-page-load>"], "Wait for the current page to finish loading before continuing macro playback",
            function ({ count }) {
                if (events.feedingKeys && !events.waitForPageLoad(count)) {
                    util.interrupted = true;
                    throw Error("Interrupted");
                }
            },
            { count: true });
    },
    options: function initOptions() {
        const Hive = Class("Hive", {
            init: function init(values, map) {
                this.name = "passkeys:" + map;
                this.stack = MapHive.Stack(values.map(v => Map(v[map + "Keys"])));
                function Map(keys) ({
                    execute: function () Events.PASS_THROUGH,
                    keys: keys
                });
            },

            get active() this.stack.length,

            get: function get(mode, key) this.stack.mappings[key],

            getCandidates: function getCandidates(mode, key) this.stack.candidates[key]
        });
        options.add(["passkeys", "pk"],
            "Pass certain keys through directly for the given URLs",
            "sitemap", "", {
                flush: function flush() {
                    memoize(this, "filters", function () this.value.filter(function (f) f(buffer.documentURI)));
                    memoize(this, "pass", function () RealSet(array.flatten(this.filters.map(function (f) f.keys))));
                    memoize(this, "commandHive", function hive() Hive(this.filters, "command"));
                    memoize(this, "inputHive", function hive() Hive(this.filters, "input"));
                },

                has: function (key) this.pass.has(key) || hasOwnProperty(this.commandHive.stack.mappings, key),

                get pass() (this.flush(), this.pass),

                parse: function parse() {
                    let value = parse.superapply(this, arguments);
                    value.forEach(function (filter) {
                        let vals = Option.splitList(filter.result);
                        filter.keys = DOM.Event.parse(vals[0]).map(DOM.Event.bound.stringify);

                        filter.commandKeys = vals.slice(1).map(DOM.Event.bound.canonicalKeys);
                        filter.inputKeys = filter.commandKeys.filter(bind("test", /^<[ACM]-/));
                    });
                    return value;
                },

                keepQuotes: true,

                setter: function (value) {
                    this.flush();
                    return value;
                }
            });

        options.add(["strictfocus", "sf"],
            "Prevent scripts from focusing input elements without user intervention",
            "sitemap", "'chrome:*':laissez-faire,*:moderate",
            {
                values: {
                    despotic: "Only allow focus changes when explicitly requested by the user",
                    moderate: "Allow focus changes after user-initiated focus change",
                    "laissez-faire": "Always allow focus changes"
                }
            });

        options.add(["timeout", "tmo"],
            "Whether to execute a shorter key command after a timeout when a longer command exists",
            "boolean", true);

        options.add(["timeoutlen", "tmol"],
            "Maximum time (milliseconds) to wait for a longer key command when a shorter one exists",
            "number", 1000);
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
