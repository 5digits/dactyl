// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var ProcessorStack = Class("ProcessorStack", {
    init: function (mode, hives, builtin) {
        this.main = mode.main;
        this._actions = [];
        this.actions = [];
        this.buffer = "";
        this.events = [];

        let main = { __proto__: mode.main, params: mode.params };
        let keyModes = array([mode.params.keyModes, main, mode.main.allBases]).flatten().compact();

        if (builtin)
            hives = hives.filter(function (h) h.name === "builtin");

        this.processors = keyModes.map(function (m) hives.map(function (h) KeyProcessor(m, h)))
                                  .flatten().array;
        this.ownsBuffer = !this.processors.some(function (p) p.main.ownsBuffer);

        for (let [i, input] in Iterator(this.processors)) {
            let params = input.main.params;
            if (params.preExecute)
                input.preExecute = params.preExecute;
            if (params.postExecute)
                input.postExecute = params.postExecute;
            if (params.onKeyPress && input.hive === mappings.builtin)
                input.fallthrough = function fallthrough(events) {
                    return params.onKeyPress(events) === false ? Events.KILL : Events.PASS;
                };
            }

        let hive = options.get("passkeys")[this.main.input ? "inputHive" : "commandHive"];
        if (!builtin && hive.active
                && (!dactyl.focusedElement || events.isContentNode(dactyl.focusedElement)))
            this.processors.unshift(KeyProcessor(modes.BASE, hive));
    },

    notify: function () {
        events.keyEvents = [];
        events.processor = null;
        if (!this.execute(Events.KILL, true)) {
            events.processor = this;
            events.keyEvents = this.keyEvents;
        }
    },

    _result: function (result) (result === Events.KILL         ? "KILL"  :
                                result === Events.PASS         ? "PASS"  :
                                result === Events.PASS_THROUGH ? "PASS_THROUGH"  :
                                result === Events.ABORT        ? "ABORT" :
                                callable(result) ? result.toSource().substr(0, 50) : result),

    execute: function execute(result, force) {

        if (force && this.actions.length)
            this.processors.length = 0;

        if (this.ownsBuffer)
            statusline.updateInputBuffer(this.processors.length ? this.buffer : "");

        if (!this.processors.some(function (p) !p.extended) && this.actions.length) {
            if (this._actions.length == 0) {
                dactyl.beep();
                events.feedingKeys = false;
            }

            for (var action in values(this.actions)) {
                while (callable(action)) {
                    action = dactyl.trapErrors(action);
                    events.dbg("ACTION RES: " + this._result(action));
                }
                if (action !== Events.PASS)
                    break;
            }

            result = action !== undefined ? action : Events.KILL;
            if (action !== Events.PASS)
                this.processors.length = 0;
        }
        else if (this.processors.length) {
            result = Events.KILL;
            if (this.actions.length && options["timeout"])
                this.timer = services.Timer(this, options["timeoutlen"], services.Timer.TYPE_ONE_SHOT);
        }
        else if (result !== Events.KILL && !this.actions.length &&
                 (this.events.length > 1 ||
                     this.processors.some(function (p) !p.main.passUnknown))) {
            result = Events.KILL;
            if (!Events.isEscape(this.events.slice(-1)[0]))
                dactyl.beep();
            events.feedingKeys = false;
        }
        else if (result === undefined)
            result = Events.PASS;

        events.dbg("RESULT: " + this._result(result));

        if (result !== Events.PASS || this.events.length > 1)
            Events.kill(this.events[this.events.length - 1]);

        if (result === Events.PASS_THROUGH)
            events.feedevents(null, this.keyEvents, { skipmap: true, isMacro: true, isReplay: true });
        else if (result === Events.PASS || result === Events.ABORT) {
            let list = this.events.filter(function (e) e.getPreventDefault() && !e.dactylDefaultPrevented);
            if (list.length)
                events.dbg("REFEED: " + list.map(events.closure.toString).join(""));
            events.feedevents(null, list, { skipmap: true, isMacro: true, isReplay: true });
        }

        return this.processors.length === 0;
    },

    process: function process(event) {
        if (this.timer)
            this.timer.cancel();

        let key = events.toString(event);
        this.events.push(event);
        if (this.keyEvents)
            this.keyEvents.push(event);

        this.buffer += key;

        let actions = [];
        let processors = [];

        events.dbg("KEY: " + key + " skipmap: " + event.skipmap + " macro: " + event.isMacro + " replay: " + event.isReplay);

        for (let [i, input] in Iterator(this.processors)) {
            let res = input.process(event);
            if (res !== Events.ABORT)
                var result = res;

            events.dbg("RES: " + input + " " + this._result(res));

            if (res === Events.KILL)
                break;

            buffer = buffer || input.inputBuffer;

            if (callable(res))
                actions.push(res);

            if (res === Events.WAIT || input.waiting)
                processors.push(input);
            if (isinstance(res, KeyProcessor))
                processors.push(res);
        }

        events.dbg("RESULT: " + event.getPreventDefault() + " " + this._result(result));
        events.dbg("ACTIONS: " + actions.length + " " + this.actions.length);
        events.dbg("PROCESSORS:", processors);

        this._actions = actions;
        this.actions = actions.concat(this.actions);

        if (result === Events.KILL)
            this.actions = [];
        else if (!this.actions.length && !processors.length)
            for (let input in values(this.processors))
                if (input.fallthrough) {
                    if (result === Events.KILL)
                        break;
                    result = dactyl.trapErrors(input.fallthrough, input, this.events);
                }

        this.processors = processors;

        return this.execute(result, options["timeout"] && options["timeoutlen"] === 0);
    }
});

