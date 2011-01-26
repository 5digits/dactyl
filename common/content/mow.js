// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.

var MOW = Module("mow", {
    init: function () {

        let fontSize = util.computedStyle(document.documentElement).fontSize;
        styles.system.add("font-size", "dactyl://content/buffer.xhtml",
                          "body { font-size: " + fontSize + "; } \
                           html|html > xul|scrollbar { visibility: collapse !important; }",
                          true);

        XML.ignoreWhitespace = true;
        util.overlayWindow(window, {
            objects: {
                eventTarget: this
            },
            append: <e4x xmlns={XUL} xmlns:dactyl={NS}>
                <window id={document.documentElement.id}>
                    <popupset>
                        <menupopup id="dactyl-contextmenu" highlight="Events" events="contextEvents">
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
                                flex="1" hidden="false" collapsed="false" contextmenu="dactyl-contextmenu"
                                highlight="Events" />
                    </vbox>
                </vbox>
            </e4x>
        });
    },

    __noSuchMethod__: function (meth, args) Buffer[meth].apply(Buffer, [this.body].concat(args)),

    get widget() this.widgets.multilineOutput,
    widgets: Class.memoize(function () commandline.widgets),

    body: Class.memoize(function () this.widget.contentDocument.documentElement),
    document: Class.memoize(function () this.widget.contentDocument),
    window: Class.memoize(function () this.widget.contentWindow),

    /**
     * Display a multi-line message.
     *
     * @param {string} data
     * @param {string} highlightGroup
     */
    echo: function echo(data, highlightGroup, silent) {
        let body = this.document.body;

        this.widgets.message = null;
        if (!commandline.commandVisible)
            commandline.hide();

        this._startHints = false;
        if (modes.main != modes.OUTPUT_MULTILINE) {
            modes.push(modes.OUTPUT_MULTILINE, null, {
                onKeyPress: this.closure.onKeyPress,
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
            this.lastOutput = null;

            var output = util.xmlToDom(<div class="ex-command-output" style="white-space: nowrap" highlight={highlightGroup}/>,
                                       this.document);
            data.document = this.document;
            output.appendChild(data.message);

            this.messages.push(data);
        }
        else {
            let style = isString(data) ? "pre" : "nowrap";
            this.lastOutput = <div class="ex-command-output" style={"white-space: " + style} highlight={highlightGroup}>{data}</div>;

            var output = util.xmlToDom(this.lastOutput, this.document);
        }

        // FIXME: need to make sure an open MOW is closed when commands
        //        that don't generate output are executed
        if (this.widgets.mowContainer.collapsed) {
            this.body.scrollTop = 0;
            while (body.firstChild)
                body.removeChild(body.firstChild);
        }

        body.appendChild(output);

        let str = typeof data !== "xml" && data.message || data;
        if (!silent)
            dactyl.triggerObserver("echoMultiline", data, highlightGroup, output);

        this.resize(true);

        if (options["more"] && this.isScrollable(1)) {
            // start the last executed command's output at the top of the screen
            let elements = this.document.getElementsByClassName("ex-command-output");
            elements[elements.length - 1].scrollIntoView(true);
        }
        else
            this.body.scrollTop = this.body.scrollHeight;

        dactyl.focus(this.window);
        this.updateMorePrompt();
    },

    events: {
        click: function onClick(event) {
            if (event.getPreventDefault())
                return;

            const openLink = function openLink(where) {
                event.preventDefault();
                dactyl.open(event.target.href, where);
            }

            if (event.target instanceof HTMLAnchorElement)
                switch (events.toString(event)) {
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
    contextEvents: {
        popupshowing: function (event) {
            let enabled = {
                link: window.document.popupNode instanceof HTMLAnchorElement,
                path: window.document.popupNode.hasAttribute("path"),
                selection: !window.document.commandDispatcher.focusedWindow.getSelection().isCollapsed
            };

            for (let node in array.iterValues(event.target.children)) {
                let group = node.getAttributeNS(NS, "group");
                node.hidden = group && !group.split(/\s+/).every(function (g) enabled[g]);
            }
        }
    },

    onContext: function onContext(event) {
        return true;
    },

    onKeyPress: function onKeyPress(event) {
        const KILL = false, PASS = true;

        if (options["more"] && mow.isScrollable(1))
            commandline.updateMorePrompt(false, true);
        else {
            modes.pop();
            events.feedkeys(events.toString(event));
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
    resize: function updateOutputHeight(open, extra) {
        if (!open && this.widgets.mowContainer.collapsed)
            return;

        let doc = this.widget.contentDocument;

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
        this.visible = true;
    },

    get spaceNeeded() {
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
        let elem = this.widget.contentDocument.documentElement;

        if (showHelp)
            this.widgets.message = ["MoreMsg", "-- More -- SPACE/<C-f>/j: screen/page/line down, <C-b>/<C-u>/k: up, q: quit"];
        else if (force || (options["more"] && Buffer.isScrollable(elem, 1)))
            this.widgets.message = ["MoreMsg", "-- More --"];
        else
            this.widgets.message = ["Question", "Press ENTER or type command to continue"];
    },

    visible: Modes.boundProperty({
        set: function set_mowVisible(value) {
            this.widgets.mowContainer.collapsed = !value;

            let elem = this.widget;
            if (!value && elem && elem.contentWindow == document.commandDispatcher.focusedWindow)
                document.commandDispatcher.focusedWindow = content;
        }
    }),

}, {
}, {
    mappings: function () {
        const PASS = true;
        const DROP = false;
        const BEEP = {};

        mappings.add([modes.COMMAND],
            ["g<lt>"], "Redisplay the last command output",
            function () {
                dactyl.assert(commandline.lastOutput, "No previous command output");
                mow.echo(mow.lastOutput, "Normal");
            });

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
                        mow.updateMorePrompt();
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
        options.add(["more"],
            "Pause the message list window when the full output will not fit on one page",
            "boolean", true);
    }
});
