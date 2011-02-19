// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

// command names taken from:
// http://developer.mozilla.org/en/docs/Editor_Embedding_Guide

/** @instance editor */
var Editor = Module("editor", {
    get isCaret() modes.getStack(1).main == modes.CARET,
    get isTextEdit() modes.getStack(1).main == modes.TEXT_EDIT,

    unselectText: function (toEnd) {
        try {
            Editor.getEditor(null).selection[toEnd ? "collapseToEnd" : "collapseToStart"]();
        }
        catch (e) {}
    },

    selectedText: function () String(Editor.getEditor(null).selection),

    pasteClipboard: function (clipboard, toStart) {
        // TODO: I don't think this is needed anymore? --djk
        if (util.OS.isWindows) {
            this.executeCommand("cmd_paste");
            return;
        }

        let elem = dactyl.focusedElement;
        if (elem.inputField)
            elem = elem.inputField;

        if (elem.setSelectionRange) {
            let text = dactyl.clipboardRead(clipboard);
            if (!text)
                return;
            if (isinstance(elem, [HTMLInputElement, XULTextBoxElement]))
                text = text.replace(/\n+/g, "");

            // This is a hacky fix - but it works.
            // <s-insert> in the bottom of a long textarea bounces up
            let top = elem.scrollTop;
            let left = elem.scrollLeft;

            let start = elem.selectionStart; // caret position
            let end = elem.selectionEnd;
            let value = elem.value.substring(0, start) + text + elem.value.substring(end);
            elem.value = value;

            if (/^(search|text)$/.test(elem.type))
                Editor.getEditor(elem).rootElement.firstChild.textContent = value;

            elem.selectionStart = Math.min(start + (toStart ? 0 : text.length), elem.value.length);
            elem.selectionEnd = elem.selectionStart;

            elem.scrollTop = top;
            elem.scrollLeft = left;

            events.dispatch(elem, events.create(elem.ownerDocument, "input"));
        }
    },

    // count is optional, defaults to 1
    executeCommand: function (cmd, count) {
        let editor = Editor.getEditor(null);
        let controller = Editor.getController();
        dactyl.assert(callable(cmd) ||
                          controller &&
                          controller.supportsCommand(cmd) &&
                          controller.isCommandEnabled(cmd));

        // XXX: better as a precondition
        if (count == null)
          count = 1;

        let didCommand = false;
        while (count--) {
            // some commands need this try/catch workaround, because a cmd_charPrevious triggered
            // at the beginning of the textarea, would hang the doCommand()
            // good thing is, we need this code anyway for proper beeping
            try {
                if (callable(cmd))
                    cmd(editor, controller);
                else
                    controller.doCommand(cmd);
                didCommand = true;
            }
            catch (e) {
                util.reportError(e);
                dactyl.assert(didCommand);
                break;
            }
        }
    },

    // cmd = y, d, c
    // motion = b, 0, gg, G, etc.
    executeCommandWithMotion: function (cmd, motion, count) {
        // XXX: better as a precondition
        if (count == null)
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
            return;
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
        }
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

        let text = Editor.getEditor().value;
        // XXX
        if (count == null)
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

        let text = Editor.getEditor().value;
        // XXX
        if (count == null)
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

    /**
     * Edits the given file in the external editor as specified by the
     * 'editor' option.
     *
     * @param {object|File|string} args An object specifying the file,
     *  line, and column to edit. If a non-object is specified, it is
     *  treated as the file parameter of the object.
     * @param {boolean} blocking If true, this function does not return
     *  until the editor exits.
     */
    editFileExternally: function (args, blocking) {
        if (!isObject(args) || args instanceof File)
            args = { file: args };
        args.file = args.file.path || args.file;

        let args = options.get("editor").format(args);

        dactyl.assert(args.length >= 1, "No editor specified");

        io.run(args.shift(), args, blocking);
    },

    // TODO: clean up with 2 functions for textboxes and currentEditor?
    editFieldExternally: function editFieldExternally(forceEditing) {
        if (!options["editor"])
            return;

        let textBox = config.isComposeWindow ? null : dactyl.focusedElement;
        let line, column;

        if (!forceEditing && textBox && textBox.type == "password") {
            commandline.input("Editing a password field externally will reveal the password. Would you like to continue? (yes/[no]): ",
                function (resp) {
                    if (resp && resp.match(/^y(es)?$/i))
                        editor.editFieldExternally(true);
                });
                return;
        }

        if (textBox) {
            var text = textBox.value;
            let pre = text.substr(0, textBox.selectionStart);
            line = 1 + pre.replace(/[^\n]/g, "").length;
            column = 1 + pre.replace(/[^]*\n/, "").length;
        }
        else {
            var editor = window.GetCurrentEditor ? GetCurrentEditor()
                                                 : Editor.getEditor(document.commandDispatcher.focusedWindow);
            dactyl.assert(editor);
            text = Array.map(editor.rootElement.childNodes, function (e) util.domToString(e, true)).join("");
        }

        let origGroup = textBox && textBox.getAttributeNS(NS, "highlight") || "";
        let cleanup = util.yieldable(function cleanup(error) {
            if (timer)
                timer.cancel();

            let blink = ["EditorBlink1", "EditorBlink2"];
            if (error) {
                dactyl.reportError(error, true);
                blink[1] = "EditorError";
            }
            else
                dactyl.trapErrors(update, null, true);

            if (tmpfile && tmpfile.exists())
                tmpfile.remove(false);

            // blink the textbox after returning
            if (textBox) {
                dactyl.focus(textBox);
                for (let group in values(blink.concat(blink, ""))) {
                    highlight.highlightNode(textBox, origGroup + " " + group);
                    yield 100;
                }
            }
        });

        function update(force) {
            if (force !== true && tmpfile.lastModifiedTime <= lastUpdate)
                return;
            lastUpdate = Date.now();

            let val = tmpfile.read();
            if (textBox)
                textBox.value = val;
            else {
                while (editor.rootElement.firstChild)
                    editor.rootElement.removeChild(editor.rootElement.firstChild);
                editor.rootElement.innerHTML = val;
            }
        }

        try {
            var tmpfile = io.createTempFile();
            if (!tmpfile)
                throw Error("Couldn't create temporary file");

            if (textBox) {
                highlight.highlightNode(textBox, origGroup + " EditorEditing");
                textBox.blur();
            }

            if (!tmpfile.write(text))
                throw Error("Input contains characters not valid in the current " +
                            "file encoding");

            var lastUpdate = Date.now();

            var timer = services.Timer(update, 100, services.Timer.TYPE_REPEATING_SLACK);
            this.editFileExternally({ file: tmpfile.path, line: line, column: column }, cleanup);
        }
        catch (e) {
            cleanup(e);
        }
    },

    /**
     * Expands an abbreviation in the currently active textbox.
     *
     * @param {string} mode The mode filter.
     * @see Abbreviation#expand
     */
    expandAbbreviation: function (mode) {
        let elem = dactyl.focusedElement;
        if (!(elem && elem.value))
            return;

        let text   = elem.value;
        let start  = elem.selectionStart;
        let end    = elem.selectionEnd;
        let abbrev = abbreviations.match(mode, text.substring(0, start).replace(/.*\s/g, ""));
        if (abbrev) {
            let len = abbrev.lhs.length;
            let rhs = abbrev.expand(elem);
            elem.value = text.substring(0, start - len) + rhs + text.substring(start);
            elem.selectionStart = start - len + rhs.length;
            elem.selectionEnd   = end   - len + rhs.length;
        }
    },
}, {
    extendRange: function extendRange(range, forward, re, sameWord) {
        function advance(positive) {
            let idx = range.endOffset;
            while (idx < text.length && re.test(text[idx++]) == positive)
                range.setEnd(range.endContainer, idx);
        }
        function retreat(positive) {
            let idx = range.startOffset;
            while (idx > 0 && re.test(text[--idx]) == positive)
                range.setStart(range.startContainer, idx);
        }

        let nodeRange = range.cloneRange();
        nodeRange.selectNodeContents(range.startContainer);
        let text = String(nodeRange);

        if (forward) {
            advance(true);
            if (!sameWord)
                advance(false);
        }
        else {
            if (!sameWord)
                retreat(false);
            retreat(true);
        }
        return range;
    },

    getEditor: function (elem) {
        if (arguments.length === 0) {
            dactyl.assert(dactyl.focusedElement);
            return dactyl.focusedElement;
        }

        if (!elem)
            elem = dactyl.focusedElement || document.commandDispatcher.focusedWindow;
        dactyl.assert(elem);

        if (elem instanceof Element)
            return elem.QueryInterface(Ci.nsIDOMNSEditableElement).editor;
        try {
            return elem.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
                       .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIEditingSession)
                       .getEditorForWindow(elem);
        }
        catch (e) {
            return null;
        }
    },

    getController: function () {
        let ed = dactyl.focusedElement;
        if (!ed || !ed.controllers)
            return null;

        return ed.controllers.getControllerForCommand("cmd_beginLine");
    }
}, {
    mappings: function () {

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
            }

            mappings.add([modes.CARET], keys, "",
                function ({ count }) {
                    if (!count)
                       count = 1;

                    while (count--)
                        caretExecute(false, true);
                },
                extraInfo);

            mappings.add([modes.VISUAL], keys, "",
                function ({ count }) {
                    if (!count)
                        count = 1;

                    let editor_ = Editor.getEditor(null);
                    let controller = buffer.selectionController;
                    while (count-- && modes.main == modes.VISUAL) {
                        if (editor.isTextEdit) {
                            if (callable(visualTextEditCommand))
                                visualTextEditCommand(editor_);
                            else
                                editor.executeCommand(visualTextEditCommand);
                        }
                        else
                            caretExecute(true, true);
                    }
                },
                extraInfo);

            mappings.add([modes.TEXT_EDIT], keys, "",
                function ({ count }) {
                    if (!count)
                        count = 1;

                    editor.executeCommand(textEditCommand, count);
                },
                extraInfo);
        }

        // add mappings for commands like i,a,s,c,etc. in TEXT_EDIT mode
        function addBeginInsertModeMap(keys, commands) {
            mappings.add([modes.TEXT_EDIT], keys, "",
                function () {
                    commands.forEach(function (cmd)
                        editor.executeCommand(cmd, 1));
                    modes.push(modes.INSERT);
                });
        }

        function addMotionMap(key) {
            mappings.add([modes.TEXT_EDIT], [key],
                "Motion command",
                function ({ count,  motion }) {
                    editor.executeCommandWithMotion(key, motion, Math.max(count, 1));
                },
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

        function updateRange(editor, forward, re, modify) {
            let range = Editor.extendRange(editor.selection.getRangeAt(0),
                                           forward, re, false);
            modify(range);
            editor.selection.removeAllRanges();
            editor.selection.addRange(range);
        }
        function move(forward, re)
            function _move(editor) {
                updateRange(editor, forward, re, function (range) { range.collapse(!forward); });
            }
        function select(forward, re)
            function _select(editor) {
                updateRange(editor, forward, re, function (range) {});
            }
        function beginLine(editor_) {
            editor.executeCommand("cmd_beginLine");
            move(true, /\S/)(editor_);
        }

        //             KEYS                          COUNT  CARET                   TEXT_EDIT            VISUAL_TEXT_EDIT
        addMovementMap(["k", "<Up>"],                true,  "lineMove", false,      "cmd_linePrevious", selectPreviousLine);
        addMovementMap(["j", "<Down>", "<Return>"],  true,  "lineMove", true,       "cmd_lineNext",     selectNextLine);
        addMovementMap(["h", "<Left>", "<BS>"],      true,  "characterMove", false, "cmd_charPrevious", "cmd_selectCharPrevious");
        addMovementMap(["l", "<Right>", "<Space>"],  true,  "characterMove", true,  "cmd_charNext",     "cmd_selectCharNext");
        addMovementMap(["b", "<C-Left>"],            true,  "wordMove", false,      "cmd_wordPrevious", "cmd_selectWordPrevious");
        addMovementMap(["w", "<C-Right>"],           true,  "wordMove", true,       "cmd_wordNext",     "cmd_selectWordNext");
        addMovementMap(["B"],                        true,  "wordMove", false,      move(false, /\S/),  select(false, /\S/));
        addMovementMap(["W"],                        true,  "wordMove", true,       move(true,  /\S/),  select(true,  /\S/));
        addMovementMap(["e"],                        true,  "wordMove", false,      move(true,  /\W/),  select(true,  /\W/));
        addMovementMap(["E"],                        true,  "wordMove", true,       move(true,  /\s/),  select(true,  /\s/));
        addMovementMap(["<C-f>", "<PageDown>"],      true,  "pageMove", true,       "cmd_movePageDown", "cmd_selectNextPage");
        addMovementMap(["<C-b>", "<PageUp>"],        true,  "pageMove", false,      "cmd_movePageUp",   "cmd_selectPreviousPage");
        addMovementMap(["gg", "<C-Home>"],           false, "completeMove", false,  "cmd_moveTop",      "cmd_selectTop");
        addMovementMap(["G", "<C-End>"],             false, "completeMove", true,   "cmd_moveBottom",   "cmd_selectBottom");
        addMovementMap(["0", "<Home>"],              false, "intraLineMove", false, "cmd_beginLine",    "cmd_selectBeginLine");
        addMovementMap(["^"],                        false, "intraLineMove", false, beginLine,          "cmd_selectBeginLine");
        addMovementMap(["$", "<End>"],               false, "intraLineMove", true,  "cmd_endLine" ,     "cmd_selectEndLine");

        addBeginInsertModeMap(["i", "<Insert>"], []);
        addBeginInsertModeMap(["a"],             ["cmd_charNext"]);
        addBeginInsertModeMap(["I"],             ["cmd_beginLine"]);
        addBeginInsertModeMap(["A"],             ["cmd_endLine"]);
        addBeginInsertModeMap(["s"],             ["cmd_deleteCharForward"]);
        addBeginInsertModeMap(["S"],             ["cmd_deleteToEndOfLine", "cmd_deleteToBeginningOfLine"]);
        addBeginInsertModeMap(["C"],             ["cmd_deleteToEndOfLine"]);

        addMotionMap("d"); // delete
        addMotionMap("c"); // change
        addMotionMap("y"); // yank

        // insert mode mappings
        mappings.add([modes.INPUT],
            ["<C-w>"], "Delete previous word",
            function () { editor.executeCommand("cmd_deleteWordBackward", 1); });

        mappings.add([modes.INPUT],
            ["<C-u>"], "Delete until beginning of current line",
            function () {
                // broken in FF3, deletes the whole line:
                // editor.executeCommand("cmd_deleteToBeginningOfLine", 1);
                editor.executeCommand("cmd_selectBeginLine", 1);
                if (Editor.getController().isCommandEnabled("cmd_delete"))
                    editor.executeCommand("cmd_delete", 1);
            });

        mappings.add([modes.INPUT],
            ["<C-k>"], "Delete until end of current line",
            function () { editor.executeCommand("cmd_deleteToEndOfLine", 1); });

        mappings.add([modes.INPUT],
            ["<C-a>"], "Move cursor to beginning of current line",
            function () { editor.executeCommand("cmd_beginLine", 1); });

        mappings.add([modes.INPUT],
            ["<C-e>"], "Move cursor to end of current line",
            function () { editor.executeCommand("cmd_endLine", 1); });

        mappings.add([modes.INPUT],
            ["<C-h>"], "Delete character to the left",
            function () { events.feedkeys("<BS>", true); });

        mappings.add([modes.INPUT],
            ["<C-d>"], "Delete character to the right",
            function () { editor.executeCommand("cmd_deleteCharForward", 1); });

        /*mappings.add([modes.INPUT],
            ["<C-Home>"], "Move cursor to beginning of text field",
            function () { editor.executeCommand("cmd_moveTop", 1); });

        mappings.add([modes.INPUT],
            ["<C-End>"], "Move cursor to end of text field",
            function () { editor.executeCommand("cmd_moveBottom", 1); });*/

        mappings.add([modes.INPUT],
            ["<S-Insert>"], "Insert clipboard/selection",
            function () { editor.pasteClipboard(); });

        mappings.add([modes.INPUT, modes.TEXT_EDIT],
            ["<C-i>"], "Edit text field with an external editor",
            function () { editor.editFieldExternally(); });

        mappings.add([modes.INPUT],
            ["<C-t>"], "Edit text field in Vi mode",
            function () {
                dactyl.assert(!editor.isTextEdit);
                modes.push(modes.TEXT_EDIT);
            });

        mappings.add([modes.INSERT],
            ["<Space>", "<Return>"], "Expand insert mode abbreviation",
            function () {
                editor.expandAbbreviation(modes.INSERT);
                return Events.PASS;
            });

        mappings.add([modes.INSERT],
            ["<C-]>", "<C-5>"], "Expand insert mode abbreviation",
            function () { editor.expandAbbreviation(modes.INSERT); });

        // text edit mode
        mappings.add([modes.TEXT_EDIT],
            ["u"], "Undo changes",
            function (args) {
                editor.executeCommand("cmd_undo", Math.max(args.count, 1));
                editor.unselectText();
            },
            { count: true });

        mappings.add([modes.TEXT_EDIT],
            ["<C-r>"], "Redo undone changes",
            function (args) {
                editor.executeCommand("cmd_redo", Math.max(args.count, 1));
                editor.unselectText();
            },
            { count: true });

        mappings.add([modes.TEXT_EDIT],
            ["D"], "Delete the characters under the cursor until the end of the line",
            function () { editor.executeCommand("cmd_deleteToEndOfLine"); });

        mappings.add([modes.TEXT_EDIT],
            ["o"], "Open line below current",
            function () {
                editor.executeCommand("cmd_endLine", 1);
                modes.push(modes.INSERT);
                events.feedkeys("<Return>");
            });

        mappings.add([modes.TEXT_EDIT],
            ["O"], "Open line above current",
            function () {
                editor.executeCommand("cmd_beginLine", 1);
                modes.push(modes.INSERT);
                events.feedkeys("<Return>");
                editor.executeCommand("cmd_linePrevious", 1);
            });

        mappings.add([modes.TEXT_EDIT],
            ["X"], "Delete character to the left",
            function (args) { editor.executeCommand("cmd_deleteCharBackward", Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.TEXT_EDIT],
            ["x"], "Delete character to the right",
            function (args) { editor.executeCommand("cmd_deleteCharForward", Math.max(args.count, 1)); },
            { count: true });

        // visual mode
        mappings.add([modes.CARET, modes.TEXT_EDIT],
            ["v"], "Start visual mode",
            function () { modes.push(modes.VISUAL); });

        mappings.add([modes.VISUAL],
            ["v", "V"], "End visual mode",
            function () { modes.pop(); });

        mappings.add([modes.TEXT_EDIT],
            ["V"], "Start visual line mode",
            function () {
                modes.push(modes.VISUAL, modes.LINE);
                editor.executeCommand("cmd_beginLine", 1);
                editor.executeCommand("cmd_selectLineNext", 1);
            });

        mappings.add([modes.VISUAL],
            ["c", "s"], "Change selected text",
            function () {
                dactyl.assert(editor.isTextEdit);
                editor.executeCommand("cmd_cut");
                modes.push(modes.INSERT);
            });

        mappings.add([modes.VISUAL],
            ["d", "x"], "Delete selected text",
            function () {
                dactyl.assert(editor.isTextEdit);
                editor.executeCommand("cmd_cut");
            });

        mappings.add([modes.VISUAL],
            ["y"], "Yank selected text",
            function () {
                if (editor.isTextEdit) {
                    editor.executeCommand("cmd_copy");
                    modes.pop();
                }
                else
                    dactyl.clipboardWrite(buffer.currentWord, true);
            });

        mappings.add([modes.VISUAL, modes.TEXT_EDIT],
            ["p"], "Paste clipboard contents",
            function ({ count }) {
                dactyl.assert(!editor.isCaret);
                editor.executeCommand("cmd_paste", count || 1);
                modes.pop(modes.TEXT_EDIT);
            },
            { count: true });

        // finding characters
        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["f"], "Move to a character on the current line after the cursor",
            function ({ arg, count }) {
                let pos = editor.findCharForward(arg, Math.max(count, 1));
                if (pos >= 0)
                    editor.moveToPosition(pos, true, modes.main == modes.VISUAL);
            },
            { arg: true, count: true });

        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["F"], "Move to a character on the current line before the cursor",
            function ({ arg, count }) {
                let pos = editor.findCharBackward(arg, Math.max(count, 1));
                if (pos >= 0)
                    editor.moveToPosition(pos, false, modes.main == modes.VISUAL);
            },
            { arg: true, count: true });

        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["t"], "Move before a character on the current line",
            function ({ arg, count }) {
                let pos = editor.findCharForward(arg, Math.max(count, 1));
                if (pos >= 0)
                    editor.moveToPosition(pos - 1, true, modes.main == modes.VISUAL);
            },
            { arg: true, count: true });

        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["T"], "Move before a character on the current line, backwards",
            function ({ arg, count }) {
                let pos = editor.findCharBackward(arg, Math.max(count, 1));
                if (pos >= 0)
                    editor.moveToPosition(pos + 1, false, modes.main == modes.VISUAL);
            },
            { arg: true, count: true });

        // text edit and visual mode
        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["~"], "Switch case of the character under the cursor and move the cursor to the right",
            function ({ count }) {
                if (modes.main == modes.VISUAL)
                    count = Editor.getEditor().selectionEnd - Editor.getEditor().selectionStart;
                count = Math.max(count, 1);

                // FIXME: do this in one pass?
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

        function bind() mappings.add.apply(mappings,
                                           [[modes.AUTOCOMPLETE]].concat(Array.slice(arguments)))

        bind(["<Esc>"], "Return to INSERT mode",
             function () Events.PASS_THROUGH);

        bind(["<C-[>"], "Return to INSERT mode",
             function () { events.feedkeys("<Esc>", { skipmap: true }); });

        bind(["<Up>"], "Select the previous autocomplete result",
             function () Events.PASS_THROUGH);

        bind(["<C-p>"], "Select the previous autocomplete result",
             function () { events.feedkeys("<Up>", { skipmap: true }); });

        bind(["<Down>"], "Select the next autocomplete result",
             function () Events.PASS_THROUGH);

        bind(["<C-n>"], "Select the next autocomplete result",
             function () { events.feedkeys("<Down>", { skipmap: true }); });
    },

    options: function () {
        options.add(["editor"],
            "The external text editor",
            "string", "gvim -f +<line> <file>", {
                format: function (obj, value) {
                    let args = commands.parseArgs(value || this.value, { argCount: "*", allowUnknownOptions: true })
                                       .map(util.compileMacro).filter(function (fmt) fmt.valid(obj))
                                       .map(function (fmt) fmt(obj));
                    if (obj["file"] && !this.has("file"))
                        args.push(obj["file"]);
                    return args;
                },
                has: function (key) set.has(util.compileMacro(this.value).seen, key),
                validator: function (value) {
                    this.format({}, value);
                    return Object.keys(util.compileMacro(value).seen).every(function (k) ["column", "file", "line"].indexOf(k) >= 0);
                }
            });

        options.add(["insertmode", "im"],
            "Enter Insert mode rather than Text Edit mode when focusing text areas",
            "boolean", true);
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
