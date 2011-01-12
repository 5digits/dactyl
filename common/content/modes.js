// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var Modes = Module("modes", {
    init: function () {
        this.modeChars = {};
        this._main = 1;     // NORMAL
        this._extended = 0; // NONE

        this._lastShown = null;

        this._passNextKey = false;
        this._passAllKeys = false;
        this._recording = false;
        this._replaying = false; // playing a macro

        this._modeStack = update([], {
            pop: function pop() {
                if (this.length <= 1)
                    throw Error("Trying to pop last element in mode stack");
                return pop.superapply(this, arguments);
            }
        });

        this._modes = [];
        this._mainModes = [];
        this._modeMap = {};

        this.boundProperties = {};

        // main modes, only one should ever be active
        this.addMode("NORMAL", {
            char: "n",
            description: "Active when nothing is focused",
            display: function () null
        });
        this.addMode("INSERT", {
            char: "i",
            description: "Active when an input element is focused",
            input: true,
            ownsFocus: true
        });
        this.addMode("VISUAL", {
            char: "v",
            description: "Active when text is selected",
            ownsFocus: true,
            display: function () "VISUAL" + (this._extended & modes.LINE ? " LINE" : "")
        }, {
            leave: function (stack, newMode) {
                if (newMode.main == modes.CARET) {
                    let selection = content.getSelection();
                    if (selection && !selection.isCollapsed)
                        selection.collapseToStart();
                }
                else if (stack.pop)
                    editor.unselectText();
            }
        });

        this.addMode("COMMAND_LINE", {
            char: "c",
            description: "Active when the command line is focused",
            input: true
        });

        this.addMode("CARET", {
            description: "Active when the caret is visible in the web content",
        }, {

            get pref()    prefs.get("accessibility.browsewithcaret"),
            set pref(val) prefs.set("accessibility.browsewithcaret", val),

            enter: function (stack) {
                if (stack.pop && !this.pref)
                    modes.pop();
                else if (!stack.pop && !this.pref)
                    this.pref = true;
            },

            leave: function (stack) {
                if (!stack.push && this.pref)
                    this.pref = false;
            }
        });
        this.addMode("TEXT_EDIT", {
            char: "t",
            description: "Vim-like editing of input elements",
            ownsFocus: true
        });
        this.addMode("EMBED", {
            input: true,
            description: "Active when an <embed> or <object> element is focused",
            ownsFocus: true
        });
        this.addMode("PASS_THROUGH", {
            description: "All keys but <C-v> are ignored by " + config.appName,
            hidden: true
        });

        this.addMode("QUOTE", {
            hidden: true,
            description: "The next key sequence is ignored by " + config.appName + ", unless in Pass Through mode",
            display: function () modes.getStack(1).main == modes.PASS_THROUGH
                ? (modes.getStack(2).main.display() || modes.getStack(2).main.name) + " (next)"
                : "PASS THROUGH (next)"
        }, {
            // Fix me.
            preExecute: function (map) { if (modes.main == modes.QUOTE && map.name !== "<C-v>") modes.pop() },
            postExecute: function (map) { if (modes.main == modes.QUOTE && map.name === "<C-v>") modes.pop() },
            onEvent: function () { if (modes.main == modes.QUOTE) modes.pop() }
        });
        this.addMode("OUTPUT_MULTILINE", {
            description: "Active when the multi-line output buffer is open"
        });

        // this._extended modes, can include multiple modes, and even main modes
        this.addMode("EX", {
            extended: true,
            description: "Ex command mode, active when the command line is open for Ex commands",
            input: true
        });
        this.addMode("HINTS", {
            extended: true,
            description: "Active when selecting elements in QuickHint or ExtendedHint mode",
            count: false,
            ownsBuffer: true
        });
        this.addMode("INPUT_MULTILINE", {
            extended: true,
            hidden: true,
            input: true
        });
        this.addMode("MENU", {
            extended: true,
            input: true,
            description: "Active when a menu or other pop-up is open",
        }); // a popupmenu is active
        this.addMode("LINE", {
            extended: true, hidden: true
        }); // linewise visual mode
        this.addMode("PROMPT", {
            extended: true,
            description: "Active when a prompt is open in the command line",
            input: true
        });
        this.addMode("IGNORE", { hidden: true }, {
            onEvent: function (event) false
        });

        this.push(this.NORMAL, 0, {
            enter: function (stack, prev) {
                if (prefs.get("accessibility.browsewithcaret"))
                    prefs.set("accessibility.browsewithcaret", false);

                statusline.updateUrl();
                if (!stack.fromFocus && (prev.main.input || prev.main.ownsFocus))
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

    _getModeMessage: function () {
        // when recording a macro
        let macromode = "";
        if (modes.recording)
            macromode = "recording";
        else if (modes.replaying)
            macromode = "replaying";

        let ext = "";
        if (this._extended & modes.MENU) // TODO: desirable?
            ext += " (menu)";
        ext += " --" + macromode;

        let val = this._modeMap[this._main].display();
        if (val)
            return "-- " + val + ext;
        return macromode;
    },

    NONE: 0,

    __iterator__: function () array.iterValues(this.all),

    get all() this._modes.slice(),

    get mainModes() (mode for ([k, mode] in Iterator(modes._modeMap)) if (!mode.extended && mode.name == k)),

    get mainMode() this._modeMap[this._main],

    get passThrough() !!(this.main & (this.PASS_THROUGH|this.QUOTE)) ^ (this.getStack(1).main === this.PASS_THROUGH),

    get topOfStack() this._modeStack[this._modeStack.length - 1],

    addMode: function (name, options, params) {
        let mode = Modes.Mode(name, options, params);

        this[name] = mode;
        if (mode.char)
            this.modeChars[mode.char] = (this.modeChars[mode.char] || []).concat(mode);
        this._modeMap[name] = mode;
        this._modeMap[mode] = mode;

        this._modes.push(mode);
        if (!mode.extended)
            this._mainModes.push(mode);

        dactyl.triggerObserver("mode-add", mode);
    },

    dumpStack: function () {
        util.dump("Mode stack:");
        for (let [i, mode] in array.iterItems(this._modeStack))
            util.dump("    " + i + ": " + mode);
    },

    getMode: function (name) this._modeMap[name],

    getStack: function (idx) this._modeStack[this._modeStack.length - idx - 1] || this._modeStack[0],

    getCharModes: function (chr) (this.modeChars[chr] || []).slice(),

    matchModes: function (obj)
        this._modes.filter(function (mode) Object.keys(obj)
                                                 .every(function (k) obj[k] == (mode[k] || false))),

    // show the current mode string in the command line
    show: function show() {
        let msg = null;
        if (options["showmode"])
            msg = this._getModeMessage();
        if (loaded.commandline)
            commandline.widgets.mode = msg || null;
    },

    // add/remove always work on the this._extended mode only
    add: function add(mode) {
        this._extended |= mode;
        this.show();
    },

    delayed: [],
    delay: function (callback, self) { this.delayed.push([callback, self]); },

    save: function save(id, obj, prop) {
        if (!(id in this.boundProperties))
            for (let elem in array.iterValues(this._modeStack))
                elem.saved[id] = { obj: obj, prop: prop, value: obj[prop] };
        this.boundProperties[id] = { obj: Cu.getWeakReference(obj), prop: prop };
    },

    // helper function to set both modes in one go
    set: function set(mainMode, extendedMode, params, stack) {
        params = params || this.getMode(mainMode || this.main).params;

        if (!stack && mainMode != null && this._modeStack.length > 1)
            this.reset();

        let oldMain = this._main, oldExtended = this._extended;

        if (extendedMode != null)
            this._extended = extendedMode;
        if (mainMode != null) {
            this._main = mainMode;
            if (!extendedMode)
                this._extended = this.NONE;
        }

        if (stack && stack.pop && stack.pop.params.leave)
            stack.pop.params.leave(stack, this.topOfStack);

        let push = mainMode != null && !(stack && stack.pop) &&
            Modes.StackElement(this._main, this._extended, params, {});
        if (push && this.topOfStack) {
            if (this.topOfStack.params.leave)
                this.topOfStack.params.leave({ push: push }, push);
            for (let [id, { obj, prop }] in Iterator(this.boundProperties)) {
                if (!obj.get())
                    delete this.boundProperties[id];
                else
                    this.topOfStack.saved[id] = { obj: obj.get(), prop: prop, value: obj.get()[prop] };
            }
        }

        this.delayed.forEach(function ([fn, self]) fn.call(self));
        this.delayed = [];

        let prev = stack && stack.pop || this.topOfStack;
        if (push)
            this._modeStack.push(push);

        if (stack && stack.pop)
            for (let { obj, prop, value } in values(this.topOfStack.saved))
                obj[prop] = value;

        if (this.topOfStack.params.enter && prev)
            this.topOfStack.params.enter(push ? { push: push } : stack || {},
                                         prev);

        dactyl.triggerObserver("modeChange", [oldMain, oldExtended], [this._main, this._extended], stack);
        this.show();
    },

    onCaretChange: function onPrefChange(value) {
        if (!value && modes.main == modes.CARET)
            modes.pop();
        if (value && modes.main == modes.NORMAL)
            modes.push(modes.CARET);
    },

    push: function push(mainMode, extendedMode, params) {
        this.set(mainMode, extendedMode, params, { push: this.topOfStack });
    },

    pop: function pop(mode, args) {
        while (this._modeStack.length > 1 && this.main != mode) {
            let a = this._modeStack.pop();
            this.set(this.topOfStack.main, this.topOfStack.extended, this.topOfStack.params,
                     update({ pop: a }, args || {}));

            if (mode == null)
                return;
        }
    },

    replace: function replace(mode, oldMode) {
        while (oldMode && this._modeStack.length > 1 && this.main != oldMode)
            this.pop();

        if (this._modeStack.length > 1)
            this.set(mode, null, null, { push: this.topOfStack, pop: this._modeStack.pop() });
        this.push(mode);
    },

    reset: function reset() {
        if (this._modeStack.length == 1 && this.topOfStack.params.enter)
            this.topOfStack.params.enter({}, this.topOfStack);
        while (this._modeStack.length > 1)
            this.pop();
    },

    remove: function remove(mode) {
        if (this._extended & mode) {
            this._extended &= ~mode;
            this.show();
        }
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
            update(this, {
                id: 1 << Modes.Mode._id++,
                name: name,
                params: params || {}
            }, options);
        },

        toString: function () this.name,

        valueOf: function () this.id,

        count: true,

        get description() this.disp,

        disp: Class.memoize(function () this.name.replace("_", " ", "g")),

        display: function () this.disp,

        extended: false,

        hidden: false,

        input: false,

        get mask() this
    }, {
        _id: 0
    }),
    StackElement: (function () {
        const StackElement = Struct("main", "extended", "params", "saved");
        StackElement.defaultValue("params", function () this.main.params);
        update(StackElement.prototype, {
            toString: function () !loaded.modes ? this.main : "[mode " +
                this.main.name +
                (!this.extended ? "" :
                   "(" + modes.all.filter(function (m) this.extended & m)
                              .join("|") +
                   ")") + "]"
        });
        return StackElement;
    })(),
    cacheId: 0,
    boundProperty: function boundProperty(desc) {
        desc = desc || {};
        let id = this.cacheId++, value;
        return Class.Property(update({
            enumerable: true,
            configurable: true,
            init: function (prop) update(this, {
                get: function () {
                    if (desc.get)
                        var val = desc.get.call(this, value);
                    return val === undefined ? value : val;
                },
                set: function (val) {
                    modes.save(id, this, prop);
                    if (desc.set)
                        value = desc.set.call(this, val);
                    value = !desc.set || value === undefined ? val : value;
                }
            })
        }, desc));
    }
}, {
    prefs: function () {
        prefs.watch("accessibility.browsewithcaret", modes.closure.onCaretChange);
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
