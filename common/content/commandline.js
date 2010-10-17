// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

const CommandWidgets = Class("CommandWidgets", {
    init: function () {
        const self = this;
        this.elements = {};
        this.addElem({
            name: "container",
            noValue: true
        });
        this.addElem({
            name: "commandline",
            getGroup: function () options.get("guioptions").has("C") ? this.commandbar : this.statusbar,
            getValue: function () this.command
        });
        this.addElem({
            name: "strut",
            getGroup: function () this.commandbar,
            getValue: function () options.get("guioptions").has("c")
        });
        this.addElem({
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
                elem.selectionStart = elem.value.length;
                elem.selectionEnd = elem.value.length;
                if (!elem.collapsed)
                    elem.focus();
            },
            onVisibility: function (elem, visible) visible && elem.focus()
        });
        this.addElem({
            name: "prompt",
            id: "commandline-prompt",
            defaultGroup: "CmdPrompt",
            getGroup: function () this.activeGroup.commandline
        });
        this.addElem({
            name: "message",
            defaultGroup: "Normal",
            getElement: CommandWidgets.getEditor,
            getGroup: function (value) {
                if (this.command && !options.get("guioptions").has("M"))
                    return this.statusbar;
                let statusElem = this.statusbar.message;
                if (value && statusElem.editor.rootElement.scrollWidth > statusElem.scrollWidth)
                    return this.commandbar;
                return this.activeGroup.mode;
            }
        });
        this.addElem({
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
    addElem: function (obj) {
        const self = this;
        this.elements[obj.name] = obj;
        function get(id) obj.getElement ? obj.getElement(id) : document.getElementById(id);
        this.active.__defineGetter__(obj.name, function () self.activeGroup[obj.name][obj.name]);
        this.activeGroup.__defineGetter__(obj.name, function () self.getGroup(obj.name));
        memoize(this.statusbar, obj.name, function () get("dactyl-statusline-field-" + (obj.id || obj.name)));
        memoize(this.commandbar, obj.name, function () get("dactyl-" + (obj.id || obj.name)));

        if (!(obj.noValue || obj.getValue))
            Object.defineProperty(this, obj.name, Modes.boundProperty({
                get: function () {
                    let elem = self.getGroup(obj.name, obj.value)[obj.name];
                    if (obj.value != null)
                        return [obj.value[0], obj.get ? obj.get.call(this, elem) : elem.value]
                    return null;
                },
                set: function (val) {
                    if (val != null && !isArray(val))
                        val = [obj.defaultGroup || "", val];
                    obj.value = val;

                    [this.commandbar, this.statusbar].forEach(function (nodeSet) {
                        let elem = nodeSet[obj.name];
                        if (val != null) {
                            highlight.highlightNode(elem, (val[0] != null ? val[0] : obj.defaultGroup)
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
    },

    active: Class.memoize(Object),
    activeGroup: Class.memoize(Object),
    commandbar: Class.memoize(function () ({ group: "Cmd" })),
    statusbar: Class.memoize(function ()  ({ group: "Status" })),
    completionList: Class.memoize(function () document.getElementById("dactyl-completions")),
    completionContainer: Class.memoize(function () this.completionList.parentNode),
    multilineOutput: Class.memoize(function () {
        let elem = document.getElementById("dactyl-multiline-output");
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
    mowContainer: Class.memoize(function () this.multilineOutput.parentNode)
}, {
    getEditor: function (id) {
        let elem = document.getElementById(id);
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
const CommandLine = Module("commandline", {
    init: function () {
        const self = this;

        this._callbacks = {};

        storage.newArray("history-search", { store: true, privateData: true });
        storage.newArray("history-command", { store: true, privateData: true });

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
            if (self._completions == null)
                return;
            if (self._completions.selected == null)
                statusline.progess = "";
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
                node._completionList = ItemList("dactyl-completions-" + node.id);
            return node._completionList;
        });
        this._completions = null;
        this._history = null;

        this._startHints = false; // whether we're waiting to start hints mode
        this._lastSubstring = "";

        // we need to save the mode which were in before opening the command line
        // this is then used if we focus the command line again without the "official"
        // way of calling "open"
        this.currentExtendedMode = null; // the extended mode which we last openend the command line for

        // save the arguments for the inputMultiline method which are needed in the event handler
        this._multilineEnd = null;
        this._multilineCallback = null;

        this._input = {};

        this.registerCallback("submit", modes.EX, function (command) {
            try {
                var readHeredoc = io.readHeredoc;
                io.readHeredoc = commandline.readHeredoc;
                commands.repeat = command;
                dactyl.execute(command);
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
                callback.call(self, value != null ? value : commandline.command);
        }

        function closePrompt(value) {
            let callback = self._input.submit;
            self._input = {};
            if (callback)
                callback.call(self, value != null ? value : commandline.command);
        }
    },

    /**
     * Determines whether the command line should be visible.
     *
     * @returns {boolean}
     */
    get commandVisible() modes.main == modes.COMMAND_LINE &&
            !(modes.extended & (modes.INPUT_MULTILINE | modes.OUTPUT_MULTILINE)),

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
            Array.forEach(this.widgets[nodeSet].commandline.childNodes, function (node) {
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
            this._callbacks[type][mode].apply(this, Array.slice(arguments, 2));
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

    multilineInputVisible: Modes.boundProperty({
        set: function (value) { this.widgets.multilineInput.collapsed = !value; }
    }),
    multilineOutputVisible: Modes.boundProperty({
        set: function (value) { this.widgets.mowContainer.collapsed = !value; }
    }),

    /**
     * Open the command line. The main mode is set to
     * COMMAND_LINE, the extended mode to <b>extendedMode</b>.
     * Further, callbacks defined for <b>extendedMode</b> are
     * triggered as appropriate (see {@link #registerCallback}).
     *
     * @param {string} prompt
     * @param {string} cmd
     * @param {number} extendedMode
     */
    open: function open(prompt, cmd, extendedMode) {
        this.widgets.message = null;

        modes.push(modes.COMMAND_LINE, this.currentExtendedMode, {
            leave: function (params) {
                if (params.pop)
                    commandline.leave();
            }
        });

        this.currentExtendedMode = extendedMode || null;
        this._keepCommand = false;

        this.widgets.active.commandline.collapsed = false;
        this.widgets.prompt = prompt;
        this.widgets.command = cmd || "";

        this._history = CommandLine.History(this.widgets.active.command.inputField, (modes.extended == modes.EX) ? "command" : "search");
        this._completions = CommandLine.Completions(this.widgets.active.command.inputField);

        // open the completion list automatically if wanted
        if (cmd.length)
            commandline.triggerCallback("change", this.currentExtendedMode, cmd);
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

    clear: function () {
        if (this.widgets.message && this.widgets.message[1] === this._lastClearable)
            this.widgets.message = null;
        if (modes.main != modes.COMMAND_LINE)
            this.widgets.command = null;
        if (modes.extended != modes.OUTPUT_MULTILINE)
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
     * Display a multiline message.
     *
     * @param {string} str
     * @param {string} highlightGroup
     */
    _echoMultiline: function echoMultiline(str, highlightGroup, silent) {
        let doc = this.widgets.multilineOutput.contentDocument;
        let win = this.widgets.multilineOutput.contentWindow;

        this.widgets.message = null;
        if (!this.commandVisible)
            this.hide();

        this._startHints = false;
        if (!(modes.extended & modes.OUTPUT_MULTILINE))
            modes.push(modes.COMMAND_LINE, modes.OUTPUT_MULTILINE, {
                onEvent: this.closure.onMultilineOutputEvent
            });

        // If it's already XML, assume it knows what it's doing.
        // Otherwise, white space is significant.
        // The problem elsewhere is that E4X tends to insert new lines
        // after interpolated data.
        XML.ignoreWhitespace = false;
        XML.prettyPrinting = false;
        let style = typeof str === "string" ? "pre" : "nowrap";
        this._lastMowOutput = <div class="ex-command-output" style={"white-space: " + style} highlight={highlightGroup}>{str}</div>;
        let output = util.xmlToDom(this._lastMowOutput, doc);

        // FIXME: need to make sure an open MOW is closed when commands
        //        that don't generate output are executed
        if (this.widgets.mowContainer.collapsed)
            doc.body.innerHTML = "";

        doc.body.appendChild(output);

        if (!silent)
            dactyl.triggerObserver("echoMultiline", str, highlightGroup, output);

        commandline.updateOutputHeight(true);

        if (options["more"] && win.scrollMaxY > 0) {
            // start the last executed command's output at the top of the screen
            let elements = doc.getElementsByClassName("ex-command-output");
            elements[elements.length - 1].scrollIntoView(true);
        }
        else
            win.scrollTo(0, doc.height);

        win.focus();

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
    echo: requiresMainThread(function echo(str, highlightGroup, flags) {
        // dactyl.echo uses different order of flags as it omits the highlight group, change commandline.echo argument order? --mst
        if (this._silent)
            return;

        highlightGroup = highlightGroup || this.HL_NORMAL;

        if (flags & this.APPEND_TO_MESSAGES) {
            let message = isObject(str) ? str : { message: str };
            this._messageHistory.add(update({ highlight: highlightGroup }, message));
            str = message.message;
        }

        if ((flags & this.ACTIVE_WINDOW) &&
            window != services.get("windowWatcher").activeWindow &&
            services.get("windowWatcher").activeWindow.dactyl)
            return;

        if ((flags & this.DISALLOW_MULTILINE) && !this.widgets.mowContainer.collapsed)
            return;

        let single = flags & (this.FORCE_SINGLELINE | this.DISALLOW_MULTILINE);
        let action = this._echoLine;

        if ((flags & this.FORCE_MULTILINE) || (/\n/.test(str) || typeof str == "xml") && !(flags & this.FORCE_SINGLELINE))
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
            this._lastEcho = (action == this._echoLine) && str;
        }

        this._lastClearable = action === this._echoLine && String(str);

        if (action)
            action.call(this, str, highlightGroup, single);
    }),

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
                       leave: function leave(stack) {
                           commandline.leave(stack);
                           leave.supercall(this, stack);
                       }
                   }));
        this.currentExtendedMode = modes.PROMPT;

        this.widgets.prompt = !prompt ? null : [extra.promptHighlight || "Question", prompt];
        this.widgets.command = extra.default || "";
        this.widgets.active.commandline.collapsed = false;

        this._completions = CommandLine.Completions(this.widgets.active.command.inputField);
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
     * Get a multiline input from a user, up to but not including the line
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

        this.timeout(function () { this.widgets.multilineInput.focus(); }, 10);
    },

    onContext: function onContext(event) {
        let enabled = {
            link: window.document.popupNode instanceof HTMLAnchorElement,
            selection: !window.document.commandDispatcher.focusedWindow.getSelection().isCollapsed
        };

        for (let [, node] in iter(event.target.childNodes)) {
            let group = node.getAttributeNS(NS, "group");
            node.hidden = group && !group.split(/\s+/).some(function (g) enabled[g]);
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
        try {
            let command = this.command;

            if (event.type == "blur") {
                // prevent losing focus, there should be a better way, but it just didn't work otherwise
                this.timeout(function () {
                    if (this.commandVisible && event.originalTarget == this.widgets.active.command.inputField)
                        this.widgets.active.command.inputField.focus();
                }, 0);
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
                if (!this.currentExtendedMode)
                    return;

                // user pressed <Enter> to carry out a command
                // user pressing <Esc> is handled in the global onEscape
                // FIXME: <Esc> should trigger "cancel" event
                if (events.isAcceptKey(key)) {
                    this._keepCommand = userContext.hidden_option_command_afterimage;
                    let mode = this.currentExtendedMode;
                    this.currentExtendedMode = null; // Don't let modes.pop trigger "cancel"
                    modes.pop();
                    commandline.triggerCallback("submit", mode, command);
                }
                // user pressed <Up> or <Down> arrow to cycle history completion
                else if (/^<(Up|Down|S-Up|S-Down|PageUp|PageDown)>$/.test(key)) {
                    // prevent tab from moving to the next field
                    event.preventDefault();
                    event.stopPropagation();

                    dactyl.assert(this._history);
                    this._history.select(/Up/.test(key), !/(Page|S-)/.test(key));
                }
                // user pressed <Tab> to get completions of a command
                else if (/^<(?:A-)?(?:S-)?Tab>$/.test(key)) {
                    // prevent tab from moving to the next field
                    event.preventDefault();
                    event.stopPropagation();

                    this._tabTimer.tell(event);
                }
                else if (key == "<BS>") {
                    // reset the tab completion
                    //this.resetCompletions();

                    // and blur the command line if there is no text left
                    if (command.length == 0) {
                        commandline.triggerCallback("cancel", this.currentExtendedMode);
                        modes.pop();
                    }
                }
                else {
                    //this.resetCompletions();
                }
                // allow this event to be handled by the host app
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
        finally {
            return true;
        }
    },

    /**
     * Multiline input events, they will come straight from
     * #dactyl-multiline-input in the XUL.
     *
     * @param {Event} event
     */
    onMultilineInputEvent: function onMultilineInputEvent(event) {
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
                this.timeout(function () { this.widgets.multilineInput.inputField.focus(); }, 0);
        }
        else if (event.type == "input")
            this._autosizeMultilineInputWidget();
        return true;
    },

    /**
     * Handle events when we are in multiline output mode, these come from
     * dactyl when modes.extended & modes.MULTILINE_OUTPUT and also from
     * #dactyl-multiline-output in the XUL.
     *
     * @param {Event} event
     */
    // FIXME: if 'more' is set and the MOW is not scrollable we should still
    // allow a down motion after an up rather than closing
    onMultilineOutputEvent: function onMultilineOutputEvent(event) {
        let win = this.widgets.multilineOutput.contentWindow;

        let showMoreHelpPrompt = false;
        let showMorePrompt = false;
        let closeWindow = false;
        let passEvent = false;

        let key = events.toString(event);

        // TODO: Wouldn't multiple handlers be cleaner? --djk
        if (event.type == "click" && event.target instanceof HTMLAnchorElement) {
            function openLink(where) {
                event.preventDefault();
                dactyl.open(event.target.href, where);
            }

            switch (key) {
            case "<LeftMouse>":
                event.preventDefault();
                let command = event.originalTarget.getAttributeNS(NS.uri, "command");
                if (command && dactyl.commands[command])
                    return dactyl.commands[command](event);
                else
                    openLink(dactyl.CURRENT_TAB);
                return false;
            case "<MiddleMouse>":
            case "<C-LeftMouse>":
            case "<C-M-LeftMouse>":
                openLink({ where: dactyl.NEW_TAB, background: true });
                return false;
            case "<S-MiddleMouse>":
            case "<C-S-LeftMouse>":
            case "<C-M-S-LeftMouse>":
                openLink({ where: dactyl.NEW_TAB, background: false });
                return false;
            case "<S-LeftMouse>":
                openLink(dactyl.NEW_WINDOW);
                return false;
            }
            return true;
        }

        if (event instanceof MouseEvent)
            return false;

        function isScrollable() !win.scrollMaxY == 0;
        function atEnd() win.scrollY / win.scrollMaxY >= 1;

        switch (key) {
        case "<Esc>":
            closeWindow = true;
            break; // handled globally in events.js:onEscape()

        case ":":
            commandline.open(":", "", modes.EX);
            return false;

        // down a line
        case "j":
        case "<Down>":
            if (options["more"] && isScrollable())
                win.scrollByLines(1);
            else
                passEvent = true;
            break;

        case "<C-j>":
        case "<C-m>":
        case "<Return>":
            if (options["more"] && isScrollable() && !atEnd())
                win.scrollByLines(1);
            else
                closeWindow = true; // don't propagate the event for accept keys
            break;

        // up a line
        case "k":
        case "<Up>":
        case "<BS>":
            if (options["more"] && isScrollable())
                win.scrollByLines(-1);
            else if (options["more"] && !isScrollable())
                showMorePrompt = true;
            else
                passEvent = true;
            break;

        // half page down
        case "d":
            if (options["more"] && isScrollable())
                win.scrollBy(0, win.innerHeight / 2);
            else
                passEvent = true;
            break;

        // TODO: <LeftMouse> on the prompt line should scroll one page
        // page down
        case "f":
            if (options["more"] && isScrollable())
                win.scrollByPages(1);
            else
                passEvent = true;
            break;

        case "<Space>":
        case "<PageDown>":
            if (options["more"] && isScrollable() && !atEnd())
                win.scrollByPages(1);
            else
                passEvent = true;
            break;

        // half page up
        case "u":
            // if (more and scrollable)
            if (options["more"] && isScrollable())
                win.scrollBy(0, -(win.innerHeight / 2));
            else
                passEvent = true;
            break;

        // page up
        case "b":
            if (options["more"] && isScrollable())
                win.scrollByPages(-1);
            else if (options["more"] && !isScrollable())
                showMorePrompt = true;
            else
                passEvent = true;
            break;

        case "<PageUp>":
            if (options["more"] && isScrollable())
                win.scrollByPages(-1);
            else
                passEvent = true;
            break;

        // top of page
        case "g":
            if (options["more"] && isScrollable())
                win.scrollTo(0, 0);
            else if (options["more"] && !isScrollable())
                showMorePrompt = true;
            else
                passEvent = true;
            break;

        // bottom of page
        case "G":
            if (options["more"] && isScrollable() && !atEnd())
                win.scrollTo(0, win.scrollMaxY);
            else
                passEvent = true;
            break;

        // copy text to clipboard
        case "<C-y>":
            dactyl.clipboardWrite(win.getSelection());
            break;

        // close the window
        case "q":
            closeWindow = true;
            break;

        case ";":
            hints.open(";", { window: win });
            return false;

        // unmapped key
        default:
            if (!options["more"] || !isScrollable() || atEnd() || events.isCancelKey(key))
                passEvent = true;
            else
                showMoreHelpPrompt = true;
        }

        if (passEvent || closeWindow) {
            modes.pop();

            if (passEvent)
                events.onKeyPress(event);
        }
        else
            commandline.updateMorePrompt(showMorePrompt, showMoreHelpPrompt);
        return false;
    },

    getSpaceNeeded: function getSpaceNeeded() {
        let rect = this.widgets.commandbar.commandline.getBoundingClientRect();
        let offset = rect.bottom - window.innerHeight;
        return Math.max(0, offset);
    },

    /**
     * Update or remove the multiline output widget's "MORE" prompt.
     *
     * @param {boolean} force If true, "-- More --" is shown even if we're
     *     at the end of the output.
     * @param {boolean} showHelp When true, show the valid key sequences
     *     and what they do.
     */
    updateMorePrompt: function updateMorePrompt(force, showHelp) {
        if (this.widgets.mowContainer.collapsed)
            return this.widgets.message = null;

        let win = this.widgets.multilineOutput.contentWindow;
        function isScrollable() !win.scrollMaxY == 0;
        function atEnd() win.scrollY / win.scrollMaxY >= 1;

        if (showHelp)
            this.widgets.message = ["MoreMsg", "-- More -- SPACE/d/j: screen/page/line down, b/u/k: up, q: quit"];
        else if (force || (options["more"] && isScrollable() && !atEnd()))
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
        this.widgets.mowContainer.height = Math.min(doc.height, availableHeight) + "px";
        this.timeout(function ()
            this.widgets.mowContainer.height = Math.min(doc.height, availableHeight) + "px",
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
            buffer.push(dom && !isString(str) ? util.domToString(dom) : str)
        }
        dactyl.trapErrors.apply(dactyl, [fn, self].concat(Array.slice(arguments, 2)));
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
            this.store = storage["history-" + mode];
            this.reset();
        },
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
            this.store.mutate("filter", function (line) (line.value || line) != str);
            try {
                this.store.push({ value: str, timestamp: Date.now()*1000, privateData: this.checkPrivate(str) });
            }
            catch (e) {
                dactyl.reportError(e);
            }
            this.store.truncate(options["history"], true);
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
            // commandline string
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

                let hist = this.store.get(this.index);
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

        get caret() this.editor.selection.focusOffset,
        set caret(offset) {
            commandline.widgets.active.command.selectionStart = offset;
            commandline.widgets.active.command.selectionEnd = offset;
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
                        function done() !(idx >= n + context.items.length || idx == -2 && !context.items.length);
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

        try {
            arg = dactyl.userEval(arg);
        }
        catch (e) {
            dactyl.echoerr(e);
            return null;
        }

        if (typeof arg === "object")
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
                    let str = CommandLine.echoArgumentToString(args[0] || "", true);
                    if (str != null)
                        command.action(str);
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
                            <div highlight={message.highlight + " Message"}>{message.message}</div>));;
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
                commandline.runSilently(function () dactyl.execute(args[0] || "", null, true));
            }, {
                completer: function (context) completion.ex(context),
                literal: 0,
                subCommand: 0
            });
    },
    mappings: function () {
        var myModes = [modes.COMMAND_LINE];

        // TODO: move "<Esc>", "<C-[>" here from mappings
        mappings.add(myModes,
            ["<C-c>"], "Focus content",
            function () { events.onEscape(); });

        // Any "non-keyword" character triggers abbreviation expansion
        // TODO: Add "<CR>" and "<Tab>" to this list
        //       At the moment, adding "<Tab>" breaks tab completion. Adding
        //       "<CR>" has no effect.
        // TODO: Make non-keyword recognition smarter so that there need not
        //       be two lists of the same characters (one here and a regex in
        //       mappings.js)
        mappings.add(myModes,
            ["<Space>", '"', "'"], "Expand command line abbreviation",
            function () {
                commandline.resetCompletions();
                editor.expandAbbreviation(modes.COMMAND_LINE);
                return true;
            },
            { route: true });

        mappings.add(myModes,
            ["<C-]>", "<C-5>"], "Expand command line abbreviation",
            function () { editor.expandAbbreviation(modes.COMMAND_LINE); });

        mappings.add([modes.NORMAL],
            ["g<"], "Redisplay the last command output",
            function () {
                dactyl.assert(commandline._lastMowOutput, "No previous command output");
                commandline._echoMultiline(commandline._lastMowOutput, commandline.HL_NORMAL);
            });
    },
    options: function () {
        options.add(["history", "hi"],
            "Number of Ex commands and search patterns to store in the command-line history",
            "number", 500,
            { validator: function (value) value >= 0 });

        options.add(["maxitems"],
            "Maximum number of items to display at once",
            "number", 20,
            { validator: function (value) value >= 1 });

        options.add(["messages", "msgs"],
            "Number of messages to store in the message history",
            "number", 100,
            { validator: function (value) value >= 0 });

        options.add(["more"],
            "Pause the message list window when more than one screen of listings is displayed",
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
                if (!host)
                    storage["history-search"].mutate("filter", function (item) !timespan.contains(item.timestamp));
                storage["history-command"].mutate("filter", function (item)
                    !(timespan.contains(item.timestamp) && (!host || commands.hasDomain(item.value, host))));
            }
        });
        // Delete history-like items from the commandline and messages on history purge
        sanitizer.addItem("history", {
            action: function (timespan, host) {
                storage["history-command"].mutate("filter", function (item)
                    !(timespan.contains(item.timestamp) && (host ? commands.hasDomain(item.value, host) : item.privateData)));
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
    },
    styles: function () {
        let fontSize = util.computedStyle(document.getElementById(config.mainWindowId)).fontSize;
        styles.registerSheet("chrome://dactyl/skin/dactyl.css");
        styles.addSheet(true, "font-size", "chrome://dactyl/content/buffer.xhtml",
            "body { font-size: " + fontSize + "; }");
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
const ItemList = Class("ItemList", {
    init: function (id) {
        this._completionElements = [];

        var iframe = document.getElementById(id);

        this._doc = iframe.contentDocument;
        this._win = iframe.contentWindow;
        this._container = iframe.parentNode;

        this._doc.body.id = id + "-content";
        this._doc.body.className = iframe.className + "-content";
        this._doc.body.appendChild(this._doc.createTextNode(""));
        this._doc.body.style.borderTop = "1px solid black"; // FIXME: For cases where completions/MOW are shown at once, or ls=0. Should use :highlight.

        this._gradient = template.gradient("GradientLeft", "GradientRight");

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
                    <span highlight="CompItem">
                        <li highlight="NonText">~</li>
                    </span>)
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
                    { this._gradient }
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
