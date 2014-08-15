// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var MOW = Module("mow", {
    init: function init() {

        this._resize = Timer(20, 400, function _resize() {
            if (this.visible)
                this.resize(false);

            if (this.visible && isinstance(modes.main, modes.OUTPUT_MULTILINE))
                this.updateMorePrompt();
        }, this);

        this._timer = Timer(20, 400, function _timer() {
            if (modes.have(modes.OUTPUT_MULTILINE)) {
                this.resize(true);

                if (options["more"] && this.canScroll(1))
                    // start the last executed command's output at the top of the screen
                    DOM(this.document.body.lastElementChild).scrollIntoView(true);
                else
                    this.body.scrollTop = this.body.scrollHeight;

                dactyl.focus(this.window);
                this.updateMorePrompt();
            }
        }, this);

        events.listen(window, this, "windowEvents");

        modules.mow = this;
        let fontSize = DOM(document.documentElement).style.fontSize;
        styles.system.add("font-size", "dactyl://content/buffer.xhtml",
                          // "body { font-size: " + fontSize + "; } \
                          "html|html > xul|scrollbar { visibility: collapse !important; }",
                          true);

        overlay.overlayWindow(window, {
            objects: {
                eventTarget: this
            },
            append: [
                ["window", { id: document.documentElement.id, xmlns: "xul" },
                    ["popupset", {},
                        ["menupopup", { id: "dactyl-contextmenu", highlight: "Events", events: "contextEvents" },
                            ["menuitem", { id: "dactyl-context-copylink", label: _("mow.contextMenu.copyLink"),
                                           "dactyl:group": "link",      oncommand: "goDoCommand('cmd_copyLink');" }],
                            ["menuitem", { id: "dactyl-context-copypath", label: _("mow.contextMenu.copyPath"),
                                           "dactyl:group": "link path", oncommand: "dactyl.clipboardWrite(document.popupNode.getAttribute('path'));" }],
                            ["menuitem", { id: "dactyl-context-copy", label: _("mow.contextMenu.copy"),
                                           "dactyl:group": "selection", command: "cmd_copy" }],
                            ["menuitem", { id: "dactyl-context-selectall", label: _("mow.contextMenu.selectAll"),
                                           command: "cmd_selectAll" }]]]],

                ["vbox", { id: config.ids.commandContainer, xmlns: "xul" },
                    ["vbox", { class: "dactyl-container", id: "dactyl-multiline-output-container", hidden: "false", collapsed: "true" },
                        ["iframe", { id: "dactyl-multiline-output", src: "dactyl://content/buffer.xhtml",
                                     flex: "1", hidden: "false", collapsed: "false",
                                     contextmenu: "dactyl-contextmenu", highlight: "Events" }]]]]
        });
    },

    __noSuchMethod__: function (meth, args) Buffer[meth].apply(Buffer, [this.body].concat(args)),

    get widget() this.widgets.multilineOutput,
    widgets: Class.Memoize(function widgets() commandline.widgets),

    body: Class.Memoize(function body() this.widget.contentDocument.documentElement),
    get document() this.widget.contentDocument,
    get window() this.widget.contentWindow,

    /**
     * Display a multi-line message.
     *
     * @param {string} data
     * @param {string} highlightGroup
     */
    echo: function echo(data, highlightGroup, silent) {
        let body = DOM(this.document.body);

        this.widgets.message = null;
        if (!commandline.commandVisible)
            commandline.hide();

        if (modes.main != modes.OUTPUT_MULTILINE) {
            modes.push(modes.OUTPUT_MULTILINE, null, {
                onKeyPress: this.bound.onKeyPress,

                leave: stack => {
                    if (stack.pop)
                        for (let message in values(this.messages))
                            if (message.leave)
                                message.leave(stack);
                },

                window: this.window
            });
            this.messages = [];
        }

        highlightGroup = "CommandOutput " + (highlightGroup || "");

        if (isObject(data) && !isinstance(data, _) && !DOM.isJSONXML(data)) {
            this.lastOutput = null;

            var output = DOM(["div", { style: "white-space: nowrap", highlight: highlightGroup }],
                             this.document);
            data.document = this.document;
            try {
                output.append(data.message);
            }
            catch (e) {
                util.reportError(e);
                util.dump(data);
            }
            this.messages.push(data);
        }
        else {
            let style = isString(data) ? "pre-wrap" : "nowrap";
            this.lastOutput = ["div", { style: "white-space: " + style, highlight: highlightGroup },
                               data];

            var output = DOM(this.lastOutput, this.document);
        }

        // FIXME: need to make sure an open MOW is closed when commands
        //        that don't generate output are executed
        if (!this.visible) {
            this.body.scrollTop = 0;
            body.empty();
        }

        body.append(output);

        let str = typeof data !== "xml" && data.message || data;
        if (!silent)
            dactyl.triggerObserver("echoMultiline", data, highlightGroup, output[0]);

        this._timer.tell();
        if (!this.visible)
            this._timer.flush();
    },

    events: {
        click: function onClick(event) {
            if (event.defaultPrevented)
                return;

            const openLink = function openLink(where) {
                event.preventDefault();
                dactyl.open(event.target.href, where);
            };

            if (event.target instanceof Ci.nsIDOMHTMLAnchorElement)
                switch (DOM.Event.stringify(event)) {
                case "<LeftMouse>":
                    openLink(dactyl.CURRENT_TAB);
                    break;
                case "<MiddleMouse>":
                case "<C-LeftMouse>":
                case "<C-M-LeftMouse>":
                    openLink({ where: dactyl.NEW_TAB, background: true });
                    break;
                case "<S-MiddleMouse>":
                case "<C-S-LeftMouse>":
                case "<C-M-S-LeftMouse>":
                    openLink({ where: dactyl.NEW_TAB, background: false });
                    break;
                case "<S-LeftMouse>":
                    openLink(dactyl.NEW_WINDOW);
                    break;
                }
        },
        unload: function onUnload(event) {
            event.preventDefault();
        }
    },

    windowEvents: {
        resize: function onResize(event) {
            if (event.target == window)
                this._resize.tell();
        }
    },

    contextEvents: {
        popupshowing: function onPopupShowing(event) {
            let menu = commandline.widgets.contextMenu;
            let enabled = {
                link: window.document.popupNode instanceof Ci.nsIDOMHTMLAnchorElement,
                path: window.document.popupNode.hasAttribute("path"),
                selection: !window.document.commandDispatcher.focusedWindow.getSelection().isCollapsed
            };

            for (let node in array.iterValues(menu.children)) {
                let group = node.getAttributeNS(NS, "group");
                node.hidden = group && !group.split(/\s+/).every(g => enabled[g]);
            }
        }
    },

    onKeyPress: function onKeyPress(eventList) {
        const KILL = false, PASS = true;

        if (options["more"] && mow.canScroll(1))
            this.updateMorePrompt(false, true);
        else {
            modes.pop();
            events.feedevents(null, eventList);
            return KILL;
        }
        return PASS;
    },

    /**
     * Changes the height of the message window to fit in the available space.
     *
     * @param {boolean} open If true, the widget will be opened if it's not
     *     already so.
     */
    resize: function resize(open, extra) {
        if (!(open || this.visible))
            return;

        let doc = this.widget.contentDocument;

        let trim = this.spaceNeeded;
        let availableHeight = config.outputHeight - trim;
        if (this.visible)
            availableHeight += parseFloat(this.widgets.mowContainer.height || 0);
        availableHeight -= extra || 0;

        doc.body.style.minWidth = this.widgets.commandbar.commandline.scrollWidth + "px";

        function adjust() {
            let wantedHeight = doc.body.clientHeight;
            this.widgets.mowContainer.height = Math.min(wantedHeight, availableHeight) + "px",
            this.wantedHeight = Math.max(0, wantedHeight - availableHeight);
        }
        adjust.call(this);
        this.timeout(adjust);

        doc.body.style.minWidth = "";

        this.visible = true;
    },

    get spaceNeeded() {
        if (DOM("#dactyl-bell", document).isVisible)
            return 0;
        return Math.max(0, DOM("#" + config.ids.commandContainer, document).rect.bottom
                            - window.innerHeight);
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
        if (!this.visible || !isinstance(modes.main, modes.OUTPUT_MULTILINE))
            return this.widgets.message = null;

        let elem = this.widget.contentDocument.documentElement;

        if (showHelp)
            this.widgets.message = ["MoreMsg", _("mow.moreHelp")];
        else if (force || (options["more"] && Buffer.canScroll(elem, 1)))
            this.widgets.message = ["MoreMsg", _("mow.more")];
        else
            this.widgets.message = ["Question", _("mow.continue")];
    },

    visible: Modes.boundProperty({
        get: function get_mowVisible() !this.widgets.mowContainer.collapsed,
        set: function set_mowVisible(value) {
            this.widgets.mowContainer.collapsed = !value;

            let elem = this.widget;
            if (!value && elem && elem.contentWindow == document.commandDispatcher.focusedWindow) {

                let focused = content.document.activeElement;
                if (focused && Events.isInputElement(focused))
                    focused.blur();

                document.commandDispatcher.focusedWindow = content;
            }
        }
    })
}, {
}, {
    modes: function initModes() {
        modes.addMode("OUTPUT_MULTILINE", {
            description: "Active when the multi-line output buffer is open",
            bases: [modes.NORMAL]
        });
    },
    mappings: function initMappings() {
        const PASS = true;
        const DROP = false;
        const BEEP = {};

        mappings.add([modes.COMMAND],
            ["g<lt>"], "Redisplay the last command output",
            function () {
                dactyl.assert(mow.lastOutput, _("mow.noPreviousOutput"));
                mow.echo(mow.lastOutput, "Normal");
            });

        mappings.add([modes.OUTPUT_MULTILINE],
            ["<Esc>", "<C-[>"],
            "Return to the previous mode",
            function () { modes.pop(null, { fromEscape: true }); });

        let bind = function bind(keys, description, action, test, default_) {
            mappings.add([modes.OUTPUT_MULTILINE],
                keys, description,
                function (args) {
                    if (!options["more"])
                        var res = PASS;
                    else if (test && !test(args))
                        res = default_;
                    else
                        res = action.call(this, args);

                    if (res === PASS || res === DROP)
                        modes.pop();
                    else
                        mow.updateMorePrompt();
                    if (res === BEEP)
                        dactyl.beep();
                    else if (res === PASS)
                        events.feedkeys(args.command);
                }, {
                    count: action.length > 0
                });
        };

        bind(["j", "<C-e>", "<Down>"], "Scroll down one line",
             function ({ count }) { mow.scrollVertical("lines", 1 * (count || 1)); },
             () => mow.canScroll(1), BEEP);

        bind(["k", "<C-y>", "<Up>"], "Scroll up one line",
             function ({ count }) { mow.scrollVertical("lines", -1 * (count || 1)); },
             () => mow.canScroll(-1), BEEP);

        bind(["<C-j>", "<C-m>", "<Return>"], "Scroll down one line, exit on last line",
             function ({ count }) { mow.scrollVertical("lines", 1 * (count || 1)); },
             () => mow.canScroll(1), DROP);

        // half page down
        bind(["<C-d>"], "Scroll down half a page",
             function ({ count }) { mow.scrollVertical("pages", .5 * (count || 1)); },
             () => mow.canScroll(1), BEEP);

        bind(["<C-f>", "<PageDown>"], "Scroll down one page",
             function ({ count }) { mow.scrollVertical("pages", 1 * (count || 1)); },
             () => mow.canScroll(1), BEEP);

        bind(["<Space>"], "Scroll down one page",
             function ({ count }) { mow.scrollVertical("pages", 1 * (count || 1)); },
             () => mow.canScroll(1), DROP);

        bind(["<C-u>"], "Scroll up half a page",
             function ({ count }) { mow.scrollVertical("pages", -.5 * (count || 1)); },
             () => mow.canScroll(-1), BEEP);

        bind(["<C-b>", "<PageUp>"], "Scroll up half a page",
             function ({ count }) { mow.scrollVertical("pages", -1 * (count || 1)); },
             () => mow.canScroll(-1), BEEP);

        bind(["gg"], "Scroll to the beginning of output",
             function () { mow.scrollToPercent(null, 0); });

        bind(["G"], "Scroll to the end of output",
             function ({ count }) { mow.scrollToPercent(null, count || 100); });

        // copy text to clipboard
        bind(["<C-y>"], "Yank selection to clipboard",
             function () { dactyl.clipboardWrite(Buffer.currentWord(mow.window)); });

        // close the window
        bind(["q"], "Close the output window",
             function () {},
             () => false, DROP);
    },
    options: function initOptions() {
        options.add(["more"],
            "Pause the message list window when the full output will not fit on one page",
            "boolean", true);
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