var KeyProcessor = Class("KeyProcessor", {
    init: function init(main, hive) {
        this.main = main;
        this.events = [];
        this.hive = hive;
        this.wantCount = this.main.count;
    },

    get toStringParams() [this.main.name, this.hive.name],

    countStr: "",
    command: "",
    get count() this.countStr ? Number(this.countStr) : null,

    append: function append(event) {
        this.events.push(event);
        let key = events.toString(event);

        if (this.wantCount && !this.command &&
                (this.countStr ? /^[0-9]$/ : /^[1-9]$/).test(key))
            this.countStr += key;
        else
            this.command += key;
        return this.events;
    },

    process: function process(event) {
        this.append(event);
        this.waiting = false;
        return this.onKeyPress(event);
    },

    execute: function execute(map, args)
        let (self = this)
            function execute() {
                if (self.preExecute)
                    self.preExecute.apply(self, args);
                let res = map.execute.call(map, update({ self: self.main.params.mappingSelf || self.main.mappingSelf || map },
                                                       args));
                if (self.postExecute)
                    self.postExecute.apply(self, args);
                return res;
            },

    onKeyPress: function onKeyPress(event) {
        if (event.skipmap)
            return Events.ABORT;

        if (!this.command)
            return Events.WAIT;

        var map = this.hive.get(this.main, this.command);
        this.waiting = this.hive.getCandidates(this.main, this.command);
        if (map) {
            if (map.arg)
                return KeyArgProcessor(this, map, false, "arg");
            else if (map.motion)
                return KeyArgProcessor(this, map, true, "motion");

            return this.execute(map, {
                keyEvents: this.keyEvents,
                command: this.command,
                count: this.count,
                keypressEvents: this.events
            });
        }

        if (!this.waiting)
            return this.main.insert ? Events.PASS : Events.ABORT;

        return Events.WAIT;
    }
});

var KeyArgProcessor = Class("KeyArgProcessor", KeyProcessor, {
    init: function init(input, map, wantCount, argName) {
        init.supercall(this, input.main, input.hive);
        this.map = map;
        this.parent = input;
        this.argName = argName;
        this.wantCount = wantCount;
    },

    extended: true,

    onKeyPress: function onKeyPress(event) {
        if (Events.isEscape(event))
            return Events.KILL;
        if (!this.command)
            return Events.WAIT;

        let args = {
            command: this.parent.command,
            count:   this.count || this.parent.count,
            events:  this.parent.events.concat(this.events)
        };
        args[this.argName] = this.command;

        return this.execute(this.map, args);
    }
});

