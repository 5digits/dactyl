// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

const Modes = Module("modes", {
    init: function () {
        this.modeChars = {};
        this._main = 1;     // NORMAL
        this._extended = 0; // NONE

        this._lastShown = null;

        this._passNextKey = false;
        this._passAllKeys = false;
        this._isRecording = false;
        this._isReplaying = false; // playing a macro

        this._modeStack = [];

        this._mainModes = [this.NONE];
        this._lastMode = 0;
        this._modeMap = {};

        this.boundProperties = {};

        // main modes, only one should ever be active
        this.addMode("NORMAL",   { char: "n", display: -1 });
        this.addMode("INSERT",   { char: "i", input: true });
        this.addMode("VISUAL",   { char: "v", display: function () "VISUAL" + (this._extended & modes.LINE ? " LINE" : "") });
        this.addMode("COMMAND_LINE", { char: "c", input: true });
        this.addMode("CARET"); // text cursor is visible
        this.addMode("TEXTAREA", { char: "i" });
        this.addMode("EMBED",    { input: true });
        this.addMode("CUSTOM",   { display: function () plugins.mode });
        // this._extended modes, can include multiple modes, and even main modes
        this.addMode("EX", true);
        this.addMode("HINTS", true);
        this.addMode("INPUT_MULTILINE", true);
        this.addMode("OUTPUT_MULTILINE", true);
        this.addMode("SEARCH_FORWARD", true);
        this.addMode("SEARCH_BACKWARD", true);
        this.addMode("SEARCH_VIEW_FORWARD", true);
        this.addMode("SEARCH_VIEW_BACKWARD", true);
        this.addMode("MENU", true); // a popupmenu is active
        this.addMode("LINE", true); // linewise visual mode
        this.addMode("PROMPT", true);

        this.push(this.NORMAL, 0, {
            restore: function (prev) {
                // disable caret mode when we want to switch to normal mode
                if (options.getPref("accessibility.browsewithcaret"))
                    options.setPref("accessibility.browsewithcaret", false);

                statusline.updateUrl();
                dactyl.focusContent(true);
            }
        });
    },

    _getModeMessage: function () {
        if (this._passNextKey && !this._passAllKeys)
            return "-- PASS THROUGH (next) --";
        else if (this._passAllKeys && !this._passNextKey)
            return "-- PASS THROUGH --";

        // when recording a macro
        let macromode = "";
        if (modes.isRecording)
            macromode = "recording";
        else if (modes.isReplaying)
            macromode = "replaying";

        let ext = "";
        if (this._extended & modes.MENU) // TODO: desirable?
            ext += " (menu)";
        ext += " --" + macromode;

        if (this._main in this._modeMap && typeof this._modeMap[this._main].display == "function")
            return "-- " + this._modeMap[this._main].display() + ext;
        return macromode;
    },

    NONE: 0,

    __iterator__: function () array.iterValues(this.all),

    get all() this._mainModes.slice(),

    get mainModes() (mode for ([k, mode] in Iterator(modes._modeMap)) if (!mode.extended && mode.name == k)),

    get mainMode() this._modeMap[this._main],

    get topOfStack() this._modeStack[this._modeStack.length - 1],

    addMode: function (name, extended, options) {
        let disp = name.replace("_", " ", "g");
        this[name] = 1 << this._lastMode++;
        if (typeof extended == "object") {
            options = extended;
            extended = false;
        }
        let mode = util.extend({
            extended: extended,
            count: true,
            input: false,
            mask: this[name],
            name: name,
            disp: disp
        }, options);
        if (mode.char) {
            this.modeChars[mode.char] = this.modeChars[mode.char] || [];
            this.modeChars[mode.char].push(mode);
        }

        mode.display = mode.display || function () disp;
        this._modeMap[name] = mode;
        this._modeMap[this[name]] = mode;
        if (!extended)
            this._mainModes.push(this[name]);
        dactyl.triggerObserver("mode-add", mode);
    },

    getMode: function (name) this._modeMap[name],

    getCharModes: function (chr) [m for (m in values(this._modeMap)) if (m.char == chr)],

    matchModes: function (obj)
        [m for (m in values(this._modeMap)) if (Object.keys(obj).every(function (k) obj[k] == (m[k] || false)))],

    // show the current mode string in the command line
    show: function () {
        let msg = null;
        if (options["showmode"])
            msg = this._getModeMessage();
        commandline.widgets.mode = msg || null;
    },

    // add/remove always work on the this._extended mode only
    add: function (mode) {
        this._extended |= mode;
        this.show();
    },

    save: function (id, obj, prop) {
        this.boundProperties[id] = { obj: Cu.getWeakReference(obj), prop: prop };
    },

    // helper function to set both modes in one go
    // if silent == true, you also need to take care of the mode handling changes yourself
    set: function (mainMode, extendedMode, params, stack) {
        params = params || {};

        if (!stack && mainMode != null)
            this.reset();

        let push = mainMode != null && !(stack && stack.pop) &&
            Modes.StackElem(mainMode, extendedMode || this.NONE, params, {});
        if (push && this.topOfStack) {
            if (this.topOfStack.params.save)
                this.topOfStack.params.save(push);

            for (let [id, { obj, prop }] in Iterator(this.boundProperties)) {
                if (!obj.get())
                    delete this.boundProperties(id);
                else
                    this.topOfStack.saved[id] = { obj: obj.get(), prop: prop, value: obj.get()[prop] };
            }
        }

        let silent = this._main === mainMode && this._extended === extendedMode;
        // if a this._main mode is set, the this._extended is always cleared
        let oldMain = this._main, oldExtended = this._extended;

        if (typeof extendedMode === "number")
            this._extended = extendedMode;
        if (typeof mainMode === "number") {
            this._main = mainMode;
            if (!extendedMode)
                this._extended = this.NONE;
        }

        if (push)
            this._modeStack.push(push);

        dactyl.triggerObserver("modeChange", [oldMain, oldExtended], [this._main, this._extended], stack);

        if (!silent)
            this.show();
    },

    push: function (mainMode, extendedMode, params) {
        this.set(mainMode, extendedMode, params, { push: this.topOfStack });
    },

    pop: function () {
        let a = this._modeStack.pop();
        if (a.params.leave)
            a.params.leave(this.topOfStack);

        this.set(this.topOfStack.main, this.topOfStack.extended, this.topOfStack.params, { pop: a });
        if (this.topOfStack.params.restore)
            this.topOfStack.params.restore(a);

        for (let [k, { obj, prop, value }] in Iterator(this.topOfStack.saved))
            obj[prop] = value;
    },

    reset: function () {
        if (this._modeStack.length == 1 && this.topOfStack.params.restore)
            this.topOfStack.params.restore(this.topOfStack);
        while (this._modeStack.length > 1)
            this.pop();
    },

    remove: function (mode) {
        if (this._extended & mode) {
            this._extended &= ~mode;
            this.show();
        }
    },

    get passNextKey() this._passNextKey,
    set passNextKey(value) { this._passNextKey = value; this.show(); },

    get passAllKeys() this._passAllKeys,
    set passAllKeys(value) { this._passAllKeys = value; this.show(); },

    get isRecording() this._isRecording,
    set isRecording(value) { this._isRecording = value; this.show(); },

    get isReplaying() this._isReplaying,
    set isReplaying(value) { this._isReplaying = value; this.show(); },

    get main() this._main,
    set main(value) { this.set(value); },

    get extended() this._extended,
    set extended(value) { this.set(null, value); }
}, {
    StackElem: Struct("main", "extended", "params", "saved"),
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
                    if (desc.set)
                        value = desc.set.call(this, val);
                    value = !desc.set || value === undefined ? val : value;
                    modes.save(id, this, prop)
                }
            })
        }, desc));
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
