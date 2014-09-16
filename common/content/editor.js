// Copyright (c) 2008-2014 Kris Maglione <maglione.k at Gmail>
// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

// command names taken from:
// http://developer.mozilla.org/en/docs/Editor_Embedding_Guide

/** @instance editor */
var Editor = Module("editor", XPCOM(Ci.nsIEditActionListener, ModuleBase), {
    init: function init(elem) {
        if (elem)
            this.element = elem;
        else
            this.__defineGetter__("element", function () {
                let elem = dactyl.focusedElement;
                if (elem)
                    return elem.inputField || elem;

                let win = document.commandDispatcher.focusedWindow;
                return DOM(win).isEditable && win || null;
            });
    },

    get registers() storage.newMap("registers", { privateData: true, store: true }),
    get registerRing() storage.newArray("register-ring", { privateData: true, store: true }),

    skipSave: false,

    // Fixme: Move off this object.
    currentRegister: null,

    /**
     * Temporarily set the default register for the span of the next
     * mapping.
     */
    pushRegister: function pushRegister(arg) {
        let restore = this.currentRegister;
        this.currentRegister = arg;
        mappings.afterCommands(2, function () {
            this.currentRegister = restore;
        }, this);
    },

    defaultRegister: "*+",

    selectionRegisters: {
        "*": "selection",
        "+": "global"
    },

    /**
     * Get the value of the register *name*.
     *
     * @param {string|number} name The name of the register to get.
     * @returns {string|null}
     * @see #setRegister
     */
    getRegister: function getRegister(name) {
        if (name == null)
            name = editor.currentRegister || editor.defaultRegister;

        name = String(name)[0];
        if (name == '"')
            name = 0;
        if (name == "_")
            var res = null;
        else if (hasOwnProperty(this.selectionRegisters, name))
            res = { text: dactyl.clipboardRead(this.selectionRegisters[name]) || "" };
        else if (!/^[0-9]$/.test(name))
            res = this.registers.get(name);
        else
            res = this.registerRing.get(name);

        return res != null ? res.text : res;
    },

    /**
     * Sets the value of register *name* to value. The following
     * registers have special semantics:
     *
     *   *   - Tied to the PRIMARY selection value on X11 systems.
     *   +   - Tied to the primary global clipboard.
     *   _   - The null register. Never has any value.
     *   "   - Equivalent to 0.
     *   0-9 - These act as a kill ring. Setting any of them pushes the
     *         values of higher numbered registers up one slot.
     *
     * @param {string|number} name The name of the register to set.
     * @param {string|Range|Selection|Node} value The value to save to
     *      the register.
     */
    setRegister: function setRegister(name, value, verbose) {
        if (name == null)
            name = editor.currentRegister || editor.defaultRegister;

        if (isinstance(value, [Ci.nsIDOMRange, Ci.nsIDOMNode, Ci.nsISelection]))
            value = DOM.stringify(value);
        value = { text: value, isLine: modes.extended & modes.LINE, timestamp: Date.now() * 1000 };

        for (let n of String(name)) {
            if (n == '"')
                n = 0;
            if (n == "_")
                ;
            else if (hasOwnProperty(this.selectionRegisters, n))
                dactyl.clipboardWrite(value.text, verbose, this.selectionRegisters[n]);
            else if (!/^[0-9]$/.test(n))
                this.registers.set(n, value);
            else {
                this.registerRing.insert(value, n);
                this.registerRing.truncate(10);
            }
        }
    },

    get isCaret() modes.getStack(1).main == modes.CARET,
    get isTextEdit() modes.getStack(1).main == modes.TEXT_EDIT,

    get editor() DOM(this.element).editor,

    getController: function getController(cmd) {
        let controllers = this.element && this.element.controllers;
        dactyl.assert(controllers);

        return controllers.getControllerForCommand(cmd || "cmd_beginLine");
    },

    get selection() this.editor && this.editor.selection || null,
    get selectionController() this.editor && this.editor.selectionController || null,

    deselect: function () {
        if (this.selection && this.selection.focusNode)
            this.selection.collapse(this.selection.focusNode,
                                    this.selection.focusOffset);
    },

    get selectedRange() {
        if (!this.selection)
            return null;

        if (!this.selection.rangeCount) {
            let range = RangeFind.nodeContents(this.editor.rootElement.ownerDocument);
            range.collapse(true);
            this.selectedRange = range;
        }
        return this.selection.getRangeAt(0);
    },
    set selectedRange(range) {
        this.selection.removeAllRanges();
        if (range != null)
            this.selection.addRange(range);
    },

    get selectedText() String(this.selection),

    get preserveSelection() this.editor && !this.editor.shouldTxnSetSelection,
    set preserveSelection(val) {
        if (this.editor)
            this.editor.setShouldTxnSetSelection(!val);
    },

    copy: function copy(range, name) {
        range = range || this.selection;

        if (!range.collapsed)
            this.setRegister(name, range);
    },

    cut: function cut(range, name, noStrip) {
        if (range)
            this.selectedRange = range;

        if (!this.selection.isCollapsed)
            this.setRegister(name, this.selection);

        this.editor.deleteSelection(0, this.editor[noStrip ? "eNoStrip" : "eStrip"]);
    },

    paste: function paste(name) {
        let text = this.getRegister(name);
        dactyl.assert(text && this.editor instanceof Ci.nsIPlaintextEditor);

        this.editor.insertText(text);
    },

    // count is optional, defaults to 1
    executeCommand: function executeCommand(cmd, count) {
        if (!callable(cmd)) {
            var controller = this.getController(cmd);
            util.assert(controller &&
                        controller.supportsCommand(cmd) &&
                        controller.isCommandEnabled(cmd));
            cmd = bind("doCommand", controller, cmd);
        }

        // XXX: better as a precondition
        if (count == null)
            count = 1;

        let didCommand = false;
        while (count--) {
            // some commands need this try/catch workaround, because a cmd_charPrevious triggered
            // at the beginning of the textarea, would hang the doCommand()
            // good thing is, we need this code anyway for proper beeping

            // What huh? --Kris
            try {
                cmd(this.editor, controller);
                didCommand = true;
            }
            catch (e) {
                util.reportError(e);
                dactyl.assert(didCommand);
                break;
            }
        }
    },

    moveToPosition: function (pos, select) {
        if (isObject(pos))
            var { startContainer, startOffset } = pos;
        else
            [startOffset, startOffset] = [this.selection.focusNode, pos];
        this.selection[select ? "extend" : "collapse"](startContainer, startOffset);
    },

    mungeRange: function mungeRange(range, munger, selectEnd) {
        let { editor } = this;
        editor.beginPlaceHolderTransaction(null);

        let [container, offset] = ["startContainer", "startOffset"];
        if (selectEnd)
            [container, offset] = ["endContainer", "endOffset"];

        try {
            // :(
            let idx = range[offset];
            let parent = range[container].parentNode;
            let parentIdx = Array.indexOf(parent.childNodes,
                                          range[container]);

            let delta = 0;
            for (let node in Editor.TextsIterator(range)) {
                let text = node.textContent;
                let start = 0, end = text.length;
                if (node == range.startContainer)
                    start = range.startOffset;
                if (node == range.endContainer)
                    end = range.endOffset;

                if (start == 0 && end == text.length)
                    text = munger(text);
                else
                    text = text.slice(0, start)
                         + munger(text.slice(start, end))
                         + text.slice(end);

                if (text == node.textContent)
                    continue;

                if (selectEnd)
                    delta = text.length - node.textContent.length;

                if (editor instanceof Ci.nsIPlaintextEditor) {
                    this.selectedRange = RangeFind.nodeContents(node);
                    editor.insertText(text);
                }
                else
                    node.textContent = text;
            }
            let node = parent.childNodes[parentIdx];
            if (node instanceof Text)
                idx = Math.constrain(idx + delta, 0, node.textContent.length);
            this.selection.collapse(node, idx);
        }
        finally {
            editor.endPlaceHolderTransaction();
        }
    },

    findChar: function findChar(key, count, backward, offset) {
        count  = count || 1; // XXX ?
        offset = (offset || 0) - !!backward;

        // Grab the charcode of the key spec. Using the key name
        // directly will break keys like <
        let code = DOM.Event.parse(key)[0].charCode;
        let char = String.fromCharCode(code);
        util.assert(code);

        let range = this.selectedRange.cloneRange();
        let collapse = DOM(this.element).whiteSpace == "normal";

        // Find the *count*th occurance of *char* before a non-collapsed
        // \n, ignoring the character at the caret.
        let i = 0;
        function test(c) (collapse || c != "\n") && !!(!i++ || c != char || --count)

        Editor.extendRange(range, !backward, { test: test }, true);
        dactyl.assert(count == 0);
        range.collapse(backward);

        // Skip to any requested offset.
        count = Math.abs(offset);
        Editor.extendRange(range, offset > 0,
                           { test: c => !!count-- },
                           true);
        range.collapse(offset < 0);

        return range;
    },

    findNumber: function findNumber(range) {
        if (!range)
            range = this.selectedRange.cloneRange();

        // Find digit (or \n).
        Editor.extendRange(range, true, /[^\n\d]/, true);
        range.collapse(false);
        // Select entire number.
        Editor.extendRange(range, true, /\d/, true);
        Editor.extendRange(range, false, /\d/, true);

        // Sanity check.
        dactyl.assert(/^\d+$/.test(range));

        if (false) // Skip for now.
        if (range.startContainer instanceof Text && range.startOffset > 2) {
            if (range.startContainer.textContent.substr(range.startOffset - 2, 2) == "0x")
                range.setStart(range.startContainer, range.startOffset - 2);
        }

        // Grab the sign, if it's there.
        Editor.extendRange(range, false, /[+-]/, true);

        return range;
    },

    modifyNumber: function modifyNumber(delta, range) {
        range = this.findNumber(range);
        let number = parseInt(range) + delta;
        if (/^[+-]?0x/.test(range))
            number = number.toString(16).replace(/^[+-]?/, "$&0x");
        else if (/^[+-]?0\d/.test(range))
            number = number.toString(8).replace(/^[+-]?/, "$&0");

        this.selectedRange = range;
        this.editor.insertText(String(number));
        this.selection.modify("move", "backward", "character");
    },

    /**
     * Edits the given file in the external editor as specified by the
     * 'editor' option.
     *
     * @param {object|File|string} args An object specifying the file, line,
     *     and column to edit. If a non-object is specified, it is treated as
     *     the file parameter of the object.
     * @param {boolean} blocking If true, this function does not return
     *     until the editor exits.
     */
    editFileExternally: function (args, blocking) {
        if (!isObject(args) || args instanceof File)
            args = { file: args };
        args.file = args.file.path || args.file;

        args = options.get("editor").format(args);

        dactyl.assert(args.length >= 1, _("option.notSet", "editor"));

        io.run(args.shift(), args, blocking);
    },

    // TODO: clean up with 2 functions for textboxes and currentEditor?
    editFieldExternally: function editFieldExternally(forceEditing) {
        if (!options["editor"])
            return;

        let textBox = config.isComposeWindow ? null : dactyl.focusedElement;
        if (!DOM(textBox).isInput)
            textBox = null;

        let line, column;
        let keepFocus = modes.stack.some(m => isinstance(m.main, modes.COMMAND_LINE));

        if (!forceEditing && textBox && textBox.type == "password") {
            commandline.input(_("editor.prompt.editPassword") + " ")
                .then(function (resp) {
                    if (resp && resp.match(/^y(es)?$/i))
                        editor.editFieldExternally(true);
                });
                return;
        }

        if (textBox) {
            var text = textBox.value;
            var pre = text.substr(0, textBox.selectionStart);
        }
        else {
            var editor_ = window.GetCurrentEditor ? GetCurrentEditor()
                                                  : Editor.getEditor(document.commandDispatcher.focusedWindow);
            dactyl.assert(editor_);
            text = Array.map(editor_.rootElement.childNodes,
                             e => DOM.stringify(e, true))
                        .join("");

            if (!editor_.selection.rangeCount)
                var sel = "";
            else {
                let range = RangeFind.nodeContents(editor_.rootElement);
                let end = editor_.selection.getRangeAt(0);
                range.setEnd(end.startContainer, end.startOffset);
                pre = DOM.stringify(range, true);
                if (range.startContainer instanceof Text)
                    pre = pre.replace(/^(?:<[^>"]+>)+/, "");
                if (range.endContainer instanceof Text)
                    pre = pre.replace(/(?:<\/[^>"]+>)+$/, "");
            }
        }

        line = 1 + pre.replace(/[^\n]/g, "").length;
        column = 1 + pre.replace(/[^]*\n/, "").length;

        let origGroup = DOM(textBox).highlight.toString();
        let cleanup = promises.task(function cleanup(error) {
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

            if (textBox) {
                DOM(textBox).highlight.remove("EditorEditing");
                if (!keepFocus)
                    dactyl.focus(textBox);

                for (let group in values(blink.concat(blink, ""))) {
                    highlight.highlightNode(textBox, origGroup + " " + group);

                    yield promises.sleep(100);
                }
            }
        });

        function update(force) {
            if (force !== true && tmpfile.lastModifiedTime <= lastUpdate)
                return;
            lastUpdate = Date.now();

            let val = tmpfile.read();
            if (textBox) {
                textBox.value = val;

                if (true) {
                    let elem = DOM(textBox);
                    elem.attrNS(NS, "modifiable", true)
                        .style.MozUserInput;
                    elem.input().attrNS(NS, "modifiable", null);
                }
            }
            else {
                while (editor_.rootElement.firstChild)
                    editor_.rootElement.removeChild(editor_.rootElement.firstChild);
                editor_.rootElement.innerHTML = val;
            }
        }

        try {
            var tmpfile = io.createTempFile("txt", "." + buffer.uri.host);
            if (!tmpfile)
                throw Error(_("io.cantCreateTempFile"));

            if (textBox) {
                if (!keepFocus)
                    textBox.blur();
                DOM(textBox).highlight.add("EditorEditing");
            }

            if (!tmpfile.write(text))
                throw Error(_("io.cantEncode"));

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
        if (!this.selection)
            return;

        let range = this.selectedRange.cloneRange();
        if (!range.collapsed)
            return;

        Editor.extendRange(range, false, /\S/, true);
        let abbrev = abbreviations.match(mode, String(range));
        if (abbrev) {
            range.setStart(range.startContainer, range.endOffset - abbrev.lhs.length);
            this.selectedRange = range;
            this.editor.insertText(abbrev.expand(this.element));
        }
    },

    // nsIEditActionListener:
    WillDeleteNode: util.wrapCallback(function WillDeleteNode(node) {
        if (!editor.skipSave && node.textContent)
            this.setRegister(0, node);
    }),
    WillDeleteSelection: util.wrapCallback(function WillDeleteSelection(selection) {
        if (!editor.skipSave && !selection.isCollapsed)
            this.setRegister(0, selection);
    }),
    WillDeleteText: util.wrapCallback(function WillDeleteText(node, start, length) {
        if (!editor.skipSave && length)
            this.setRegister(0, node.textContent.substr(start, length));
    })
}, {
    TextsIterator: Class("TextsIterator", {
        init: function init(range, context, after) {
            this.after = after;
            this.start = context || range[after ? "endContainer" : "startContainer"];
            if (after)
                this.context = this.start;
            this.range = range;
        },

        __iterator__: function __iterator__() {
            while (this.nextNode())
                yield this.context;
        },

        prevNode: function prevNode() {
            if (!this.context)
                return this.context = this.start;

            var node = this.context;
            if (!this.after)
                node = node.previousSibling;

            if (!node)
                node = this.context.parentNode;
            else
                while (node.lastChild)
                    node = node.lastChild;

            if (!node || !RangeFind.containsNode(this.range, node, true))
                return null;
            this.after = false;
            return this.context = node;
        },

        nextNode: function nextNode() {
            if (!this.context)
                return this.context = this.start;

            if (!this.after)
                var node = this.context.firstChild;

            if (!node) {
                node = this.context;
                while (node.parentNode && node != this.range.endContainer
                        && !node.nextSibling)
                    node = node.parentNode;

                node = node.nextSibling;
            }

            if (!node || !RangeFind.containsNode(this.range, node, true))
                return null;
            this.after = false;
            return this.context = node;
        },

        getPrev: function getPrev() {
            return this.filter("prevNode");
        },

        getNext: function getNext() {
            return this.filter("nextNode");
        },

        filter: function filter(meth) {
            let node;
            while (node = this[meth]())
                if (node instanceof Ci.nsIDOMText &&
                        DOM(node).isVisible &&
                        DOM(node).style.MozUserSelect != "none")
                    return node;
        }
    }),

    extendRange: function extendRange(range, forward, re, sameWord, root, end) {
        function advance(positive) {
            while (true) {
                while (idx == text.length && (node = iterator.getNext())) {
                    if (node == iterator.start)
                        idx = range[offset];

                    start = text.length;
                    text += node.textContent;
                    range[set](node, idx - start);
                }

                if (idx >= text.length || re.test(text[idx]) != positive)
                    break;
                range[set](range[container], ++idx - start);
            }
        }
        function retreat(positive) {
            while (true) {
                while (idx == 0 && (node = iterator.getPrev())) {
                    let str = node.textContent;
                    if (node == iterator.start)
                        idx = range[offset];
                    else
                        idx = str.length;

                    text = str + text;
                    range[set](node, idx);
                }
                if (idx == 0 || re.test(text[idx - 1]) != positive)
                    break;
                range[set](range[container], --idx);
            }
        }

        if (end == null)
            end = forward ? "end" : "start";
        let [container, offset, set] = [end + "Container", end + "Offset",
                                        "set" + util.capitalize(end)];

        if (!root)
            for (root = range[container];
                 root.parentNode instanceof Element && !DOM(root).isEditable;
                 root = root.parentNode)
                ;
        if (root instanceof Ci.nsIDOMNSEditableElement)
            root = root.editor;
        if (root instanceof Ci.nsIEditor)
            root = root.rootElement;

        let node = range[container];
        let iterator = Editor.TextsIterator(RangeFind.nodeContents(root),
                                            node, !forward);

        let text = "";
        let idx  = 0;
        let start = 0;

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

        return DOM(elem).editor;
    }
}, {
    modes: function initModes() {
        modes.addMode("OPERATOR", {
            char: "o",
            description: "Mappings which move the cursor",
            bases: []
        });
        modes.addMode("VISUAL", {
            char: "v",
            description: "Active when text is selected",
            display: function () "VISUAL" + (this._extended & modes.LINE ? " LINE" : ""),
            bases: [modes.COMMAND],
            ownsFocus: true
        }, {
            enter: function (stack) {
                if (editor.selectionController)
                    editor.selectionController.setCaretVisibilityDuringSelection(true);
            },
            leave: function (stack, newMode) {
                if (newMode.main == modes.CARET) {
                    let selection = content.getSelection();
                    if (selection && !selection.isCollapsed)
                        selection.collapseToStart();
                }
                else if (stack.pop)
                    editor.deselect();
            }
        });
        modes.addMode("TEXT_EDIT", {
            char: "t",
            description: "Vim-like editing of input elements",
            bases: [modes.COMMAND],
            ownsFocus: true
        }, {
            onKeyPress: function (eventList) {
                const KILL = false, PASS = true;

                // Hack, really.
                if (eventList[0].charCode || /^<(?:.-)*(?:BS|Del|C-h|C-w|C-u|C-k)>$/.test(DOM.Event.stringify(eventList[0]))) {
                    dactyl.beep();
                    return KILL;
                }
                return PASS;
            }
        });

        modes.addMode("INSERT", {
            char: "i",
            description: "Active when an input element is focused",
            insert: true,
            ownsFocus: true
        });
        modes.addMode("AUTOCOMPLETE", {
            description: "Active when an input autocomplete pop-up is active",
            display: function () "AUTOCOMPLETE (insert)",
            bases: [modes.INSERT]
        });
    },
    commands: function initCommands() {
        commands.add(["reg[isters]"],
            "List the contents of known registers",
            function (args) {
                completion.listCompleter("register", args[0]);
            },
            { argCount: "*" });
    },
    completion: function initCompletion() {
        completion.register = function complete_register(context) {
            context = context.fork("registers");
            context.keys = { text: util.identity, description: editor.bound.getRegister };

            context.match = function (r) !this.filter || this.filter.contains(r);

            context.fork("clipboard", 0, this, function (ctxt) {
                ctxt.match = context.match;
                ctxt.title = ["Clipboard Registers"];
                ctxt.completions = Object.keys(editor.selectionRegisters);
            });
            context.fork("kill-ring", 0, this, function (ctxt) {
                ctxt.match = context.match;
                ctxt.title = ["Kill Ring Registers"];
                ctxt.completions = Array.slice("0123456789");
            });
            context.fork("user", 0, this, function (ctxt) {
                ctxt.match = context.match;
                ctxt.title = ["User Defined Registers"];
                ctxt.completions = editor.registers.keys();
            });
        };
    },
    mappings: function initMappings() {

        Map.types["editor"] = {
            preExecute: function preExecute(args) {
                if (editor.editor && !this.editor) {
                    this.editor = editor.editor;
                    if (!this.noTransaction)
                        this.editor.beginTransaction();
                }
                editor.inEditMap = true;
            },
            postExecute: function preExecute(args) {
                editor.inEditMap = false;
                if (this.editor) {
                    if (!this.noTransaction)
                        this.editor.endTransaction();
                    this.editor = null;
                }
            },
        };
        Map.types["operator"] = {
            preExecute: function preExecute(args) {
                editor.inEditMap = true;
            },
            postExecute: function preExecute(args) {
                editor.inEditMap = true;
                if (modes.main == modes.OPERATOR)
                    modes.pop();
            }
        };

        // add mappings for commands like h,j,k,l,etc. in CARET, VISUAL and TEXT_EDIT mode
        function addMovementMap(keys, description, hasCount, caretModeMethod, caretModeArg, textEditCommand, visualTextEditCommand) {
            let extraInfo = {
                count: !!hasCount,
                type: "operator"
            };

            function caretExecute(arg) {
                let win = document.commandDispatcher.focusedWindow;
                let controller = util.selectionController(win);
                let sel = controller.getSelection(controller.SELECTION_NORMAL);

                let buffer = Buffer(win);
                if (!sel.rangeCount) // Hack.
                    buffer.resetCaret();

                if (caretModeMethod == "pageMove") { // Grr.
                    buffer.scrollVertical("pages", caretModeArg ? 1 : -1);
                    buffer.resetCaret();
                }
                else
                    controller[caretModeMethod](caretModeArg, arg);
            }

            mappings.add([modes.VISUAL], keys, description,
                function ({ count }) {
                    count = count || 1;

                    let caret = !dactyl.focusedElement;
                    let controller = buffer.selectionController;

                    while (count-- && modes.main == modes.VISUAL) {
                        if (caret)
                            caretExecute(true, true);
                        else {
                            if (callable(visualTextEditCommand))
                                visualTextEditCommand(editor.editor);
                            else
                                editor.executeCommand(visualTextEditCommand);
                        }
                    }
                },
                extraInfo);

            mappings.add([modes.CARET, modes.TEXT_EDIT, modes.OPERATOR], keys, description,
                function ({ count }) {
                    count = count || 1;

                    if (editor.editor)
                        editor.executeCommand(textEditCommand, count);
                    else {
                        while (count--)
                            caretExecute(false);
                    }
                },
                extraInfo);
        }

        // add mappings for commands like i,a,s,c,etc. in TEXT_EDIT mode
        function addBeginInsertModeMap(keys, commands, description) {
            mappings.add([modes.TEXT_EDIT], keys, description || "",
                function () {
                    commands.forEach(function (cmd) { editor.executeCommand(cmd, 1); });
                    modes.push(modes.INSERT);
                },
                { type: "editor" });
        }

        function selectPreviousLine() {
            editor.executeCommand("cmd_selectLinePrevious");
            if ((modes.extended & modes.LINE) && !editor.selectedText)
                editor.executeCommand("cmd_selectLinePrevious");
        }

        function selectNextLine() {
            editor.executeCommand("cmd_selectLineNext");
            if ((modes.extended & modes.LINE) && !editor.selectedText)
                editor.executeCommand("cmd_selectLineNext");
        }

        function updateRange(editor, forward, re, modify, sameWord) {
            let sel   = editor.selection;
            let range = sel.getRangeAt(0);

            let end = range.endContainer == sel.focusNode && range.endOffset == sel.focusOffset;
            if (range.collapsed)
                end = forward;

            Editor.extendRange(range, forward, re, sameWord,
                               editor.rootElement, end ? "end" : "start");
            modify(range);
            editor.selectionController.repaintSelection(editor.selectionController.SELECTION_NORMAL);
        }

        function clear(forward, re)
            function _clear(editor) {
                updateRange(editor, forward, re, function (range) {});
                dactyl.assert(!editor.selection.isCollapsed);
                editor.selection.deleteFromDocument();
                let parent = DOM(editor.rootElement.parentNode);
                if (parent.isInput)
                    parent.input();
            }

        function move(forward, re, sameWord)
            function _move(editor) {
                updateRange(editor, forward, re,
                            function (range) { range.collapse(!forward); },
                            sameWord);
            }
        function select(forward, re)
            function _select(editor) {
                updateRange(editor, forward, re,
                            function (range) {});
            }
        function beginLine(editor_) {
            editor.executeCommand("cmd_beginLine");
            move(true, /\s/, true)(editor_);
        }

        //             COUNT  CARET                   TEXT_EDIT            VISUAL_TEXT_EDIT
        addMovementMap(["k", "<Up>"],                 "Move up one line",
                       true,  "lineMove", false,      "cmd_linePrevious", selectPreviousLine);
        addMovementMap(["j", "<Down>", "<Return>"],   "Move down one line",
                       true,  "lineMove", true,       "cmd_lineNext",     selectNextLine);
        addMovementMap(["h", "<Left>", "<BS>"],       "Move left one character",
                       true,  "characterMove", false, "cmd_charPrevious", "cmd_selectCharPrevious");
        addMovementMap(["l", "<Right>", "<Space>"],   "Move right one character",
                       true,  "characterMove", true,  "cmd_charNext",     "cmd_selectCharNext");
        addMovementMap(["b", "<C-Left>"],             "Move left one word",
                       true,  "wordMove", false,      move(false,  /\w/), select(false, /\w/));
        addMovementMap(["w", "<C-Right>"],            "Move right one word",
                       true,  "wordMove", true,       move(true,  /\w/),  select(true, /\w/));
        addMovementMap(["B"],                         "Move left to the previous white space",
                       true,  "wordMove", false,      move(false, /\S/),  select(false, /\S/));
        addMovementMap(["W"],                         "Move right to just beyond the next white space",
                       true,  "wordMove", true,       move(true,  /\S/),  select(true,  /\S/));
        addMovementMap(["e"],                         "Move to the end of the current word",
                       true,  "wordMove", true,       move(true,  /\W/),  select(true,  /\W/));
        addMovementMap(["E"],                         "Move right to the next white space",
                       true,  "wordMove", true,       move(true,  /\s/),  select(true,  /\s/));
        addMovementMap(["<C-f>", "<PageDown>"],       "Move down one page",
                       true,  "pageMove", true,       "cmd_movePageDown", "cmd_selectNextPage");
        addMovementMap(["<C-b>", "<PageUp>"],         "Move up one page",
                       true,  "pageMove", false,      "cmd_movePageUp",   "cmd_selectPreviousPage");
        addMovementMap(["gg", "<C-Home>"],            "Move to the start of text",
                       false, "completeMove", false,  "cmd_moveTop",      "cmd_selectTop");
        addMovementMap(["G", "<C-End>"],              "Move to the end of text",
                       false, "completeMove", true,   "cmd_moveBottom",   "cmd_selectBottom");
        addMovementMap(["0", "<Home>"],               "Move to the beginning of the line",
                       false, "intraLineMove", false, "cmd_beginLine",    "cmd_selectBeginLine");
        addMovementMap(["^"],                         "Move to the first non-whitespace character of the line",
                       false, "intraLineMove", false, beginLine,          "cmd_selectBeginLine");
        addMovementMap(["$", "<End>"],                "Move to the end of the current line",
                       false, "intraLineMove", true,  "cmd_endLine" ,     "cmd_selectEndLine");

        addBeginInsertModeMap(["i", "<Insert>"], [], "Insert text before the cursor");
        addBeginInsertModeMap(["a"],             ["cmd_charNext"], "Append text after the cursor");
        addBeginInsertModeMap(["I"],             ["cmd_beginLine"], "Insert text at the beginning of the line");
        addBeginInsertModeMap(["A"],             ["cmd_endLine"], "Append text at the end of the line");
        addBeginInsertModeMap(["s"],             ["cmd_deleteCharForward"], "Delete the character in front of the cursor and start insert");
        addBeginInsertModeMap(["S"],             ["cmd_deleteToEndOfLine", "cmd_deleteToBeginningOfLine"], "Delete the current line and start insert");
        addBeginInsertModeMap(["C"],             ["cmd_deleteToEndOfLine"], "Delete from the cursor to the end of the line and start insert");

        function addMotionMap(key, desc, select, cmd, mode, caretOk) {
            function doTxn(range, editor) {
                try {
                    editor.editor.beginTransaction();
                    cmd(editor, range, editor.editor);
                }
                finally {
                    editor.editor.endTransaction();
                }
            }

            mappings.add([modes.TEXT_EDIT], key,
                desc,
                function ({ command, count, motion }) {
                    let start = editor.selectedRange.cloneRange();

                    mappings.pushCommand();
                    modes.push(modes.OPERATOR, null, {
                        forCommand: command,

                        count: count,

                        leave: function leave(stack) {
                            try {
                                if (stack.push || stack.fromEscape)
                                    return;

                                editor.withSavedValues(["inEditMap"], function () {
                                    this.inEditMap = true;

                                    let range = RangeFind.union(start, editor.selectedRange);
                                    editor.selectedRange = select ? range : start;
                                    doTxn(range, editor);
                                });

                                editor.currentRegister = null;
                                modes.delay(function () {
                                    if (mode)
                                        modes.push(mode);
                                });
                            }
                            finally {
                                if (!stack.push)
                                    mappings.popCommand();
                            }
                        }
                    });
                },
                { count: true, type: "motion" });

            mappings.add([modes.VISUAL], key,
                desc,
                function ({ count,  motion }) {
                    dactyl.assert(caretOk || editor.isTextEdit);
                    if (editor.isTextEdit)
                        doTxn(editor.selectedRange, editor);
                    else
                        cmd(editor, buffer.selection.getRangeAt(0));
                },
                { count: true, type: "motion" });
        }

        addMotionMap(["d", "x"], "Delete text", true,  function (editor) { editor.cut(); });
        addMotionMap(["c"],      "Change text", true,  function (editor) { editor.cut(null, null, true); }, modes.INSERT);
        addMotionMap(["y"],      "Yank text",   false, function (editor, range) { editor.copy(range); }, null, true);

        addMotionMap(["gu"], "Lowercase text", false,
             function (editor, range) {
                 editor.mungeRange(range, String.toLocaleLowerCase);
             });

        addMotionMap(["gU"], "Uppercase text", false,
            function (editor, range) {
                editor.mungeRange(range, String.toLocaleUpperCase);
            });

        mappings.add([modes.OPERATOR],
            ["c", "d", "y"], "Select the entire line",
            function ({ command, count }) {
                dactyl.assert(command == modes.getStack(0).params.forCommand);

                let sel = editor.selection;
                sel.modify("move", "backward", "lineboundary");
                sel.modify("extend", "forward", "lineboundary");

                if (command != "c")
                    sel.modify("extend", "forward", "character");
            },
            { count: true, type: "operator" });

        let bind = function bind(names, description, action, params)
            mappings.add([modes.INPUT], names, description,
                         action, update({ type: "editor" }, params));

        bind(["<C-w>"], "Delete previous word",
             function () {
                 if (editor.editor)
                     clear(false, /\w/)(editor.editor);
                 else
                     editor.executeCommand("cmd_deleteWordBackward", 1);
             });

        bind(["<C-u>"], "Delete until beginning of current line",
             function () {
                 // Deletes the whole line. What the hell.
                 // editor.executeCommand("cmd_deleteToBeginningOfLine", 1);

                 editor.executeCommand("cmd_selectBeginLine", 1);
                 if (editor.selection && editor.selection.isCollapsed) {
                     editor.executeCommand("cmd_deleteCharBackward", 1);
                     editor.executeCommand("cmd_selectBeginLine", 1);
                 }

                 if (editor.getController("cmd_delete").isCommandEnabled("cmd_delete"))
                     editor.executeCommand("cmd_delete", 1);
             });

        bind(["<C-k>"], "Delete until end of current line",
             function () { editor.executeCommand("cmd_deleteToEndOfLine", 1); });

        bind(["<C-a>"], "Move cursor to beginning of current line",
             function () { editor.executeCommand("cmd_beginLine", 1); });

        bind(["<C-e>"], "Move cursor to end of current line",
             function () { editor.executeCommand("cmd_endLine", 1); });

        bind(["<C-h>"], "Delete character to the left",
             function () { events.feedkeys("<BS>", true); });

        bind(["<C-d>"], "Delete character to the right",
             function () { editor.executeCommand("cmd_deleteCharForward", 1); });

        bind(["<S-Insert>"], "Insert clipboard/selection",
             function () { editor.paste(); });

        bind(["<C-i>"], "Edit text field with an external editor",
             function () { editor.editFieldExternally(); });

        bind(["<C-t>"], "Edit text field in Text Edit mode",
             function () {
                 dactyl.assert(!editor.isTextEdit && editor.editor);
                 dactyl.assert(dactyl.focusedElement ||
                               // Sites like Google like to use a
                               // hidden, editable window for keyboard
                               // focus and use their own WYSIWYG editor
                               // implementations for the visible area,
                               // which we can't handle.
                               let (f = document.commandDispatcher.focusedWindow.frameElement)
                                    f && Hints.isVisible(f, true));

                 modes.push(modes.TEXT_EDIT);
             });

        // Ugh.
        mappings.add([modes.INPUT, modes.CARET],
            ["<*-CR>", "<*-BS>", "<*-Del>", "<*-Left>", "<*-Right>", "<*-Up>", "<*-Down>",
             "<*-Home>", "<*-End>", "<*-PageUp>", "<*-PageDown>",
             "<M-c>", "<M-v>", "<*-Tab>"],
            "Handled by " + config.host,
            () => Events.PASS_THROUGH);

        mappings.add([modes.INSERT],
            ["<Space>", "<Return>"], "Expand Insert mode abbreviation",
            function () {
                editor.expandAbbreviation(modes.INSERT);
                return Events.PASS_THROUGH;
            });

        mappings.add([modes.INSERT],
            ["<C-]>", "<C-5>"], "Expand Insert mode abbreviation",
            function () { editor.expandAbbreviation(modes.INSERT); });

        bind = function bind(names, description, action, params)
            mappings.add([modes.TEXT_EDIT], names, description,
                         action, update({ type: "editor" }, params));

        bind(["<C-a>"], "Increment the next number",
             function ({ count }) { editor.modifyNumber(count || 1); },
             { count: true });

        bind(["<C-x>"], "Decrement the next number",
             function ({ count }) { editor.modifyNumber(-(count || 1)); },
             { count: true });

        // text edit mode
        bind(["u"], "Undo changes",
             function ({ count }) {
                 editor.editor.undo(Math.max(count, 1));
                 editor.deselect();
             },
             { count: true, noTransaction: true });

        bind(["<C-r>"], "Redo undone changes",
             function ({ count }) {
                 editor.editor.redo(Math.max(count, 1));
                 editor.deselect();
             },
             { count: true, noTransaction: true });

        bind(["D"], "Delete characters from the cursor to the end of the line",
             function () { editor.executeCommand("cmd_deleteToEndOfLine"); });

        bind(["o"], "Open line below current",
             function () {
                 editor.executeCommand("cmd_endLine", 1);
                 modes.push(modes.INSERT);
                 events.feedkeys("<Return>");
             });

        bind(["O"], "Open line above current",
             function () {
                 editor.executeCommand("cmd_beginLine", 1);
                 modes.push(modes.INSERT);
                 events.feedkeys("<Return>");
                 editor.executeCommand("cmd_linePrevious", 1);
             });

        bind(["X"], "Delete character to the left",
             function (args) { editor.executeCommand("cmd_deleteCharBackward", Math.max(args.count, 1)); },
            { count: true });

        bind(["x"], "Delete character to the right",
             function (args) { editor.executeCommand("cmd_deleteCharForward", Math.max(args.count, 1)); },
            { count: true });

        // visual mode
        mappings.add([modes.CARET, modes.TEXT_EDIT],
            ["v"], "Start Visual mode",
            function () { modes.push(modes.VISUAL); });

        mappings.add([modes.VISUAL],
            ["v", "V"], "End Visual mode",
            function () { modes.pop(); });

        bind(["V"], "Start Visual Line mode",
             function () {
                 modes.push(modes.VISUAL, modes.LINE);
                 editor.executeCommand("cmd_beginLine", 1);
                 editor.executeCommand("cmd_selectLineNext", 1);
             });

        mappings.add([modes.VISUAL],
            ["s"], "Change selected text",
            function () {
                dactyl.assert(editor.isTextEdit);
                editor.executeCommand("cmd_cut");
                modes.push(modes.INSERT);
            });

        mappings.add([modes.VISUAL],
            ["o"], "Move cursor to the other end of the selection",
            function () {
                if (editor.isTextEdit)
                    var selection = editor.selection;
                else
                    selection = buffer.focusedFrame.getSelection();

                util.assert(selection.focusNode);
                let { focusOffset, anchorOffset, focusNode, anchorNode } = selection;
                selection.collapse(focusNode, focusOffset);
                selection.extend(anchorNode, anchorOffset);
            });

        bind(["p"], "Paste clipboard contents",
             function ({ count }) {
                dactyl.assert(!editor.isCaret);
                editor.executeCommand(modules.bind("paste", editor, null),
                                      count || 1);
            },
            { count: true });

        mappings.add([modes.COMMAND],
            ['"'], "Bind a register to the next command",
            function ({ arg }) {
                editor.pushRegister(arg);
            },
            { arg: true });

        mappings.add([modes.INPUT],
            ["<C-'>", '<C-">'], "Bind a register to the next command",
            function ({ arg }) {
                editor.pushRegister(arg);
            },
            { arg: true });

        bind = function bind(names, description, action, params)
            mappings.add([modes.TEXT_EDIT, modes.OPERATOR, modes.VISUAL],
                         names, description,
                         action, update({ type: "editor" }, params));

        // finding characters
        function offset(backward, before, pos) {
            if (!backward && modes.main != modes.TEXT_EDIT)
                return before ? 0 : 1;
            if (before)
                return backward ? +1 : -1;
            return 0;
        }

        bind(["f"], "Find a character on the current line, forwards",
             function ({ arg, count }) {
                 editor.moveToPosition(editor.findChar(arg, Math.max(count, 1), false,
                                                       offset(false, false)),
                                       modes.main == modes.VISUAL);
             },
             { arg: true, count: true, type: "operator" });

        bind(["F"], "Find a character on the current line, backwards",
             function ({ arg, count }) {
                 editor.moveToPosition(editor.findChar(arg, Math.max(count, 1), true,
                                                       offset(true, false)),
                                       modes.main == modes.VISUAL);
             },
             { arg: true, count: true, type: "operator" });

        bind(["t"], "Find a character on the current line, forwards, and move to the character before it",
             function ({ arg, count }) {
                 editor.moveToPosition(editor.findChar(arg, Math.max(count, 1), false,
                                                       offset(false, true)),
                                       modes.main == modes.VISUAL);
             },
             { arg: true, count: true, type: "operator" });

        bind(["T"], "Find a character on the current line, backwards, and move to the character after it",
             function ({ arg, count }) {
                 editor.moveToPosition(editor.findChar(arg, Math.max(count, 1), true,
                                                       offset(true, true)),
                                       modes.main == modes.VISUAL);
             },
             { arg: true, count: true, type: "operator" });

        // text edit and visual mode
        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["~"], "Switch case of the character under the cursor and move the cursor to the right",
            function ({ count }) {
                function munger(range)
                    String(range).replace(/./g, function (c) {
                        let lc = c.toLocaleLowerCase();
                        return c == lc ? c.toLocaleUpperCase() : lc;
                    });

                var range = editor.selectedRange;
                if (range.collapsed) {
                    count = count || 1;
                    Editor.extendRange(range, true, { test: c => !!count-- }, true);
                }
                editor.mungeRange(range, munger, count != null);

                modes.pop(modes.TEXT_EDIT);
            },
            { count: true });

        bind = function bind(...args) mappings.add.apply(mappings, [[modes.AUTOCOMPLETE]].concat(args));

        bind(["<Esc>"], "Return to Insert mode",
             () => Events.PASS_THROUGH);

        bind(["<C-[>"], "Return to Insert mode",
             function () { events.feedkeys("<Esc>", { skipmap: true }); });

        bind(["<Up>"], "Select the previous autocomplete result",
             () => Events.PASS_THROUGH);

        bind(["<C-p>"], "Select the previous autocomplete result",
             function () { events.feedkeys("<Up>", { skipmap: true }); });

        bind(["<Down>"], "Select the next autocomplete result",
             () => Events.PASS_THROUGH);

        bind(["<C-n>"], "Select the next autocomplete result",
             function () { events.feedkeys("<Down>", { skipmap: true }); });
    },
    options: function initOptions() {
        options.add(["editor"],
            "The external text editor",
            "string", 'gvim -f +<line> +"sil! call cursor(0, <column>)" <file>', {
                format: function (obj, value) {
                    let args = commands.parseArgs(value || this.value,
                                                  { argCount: "*", allowUnknownOptions: true })
                                       .map(util.compileMacro)
                                       .filter(fmt => fmt.valid(obj))
                                       .map(fmt => fmt(obj));

                    if (obj["file"] && !this.has("file"))
                        args.push(obj["file"]);
                    return args;
                },
                has: function (key) util.compileMacro(this.value).seen.has(key),
                validator: function (value) {
                    this.format({}, value);
                    let allowed = RealSet(["column", "file", "line"]);
                    return [k for (k of util.compileMacro(value).seen)]
                                .every(k => allowed.has(k));
                }
            });

        options.add(["insertmode", "im"],
            "Enter Insert mode rather than Text Edit mode when focusing text areas",
            "boolean", true);

        options.add(["spelllang", "spl"],
            "The language used by the spell checker",
            "string", config.locale,
            {
                initValue: function () {},
                getter: function getter() {
                    try {
                        return services.spell.dictionary || "";
                    }
                    catch (e) {
                        return "";
                    }
                },
                setter: function setter(val) { services.spell.dictionary = val; },
                completer: function completer(context) {
                    let res = {};
                    services.spell.getDictionaryList(res, {});
                    context.completions = res.value;
                    context.keys = { text: util.identity, description: util.identity };
                }
            });
    },
    sanitizer: function initSanitizer() {
        sanitizer.addItem("registers", {
            description: "Register values",
            persistent: true,
            action: function (timespan, host) {
                if (!host) {
                    for (let [k, v] in editor.registers)
                        if (timespan.contains(v.timestamp))
                            editor.registers.remove(k);
                    editor.registerRing.truncate(0);
                }
            }
        });
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
