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

        events.dbg("STACK " + mode);

        let main = { __proto__: mode.main, params: mode.params };
        this.modes = array([mode.params.keyModes, main, mode.main.allBases.slice(1)]).flatten().compact();

        if (builtin)
            hives = hives.filter(function (h) h.name === "builtin");

        this.processors = this.modes.map(function (m) hives.map(function (h) KeyProcessor(m, h)))
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
        if (!builtin && hive.active && (!dactyl.focusedElement || events.isContentNode(dactyl.focusedElement)))
            this.processors.unshift(KeyProcessor(modes.BASE, hive));
    },

    passUnknown: Class.memoize(function () options.get("passunknown").getKey(this.modes)),

    notify: function () {
        events.dbg("NOTIFY()");
        events.keyEvents = [];
        events.processor = null;
        if (!this.execute(undefined, true)) {
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
        events.dbg("EXECUTE(" + this._result(result) + ", " + force + ") events:" + this.events.length
                   + " processors:" + this.processors.length + " actions:" + this.actions.length);

        let processors = this.processors;
        let length = 1;

        if (force)
            this.processors = [];

        if (this.ownsBuffer)
            statusline.inputBuffer = this.processors.length ? this.buffer : "";

        if (!this.processors.some(function (p) !p.extended) && this.actions.length) {
            // We have matching actions and no processors other than
            // those waiting on further arguments. Execute actions as
            // long as they continue to return PASS.

            for (var action in values(this.actions)) {
                while (callable(action)) {
                    length = action.eventLength;
                    action = dactyl.trapErrors(action);
                    events.dbg("ACTION RES: " + length + " " + this._result(action));
                }
                if (action !== Events.PASS)
                    break;
            }

            // Result is the result of the last action. Unless it's
            // PASS, kill any remaining argument processors.
            result = action !== undefined ? action : Events.KILL;
            if (action !== Events.PASS)
                this.processors.length = 0;
        }
        else if (this.processors.length) {
            // We're still waiting on the longest matching processor.
            // Kill the event, set a timeout to give up waiting if applicable.

            result = Events.KILL;
            if (options["timeout"] && (this.actions.length || events.hasNativeKey(this.events[0], this.main, this.passUnknown)))
                this.timer = services.Timer(this, options["timeoutlen"], services.Timer.TYPE_ONE_SHOT);
        }
        else if (result !== Events.KILL && !this.actions.length &&
                 !(this.events[0].isReplay || this.passUnknown
                   || this.modes.some(function (m) m.passEvent(this), this.events[0]))) {
            // No patching processors, this isn't a fake, pass-through
            // event, we're not in pass-through mode, and we're not
            // choosing to pass unknown keys. Kill the event and beep.

            result = Events.ABORT;
            if (!Events.isEscape(this.events.slice(-1)[0]))
                dactyl.beep();
            events.feedingKeys = false;
        }
        else if (result === undefined)
            // No matching processors, we're willing to pass this event,
            // and we don't have a default action from a processor. Just
            // pass the event.
            result = Events.PASS;

        events.dbg("RESULT: " + length + " " + this._result(result) + "\n\n");

        if (result !== Events.PASS || this.events.length > 1)
            if (result !== Events.ABORT || !this.events[0].isReplay)
                Events.kill(this.events[this.events.length - 1]);

        if (result === Events.PASS_THROUGH || result === Events.PASS && this.passUnknown)
            events.passing = true;

        if (result === Events.PASS_THROUGH && this.keyEvents.length)
            events.dbg("PASS_THROUGH:\n\t" + this.keyEvents.map(function (e) [e.type, events.toString(e)]).join("\n\t"));

        if (result === Events.PASS_THROUGH)
            events.feedevents(null, this.keyEvents, { skipmap: true, isMacro: true, isReplay: true });
        else {
            let list = this.events.filter(function (e) e.getPreventDefault() && !e.dactylDefaultPrevented);

            if (result === Events.PASS)
                events.dbg("PASS THROUGH: " + list.slice(0, length).filter(function (e) e.type === "keypress").map(events.closure.toString));
            if (list.length > length)
                events.dbg("REFEED: " + list.slice(length).filter(function (e) e.type === "keypress").map(events.closure.toString));

            if (result === Events.PASS)
                events.feedevents(null, list.slice(0, length), { skipmap: true, isMacro: true, isReplay: true });
            if (list.length > length && this.processors.length === 0)
                events.feedevents(null, list.slice(length));
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

        events.dbg("PROCESS(" + key + ") skipmap: " + event.skipmap + " macro: " + event.isMacro + " replay: " + event.isReplay);

        for (let [i, input] in Iterator(this.processors)) {
            let res = input.process(event);
            if (res !== Events.ABORT)
                var result = res;

            events.dbg("RES: " + input + " " + this._result(res));

            if (res === Events.KILL)
                break;

            if (callable(res))
                actions.push(res);

            if (res === Events.WAIT || input.waiting)
                processors.push(input);
            if (isinstance(res, KeyProcessor))
                processors.push(res);
        }

        events.dbg("RESULT: " + event.getPreventDefault() + " " + this._result(result));
        events.dbg("ACTIONS: " + actions.length + " " + this.actions.length);
        events.dbg("PROCESSORS:", processors, "\n");

        this._actions = actions;
        this.actions = actions.concat(this.actions);

        for (let action in values(actions))
            if (!("eventLength" in action))
                action.eventLength = this.events.length;

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
    get count() this.countStr ? Number(this.countStr) : this.main.params.count || null,

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

                args.self = self.main.params.mappingSelf || self.main.mappingSelf || map;
                let res = map.execute.call(map, args);

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
        if (!isObject(event))
            var [self, events] = [null, array.toObject([[event, callback]])];
        else {
            [self, events] = [event, event[callback || "events"]];
            [, , capture, allowUntrusted] = arguments;
        }

        if (Set.has(events, "input") && !Set.has(events, "dactyl-input"))
            events["dactyl-input"] = events.input;

        for (let [event, callback] in Iterator(events)) {
            let args = [Cu.getWeakReference(target),
                        event,
                        this.wrapListener(callback, self),
                        capture,
                        allowUntrusted];

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
                return false;
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
                    <!-- http://developer.mozilla.org/en/docs/XUL_Tutorial:Updating_Commands -->
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

        this._pseudoKeys = Set(["count", "leader", "nop", "pass"]);

        this._key_key = {};
        this._code_key = {};
        this._key_code = {};
        this._code_nativeKey = {};

        for (let list in values(this._keyTable))
            for (let v in values(list)) {
                if (v.length == 1)
                    v = v.toLowerCase();
                this._key_key[v.toLowerCase()] = v;
            }

        for (let [k, v] in Iterator(KeyEvent)) {
            this._code_nativeKey[v] = k.substr(4);

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
        this.listen(window, this, "events");
    },

    signals: {
        "browser.locationChange": function (webProgress, request, uri) {
            options.get("passkeys").flush();
        },
        "modes.change": function (oldMode, newMode) {
            delete this.processor;
        }
    },

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

            keys = mappings.expandLeader(keys);

            for (let [, evt_obj] in Iterator(events.fromString(keys))) {
                let now = Date.now();
                let key = events.toString(evt_obj);
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
                    this.feedingEvent = evt;

                    let doc = document.commandDispatcher.focusedWindow.document;
                    let event = events.create(doc, type, evt);
                    let target = dactyl.focusedElement
                              || ["complete", "interactive"].indexOf(doc.readyState) >= 0 && doc.documentElement
                              || doc.defaultView;

                    if (target instanceof Element && !Events.isInputElement(target) &&
                        ["<Return>", "<Space>"].indexOf(key) == -1)
                        target = target.ownerDocument.documentElement;

                    if (!evt_obj.dactylString && !mode)
                        events.dispatch(target, event, evt);
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

        var t = this._create_types[type];
        var evt = doc.createEvent((t || "HTML") + "Events");

        let defaults = DEFAULTS[t || "HTML"];

        let args = Object.keys(defaults)
                         .map(function (k) k in opts ? opts[k] : defaults[k]);

        evt["init" + t + "Event"].apply(evt, args);
        return evt;
    },

    _create_types: Class.memoize(function () iter(
        {
            Mouse: "click mousedown mouseout mouseover mouseup",
            Key:   "keydown keypress keyup",
            "":    "change dactyl-input input submit"
        }
    ).map(function ([k, v]) v.split(" ").map(function (v) [v, k]))
     .flatten()
     .toObject()),

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

    iterKeys: function (keys) iter(function () {
        let match, re = /<.*?>?>|[^<]/g;
        while (match = re.exec(keys))
            yield match[0];
    }()),

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
        for (let match in util.regexp.iterate(/<.*?>?>|[^<]|<(?!.*>)/g, input)) {
            let evt_str = match[0];

            let evt_obj = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
                            keyCode: 0, charCode: 0, type: "keypress" };

            if (evt_str.length == 1) {
                evt_obj.charCode = evt_str.charCodeAt(0);
                evt_obj._keyCode = this._key_code[evt_str[0].toLowerCase()];
                evt_obj.shiftKey = evt_str !== evt_str.toLowerCase();
            }
            else {
                let [match, modifier, keyname] = evt_str.match(/^<((?:[*12CASM⌘]-)*)(.+?)>$/i) || [false, '', ''];
                modifier = Set(modifier.toUpperCase());
                keyname = keyname.toLowerCase();
                evt_obj.dactylKeyname = keyname;
                if (/^u[0-9a-f]+$/.test(keyname))
                    keyname = String.fromCharCode(parseInt(keyname.substr(1), 16));

                if (keyname && (unknownOk || keyname.length == 1 || /mouse$/.test(keyname) ||
                                this._key_code[keyname] || Set.has(this._pseudoKeys, keyname))) {
                    evt_obj.globKey  ="*" in modifier;
                    evt_obj.ctrlKey  ="C" in modifier;
                    evt_obj.altKey   ="A" in modifier;
                    evt_obj.shiftKey ="S" in modifier;
                    evt_obj.metaKey  ="M" in modifier || "⌘" in modifier;
                    evt_obj.dactylShift = evt_obj.shiftKey;

                    if (keyname.length == 1) { // normal characters
                        if (evt_obj.shiftKey)
                            keyname = keyname.toUpperCase();

                        evt_obj.charCode = keyname.charCodeAt(0);
                        evt_obj._keyCode = this._key_code[keyname.toLowerCase()];
                    }
                    else if (Set.has(this._pseudoKeys, keyname)) {
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
    toString: function toString(event) {
        if (!event)
            return toString.supercall(this);

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
                key = this._key_key[event.dactylKeyname] || event.dactylKeyname;
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

        let accel = util.OS.isMacOSX ? "metaKey" : "ctrlKey";

        let access = iter({ 1: "shiftKey", 2: "ctrlKey", 4: "altKey", 8: "metaKey" })
                        .filter(function ([k, v]) this & k, prefs.get("ui.key.chromeAccess"))
                        .map(function ([k, v]) [v, true])
                        .toObject();

    outer:
        for (let [, key] in iter(elements))
            if (filters.some(function ([k, v]) key.getAttribute(k) == v)) {
                let keys = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
                let needed = { ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey };

                let modifiers = (key.getAttribute("modifiers") || "").trim().split(/[\s,]+/);
                for (let modifier in values(modifiers))
                    switch (modifier) {
                        case "access": update(keys, access); break;
                        case "accel":  keys[accel] = true; break;
                        default:       keys[modifier + "Key"] = true; break;
                        case "any":
                            if (!iter.some(keys, function ([k, v]) v && needed[k]))
                                continue outer;
                            for (let [k, v] in iter(keys)) {
                                if (v)
                                    needed[k] = false;
                                keys[k] = false;
                            }
                            break;
                    }

                if (iter(needed).every(function ([k, v]) v == keys[k]))
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
        util.waitFor(function () buffer.loaded, this, maxWaitTime * 1000, true);

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

            if (!(services.focus.getLastFocusMethod(win) & 0x7000)
                && events.isContentNode(elem)
                && !buffer.focusAllowed(elem)
                && isinstance(elem, [HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement, Window])) {

                if (elem.frameElement)
                    dactyl.focusContent(true);
                else if (!(elem instanceof Window) || Editor.getEditor(elem))
                    dactyl.focus(window);
            }

            if (elem instanceof Element)
                elem.dactylFocusAllowed = undefined;
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
                            events.dispatch(elem, events.create(elem.ownerDocument, "dactyl-input"));
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
                            this.dispatch(event.originalTarget, event, event);
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
                    this.feedingEvent && this.feedingEvent.isReplay ||
                    event.isReplay ||
                    modes.main == modes.PASS_THROUGH ||
                    modes.main == modes.QUOTE
                        && modes.getStack(1).main !== modes.PASS_THROUGH
                        && !this.shouldPass(event) ||
                    !modes.passThrough && this.shouldPass(event) ||
                    !this.processor && event.type === "keydown"
                        && options.get("passunknown").getKey(modes.main.allBases)
                        && let (key = events.toString(event))
                            !modes.main.allBases.some(
                                function (mode) mappings.hives.some(
                                    function (hive) hive.get(mode, key) || hive.getCandidates(mode, key)));

            if (event.type === "keydown")
                this.passing = pass;

            events.dbg("ON " + event.type.toUpperCase() + " " + this.toString(event) + " pass: " + pass + " replay: " + event.isReplay + " macro: " + event.isMacro);

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
                    elem.dactylFocusAllowed = true;
                win.document.dactylFocusAllowed = true;
            }
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

        popuphidden: function onPopupHidden(event) {
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
            statusline.updateZoomLevel();
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

            while (modes.main.ownsFocus && modes.topOfStack.params.ownsFocus != elem
                    && !modes.topOfStack.params.holdFocus)
                 modes.pop(null, { fromFocus: true });
        }
        finally {
            this._lastFocus = elem;

            if (modes.main.ownsFocus)
                modes.topOfStack.params.ownsFocus = elem;
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
        if (util.computedStyle(elem).visibility !== "visible")
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
        return elem instanceof HTMLInputElement && Set.has(util.editableInputs, elem.type) ||
               isinstance(elem, [HTMLEmbedElement,
                                 HTMLObjectElement, HTMLSelectElement,
                                 HTMLTextAreaElement,
                                 Ci.nsIDOMXULTextBoxElement]) ||
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
    completion: function () {
        completion.macro = function macro(context) {
            context.title = ["Macro", "Keys"];
            context.completions = [item for (item in events.getMacros())];
        };
    },
    mappings: function () {

        mappings.add([modes.MAIN],
            ["<A-b>", "<pass-next-key-builtin>"], "Process the next key as a builtin mapping",
            function () {
                events.processor = ProcessorStack(modes.getStack(0), mappings.hives.array, true);
                events.processor.keyEvents = events.keyEvents;
            });

        mappings.add([modes.MAIN],
            ["<C-z>", "<pass-all-keys>"], "Temporarily ignore all " + config.appName + " key bindings",
            function () { modes.push(modes.PASS_THROUGH); });

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
                    memoize(this, "pass", function () Set(array.flatten(this.filters.map(function (f) f.keys))));
                    memoize(this, "commandHive", function hive() Hive(this.filters, "command"));
                    memoize(this, "inputHive", function hive() Hive(this.filters, "input"));
                },

                has: function (key) Set.has(this.pass, key) || Set.has(this.commandHive.stack.mappings, key),

                get pass() (this.flush(), this.pass),

                keepQuotes: true,

                setter: function (values) {
                    values.forEach(function (filter) {
                        let vals = Option.splitList(filter.result);
                        filter.keys = events.fromString(vals[0]).map(events.closure.toString);

                        filter.commandKeys = vals.slice(1).map(events.closure.canonicalKeys);
                        filter.inputKeys = filter.commandKeys.filter(bind("test", /^<[ACM]-/));
                    });
                    this.flush();
                    return values;
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
