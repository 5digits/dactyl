// Copyright (c) 2008-2014 Kris Maglione <maglione.k at Gmail>
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
            hives = hives.filter(h => h.name === "builtin");

        this.processors = this.modes.map(m => hives.map(h => KeyProcessor(m, h)))
                                    .flatten().array;
        this.ownsBuffer = !this.processors.some(p => p.main.ownsBuffer);

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

    passUnknown: Class.Memoize(function () options.get("passunknown").getKey(this.modes)),

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

        if (!this.processors.some(p => !p.extended) && this.actions.length) {
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
                 !(this.events[0].isReplay || this.passUnknown ||
                   this.modes.some(function (m) m.passEvent(this), this.events[0]))) {
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
            events.dbg("PASS_THROUGH:\n\t" + this.keyEvents.map(e => [e.type, DOM.Event.stringify(e)]).join("\n\t"));

        if (result === Events.PASS_THROUGH)
            events.feedevents(null, this.keyEvents, { skipmap: true, isMacro: true, isReplay: true });
        else {
            let list = this.events.filter(e => e.defaultPrevented && !e.dactylDefaultPrevented);

            if (result === Events.PASS)
                events.dbg("PASS THROUGH: " + list.slice(0, length).filter(e => e.type === "keypress").map(DOM.Event.bound.stringify));
            if (list.length > length)
                events.dbg("REFEED: " + list.slice(length).filter(e => e.type === "keypress").map(DOM.Event.bound.stringify));

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

        let key = event.dactylString || DOM.Event.stringify(event);
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

        events.dbg("RESULT: " + event.defaultPrevented + " " + this._result(result));
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
        let key = event.dactylString || DOM.Event.stringify(event);

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
        () => {
            if (this.preExecute)
                this.preExecute.apply(this, args);

            args.self = this.main.params.mappingSelf || this.main.mappingSelf || map;
            let res = map.execute.call(map, args);

            if (this.postExecute)
                this.postExecute.apply(this, args);
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
                command: this.command,
                count: this.count,
                keyEvents: events.keyEvents,
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
            keyEvents: events.keyEvents,
            keypressEvents: this.parent.events.concat(this.events)
        };
        args[this.argName] = this.command;

        return this.execute(this.map, args);
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
