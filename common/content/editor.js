// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

// command names taken from:
// http://developer.mozilla.org/en/docs/Editor_Embedding_Guide

/** @instance editor */
const Editor = Module("editor", {
    init: function () {
        // store our last search with f, F, t or T
        //
        this._lastFindChar = null;
        this._lastFindCharFunc = null;
    },

    get isCaret() modes.getStack(1).main === modes.CARET,
    get isTextEdit() modes.getStack(1).main === modes.TEXT_EDIT,

    line: function () {
        let line = 1;
        let text = Editor.getEditor().value;
        for (let i = 0; i < Editor.getEditor().selectionStart; i++)
            if (text[i] == "\n")
                line++;
        return line;
    },

    col: function () {
        let col = 1;
        let text = Editor.getEditor().value;
        for (let i = 0; i < Editor.getEditor().selectionStart; i++) {
            col++;
            if (text[i] == "\n")
                col = 1;
        }
        return col;
    },

    unselectText: function (toEnd) {
        let elem = dactyl.focus;
        // A error occurs if the element has been removed when "elem.selectionStart" is executed.
        try {
            if (elem && elem.selectionEnd)
                if (toEnd)
                    elem.selectionStart = elem.selectionEnd;
                else
                    elem.selectionEnd = elem.selectionStart;
        }
        catch (e) {}
    },

    selectedText: function () {
        let text = Editor.getEditor().value;
        return text.substring(Editor.getEditor().selectionStart, Editor.getEditor().selectionEnd);
    },

    pasteClipboard: function (clipboard, toStart) {
        if (util.isOS("WINNT")) {
            this.executeCommand("cmd_paste");
            return;
        }

        // FIXME: #93 (<s-insert> in the bottom of a long textarea bounces up)
        let elem = dactyl.focus;

        if (elem.setSelectionRange) {
            let text = dactyl.clipboardRead(clipboard);
            if (!text)
                return;

            // clipboardRead would return 'undefined' if not checked
            // dunno about .setSelectionRange
            // This is a hacky fix - but it works.
            let curTop = elem.scrollTop;
            let curLeft = elem.scrollLeft;

            let rangeStart = elem.selectionStart; // caret position
            let rangeEnd = elem.selectionEnd;
            let tempStr1 = elem.value.substring(0, rangeStart);
            let tempStr2 = text;
            let tempStr3 = elem.value.substring(rangeEnd);
            elem.value = tempStr1 + tempStr2 + tempStr3;
            elem.selectionStart = rangeStart + (toStart ? 0 : tempStr2.length);
            elem.selectionEnd = elem.selectionStart;

            elem.scrollTop = curTop;
            elem.scrollLeft = curLeft;
            let event = elem.ownerDocument.createEvent("Event");
            event.initEvent("input", true, false);
            elem.dispatchEvent(event);
        }
    },

    // count is optional, defaults to 1
    executeCommand: function (cmd, count) {
        let controller = Editor.getController();
        if (!controller || !controller.supportsCommand(cmd) || !controller.isCommandEnabled(cmd)) {
            dactyl.beep();
            return false;
        }

        if (typeof count != "number" || count < 1)
            count = 1;

        let didCommand = false;
        while (count--) {
            // some commands need this try/catch workaround, because a cmd_charPrevious triggered
            // at the beginning of the textarea, would hang the doCommand()
            // good thing is, we need this code anyway for proper beeping
            try {
                controller.doCommand(cmd);
                didCommand = true;
            }
            catch (e) {
                if (!didCommand)
                    dactyl.beep();
                return false;
            }
        }

        return true;
    },

    // cmd = y, d, c
    // motion = b, 0, gg, G, etc.
    executeCommandWithMotion: function (cmd, motion, count) {
        if (typeof count != "number" || count < 1)
            count = 1;

        if (cmd == motion) {
            motion = "j";
            count--;
        }

        if (modes.main != modes.VISUAL)
            modes.push(modes.VISUAL);

        switch (motion) {
        case "j":
            this.executeCommand("cmd_beginLine", 1);
            this.executeCommand("cmd_selectLineNext", count + 1);
            break;
        case "k":
            this.executeCommand("cmd_beginLine", 1);
            this.executeCommand("cmd_lineNext", 1);
            this.executeCommand("cmd_selectLinePrevious", count + 1);
            break;
        case "h":
            this.executeCommand("cmd_selectCharPrevious", count);
            break;
        case "l":
            this.executeCommand("cmd_selectCharNext", count);
            break;
        case "e":
        case "w":
            this.executeCommand("cmd_selectWordNext", count);
            break;
        case "b":
            this.executeCommand("cmd_selectWordPrevious", count);
            break;
        case "0":
        case "^":
            this.executeCommand("cmd_selectBeginLine", 1);
            break;
        case "$":
            this.executeCommand("cmd_selectEndLine", 1);
            break;
        case "gg":
            this.executeCommand("cmd_endLine", 1);
            this.executeCommand("cmd_selectTop", 1);
            this.executeCommand("cmd_selectBeginLine", 1);
            break;
        case "G":
            this.executeCommand("cmd_beginLine", 1);
            this.executeCommand("cmd_selectBottom", 1);
            this.executeCommand("cmd_selectEndLine", 1);
            break;

        default:
            dactyl.beep();
            return false;
        }

        switch (cmd) {
        case "d":
            this.executeCommand("cmd_delete", 1);
            modes.pop(modes.TEXT_EDIT);
            break;
        case "c":
            this.executeCommand("cmd_delete", 1);
            modes.pop(modes.TEXT_EDIT);
            modes.push(modes.INSERT);
            break;
        case "y":
            this.executeCommand("cmd_copy", 1);
            modes.pop(modes.TEXT_EDIT);
            break;

        default:
            dactyl.beep();
            return false;
        }
        return true;
    },

    // This function will move/select up to given "pos"
    // Simple setSelectionRange() would be better, but we want to maintain the correct
    // order of selectionStart/End (a Gecko bug always makes selectionStart <= selectionEnd)
    // Use only for small movements!
    moveToPosition: function (pos, forward, select) {
        if (!select) {
            Editor.getEditor().setSelectionRange(pos, pos);
            return;
        }

        if (forward) {
            if (pos <= Editor.getEditor().selectionEnd || pos > Editor.getEditor().value.length)
                return;

            do { // TODO: test code for endless loops
                this.executeCommand("cmd_selectCharNext", 1);
            }
            while (Editor.getEditor().selectionEnd != pos);
        }
        else {
            if (pos >= Editor.getEditor().selectionStart || pos < 0)
                return;

            do { // TODO: test code for endless loops
                this.executeCommand("cmd_selectCharPrevious", 1);
            }
            while (Editor.getEditor().selectionStart != pos);
        }
    },

    // returns the position of char
    findCharForward: function (ch, count) {
        if (!Editor.getEditor())
            return -1;

        this._lastFindChar = ch;
        this._lastFindCharFunc = this.findCharForward;

        let text = Editor.getEditor().value;
        if (!typeof count == "number" || count < 1)
            count = 1;

        for (let i = Editor.getEditor().selectionEnd + 1; i < text.length; i++) {
            if (text[i] == "\n")
                break;
            if (text[i] == ch)
                count--;
            if (count == 0)
                return i + 1; // always position the cursor after the char
        }

        dactyl.beep();
        return -1;
    },

    // returns the position of char
    findCharBackward: function (ch, count) {
        if (!Editor.getEditor())
            return -1;

        this._lastFindChar = ch;
        this._lastFindCharFunc = this.findCharBackward;

        let text = Editor.getEditor().value;
        if (!typeof count == "number" || count < 1)
            count = 1;

        for (let i = Editor.getEditor().selectionStart - 1; i >= 0; i--) {
            if (text[i] == "\n")
                break;
            if (text[i] == ch)
                count--;
            if (count == 0)
                return i;
        }

        dactyl.beep();
        return -1;
    },

    editFileExternally: function (path) {
        // TODO: save return value in v:shell_error
        let args = commands.parseArgs(options["editor"], { argCount: "*", allowUnknownOptions: true });

        dactyl.assert(args.length >= 1, "No editor specified");

        args.push(path);
        util.callInThread(null, io.run, io.expandPath(args.shift()), args, true);
    },

    // TODO: clean up with 2 functions for textboxes and currentEditor?
    editFieldExternally: function (forceEditing) {
        if (!options["editor"])
            return;

        let textBox = config.isComposeWindow ? null : dactyl.focus;

        if (!forceEditing && textBox && textBox.type == "password") {
            commandline.input("Editing a password field externally will reveal the password. Would you like to continue? (yes/[no]): ",
                function (resp) {
                    if (resp && resp.match(/^y(es)?$/i))
                        editor.editFieldExternally(true);
                });
                return;
        }

        let text = ""; // XXX
        if (textBox)
            text = textBox.value;
        else if (typeof GetCurrentEditor == "function") // Thunderbird composer
            text = GetCurrentEditor().outputToString("text/plain", 2);
        else
            return;

        let oldBg, tmpBg;
        try {
            let res = io.withTempFiles(function (tmpfile) {
                if (textBox) {
                    textBox.setAttribute("readonly", "true");
                    oldBg = textBox.style.backgroundColor;
                    tmpBg = "yellow";
                    textBox.style.backgroundColor = "#bbbbbb";
                }
                else
                    var editor = GetCurrentEditor();

                if (!tmpfile.write(text))
                    throw Error("Input contains characters not valid in the current " +
                                "file encoding");

                let lastUpdate = Date.now();
                function update(force) {
                    if (force !== true && tmpfile.lastModifiedTime <= lastUpdate)
                        return;
                    lastUpdate = Date.now();

                    let val = tmpfile.read();
                    if (textBox)
                        textBox.value = val;
                    else {
                        let wholeDocRange = editor.document.createRange();
                        let rootNode = editor.rootElement.QueryInterface(Ci.nsIDOMNode);
                        wholeDocRange.selectNodeContents(rootNode);
                        editor.selection.addRange(wholeDocRange);
                        editor.selection.deleteFromDocument();
                        editor.insertText(val);
                    }
                }

                let timer = services.create("timer");
                timer.initWithCallback({ notify: update }, 100, timer.TYPE_REPEATING_SLACK);

                try {
                    this.editFileExternally(tmpfile.path);
                }
                finally {
                    timer.cancel();
                }

                update(true);
                if (textBox)
                    textBox.removeAttribute("readonly");

            }, this);
            if (res == false)
                throw Error("Couldn't create temporary file");
        }
        catch (e) {
            // Errors are unlikely, and our error messages won't
            // likely be any more helpful than that given in the
            // exception.
            dactyl.echoerr(e);
            tmpBg = "red";
        }

        // blink the textbox after returning
        if (textBox) {
            let colors = [tmpBg, oldBg, tmpBg, oldBg];
            (function next() {
                textBox.style.backgroundColor = colors.shift();
                if (colors.length > 0)
                    util.timeout(next, 100);
            })();
        }

        return;
    },

    /**
     * Expands an abbreviation in the currently active textbox.
     *
     * @param {string} mode The mode filter.
     * @see #addAbbreviation
     */
    expandAbbreviation: function (mode) {
        let textbox   = Editor.getEditor();
        if (!(textbox && textbox.value))
            return false;
        let text      = textbox.value;
        let currStart = textbox.selectionStart;
        let currEnd   = textbox.selectionEnd;
        let abbrev    = abbreviations.match(mode, text.substring(0, currStart).replace(/.*\s/g, ""));
        if (abbrev) {
            let len = abbrev.lhs.length;
            let abbrText = abbrev.expand(textbox);
            text = text.substring(0, currStart - len) + abbrText + text.substring(currStart);
            textbox.value = text;
            textbox.selectionStart = currStart - len + abbrText.length;
            textbox.selectionEnd   = currEnd   - len + abbrText.length;
        }
        return true;
    },
}, {
    getEditor: function () dactyl.focus,

    getController: function () {
        let ed = Editor.getEditor();
        if (!ed || !ed.controllers)
            return null;

        return ed.controllers.getControllerForCommand("cmd_beginLine");
    }
}, {
    mappings: function () {
        var myModes = [modes.INSERT, modes.COMMAND_LINE];

        // add mappings for commands like h,j,k,l,etc. in CARET, VISUAL and TEXT_EDIT mode
        function addMovementMap(keys, hasCount, caretModeMethod, caretModeArg, textEditCommand, visualTextEditCommand) {
            let extraInfo = {};
            if (hasCount)
                extraInfo.count = true;

            function caretExecute(arg, again) {
                function fixSelection() {
                    sel.removeAllRanges();
                    sel.addRange(RangeFind.endpoint(
                        RangeFind.nodeRange(buffer.focusedFrame.document.documentElement),
                        true));
                }

                let controller = buffer.selectionController;
                let sel = controller.getSelection(controller.SELECTION_NORMAL);
                if (!sel.rangeCount) // Hack.
                    fixSelection();

                try {
                    controller[caretModeMethod](caretModeArg, arg);
                }
                catch (e) {
                    dactyl.assert(again && e.result === Cr.NS_ERROR_FAILURE);
                    fixSelection();
                    caretExecute(arg, false);
                }
                return false;
            }

            mappings.add([modes.CARET], keys, "",
                function (count) {
                    if (typeof count != "number" || count < 1)
                        count = 1;

                    while (count--)
                        caretExecute(false, true);
                },
                extraInfo);

            mappings.add([modes.VISUAL], keys, "",
                function (count) {
                    if (typeof count != "number" || count < 1 || !hasCount)
                        count = 1;

                    let controller = buffer.selectionController;
                    while (count-- && modes.main == modes.VISUAL) {
                        if (editor.isTextEdit) {
                            if (typeof visualTextEditCommand == "function")
                                visualTextEditCommand();
                            else
                                editor.executeCommand(visualTextEditCommand);
                        }
                        else
                            caretExecute(true, true);
                    }
                },
                extraInfo);

            mappings.add([modes.TEXT_EDIT], keys, "",
                function (count) {
                    if (typeof count != "number" || count < 1)
                        count = 1;

                    editor.executeCommand(textEditCommand, count);
                },
                extraInfo);
        }

        // add mappings for commands like i,a,s,c,etc. in TEXT_EDIT mode
        function addBeginInsertModeMap(keys, commands) {
            mappings.add([modes.TEXT_EDIT], keys, "",
                function (count) {
                    commands.forEach(function (cmd)
                        editor.executeCommand(cmd, 1));
                    modes.push(modes.INSERT);
                });
        }

        function addMotionMap(key) {
            mappings.add([modes.TEXT_EDIT], [key],
                "Motion command",
                function (motion, count) { editor.executeCommandWithMotion(key, motion, count); },
                { count: true, motion: true });
        }
        function selectPreviousLine() {
            editor.executeCommand("cmd_selectLinePrevious");
            if ((modes.extended & modes.LINE) && !editor.selectedText())
                editor.executeCommand("cmd_selectLinePrevious");
        }
        function selectNextLine() {
            editor.executeCommand("cmd_selectLineNext");
            if ((modes.extended & modes.LINE) && !editor.selectedText())
                editor.executeCommand("cmd_selectLineNext");
        }

        //             KEYS                          COUNT  CARET                   TEXT_EDIT            VISUAL_TEXT_EDIT
        addMovementMap(["k", "<Up>"],                true,  "lineMove", false,      "cmd_linePrevious", selectPreviousLine);
        addMovementMap(["j", "<Down>", "<Return>"],  true,  "lineMove", true,       "cmd_lineNext",     selectNextLine);
        addMovementMap(["h", "<Left>", "<BS>"],      true,  "characterMove", false, "cmd_charPrevious", "cmd_selectCharPrevious");
        addMovementMap(["l", "<Right>", "<Space>"],  true,  "characterMove", true,  "cmd_charNext",     "cmd_selectCharNext");
        addMovementMap(["b", "B", "<C-Left>"],       true,  "wordMove", false,      "cmd_wordPrevious", "cmd_selectWordPrevious");
        addMovementMap(["w", "W", "e", "<C-Right>"], true,  "wordMove", true,       "cmd_wordNext",     "cmd_selectWordNext");
        addMovementMap(["<C-f>", "<PageDown>"],      true,  "pageMove", true,       "cmd_movePageDown", "cmd_selectNextPage");
        addMovementMap(["<C-b>", "<PageUp>"],        true,  "pageMove", false,      "cmd_movePageUp",   "cmd_selectPreviousPage");
        addMovementMap(["gg", "<C-Home>"],           false, "completeMove", false,  "cmd_moveTop",      "cmd_selectTop");
        addMovementMap(["G", "<C-End>"],             false, "completeMove", true,   "cmd_moveBottom",   "cmd_selectBottom");
        addMovementMap(["0", "^", "<Home>"],         false, "intraLineMove", false, "cmd_beginLine",    "cmd_selectBeginLine");
        addMovementMap(["$", "<End>"],               false, "intraLineMove", true,  "cmd_endLine" ,     "cmd_selectEndLine" );

        addBeginInsertModeMap(["i", "<Insert>"], []);
        addBeginInsertModeMap(["a"],             ["cmd_charNext"]);
        addBeginInsertModeMap(["I", "gI"],       ["cmd_beginLine"]);
        addBeginInsertModeMap(["A"],             ["cmd_endLine"]);
        addBeginInsertModeMap(["s"],             ["cmd_deleteCharForward"]);
        addBeginInsertModeMap(["S"],             ["cmd_deleteToEndOfLine", "cmd_deleteToBeginningOfLine"]);
        addBeginInsertModeMap(["C"],             ["cmd_deleteToEndOfLine"]);

        addMotionMap("d"); // delete
        addMotionMap("c"); // change
        addMotionMap("y"); // yank

        // insert mode mappings
        mappings.add(myModes,
            ["<C-w>"], "Delete previous word",
            function () { editor.executeCommand("cmd_deleteWordBackward", 1); });

        mappings.add(myModes,
            ["<C-u>"], "Delete until beginning of current line",
            function () {
                // broken in FF3, deletes the whole line:
                // editor.executeCommand("cmd_deleteToBeginningOfLine", 1);
                editor.executeCommand("cmd_selectBeginLine", 1);
                if (Editor.getController().isCommandEnabled("cmd_delete"))
                    editor.executeCommand("cmd_delete", 1);
            });

        mappings.add(myModes,
            ["<C-k>"], "Delete until end of current line",
            function () { editor.executeCommand("cmd_deleteToEndOfLine", 1); });

        mappings.add(myModes,
            ["<C-a>"], "Move cursor to beginning of current line",
            function () { editor.executeCommand("cmd_beginLine", 1); });

        mappings.add(myModes,
            ["<C-e>"], "Move cursor to end of current line",
            function () { editor.executeCommand("cmd_endLine", 1); });

        mappings.add(myModes,
            ["<C-h>"], "Delete character to the left",
            function () { events.feedkeys("<BS>", true); });

        mappings.add(myModes,
            ["<C-d>"], "Delete character to the right",
            function () { editor.executeCommand("cmd_deleteCharForward", 1); });

        /*mappings.add(myModes,
            ["<C-Home>"], "Move cursor to beginning of text field",
            function () { editor.executeCommand("cmd_moveTop", 1); });

        mappings.add(myModes,
            ["<C-End>"], "Move cursor to end of text field",
            function () { editor.executeCommand("cmd_moveBottom", 1); });*/

        mappings.add(myModes,
            ["<S-Insert>"], "Insert clipboard/selection",
            function () { editor.pasteClipboard(); });

        mappings.add(modes.getCharModes("i"),
            ["<C-i>"], "Edit text field with an external editor",
            function () { editor.editFieldExternally(); });

        mappings.add([modes.INSERT],
            ["<C-t>"], "Edit text field in Vi mode",
            function () {
                if (!editor.isTextEdit)
                    modes.push(modes.TEXT_EDIT);
                else
                    dactyl.beep();
            });

        mappings.add([modes.INSERT],
            ["<Space>", "<Return>"], "Expand insert mode abbreviation",
            function () { editor.expandAbbreviation(modes.INSERT); },
            { route: true });

        mappings.add([modes.INSERT],
            ["<Tab>"], "Expand insert mode abbreviation",
            function () {
                editor.expandAbbreviation(modes.INSERT);
                document.commandDispatcher.advanceFocus();
            });

        mappings.add([modes.INSERT],
            ["<C-]>", "<C-5>"], "Expand insert mode abbreviation",
            function () { editor.expandAbbreviation(modes.INSERT); });

        // text edit mode
        mappings.add([modes.TEXT_EDIT],
            ["u"], "Undo",
            function (count) {
                editor.executeCommand("cmd_undo", count);
                editor.unselectText();
            },
            { count: true });

        mappings.add([modes.TEXT_EDIT],
            ["<C-r>"], "Redo",
            function (count) {
                editor.executeCommand("cmd_redo", count);
                editor.unselectText();
            },
            { count: true });

        mappings.add([modes.TEXT_EDIT],
            ["D"], "Delete the characters under the cursor until the end of the line",
            function () { editor.executeCommand("cmd_deleteToEndOfLine"); });

        mappings.add([modes.TEXT_EDIT],
            ["o"], "Open line below current",
            function (count) {
                editor.executeCommand("cmd_endLine", 1);
                modes.push(modes.INSERT);
                events.feedkeys("<Return>");
            });

        mappings.add([modes.TEXT_EDIT],
            ["O"], "Open line above current",
            function (count) {
                editor.executeCommand("cmd_beginLine", 1);
                modes.push(modes.INSERT);
                events.feedkeys("<Return>");
                editor.executeCommand("cmd_linePrevious", 1);
            });

        mappings.add([modes.TEXT_EDIT],
            ["X"], "Delete character to the left",
            function (count) { editor.executeCommand("cmd_deleteCharBackward", count); },
            { count: true });

        mappings.add([modes.TEXT_EDIT],
            ["x"], "Delete character to the right",
            function (count) { editor.executeCommand("cmd_deleteCharForward", count); },
            { count: true });

        // visual mode
        mappings.add([modes.CARET, modes.TEXT_EDIT],
            ["v"], "Start visual mode",
            function (count) { modes.push(modes.VISUAL); });

        mappings.add([modes.VISUAL],
            ["v"], "End visual mode",
            function (count) { events.onEscape(); });

        mappings.add([modes.TEXT_EDIT],
            ["V"], "Start visual line mode",
            function (count) {
                modes.push(modes.VISUAL, modes.LINE);
                editor.executeCommand("cmd_beginLine", 1);
                editor.executeCommand("cmd_selectLineNext", 1);
            });

        mappings.add([modes.VISUAL],
            ["c", "s"], "Change selected text",
            function (count) {
                dactyl.assert(editor.isTextEdit);
                editor.executeCommand("cmd_cut");
                modes.push(modes.INSERT);
            });

        mappings.add([modes.VISUAL],
            ["d"], "Delete selected text",
            function (count) {
                if (editor.isTextEdit) {
                    editor.executeCommand("cmd_cut");
                    modes.pop();
                }
                else
                    dactyl.beep();
            });

        mappings.add([modes.VISUAL],
            ["y"], "Yank selected text",
            function (count) {
                if (editor.isTextEdit) {
                    editor.executeCommand("cmd_copy");
                    modes.pop();
                }
                else
                    dactyl.clipboardWrite(buffer.getCurrentWord(), true);
            });

        mappings.add([modes.VISUAL, modes.TEXT_EDIT],
            ["p"], "Paste clipboard contents",
            function (count) {
                dactyl.assert(!editor.isCaret);
                if (!count)
                    count = 1;
                while (count--)
                    editor.executeCommand("cmd_paste");
                modes.pop(modes.TEXT_EDIT);
            });

        // finding characters
        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["f"], "Move to a character on the current line after the cursor",
            function (count, arg) {
                let pos = editor.findCharForward(arg, count);
                if (pos >= 0)
                    editor.moveToPosition(pos, true, dactyl.mode == modes.VISUAL);
            },
            { arg: true, count: true });

        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["F"], "Move to a charater on the current line before the cursor",
            function (count, arg) {
                let pos = editor.findCharBackward(arg, count);
                if (pos >= 0)
                    editor.moveToPosition(pos, false, dactyl.mode == modes.VISUAL);
            },
            { arg: true, count: true });

        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["t"], "Move before a character on the current line",
            function (count, arg) {
                let pos = editor.findCharForward(arg, count);
                if (pos >= 0)
                    editor.moveToPosition(pos - 1, true, dactyl.mode == modes.VISUAL);
            },
            { arg: true, count: true });

        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["T"], "Move before a character on the current line, backwards",
            function (count, arg) {
                let pos = editor.findCharBackward(arg, count);
                if (pos >= 0)
                    editor.moveToPosition(pos + 1, false, dactyl.mode == modes.VISUAL);
            },
            { arg: true, count: true });

            // text edit and visual mode
        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["~"], "Switch case of the character under the cursor and move the cursor to the right",
            function (count) {
                if (modes.main == modes.VISUAL)
                    count = Editor.getEditor().selectionEnd - Editor.getEditor().selectionStart;
                if (typeof count != "number" || count < 1)
                    count = 1;

                while (count-- > 0) {
                    let text = Editor.getEditor().value;
                    let pos = Editor.getEditor().selectionStart;
                    dactyl.assert(pos < text.length);

                    let chr = text[pos];
                    Editor.getEditor().value = text.substring(0, pos) +
                        (chr == chr.toLocaleLowerCase() ? chr.toLocaleUpperCase() : chr.toLocaleLowerCase()) +
                        text.substring(pos + 1);
                    editor.moveToPosition(pos + 1, true, false);
                }
                modes.pop(modes.TEXT_EDIT);
            },
            { count: true });
    },

    options: function () {
        options.add(["editor"],
            "Set the external text editor",
            "string", "gvim -f");

        options.add(["insertmode", "im"],
            "Use Insert mode as the default for text areas",
            "boolean", true);
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
