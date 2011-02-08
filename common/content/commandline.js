// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var CommandWidgets = Class("CommandWidgets", {
    depends: ["statusline"],

    init: function init() {
        let s = "dactyl-statusline-field-";

        XML.ignoreWhitespace = true;
        util.overlayWindow(window, {
            objects: {
                eventTarget: commandline
            },
            append: <e4x xmlns={XUL} xmlns:dactyl={NS}>
                <vbox id={config.commandContainer}>
                    <vbox class="dactyl-container" hidden="false" collapsed="true">
                        <iframe class="dactyl-completions" id="dactyl-completions-dactyl-commandline" src="dactyl://content/buffer.xhtml"
                                contextmenu="dactyl-contextmenu"
                                flex="1" hidden="false" collapsed="false"
                                highlight="Events" events="mowEvents" />
                    </vbox>

                    <stack orient="horizontal" align="stretch" class="dactyl-container" id="dactyl-container" highlight="CmdLine CmdCmdLine">
                        <textbox class="plain" id="dactyl-strut"   flex="1" crop="end" collapsed="true"/>
                        <textbox class="plain" id="dactyl-mode"    flex="1" crop="end"/>
                        <textbox class="plain" id="dactyl-message" flex="1" readonly="true"/>

                        <hbox id="dactyl-commandline" hidden="false" class="dactyl-container" highlight="Normal CmdNormal" collapsed="true">
                            <label   id="dactyl-commandline-prompt"  class="dactyl-commandline-prompt  plain" flex="0" crop="end" value="" collapsed="true"/>
                            <textbox id="dactyl-commandline-command" class="dactyl-commandline-command plain" flex="1" type="input" timeout="100"
                                     highlight="Events" />
                        </hbox>
                    </stack>

                    <vbox class="dactyl-container" hidden="false" collapsed="false" highlight="CmdLine">
                        <textbox id="dactyl-multiline-input" class="plain" flex="1" rows="1" hidden="false" collapsed="true" multiline="true"
                                 highlight="Normal Events" events="multilineInputEvents" />
                    </vbox>
                </vbox>

                <stack id="dactyl-statusline-stack">
                    <hbox id={s + "commandline"} hidden="false" class="dactyl-container" highlight="Normal StatusNormal" collapsed="true">
                        <label id={s + "commandline-prompt"}    class="dactyl-commandline-prompt  plain" flex="0" crop="end" value="" collapsed="true"/>
                        <textbox id={s + "commandline-command"} class="dactyl-commandline-command plain" flex="1" type="text" timeout="100"
                                 highlight="Events" />
                    </hbox>
                </stack>
            </e4x>.elements(),

            before: <e4x xmlns={XUL} xmlns:dactyl={NS}>
                <toolbar id={statusline.statusBar.id}>
                    <vbox id={"dactyl-completions-" + s + "commandline-container"} class="dactyl-container" hidden="false" collapsed="true">
                        <iframe class="dactyl-completions" id={"dactyl-completions-" + s + "commandline"} src="dactyl://content/buffer.xhtml"
                                contextmenu="dactyl-contextmenu" flex="1" hidden="false" collapsed="false"
                                highlight="Events" events="mowEvents" />
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
            test: function (stack, prev) stack.pop && !isinstance(prev.main, modes.COMMAND_LINE),
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
            onChange: function (elem, value) {
                if (elem.inputField != dactyl.focusedElement)
                    try {
                        elem.selectionStart = elem.value.length;
                        elem.selectionEnd = elem.value.length;
                    }
                    catch (e) {}

                if (!elem.collapsed)
                    dactyl.focus(elem);
            },
            onVisibility: function (elem, visible) {
                if (visible)
                    dactyl.focus(elem);
            }
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
    },
    addElement: function addElement(obj) {
        const self = this;
        this.elements[obj.name] = obj;

        function get(prefix, map, id) (obj.getElement || util.identity)(map[id] || document.getElementById(prefix + id));

        this.active.__defineGetter__(obj.name, function () self.activeGroup[obj.name][obj.name]);
        this.activeGroup.__defineGetter__(obj.name, function () self.getGroup(obj.name));

        memoize(this.statusbar, obj.name, function () get("dactyl-statusline-field-", statusline.widgets, (obj.id || obj.name)));
        memoize(this.commandbar, obj.name, function () get("dactyl-", {}, (obj.id || obj.name)));

        if (!(obj.noValue || obj.getValue)) {
            Object.defineProperty(this, obj.name, Modes.boundProperty({
                test: obj.test,

                get: function get_widgetValue() {
                    let elem = self.getGroup(obj.name, obj.value)[obj.name];
                    if (obj.value != null)
                        return [obj.value[0],
                                obj.get ? obj.get.call(this, elem) : elem.value];
                    return null;
                },

                set: function set_widgetValue(val) {
                    if (val != null && !isArray(val))
                        val = [obj.defaultGroup || "", val];
                    obj.value = val;

                    [this.commandbar, this.statusbar].forEach(function (nodeSet) {
                        let elem = nodeSet[obj.name];
                        if (val == null)
                            elem.value = "";
                        else {
                            highlight.highlightNode(elem,
                                (val[0] != null ? val[0] : obj.defaultGroup)
                                    .split(/\s/).filter(util.identity)
                                    .map(function (g) g + " " + nodeSet.group + g)
                                    .join(" "));
                            elem.value = val[1];
                            if (obj.onChange)
                                obj.onChange.call(this, elem, val);
                        }
                    }, this);

                    this.updateVisibility();
                    return val;
                }
            }).init(obj.name));
        }
        else if (obj.defaultGroup) {
            [this.commandbar, this.statusbar].forEach(function (nodeSet) {
                let elem = nodeSet[obj.name];
                if (elem)
                    highlight.highlightNode(elem, obj.defaultGroup.split(/\s/)
                                                     .map(function (g) g + " " + nodeSet.group + g).join(" "));
            });
        }
    },

    getGroup: function getgroup(name, value) {
        if (!statusline.visible)
            return this.commandbar;
        return this.elements[name].getGroup.call(this, arguments.length > 1 ? value : this[name]);
    },

    updateVisibility: function updateVisibility() {
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

        // Hack. Collapse hidden elements in the stack.
        // Might possibly be better to use a deck and programmatically
        // choose which element to select.
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

    _whenReady: function _whenReady(name, id, processor) {
        Object.defineProperty(this, name, {
            configurable: true, enumerable: true,
            get: function get_whenReady() {
                let elem = document.getElementById(id);

                util.waitFor(function () elem.contentDocument.documentURI === elem.getAttribute("src") &&
                       ["viewable", "complete"].indexOf(elem.contentDocument.readyState) >= 0);

                res = res || (processor || util.identity).call(self, elem);
                return res;
            }
        });
        let res, self = this;
        return Class.replaceProperty(this, name, this[name]);
    },

    get completionList() this._whenReady("completionList", "dactyl-completions"),

    completionContainer: Class.memoize(function () this.completionList.parentNode),

    contextMenu: Class.memoize(function () {
        ["copy", "copylink", "selectall"].forEach(function (tail) {
            // some host apps use "hostPrefixContext-copy" ids
            let xpath = "//xul:menuitem[contains(@id, '" + "ontext-" + tail + "') and not(starts-with(@id, 'dactyl-'))]";
            document.getElementById("dactyl-context-" + tail).style.listStyleImage =
                util.computedStyle(util.evaluateXPath(xpath, document).snapshotItem(0)).listStyleImage;
        });
        return document.getElementById("dactyl-contextmenu");
    }),

    get multilineOutput() this._whenReady("multilineOutput", "dactyl-multiline-output",
                                          function (elem) {
        elem.contentWindow.addEventListener("unload", function (event) { event.preventDefault(); }, true);
        elem.contentDocument.documentElement.id = "dactyl-multiline-output-top";
        elem.contentDocument.body.id = "dactyl-multiline-output-content";
        return elem;
    }),

    multilineInput: Class.memoize(function () document.getElementById("dactyl-multiline-input")),

    mowContainer: Class.memoize(function () document.getElementById("dactyl-multiline-output-container"))
}, {
    getEditor: function getEditor(elem) {
        elem.inputField.QueryInterface(Ci.nsIDOMNSEditableElement);
        return elem;
    }
});

var CommandMode = Class("CommandMode", {
    init: function init() {
        this.keepCommand = userContext.hidden_option_command_afterimage;
    },

    open: function (command) {
        this.command = command;

        dactyl.assert(isinstance(this.mode, modes.COMMAND_LINE),
                      "Not opening command line in non-command-line mode.");
        modes.push(this.mode, null, this.closure);

        this.widgets.active.commandline.collapsed = false;
        this.widgets.prompt = this.prompt;
        this.widgets.command = command || "";

        if (this.historyKey)
            this.history = CommandLine.History(commandline.widgets.active.command.inputField, this.historyKey, this);

        if (this.complete)
            this.completions = CommandLine.Completions(commandline.widgets.active.command.inputField, this);

        if (this.completions && command && options["autocomplete"].length && commandline.commandSession === this)
            this.completions.complete(true, false);
    },

    get holdFocus() this.widgets.active.command.inputField,

    get mappingSelf() this,

    get widgets() commandline.widgets,

    enter: function (stack) {
        commandline.commandSession = this;
        if (stack.pop && commandline.command) {
            this.onChange(commandline.command);
            if (this.completions && stack.pop)
                this.completions.complete(true, false);
        }
    },

    leave: function (stack) {
        if (!stack.push) {
            if (this.completions)
                this.completions.cleanup();

            if (this.history)
                this.history.save();

            this.resetCompletions();
            commandline.hideCompletions();

            modes.delay(function () {
                if (!this.keepCommand || commandline.silent || commandline.quiet)
                    commandline.hide();
                this[this.accepted ? "onSubmit" : "onCancel"](commandline.command);
            }, this);
            commandline.commandSession = null;
        }
    },

    events: {
        input: function onInput(event) {
            if (this.completions) {
                this.resetCompletions();

                this.completions.autocompleteTimer.tell(false);
            }
            this.onChange(commandline.command);
        },
        keyup: function onKeyUp(event) {
            let key = events.toString(event);
            if (/-?Tab>$/.test(key) && this.completions)
                this.completions.tabTimer.flush();
        }
    },

    keepCommand: false,

    onKeyPress: function onKeyPress(event) {
        let key = events.toString(event);
        if (this.completions)
            this.completions.previewClear();

        return true; /* Pass event */
    },

    onCancel: function (value) {
    },

    onChange: function (value) {
    },

    onSubmit: function (value) {
    },

    resetCompletions: function resetCompletions() {
        if (this.completions) {
            this.completions.context.cancelAll();
            this.completions.wildIndex = -1;
            this.completions.previewClear();
        }
        if (this.history)
            this.history.reset();
    },
});

var CommandExMode = Class("CommandExMode", CommandMode, {

    get mode() modes.EX,

    historyKey: "command",

    prompt: ["Normal", ":"],

    complete: function complete(context) {
        context.fork("ex", 0, completion, "ex");
    },

    onSubmit: function onSubmit(command) {
        io.withSavedValues(["readHeredoc"], function () {
            this.readHeredoc = commandline.readHeredoc;
            contexts.withSavedValues(["context"], function () {
                this.context = { file: "[Command Line]", line: 1 };
                commands.repeat = command;
                dactyl.execute(command);
            });
        });
    }
});

var CommandPromptMode = Class("CommandPromptMode", CommandMode, {
    init: function init(prompt, params) {
        this.prompt = isArray(prompt) ? prompt : ["Question", prompt];
        update(this, params);
        init.supercall(this);
    },

    complete: function (context) {
        if (this.completer)
            context.forkapply("prompt", 0, this, "completer", Array.slice(arguments, 1));
    },

    get mode() modes.PROMPT
});

/**
 * This class is used for prompting of user input and echoing of messages.
 *
 * It consists of a prompt and command field be sure to only create objects of
 * this class when the chrome is ready.
 */
var CommandLine = Module("commandline", {
    init: function init() {
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
    },

    /**
     * Determines whether the command line should be visible.
     *
     * @returns {boolean}
     */
    get commandVisible() !!this.commandSession,

    /**
     * Ensure that the multiline input widget is the correct size.
     */
    _autosizeMultilineInputWidget: function _autosizeMultilineInputWidget() {
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

    _silent: false,
    get silent() this._silent,
    set silent(val) {
        this._silent = val;
        this.quiet = this.quiet;
    },

    _quite: false,
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

    runSilently: function runSilently(func, self) {
        this.withSavedValues(["silent"], function () {
            this.silent = true;
            func.call(self);
        });
    },

    get completionList() {
        let node = this.widgets.active.commandline;
        if (!node.completionList)
            this.widgets._whenReady.call(node, "completionList", "dactyl-completions-" + node.id,
                                         function (node) ItemList(node.id));
        return node.completionList;
    },

    hideCompletions: function hideCompletions() {
        for (let nodeSet in values([this.widgets.statusbar, this.widgets.commandbar]))
            if (nodeSet.commandline.completionList)
                nodeSet.commandline.completionList.visible = false;
    },

    _lastClearable: Modes.boundProperty(),
    messages: Modes.boundProperty(),

    multilineInputVisible: Modes.boundProperty({
        set: function set_miwVisible(value) { this.widgets.multilineInput.collapsed = !value; }
    }),

    get command() {
        if (this.commandVisible && this.widgets.command)
            return commands.lastCommand = this.widgets.command[1];
        return commands.lastCommand;
    },
    set command(val) {
        if (this.commandVisible && (modes.extended & modes.EX))
            return this.widgets.command = val;
        return commands.lastCommand = val;
    },

    clear: function clear() {
        if (this.widgets.message && this.widgets.message[1] === this._lastClearable)
            this.widgets.message = null;

        if (!this.commandSession) {
            this.widgets.command = null;
            this.hideCompletions();
        }

        if (modes.main == modes.OUTPUT_MULTILINE && !mow.isScrollable(1))
            modes.pop();

        if (modes.main != modes.OUTPUT_MULTILINE)
            mow.visible = false;
    },

    /**
     * Displays the multi-line output of a command, preceded by the last
     * executed ex command string.
     *
     * @param {XML} xml The output as an E4X XML object.
     */
    commandOutput: function commandOutput(xml) {
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

        dactyl.triggerObserver("echoLine", str, highlightGroup, null, forceSingle);

        if (!this.commandVisible)
            this.hide();

        let field = this.widgets.active.message.inputField;
        if (field.value && !forceSingle && field.editor.rootElement.scrollWidth > field.scrollWidth) {
            this.widgets.message = null;
            mow.echo(<span highlight="Message">{str}</span>, highlightGroup, true);
        }
    },

    _lastEcho: null,

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
            action = mow.closure.echo;

        if (single)
            this._lastEcho = null;
        else {
            if (this.widgets.message && this.widgets.message[1] == this._lastEcho)
                mow.echo(<span highlight="Message">{this._lastEcho}</span>,
                         this.widgets.message[0], true);

            if (action === this._echoLine && !(flags & this.FORCE_MULTILINE)
                && !(dactyl.fullyInitialized && this.widgets.mowContainer.collapsed)) {
                highlightGroup += " Message";
                action = mow.closure.echo;
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

        CommandPromptMode(prompt, update({ onSubmit: callback }, extra)).open();
    },

    readHeredoc: function readHeredoc(end) {
        let args;
        commandline.inputMultiline(end, function (res) { args = res; });
        util.waitFor(function () args !== undefined);
        return args;
    },

    /**
     * Get a multi-line input from a user, up to but not including the line
     * which matches the given regular expression. Then execute the
     * callback with that string as a parameter.
     *
     * @param {string} end
     * @param {function(string)} callback
     */
    // FIXME: Buggy, especially when pasting.
    inputMultiline: function inputMultiline(end, callback) {
        let cmd = this.command;
        modes.push(modes.INPUT_MULTILINE, null, {
            mappingSelf: {
                end: "\n" + end + "\n",
                callback: callback
            }
        });
        if (cmd != false)
            this._echoLine(cmd, this.HL_NORMAL);

        // save the arguments, they are needed in the event handler onKeyPress

        this.multilineInputVisible = true;
        this.widgets.multilineInput.value = "";
        this._autosizeMultilineInputWidget();

        this.timeout(function () { dactyl.focus(this.widgets.multilineInput); }, 10);
    },

    get commandMode() this.commandSession && isinstance(modes.main, modes.COMMAND_LINE),

    events: update(
        iter(CommandMode.prototype.events).map(
            function ([event, handler]) [
                event, function (event) {
                    if (this.commandMode)
                        handler.call(this.commandSession, event);
                }
            ]).toObject(),
        {
            focus: function onFocus(event) {
                if (!this.commandSession
                        && event.originalTarget === this.widgets.active.command.inputField) {
                    event.target.blur();
                    dactyl.beep();
                }
            },
        }
    ),

    get mowEvents() mow.events,

    /**
     * Multiline input events, they will come straight from
     * #dactyl-multiline-input in the XUL.
     *
     * @param {Event} event
     */
    multilineInputEvents: {
        blur: function onBlur(event) {
            if (modes.main == modes.INPUT_MULTILINE)
                this.timeout(function () {
                    dactyl.focus(this.widgets.multilineInput.inputField);
                });
        },
        input: function onInput(event) {
            this._autosizeMultilineInputWidget();
        }
    },

    updateOutputHeight: deprecated("mow.resize", function updateOutputHeight(open, extra) mow.resize(open, extra)),

    withOutputToString: function withOutputToString(fn, self) {
        dactyl.registerObserver("echoLine", observe, true);
        dactyl.registerObserver("echoMultiline", observe, true);

        let output = [];
        function observe(str, highlight, dom) {
            output.push(dom && !isString(str) ? dom : str);
        }

        this.savingOutput = true;
        dactyl.trapErrors.apply(dactyl, [fn, self].concat(Array.slice(arguments, 2)));
        this.savingOutput = false;
        return output.map(function (elem) elem instanceof Node ? util.domToString(elem) : elem)
                     .join("\n");
    }
}, {
    /**
     * A class for managing the history of an input field.
     *
     * @param {HTMLInputElement} inputField
     * @param {string} mode The mode for which we need history.
     */
    History: Class("History", {
        init: function init(inputField, mode, session) {
            this.mode = mode;
            this.input = inputField;
            this.reset();
            this.session = session;
        },
        get store() commandline._store.get(this.mode, []),
        set store(ary) { commandline._store.set(this.mode, ary); },
        /**
         * Reset the history index to the first entry.
         */
        reset: function reset() {
            this.index = null;
        },
        /**
         * Save the last entry to the permanent store. All duplicate entries
         * are removed and the list is truncated, if necessary.
         */
        save: function save() {
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
        checkPrivate: function checkPrivate(str) {
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
        replace: function replace(val) {
            this.input.dactylKeyPress = undefined;
            if (this.completions)
                this.completions.previewClear();
            this.input.value = val;
        },

        /**
         * Move forward or backward in history.
         *
         * @param {boolean} backward Direction to move.
         * @param {boolean} matchCurrent Search for matches starting
         *      with the current input value.
         */
        select: function select(backward, matchCurrent) {
            // always reset the tab completion if we use up/down keys
            if (this.session.completions)
                this.session.completions.reset();

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
        init: function init(input, session) {
            this.context = CompletionContext(input.QueryInterface(Ci.nsIDOMNSEditableElement).editor);
            this.context.onUpdate = this.closure._reset;
            this.editor = input.editor;
            this.input = input;
            this.session = session;
            this.selected = null;
            this.wildmode = options.get("wildmode");
            this.wildtypes = this.wildmode.value;
            this.itemList = commandline.completionList;
            this.itemList.setItems(this.context);

            dactyl.registerObserver("events.doneFeeding", this.closure.onDoneFeeding, true);

            this.autocompleteTimer = Timer(200, 500, function autocompleteTell(tabPressed) {
                if (events.feedingKeys)
                    this.ignoredCount++;
                if (options["autocomplete"].length) {
                    this.complete(true, false);
                    this.itemList.visible = true;
                }
            }, this);
            this.tabTimer = Timer(0, 0, function tabTell(event) {
                this.tab(event.shiftKey, event.altKey && options["altwildmode"]);
            }, this);
        },

        cleanup: function () {
            dactyl.unregisterObserver("events.doneFeeding", this.closure.onDoneFeeding);
            this.previewClear();
            this.tabTimer.reset();
            this.autocompleteTimer.reset();
            this.itemList.visible = false;
        },

        ignoredCount: 0,
        onDoneFeeding: function onDoneFeeding() {
            if (this.ignoredCount)
                this.autocompleteTimer.flush(true);
            this.ignoredCount = 0;
        },

        UP: {},
        DOWN: {},
        PAGE_UP: {},
        PAGE_DOWN: {},
        RESET: null,

        lastSubstring: "",

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

            this.input.dactylKeyPress = undefined;
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
            this.session.complete(this.context);
            this.context.updateAsync = true;
            this.reset(show, tabPressed);
            this.wildIndex = 0;
        },

        haveType: function haveType(type)
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
            if (substring.length < 2 && this.lastSubstring.indexOf(substring) !== 0)
                return;

            this.lastSubstring = substring;

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
                this.itemList.visible = true;
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

                        util.waitFor(function () !context.incomplete || done())
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
            this.autocompleteTimer.flush();

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
                    this.itemList.visible = true;

                this.wildIndex++;
                this.preview();

                if (this.selected == null)
                    statusline.progress = "";
                else
                    statusline.progress = "match " + (this.selected + 1) + " of " + this.items.length;
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
    commands: function init_commands() {
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
    modes: function () {
        modes.addMode("COMMAND_LINE", {
            char: "c",
            description: "Active when the command line is focused",
            input: true,
            get mappingSelf() commandline.commandSession
        });
        // this._extended modes, can include multiple modes, and even main modes
        modes.addMode("EX", {
            description: "Ex command mode, active when the command line is open for Ex commands",
            bases: [modes.COMMAND_LINE],
            input: true
        });
        modes.addMode("PROMPT", {
            description: "Active when a prompt is open in the command line",
            bases: [modes.COMMAND_LINE],
            input: true
        });

        modes.addMode("INPUT_MULTILINE", {
            bases: [modes.INSERT],
            input: true
        });
    },
    mappings: function init_mappings() {

        mappings.add([modes.COMMAND],
            [":"], "Enter command-line mode",
            function () { CommandExMode().open(""); });

        mappings.add([modes.INPUT_MULTILINE],
            ["<Return>", "<C-j>", "<C-m>"], "Begin a new line",
            function ({ self }) {
                let text = "\n" + commandline.widgets.multilineInput
                                             .value.substr(0, commandline.widgets.multilineInput.selectionStart)
                         + "\n";

                let index = text.indexOf(self.end);
                if (index >= 0) {
                    text = text.substring(1, index);
                    modes.pop();

                    return function () self.callback.call(commandline, text);
                }
                return Events.PASS;
            });

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
             function ({ self }) {
                 self.resetCompletions();
                 editor.expandAbbreviation(modes.COMMAND_LINE);
                 return Events.PASS;
             });

        bind(["<Return>", "<C-j>", "<C-m>"], "Accept the current input",
             function ({ self }) {
                 let command = commandline.command;

                 self.accepted = true;
                 return function () { modes.pop(); };
             });

        [
            [["<Up>", "<A-p>"],                   "previous matching", true,  true],
            [["<S-Up>", "<C-p>", "<PageUp>"],     "previous",          true,  false],
            [["<Down>", "<A-n>"],                 "next matching",     false, true],
            [["<S-Down>", "<C-n>", "<PageDown>"], "next",              false, false]
        ].forEach(function ([keys, desc, up, search]) {
            bind(keys, "Recall the " + desc + " command line from the history list",
                 function ({ self }) {
                     dactyl.assert(self.history);
                     self.history.select(up, search);
                 });
        });

        bind(["<A-Tab>", "<Tab>"], "Select the next matching completion item",
             function ({ events, self }) {
                 dactyl.assert(self.completions);
                 self.completions.tabTimer.tell(events[0]);
             });

        bind(["<A-S-Tab>", "<S-Tab>"], "Select the previous matching completion item",
             function ({ events, self }) {
                 dactyl.assert(self.completions);
                 self.completions.tabTimer.tell(events[0]);
             });

        bind(["<BS>", "<C-h>"], "Delete the previous character",
             function () {
                 if (!commandline.command)
                     modes.pop();
                 else
                     return Events.PASS;
             });

        bind(["<C-]>", "<C-5>"], "Expand command line abbreviation",
             function () { editor.expandAbbreviation(modes.COMMAND_LINE); });
    },
    options: function init_options() {
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

        options.add(["showmode", "smd"],
            "Show the current mode in the command line",
            "boolean", true);
    },
    sanitizer: function init_sanitizer() {
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
    init: function init(id) {
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

    _dom: function _dom(xml, map) util.xmlToDom(xml instanceof XML ? xml : <>{xml}</>, this._doc, map),

    _autoSize: function _autoSize() {
        if (this._container.collapsed)
            this._div.style.minWidth = document.getElementById("dactyl-commandline").scrollWidth + "px";

        this._minHeight = Math.max(this._minHeight,
            this._win.scrollY + this._divNodes.completions.getBoundingClientRect().bottom);

        if (this._container.collapsed)
            this._div.style.minWidth = "";

        // FIXME: Belongs elsewhere.
        mow.resize(false, Math.max(0, this._minHeight - this._container.height));

        this._container.height = this._minHeight;
        this._container.height -= mow.spaceNeeded;
        mow.resize(false);
        this.timeout(function () {
            this._container.height -= mow.spaceNeeded;
        });
    },

    _getCompletion: function _getCompletion(index) this._completionElements.snapshotItem(index - this._startIndex),

    _init: function _init() {
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
    _fill: function _fill(offset) {
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
    get visible() !this._container.collapsed,
    set visible(val) this._container.collapsed = !val,

    reset: function reset(brief) {
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
            this.visible = true;
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

    onKeyPress: function onKeyPress(event) false
}, {
    WAITING_MESSAGE: "Generating results..."
});

// vim: set fdm=marker sw=4 ts=4 et:
