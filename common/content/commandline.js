// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var CommandWidgets = Class("CommandWidgets", {
    depends: ["statusline"],

    init: function init() {
        let s = "dactyl-statusline-field-";

        overlay.overlayWindow(window, {
            objects: {
                eventTarget: commandline
            },
            append: [
                ["vbox", { id: config.ids.commandContainer, xmlns: "xul" },
                    ["vbox", { class: "dactyl-container", hidden: "false", collapsed: "true" },
                        ["iframe", { class: "dactyl-completions", id: "dactyl-completions-dactyl-commandline",
                                     src: "dactyl://content/buffer.xhtml", contextmenu: "dactyl-contextmenu",
                                     flex: "1", hidden: "false", collapsed: "false",
                                     highlight: "Events", events: "mowEvents" }]],

                    ["stack", { orient: "horizontal", align: "stretch", class: "dactyl-container",
                                id: "dactyl-container", highlight: "CmdLine CmdCmdLine" },
                        ["textbox", { class: "plain", id: "dactyl-strut",   flex: "1", crop: "end", collapsed: "true" }],
                        ["textbox", { class: "plain", id: "dactyl-mode",    flex: "1", crop: "end" }],
                        ["hbox", { id: "dactyl-message-box" },
                            ["label", { class: "plain", id: "dactyl-message-pre", flex: "0", readonly: "true", highlight: "WarningMsg" }],
                            ["textbox", { class: "plain", id: "dactyl-message", flex: "1", readonly: "true" }]],

                        ["hbox", { id: "dactyl-commandline", hidden: "false", class: "dactyl-container", highlight: "Normal CmdNormal", collapsed: "true" },
                            ["label", {   id: "dactyl-commandline-prompt",  class: "dactyl-commandline-prompt  plain", flex: "0", crop: "end", value: "", collapsed: "true" }],
                            ["textbox", { id: "dactyl-commandline-command", class: "dactyl-commandline-command plain", flex: "1", type: "input", timeout: "100",
                                          highlight: "Events" }]]],

                    ["vbox", { class: "dactyl-container", hidden: "false", collapsed: "false", highlight: "CmdLine" },
                        ["textbox", { id: "dactyl-multiline-input", class: "plain", flex: "1", rows: "1", hidden: "false", collapsed: "true",
                                      multiline: "true", highlight: "Normal Events", events: "multilineInputEvents" }]]],

                ["stack", { id: "dactyl-statusline-stack", xmlns: "xul" },
                    ["hbox", { id: s + "commandline", hidden: "false", class: "dactyl-container", highlight: "Normal StatusNormal", collapsed: "true" },
                        ["label", { id: s + "commandline-prompt",    class: "dactyl-commandline-prompt  plain", flex: "0", crop: "end", value: "", collapsed: "true" }],
                        ["textbox", { id: s + "commandline-command", class: "dactyl-commandline-command plain", flex: "1", type: "text", timeout: "100",
                                      highlight: "Events",  }]]]],

            before: [
                ["toolbar", { id: statusline.statusBar.id, xmlns: "xul" },
                    ["vbox", { id: "dactyl-completions-" + s + "commandline-container", class: "dactyl-container", hidden: "false", collapsed: "true" },
                        ["iframe", { class: "dactyl-completions", id: "dactyl-completions-" + s + "commandline", src: "dactyl://content/buffer.xhtml",
                                     contextmenu: "dactyl-contextmenu", flex: "1", hidden: "false", collapsed: "false", highlight: "Events",
                                     events: "mowEvents" }]]]]
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
            test: function test(stack, prev) stack.pop && !isinstance(prev.main, modes.COMMAND_LINE),
            id: "commandline-command",
            get: function command_get(elem) {
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
            onChange: function command_onChange(elem, value) {
                if (elem.inputField != dactyl.focusedElement)
                    try {
                        elem.selectionStart = elem.value.length;
                        elem.selectionEnd = elem.value.length;
                    }
                    catch (e) {}

                if (!elem.collapsed)
                    dactyl.focus(elem);
            },
            onVisibility: function command_onVisibility(elem, visible) {
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
                // Currently doesn't work as expected with <hbox> parent.
                if (false && value && !value[2] && statusElem.editor && statusElem.editor.rootElement.scrollWidth > statusElem.scrollWidth)
                    return this.commandbar;
                return this.activeGroup.mode;
            }
        });

        this.addElement({
            name: "message-pre",
            defaultGroup: "WarningMsg",
            getGroup: function () this.activeGroup.message
        });

        this.addElement({
            name: "message-box",
            defaultGroup: "Normal",
            getGroup: function () this.activeGroup.message,
            getValue: function () this.message
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
        this.updateVisibility();

        this.initialized = true;
    },
    addElement: function addElement(obj) {
        const self = this;
        this.elements[obj.name] = obj;

        function get(prefix, map, id) (obj.getElement || util.identity)(map[id] || document.getElementById(prefix + id));

        this.active.__defineGetter__(obj.name, () => this.activeGroup[obj.name][obj.name]);
        this.activeGroup.__defineGetter__(obj.name, () => this.getGroup(obj.name));

        memoize(this.statusbar, obj.name, () => get("dactyl-statusline-field-", statusline.widgets, (obj.id || obj.name)));
        memoize(this.commandbar, obj.name, () => get("dactyl-", {}, (obj.id || obj.name)));

        if (!(obj.noValue || obj.getValue)) {
            Object.defineProperty(this, obj.name, Modes.boundProperty({
                test: obj.test,

                get: function get_widgetValue() {
                    let elem = self.getGroup(obj.name, obj.value)[obj.name];
                    if (obj.value != null)
                        return [obj.value[0],
                                obj.get ? obj.get.call(this, elem) : elem.value]
                                .concat(obj.value.slice(2));
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
                                    .map(g => g + " " + nodeSet.group + g)
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
                                                     .map(g => g + " " + nodeSet.group + g)
                                                     .join(" "));
            });
        }
    },

    getGroup: function getgroup(name, value) {
        if (!statusline.visible)
            return this.commandbar;
        return this.elements[name].getGroup.call(this, arguments.length > 1 ? value : this[name]);
    },

    updateVisibility: function updateVisibility() {
        let changed = 0;
        for (let elem in values(this.elements))
            if (elem.getGroup) {
                let value = elem.getValue ? elem.getValue.call(this)
                          : elem.noValue || this[elem.name];

                let activeGroup = this.getGroup(elem.name, value);
                for (let group in values([this.commandbar, this.statusbar])) {
                    let meth, node = group[elem.name];
                    let visible = (value && group === activeGroup);
                    if (node && !node.collapsed == !visible) {
                        changed++;
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
            if (DOM(node).style.display === "-moz-stack") {
                let nodes = Array.filter(node.children, n => !n.collapsed && n.boxObject.height);
                nodes.forEach((node, i) => {
                    node.style.opacity = (i == nodes.length - 1) ? "" : "0";
                });
            }
            Array.forEach(node.children, check);
        }
        [this.commandbar.container, this.statusbar.container].forEach(check);

        if (this.initialized && loaded.has("mow") && mow.visible)
            mow.resize(false);
    },

    active: Class.Memoize(Object),
    activeGroup: Class.Memoize(Object),
    commandbar: Class.Memoize(function () ({ group: "Cmd" })),
    statusbar: Class.Memoize(function ()  ({ group: "Status" })),

    _ready: function _ready(elem) {
        return elem.contentDocument.documentURI === elem.getAttribute("src") &&
               ["viewable", "complete"].indexOf(elem.contentDocument.readyState) >= 0;
    },

    _whenReady: function _whenReady(id, init) {
        let elem = document.getElementById(id);
        while (!this._ready(elem))
            yield 10;

        if (init)
            init.call(this, elem);
        yield elem;
    },

    completionContainer: Class.Memoize(function () this.completionList.parentNode),

    contextMenu: Class.Memoize(function () {
        ["copy", "copylink", "selectall"].forEach(function (tail) {
            // some host apps use "hostPrefixContext-copy" ids
            let css   = "menuitem[id$='ontext-" + tail + "']:not([id^=dactyl-])";
            let style = DOM(css, document).style;
            DOM("#dactyl-context-" + tail, document).css({
                listStyleImage: style.listStyleImage,
                MozImageRegion: style.MozImageRegion
            });
        });
        return document.getElementById("dactyl-contextmenu");
    }),

    multilineOutput: Class.Memoize(function () this._whenReady("dactyl-multiline-output",
                                                               elem => {
        highlight.highlightNode(elem.contentDocument.body, "MOW");
    }), true),

    multilineInput: Class.Memoize(() => document.getElementById("dactyl-multiline-input")),

    mowContainer: Class.Memoize(() => document.getElementById("dactyl-multiline-output-container"))
}, {
    getEditor: function getEditor(elem) {
        elem.inputField.QueryInterface(Ci.nsIDOMNSEditableElement);
        return elem;
    }
});

var CommandMode = Class("CommandMode", {
    init: function CM_init() {
        this.keepCommand = userContext.hidden_option_command_afterimage;
    },

    get autocomplete() options["autocomplete"].length,

    get command() this.widgets.command[1],
    set command(val) this.widgets.command = val,

    get prompt() this._open ? this.widgets.prompt : this._prompt,
    set prompt(val) {
        if (this._open)
            this.widgets.prompt = val;
        else
            this._prompt = val;
    },

    open: function CM_open(command) {
        dactyl.assert(isinstance(this.mode, modes.COMMAND_LINE),
                      /*L*/"Not opening command line in non-command-line mode.",
                      false);

        this.messageCount = commandline.messageCount;
        modes.push(this.mode, this.extendedMode, this.bound);

        this.widgets.active.commandline.collapsed = false;
        this.widgets.prompt = this.prompt;
        this.widgets.command = command || "";

        this._open = true;

        this.input = this.widgets.active.command.inputField;
        if (this.historyKey)
            this.history = CommandLine.History(this.input, this.historyKey, this);

        if (this.complete)
            this.completions = CommandLine.Completions(this.input, this);

        if (this.completions && command && commandline.commandSession === this)
            this.completions.autocompleteTimer.flush(true);
    },

    get active() this === commandline.commandSession,

    get holdFocus() this.widgets.active.command.inputField,

    get mappingSelf() this,

    get widgets() commandline.widgets,

    enter: function CM_enter(stack) {
        commandline.commandSession = this;
        if (stack.pop && commandline.command) {
            this.onChange(commandline.command);
            if (this.completions && stack.pop)
                this.completions.complete(true, false);
        }
    },

    leave: function CM_leave(stack) {
        if (!stack.push) {
            commandline.commandSession = null;
            this.input.dactylKeyPress = undefined;

            let waiting = this.accepted && this.completions && this.completions.waiting;
            if (waiting)
                this.completions.onComplete = bind("onSubmit", this);

            if (this.completions)
                this.completions.cleanup();

            if (this.history)
                this.history.save();

            commandline.hideCompletions();

            modes.delay(function () {
                if (!this.keepCommand || commandline.silent || commandline.quiet)
                    commandline.hide();
                if (!waiting)
                    this[this.accepted ? "onSubmit" : "onCancel"](commandline.command);
                if (commandline.messageCount === this.messageCount)
                    commandline.clearMessage();
            }, this);
        }
    },

    events: {
        input: function CM_onInput(event) {
            if (this.completions) {
                this.resetCompletions();

                this.completions.autocompleteTimer.tell(false);
            }
            this.onChange(commandline.command);
        },
        keyup: function CM_onKeyUp(event) {
            let key = DOM.Event.stringify(event);
            if (/-?Tab>$/.test(key) && this.completions)
                this.completions.tabTimer.flush();
        }
    },

    keepCommand: false,

    onKeyPress: function CM_onKeyPress(events) {
        if (this.completions)
            this.completions.previewClear();

        return true; /* Pass event */
    },

    onCancel: function (value) {},

    onChange: function (value) {},

    onHistory: function (value) {},

    onSubmit: function (value) {},

    resetCompletions: function CM_resetCompletions() {
        if (this.completions)
            this.completions.clear();
        if (this.history)
            this.history.reset();
    },
});

var CommandExMode = Class("CommandExMode", CommandMode, {

    get mode() modes.EX,

    historyKey: "command",

    prompt: ["Normal", ":"],

    complete: function CEM_complete(context) {
        try {
            context.fork("ex", 0, completion, "ex");
        }
        catch (e) {
            context.message = _("error.error", e);
        }
    },

    onSubmit: function CEM_onSubmit(command) {
        contexts.withContext({ file: /*L*/"[Command Line]", line: 1 },
                             function _onSubmit() {
            io.withSavedValues(["readHeredoc"], function _onSubmit() {
                this.readHeredoc = commandline.readHeredoc;
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

    complete: function CPM_complete(context, ...args) {
        if (this.completer)
            context.forkapply("prompt", 0, this, "completer", args);
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

    signals: {
        "browser.locationChange": function (webProgress, request, uri) {
            this.clear();
        }
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

    widgets: Class.Memoize(() => CommandWidgets()),

    runSilently: function runSilently(func, self) {
        this.withSavedValues(["silent"], function () {
            this.silent = true;
            func.call(self);
        });
    },

    get completionList() {
        let node = this.widgets.active.commandline;
        if (this.commandSession && this.commandSession.completionList)
            node = document.getElementById(this.commandSession.completionList);

        if (!node.completionList) {
            let elem = document.getElementById("dactyl-completions-" + node.id);
            util.waitFor(bind(this.widgets._ready, null, elem));

            node.completionList = ItemList(elem);
            node.completionList.isAboveMow = node.id ==
                this.widgets.statusbar.commandline.id;
        }
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

    clear: function clear(scroll) {
        if (!scroll || Date.now() - this._lastEchoTime > 5000)
            this.clearMessage();
        this._lastEchoTime = 0;
        this.hiddenMessages = 0;

        if (!this.commandSession) {
            this.widgets.command = null;
            this.hideCompletions();
        }

        if (modes.main == modes.OUTPUT_MULTILINE && !mow.isScrollable(1))
            modes.pop();

        if (!modes.have(modes.OUTPUT_MULTILINE))
            mow.visible = false;
    },

    clearMessage: function clearMessage() {
        if (this.widgets.message && this.widgets.message[1] === this._lastClearable) {
            this.widgets.message = null;
            this.hiddenMessages = 0;
        }
    },

    /**
     * Displays the multi-line output of a command, preceded by the last
     * executed ex command string.
     *
     * @param {object} xml The output as a JSON XML object.
     */
    commandOutput: function commandOutput(xml) {
        if (!this.command)
            this.echo(xml, this.HIGHLIGHT_NORMAL, this.FORCE_MULTILINE);
        else
            this.echo([["div", { xmlns: "html" }, ":" + this.command], "\n", xml],
                      this.HIGHLIGHT_NORMAL, this.FORCE_MULTILINE);
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
        this.widgets.message = str ? [highlightGroup, str, forceSingle] : null;

        dactyl.triggerObserver("echoLine", str, highlightGroup, null, forceSingle);

        if (!this.commandVisible)
            this.hide();

        let field = this.widgets.active.message.inputField;
        if (field.value && !forceSingle && field.editor.rootElement.scrollWidth > field.scrollWidth) {
            this.widgets.message = null;
            mow.echo(["span", { highlight: "Message" }, str], highlightGroup, true);
        }
    },

    _hiddenMessages: 0,
    get hiddenMessages() this._hiddenMessages,
    set hiddenMessages(val) {
        this._hiddenMessages = val;
        if (val)
            this.widgets["message-pre"] = _("commandline.moreMessages", val) + " ";
        else
            this.widgets["message-pre"] = null;
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
    messageCount: 0,
    echo: function echo(data, highlightGroup, flags) {
        // dactyl.echo uses different order of flags as it omits the highlight group, change commandline.echo argument order? --mst
        if (this._silent || !this.widgets)
            return;

        this.messageCount++;

        highlightGroup = highlightGroup || this.HL_NORMAL;

        let appendToMessages = (data) => {
            let message = isObject(data) && !DOM.isJSONXML(data) ? data : { message: data };

            // Make sure the memoized message property is an instance property.
            message.message;
            this._messageHistory.add(update({ highlight: highlightGroup }, message));
            return message.message;
        }

        if (flags & this.APPEND_TO_MESSAGES)
            data = appendToMessages(data);

        if ((flags & this.ACTIVE_WINDOW) && window != overlay.activeWindow)
            return;

        if ((flags & this.DISALLOW_MULTILINE) && !this.widgets.mowContainer.collapsed)
            return;

        let forceSingle = flags & (this.FORCE_SINGLELINE | this.DISALLOW_MULTILINE);
        let action = this._echoLine;

        if ((flags & this.FORCE_MULTILINE) || (/\n/.test(data) || !isinstance(data, [_, "String"])) && !(flags & this.FORCE_SINGLELINE))
            action = mow.bound.echo;

        let checkSingleLine = () => action == this._echoLine;

        if (forceSingle) {
            this._lastEcho = null;
            this.hiddenMessages = 0;
        }
        else {
            // So complicated...
            if (checkSingleLine() && !this.widgets.mowContainer.collapsed) {
                highlightGroup += " Message";
                action = mow.bound.echo;
            }
            else if (!checkSingleLine() && this.widgets.mowContainer.collapsed) {
                if (this._lastEcho && this.widgets.message && this.widgets.message[1] == this._lastEcho.msg) {
                    if (!(this._lastEcho.flags & this.APPEND_TO_MESSAGES))
                        appendToMessages(this._lastEcho.data);

                    mow.echo(
                        ["span", { highlight: "Message" },
                            ["span", { highlight: "WarningMsg" },
                                _("commandline.moreMessages", this.hiddenMessages + 1) + " "],
                            this._lastEcho.msg],
                        this.widgets.message[0], true);

                    this.hiddenMessages = 0;
                }
            }
            else if (this._lastEcho && this.widgets.message && this.widgets.message[1] == this._lastEcho.msg) {
                if (!(this._lastEcho.flags & this.APPEND_TO_MESSAGES))
                    appendToMessages(this._lastEcho.data);
                if (checkSingleLine() && !(flags & this.APPEND_TO_MESSAGES))
                    appendToMessages(data);

                flags |= this.APPEND_TO_MESSAGES;
                this.hiddenMessages++;
            }
            this._lastEcho = checkSingleLine() && { flags: flags, msg: data, data: arguments[0] };
        }

        this._lastClearable = action === this._echoLine && String(data);
        this._lastEchoTime = (flags & this.FORCE_SINGLELINE) && Date.now();

        if (action)
            action.call(this, data, highlightGroup, checkSingleLine());
    },
    _lastEchoTime: 0,

    /**
     * Prompt the user. Sets modes.main to COMMAND_LINE, which the user may
     * pop at any time to close the prompt.
     *
     * @param {string} prompt The input prompt to use.
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
    input: promises.withCallbacks(function _input([callback, reject], prompt, extra={}, thing={}) {
        if (callable(extra))
            // Deprecated.
            [callback, extra] = [extra, thing];

        CommandPromptMode(prompt, update({ onSubmit: callback, onCancel: reject }, extra)).open();
    }),

    readHeredoc: function readHeredoc(end) {
        return util.waitFor(commandline.inputMultiline(end));
    },

    /**
     * Get a multi-line input from a user, up to but not including the line
     * which matches the given regular expression. Then execute the
     * callback with that string as a parameter.
     *
     * @param {string} end
     * @returns {Promise<string>}
     */
    // FIXME: Buggy, especially when pasting.
    inputMultiline: promises.withCallbacks(function inputMultiline([callback], end) {
        let cmd = this.command;
        let self = {
            end: "\n" + end + "\n",
            callback: callback
        };

        modes.push(modes.INPUT_MULTILINE, null, {
            holdFocus: true,
            leave: function leave() {
                if (!self.done)
                    self.callback(null);
            },
            mappingSelf: self
        });

        if (cmd != false)
            this._echoLine(cmd, this.HL_NORMAL);

        // save the arguments, they are needed in the event handler onKeyPress

        this.multilineInputVisible = true;
        this.widgets.multilineInput.value = "";
        this._autosizeMultilineInputWidget();

        this.timeout(function () { dactyl.focus(this.widgets.multilineInput); }, 10);
    }),

    get commandMode() this.commandSession && isinstance(modes.main, modes.COMMAND_LINE),

    events: update(
        iter(CommandMode.prototype.events).map(
            ([event, handler]) => [
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
            }
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

    withOutputToString: function withOutputToString(fn, self, ...args) {
        dactyl.registerObserver("echoLine", observe, true);
        dactyl.registerObserver("echoMultiline", observe, true);

        let output = [];
        function observe(str, highlight, dom) {
            output.push(dom && !isString(str) ? dom : str);
        }

        this.savingOutput = true;
        dactyl.trapErrors.apply(dactyl, [fn, self].concat(args));
        this.savingOutput = false;
        return output.map(elem => elem instanceof Node ? DOM.stringify(elem) : elem)
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

            let privateData = this.checkPrivate(str);
            if (privateData == "never-save")
                return;

            let store = Array.filter(this.store, line => (line.value || line) != str);
            dactyl.trapErrors(
                () => store.push({ value: str, timestamp: Date.now() * 1000, privateData: privateData }));
            this.store = store.slice(Math.max(0, store.length - options["history"]));
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
            editor.withSavedValues(["skipSave"], function () {
                editor.skipSave = true;

                this.input.dactylKeyPress = undefined;
                if (this.completions)
                    this.completions.previewClear();
                this.input.value = val;
                this.session.onHistory(val);
            }, this);
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
        UP: {},
        DOWN: {},
        CTXT_UP: {},
        CTXT_DOWN: {},
        PAGE_UP: {},
        PAGE_DOWN: {},
        RESET: null,

        init: function init(input, session) {
            let self = this;

            this.context = CompletionContext(input.QueryInterface(Ci.nsIDOMNSEditableElement).editor);
            this.context.onUpdate = function onUpdate() { self.asyncUpdate(this); };

            this.editor = input.editor;
            this.input = input;
            this.session = session;

            this.wildmode = options.get("wildmode");
            this.wildtypes = this.wildmode.value;

            this.itemList = commandline.completionList;
            this.itemList.open(this.context);

            dactyl.registerObserver("events.doneFeeding", this.bound.onDoneFeeding, true);

            this.autocompleteTimer = Timer(200, 500, function autocompleteTell(tabPressed) {
                if (events.feedingKeys && !tabPressed)
                    this.ignoredCount++;
                else if (this.session.autocomplete) {
                    this.itemList.visible = true;
                    this.complete(true, false);
                }
            }, this);

            this.tabTimer = Timer(0, 0, function tabTell(event) {
                let tabCount = this.tabCount;
                this.tabCount = 0;
                this.tab(tabCount, event.altKey && options["altwildmode"]);
            }, this);
        },

        tabCount: 0,

        ignoredCount: 0,

        /**
         * @private
         */
        onDoneFeeding: function onDoneFeeding() {
            if (this.ignoredCount)
                this.autocompleteTimer.flush(true);
            this.ignoredCount = 0;
        },

        /**
         * @private
         */
        onTab: function onTab(event) {
            this.tabCount += event.shiftKey ? -1 : 1;
            this.tabTimer.tell(event);
        },

        get activeContexts() this.context.contextList
                                 .filter(c => c.items.length || c.incomplete),

        /**
         * Returns the current completion string relative to the
         * offset of the currently selected context.
         */
        get completion() {
            let offset = this.selected ? this.selected[0].offset : this.start;
            return commandline.command.slice(offset, this.caret);
        },

        /**
         * Updates the input field from *offset* to {@link #caret}
         * with the value *value*. Afterward, the caret is moved
         * just after the end of the updated text.
         *
         * @param {number} offset The offset in the original input
         *      string at which to insert *value*.
         * @param {string} value The value to insert.
         */
        setCompletion: function setCompletion(offset, value) {
            editor.withSavedValues(["skipSave"], function () {
                editor.skipSave = true;
                this.previewClear();

                if (value == null)
                    var [input, caret] = [this.originalValue, this.originalCaret];
                else {
                    input = this.getCompletion(offset, value);
                    caret = offset + value.length;
                }

                // Change the completion text.
                // The second line is a hack to deal with some substring
                // preview corner cases.
                commandline.widgets.active.command.value = input;
                this.editor.selection.focusNode.textContent = input;

                this.caret = caret;
                this._caret = this.caret;

                this.input.dactylKeyPress = undefined;
            }, this);
        },

        /**
         * For a given offset and completion string, returns the
         * full input value after selecting that item.
         *
         * @param {number} offset The offset at which to insert the
         *      completion.
         * @param {string} value The value to insert.
         * @returns {string};
         */
        getCompletion: function getCompletion(offset, value) {
            return this.originalValue.substr(0, offset)
                 + value
                 + this.originalValue.substr(this.originalCaret);
        },

        get selected() this.itemList.selected,
        set selected(tuple) {
            if (!array.equals(tuple || [],
                              this.itemList.selected || []))
                this.itemList.select(tuple);

            if (!tuple)
                this.setCompletion(null);
            else {
                let [ctxt, idx] = tuple;
                this.setCompletion(ctxt.offset, ctxt.items[idx].result);
            }
        },

        get caret() this.editor.selection.getRangeAt(0).startOffset,
        set caret(offset) {
            this.editor.selection.collapse(this.editor.rootElement.firstChild, offset);
        },

        get start() this.context.allItems.start,

        get items() this.context.allItems.items,

        get substring() this.context.longestAllSubstring,

        get wildtype() this.wildtypes[this.wildIndex] || "",

        /**
         * Cleanup resources used by this completion session. This
         * instance should not be used again once this method is
         * called.
         */
        cleanup: function cleanup() {
            dactyl.unregisterObserver("events.doneFeeding", this.bound.onDoneFeeding);
            this.previewClear();

            this.tabTimer.reset();
            this.autocompleteTimer.reset();
            if (!this.onComplete)
                this.context.cancelAll();

            this.itemList.visible = false;
            this.input.dactylKeyPress = undefined;
            this.hasQuit = true;
        },

        /**
         * Run the completer.
         *
         * @param {boolean} show Passed to {@link #reset}.
         * @param {boolean} tabPressed Should be set to true if, and
         *      only if, this function is being called in response
         *      to a <Tab> press.
         */
        complete: function complete(show, tabPressed) {
            this.session.ignoredCount = 0;

            this.waiting = null;
            this.context.reset();
            this.context.tabPressed = tabPressed;

            this.session.complete(this.context);
            if (!this.session.active)
                return;

            this.reset(show, tabPressed);
            this.wildIndex = 0;
            this._caret = this.caret;
        },

        /**
         * Clear any preview string and cancel any pending
         * asynchronous context. Called when there is further input
         * to be processed.
         */
        clear: function clear() {
            this.context.cancelAll();
            this.wildIndex = -1;
            this.previewClear();
        },

        /**
         * Saves the current input state. To be called before an
         * item is selected in a new set of completion responses.
         * @private
         */
        saveInput: function saveInput() {
            this.originalValue = this.context.value;
            this.originalCaret = this.caret;
        },

        /**
         * Resets the completion state.
         *
         * @param {boolean} show If true and options allow the
         *      completion list to be shown, show it.
         */
        reset: function reset(show) {
            this.waiting = null;
            this.wildIndex = -1;

            this.saveInput();

            if (show) {
                this.itemList.update();
                this.context.updateAsync = true;
                if (this.haveType("list"))
                    this.itemList.visible = true;
                this.wildIndex = 0;
            }

            this.preview();
        },

        /**
         * Calls when an asynchronous completion context has new
         * results to return.
         *
         * @param {CompletionContext} context The changed context.
         * @private
         */
        asyncUpdate: function asyncUpdate(context) {
            if (this.hasQuit) {
                let item = this.getItem(this.waiting);
                if (item && this.waiting && this.onComplete) {
                    util.trapErrors("onComplete", this,
                                    this.getCompletion(this.waiting[0].offset,
                                                       item.result));
                    this.waiting = null;
                    this.context.cancelAll();
                }
                return;
            }

            let value = this.editor.selection.focusNode.textContent;
            this.saveInput();

            if (this.itemList.visible)
                this.itemList.updateContext(context);

            if (this.waiting && this.waiting[0] == context)
                this.select(this.waiting);
            else if (!this.waiting) {
                let cursor = this.selected;
                if (cursor && cursor[0] == context) {
                    let item = this.getItem(cursor);
                    if (!item || this.completion != item.result)
                        this.itemList.select(null);
                }

                this.preview();
            }
        },

        /**
         * Returns true if the currently selected 'wildmode' index
         * has the given completion type.
         */
        haveType: function haveType(type)
            this.wildmode.checkHas(this.wildtype, type == "first" ? "" : type),

        /**
         * Returns the completion item for the given selection
         * tuple.
         *
         * @param {[CompletionContext,number]} tuple The spec of the
         *      item to return.
         *      @default {@link #selected}
         * @returns {object}
         */
        getItem: function getItem(tuple=this.selected)
            tuple && tuple[0] && tuple[0].items[tuple[1]],

        /**
         * Returns a tuple representing the next item, at the given
         * *offset*, from *tuple*.
         *
         * @param {[CompletionContext,number]} tuple The offset from
         *      which to search.
         *      @default {@link #selected}
         * @param {number} offset The positive or negative offset to
         *      find.
         *      @default 1
         * @param {boolean} noWrap If true, and the search would
         *      wrap, return null.
         */
        nextItem: function nextItem(tuple, offset, noWrap) {
            if (tuple === undefined)
                tuple = this.selected;

            return this.itemList.getRelativeItem(offset || 1, tuple, noWrap);
        },

        /**
         * The last previewed substring.
         * @private
         */
        lastSubstring: "",

        /**
         * Displays a preview of the text provided by the next <Tab>
         * press if the current input is an anchored substring of
         * that result.
         */
        preview: function preview() {
            this.previewClear();
            if (this.wildIndex < 0 || this.caret < this.input.value.length
                    || !this.activeContexts.length || this.waiting)
                return;

            let substring = "";
            switch (this.wildtype.replace(/.*:/, "")) {
            case "":
                var cursor = this.nextItem(null);
                break;
            case "longest":
                if (this.items.length > 1) {
                    substring = this.substring;
                    break;
                }
                // Fallthrough
            case "full":
                cursor = this.nextItem();
                break;
            }
            if (cursor)
                substring = this.getItem(cursor).result;

            // Don't show 1-character substrings unless we've just hit backspace
            if (substring.length < 2 && this.lastSubstring.indexOf(substring))
                return;

            this.lastSubstring = substring;

            let value = this.completion;
            if (util.compareIgnoreCase(value, substring.substr(0, value.length)))
                return;

            substring = substring.substr(value.length);
            this.removeSubstring = substring;

            let node = DOM.fromJSON(["span", { highlight: "Preview" }, substring],
                                    document);

            this.withSavedValues(["caret"], function () {
                this.editor.insertNode(node, this.editor.rootElement, 1);
            });
        },

        /**
         * Clears the currently displayed next-<Tab> preview string.
         */
        previewClear: function previewClear() {
            let node = this.editor.rootElement.firstChild;
            if (node && node.nextSibling) {
                try {
                    DOM(node.nextSibling).remove();
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
            let e = this.editor.selection.focusNode;
            if (e != this.editor.rootElement && e.parentNode != this.editor.rootElement)
                this.editor.selection.getRangeAt(0).selectNodeContents(this.editor.rootElement);
            delete this.removeSubstring;
        },

        /**
         * Selects a completion based on the value of *idx*.
         *
         * @param {[CompletionContext,number]|const object} The
         *      (context,index) tuple of the item to select, or an
         *      offset constant from this object.
         * @param {number} count When given an offset constant,
         *      select *count* units.
         *      @default 1
         * @param {boolean} fromTab If true, this function was
         *      called by {@link #tab}.
         *      @default false
         *      @private
         */
        select: function select(idx, count=1, fromTab=false) {
            switch (idx) {
            case this.UP:
            case this.DOWN:
                idx = this.nextItem(this.waiting || this.selected,
                                    idx == this.UP ? -count : count,
                                    true);
                break;

            case this.CTXT_UP:
            case this.CTXT_DOWN:
                let groups = this.itemList.activeGroups;
                let i = Math.max(0, groups.indexOf(this.itemList.selectedGroup));

                i += idx == this.CTXT_DOWN ? 1 : -1;
                i %= groups.length;
                if (i < 0)
                    i += groups.length;

                var position = 0;
                idx = [groups[i].context, 0];
                break;

            case this.PAGE_UP:
            case this.PAGE_DOWN:
                idx = this.itemList.getRelativePage(idx == this.PAGE_DOWN ? 1 : -1);
                break;

            case this.RESET:
                idx = null;
                break;

            default:
                break;
            }

            if (!fromTab)
                this.wildIndex = this.wildtypes.length - 1;

            if (idx && idx[1] >= idx[0].items.length) {
                if (!idx[0].incomplete)
                    this.waiting = null;
                else {
                    this.waiting = idx;
                    statusline.progress = _("completion.waitingForResults");
                }
                return;
            }

            this.waiting = null;

            this.itemList.select(idx, null, position);
            this.selected = idx;

            this.preview();

            if (this.selected == null)
                statusline.progress = "";
            else
                statusline.progress = _("completion.matchIndex",
                                        this.itemList.getOffset(idx),
                                        this.itemList.itemCount);
        },

        /**
         * Selects a completion result based on the 'wildmode'
         * option, or the value of the *wildmode* parameter.
         *
         * @param {number} offset The positive or negative number of
         *      tab presses to process.
         * @param {[string]} wildmode A 'wildmode' value to
         *      substitute for the value of the 'wildmode' option.
         *      @optional
         */
        tab: function tab(offset, wildmode) {
            this.autocompleteTimer.flush();
            this.ignoredCount = 0;

            if (this._caret != this.caret)
                this.reset();
            this._caret = this.caret;

            // Check if we need to run the completer.
            if (this.context.waitingForTab || this.wildIndex == -1)
                this.complete(true, true);

            this.wildtypes = wildmode || options["wildmode"];
            let count = Math.abs(offset);
            let steps = Math.constrain(this.wildtypes.length - this.wildIndex,
                                       1, count);
            count = Math.max(1, count - steps);

            while (steps--) {
                this.wildIndex = Math.min(this.wildIndex, this.wildtypes.length - 1);
                switch (this.wildtype.replace(/.*:/, "")) {
                case "":
                    this.select(this.nextItem(null));
                    break;
                case "longest":
                    if (this.itemList.itemCount > 1) {
                        if (this.substring && this.substring.length > this.completion.length)
                            this.setCompletion(this.start, this.substring);
                        break;
                    }
                    // Fallthrough
                case "full":
                    let c = steps ? 1 : count;
                    this.select(offset < 0 ? this.UP : this.DOWN, c, true);
                    break;
                }

                if (this.haveType("list"))
                    this.itemList.visible = true;

                this.wildIndex++;
            }

            if (this.items.length == 0 && !this.waiting)
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
        else if (callable(arg))
            arg = String.replace(arg, "/* use strict */ \n", "/* use strict */ ");
        else if (!isString(arg) && useColor)
            arg = template.highlight(arg);
        return arg;
    }
}, {
    commands: function initCommands() {
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
                    commandline.commandOutput(
                        template.map(commandline._messageHistory.messages, message =>
                           ["div", { highlight: message.highlight + " Message" },
                               message.message]));
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
                commandline.runSilently(() => { commands.execute(args[0] || "", null, true); });
            }, {
                completer: function (context) completion.ex(context),
                literal: 0,
                subCommand: 0
            });
    },
    modes: function initModes() {
        initModes.require("editor");

        modes.addMode("COMMAND_LINE", {
            char: "c",
            description: "Active when the command line is focused",
            insert: true,
            ownsFocus: true,
            get mappingSelf() commandline.commandSession
        });
        // this._extended modes, can include multiple modes, and even main modes
        modes.addMode("EX", {
            description: "Ex command mode, active when the command line is open for Ex commands",
            bases: [modes.COMMAND_LINE]
        });
        modes.addMode("PROMPT", {
            description: "Active when a prompt is open in the command line",
            bases: [modes.COMMAND_LINE]
        });

        modes.addMode("INPUT_MULTILINE", {
            description: "Active when the command line's multiline input buffer is open",
            bases: [modes.INSERT]
        });
    },
    mappings: function initMappings() {

        mappings.add([modes.COMMAND],
            [":"], "Enter Command Line mode",
            function () { CommandExMode().open(""); });

        mappings.add([modes.INPUT_MULTILINE],
            ["<Return>", "<C-j>", "<C-m>"], "Begin a new line",
            function ({ self }) {
                let text = "\n" + commandline.widgets.multilineInput
                                             .value.substr(0, commandline.widgets.multilineInput.selectionStart)
                         + "\n";

                let index = text.indexOf(self.end);
                if (index >= 0) {
                    self.done = true;
                    text = text.substring(1, index);
                    modes.pop();

                    return () => self.callback.call(commandline, text);
                }
                return Events.PASS;
            });

        let bind = function bind(...args) mappings.add.apply(mappings, [[modes.COMMAND_LINE]].concat(args));

        bind(["<Esc>", "<C-[>"], "Stop waiting for completions or exit Command Line mode",
             function ({ self }) {
                 if (self.completions && self.completions.waiting)
                     self.completions.waiting = null;
                 else
                     return Events.PASS;
             });

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
                 if (self.completions)
                     self.completions.tabTimer.flush();

                 let command = commandline.command;

                 self.accepted = true;
                 return function () { modes.pop(); };
             });

        [
            [["<Up>", "<A-p>", "<cmd-prev-match>"],   "previous matching", true,  true],
            [["<S-Up>", "<C-p>", "<cmd-prev>"],       "previous",          true,  false],
            [["<Down>", "<A-n>", "<cmd-next-match>"], "next matching",     false, true],
            [["<S-Down>", "<C-n>", "<cmd-next>"],     "next",              false, false]
        ].forEach(function ([keys, desc, up, search]) {
            bind(keys, "Recall the " + desc + " command line from the history list",
                 function ({ self }) {
                     dactyl.assert(self.history);
                     self.history.select(up, search);
                 });
        });

        bind(["<A-Tab>", "<Tab>", "<A-compl-next>", "<compl-next>"],
             "Select the next matching completion item",
             function ({ keypressEvents, self }) {
                 dactyl.assert(self.completions);
                 self.completions.onTab(keypressEvents[0]);
             });

        bind(["<A-S-Tab>", "<S-Tab>", "<A-compl-prev>", "<compl-prev>"],
             "Select the previous matching completion item",
             function ({ keypressEvents, self }) {
                 dactyl.assert(self.completions);
                 self.completions.onTab(keypressEvents[0]);
             });

        bind(["<C-Tab>", "<A-f>", "<compl-next-group>"],
             "Select the next matching completion group",
             function ({ keypressEvents, self }) {
                 dactyl.assert(self.completions);
                 self.completions.tabTimer.flush();
                 self.completions.select(self.completions.CTXT_DOWN);
             });

        bind(["<C-S-Tab>", "<A-S-f>", "<compl-prev-group>"],
             "Select the previous matching completion group",
             function ({ keypressEvents, self }) {
                 dactyl.assert(self.completions);
                 self.completions.tabTimer.flush();
                 self.completions.select(self.completions.CTXT_UP);
             });

        bind(["<C-f>", "<PageDown>", "<compl-next-page>"],
             "Select the next page of completions",
             function ({ keypressEvents, self }) {
                 dactyl.assert(self.completions);
                 self.completions.tabTimer.flush();
                 self.completions.select(self.completions.PAGE_DOWN);
             });

        bind(["<C-b>", "<PageUp>", "<compl-prev-page>"],
             "Select the previous page of completions",
             function ({ keypressEvents, self }) {
                 dactyl.assert(self.completions);
                 self.completions.tabTimer.flush();
                 self.completions.select(self.completions.PAGE_UP);
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
    options: function initOptions() {
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
    },
    sanitizer: function initSanitizer() {
        sanitizer.addItem("commandline", {
            description: "Command-line and search history",
            persistent: true,
            action: function (timespan, host) {
                let store = commandline._store;
                for (let [k, v] in store) {
                    if (k == "command")
                        store.set(k, v.filter(item =>
                            !(timespan.contains(item.timestamp) && (!host || commands.hasDomain(item.value, host)))));
                    else if (!host)
                        store.set(k, v.filter(item => !timespan.contains(item.timestamp)));
                }
            }
        });
        // Delete history-like items from the commandline and messages on history purge
        sanitizer.addItem("history", {
            action: function (timespan, host) {
                commandline._store.set("command",
                    commandline._store.get("command", []).filter(item =>
                        !(timespan.contains(item.timestamp) && (host ? commands.hasDomain(item.value, host)
                                                                     : item.privateData))));

                commandline._messageHistory.filter(item =>
                    ( !timespan.contains(item.timestamp * 1000)
                   || !item.domains && !item.privateData
                   || host && ( !item.domains
                             || !item.domains.some(d => util.isSubdomain(d, host)))));
            }
        });
        sanitizer.addItem("messages", {
            description: "Saved :messages",
            action: function (timespan, host) {
                commandline._messageHistory.filter(item =>
                    ( !timespan.contains(item.timestamp * 1000)
                   || host && ( !item.domains
                             || !item.domains.some(d => util.isSubdomain(d, host)))));
            }
        });
    }
});

/**
 * The list which is used for the completion box.
 *
 * @param {string} id The id of the iframe which will display the list. It
 *     must be in its own container element, whose height it will update as
 *     necessary.
 */

var ItemList = Class("ItemList", {
    CONTEXT_LINES: 2,

    init: function init(frame) {
        this.frame = frame;

        this.doc = frame.contentDocument;
        this.win = frame.contentWindow;
        this.body = this.doc.body;
        this.container = frame.parentNode;

        highlight.highlightNode(this.doc.body, "Comp");

        this._onResize = Timer(20, 400, function _onResize(event) {
            if (this.visible)
                this.onResize(event);
        }, this);
        this._resize = Timer(20, 400, function _resize(flags) {
            if (this.visible)
                this.resize(flags);
        }, this);

        DOM(this.win).resize(this._onResize.bound.tell);
    },

    get rootXML()
        ["div", { highlight: "Normal", style: "white-space: nowrap", key: "root" },
            ["div", { key: "wrapper" },
                ["div", { highlight: "Completions", key: "noCompletions" },
                    ["span", { highlight: "Title" },
                        _("completion.noCompletions")]],
                ["div", { key: "completions" }]],

            ["div", { highlight: "Completions" },
                template.map(util.range(0, options["maxitems"] * 2), i =>
                    ["div", { highlight: "CompItem NonText" },
                        "~"])]],

    get itemCount() this.context.contextList
                        .reduce((acc, ctxt) => acc + ctxt.items.length, 0),

    get visible() !this.container.collapsed,
    set visible(val) this.container.collapsed = !val,

    get activeGroups() this.context.contextList
                           .filter(c => c.items.length || c.message || c.incomplete)
                           .map(this.getGroup, this),

    get selected() let (g = this.selectedGroup) g && g.selectedIdx != null
        ? [g.context, g.selectedIdx] : null,

    getRelativeItem: function getRelativeItem(offset, tuple, noWrap) {
        let groups = this.activeGroups;
        if (!groups.length)
            return null;

        let group = this.selectedGroup || groups[0];
        let start = group.selectedIdx || 0;
        if (tuple === null) { // Kludge.
            if (offset > 0)
                tuple = [this.activeGroups[0], -1];
            else {
                let group = this.activeGroups.slice(-1)[0];
                tuple = [group, group.itemCount];
            }
        }
        if (tuple)
            [group, start] = tuple;

        group = this.getGroup(group);

        start = (group.offsets.start + start + offset);
        if (!noWrap)
            start %= this.itemCount || 1;
        if (start < 0 && (!noWrap || arguments[1] === null))
            start += this.itemCount;

        if (noWrap && offset > 0) {
            // Check if we've passed any incomplete contexts

            let i = groups.indexOf(group);
            util.assert(i >= 0, undefined, false);
            for (; i < groups.length; i++) {
                let end = groups[i].offsets.start + groups[i].itemCount;
                if (start >= end && groups[i].context.incomplete)
                    return [groups[i].context, start - groups[i].offsets.start];

                if (start >= end);
                    break;
            }
        }

        if (start < 0 || start >= this.itemCount)
            return null;

        group = groups.find(g => let (i = start - g.offsets.start) i >= 0 && i < g.itemCount);
        return [group.context, start - group.offsets.start];
    },

    getRelativePage: function getRelativePage(offset, tuple, noWrap) {
        offset *= this.maxItems;
        // Try once with wrapping disabled.
        let res = this.getRelativeItem(offset, tuple, true);

        if (!res) {
            // Wrapped.
            let sign = offset / Math.abs(offset);

            let off = this.getOffset(tuple === null ? null : tuple || this.selected);
            if (off == null)
                // Unselected. Defer to getRelativeItem.
                res = this.getRelativeItem(offset, null, noWrap);
            else if (~[0, this.itemCount - 1].indexOf(off))
                // At start or end. Jump to other end.
                res = this.getRelativeItem(sign, null, noWrap);
            else
                // Wrapped. Go to beginning or end.
                res = this.getRelativeItem(-sign, null);
        }
        return res;
    },

    /**
     * Initializes the ItemList for use with a new root completion
     * context.
     *
     * @param {CompletionContext} context The new root context.
     */
    open: function open(context) {
        this.context = context;
        this.nodes = {};
        this.container.height = 0;
        this.minHeight = 0;
        this.maxItems  = options["maxitems"];

        DOM(this.rootXML, this.doc, this.nodes)
            .appendTo(DOM(this.body).empty());

        this.update();
    },

    /**
     * Updates the absolute result indices of all groups after
     * results have changed.
     * @private
     */
    updateOffsets: function updateOffsets() {
        let total = this.itemCount;
        let count = 0;
        for (let group in values(this.activeGroups)) {
            group.offsets = { start: count, end: total - count - group.itemCount };
            count += group.itemCount;
        }
    },

    /**
     * Updates the set and state of active groups for a new set of
     * completion results.
     */
    update: function update() {
        DOM(this.nodes.completions).empty();

        let container = DOM(this.nodes.completions);
        let groups = this.activeGroups;
        for (let group in values(groups)) {
            group.reset();
            container.append(group.nodes.root);
        }

        this.updateOffsets();

        DOM(this.nodes.noCompletions).toggle(!groups.length);

        this.startPos = null;
        this.select(groups[0] && groups[0].context, null);

        this._resize.tell();
    },

    /**
     * Updates the group for *context* after an asynchronous update
     * push.
     *
     * @param {CompletionContext} context The context which has
     *      changed.
     */
    updateContext: function updateContext(context) {
        let group = this.getGroup(context);
        this.updateOffsets();

        if (~this.activeGroups.indexOf(group))
            group.update();
        else {
            DOM(group.nodes.root).remove();
            if (this.selectedGroup == group)
                this.selectedGroup = null;
        }

        let g = this.selectedGroup;
        this.select(g, g && g.selectedIdx);
    },

    /**
     * Updates the DOM to reflect the current state of all groups.
     * @private
     */
    draw: function draw() {
        for (let group in values(this.activeGroups))
            group.draw();

        // We need to collect all of the rescrolling functions in
        // one go, as the height calculation that they need to do
        // would force an expensive reflow after each call due to
        // DOM modifications, otherwise.
        this.activeGroups.filter(g => !g.collapsed)
            .map(g => g.rescrollFunc)
            .forEach(call);

        if (!this.selected)
            this.win.scrollTo(0, 0);

        this._resize.tell(ItemList.RESIZE_BRIEF);
    },

    onResize: function onResize() {
        if (this.selectedGroup)
            this.selectedGroup.rescrollFunc();
    },

    minHeight: 0,

    /**
     * Resizes the list after an update.
     * @private
     */
    resize: function resize(flags) {
        let { completions, root } = this.nodes;

        if (!this.visible)
            root.style.minWidth = document.getElementById("dactyl-commandline").scrollWidth + "px";

        let { minHeight } = this;
        if (mow.visible && this.isAboveMow) // Kludge.
            minHeight -= mow.wantedHeight;

        let needed = this.win.scrollY + DOM(completions).rect.bottom;
        this.minHeight = Math.max(minHeight, needed);

        if (!this.visible)
            root.style.minWidth = "";

        let height = this.visible ? parseFloat(this.container.height) : 0;
        if (this.minHeight <= minHeight || !mow.visible)
            this.container.height = Math.min(this.minHeight,
                                             height + config.outputHeight - mow.spaceNeeded);
        else {
            // FIXME: Belongs elsewhere.
            mow.resize(false, Math.max(0, this.minHeight - this.container.height));

            this.container.height = this.minHeight - mow.spaceNeeded;
            mow.resize(false);
            this.timeout(function () {
                this.container.height -= mow.spaceNeeded;
            });
        }
    },

    /**
     * Selects the item at the given *group* and *index*.
     *
     * @param {CompletionContext|[CompletionContext,number]} *group* The
     *      completion context to select, or a tuple specifying the
     *      context and item index.
     * @param {number} index The item index in *group* to select.
     * @param {number} position If non-null, try to position the
     *      selected item at the *position*th row from the top of
     *      the screen. Note that at least {@link #CONTEXT_LINES}
     *      lines will be visible above and below the selected item
     *      unless there aren't enough results to make this possible.
     *      @optional
     */
    select: function select(group, index, position) {
        if (isArray(group))
            [group, index] = group;

        group = this.getGroup(group);

        if (this.selectedGroup && (!group || group != this.selectedGroup))
            this.selectedGroup.selectedIdx = null;

        this.selectedGroup = group;

        if (group)
            group.selectedIdx = index;

        let groups = this.activeGroups;

        if (position != null || !this.startPos && groups.length)
            this.startPos = [group || groups[0], position || 0];

        if (groups.length) {
            group = group || groups[0];
            let idx = groups.indexOf(group);

            let start  = this.startPos[0].getOffset(this.startPos[1]);
            if (group) {
                let idx = group.selectedIdx || 0;
                let off = group.getOffset(idx);

                start = Math.constrain(start,
                                       off + Math.min(this.CONTEXT_LINES,
                                                      group.itemCount - idx + group.offsets.end)
                                           - this.maxItems + 1,
                                       off - Math.min(this.CONTEXT_LINES,
                                                      idx + group.offsets.start));
            }

            let count = this.maxItems;
            for (let group in values(groups)) {
                let off = Math.max(0, start - group.offsets.start);

                group.count = Math.constrain(group.itemCount - off, 0, count);
                count -= group.count;

                group.collapsed = group.offsets.start >= start + this.maxItems
                               || group.offsets.start + group.itemCount < start;

                group.range = ItemList.Range(off, off + group.count);

                if (!startPos)
                    var startPos = [group, group.range.start];
            }
            this.startPos = startPos;
        }
        this.draw();
    },

    /**
     * Returns an ItemList group for the given completion context,
     * creating one if necessary.
     *
     * @param {CompletionContext} context
     * @returns {ItemList.Group}
     */
    getGroup: function getGroup(context)
        context instanceof ItemList.Group ? context
                                          : context && context.getCache("itemlist-group",
                                                                        () => ItemList.Group(this, context)),

    getOffset: function getOffset(tuple) tuple && this.getGroup(tuple[0]).getOffset(tuple[1])
}, {
    RESIZE_BRIEF: 1 << 0,

    WAITING_MESSAGE: _("completion.generating"),

    Group: Class("ItemList.Group", {
        init: function init(parent, context) {
            this.parent  = parent;
            this.context = context;
            this.offsets = {};
            this.range   = ItemList.Range(0, 0);
        },

        get rootXML()
            ["div", { key: "root", highlight: "CompGroup" },
                ["div", { highlight: "Completions" },
                    this.context.createRow(this.context.title || [], "CompTitle")],
                ["div", { highlight: "CompTitleSep" }],
                ["div", { key: "contents" },
                    ["div", { key: "up", highlight: "CompLess" }],
                    ["div", { key: "message", highlight: "CompMsg" },
                        this.context.message || []],
                    ["div", { key: "itemsContainer", class: "completion-items-container" },
                        ["div", { key: "items", highlight: "Completions" }]],
                    ["div", { key: "waiting", highlight: "CompMsg" },
                        ItemList.WAITING_MESSAGE],
                    ["div", { key: "down", highlight: "CompMore" }]]],

        get doc() this.parent.doc,
        get win() this.parent.win,
        get maxItems() this.parent.maxItems,

        get itemCount() this.context.items.length,

        /**
         * Returns a function which will update the scroll offsets
         * and heights of various DOM members.
         * @private
         */
        get rescrollFunc() {
            let container = this.nodes.itemsContainer;
            let pos    = DOM(container).rect.top;
            let start  = DOM(this.getRow(this.range.start)).rect.top;
            let height = DOM(this.getRow(this.range.end - 1)).rect.bottom - start || 0;
            let scroll = start + container.scrollTop - pos;

            let win = this.win;
            let row = this.selectedRow;
            if (row && this.parent.minHeight) {
                let { rect } = DOM(this.selectedRow);
                var scrollY = this.win.scrollY + rect.bottom - this.win.innerHeight;
            }

            return function () {
                container.style.height = height + "px";
                container.scrollTop = scroll;
                if (scrollY != null)
                    win.scrollTo(0, Math.max(scrollY, 0));
            };
        },

        /**
         * Reset this group for use with a new set of results.
         */
        reset: function reset() {
            this.nodes = {};
            this.generatedRange = ItemList.Range(0, 0);

            DOM.fromJSON(this.rootXML, this.doc, this.nodes);
        },

        /**
         * Update this group after an asynchronous results push.
         */
        update: function update() {
            this.generatedRange = ItemList.Range(0, 0);
            DOM(this.nodes.items).empty();

            if (this.context.message)
                DOM(this.nodes.message).empty()
                    .append(DOM.fromJSON(this.context.message, this.doc));

            if (this.selectedIdx > this.itemCount)
                this.selectedIdx = null;
        },

        /**
         * Updates the DOM to reflect the current state of this
         * group.
         * @private
         */
        draw: function draw() {
            DOM(this.nodes.contents).toggle(!this.collapsed);
            if (this.collapsed)
                return;

            DOM(this.nodes.message).toggle(this.context.message && this.range.start == 0);
            DOM(this.nodes.waiting).toggle(this.context.incomplete && this.range.end <= this.itemCount);
            DOM(this.nodes.up).toggle(this.range.start > 0);
            DOM(this.nodes.down).toggle(this.range.end < this.itemCount);

            if (!this.generatedRange.contains(this.range)) {
                if (this.generatedRange.end == 0)
                    var [start, end] = this.range;
                else {
                    start = this.range.start - (this.range.start <= this.generatedRange.start
                                                    ? this.maxItems / 2 : 0);
                    end   = this.range.end   + (this.range.end > this.generatedRange.end
                                                    ? this.maxItems / 2 : 0);
                }

                let range = ItemList.Range(Math.max(0, start - start % 2),
                                           Math.min(this.itemCount, end));

                let first;
                for (let [i, row] in this.context.getRows(this.generatedRange.start,
                                                          this.generatedRange.end,
                                                          this.doc))
                    if (!range.contains(i))
                        DOM(row).remove();
                    else if (!first)
                        first = row;

                let container = DOM(this.nodes.items);
                let before    = first ? DOM(first).bound.before
                                      : DOM(this.nodes.items).bound.append;

                for (let [i, row] in this.context.getRows(range.start, range.end,
                                                          this.doc)) {
                    if (i < this.generatedRange.start)
                        before(row);
                    else if (i >= this.generatedRange.end)
                        container.append(row);
                    if (i == this.selectedIdx)
                        this.selectedIdx = this.selectedIdx;
                }

                this.generatedRange = range;
            }
        },

        getRow: function getRow(idx) this.context.getRow(idx, this.doc),

        getOffset: function getOffset(idx) this.offsets.start + (idx || 0),

        get selectedRow() this.getRow(this._selectedIdx),

        get selectedIdx() this._selectedIdx,
        set selectedIdx(idx) {
            if (this.selectedRow && this._selectedIdx != idx)
                DOM(this.selectedRow).attr("selected", null);

            this._selectedIdx = idx;

            if (this.selectedRow)
                DOM(this.selectedRow).attr("selected", true);
        }
    }),

    Range: Class.Memoize(function () {
        let Range = Struct("ItemList.Range", "start", "end");
        update(Range.prototype, {
            contains: function contains(idx)
                typeof idx == "number" ? idx >= this.start && idx < this.end
                                       : this.contains(idx.start) &&
                                         idx.end >= this.start && idx.end <= this.end
        });
        return Range;
    })
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
