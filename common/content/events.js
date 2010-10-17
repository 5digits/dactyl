// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/**
 * @instance events
 */
const Events = Module("events", {
    init: function () {
        const self = this;

        this._fullscreen = window.fullScreen;
        this._lastFocus = null;
        this._currentMacro = "";
        this._lastMacro = "";

        this.sessionListeners = [];

        this._macros = storage.newMap("macros", { privateData: true, store: true });
        for (let [k, m] in this._macros)
            if (isString(m))
                m = { keys: m, timeRecorded: Date.now() };

        // NOTE: the order of ["Esc", "Escape"] or ["Escape", "Esc"]
        //       matters, so use that string as the first item, that you
        //       want to refer to within dactyl's source code for
        //       comparisons like if (key == "<Esc>") { ... }
        this._keyTable = {
            add: ["Plus", "Add"],
            back_space: ["BS"],
            delete: ["Del"],
            escape: ["Esc", "Escape"],
            insert: ["Insert", "Ins"],
            left_shift: ["LT", "<"],
            return: ["Return", "CR", "Enter"],
            right_shift: [">"],
            space: ["Space", " "],
            subtract: ["Minus", "Subtract"]
        };

        this._code_key = {};
        this._key_code = {};

        for (let [k, v] in Iterator(KeyEvent)) {
            k = k.substr(7).toLowerCase();
            let names = [k.replace(/(^|_)(.)/g, function (m, n1, n2) n2.toUpperCase())
                          .replace(/^NUMPAD/, "k")];
            if (k in this._keyTable)
                names = this._keyTable[k];
            this._code_key[v] = names[0];
            for (let [, name] in Iterator(names))
                this._key_code[name.toLowerCase()] = v;
        }

        // HACK: as Gecko does not include an event for <, we must add this in manually.
        if (!("<" in this._key_code)) {
            this._key_code["<"] = 60;
            this._key_code["lt"] = 60;
            this._code_key[60] = "lt";
        }

        this._input = {
            buffer: "",             // partial command storage
            pendingMotionMap: null, // e.g. "d{motion}" if we wait for a motion of the "d" command
            pendingArgMap: null,    // pending map storage for commands like m{a-z}
            count: null             // parsed count from the input buffer
        };

        this._activeMenubar = false;
        this.addSessionListener(window, "DOMMenuBarActive", this.closure.onDOMMenuBarActive, true);
        this.addSessionListener(window, "DOMMenuBarInactive", this.closure.onDOMMenuBarInactive, true);
        this.addSessionListener(window, "focus", this.wrapListener(this.onFocus), true);
        this.addSessionListener(window, "keydown", this.wrapListener(this.onKeyUpOrDown), true);
        this.addSessionListener(window, "keypress", this.wrapListener(this.onKeyPress), true);
        this.addSessionListener(window, "keyup", this.wrapListener(this.onKeyUpOrDown), true);
        this.addSessionListener(window, "mousedown", this.wrapListener(this.onMouseDown), true);
        this.addSessionListener(window, "popuphidden", this.closure.onPopupHidden, true);
        this.addSessionListener(window, "popupshown", this.closure.onPopupShown, true);
        this.addSessionListener(window, "resize", this.closure.onResize, true);
    },

    destroy: function () {
        util.dump("Removing all event listeners");
        for (let args in values(this.sessionListeners))
            if (args[0].get())
                args[0].get().removeEventListener.apply(args[0].get(), args.slice(1));
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
     */
    addSessionListener: function (target, event, callback, capture) {
        let args = Array.slice(arguments, 0);
        args[0].addEventListener.apply(args[0], args.slice(1));
        args[0] = Cu.getWeakReference(args[0]);
        this.sessionListeners.push(args);
    },

    /**
     * Wraps an event listener to ensure that errors are reported.
     */
    wrapListener: function wrapListener(method, self) {
        self = self || this;
        return function wrappedListener(event) {
            try {
                method.apply(self, arguments);
            }
            catch (e) {
                dactyl.reportError(e);
                if (e.message == "Interrupted")
                    dactyl.echoerr("Interrupted");
                else
                    dactyl.echoerr("Processing " + event.type + " event: " + (e.echoerr || e));
            }
        };
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
    startRecording: function (macro) {
        // TODO: ignore this like Vim?
        dactyl.assert(/[a-zA-Z0-9]/.test(macro),
                      "E354: Invalid register name: '" + macro + "'");

        modes.isRecording = true;

        if (/[A-Z]/.test(macro)) { // uppercase (append)
            this._currentMacro = macro.toLowerCase();
            if (!this._macros.get(this._currentMacro))
                this._macros.set(this._currentMacro, { keys: "", timeRecorded: Date.now() }); // initialize if it does not yet exist
        }
        else {
            this._currentMacro = macro;
            this._macros.set(this._currentMacro, { keys: "", timeRecorded: Date.now() });
        }
    },

    /**
     * Replays a macro.
     *
     * @param {string} The name of the macro to replay.
     * @returns {boolean}
     */
    playMacro: function (macro) {
        let res = false;
        if (!/[a-zA-Z0-9@]/.test(macro) && macro.length == 1) {
            dactyl.echoerr("E354: Invalid register name: '" + macro + "'");
            return false;
        }

        if (macro == "@") { // use lastMacro if it's set
            if (!this._lastMacro) {
                dactyl.echoerr("E748: No previously used register");
                return false;
            }
        }
        else
            this._lastMacro = macro.toLowerCase(); // XXX: sets last played macro, even if it does not yet exist

        if (this._macros.get(this._lastMacro)) {
            // make sure the page is stopped before starting to play the macro
            try {
                window.getWebNavigation().stop(nsIWebNavigation.STOP_ALL);
            }
            catch (e) {}

            buffer.loaded = 1; // even if not a full page load, assume it did load correctly before starting the macro
            modes.isReplaying = true;
            res = events.feedkeys(this._macros.get(this._lastMacro).keys, { noremap: true });
            modes.isReplaying = false;
        }
        else
            // TODO: ignore this like Vim?
            dactyl.echoerr("Exxx: Register '" + this._lastMacro + "' not set");
        return res;
    },

    /**
     * Returns all macros matching <b>filter</b>.
     *
     * @param {string} filter A regular expression filter string. A null
     *     filter selects all macros.
     */
    getMacros: function (filter) {
        let re = RegExp(filter || "");
        return ([k, m.keys] for ([k, m] in events._macros) if (re.test(k)));
    },

    /**
     * Deletes all macros matching <b>filter</b>.
     *
     * @param {string} filter A regular expression filter string. A null
     *     filter deletes all macros.
     */
    deleteMacros: function (filter) {
        let re = RegExp(filter || "");
        for (let [item, ] in this._macros) {
            if (!filter || re.test(item))
                this._macros.remove(item);
        }
    },

    /**
     * Pushes keys onto the event queue from dactyl. It is similar to
     * Vim's feedkeys() method, but cannot cope with 2 partially-fed
     * strings, you have to feed one parsable string.
     *
     * @param {string} keys A string like "2<C-f>" to push onto the event
     *     queue. If you want "<" to be taken literally, prepend it with a
     *     "\\".
     * @param {boolean} noremap Allow recursive mappings.
     * @param {boolean} silent Whether the command should be echoed to the
     *     command line.
     * @returns {boolean}
     */
    feedkeys: function (keys, noremap, quiet) {
        let doc = window.document;
        let view = window.document.defaultView;

        let wasFeeding = this.feedingKeys;
        this.feedingKeys = true;
        this.duringFeed = this.duringFeed || [];
        let wasQuiet = commandline.quiet;
        if (quiet)
            commandline.quiet = quiet;

        try {
            util.threadYield(1, true);

            for (let [, evt_obj] in Iterator(events.fromString(keys))) {
                let elem = dactyl.focus || window.content;
                let evt = events.create(doc, "keypress", evt_obj);

                if (typeof noremap == "object")
                    for (let [k, v] in Iterator(noremap))
                        evt[k] = v;
                else
                    evt.noremap = !!noremap;
                evt.isMacro = true;
                // A special hack for dactyl-specific key names.
                if (evt_obj.dactylString || evt_obj.dactylShift) {
                    evt.dactylString = evt_obj.dactylString; // for key-less keypress events e.g. <Nop>
                    evt.dactylShift = evt_obj.dactylShift; // for untypeable shift keys e.g. <S-1>
                    events.onKeyPress(evt);
                }

                else
                    elem.dispatchEvent(evt);

                if (!this.feedingKeys)
                    break;

                // Stop feeding keys if page loading failed.
                if (modes.isReplaying && !this.waitForPageLoad())
                    break;
            }
        }
        finally {
            this.feedingKeys = wasFeeding;
            if (quiet)
                commandline.quiet = wasQuiet;

            if (this.duringFeed.length) {
                let duringFeed = this.duringFeed;
                this.duringFeed = [];
                for (let [, evt] in Iterator(duringFeed))
                    evt.target.dispatchEvent(evt);
            }
        }
    },

    /**
     * Creates an actual event from a pseudo-event object.
     *
     * The pseudo-event object (such as may be retrieved from events.fromString)
     * should have any properties you want the event to have.
     *
     * @param {Document} doc The DOM document to associate this event with
     * @param {Type} type The type of event (keypress, click, etc.)
     * @param {Object} opts The pseudo-event.
     */
    create: function (doc, type, opts) {
        var DEFAULTS = {
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
        const TYPES = {
            click: "Mouse", mousedown: "Mouse", mouseup: "Mouse",
            mouseover: "Mouse", mouseout: "Mouse",
            keypress: "Key", keyup: "Key", keydown: "Key"
        };
        var t = TYPES[type];
        var evt = doc.createEvent(t + "Events");
        evt["init" + t + "Event"].apply(evt,
                [v for ([k, v] in Iterator(util.extend(DEFAULTS[t], opts)))]);
        return evt;
    },

    /**
     * Converts a user-input string of keys into a canonical
     * representation.
     *
     * <C-A> maps to <C-a>, <C-S-a> maps to <C-S-A>
     * <C- > maps to <C-Space>, <S-a> maps to A
     * << maps to <lt><lt>
     *
     * <S-@> is preserved, as in vim, to allow untypeable key-combinations
     * in macros.
     *
     * canonicalKeys(canonicalKeys(x)) == canonicalKeys(x) for all values
     * of x.
     *
     * @param {string} keys Messy form.
     * @returns {string} Canonical form.
     */
    canonicalKeys: function (keys) {
        return events.fromString(keys).map(events.closure.toString).join("");
    },

    /**
     * Converts an event string into an array of pseudo-event objects.
     *
     * These objects can be used as arguments to events.toString or
     * events.create, though they are unlikely to be much use for other
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
     * @returns {Array[Object]}
     */
    fromString: function (input, unknownOk) {
        let out = [];

        let re = RegExp("<.*?>?>|[^<]|<(?!.*>)", "g");
        let match;
        while ((match = re.exec(input))) {
            let evt_str = match[0];
            let evt_obj = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
                            keyCode: 0, charCode: 0, type: "keypress" };

            if (evt_str.length > 1) { // <.*?>
                let [match, modifier, keyname] = evt_str.match(/^<((?:[CSMA]-)*)(.+?)>$/i) || [false, '', ''];
                modifier = modifier.toUpperCase();
                keyname = keyname.toLowerCase();
                evt_obj.dactylKeyname = keyname;

                if (keyname && !(keyname.length == 1 && modifier.length == 0 || // disallow <> and <a>
                    !(unknownOk || keyname.length == 1 || this._key_code[keyname] || keyname == "nop" || /mouse$/.test(keyname)))) { // disallow <misteak>
                    evt_obj.ctrlKey  = /C-/.test(modifier);
                    evt_obj.altKey   = /A-/.test(modifier);
                    evt_obj.shiftKey = /S-/.test(modifier);
                    evt_obj.metaKey  = /M-/.test(modifier);

                    if (keyname.length == 1) { // normal characters
                        if (evt_obj.shiftKey) {
                            keyname = keyname.toUpperCase();
                            if (keyname == keyname.toLowerCase())
                                evt_obj.dactylShift = true;
                        }

                        evt_obj.charCode = keyname.charCodeAt(0);
                    }
                    else if (keyname == "nop") {
                        evt_obj.dactylString = "<Nop>";
                    }
                    else if (/mouse$/.test(keyname)) { // mouse events
                        evt_obj.type = (/2-/.test(modifier) ? "dblclick" : "click");
                        evt_obj.button = ["leftmouse", "middlemouse", "rightmouse"].indexOf(keyname);
                        delete evt_obj.keyCode;
                        delete evt_obj.charCode;
                    }
                    else { // spaces, control characters, and <
                        evt_obj.keyCode = this._key_code[keyname];
                        evt_obj.charCode = 0;
                    }
                }
                else { // an invalid sequence starting with <, treat as a literal
                    out = out.concat(events.fromString("<lt>" + evt_str.substr(1)));
                    continue;
                }
            }
            else // a simple key (no <...>)
                evt_obj.charCode = evt_str.charCodeAt(0);

            // TODO: make a list of characters that need keyCode and charCode somewhere
            if (evt_obj.keyCode == 32 || evt_obj.charCode == 32)
                evt_obj.charCode = evt_obj.keyCode = 32; // <Space>
            if (evt_obj.keyCode == 60 || evt_obj.charCode == 60)
                evt_obj.charCode = evt_obj.keyCode = 60; // <lt>

            out.push(evt_obj);
        }
        return out;
    },

    /**
     * Converts the specified event to a string in dactyl key-code
     * notation. Returns null for an unknown event.
     *
     * E.g. pressing ctrl+n would result in the string "<C-n>".
     *
     * @param {Event} event
     * @returns {string}
     */
    toString: function toString(event) {
        if (!event)
            return "[instance events]";

        if (event.dactylString)
            return event.dactylString;

        let key = null;
        let modifier = "";

        if (event.ctrlKey)
            modifier += "C-";
        if (event.altKey)
            modifier += "A-";
        if (event.metaKey)
            modifier += "M-";

        if (/^key/.test(event.type)) {
            let charCode = event.type == "keyup" ? 0 : event.charCode;
            if (charCode == 0) {
                if (event.shiftKey)
                    modifier += "S-";

                if (event.keyCode in this._code_key)
                    key = this._code_key[event.keyCode];
            }
            // [Ctrl-Bug] special handling of mysterious <C-[>, <C-\\>, <C-]>, <C-^>, <C-_> bugs (OS/X)
            //            (i.e., cntrl codes 27--31)
            // ---
            // For more information, see:
            //     [*] Vimp FAQ: http://vimperator.org/trac/wiki/Pentadactyl/FAQ#WhydoesntC-workforEscMacOSX
            //     [*] Referenced mailing list msg: http://www.mozdev.org/pipermail/pentadactyl/2008-May/001548.html
            //     [*] Mozilla bug 416227: event.charCode in keypress handler has unexpected values on Mac for Ctrl with chars in "[ ] _ \"
            //         https://bugzilla.mozilla.org/show_bug.cgi?query_format=specific&order=relevance+desc&bug_status=__open__&id=416227
            //     [*] Mozilla bug 432951: Ctrl+'foo' doesn't seem same charCode as Meta+'foo' on Cocoa
            //         https://bugzilla.mozilla.org/show_bug.cgi?query_format=specific&order=relevance+desc&bug_status=__open__&id=432951
            // ---
            //
            // The following fixes are only activated if util.isOS("Darwin").
            // Technically, they prevent mappings from <C-Esc> (and
            // <C-C-]> if your fancy keyboard permits such things<?>), but
            // these <C-control> mappings are probably pathological (<C-Esc>
            // certainly is on Windows), and so it is probably
            // harmless to remove the has("Darwin") if desired.
            //
            else if (util.isOS("Darwin") && event.ctrlKey && charCode >= 27 && charCode <= 31) {
                if (charCode == 27) { // [Ctrl-Bug 1/5] the <C-[> bug
                    key = "Esc";
                    modifier = modifier.replace("C-", "");
                }
                else // [Ctrl-Bug 2,3,4,5/5] the <C-\\>, <C-]>, <C-^>, <C-_> bugs
                    key = String.fromCharCode(charCode + 64);
            }
            // a normal key like a, b, c, 0, etc.
            else if (charCode > 0) {
                key = String.fromCharCode(charCode);

                if (!/^[a-z0-9]$/i.test(key) && key in this._key_code) {
                    // a named charcode key (<Space> and <lt>) space can be shifted, <lt> must be forced
                    if ((key.match(/^\s$/) && event.shiftKey) || event.dactylShift)
                        modifier += "S-";

                    key = this._code_key[this._key_code[key]];
                }
                else {
                    // a shift modifier is only allowed if the key is alphabetical and used in a C-A-M- mapping in the uppercase,
                    // or if the shift has been forced for a non-alphabetical character by the user while :map-ping
                    if ((key != key.toLowerCase() && (event.ctrlKey || event.altKey || event.metaKey)) || event.dactylShift)
                        modifier += "S-";
                    else if (modifier.length == 0)
                        return key;
                }
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

    /**
     * Whether <b>key</b> is a key code defined to accept/execute input on
     * the command line.
     *
     * @param {string} key The key code to test.
     * @returns {boolean}
     */
    isAcceptKey: function (key) key == "<Return>" || key == "<C-j>" || key == "<C-m>",

    /**
     * Whether <b>key</b> is a key code defined to reject/cancel input on
     * the command line.
     *
     * @param {string} key The key code to test.
     * @returns {boolean}
     */
    isCancelKey: function (key) key == "<Esc>" || key == "<C-[>" || key == "<C-c>",

    /**
     * Waits for the current buffer to successfully finish loading. Returns
     * true for a successful page load otherwise false.
     *
     * @returns {boolean}
     */
    waitForPageLoad: function () {
        util.threadYield(true); // clear queue

        if (buffer.loaded == 1)
            return true;

        const maxWaitTime = 25;
        let start = Date.now();
        let end = start + (maxWaitTime * 1000); // maximum time to wait - TODO: add option
        let now;
        while (now = Date.now(), now < end) {
            util.threadYield();

            if (!events.feedingKeys)
                return false;

            if (buffer.loaded > 0) {
                util.sleep(250);
                break;
            }
            else
                dactyl.echo("Waiting for page to load...", commandline.DISALLOW_MULTILINE);
        }
        commandline.clear();

        // TODO: allow macros to be continued when page does not fully load with an option
        let ret = (buffer.loaded == 1);
        if (!ret)
            dactyl.echoerr("Page did not load completely in " + maxWaitTime + " seconds. Macro stopped.");

        // sometimes the input widget had focus when replaying a macro
        // maybe this call should be moved somewhere else?
        // dactyl.focusContent(true);

        return ret;
    },

    onDOMMenuBarActive: function () {
        this._activeMenubar = true;
        modes.add(modes.MENU);
    },

    onDOMMenuBarInactive: function () {
        this._activeMenubar = false;
        modes.remove(modes.MENU);
    },

    /**
     *  The global escape key handler. This is called in ALL modes.
     */
    onEscape: function () {
        switch (dactyl.mode) {
        case modes.COMMAND_LINE:
        case modes.INSERT:
        case modes.PASS_THROUGH:
        case modes.QUOTE:
        case modes.TEXT_EDIT:
        case modes.VISUAL:
            modes.pop();
            break;

        default:
            modes.reset();
            break;
        }
    },

    /**
     * Ensures that the currently focused element is visible and blurs
     * it if it's not.
     */
    checkFocus: function () {
        if (dactyl.focus) {
            let rect = dactyl.focus.getBoundingClientRect();
            if (!rect.width || !rect.height) {
                dactyl.focus.blur();
                // onFocusChange needs to die.
                this.onFocusChange();
            }
        }
    },

    // TODO: Merge with onFocusChange
    onFocus: function onFocus(event) {
        let elem = event.originalTarget;

        if (Events.isContentNode(elem) && !buffer.focusAllowed(elem)
            && isinstance(elem, [HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement]))
            elem.blur();
    },

    // argument "event" is deliberately not used, as i don't seem to have
    // access to the real focus target
    // Huh? --djk
    onFocusChange: function onFocusChange(event) {
        // command line has it's own focus change handler
        if (dactyl.mode == modes.COMMAND_LINE)
            return;

        function hasHTMLDocument(win) win && win.document && win.document instanceof HTMLDocument

        let win  = window.document.commandDispatcher.focusedWindow;
        let elem = window.document.commandDispatcher.focusedElement;

        if (win && win.top == window.content && dactyl.has("tabs"))
            buffer.focusedFrame = win;

        try {
            if (elem && elem.readOnly)
                return;

            if (elem instanceof HTMLInputElement && set.has(util.editableInputs, elem.type) ||
                elem instanceof HTMLSelectElement) {
                dactyl.mode = modes.INSERT;
                if (hasHTMLDocument(win))
                    buffer.lastInputField = elem;
                return;
            }

            if (isinstance(elem, [HTMLEmbedElement, HTMLEmbedElement])) {
                dactyl.mode = modes.EMBED;
                return;
            }

            if (elem instanceof HTMLTextAreaElement || (elem && util.computedStyle(elem).MozUserModify == "read-write")) {
                if (modes.main === modes.VISUAL && elem.selectionEnd == elem.selectionStart)
                    modes.pop();
                if (options["insertmode"])
                    modes.set(modes.INSERT);
                else {
                    modes.set(modes.TEXT_EDIT);
                    if (elem.selectionEnd - elem.selectionStart > 0)
                        modes.push(modes.VISUAL);
                }
                if (hasHTMLDocument(win))
                    buffer.lastInputField = elem;
                return;
            }

            if (config.focusChange) {
                config.focusChange(win);
                return;
            }

            let urlbar = document.getElementById("urlbar");
            if (elem == null && urlbar && urlbar.inputField == this._lastFocus)
                util.threadYield(true);

            if (modes.getMode(modes.main).ownsFocus)
                 modes.reset();
        }
        finally {
            this._lastFocus = elem;
        }
    },

    // this keypress handler gets always called first, even if e.g.
    // the commandline has focus
    // TODO: ...help me...please...
    onKeyPress: function onKeyPress(event) {
        function isEscape(key) key == "<Esc>" || key == "<C-[>";

        function killEvent() {
            event.preventDefault();
            event.stopPropagation();
        }

        let key = events.toString(event);
        if (!key)
             return null;

        if (modes.isRecording) {
            if (key == "q" && !modes.mainMode.input) { // TODO: should not be hardcoded
                modes.isRecording = false;
                dactyl.log("Recorded " + this._currentMacro + ": " + this._macros.get(this._currentMacro, {}).keys, 9);
                dactyl.echomsg("Recorded macro '" + this._currentMacro + "'");
                return killEvent();
            }
            else if (!mappings.hasMap(modes.main, this._input.buffer + key))
                this._macros.set(this._currentMacro, {
                    keys: this._macros.get(this._currentMacro, {}).keys + key,
                    timeRecorded: Date.now()
                });
        }

        if (key == "<C-c>")
            util.interrupted = true;

        // feedingKeys needs to be separate from interrupted so
        // we can differentiate between a recorded <C-c>
        // interrupting whatever it's started and a real <C-c>
        // interrupting our playback.
        if (events.feedingKeys && !event.isMacro) {
            if (key == "<C-c>") {
                events.feedingKeys = false;
                if (modes.isReplaying) {
                    modes.isReplaying = false;
                    this.timeout(function () { dactyl.echomsg("Canceled playback of macro '" + this._lastMacro + "'"); }, 100);
                }
            }
            else
                events.duringFeed.push(event);

            return killEvent();
        }

        try {
            let stop = false;
            let mode = modes.getStack(0);

            let win = document.commandDispatcher.focusedWindow;
            if (win && win.document && "designMode" in win.document && win.document.designMode == "on" && !config.isComposeWindow)
                stop = true;
            // menus have their own command handlers
            if (modes.extended & modes.MENU)
                stop = true;
            else if (modes.main == modes.PASS_THROUGH)
                // let flow continue to handle these keys to cancel escape-all-keys mode
                stop = !isEscape(key) && key != "<C-v>"
            // handle Escape-one-key mode (Ctrl-v)
            else if (modes.main == modes.QUOTE) {
                stop = modes.getStack(1).main !== modes.PASS_THROUGH || isEscape(key);
                // We need to preserve QUOTE mode until the escape
                // handler to escape the <Esc> key
                if (!stop || !isEscape(key))
                    modes.pop();
                mode = modes.getStack(1);
            }
            // handle Escape-all-keys mode (Ctrl-q)

            if (stop) {
                this._input.buffer = "";
                return null;
            }

            stop = true; // set to false if we should NOT consume this event but let the host app handle it

            // XXX: ugly hack for now pass certain keys to the host app as
            // they are without beeping also fixes key navigation in combo
            // boxes, submitting forms, etc.
            // FIXME: breaks iabbr for now --mst
            if (key in config.ignoreKeys && (config.ignoreKeys[key] & mode.main)) {
                this._input.buffer = "";
                return null;
            }

            if (mode.params.onEvent) {
                this._input.buffer = "";
                // Bloody hell.
                if (key === "<C-h>")
                    key = event.dactylString = "<BS>";

                if (mode.params.onEvent(event) === false)
                    killEvent();
                return null;
            }

            let inputStr = this._input.buffer + key;
            let countStr = inputStr.match(/^[1-9][0-9]*|/)[0];
            let candidateCommand = inputStr.substr(countStr.length);
            let map = mappings[event.noremap ? "getDefault" : "get"](mode.main, candidateCommand);

            let candidates = mappings.getCandidates(mode.main, candidateCommand);
            if (candidates.length == 0 && !map) {
                map = this._input.pendingMap;
                this._input.pendingMap = null;
                if (map && map.arg)
                    this._input.pendingArgMap = map;
            }

            // counts must be at the start of a complete mapping (10j -> go 10 lines down)
            if (countStr && !candidateCommand) {
                // no count for insert mode mappings
                if (!mode.mainMode.count || mode.mainMode.input)
                    stop = false;
                else
                    this._input.buffer = inputStr;
            }
            else if (this._input.pendingArgMap) {
                this._input.buffer = "";
                let map = this._input.pendingArgMap;
                this._input.pendingArgMap = null;
                if (!isEscape(key)) {
                    if (modes.isReplaying && !this.waitForPageLoad())
                        return null;
                    map.execute(null, this._input.count, key);
                }
            }
            // only follow a map if there isn't a longer possible mapping
            // (allows you to do :map z yy, when zz is a longer mapping than z)
            else if (map && !event.skipmap && candidates.length == 0) {
                this._input.pendingMap = null;
                this._input.count = parseInt(countStr, 10);
                if (isNaN(this._input.count))
                    this._input.count = null;
                this._input.buffer = "";
                if (map.arg) {
                    this._input.buffer = inputStr;
                    this._input.pendingArgMap = map;
                }
                else if (this._input.pendingMotionMap) {
                    if (!isEscape(key))
                        this._input.pendingMotionMap.execute(candidateCommand, this._input.count, null);
                    this._input.pendingMotionMap = null;
                }
                // no count support for these commands yet
                else if (map.motion) {
                    this._input.pendingMotionMap = map;
                }
                else {
                    if (modes.isReplaying && !this.waitForPageLoad())
                        return killEvent();

                    let ret = map.execute(null, this._input.count);
                    if (map.route && ret)
                        stop = false;
                }
            }
            else if (mappings.getCandidates(mode.main, candidateCommand).length > 0 && !event.skipmap) {
                this._input.pendingMap = map;
                this._input.buffer += key;
            }
            else { // if the key is neither a mapping nor the start of one
                // the mode checking is necessary so that things like g<esc> do not beep
                if (this._input.buffer != "" && !event.skipmap &&
                    (mode.main & (modes.INSERT | modes.COMMAND_LINE | modes.TEXT_EDIT)))
                    events.feedkeys(this._input.buffer, { noremap: true, skipmap: true });

                this._input.buffer = "";
                this._input.pendingArgMap = null;
                this._input.pendingMotionMap = null;
                this._input.pendingMap = null;

                if (!isEscape(key)) {
                    // allow key to be passed to the host app if we can't handle it
                    stop = (mode.main === modes.TEXT_EDIT);

                    if (mode.main === modes.COMMAND_LINE) {
                        if (!(modes.extended & modes.INPUT_MULTILINE))
                            dactyl.trapErrors(function () {
                                commandline.onEvent(event); // reroute event in command line mode
                            });
                    }
                    else if (!mode.mainMode.input)
                        dactyl.beep();
                }
            }

            if (stop)
                killEvent();
        }
        catch (e) {
            dactyl.reportError(e);
        }
        finally {
            let motionMap = (this._input.pendingMotionMap && this._input.pendingMotionMap.names[0]) || "";
            if (!(modes.extended & modes.HINTS))
                statusline.updateInputBuffer(motionMap + this._input.buffer);
        }
    },

    onKeyUpOrDown: function onKeyUpOrDown(event) {
        // Prevent certain sites from transferring focus to an input box
        // before we get a chance to process our key bindings on the
        // "keypress" event.
        if (!Events.isInputElemFocused() && !modes.passThrough)
            event.stopPropagation();
    },

    onMouseDown: function onMouseDown(event) {
        let elem = event.target;
        let win = elem.ownerDocument && elem.ownerDocument.defaultView || elem;
        for (; win; win = win != win.parent && win.parent)
            win.dactylFocusAllowed = true;
    },

    onPopupShown: function onPopupShown(event) {
        if (event.originalTarget.localName == "tooltip" || event.originalTarget.id == "dactyl-visualbell")
            return;
        modes.add(modes.MENU);
    },

    onPopupHidden: function onPopupHidden() {
        // gContextMenu is set to NULL, when a context menu is closed
        if (window.gContextMenu == null && !this._activeMenubar)
            modes.remove(modes.MENU);
    },

    onResize: function onResize(event) {
        if (window.fullScreen != this._fullscreen) {
            this._fullscreen = window.fullScreen;
            dactyl.triggerObserver("fullscreen", this._fullscreen);
            autocommands.trigger("Fullscreen", { state: this._fullscreen });
        }
    },

    onSelectionChange: function onSelectionChange(event) {
        let controller = document.commandDispatcher.getControllerForCommand("cmd_copy");
        let couldCopy = controller && controller.isCommandEnabled("cmd_copy");

        if (dactyl.mode === modes.VISUAL) {
            if (!couldCopy)
                modes.pop(); // Really not ideal.
        }
        else if (couldCopy) {
            if (modes.main == modes.TEXT_EDIT && !options["insertmode"])
                modes.push(modes.VISUAL);
            else if (dactyl.mode == modes.CARET)
                modes.push(modes.VISUAL);
        }
    }
}, {
    isContentNode: function isContentNode(node) {
        let win = (node.ownerDocument || node).defaultView;
        for (; win; win = win.parent != win && win.parent)
            if (win == window.content)
                return true;
        return false;
    },
    isInputElemFocused: function isInputElemFocused() {
        let elem = dactyl.focus;
        return elem instanceof HTMLInputElement && set.has(util.editableInputs, elem.type) ||
               isinstance(elem, [HTMLIsIndexElement, HTMLEmbedElement,
                                 HTMLObjectElement, HTMLTextAreaElement]);
    }
}, {
    commands: function () {
        commands.add(["delmac[ros]"],
            "Delete macros",
            function (args) {
                dactyl.assert(!args.bang || !args[0], "E474: Invalid argument");

                if (args.bang)
                    events.deleteMacros();
                else if (args[0])
                    events.deleteMacros(args[0]);
                else
                    dactyl.echoerr("E471: Argument required");
            }, {
                bang: true,
                completer: function (context) completion.macro(context),
                literal: 0
            });

        commands.add(["macros"],
            "List all macros",
            function (args) { completion.listCompleter("macro", args[0]); }, {
                argCount: "?",
                completer: function (context) completion.macro(context)
            });
    },
    completion: function () {
        completion.macro = function macro(context) {
            context.title = ["Macro", "Keys"];
            context.completions = [item for (item in events.getMacros())];
        };
    },
    mappings: function () {
        mappings.add(modes.all,
            ["<Esc>", "<C-[>"], "Focus content",
            function () { events.onEscape(); });

        // add the ":" mapping in all but insert mode mappings
        mappings.add(modes.matchModes({ extended: false, input: false }),
            [":"], "Enter command line mode",
            function () { commandline.open(":", "", modes.EX); });

        // focus events
        mappings.add([modes.NORMAL, modes.PLAYER, modes.VISUAL, modes.CARET],
            ["<Tab>"], "Advance keyboard focus",
            function () { document.commandDispatcher.advanceFocus(); });

        mappings.add([modes.NORMAL, modes.PLAYER, modes.VISUAL, modes.CARET, modes.INSERT, modes.TEXT_EDIT],
            ["<S-Tab>"], "Rewind keyboard focus",
            function () { document.commandDispatcher.rewindFocus(); });

        mappings.add(modes.all,
            ["<C-z>"], "Temporarily ignore all " + config.appName + " key bindings",
            function () { modes.push(modes.PASS_THROUGH); });

        mappings.add(modes.all,
            ["<C-v>"], "Pass through next key",
            function () { modes.push(modes.QUOTE); });

        mappings.add(modes.all,
            ["<Nop>"], "Do nothing",
            function () { return; });

        // macros
        mappings.add([modes.NORMAL, modes.PLAYER, modes.MESSAGE],
            ["q"], "Record a key sequence into a macro",
            function (arg) { events.startRecording(arg); },
            { arg: true });

        mappings.add([modes.NORMAL, modes.PLAYER, modes.MESSAGE],
            ["@"], "Play a macro",
            function (count, arg) {
                count = Math.max(count, 1);
                while (count-- && events.playMacro(arg))
                    ;
            },
            { arg: true, count: true });
    },
    options: function () {
        options.add(["strictfocus", "sf"],
            "Prevent scripts from focusing input elements without user intervention",
            "boolean", true);
    },
    sanitizer: function () {
        sanitizer.addItem("macros", {
            description: "Saved macros",
            persistent: true,
            action: function (timespan, host) {
                if (!host)
                    for (let [k, m] in events._macros)
                        if (timespan.contains(m.timeRecorded * 1000))
                            events._macros.remove(k);
            }
        });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
