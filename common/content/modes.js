// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var Modes = Module("modes", {
    init: function init() {
        this.modeChars = {};
        this._main = 1;     // NORMAL
        this._extended = 0; // NONE

        this._lastShown = null;

        this._passNextKey = false;
        this._passAllKeys = false;
        this._recording = false;
        this._replaying = false; // playing a macro

        this._modeStack = Modes.ModeStack([]);

        this._modes = [];
        this._mainModes = [];
        this._modeMap = {};

        this.boundProperties = {};

        this.addMode("BASE", {
            char: "b",
            description: "The base mode for all other modes",
            bases: [],
            count: false
        });
        this.addMode("MAIN", {
            char: "m",
            description: "The base mode for most other modes",
            bases: [this.BASE],
            count: false
        });
        this.addMode("COMMAND", {
            char: "C",
            description: "The base mode for most modes which accept commands rather than input"
        });

        this.addMode("NORMAL", {
            char: "n",
            description: "Active when nothing is focused",
            bases: [this.COMMAND]
        });
        this.addMode("CARET", {
            char: "caret",
            description: "Active when the caret is visible in the web content",
            bases: [this.NORMAL]
        }, {

            get pref()    prefs.get("accessibility.browsewithcaret"),
            set pref(val) prefs.set("accessibility.browsewithcaret", val),

            enter: function (stack) {
                if (stack.pop && !this.pref)
                    modes.pop();
                else if (!stack.pop && !this.pref)
                    this.pref = true;
                if (!stack.pop)
                    buffer.resetCaret();
            },

            leave: function (stack) {
                if (!stack.push && this.pref)
                    this.pref = false;
            }
        });

        this.addMode("INPUT", {
            char: "I",
            description: "The base mode for input modes, including Insert and Command Line",
            bases: [this.MAIN],
            insert: true
        });

        this.addMode("EMBED", {
            description: "Active when an <embed> or <object> element is focused",
            bases: [modes.MAIN],
            insert: true,
            ownsFocus: true,
            passthrough: true
        });

        this.addMode("PASS_THROUGH", {
            description: "All keys but <C-v> are ignored by " + config.appName,
            bases: [this.BASE],
            hidden: true,
            insert: true,
            passthrough: true
        });
        this.addMode("QUOTE", {
            description: "The next key sequence is ignored by " + config.appName + ", unless in Pass Through mode",
            bases: [this.BASE],
            hidden: true,
            passthrough: true,
            display: function ()
                (modes.getStack(1).main == modes.PASS_THROUGH
                    ? (modes.getStack(2).main.display() || modes.getStack(2).main.name)
                    : "PASS THROUGH") + " (next)"
        }, {
            // Fix me.
            preExecute: function (map) { if (modes.main == modes.QUOTE && map.name !== "<C-v>") modes.pop(); },
            postExecute: function (map) { if (modes.main == modes.QUOTE && map.name === "<C-v>") modes.pop(); },
            onKeyPress: function (events) { if (modes.main == modes.QUOTE) modes.pop(); }
        });
        this.addMode("IGNORE", { hidden: true }, {
            onKeyPress: function (events_) {
                if (events.isCancelKey(DOM.Event.stringify(events_[0])))
                    return true;
                return false;
            },
            bases: [],
            passthrough: true
        });

        this.addMode("MENU", {
            description: "Active when a menu or other pop-up is open",
            input: true,
            passthrough: true,
            ownsInput: false
        }, {
            leave: function leave(stack) {
                util.timeout(function () {
                    if (stack.pop && !modes.main.input && Events.isInputElement(dactyl.focusedElement))
                        modes.push(modes.INSERT);
                });
            }
        });

        this.addMode("LINE", {
            extended: true, hidden: true
        });

        this.push(this.NORMAL, 0, {
            enter: function (stack, prev) {
                if (prefs.get("accessibility.browsewithcaret"))
                    prefs.set("accessibility.browsewithcaret", false);

                statusline.updateStatus();
                if (!stack.fromFocus && prev.main.ownsFocus)
                    dactyl.focusContent(true);
                if (prev.main == modes.NORMAL) {
                    dactyl.focusContent(true);
                    for (let frame in values(buffer.allFrames())) {
                        // clear any selection made
                        let selection = frame.getSelection();
                        if (selection && !selection.isCollapsed)
                            selection.collapseToStart();
                    }
                }

            }
        });
    },

    cleanup: function cleanup() {
        modes.reset();
    },

    signals: {
        "io.source": function ioSource(context, file, modTime) {
            cache.flushEntry("modes.dtd", modTime);
        }
    },

    _getModeMessage: function _getModeMessage() {
        // when recording a macro
        let macromode = "";
        if (this.recording)
            macromode = "recording " + this.recording + " ";
        else if (this.replaying)
            macromode = "replaying";

        if (!options.get("showmode").getKey(this.main.allBases, false))
            return macromode;

        let modeName = this._modeMap[this._main].display();
        if (!modeName)
            return macromode;

        if (macromode)
            macromode = " " + macromode;
        return "-- " + modeName + " --" + macromode;
    },

    NONE: 0,

    __iterator__: function __iterator__() array.iterValues(this.all),

    get all() this._modes.slice(),

    get mainModes() (mode for ([k, mode] in Iterator(modes._modeMap)) if (!mode.extended && mode.name == k)),

    get mainMode() this._modeMap[this._main],

    get passThrough() !!(this.main & (this.PASS_THROUGH|this.QUOTE)) ^ (this.getStack(1).main === this.PASS_THROUGH),

    get topOfStack() this._modeStack[this._modeStack.length - 1],

    addMode: function addMode(name, options, params) {
        let mode = Modes.Mode(name, options, params);

        this[name] = mode;
        if (mode.char)
            this.modeChars[mode.char] = (this.modeChars[mode.char] || []).concat(mode);
        this._modeMap[name] = mode;
        this._modeMap[mode] = mode;

        this._modes.push(mode);
        if (!mode.extended)
            this._mainModes.push(mode);

        dactyl.triggerObserver("modes.add", mode);
    },

    removeMode: function removeMode(mode) {
        this.remove(mode);
        if (this[mode.name] == mode)
            delete this[mode.name];
        if (this._modeMap[mode.name] == mode)
            delete this._modeMap[mode.name];
        if (this._modeMap[mode.mode] == mode)
            delete this._modeMap[mode.mode];

        this._mainModes = this._mainModes.filter(m => m != mode);
    },

    dumpStack: function dumpStack() {
        util.dump("Mode stack:");
        for (let [i, mode] in array.iterItems(this._modeStack))
            util.dump("    " + i + ": " + mode);
    },

    getMode: function getMode(name) this._modeMap[name],

    getStack: function getStack(idx) this._modeStack[this._modeStack.length - idx - 1] || this._modeStack[0],

    get stack() this._modeStack.slice(),

    getCharModes: function getCharModes(chr) (this.modeChars[chr] || []).slice(),

    have: function have(mode) this._modeStack.some(m => isinstance(m.main, mode)),

    matchModes: function matchModes(obj)
        this._modes.filter(mode => Object.keys(obj)
                                         .every(k => obj[k] == (mode[k] || false))),

    // show the current mode string in the command line
    show: function show() {
        if (!loaded.has("modes"))
            return;

        let msg = this._getModeMessage();

        if (msg || loaded.has("commandline"))
            commandline.widgets.mode = msg || null;
    },

    remove: function remove(mode, covert) {
        if (covert && this.topOfStack.main != mode) {
            util.assert(mode != this.NORMAL);

            this._modeStack = Modes.ModeStack(
                this._modeStack.filter(m => m.main != mode));
        }
        else if (this.stack.some(m => m.main == mode)) {
            this.pop(mode);
            this.pop();
        }
    },

    delayed: [],
    delay: function delay(callback, self) { this.delayed.push([callback, self]); },

    save: function save(id, obj, prop, test) {
        if (!(id in this.boundProperties))
            for (let elem in array.iterValues(this._modeStack))
                elem.saved[id] = { obj: obj, prop: prop, value: obj[prop], test: test };
        this.boundProperties[id] = { obj: util.weakReference(obj), prop: prop, test: test };
    },

    inSet: false,

    set: function set(mainMode, extendedMode, params, stack) {
        var delayed, oldExtended, oldMain, prev, push;

        if (this.inSet) {
            dactyl.reportError(Error(_("mode.recursiveSet")), true);
            return;
        }

        params = params || Object.create(this.getMode(mainMode || this.main).params);

        if (!stack && mainMode != null && this._modeStack.length > 1)
            this.reset();

        this.withSavedValues(["inSet"], function set() {
            this.inSet = true;

            oldMain = this._main, oldExtended = this._extended;

            if (extendedMode != null)
                this._extended = extendedMode;
            if (mainMode != null) {
                this._main = mainMode;
                if (!extendedMode)
                    this._extended = this.NONE;
            }

            if (stack && stack.pop && stack.pop.params.leave)
                dactyl.trapErrors("leave", stack.pop.params,
                                  stack, this.topOfStack);

            push = mainMode != null && !(stack && stack.pop) &&
                Modes.StackElement(this._main, this._extended, params, {});

            if (push && this.topOfStack) {
                if (this.topOfStack.params.leave)
                    dactyl.trapErrors("leave", this.topOfStack.params,
                                      { push: push }, push);

                for (let [id, { obj, prop, test }] in Iterator(this.boundProperties)) {
                    obj = obj.get();
                    if (!obj)
                        delete this.boundProperties[id];
                    else
                        this.topOfStack.saved[id] = { obj: obj, prop: prop, value: obj[prop], test: test };
                }
            }

            delayed = this.delayed;
            this.delayed = [];

            prev = stack && stack.pop || this.topOfStack;
            if (push)
                this._modeStack.push(push);
        });

        if (stack && stack.pop)
            for (let { obj, prop, value, test } in values(this.topOfStack.saved))
                if (!test || !test(stack, prev))
                    dactyl.trapErrors(function () { obj[prop] = value });

        this.show();

        if (this.topOfStack.params.enter && prev)
            dactyl.trapErrors("enter", this.topOfStack.params,
                              push ? { push: push } : stack || {},
                              prev);

        delayed.forEach(([fn, self]) => {
            dactyl.trapErrors(fn, self);
        });

        dactyl.triggerObserver("modes.change", [oldMain, oldExtended], [this._main, this._extended], stack);
        this.show();
    },

    onCaretChange: function onPrefChange(value) {
        if (!value && modes.main == modes.CARET)
            modes.pop();
        if (value && modes.main == modes.NORMAL)
            modes.push(modes.CARET);
    },

    push: function push(mainMode, extendedMode, params) {
        if (this.main == this.IGNORE)
            this.pop();

        this.set(mainMode, extendedMode, params, { push: this.topOfStack });
    },

    pop: function pop(mode, args) {
        while (this._modeStack.length > 1 && this.main != mode) {
            let a = this._modeStack.pop();
            this.set(this.topOfStack.main, this.topOfStack.extended, this.topOfStack.params,
                     update({ pop: a }, args));

            if (mode == null)
                return;
        }
    },

    replace: function replace(mode, oldMode, args) {
        while (oldMode && this._modeStack.length > 1 && this.main != oldMode)
            this.pop();

        if (this._modeStack.length > 1)
            this.set(mode, null, null,
                     update({ push: this.topOfStack, pop: this._modeStack.pop() },
                            args || {}));
        this.push(mode);
    },

    reset: function reset() {
        if (this._modeStack.length == 1 && this.topOfStack.params.enter)
            this.topOfStack.params.enter({}, this.topOfStack);
        while (this._modeStack.length > 1)
            this.pop();
    },

    get recording() this._recording,
    set recording(value) { this._recording = value; this.show(); },

    get replaying() this._replaying,
    set replaying(value) { this._replaying = value; this.show(); },

    get main() this._main,
    set main(value) { this.set(value); },

    get extended() this._extended,
    set extended(value) { this.set(null, value); }
}, {
    Mode: Class("Mode", {
        init: function init(name, options, params) {
            if (options.bases)
                util.assert(options.bases.every(m => m instanceof this.constructor),
                            _("mode.invalidBases"), false);

            this.update({
                id: 1 << Modes.Mode._id++,
                description: name,
                name: name,
                params: params || {}
            }, options);
        },

        description: Messages.Localized(""),

        displayName: Class.Memoize(function () this.name.split("_").map(util.capitalize).join(" ")),

        isinstance: function isinstance(obj)
            this.allBases.indexOf(obj) >= 0 || callable(obj) && this instanceof obj,

        allBases: Class.Memoize(function () {
            let seen = RealSet(),
                res = [],
                queue = [this].concat(this.bases);
            for (let mode in array.iterValues(queue))
                if (!seen.add(mode)) {
                    res.push(mode);
                    queue.push.apply(queue, mode.bases);
                }
            return res;
        }),

        get bases() this.input ? [modes.INPUT] : [modes.MAIN],

        get count() !this.insert,

        _display: Class.Memoize(function _display() this.name.replace("_", " ", "g")),

        display: function display() this._display,

        extended: false,

        hidden: false,

        input: Class.Memoize(function input() this.insert || this.bases.length && this.bases.some(b => b.input)),

        insert: Class.Memoize(function insert() this.bases.length && this.bases.some(b => b.insert)),

        ownsFocus: Class.Memoize(function ownsFocus() this.bases.length && this.bases.some(b => b.ownsFocus)),

        passEvent: function passEvent(event) this.input && event.charCode && !(event.ctrlKey || event.altKey || event.metaKey),

        passUnknown: Class.Memoize(function () options.get("passunknown").getKey(this.name)),

        get mask() this,

        get toStringParams() [this.name],

        valueOf: function valueOf() this.id
    }, {
        _id: 0
    }),
    ModeStack: function ModeStack(array)
        update(array, {
            pop: function pop() {
                if (this.length <= 1)
                    throw Error("Trying to pop last element in mode stack");
                return pop.superapply(this, arguments);
            }
        }),
    StackElement: (function () {
        const StackElement = Struct("main", "extended", "params", "saved");
        StackElement.className = "Modes.StackElement";
        StackElement.defaultValue("params", function () this.main.params);

        update(StackElement.prototype, {
            get toStringParams() !loaded.has("modes") ? [this.main.name] : [
                this.main.name,
                ["(", modes.all.filter(m => this.extended & m)
                               .map(m => m.name)
                               .join("|"),
                 ")"].join("")
            ]
        });
        return StackElement;
    })(),
    cacheId: 0,
    boundProperty: function BoundProperty(desc={}) {
        let id = this.cacheId++;
        let value;

        return Class.Property(update({
            configurable: true,
            enumerable: true,
            init: function bound_init(prop) update(this, {
                get: function bound_get() {
                    if (desc.get)
                        var val = desc.get.call(this, value);
                    return val === undefined ? value : val;
                },
                set: function bound_set(val) {
                    modes.save(id, this, prop, desc.test);
                    if (desc.set)
                        value = desc.set.call(this, val);
                    value = !desc.set || value === undefined ? val : value;
                }
            })
        }, desc));
    }
}, {
    cache: function initCache() {
        function makeTree() {
            let list = modes.all.filter(m => m.name !== m.description);

            let tree = {};

            for (let mode in values(list))
                tree[mode.name] = {};

            for (let mode in values(list))
                for (let base in values(mode.bases))
                    tree[base.name][mode.name] = tree[mode.name];

            let roots = iter([m.name, tree[m.name]]
                             for (m in values(list))
                             if (!m.bases.length)).toObject();

            function rec(obj) {
                let res = ["ul", { "dactyl:highlight": "Dense" }];
                Object.keys(obj).sort().forEach(function (name) {
                    let mode = modes.getMode(name);
                    res.push(["li", {},
                                ["em", {}, mode.displayName],
                                ": ", mode.description,
                                rec(obj[name])]);
                });

                if (res.length > 2)
                    return res;
                return [];
            }

            return rec(roots);
        }

        cache.register("modes.dtd",
            () => util.makeDTD(iter({ "modes.tree": makeTree() },
                                    config.dtd)),
            true);
    },
    mappings: function initMappings() {
        mappings.add([modes.BASE, modes.NORMAL],
            ["<Esc>", "<C-[>"],
            "Return to Normal mode",
            function () { modes.reset(); });

        mappings.add([modes.INPUT, modes.COMMAND, modes.OPERATOR, modes.PASS_THROUGH, modes.QUOTE],
            ["<Esc>", "<C-[>"],
            "Return to the previous mode",
            function () { modes.pop(null, { fromEscape: true }); });

        mappings.add([modes.AUTOCOMPLETE, modes.MENU], ["<C-c>"],
            "Leave Autocomplete or Menu mode",
            function () { modes.pop(); });

        mappings.add([modes.MENU], ["<Esc>"],
            "Close the current popup",
            function () {
                if (events.popups.active.length)
                    return Events.PASS_THROUGH;
                modes.pop();
            });

        mappings.add([modes.MENU], ["<C-[>"],
            "Close the current popup",
            function () { events.feedkeys("<Esc>"); });
    },
    options: function initOptions() {
        let opts = {
            completer: function completer(context, extra) {
                if (extra.value && context.filter[0] == "!")
                    context.advance(1);
                return completer.superapply(this, arguments);
            },

            getKey: function getKey(val, default_) {
                if (isArray(val))
                    return (this.value.find(v => val.some(m => m.name === v.mode))
                                || { result: default_ }).result;

                return hasOwnProperty(this.valueMap, val) ? this.valueMap[val] : default_;
            },

            setter: function (vals) {
                modes.all.forEach(function (m) { delete m.passUnknown; });

                vals = vals.map(v => update(new String(v.toLowerCase()),
                                            {
                                                mode: v.replace(/^!/, "").toUpperCase(),
                                                result: v[0] !== "!"
                                            }));

                this.valueMap = values(vals).map(v => [v.mode, v.result])
                                            .toObject();
                return vals;
            },

            validator: function validator(vals) vals.map(v => v.replace(/^!/, ""))
                                                    .every(k => hasOwnProperty(this.values, k)),

            get values() array.toObject([[m.name.toLowerCase(), m.description]
                                         for (m in values(modes._modes)) if (!m.hidden)])
        };

        options.add(["passunknown", "pu"],
            "Pass through unknown keys in these modes",
            "stringlist", "!text_edit,!visual,base",
            opts);

        options.add(["showmode", "smd"],
            "Show the current mode in the command line when it matches this expression",
            "stringlist", "caret,output_multiline,!normal,base,operator",
            opts);
    },
    prefs: function initPrefs() {
        prefs.watch("accessibility.browsewithcaret",
                    function () { modes.onCaretChange.apply(modes, arguments); });
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