var EventHive = Class("EventHive", Contexts.Hive, {
    init: function init(group) {
        init.supercall(this, group);
        this.sessionListeners = [];
    },

    cleanup: function cleanup() {
        this.unlisten(null);
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
    listen: function (target, event, callback, capture) {
        if (isObject(event))
            var [self, events] = [event, event[callback || "events"]];
        else
            [self, events] = [null, array.toObject([[event, callback]])];

        for (let [event, callback] in Iterator(events)) {
            let args = [Cu.getWeakReference(target),
                        event,
                        this.wrapListener(callback, self),
                        capture];

            target.addEventListener.apply(target, args.slice(1));
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
        this.sessionListeners = this.sessionListeners.filter(function (args) {
            if (target == null || args[0].get() == target && args[1] == event && args[2] == callback && args[3] == capture) {
                args[0].get().removeEventListener.apply(args[0].get(), args.slice(1));
                return true;
            }
            return !args[0].get();
        });
    }
});

/**
 * @instance events
 */
var Events = Module("events", {
    dbg: function () {},

    init: function () {
        const self = this;
        this.keyEvents = [];

        update(this, {
            hives: contexts.Hives("events", EventHive),
            user: contexts.hives.events.user,
            builtin: contexts.hives.events.builtin
        });

        EventHive.prototype.wrapListener = this.closure.wrapListener;

        XML.ignoreWhitespace = true;
        util.overlayWindow(window, {
            append: <e4x xmlns={XUL}>
                <window id={document.documentElement.id}>
                    <!--this notifies us also of focus events in the XUL
                        from: http://developer.mozilla.org/en/docs/XUL_Tutorial:Updating_Commands !-->
                    <!-- I don't think we really need this. ––Kris -->
                    <commandset id="dactyl-onfocus" commandupdater="true" events="focus"
                                oncommandupdate="dactyl.modules.events.onFocusChange(event);"/>
                    <commandset id="dactyl-onselect" commandupdater="true" events="select"
                                oncommandupdate="dactyl.modules.events.onSelectionChange(event);"/>
                </window>
            </e4x>.elements()
        });

        this._fullscreen = window.fullScreen;
        this._lastFocus = null;
        this._macroKeys = [];
        this._lastMacro = "";

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
            count: ["count"],
            delete: ["Del"],
            escape: ["Esc", "Escape"],
            insert: ["Insert", "Ins"],
            leader: ["Leader"],
            left_shift: ["LT", "<"],
            nop: ["Nop"],
            pass: ["Pass"],
            return: ["Return", "CR", "Enter"],
            right_shift: [">"],
            space: ["Space", " "],
            subtract: ["Minus", "Subtract"]
        };

        this._pseudoKeys = set(["count", "leader", "nop", "pass"]);

        this._key_key = {};
        this._code_key = {};
        this._key_code = {};

        for (let list in values(this._keyTable))
            for (let v in values(list)) {
                if (v.length == 1)
                    v = v.toLowerCase();
                this._key_key[v.toLowerCase()] = v;
            }

        for (let [k, v] in Iterator(KeyEvent)) {
            k = k.substr(7).toLowerCase();
            let names = [k.replace(/(^|_)(.)/g, function (m, n1, n2) n2.toUpperCase())
                          .replace(/^NUMPAD/, "k")];

            if (names[0].length == 1)
                names[0] = names[0].toLowerCase();

            if (k in this._keyTable)
                names = this._keyTable[k];
            this._code_key[v] = names[0];
            for (let [, name] in Iterator(names)) {
                this._key_key[name.toLowerCase()] = name;
                this._key_code[name.toLowerCase()] = v;
            }
        }

        // HACK: as Gecko does not include an event for <, we must add this in manually.
        if (!("<" in this._key_code)) {
            this._key_code["<"] = 60;
            this._key_code["lt"] = 60;
            this._code_key[60] = "lt";
        }

        this._activeMenubar = false;
        this.listen(window, this, "events", true);

        dactyl.registerObserver("modeChange", function () {
            delete self.processor;
        });
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
    get listen() this.builtin.closure.listen,
    addSessionListener: deprecated("events.listen", { get: function addSessionListener() this.listen }),

    /**
     * Wraps an event listener to ensure that errors are reported.
     */
    wrapListener: function wrapListener(method, self) {
        self = self || this;
        method.wrapped = wrappedListener;
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

        modes.recording = !!macro;

        if (/[A-Z]/.test(macro)) { // uppercase (append)
            macro = macro.toLowerCase();
            this._macroKeys = events.fromString((this._macros.get(macro) || { keys: "" }).keys, true)
                                    .map(events.closure.toString);
        }
        else if (macro) {
            this._macroKeys = [];
        }
        else {
            this._macros.set(this.recording, {
                keys: this._macroKeys.join(""),
                timeRecorded: Date.now()
            });

            dactyl.log("Recorded " + this.recording + ": " + this._macroKeys.join(""), 9);
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
        let res = false;
        dactyl.assert(/^[a-zA-Z0-9@]$/.test(macro), _("macro.invalid", macro));

        if (macro == "@")
            dactyl.assert(this._lastMacro, _("macro.noPrevious"));
        else
            this._lastMacro = macro.toLowerCase(); // XXX: sets last played macro, even if it does not yet exist

        if (this._macros.get(this._lastMacro)) {
            try {
                modes.replaying = true;
                res = events.feedkeys(this._macros.get(this._lastMacro).keys, { noremap: true });
            }
            finally {
                modes.replaying = false;
            }
        }
        else
            // TODO: ignore this like Vim?
            dactyl.echoerr(_("macro.noSuch", this._lastMacro));
        return res;
    },

    /**
     * Returns all macros matching *filter*.
     *
     * @param {string} filter A regular expression filter string. A null
     *     filter selects all macros.
     */
    getMacros: function (filter) {
        let re = RegExp(filter || "");
        return ([k, m.keys] for ([k, m] in events._macros) if (re.test(k)));
    },

    /**
     * Deletes all macros matching *filter*.
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
                let evt = events.create(doc, event.type, event);
                events.dispatch(elem, evt, extra);
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

            for (let [, evt_obj] in Iterator(events.fromString(keys))) {
                let now = Date.now();
                for (let type in values(["keydown", "keyup", "keypress"])) {
                    let evt = update({}, evt_obj, { type: type });

                    if (isObject(noremap))
                        update(evt, noremap);
                    else
                        evt.noremap = !!noremap;
                    evt.isMacro = true;
                    evt.dactylMode = mode;
                    evt.dactylSavedEvents = savedEvents;
                    this.feedingEvent = evt;

                    let event = events.create(document.commandDispatcher.focusedWindow.document, type, evt);
                    if (!evt_obj.dactylString && !evt_obj.dactylShift && !mode)
                        events.dispatch(dactyl.focusedElement || buffer.focusedFrame, event, evt);
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
            this.feedingEvent = null;
            this.feedingKeys = wasFeeding;
            if (quiet)
                commandline.quiet = wasQuiet;
            dactyl.triggerObserver("events.doneFeeding");
        }
        return true;
    },

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
    create: function (doc, type, opts) {
        opts = opts || {};
        var DEFAULTS = {
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
        const TYPES = {
            change: "", input: "", submit: "",
            click: "Mouse", mousedown: "Mouse", mouseup: "Mouse",
            mouseover: "Mouse", mouseout: "Mouse",
            keypress: "Key", keyup: "Key", keydown: "Key"
        };
        var t = TYPES[type];
        var evt = doc.createEvent((t || "HTML") + "Events");

        let defaults = DEFAULTS[t || "HTML"];
        evt["init" + t + "Event"].apply(evt, Object.keys(defaults)
                                                   .map(function (k) k in opts ? opts[k]
                                                                               : defaults[k]));
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
     * <S-@> is preserved, as in Vim, to allow untypeable key-combinations
     * in macros.
     *
     * canonicalKeys(canonicalKeys(x)) == canonicalKeys(x) for all values
     * of x.
     *
     * @param {string} keys Messy form.
     * @param {boolean} unknownOk Whether unknown keys are passed
     *     through rather than being converted to <lt>keyname>.
     *     @default false
     * @returns {string} Canonical form.
     */
    canonicalKeys: function (keys, unknownOk) {
        if (arguments.length === 1)
            unknownOk = true;
        return events.fromString(keys, unknownOk).map(events.closure.toString).join("");
    },

    iterKeys: function (keys) {
        let match, re = /<.*?>?>|[^<]/g;
        while (match = re.exec(keys))
            yield match[0];
    },

    /**
     * Dispatches an event to an element as if it were a native event.
     *
     * @param {Node} target The DOM node to which to dispatch the event.
     * @param {Event} event The event to dispatch.
     */
    dispatch: Class.memoize(function ()
        util.haveGecko("2b")
            ? function dispatch(target, event, extra) {
                try {
                    this.feedingEvent = extra;
                    if (target instanceof Element)
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
            }),

    get defaultTarget() dactyl.focusedElement || content.document.body || document.documentElement,

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
     * @param {boolean} unknownOk Whether unknown keys are passed
     *     through rather than being converted to <lt>keyname>.
     *     @default false
     * @returns {Array[Object]}
     */
    fromString: function (input, unknownOk) {

        if (arguments.length === 1)
            unknownOk = true;

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
                if (/^u[0-9a-f]+$/.test(keyname))
                    keyname = String.fromCharCode(parseInt(keyname.substr(1), 16));

                if (keyname && (unknownOk || keyname.length == 1 || /mouse$/.test(keyname) ||
                                this._key_code[keyname] || set.has(this._pseudoKeys, keyname))) {
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
                    else if (set.has(this._pseudoKeys)) {
                        evt_obj.dactylString = "<" + this._key_key[keyname] + ">";
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

            evt_obj.modifiers = (evt_obj.ctrlKey && Ci.nsIDOMNSEvent.CONTROL_MASK)
                              | (evt_obj.altKey && Ci.nsIDOMNSEvent.ALT_MASK)
                              | (evt_obj.shiftKey && Ci.nsIDOMNSEvent.SHIFT_MASK)
                              | (evt_obj.metaKey && Ci.nsIDOMNSEvent.META_MASK);

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
    toString: function toString(event) {
        if (!event)
            return toString.supercall(this);

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
            let charCode = event.type == "keyup" ? 0 : event.charCode; // Why? --Kris
            if (charCode == 0) {
                if (event.keyCode in this._code_key) {
                    key = this._code_key[event.keyCode];

                    if (event.shiftKey && (key.length > 1 || event.ctrlKey || event.altKey || event.metaKey) || event.dactylShift)
                        modifier += "S-";
                    else if (!modifier && key.length === 1)
                        if (event.shiftKey)
                            key = key.toUpperCase();
                        else
                            key = key.toLowerCase();
                    if (!modifier && /^[a-z0-9]$/i.test(key))
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
            // The following fixes are only activated if util.OS.isMacOSX.
            // Technically, they prevent mappings from <C-Esc> (and
            // <C-C-]> if your fancy keyboard permits such things<?>), but
            // these <C-control> mappings are probably pathological (<C-Esc>
            // certainly is on Windows), and so it is probably
            // harmless to remove the util.OS.isMacOSX if desired.
            //
            else if (util.OS.isMacOSX && event.ctrlKey && charCode >= 27 && charCode <= 31) {
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
                    // a named charCode key (<Space> and <lt>) space can be shifted, <lt> must be forced
                    if ((key.match(/^\s$/) && event.shiftKey) || event.dactylShift)
                        modifier += "S-";

                    key = this._code_key[this._key_code[key]];
                }
                else {
                    // a shift modifier is only allowed if the key is alphabetical and used in a C-A-M- mapping in the uppercase,
                    // or if the shift has been forced for a non-alphabetical character by the user while :map-ping
                    if (key != key.toLowerCase() && (event.ctrlKey || event.altKey || event.metaKey) || event.dactylShift)
                        modifier += "S-";
                    if (/^\s$/.test(key))
                        key = let (s = charCode.toString(16)) "U" + "0000".substr(4 - s.length) + s;
                    else if (modifier.length == 0)
                        return key;
                }
            }
            if (key == null)
                key = this._key_key[event.dactylKeyname] || event.dactylKeyname;
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
     * Whether *key* is a key code defined to accept/execute input on the
     * command line.
     *
     * @param {string} key The key code to test.
     * @returns {boolean}
     */
    isAcceptKey: function (key) key == "<Return>" || key == "<C-j>" || key == "<C-m>",

    /**
     * Whether *key* is a key code defined to reject/cancel input on the
     * command line.
     *
     * @param {string} key The key code to test.
     * @returns {boolean}
     */
    isCancelKey: function (key) key == "<Esc>" || key == "<C-[>" || key == "<C-c>",

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

        dactyl.echo(_("macro.loadWaiting"), commandline.DISALLOW_MULTILINE);

        const maxWaitTime = (time || 25);
        util.waitFor(function () !events.feedingKeys || buffer.loaded, this, maxWaitTime * 1000, true);

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
        DOMMenuBarActive: function () {
            this._activeMenubar = true;
            if (modes.main != modes.MENU)
                modes.push(modes.MENU);
        },

        DOMMenuBarInactive: function () {
            this._activeMenubar = false;
            modes.remove(modes.MENU, true);
        },

        blur: function onBlur(event) {
            let elem = event.originalTarget;
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

            if (event.target instanceof Ci.nsIDOMXULTextBoxElement)
                if (Events.isHidden(elem, true))
                    elem.blur();

            let win = (elem.ownerDocument || elem).defaultView || elem;

            if (events.isContentNode(elem) && !buffer.focusAllowed(elem)
                && !(services.focus.getLastFocusMethod(win) & 0x7000)
                && isinstance(elem, [HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement, Window])) {
                if (elem.frameElement)
                    dactyl.focusContent(true);
                else if (!(elem instanceof Window) || Editor.getEditor(elem))
                    dactyl.focus(window);
            }
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
            event.dactylDefaultPrevented = event.getPreventDefault();

            let duringFeed = this.duringFeed || [];
            this.duringFeed = [];
            try {
                if (this.feedingEvent)
                    for (let [k, v] in Iterator(this.feedingEvent))
                        if (!(k in event))
                            event[k] = v;
                this.feedingEvent = null;

                let key = events.toString(event);

                // Hack to deal with <BS> and so forth not dispatching input
                // events
                if (key && event.originalTarget instanceof HTMLInputElement && !modes.main.passthrough) {
                    let elem = event.originalTarget;
                    elem.dactylKeyPress = elem.value;
                    util.timeout(function () {
                        if (elem.dactylKeyPress !== undefined && elem.value !== elem.dactylKeyPress)
                            events.dispatch(elem, events.create(elem.ownerDocument, "input"));
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

                if (!this.processor) {
                    let mode = modes.getStack(0);
                    if (event.dactylMode)
                        mode = Modes.StackElement(event.dactylMode);

                    let ignore = false;

                    if (modes.main == modes.PASS_THROUGH)
                        ignore = !Events.isEscape(key) && key != "<C-v>";
                    else if (modes.main == modes.QUOTE) {
                        if (modes.getStack(1).main == modes.PASS_THROUGH) {
                            mode.params.mainMode = modes.getStack(2).main;
                            ignore = Events.isEscape(key);
                        }
                        else if (events.shouldPass(event))
                            mode.params.mainMode = modes.getStack(1).main;
                        else
                            ignore = true;

                        if (ignore && !Events.isEscape(key))
                            modes.pop();
                    }
                    else if (!event.isMacro && !event.noremap && events.shouldPass(event))
                        ignore = true;

                    events.dbg("\n\n");
                    events.dbg("ON KEYPRESS " + key + " ignore: " + ignore,
                               event.originalTarget instanceof Element ? event.originalTarget : String(event.originalTarget));

                    if (ignore)
                        return null;

                    if (key == "<C-c>")
                        util.interrupted = true;

                    if (config.ignoreKeys[key] & mode.main)
                        return null;

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
                            this.dispatch(event.originalTarget, event, event);
                        }
                        catch (e) {
                            util.reportError(e);
                        }
            }
        },

        keyup: function onKeyUp(event) {
            this.keyEvents.push(event);

            let pass = this.feedingEvent && this.feedingEvent.isReplay ||
                    event.isReplay ||
                    modes.main == modes.PASS_THROUGH ||
                    modes.main == modes.QUOTE
                        && modes.getStack(1).main !== modes.PASS_THROUGH
                        && !this.shouldPass(event) ||
                    !modes.passThrough && this.shouldPass(event);

            events.dbg("ON " + event.type.toUpperCase() + " " + this.toString(event) + " pass: " + pass);

            // Prevents certain sites from transferring focus to an input box
            // before we get a chance to process our key bindings on the
            // "keypress" event.
            if (!pass && !Events.isInputElement(dactyl.focusedElement))
                event.stopPropagation();
        },
        keydown: function onKeyDown(event) {
            this.events.keyup.call(this, event);
        },

        mousedown: function onMouseDown(event) {
            let elem = event.target;
            let win = elem.ownerDocument && elem.ownerDocument.defaultView || elem;

            for (; win; win = win != win.parent && win.parent)
                win.document.dactylFocusAllowed = true;
        },

        popupshown: function onPopupShown(event) {
            let elem = event.originalTarget;
            if (elem instanceof Ci.nsIAutoCompletePopup) {
                if (modes.main != modes.AUTOCOMPLETE)
                    modes.push(modes.AUTOCOMPLETE);
            }
            else if (elem.localName !== "tooltip")
                if (Events.isHidden(elem)) {
                    if (elem.hidePopup && Events.isHidden(elem.parentNode))
                        elem.hidePopup();
                }
                else if (modes.main != modes.MENU)
                    modes.push(modes.MENU);
        },

        popuphidden: function onPopupHidden() {
            // gContextMenu is set to NULL, when a context menu is closed
            if (window.gContextMenu == null && !this._activeMenubar)
                modes.remove(modes.MENU, true);
            modes.remove(modes.AUTOCOMPLETE);
        },

        resize: function onResize(event) {
            if (window.fullScreen != this._fullscreen) {
                statusline.statusBar.removeAttribute("moz-collapsed");
                this._fullscreen = window.fullScreen;
                dactyl.triggerObserver("fullscreen", this._fullscreen);
                autocommands.trigger("Fullscreen", { url: this._fullscreen ? "on" : "off", state: this._fullscreen });
            }
        }
    },

    // argument "event" is deliberately not used, as i don't seem to have
    // access to the real focus target
    // Huh? --djk
    onFocusChange: function onFocusChange(event) {
        function hasHTMLDocument(win) win && win.document && win.document instanceof HTMLDocument
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

            if (isinstance(elem, [HTMLEmbedElement, HTMLEmbedElement])) {
                modes.push(modes.EMBED);
                return;
            }

            let haveInput = modes.stack.some(function (m) m.main.input);

            if (elem instanceof HTMLTextAreaElement
               || elem instanceof Element && util.computedStyle(elem).MozUserModify === "read-write"
               || elem == null && win && Editor.getEditor(win)) {

                if (modes.main == modes.VISUAL && elem.selectionEnd == elem.selectionStart)
                    modes.pop();

                if (!haveInput)
                    if (options["insertmode"])
                        modes.push(modes.INSERT);
                    else {
                        modes.push(modes.TEXT_EDIT);
                        if (elem.selectionEnd - elem.selectionStart > 0)
                            modes.push(modes.VISUAL);
                    }

                if (hasHTMLDocument(win))
                    buffer.lastInputField = elem;
                return;
            }

            if (Events.isInputElement(elem)) {
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
            if (elem == null && urlbar && urlbar.inputField == this._lastFocus)
                util.threadYield(true); // Why? --Kris

            while (modes.main.ownsFocus && !modes.topOfStack.params.holdFocus)
                 modes.pop(null, { fromFocus: true });
        }
        finally {
            this._lastFocus = elem;
        }
    },

    onSelectionChange: function onSelectionChange(event) {
        let controller = document.commandDispatcher.getControllerForCommand("cmd_copy");
        let couldCopy = controller && controller.isCommandEnabled("cmd_copy");

        if (modes.main == modes.VISUAL) {
            if (!couldCopy)
                modes.pop(); // Really not ideal.
        }
        else if (couldCopy) {
            if (modes.main == modes.TEXT_EDIT && !options["insertmode"])
                modes.push(modes.VISUAL);
            else if (modes.main == modes.CARET)
                modes.push(modes.VISUAL);
        }
    },

    shouldPass: function shouldPass(event)
        !event.noremap && (!dactyl.focusedElement || events.isContentNode(dactyl.focusedElement)) &&
        options.get("passkeys").has(events.toString(event))
}, {
    ABORT: {},
    KILL: true,
    PASS: false,
    PASS_THROUGH: {},
    WAIT: null,

    isEscape: function isEscape(event)
        let (key = isString(event) ? event : events.toString(event))
            key === "<Esc>" || key === "<C-[>",

    isHidden: function isHidden(elem, aggressive) {
        for (let e = elem; e instanceof Element; e = e.parentNode) {
            if (util.computedStyle(e).visibility !== "visible" ||
                    aggressive && e.boxObject && e.boxObject.height === 0)
                return true;
        }
        return false;
    },

    isInputElement: function isInputElement(elem) {
        return elem instanceof HTMLInputElement && set.has(util.editableInputs, elem.type) ||
               isinstance(elem, [HTMLIsIndexElement, HTMLEmbedElement,
                                 HTMLObjectElement, HTMLSelectElement,
                                 HTMLTextAreaElement,
                                 Ci.nsIDOMXULTreeElement, Ci.nsIDOMXULTextBoxElement]) ||
               elem instanceof Window && Editor.getEditor(elem);
    },

    kill: function kill(event) {
        event.stopPropagation();
        event.preventDefault();
    }
}, {
    commands: function () {
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

        mappings.add([modes.MAIN],
            ["<A-b>"], "Process the next key as a builtin mapping",
            function () {
                events.processor = ProcessorStack(modes.getStack(0), mappings.hives.array, true);
                events.processor.keyEvents = events.keyEvents;
            });

        mappings.add([modes.MAIN],
            ["<C-z>", "<pass-all-keys>"], "Temporarily ignore all " + config.appName + " key bindings",
            function () { modes.push(modes.PASS_THROUGH); });

        mappings.add([modes.MAIN],
            ["<C-v>", "<pass-next-key>"], "Pass through next key",
            function () {
                if (modes.main == modes.QUOTE)
                    return Events.PASS;
                modes.push(modes.QUOTE);
            });

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
    options: function () {
        const Hive = Class("Hive", {
            init: function init(values, map) {
                this.name = "passkeys:" + map;
                this.stack = MapHive.Stack(values.map(function (v) Map(v[map + "Keys"])));
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
                    memoize(this, "pass", function () set(array.flatten(this.filters.map(function (f) f.keys))));
                    memoize(this, "commandHive", function hive() Hive(this.filters, "command"));
                    memoize(this, "inputHive", function hive() Hive(this.filters, "input"));
                },

                has: function (key) set.has(this.pass, key) || set.has(this.commandHive.stack.mappings, key),

                get pass() (this.flush(), this.pass),

                keepQuotes: true,

                setter: function (values) {
                    values.forEach(function (filter) {
                        let vals = Option.splitList(filter.result);
                        filter.keys = events.fromString(vals[0]).map(events.closure.toString);

                        filter.commandKeys = vals.slice(1).map(events.closure.canonicalKeys);
                        filter.inputKeys = filter.commandKeys.filter(/^<[ACM]-/);
                    });
                    this.flush();
                    return values;
                }
            });

        options.add(["strictfocus", "sf"],
            "Prevent scripts from focusing input elements without user intervention",
            "boolean", true);

        options.add(["timeout", "tmo"],
            "Whether to execute a shorter key command after a timeout when a longer command exists",
            "boolean", true);

        options.add(["timeoutlen", "tmol"],
            "Maximum time (milliseconds) to wait for a longer key command when a shorter one exists",
            "number", 1000);
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
