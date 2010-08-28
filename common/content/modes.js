// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2009 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

const Modes = Module("modes", {
    requires: ["config", "util"],

    init: function () {
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

        config.modes.forEach(function (mode) { this.addMode.apply(this, mode); }, this);
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

    // NOTE: Pay attention that you don't run into endless loops
    // Usually you should only indicate to leave a special mode like HINTS
    // by calling modes.reset() and adding the stuff which is needed
    // for its cleanup here
    _handleModeChange: function (oldMode, newMode, oldExtended) {

        switch (oldMode) {
        case modes.TEXTAREA:
        case modes.INSERT:
            editor.unselectText();
            break;

        case modes.VISUAL:
            if (newMode == modes.CARET) {
                try { // clear any selection made; a simple if (selection) does not work
                    let selection = window.content.getSelection();
                    selection.collapseToStart();
                }
                catch (e) {}
            }
            else
                editor.unselectText();
            break;

        case modes.CUSTOM:
            plugins.stop();
            break;

        case modes.COMMAND_LINE:
            // clean up for HINT mode
            if (oldExtended & modes.HINTS)
                hints.hide();
            commandline.close();
            break;
        }

        if (newMode == modes.NORMAL) {
            // disable caret mode when we want to switch to normal mode
            if (options.getPref("accessibility.browsewithcaret"))
                options.setPref("accessibility.browsewithcaret", false);

            statusline.updateUrl();
            dactyl.focusContent(true);
        }
    },

    NONE: 0,

    __iterator__: function () util.Array.itervalues(this.all),

    get all() this._mainModes.slice(),

    get mainModes() (mode for ([k, mode] in Iterator(modes._modeMap)) if (!mode.extended && mode.name == k)),

    get mainMode() this._modeMap[this._main],

    addMode: function (name, extended, options) {
        let disp = name.replace("_", " ", "g");
        this[name] = 1 << this._lastMode++;
        if (typeof extended == "object") {
            options = extended;
            extended = false;
        }
        this._modeMap[name] = this._modeMap[this[name]] = util.extend({
            extended: extended,
            count: true,
            input: false,
            mask: this[name],
            name: name,
            disp: disp
        }, options);
        this._modeMap[name].display = this._modeMap[name].display || function () disp;
        if (!extended)
            this._mainModes.push(this[name]);
        if ("mappings" in modules)
            mappings.addMode(this[name]);
    },

    getMode: function (name) this._modeMap[name],

    getCharModes: function (chr) [m for (m in values(this._modeMap)) if (m.char == chr)],

    matchModes: function (obj) [m for (m in values(this._modeMap)) if (array(keys(obj)).every(function (k) obj[k] == (m[k] || false)))],

    // show the current mode string in the command line
    show: function () {
        let msg = "";
        if (options["showmode"])
            msg = this._getModeMessage();

        commandline.echo(msg, "ModeMsg", commandline.FORCE_SINGLELINE);
    },

    // add/remove always work on the this._extended mode only
    add: function (mode) {
        this._extended |= mode;
        this.show();
    },

    // helper function to set both modes in one go
    // if silent == true, you also need to take care of the mode handling changes yourself
    set: function (mainMode, extendedMode, silent, stack) {
        silent = (silent || this._main == mainMode && this._extended == extendedMode);
        // if a this._main mode is set, the this._extended is always cleared
        let oldMain = this._main, oldExtended = this._extended;
        if (typeof extendedMode === "number")
            this._extended = extendedMode;
        if (typeof mainMode === "number") {
            this._main = mainMode;
            if (!extendedMode)
                this._extended = modes.NONE;

            if (this._main != oldMain)
                this._handleModeChange(oldMain, mainMode, oldExtended);
        }
        dactyl.triggerObserver("modeChange", [oldMain, oldExtended], [this._main, this._extended], stack);

        if (!silent)
            this.show();
    },

    push: function (mainMode, extendedMode, silent) {
        this._modeStack.push([this._main, this._extended]);
        this.set(mainMode, extendedMode, silent, { push: this._modeStack[this._modeStack.length - 1] });
    },

    pop: function (silent) {
        let a = this._modeStack.pop();
        if (a)
            this.set(a[0], a[1], silent, { pop: a });
        else
            this.reset(silent);
    },

    // TODO: Deprecate this in favor of addMode? --Kris
    //       Ya --djk
    setCustomMode: function (modestr, oneventfunc, stopfunc) {
        // TODO this.plugin[id]... ('id' maybe submode or what..)
        plugins.mode = modestr;
        plugins.onEvent = oneventfunc;
        plugins.stop = stopfunc;
    },

    // keeps recording state
    reset: function (silent) {
        this._modeStack = [];
        if (config.isComposeWindow)
            this.set(modes.COMPOSE, modes.NONE, silent);
        else
            this.set(modes.NORMAL, modes.NONE, silent);
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

    get isRecording()  this._isRecording,
    set isRecording(value) { this._isRecording = value; this.show(); },

    get isReplaying() this._isReplaying,
    set isReplaying(value) { this._isReplaying = value; this.show(); },

    get main() this._main,
    set main(value) { this.set(value); },

    get extended() this._extended,
    set extended(value) { this.set(null, value); }
});

// vim: set fdm=marker sw=4 ts=4 et:
