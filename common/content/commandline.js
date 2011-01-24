// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var CommandWidgets = Class("CommandWidgets", {
    init: function () {
        let _status = "dactyl-statusline-field-";

        util.overlayWindow(window, {
            append: <e4x xmlns={XUL} xmlns:dactyl={NS}>
                <window id={document.documentElement.id}>
                    <popupset>
                        <menupopup id="dactyl-contextmenu"
                                   onpopupshowing="return (event.target != this || dactyl.modules.commandline.onContext(event));">
                            <menuitem id="dactyl-context-copylink"
                                      label="Copy Link Location" dactyl:group="link"
                                      oncommand="goDoCommand('cmd_copyLink');"/>
                            <menuitem id="dactyl-context-copypath"
                                      label="Copy File Path" dactyl:group="link path"
                                      oncommand="dactyl.clipboardWrite(document.popupNode.getAttribute('path'));"/>
                            <menuitem id="dactyl-context-copy"
                                      label="Copy" dactyl:group="selection"
                                      command="cmd_copy"/>
                            <menuitem id="dactyl-context-selectall"
                                      label="Select All"
                                      command="cmd_selectAll"/>
                        </menupopup>
                    </popupset>
                </window>

                <vbox id={config.commandContainer}>

                    <vbox class="dactyl-container" id="dactyl-multiline-output-container" hidden="false" collapsed="true">
                        <iframe id="dactyl-multiline-output" src="dactyl://content/buffer.xhtml"
                                flex="1" hidden="false" collapsed="false"
                                contextmenu="dactyl-contextmenu"
                                onclick="dactyl.modules.commandline.onMultilineOutputEvent(event)"/>
                    </vbox>

                    <vbox class="dactyl-container" hidden="false" collapsed="true">
                        <iframe class="dactyl-completions" id="dactyl-completions-dactyl-commandline" src="dactyl://content/buffer.xhtml"
                                contextmenu="dactyl-contextmenu"
                                flex="1" hidden="false" collapsed="false"
                                onclick="dactyl.modules.commandline.onMultilineOutputEvent(event)"/>
                    </vbox>

                    <stack orient="horizontal" align="stretch" class="dactyl-container" id="dactyl-container" highlight="CmdLine CmdCmdLine">
                        <textbox class="plain" id="dactyl-strut"   flex="1" crop="end" collapsed="true"/>
                        <textbox class="plain" id="dactyl-mode"    flex="1" crop="end"/>
                        <textbox class="plain" id="dactyl-message" flex="1" readonly="true"/>

                        <hbox id="dactyl-commandline" hidden="false" class="dactyl-container" highlight="Normal CmdNormal" collapsed="true">
                            <label   id="dactyl-commandline-prompt"  class="dactyl-commandline-prompt  plain" flex="0" crop="end" value="" collapsed="true"/>
                            <textbox id="dactyl-commandline-command" class="dactyl-commandline-command plain" flex="1" type="input" timeout="100"
                                     oninput="dactyl.modules.commandline.onEvent(event);"
                                     onkeyup="dactyl.modules.commandline.onEvent(event);"
                                     onfocus="dactyl.modules.commandline.onEvent(event);"
                                     onblur="dactyl.modules.commandline.onEvent(event);"/>
                        </hbox>
                    </stack>

                    <vbox class="dactyl-container" hidden="false" collapsed="false" highlight="CmdLine">
                        <textbox id="dactyl-multiline-input" class="plain" flex="1" rows="1" hidden="false" collapsed="true" multiline="true"
                                 highlight="Normal"
                                 onkeypress="dactyl.modules.commandline.onMultilineInputEvent(event);"
                                 oninput="dactyl.modules.commandline.onMultilineInputEvent(event);"
                                 onblur="dactyl.modules.commandline.onMultilineInputEvent(event);"/>
                    </vbox>
                </vbox>
            </e4x>.elements(),

            before: <e4x xmlns={XUL} xmlns:dactyl={NS}>
                <toolbar id={statusline.statusBar.id}>
                    <vbox id={"dactyl-completions-" + _status + "commandline-container"} class="dactyl-container" hidden="false" collapsed="true">
                        <iframe class="dactyl-completions" id={"dactyl-completions-" + _status + "commandline"} src="dactyl://content/buffer.xhtml"
                                contextmenu="dactyl-contextmenu"
                                flex="1" hidden="false" collapsed="false"
                                onclick="dactyl.modules.commandline.onMultilineOutputEvent(event)"/>
                    </vbox>
                </toolbar>
            </e4x>.elements()
        });

        this.elements = {};
        this.addElement({
            name: "container",
            noValue: true
        });
        this.addElement({
            name: "commandline",
            getGroup: function () options.get("guioptions").has("C") ? this.commandbar : this.statusbar,
            getValue: function () this.command
        });
        this.addElement({
            name: "strut",
            defaultGroup: "Normal",
            getGroup: function () this.commandbar,
            getValue: function () options.get("guioptions").has("c")
        });
        this.addElement({
            name: "command",
            id: "commandline-command",
            get: function (elem) {
                // The long path is because of complications with the
                // completion preview.
                try {
                    return elem.inputField.editor.rootElement.firstChild.textContent;
                }
                catch (e) {
                    return elem.value;
                }
            },
            getElement: CommandWidgets.getEditor,
            getGroup: function (value) this.activeGroup.commandline,
            onChange: function (elem) {
                if (elem.inputField != dactyl.focusedElement) {
                    try {
                        elem.selectionStart = elem.value.length;
                        elem.selectionEnd = elem.value.length;
                    }
                    catch (e) {}
                }
                if (!elem.collapsed)
                    dactyl.focus(elem);
            },
            onVisibility: function (elem, visible) { visible && dactyl.focus(elem); }
        });
        this.addElement({
            name: "prompt",
            id: "commandline-prompt",
            defaultGroup: "CmdPrompt",
            getGroup: function () this.activeGroup.commandline
        });
        this.addElement({
            name: "message",
            defaultGroup: "Normal",
            getElement: CommandWidgets.getEditor,
            getGroup: function (value) {
                if (this.command && !options.get("guioptions").has("M"))
                    return this.statusbar;

                let statusElem = this.statusbar.message;
                if (value && statusElem.editor && statusElem.editor.rootElement.scrollWidth > statusElem.scrollWidth)
                    return this.commandbar;
                return this.activeGroup.mode;
            }
        });
        this.addElement({
            name: "mode",
            defaultGroup: "ModeMsg",
            getGroup: function (value) {
                if (!options.get("guioptions").has("M"))
                    if (this.commandbar.container.clientHeight == 0 ||
                        value && !this.commandbar.commandline.collapsed)
                        return this.statusbar;
                return this.commandbar;
            }
        });

        let fontSize = util.computedStyle(document.documentElement).fontSize;
        styles.registerSheet("resource://dactyl-skin/dactyl.css");
        styles.system.add("font-size", "dactyl://content/buffer.xhtml",
                          "body { font-size: " + fontSize + "; }");
    },
    cleanup: function cleanup() {
        styles.unregisterSheet("resource://dactyl-skin/dactyl.css");
    },
    addElement: function (obj) {
        const self = this;
        this.elements[obj.name] = obj;

        function get(prefix, map, id) (obj.getElement || util.identity)(map[id] || document.getElementById(prefix + id));

        this.active.__defineGetter__(obj.name, function () self.activeGroup[obj.name][obj.name]);
        this.activeGroup.__defineGetter__(obj.name, function () self.getGroup(obj.name));

        memoize(this.statusbar, obj.name, function () get("dactyl-statusline-field-", statusline.widgets, (obj.id || obj.name)));
        memoize(this.commandbar, obj.name, function () get("dactyl-", {}, (obj.id || obj.name)));

        if (!(obj.noValue || obj.getValue))
            Object.defineProperty(this, obj.name, Modes.boundProperty({
                get: function () {
                    let elem = self.getGroup(obj.name, obj.value)[obj.name];
                    if (obj.value != null)
                        return [obj.value[0], obj.get ? obj.get.call(this, elem) : elem.value];
                    return null;
                },
                set: function (val) {
                    if (val != null && !isArray(val))
                        val = [obj.defaultGroup || "", val];
                    obj.value = val;

                    [this.commandbar, this.statusbar].forEach(function (nodeSet) {
                        let elem = nodeSet[obj.name];
                        if (val != null) {
                            highlight.highlightNode(elem,
                                (val[0] != null ? val[0] : obj.defaultGroup)
                                    .split(/\s/).filter(util.identity)
                                    .map(function (g) g + " " + nodeSet.group + g)
                                    .join(" "));
                            elem.value = val[1];
                            if (obj.onChange)
                                obj.onChange.call(this, elem);
                        }
                    }, this);

                    this.updateVisibility();
                    return val;
                }
            }).init(obj.name));
        else if (obj.defaultGroup)
            [this.commandbar, this.statusbar].forEach(function (nodeSet) {
                let elem = nodeSet[obj.name];
                if (elem)
                    highlight.highlightNode(elem, obj.defaultGroup.split(/\s/)
                                                     .map(function (g) g + " " + nodeSet.group + g).join(" "));
            });
    },
    getGroup: function (name, value) {
        if (!statusline.visible)
            return this.commandbar;
        return this.elements[name].getGroup.call(this, arguments.length > 1 ? value : this[name]);
    },
    updateVisibility: function () {
        for (let elem in values(this.elements))
            if (elem.getGroup) {
                let value = elem.getValue ? elem.getValue.call(this)
                          : elem.noValue || this[elem.name];

                let activeGroup = this.getGroup(elem.name, value);
                for (let group in values([this.commandbar, this.statusbar])) {
                    let meth, node = group[elem.name];
                    let visible = (value && group === activeGroup);
                    if (node && !node.collapsed == !visible) {
                        node.collapsed = !visible;
                        if (elem.onVisibility)
                            elem.onVisibility.call(this, node, visible);
                    }
                }
            }
        // Hack.
        function check(node) {
            if (util.computedStyle(node).display === "-moz-stack") {
                let nodes = Array.filter(node.children, function (n) !n.collapsed && n.boxObject.height);
                nodes.forEach(function (node, i) node.style.opacity = (i == nodes.length - 1) ? "" : "0");
            }
            Array.forEach(node.children, check);
        }
        [this.commandbar.container, this.statusbar.container].forEach(check);
    },

    active: Class.memoize(Object),
    activeGroup: Class.memoize(Object),
    commandbar: Class.memoize(function () ({ group: "Cmd" })),
    statusbar: Class.memoize(function ()  ({ group: "Status" })),

    _whenReady: function (name, id, processor) {
        Object.defineProperty(this, name, {
            configurable: true, enumerable: true,
            get: function () {
                let elem = document.getElementById(id);
                while (elem.contentDocument.documentURI != elem.getAttribute("src") ||
                       ["viewable", "complete"].indexOf(elem.contentDocument.readyState) < 0)
                    util.threadYield();
                res = res || (processor || util.identity).call(self, elem);
                return res;
            }
        });
        let res, self = this;
        return Class.replaceProperty(this, name, this[name])
    },

    get completionList() this._whenReady("completionList", "dactyl-completions"),
    completionContainer: Class.memoize(function () this.completionList.parentNode),
    get multilineOutput() this._whenReady("multilineOutput", "dactyl-multiline-output",
                                          function (elem) {
        elem.contentWindow.addEventListener("unload", function (event) { event.preventDefault(); }, true);
        elem.contentDocument.documentElement.id = "dactyl-multiline-output-top";
        elem.contentDocument.body.id = "dactyl-multiline-output-content";

        ["copy", "copylink", "selectall"].forEach(function (tail) {
            // some host apps use "hostPrefixContext-copy" ids
            let xpath = "//xul:menuitem[contains(@id, '" + "ontext-" + tail + "') and not(starts-with(@id, 'dactyl-'))]";
            document.getElementById("dactyl-context-" + tail).style.listStyleImage =
                util.computedStyle(util.evaluateXPath(xpath, document).snapshotItem(0)).listStyleImage;
        });
        return elem;
    }),
    multilineInput: Class.memoize(function () document.getElementById("dactyl-multiline-input")),
    mowContainer: Class.memoize(function () document.getElementById("dactyl-multiline-output-container"))
}, {
    getEditor: function (elem) {
        elem.inputField.QueryInterface(Ci.nsIDOMNSEditableElement);
        return elem;
    }
});

/**
 * This class is used for prompting of user input and echoing of messages.
 *
 * It consists of a prompt and command field be sure to only create objects of
 * this class when the chrome is ready.
 */
var CommandLine = Module("commandline", {
    init: function () {
        const self = this;

        this._callbacks = {};

        memoize(this, "_store", function () storage.newMap("command-history", { store: true, privateData: true }));

        for (let name in values(["command", "search"]))
            if (storage.exists("history-" + name)) {
                let ary = storage.newArray("history-" + name, { store: true, privateData: true });

                this._store.set(name, [v for ([k, v] in ary)]);
                ary.delete();
                this._store.changed();
            }

        this._messageHistory = { //{{{
            _messages: [],
            get messages() {
                let max = options["messages"];

                // resize if 'messages' has changed
                if (this._messages.length > max)
                    this._messages = this._messages.splice(this._messages.length - max);

                return this._messages;
            },

            get length() this._messages.length,

            clear: function clear() {
                this._messages = [];
            },

            filter: function filter(fn, self) {
                this._messages = this._messages.filter(fn, self);
            },

            add: function add(message) {
                if (!message)
                    return;

                if (this._messages.length >= options["messages"])
                    this._messages.shift();

                this._messages.push(update({
                    timestamp: Date.now()
                }, message));
            }
        }; //}}}

        this._lastMowOutput = null;

        this._silent = false;
        this._quiet = false;
        this._keepCommand = false;
        this._lastEcho = null;

        /////////////////////////////////////////////////////////////////////////////}}}
        ////////////////////// TIMERS //////////////////////////////////////////////////
        /////////////////////////////////////////////////////////////////////////////{{{

        this._autocompleteTimer = Timer(200, 500, function autocompleteTell(tabPressed) {
            dactyl.trapErrors(function _autocompleteTell() {
                if (!events.feedingKeys && self._completions && options["autocomplete"].length) {
                    self._completions.complete(true, false);
                    if (self._completions)
                        self._completions.itemList.show();
                }
            });
        });

        this._statusTimer = Timer(5, 100, function statusTell() {
            if (self._completions == null || self._completions.selected == null)
                statusline.progress = "";
            else
                statusline.progress = "match " + (self._completions.selected + 1) + " of " + self._completions.items.length;
        });

        // This timer just prevents <Tab>s from queueing up when the
        // system is under load (and, thus, giving us several minutes of
        // the completion list scrolling). Multiple <Tab> presses are
        // still processed normally, as the timer is flushed on "keyup".
        this._tabTimer = Timer(0, 0, function tabTell(event) {
            dactyl.trapErrors(function () {
                if (self._completions)
                    self._completions.tab(event.shiftKey, event.altKey && options["altwildmode"]);
            });
        });

        this._timers = [this._autocompleteTimer, this._statusTimer, this._tabTimer];

        /////////////////////////////////////////////////////////////////////////////}}}
        ////////////////////// VARIABLES ///////////////////////////////////////////////
        /////////////////////////////////////////////////////////////////////////////{{{

        this.__defineGetter__("_completionList", function () {
            let node = this.widgets.active.commandline;
            if (!node._completionList)
                this.widgets._whenReady.call(node, "_completionList", "dactyl-completions-" + node.id,
                                             function (node) ItemList(node.id));
            return node._completionList;
        });
        this._completions = null;
        this._history = null;

        this._startHints = false; // whether we're waiting to start hints mode
        this._lastSubstring = "";

        // we need to save the mode which were in before opening the command line
        // this is then used if we focus the command line again without the "official"
        // way of calling "open"
        this.currentExtendedMode = null; // the extended mode which we last opened the command line for

        // save the arguments for the inputMultiline method which are needed in the event handler
        this._multilineEnd = null;
        this._multilineCallback = null;

        this._input = {};

        this.registerCallback("submit", modes.EX, function (command) {
            try {
                var readHeredoc = io.readHeredoc;
                io.readHeredoc = commandline.readHeredoc;
                commands.repeat = command;
                commands.execute(command);
            }
            finally {
                io.readHeredoc = readHeredoc;
            }
        });
        this.registerCallback("complete", modes.EX, function (context) {
            context.fork("ex", 0, completion, "ex");
        });
        this.registerCallback("change", modes.EX, function (command, from) {
            if (from !== "history")
                self._autocompleteTimer.tell(false);
        });

        this.registerCallback("cancel", modes.PROMPT, cancelPrompt);
        this.registerCallback("submit", modes.PROMPT, closePrompt);
        this.registerCallback("change", modes.PROMPT, function (str) {
            if (self._input.complete)
                self._autocompleteTimer.tell(false);
            if (self._input.change)
                self._input.change.call(commandline, str);
        });
        this.registerCallback("complete", modes.PROMPT, function (context) {
            if (self._input.complete)
                context.fork("input", 0, commandline, self._input.complete);
        });

        function cancelPrompt(value) {
            let callback = self._input.cancel;
            self._input = {};
            if (callback)
                dactyl.trapErrors(callback, self, value != null ? value : commandline.command);
        }

        function closePrompt(value) {
            let callback = self._input.submit;
            self._input = {};
            if (callback)
                dactyl.trapErrors(callback, self, value != null ? value : commandline.command);
        }
    },

    /**
     * Determines whether the command line should be visible.
     *
     * @returns {boolean}
     */
    get commandVisible() modes.main == modes.COMMAND_LINE &&
        !(modes.extended & modes.INPUT_MULTILINE),

    /**
     * Ensure that the multiline input widget is the correct size.
     */
    _autosizeMultilineInputWidget: function () {
        let lines = this.widgets.multilineInput.value.split("\n").length - 1;

        this.widgets.multilineInput.setAttribute("rows", Math.max(lines, 1));
    },

    HL_NORMAL:     "Normal",
    HL_ERRORMSG:   "ErrorMsg",
    HL_MODEMSG:    "ModeMsg",
    HL_MOREMSG:    "MoreMsg",
    HL_QUESTION:   "Question",
    HL_INFOMSG:    "InfoMsg",
    HL_WARNINGMSG: "WarningMsg",
    HL_LINENR:     "LineNr",

    FORCE_MULTILINE    : 1 << 0,
    FORCE_SINGLELINE   : 1 << 1,
    DISALLOW_MULTILINE : 1 << 2, // If an echo() should try to use the single line
                                 // but output nothing when the MOW is open; when also
                                 // FORCE_MULTILINE is given, FORCE_MULTILINE takes precedence
    APPEND_TO_MESSAGES : 1 << 3, // Add the string to the message history.
    ACTIVE_WINDOW      : 1 << 4, // Only echo in active window.

    get completionContext() this._completions.context,

    get mode() (modes.extended == modes.EX) ? "cmd" : "search",

    get silent() this._silent,
    set silent(val) {
        this._silent = val;
        this._quiet = this._quiet;
    },
    get quiet() this._quiet,
    set quiet(val) {
        this._quiet = val;
        ["commandbar", "statusbar"].forEach(function (nodeSet) {
            Array.forEach(this.widgets[nodeSet].commandline.children, function (node) {
                node.style.opacity = this._quiet || this._silent ? "0" : "";
            }, this);
        }, this);
    },

    widgets: Class.memoize(function () CommandWidgets()),

    // @param type can be:
    //  "submit": when the user pressed enter in the command line
    //  "change"
    //  "cancel"
    //  "complete"
    registerCallback: function (type, mode, func) {
        if (!(type in this._callbacks))
            this._callbacks[type] = {};
        this._callbacks[type][mode] = func;
    },

    triggerCallback: function (type, mode) {
        if (this._callbacks[type] && this._callbacks[type][mode])
            try {
                this._callbacks[type][mode].apply(this, Array.slice(arguments, 2));
            }
            catch (e) {
                dactyl.reportError(e, true);
            }
    },

    runSilently: function (func, self) {
        this.withSavedValues(["_silent"], function () {
            this._silent = true;
            func.call(self);
        });
    },

    hideCompletions: function () {
        for (let nodeSet in values([this.widgets.statusbar, this.widgets.commandbar]))
            if (nodeSet.commandline._completionList)
                nodeSet.commandline._completionList.hide();
    },

    currentExtendedMode: Modes.boundProperty(),
    _completions: Modes.boundProperty(),
    _history: Modes.boundProperty(),
    _lastClearable: Modes.boundProperty(),
    _keepCommand: Modes.boundProperty(),
    messages: Modes.boundProperty(),

    multilineInputVisible: Modes.boundProperty({
        set: function (value) { this.widgets.multilineInput.collapsed = !value; }
    }),
    multilineOutputVisible: Modes.boundProperty({
        set: function (value) {
            this.widgets.mowContainer.collapsed = !value;
            let elem = this.widgets.multilineOutput;
            if (!value && elem && elem.contentWindow == document.commandDispatcher.focusedWindow)
                document.commandDispatcher.focusedWindow = content;
        }
    }),

    /**
     * Open the command line. The main mode is set to COMMAND_LINE, the
     * extended mode to *extendedMode*. Further, callbacks defined for
     * *extendedMode* are triggered as appropriate
     * (see {@link #registerCallback}).
     *
     * @param {string} prompt
     * @param {string} cmd
     * @param {number} extendedMode
     */
    open: function open(prompt, cmd, extendedMode) {
        this.widgets.message = null;

        this.currentExtendedMode = extendedMode || null;
        modes.push(modes.COMMAND_LINE, this.currentExtendedMode, {
            autocomplete: cmd.length,
            onEvent: this.closure.onEvent,
            history: (extendedMode || {}).params.history,
            leave: function (params) {
                if (params.pop)
                    commandline.leave();
            },
            keyModes: [this.currentExtendedMode]
        });

        this._keepCommand = false;

        this.widgets.active.commandline.collapsed = false;
        this.widgets.prompt = prompt;
        this.widgets.command = cmd || "";

        this.enter();
    },

    enter: function enter() {
        let params = modes.getStack(0).params;

        if (params.history)
            this._history = CommandLine.History(this.widgets.active.command.inputField, params.history);
        this._completions = CommandLine.Completions(this.widgets.active.command.inputField);

        if (params.autocomplete) {
            commandline.triggerCallback("change", this.currentExtendedMode, commandline.command);
            this._autocompleteTimer.flush();
        }
    },

    /**
     * Called when leaving a command-line mode.
     */
    leave: function leave() {
        commandline.triggerCallback("cancel", this.currentExtendedMode);

        this._timers.forEach(function (timer) timer.reset());
        if (this._completions)
            this._completions.previewClear();
        if (this._history)
            this._history.save();
        this.resetCompletions(); // cancels any asynchronous completion still going on, must be before we set completions = null
        this.hideCompletions();
        this._completions = null;
        this._history = null;
        this._statusTimer.tell();

        if (!this._keepCommand || this._silent || this._quiet) {
            modes.delay(function () {
                this.updateMorePrompt();
                this.hide();
            }, this);
        }
    },

    get command() {
        if (this.commandVisible && this.widgets.command)
            return this._lastCommand = this.widgets.command[1];
        return this._lastCommand;
    },
    set command(val) {
        if (this.commandVisible && (modes.extended & modes.EX))
            return this.widgets.command = val;
        return this._lastCommand = val;
    },
    get lastCommand() this._lastCommand || this.command,
    set lastCommand(val) { this._lastCommand = val },

    clear: function () {
        if (this.widgets.message && this.widgets.message[1] === this._lastClearable)
            this.widgets.message = null;
        if (modes.main != modes.COMMAND_LINE)
            this.widgets.command = null;
        if (modes.main == modes.OUTPUT_MULTILINE && !mow.isScrollable(1))
            modes.pop();
        if (modes.main != modes.OUTPUT_MULTILINE)
            this.multilineOutputVisible = false;
    },

    /**
     * Displays the multi-line output of a command, preceded by the last
     * executed ex command string.
     *
     * @param {XML} xml The output as an E4X XML object.
     */
    commandOutput: function (xml) {
        XML.ignoreWhitespace = false;
        XML.prettyPrinting = false;
        if (this.command)
            this.echo(<>:{this.command}</>, this.HIGHLIGHT_NORMAL, this.FORCE_MULTILINE);
        this.echo(xml, this.HIGHLIGHT_NORMAL, this.FORCE_MULTILINE);
        this.command = null;
    },

    /**
     * Hides the command line, and shows any status messages that
     * are under it.
     */
    hide: function hide() {
        this.widgets.command = null;
    },

    /**
     * Display a message in the command-line area.
     *
     * @param {string} str
     * @param {string} highlightGroup
     * @param {boolean} forceSingle If provided, don't let over-long
     *     messages move to the MOW.
     */
    _echoLine: function echoLine(str, highlightGroup, forceSingle, silent) {
        this.widgets.message = str ? [highlightGroup, str] : null;

        dactyl.triggerObserver("echoLine", str, highlightGroup, forceSingle);

        if (!this.commandVisible)
            this.hide();

        let field = this.widgets.active.message.inputField;
        if (field.value && !forceSingle && field.editor.rootElement.scrollWidth > field.scrollWidth) {
            this.widgets.message = null;
            this._echoMultiline(<span highlight="Message">{str}</span>, highlightGroup, true);
        }
    },

    /**
     * Display a multi-line message.
     *
     * @param {string} data
     * @param {string} highlightGroup
     */
    _echoMultiline: function echoMultiline(data, highlightGroup, silent) {
        let doc = this.widgets.multilineOutput.contentDocument;
        let win = this.widgets.multilineOutput.contentWindow;
        let elem = doc.documentElement;
        let body = doc.body;

        this.widgets.message = null;
        if (!this.commandVisible)
            this.hide();

        this._startHints = false;
        if (modes.main != modes.OUTPUT_MULTILINE) {
            modes.push(modes.OUTPUT_MULTILINE, null, {
                onEvent: this.closure.onMultilineOutputEvent,
                leave: this.closure(function leave(stack) {
                    if (stack.pop)
                        for (let message in values(this.messages))
                            if (message.leave)
                                message.leave(stack);
                })
            });
            this.messages = [];
        }

        // If it's already XML, assume it knows what it's doing.
        // Otherwise, white space is significant.
        // The problem elsewhere is that E4X tends to insert new lines
        // after interpolated data.
        XML.ignoreWhitespace = XML.prettyPrinting = false;

        if (isObject(data)) {
            this._lastMowOutput = null;

            var output = util.xmlToDom(<div class="ex-command-output" style="white-space: nowrap" highlight={highlightGroup}/>, doc);
            data.document = doc;
            output.appendChild(data.message);

            this.messages.push(data);
        }
        else {
            let style = isString(data) ? "pre" : "nowrap";
            this._lastMowOutput = <div class="ex-command-output" style={"white-space: " + style} highlight={highlightGroup}>{data}</div>;

            var output = util.xmlToDom(this._lastMowOutput, doc);
        }

        // FIXME: need to make sure an open MOW is closed when commands
        //        that don't generate output are executed
        if (this.widgets.mowContainer.collapsed) {
            elem.scrollTop = 0;
            while (body.firstChild)
                body.removeChild(body.firstChild);
        }

        body.appendChild(output);

        let str = typeof data !== "xml" && data.message || data;
        if (!silent)
            dactyl.triggerObserver("echoMultiline", data, highlightGroup, output);

        commandline.updateOutputHeight(true);

        if (options["more"] && Buffer.isScrollable(elem, 1)) {
            // start the last executed command's output at the top of the screen
            let elements = doc.getElementsByClassName("ex-command-output");
            elements[elements.length - 1].scrollIntoView(true);
        }
        else
            elem.scrollTop = elem.scrollHeight;

        dactyl.focus(win);

        commandline.updateMorePrompt();
    },

    /**
     * Output the given string onto the command line. With no flags, the
     * message will be shown in the status line if it's short enough to
     * fit, and contains no new lines, and isn't XML. Otherwise, it will be
     * shown in the MOW.
     *
     * @param {string} str
     * @param {string} highlightGroup The Highlight group for the
     *     message.
     * @default "Normal"
     * @param {number} flags Changes the behavior as follows:
     *   commandline.APPEND_TO_MESSAGES - Causes message to be added to the
     *          messages history, and shown by :messages.
     *   commandline.FORCE_SINGLELINE   - Forbids the command from being
     *          pushed to the MOW if it's too long or of there are already
     *          status messages being shown.
     *   commandline.DISALLOW_MULTILINE - Cancels the operation if the MOW
     *          is already visible.
     *   commandline.FORCE_MULTILINE    - Forces the message to appear in
     *          the MOW.
     */
    echo: function echo(data, highlightGroup, flags) {
        // dactyl.echo uses different order of flags as it omits the highlight group, change commandline.echo argument order? --mst
        if (this._silent)
            return;

        highlightGroup = highlightGroup || this.HL_NORMAL;

        if (flags & this.APPEND_TO_MESSAGES) {
            let message = isObject(data) ? data : { message: data };
            this._messageHistory.add(update({ highlight: highlightGroup }, message));
            data = message.message;
        }

        if ((flags & this.ACTIVE_WINDOW) &&
            window != services.windowWatcher.activeWindow &&
            services.windowWatcher.activeWindow.dactyl)
            return;

        if ((flags & this.DISALLOW_MULTILINE) && !this.widgets.mowContainer.collapsed)
            return;

        let single = flags & (this.FORCE_SINGLELINE | this.DISALLOW_MULTILINE);
        let action = this._echoLine;

        if ((flags & this.FORCE_MULTILINE) || (/\n/.test(data) || !isString(data)) && !(flags & this.FORCE_SINGLELINE))
            action = this._echoMultiline;

        if (single)
            this._lastEcho = null;
        else {
            if (this.widgets.message && this.widgets.message[1] == this._lastEcho)
                this._echoMultiline(<span highlight="Message">{this._lastEcho}</span>,
                                    this.widgets.message[0], true);

            if (action === this._echoLine && !(flags & this.FORCE_MULTILINE)
                && !(dactyl.fullyInitialized && this.widgets.mowContainer.collapsed)) {
                highlightGroup += " Message";
                action = this._echoMultiline;
            }
            this._lastEcho = (action == this._echoLine) && data;
        }

        this._lastClearable = action === this._echoLine && String(data);

        if (action)
            action.call(this, data, highlightGroup, single);
    },

    /**
     * Prompt the user. Sets modes.main to COMMAND_LINE, which the user may
     * pop at any time to close the prompt.
     *
     * @param {string} prompt The input prompt to use.
     * @param {function(string)} callback
     * @param {Object} extra
     * @... {function} onChange - A function to be called with the current
     *     input every time it changes.
     * @... {function(CompletionContext)} completer - A completion function
     *     for the user's input.
     * @... {string} promptHighlight - The HighlightGroup used for the
     *     prompt. @default "Question"
     * @... {string} default - The initial value that will be returned
     *     if the user presses <CR> straightaway. @default ""
     */
    input: function _input(prompt, callback, extra) {
        extra = extra || {};

        this._input = {
            submit: callback || extra.onAccept,
            change: extra.onChange,
            complete: extra.completer,
            cancel: extra.onCancel
        };

        modes.push(modes.COMMAND_LINE, modes.PROMPT | extra.extended,
                   update(Object.create(extra), {
                       onEvent: extra.onEvent || this.closure.onEvent,
                       leave: function leave(stack) {
                           commandline.leave(stack);
                           leave.supercall(this, stack);
                       },
                       keyModes: [extra.extended, modes.PROMPT]
                   }));
        this.currentExtendedMode = modes.PROMPT;

        this.widgets.prompt = !prompt ? null : [extra.promptHighlight || "Question", prompt];
        this.widgets.command = extra.default || "";
        this.widgets.active.commandline.collapsed = false;

        this.enter();
    },

    readHeredoc: function (end) {
        let args;
        commandline.inputMultiline(end,
            function (res) { args = res; });
        while (args === undefined)
            util.threadYield(true);
        return args;
    },

    /**
     * Get a multi-line input from a user, up to but not including the line
     * which matches the given regular expression. Then execute the
     * callback with that string as a parameter.
     *
     * @param {string} end
     * @param {function(string)} callbackFunc
     */
    // FIXME: Buggy, especially when pasting.
    inputMultiline: function inputMultiline(end, callbackFunc) {
        let cmd = this.command;
        modes.push(modes.COMMAND_LINE, modes.INPUT_MULTILINE);
        if (cmd != false)
            this._echoLine(cmd, this.HL_NORMAL);

        // save the arguments, they are needed in the event handler onEvent
        this._multilineEnd = "\n" + end + "\n";
        this._multilineCallback = callbackFunc;

        this.multilineInputVisible = true;
        this.widgets.multilineInput.value = "";
        this._autosizeMultilineInputWidget();

        this.timeout(function () { dactyl.focus(this.widgets.multilineInput); }, 10);
    },

    onContext: function onContext(event) {
        try {
            let enabled = {
                link: window.document.popupNode instanceof HTMLAnchorElement,
                path: window.document.popupNode.hasAttribute("path"),
                selection: !window.document.commandDispatcher.focusedWindow.getSelection().isCollapsed
            };

            for (let node in array.iterValues(event.target.children)) {
                let group = node.getAttributeNS(NS, "group");
                util.dump(node, group, group && !group.split(/\s+/).every(function (g) enabled[g]));
                node.hidden = group && !group.split(/\s+/).every(function (g) enabled[g]);
            }
        }
        catch (e) {
            util.reportError(e);
        }
        return true;
    },

    /**
     * Handles all command-line events. All key events are passed here when
     * COMMAND_LINE mode is active, as well as all input, keyup, focus, and
     * blur events sent to the command-line XUL element.
     *
     * @param {Event} event
     * @private
     */
    onEvent: function onEvent(event) {
        const KILL = false, PASS = true;

        try {
            let command = this.command;

            if (event.type == "blur") {
                this.timeout(function () {
                    if (this.commandVisible && event.originalTarget == this.widgets.active.command.inputField)
                        dactyl.focus(this.widgets.active.command.inputField);
                });
            }
            else if (event.type == "focus") {
                if (!this.commandVisible && event.target == this.widgets.active.command.inputField) {
                    event.target.blur();
                    dactyl.beep();
                }
            }
            else if (event.type == "input") {
                this.resetCompletions();
                commandline.triggerCallback("change", this.currentExtendedMode, command);
            }
            else if (event.type == "keypress") {
                let key = events.toString(event);
                if (this._completions)
                    this._completions.previewClear();

                return PASS;
            }
            else if (event.type == "keyup") {
                let key = events.toString(event);
                if (/^<(?:A-)?(?:S-)?Tab>$/.test(key))
                    this._tabTimer.flush();
            }
        }
        catch (e) {
            dactyl.reportError(e, true);
        }
        return PASS;
    },

    /**
     * Multiline input events, they will come straight from
     * #dactyl-multiline-input in the XUL.
     *
     * @param {Event} event
     */
    onMultilineInputEvent: function onMultilineInputEvent(event) {
        const KILL = false, PASS = true;

        if (event.type == "keypress") {
            let key = events.toString(event);
            if (events.isAcceptKey(key)) {
                let text = "\n" + this.widgets.multilineInput.value.substr(0, this.widgets.multilineInput.selectionStart) + "\n";
                let index = text.indexOf(this._multilineEnd);
                if (index >= 0) {
                    text = text.substring(1, index);
                    let callback = this._multilineCallback;
                    modes.pop();
                    callback.call(this, text);
                }
            }
            else if (events.isCancelKey(key)) {
                modes.pop();
            }
        }
        else if (event.type == "blur") {
            if (modes.extended & modes.INPUT_MULTILINE)
                this.timeout(function () { dactyl.focus(this.widgets.multilineInput.inputField); }, 0);
        }
        else if (event.type == "input")
            this._autosizeMultilineInputWidget();
        return PASS;
    },

    /**
     * Handle events when we are in multi-line output mode, these come from
     * dactyl when modes.extended & modes.OUTPUT_MULTILINE and also from
     * #dactyl-multiline-output in the XUL.
     *
     * @param {Event} event
     */
    // FIXME: if 'more' is set and the MOW is not scrollable we should still
    // allow a down motion after an up rather than closing
    onMultilineOutputEvent: function onMultilineOutputEvent(event) {
        try {
            const KILL = false, PASS = true;

            let win = this.widgets.multilineOutput.contentWindow;
            let elem = win.document.documentElement;

            let key = events.toString(event);

            const openLink = function openLink(where) {
                event.preventDefault();
                dactyl.open(event.target.href, where);
            }

            // TODO: Wouldn't multiple handlers be cleaner? --djk
            if (event.type == "click" && event.target instanceof HTMLAnchorElement) {

                if (event.getPreventDefault())
                    return;

                switch (key) {
                case "<LeftMouse>":
                    event.preventDefault();
                    openLink(dactyl.CURRENT_TAB);
                    return KILL;
                case "<MiddleMouse>":
                case "<C-LeftMouse>":
                case "<C-M-LeftMouse>":
                    openLink({ where: dactyl.NEW_TAB, background: true });
                    return KILL;
                case "<S-MiddleMouse>":
                case "<C-S-LeftMouse>":
                case "<C-M-S-LeftMouse>":
                    openLink({ where: dactyl.NEW_TAB, background: false });
                    return KILL;
                case "<S-LeftMouse>":
                    openLink(dactyl.NEW_WINDOW);
                    return KILL;
                }
                return PASS;
            }

            if (event instanceof MouseEvent)
                return KILL;

            if (!options["more"] || !mow.isScrollable(1)) {
                modes.pop();
                events.feedkeys(key);
            }
            else
                commandline.updateMorePrompt(false, true);
        }
        catch (e) {
            util.reportError(e);
        }
        return PASS;
    },

    getSpaceNeeded: function getSpaceNeeded() {
        let rect = this.widgets.commandbar.commandline.getBoundingClientRect();
        let offset = rect.bottom - window.innerHeight;
        return Math.max(0, offset);
    },

    /**
     * Update or remove the multi-line output widget's "MORE" prompt.
     *
     * @param {boolean} force If true, "-- More --" is shown even if we're
     *     at the end of the output.
     * @param {boolean} showHelp When true, show the valid key sequences
     *     and what they do.
     */
    updateMorePrompt: function updateMorePrompt(force, showHelp) {
        if (this.widgets.mowContainer.collapsed)
            return this.widgets.message = null;
        let elem = this.widgets.multilineOutput.contentDocument.documentElement;

        if (showHelp)
            this.widgets.message = ["MoreMsg", "-- More -- SPACE/<C-f>/j: screen/page/line down, <C-b>/<C-u>/k: up, q: quit"];
        else if (force || (options["more"] && Buffer.isScrollable(elem, 1)))
            this.widgets.message = ["MoreMsg", "-- More --"];
        else
            this.widgets.message = ["Question", "Press ENTER or type command to continue"];
    },

    /**
     * Changes the height of the message window to fit in the available space.
     *
     * @param {boolean} open If true, the widget will be opened if it's not
     *     already so.
     */
    updateOutputHeight: function updateOutputHeight(open, extra) {
        if (!open && this.widgets.mowContainer.collapsed)
            return;

        let doc = this.widgets.multilineOutput.contentDocument;

        let availableHeight = config.outputHeight;
        if (!this.widgets.mowContainer.collapsed)
            availableHeight += parseFloat(this.widgets.mowContainer.height);
        availableHeight -= extra || 0;

        doc.body.style.minWidth = this.widgets.commandbar.commandline.scrollWidth + "px";
        this.widgets.mowContainer.height = Math.min(doc.body.clientHeight, availableHeight) + "px";
        this.timeout(function ()
            this.widgets.mowContainer.height = Math.min(doc.body.clientHeight, availableHeight) + "px",
            0);

        doc.body.style.minWidth = "";
        this.multilineOutputVisible = true;
    },

    resetCompletions: function resetCompletions() {
        if (this._completions) {
            this._completions.context.cancelAll();
            this._completions.wildIndex = -1;
            this._completions.previewClear();
        }
        if (this._history)
            this._history.reset();
    },

    withOutputToString: function (fn, self) {
        let buffer = [];
        dactyl.registerObserver("echoLine", observe, true);
        dactyl.registerObserver("echoMultiline", observe, true);
        function observe(str, highlight, dom) {
            buffer.push(dom && !isString(str) ? util.domToString(dom) : str);
        }

        this.savingOutput = true;
        dactyl.trapErrors.apply(dactyl, [fn, self].concat(Array.slice(arguments, 2)));
        this.savingOutput = false;
        return buffer.join("\n");
    }
}, {
    /**
     * A class for managing the history of an input field.
     *
     * @param {HTMLInputElement} inputField
     * @param {string} mode The mode for which we need history.
     */
    History: Class("History", {
        init: function (inputField, mode) {
            this.mode = mode;
            this.input = inputField;
            this.reset();
        },
        get store() commandline._store.get(this.mode, []),
        set store(ary) { commandline._store.set(this.mode, ary); },
        /**
         * Reset the history index to the first entry.
         */
        reset: function () {
            this.index = null;
        },
        /**
         * Save the last entry to the permanent store. All duplicate entries
         * are removed and the list is truncated, if necessary.
         */
        save: function () {
            if (events.feedingKeys)
                return;
            let str = this.input.value;
            if (/^\s*$/.test(str))
                return;
            this.store = this.store.filter(function (line) (line.value || line) != str);
            try {
                this.store.push({ value: str, timestamp: Date.now()*1000, privateData: this.checkPrivate(str) });
            }
            catch (e) {
                dactyl.reportError(e);
            }
            this.store = this.store.slice(-options["history"]);
        },
        /**
         * @property {function} Returns whether a data item should be
         * considered private.
         */
        checkPrivate: function (str) {
            // Not really the ideal place for this check.
            if (this.mode == "command")
                return commands.hasPrivateData(str);
            return false;
        },
        /**
         * Replace the current input field value.
         *
         * @param {string} val The new value.
         */
        replace: function (val) {
            this.input.value = val;
            commandline.triggerCallback("change", commandline.currentExtendedMode, val, "history");
        },

        /**
         * Move forward or backward in history.
         *
         * @param {boolean} backward Direction to move.
         * @param {boolean} matchCurrent Search for matches starting
         *      with the current input value.
         */
        select: function (backward, matchCurrent) {
            // always reset the tab completion if we use up/down keys
            if (commandline._completions)
                commandline._completions.reset();

            let diff = backward ? -1 : 1;

            if (this.index == null) {
                this.original = this.input.value;
                this.index = this.store.length;
            }

            // search the history for the first item matching the current
            // command-line string
            while (true) {
                this.index += diff;
                if (this.index < 0 || this.index > this.store.length) {
                    this.index = Math.constrain(this.index, 0, this.store.length);
                    dactyl.beep();
                    // I don't know why this kludge is needed. It
                    // prevents the caret from moving to the end of
                    // the input field.
                    if (this.input.value == "") {
                        this.input.value = " ";
                        this.input.value = "";
                    }
                    break;
                }

                let hist = this.store[this.index];
                // user pressed DOWN when there is no newer history item
                if (!hist)
                    hist = this.original;
                else
                    hist = (hist.value || hist);

                if (!matchCurrent || hist.substr(0, this.original.length) == this.original) {
                    this.replace(hist);
                    break;
                }
            }
        }
    }),

    /**
     * A class for tab completions on an input field.
     *
     * @param {Object} input
     */
    Completions: Class("Completions", {
        init: function (input) {
            this.context = CompletionContext(input.QueryInterface(Ci.nsIDOMNSEditableElement).editor);
            this.context.onUpdate = this.closure._reset;
            this.editor = input.editor;
            this.selected = null;
            this.wildmode = options.get("wildmode");
            this.wildtypes = this.wildmode.value;
            this.itemList = commandline._completionList;
            this.itemList.setItems(this.context);
        },

        UP: {},
        DOWN: {},
        PAGE_UP: {},
        PAGE_DOWN: {},
        RESET: null,

        get completion() {
            let str = commandline.command;
            return str.substring(this.prefix.length, str.length - this.suffix.length);
        },
        set completion(completion) {
            this.previewClear();

            // Change the completion text.
            // The second line is a hack to deal with some substring
            // preview corner cases.
            let value = this.prefix + completion + this.suffix;
            commandline.widgets.active.command.value = value;
            this.editor.selection.focusNode.textContent = value;

            // Reset the caret to one position after the completion.
            this.caret = this.prefix.length + completion.length;
            this._caret = this.caret;
        },

        get caret() this.editor.selection.getRangeAt(0).startOffset,
        set caret(offset) {
            this.editor.selection.getRangeAt(0).setStart(this.editor.rootElement.firstChild, offset);
            this.editor.selection.getRangeAt(0).setEnd(this.editor.rootElement.firstChild, offset);
        },

        get start() this.context.allItems.start,

        get items() this.context.allItems.items,

        get substring() this.context.longestAllSubstring,

        get wildtype() this.wildtypes[this.wildIndex] || "",

        complete: function complete(show, tabPressed) {
            this.context.reset();
            this.context.tabPressed = tabPressed;
            commandline.triggerCallback("complete", commandline.currentExtendedMode, this.context);
            this.context.updateAsync = true;
            this.reset(show, tabPressed);
            this.wildIndex = 0;
        },

        haveType: function (type)
            this.wildmode.checkHas(this.wildtype, type == "first" ? "" : type),

        preview: function preview() {
            this.previewClear();
            if (this.wildIndex < 0 || this.suffix || !this.items.length)
                return;

            let substring = "";
            switch (this.wildtype.replace(/.*:/, "")) {
            case "":
                substring = this.items[0].result;
                break;
            case "longest":
                if (this.items.length > 1) {
                    substring = this.substring;
                    break;
                }
                // Fallthrough
            case "full":
                let item = this.items[this.selected != null ? this.selected + 1 : 0];
                if (item)
                    substring = item.result;
                break;
            }

            // Don't show 1-character substrings unless we've just hit backspace
            if (substring.length < 2 && (!this._lastSubstring || this._lastSubstring.indexOf(substring) != 0))
                return;

            this._lastSubstring = substring;

            let value = this.completion;
            if (util.compareIgnoreCase(value, substring.substr(0, value.length)))
                return;
            substring = substring.substr(value.length);
            this.removeSubstring = substring;

            let node = util.xmlToDom(<span highlight="Preview">{substring}</span>,
                document);
            let start = this.caret;
            this.editor.insertNode(node, this.editor.rootElement, 1);
            this.caret = start;
        },

        previewClear: function previewClear() {
            let node = this.editor.rootElement.firstChild;
            if (node && node.nextSibling) {
                try {
                    this.editor.deleteNode(node.nextSibling);
                }
                catch (e) {
                    node.nextSibling.textContent = "";
                }
            }
            else if (this.removeSubstring) {
                let str = this.removeSubstring;
                let cmd = commandline.widgets.active.command.value;
                if (cmd.substr(cmd.length - str.length) == str)
                    commandline.widgets.active.command.value = cmd.substr(0, cmd.length - str.length);
            }
            delete this.removeSubstring;
        },

        reset: function reset(show) {
            this.wildIndex = -1;

            this.prefix = this.context.value.substring(0, this.start);
            this.value  = this.context.value.substring(this.start, this.caret);
            this.suffix = this.context.value.substring(this.caret);

            if (show) {
                this.itemList.reset();
                this.selected = null;
                this.wildIndex = 0;
            }

            this.preview();
        },

        _reset: function _reset() {
            let value = this.editor.selection.focusNode.textContent;
            this.prefix = value.substring(0, this.start);
            this.value  = value.substring(this.start, this.caret);
            this.suffix = value.substring(this.caret);

            this.itemList.reset();
            this.itemList.selectItem(this.selected);

            this.preview();
        },

        select: function select(idx) {
            switch (idx) {
            case this.UP:
                if (this.selected == null)
                    idx = -2;
                else
                    idx = this.selected - 1;
                break;
            case this.DOWN:
                if (this.selected == null)
                    idx = 0;
                else
                    idx = this.selected + 1;
                break;
            case this.RESET:
                idx = null;
                break;
            default:
                idx = Math.constrain(idx, 0, this.items.length - 1);
                break;
            }

            if (idx == -1 || this.items.length && idx >= this.items.length || idx == null) {
                // Wrapped. Start again.
                this.selected = null;
                this.completion = this.value;
            }
            else {
                // Wait for contexts to complete if necessary.
                // FIXME: Need to make idx relative to individual contexts.
                let list = this.context.contextList;
                if (idx == -2)
                    list = list.slice().reverse();
                let n = 0;
                try {
                    this.waiting = true;
                    for (let [, context] in Iterator(list)) {
                        let done = function done() !(idx >= n + context.items.length || idx == -2 && !context.items.length);
                        while (context.incomplete && !done())
                            util.threadYield(false, true);

                        if (done())
                            break;

                        n += context.items.length;
                    }
                }
                finally {
                    this.waiting = false;
                }

                // See previous FIXME. This will break if new items in
                // a previous context come in.
                if (idx < 0)
                    idx = this.items.length - 1;
                if (this.items.length == 0)
                    return;

                this.selected = idx;
                this.completion = this.items[idx].result;
            }

            this.itemList.selectItem(idx);
        },

        tabs: [],

        tab: function tab(reverse, wildmode) {
            commandline._autocompleteTimer.flush();
            if (this._caret != this.caret)
                this.reset();
            this._caret = this.caret;

            // Check if we need to run the completer.
            if (this.context.waitingForTab || this.wildIndex == -1)
                this.complete(true, true);

            this.tabs.push([reverse, wildmode || options["wildmode"]]);
            if (this.waiting)
                return;

            while (this.tabs.length) {
                [reverse, this.wildtypes] = this.tabs.shift();

                this.wildIndex = Math.min(this.wildIndex, this.wildtypes.length - 1);
                switch (this.wildtype.replace(/.*:/, "")) {
                case "":
                    this.select(0);
                    break;
                case "longest":
                    if (this.items.length > 1) {
                        if (this.substring && this.substring != this.completion)
                            this.completion = this.substring;
                        break;
                    }
                    // Fallthrough
                case "full":
                    this.select(reverse ? this.UP : this.DOWN);
                    break;
                }

                if (this.haveType("list"))
                    this.itemList.show();

                this.wildIndex++;
                this.preview();

                commandline._statusTimer.tell();
            }

            if (this.items.length == 0)
                dactyl.beep();
        }
    }),

    /**
     * Evaluate a JavaScript expression and return a string suitable
     * to be echoed.
     *
     * @param {string} arg
     * @param {boolean} useColor When true, the result is a
     *     highlighted XML object.
     */
    echoArgumentToString: function (arg, useColor) {
        if (!arg)
            return "";

        arg = dactyl.userEval(arg);
        if (isObject(arg))
            arg = util.objectToString(arg, useColor);
        else
            arg = String(arg);
        return arg;
    }
}, {
    commands: function () {
        [
            {
                name: "ec[ho]",
                description: "Echo the expression",
                action: dactyl.echo
            },
            {
                name: "echoe[rr]",
                description: "Echo the expression as an error message",
                action: dactyl.echoerr
            },
            {
                name: "echom[sg]",
                description: "Echo the expression as an informational message",
                action: dactyl.echomsg
            }
        ].forEach(function (command) {
            commands.add([command.name],
                command.description,
                function (args) {
                    command.action(CommandLine.echoArgumentToString(args[0] || "", true));
                }, {
                    completer: function (context) completion.javascript(context),
                    literal: 0
                });
        });

        commands.add(["mes[sages]"],
            "Display previously shown messages",
            function () {
                // TODO: are all messages single line? Some display an aggregation
                //       of single line messages at least. E.g. :source
                if (commandline._messageHistory.length == 1) {
                    let message = commandline._messageHistory.messages[0];
                    commandline.echo(message.message, message.highlight, commandline.FORCE_SINGLELINE);
                }
                else if (commandline._messageHistory.length > 1) {
                    XML.ignoreWhitespace = false;
                    commandline.commandOutput(
                        template.map(commandline._messageHistory.messages, function (message)
                            <div highlight={message.highlight + " Message"}>{message.message}</div>));
                }
            },
            { argCount: "0" });

        commands.add(["messc[lear]"],
            "Clear the message history",
            function () { commandline._messageHistory.clear(); },
            { argCount: "0" });

        commands.add(["sil[ent]"],
            "Run a command silently",
            function (args) {
                commandline.runSilently(function () commands.execute(args[0] || "", null, true));
            }, {
                completer: function (context) completion.ex(context),
                literal: 0,
                subCommand: 0
            });
    },
    mappings: function () {

        mappings.add([modes.COMMAND],
            [":"], "Enter command-line mode",
            function () { commandline.open(":", "", modes.EX); });

        let bind = function bind()
            mappings.add.apply(mappings, [[modes.COMMAND_LINE]].concat(Array.slice(arguments)))

        // Any "non-keyword" character triggers abbreviation expansion
        // TODO: Add "<CR>" and "<Tab>" to this list
        //       At the moment, adding "<Tab>" breaks tab completion. Adding
        //       "<CR>" has no effect.
        // TODO: Make non-keyword recognition smarter so that there need not
        //       be two lists of the same characters (one here and a regexp in
        //       mappings.js)
        bind(["<Space>", '"', "'"], "Expand command line abbreviation",
             function () {
                 commandline.resetCompletions();
                 editor.expandAbbreviation(modes.COMMAND_LINE);
                 return Events.PASS;
             });

        bind(["<Return>", "<C-j>", "<C-m>"], "Accept the current input",
             function (args) {
                 commandline._keepCommand = userContext.hidden_option_command_afterimage;
                 let mode = commandline.currentExtendedMode;
                 commandline.currentExtendedMode = null; // Don't let modes.pop trigger "cancel"
                 modes.pop();
                 commandline.triggerCallback("submit", mode, commandline.command);
             });

        [
            [["<Up>", "<A-p>"],                   "previous matching", true,  true],
            [["<S-Up>", "<C-p>", "<PageUp>"],     "previous",          true,  false],
            [["<Down>", "<A-n>"],                 "next matching",     false, true],
            [["<S-Down>", "<C-n>", "<PageDown>"], "next",              false, false]
        ].forEach(function ([keys, desc, up, search]) {
            bind(keys, "Recall the " + desc + " command line from the history list",
                 function (args) {
                     dactyl.assert(commandline._history);
                     commandline._history.select(up, search);
                 });
        });

        bind(["<A-Tab>", "<Tab>"], "Select the next matching completion item",
             function ({ events }) { commandline._tabTimer.tell(events[0]); });

        bind(["<A-S-Tab>", "<S-Tab>"], "Select the previous matching completion item",
             function ({ events }) { commandline._tabTimer.tell(events[0]); });

        bind(["<BS>", "<C-h>"], "Delete the previous character",
             function () {
                 if (!commandline.command)
                     modes.pop();
                 else
                     return Events.PASS;
             });

        bind(["<C-]>", "<C-5>"], "Expand command line abbreviation",
             function () { editor.expandAbbreviation(modes.COMMAND_LINE); });

        bind(["g<"], "Redisplay the last command output",
             function () {
                 dactyl.assert(commandline._lastMowOutput, "No previous command output");
                 commandline._echoMultiline(commandline._lastMowOutput, commandline.HL_NORMAL);
             });

        let mow = modules.mow = {
            __noSuchMethod__: function (meth, args) Buffer[meth].apply(Buffer, [this.body].concat(args))
        };
        memoize(mow, "body", function () commandline.widgets.multilineOutput.contentDocument.documentElement);
        memoize(mow, "window", function () commandline.widgets.multilineOutput.contentWindow);

        const PASS = true;
        const DROP = false;
        const BEEP = {};

        bind = function bind(keys, description, action, test, default_) {
            mappings.add([modes.OUTPUT_MULTILINE],
                keys, description,
                function (command) {
                    if (!options["more"])
                        var res = PASS;
                    else if (test && !test(command))
                        res = default_;
                    else
                        res = action.call(command);

                    if (res === PASS || res === DROP)
                        modes.pop();
                    else
                        commandline.updateMorePrompt();
                    if (res === BEEP)
                        dactyl.beep();
                    else if (res === PASS)
                        events.feedkeys(command);
                });
        }

        bind(["j", "<C-e>", "<Down>"], "Scroll down one line",
             function () { mow.scrollVertical("lines", 1); },
             function () mow.isScrollable(1), BEEP);

        bind(["k", "<C-y>", "<Up>"], "Scroll up one line",
             function () { mow.scrollVertical("lines", -1); },
             function () mow.isScrollable(-1), BEEP);

        bind(["<C-j>", "<C-m>", "<Return>"], "Scroll down one line, exit on last line",
             function () { mow.scrollVertical("lines", 1); },
             function () mow.isScrollable(1), DROP);

        // half page down
        bind(["<C-d>"], "Scroll down half a page",
             function () { mow.scrollVertical("pages", .5); },
             function () mow.isScrollable(1), BEEP);

        bind(["<C-f>", "<PageDown>"], "Scroll down one page",
             function () { mow.scrollVertical("pages", 1); },
             function () mow.isScrollable(1), BEEP);

        bind(["<Space>"], "Scroll down one page",
             function () { mow.scrollVertical("pages", 1); },
             function () mow.isScrollable(1), DROP);

        bind(["<C-u>"], "Scroll up half a page",
             function () { mow.scrollVertical("pages", -.5); },
             function () mow.isScrollable(-1), BEEP);

        bind(["<C-b>", "<PageUp>"], "Scroll up half a page",
             function () { mow.scrollVertical("pages", -1); },
             function () mow.isScrollable(-1), BEEP);

        bind(["gg"], "Scroll to the beginning of output",
             function () { mow.scrollToPercent(null, 0); })

        bind(["G"], "Scroll to the end of output",
             function () { mow.body.scrollTop = mow.body.scrollHeight; })

        // copy text to clipboard
        bind(["<C-y>"], "Yank selection to clipboard",
             function () { dactyl.clipboardWrite(buffer.getCurrentWord(mow.window)); });

        // close the window
        bind(["q"], "Close the output window",
             function () {},
             function () false, DROP);
    },
    options: function () {
        options.add(["history", "hi"],
            "Number of Ex commands and search patterns to store in the command-line history",
            "number", 500,
            { validator: function (value) value >= 0 });

        options.add(["maxitems"],
            "Maximum number of completion items to display at once",
            "number", 20,
            { validator: function (value) value >= 1 });

        options.add(["messages", "msgs"],
            "Number of messages to store in the :messages history",
            "number", 100,
            { validator: function (value) value >= 0 });

        options.add(["more"],
            "Pause the message list window when the full output will not fit on one page",
            "boolean", true);

        options.add(["showmode", "smd"],
            "Show the current mode in the command line",
            "boolean", true);
    },
    sanitizer: function () {
        sanitizer.addItem("commandline", {
            description: "Command-line and search history",
            persistent: true,
            action: function (timespan, host) {
                let store = commandline._store;
                for (let [k, v] in store) {
                    if (k == "command")
                        store.set(k, v.filter(function (item)
                            !(timespan.contains(item.timestamp) && (!host || commands.hasDomain(item.value, host)))));
                    else if (!host)
                        store.set(k, v.filter(function (item) !timespan.contains(item.timestamp)));
                }
            }
        });
        // Delete history-like items from the commandline and messages on history purge
        sanitizer.addItem("history", {
            action: function (timespan, host) {
                commandline._store.set("command",
                    commandline._store.get("command", []).filter(function (item)
                        !(timespan.contains(item.timestamp) && (host ? commands.hasDomain(item.value, host)
                                                                     : item.privateData))));

                commandline._messageHistory.filter(function (item) !timespan.contains(item.timestamp * 1000) ||
                    !item.domains && !item.privateData ||
                    host && (!item.domains || !item.domains.some(function (d) util.isSubdomain(d, host))));
            }
        });
        sanitizer.addItem("messages", {
            description: "Saved :messages",
            action: function (timespan, host) {
                commandline._messageHistory.filter(function (item) !timespan.contains(item.timestamp * 1000) ||
                    host && (!item.domains || !item.domains.some(function (d) util.isSubdomain(d, host))));
            }
        });
    }
});

/**
 * The list which is used for the completion box (and QuickFix window in
 * future).
 *
 * @param {string} id The id of the iframe which will display the list. It
 *     must be in its own container element, whose height it will update as
 *     necessary.
 */
var ItemList = Class("ItemList", {
    init: function (id) {
        this._completionElements = [];

        var iframe = document.getElementById(id);

        this._doc = iframe.contentDocument;
        this._win = iframe.contentWindow;
        this._container = iframe.parentNode;

        this._doc.documentElement.id = id + "-top";
        this._doc.body.id = id + "-content";
        this._doc.body.className = iframe.className + "-content";
        this._doc.body.appendChild(this._doc.createTextNode(""));
        this._doc.body.style.borderTop = "1px solid black"; // FIXME: For cases where completions/MOW are shown at once, or ls=0. Should use :highlight.

        this._items = null;
        this._startIndex = -1; // The index of the first displayed item
        this._endIndex = -1;   // The index one *after* the last displayed item
        this._selIndex = -1;   // The index of the currently selected element
        this._div = null;
        this._divNodes = {};
        this._minHeight = 0;
    },

    _dom: function (xml, map) util.xmlToDom(xml instanceof XML ? xml : <>{xml}</>, this._doc, map),

    _autoSize: function () {
        if (this._container.collapsed)
            this._div.style.minWidth = document.getElementById("dactyl-commandline").scrollWidth + "px";

        this._minHeight = Math.max(this._minHeight,
            this._win.scrollY + this._divNodes.completions.getBoundingClientRect().bottom);

        if (this._container.collapsed)
            this._div.style.minWidth = "";

        // FIXME: Belongs elsewhere.
        commandline.updateOutputHeight(false, Math.max(0, this._minHeight - this._container.height));

        this._container.height = this._minHeight;
        this._container.height -= commandline.getSpaceNeeded();
        commandline.updateOutputHeight(false);
        this.timeout(function () { this._container.height -= commandline.getSpaceNeeded(); }, 0);
    },

    _getCompletion: function (index) this._completionElements.snapshotItem(index - this._startIndex),

    _init: function () {
        this._div = this._dom(
            <div class="ex-command-output" highlight="Normal" style="white-space: nowrap">
                <div highlight="Completions" key="noCompletions"><span highlight="Title">No Completions</span></div>
                <div key="completions"/>
                <div highlight="Completions">
                {
                    template.map(util.range(0, options["maxitems"] * 2), function (i)
                    <div highlight="CompItem NonText">
                        <li>~</li>
                    </div>)
                }
                </div>
            </div>, this._divNodes);
        this._doc.body.replaceChild(this._div, this._doc.body.firstChild);
        util.scrollIntoView(this._div, true);

        this._items.contextList.forEach(function init_eachContext(context) {
            delete context.cache.nodes;
            if (!context.items.length && !context.message && !context.incomplete)
                return;
            context.cache.nodes = [];
            this._dom(<div key="root" highlight="CompGroup">
                    <div highlight="Completions">
                        { context.createRow(context.title || [], "CompTitle") }
                    </div>
                    <div highlight="CompTitleSep"/>
                    <div key="message" highlight="CompMsg"/>
                    <div key="up" highlight="CompLess"/>
                    <div key="items" highlight="Completions"/>
                    <div key="waiting" highlight="CompMsg">{ItemList.WAITING_MESSAGE}</div>
                    <div key="down" highlight="CompMore"/>
                </div>, context.cache.nodes);
            this._divNodes.completions.appendChild(context.cache.nodes.root);
        }, this);

        this.timeout(this._autoSize, 0);
    },

    /**
     * Uses the entries in "items" to fill the listbox and does incremental
     * filling to speed up things.
     *
     * @param {number} offset Start at this index and show options["maxitems"].
     */
    _fill: function (offset) {
        XML.ignoreWhiteSpace = false;
        let diff = offset - this._startIndex;
        if (this._items == null || offset == null || diff == 0 || offset < 0)
            return false;

        this._startIndex = offset;
        this._endIndex = Math.min(this._startIndex + options["maxitems"], this._items.allItems.items.length);

        let haveCompletions = false;
        let off = 0;
        let end = this._startIndex + options["maxitems"];
        function getRows(context) {
            function fix(n) Math.constrain(n, 0, len);
            let len = context.items.length;
            let start = off;
            end -= !!context.message + context.incomplete;
            off += len;

            let s = fix(offset - start), e = fix(end - start);
            return [s, e, context.incomplete && e >= offset && off - 1 < end];
        }

        this._items.contextList.forEach(function fill_eachContext(context) {
            let nodes = context.cache.nodes;
            if (!nodes)
                return;
            haveCompletions = true;

            let root = nodes.root;
            let items = nodes.items;
            let [start, end, waiting] = getRows(context);

            if (context.message)
                nodes.message.appendChild(this._dom(context.message));
            nodes.message.style.display = context.message ? "block" : "none";
            nodes.waiting.style.display = waiting ? "block" : "none";
            nodes.up.style.opacity = "0";
            nodes.down.style.display = "none";

            for (let [i, row] in Iterator(context.getRows(start, end, this._doc)))
                nodes[i] = row;
            for (let [i, row] in array.iterItems(nodes)) {
                if (!row)
                    continue;
                let display = (i >= start && i < end);
                if (display && row.parentNode != items) {
                    do {
                        var next = nodes[++i];
                        if (next && next.parentNode != items)
                            next = null;
                    }
                    while (!next && i < end)
                    items.insertBefore(row, next);
                }
                else if (!display && row.parentNode == items)
                    items.removeChild(row);
            }
            if (context.items.length == 0)
                return;
            nodes.up.style.opacity = (start == 0) ? "0" : "1";
            if (end != context.items.length)
                nodes.down.style.display = "block";
            else
                nodes.up.style.display = "block";
            if (start == end) {
                nodes.up.style.display = "none";
                nodes.down.style.display = "none";
            }
        }, this);

        this._divNodes.noCompletions.style.display = haveCompletions ? "none" : "block";

        this._completionElements = util.evaluateXPath("//xhtml:div[@dactyl:highlight='CompItem']", this._doc);

        return true;
    },

    clear: function clear() { this.setItems(); this._doc.body.innerHTML = ""; },
    hide: function hide() { this._container.collapsed = true; },
    show: function show() { this._container.collapsed = false; },
    visible: function visible() !this._container.collapsed,

    reset: function (brief) {
        this._startIndex = this._endIndex = this._selIndex = -1;
        this._div = null;
        if (!brief)
            this.selectItem(-1);
    },

    // if @param selectedItem is given, show the list and select that item
    setItems: function setItems(newItems, selectedItem) {
        if (this._selItem > -1)
            this._getCompletion(this._selItem).removeAttribute("selected");
        if (this._container.collapsed) {
            this._minHeight = 0;
            this._container.height = 0;
        }
        this._startIndex = this._endIndex = this._selIndex = -1;
        this._items = newItems;
        this.reset(true);
        if (typeof selectedItem == "number") {
            this.selectItem(selectedItem);
            this.show();
        }
    },

    // select index, refill list if necessary
    selectItem: function selectItem(index) {
        //let now = Date.now();

        if (this._div == null)
            this._init();

        let sel = this._selIndex;
        let len = this._items.allItems.items.length;
        let newOffset = this._startIndex;
        let maxItems = options["maxitems"];
        let contextLines = Math.min(3, parseInt((maxItems - 1) / 2));

        if (index == -1 || index == null || index == len) { // wrapped around
            if (this._selIndex < 0)
                newOffset = 0;
            this._selIndex = -1;
            index = -1;
        }
        else {
            if (index <= this._startIndex + contextLines)
                newOffset = index - contextLines;
            if (index >= this._endIndex - contextLines)
                newOffset = index + contextLines - maxItems + 1;

            newOffset = Math.min(newOffset, len - maxItems);
            newOffset = Math.max(newOffset, 0);

            this._selIndex = index;
        }

        if (sel > -1)
            this._getCompletion(sel).removeAttribute("selected");
        this._fill(newOffset);
        if (index >= 0) {
            this._getCompletion(index).setAttribute("selected", "true");
            if (this._container.height != 0)
                util.scrollIntoView(this._getCompletion(index));
        }

        //if (index == 0)
        //    this.start = now;
        //if (index == Math.min(len - 1, 100))
        //    util.dump({ time: Date.now() - this.start });
    },

    onEvent: function onEvent(event) false
}, {
    WAITING_MESSAGE: "Generating results..."
});

// vim: set fdm=marker sw=4 ts=4 et:
