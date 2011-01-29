
var utils = require("utils");
const { module, NS } = utils;

var elementslib = module("resource://mozmill/modules/elementslib.js");
var frame = module("resource://mozmill/modules/frame.js");
var jumlib = module("resource://mozmill/modules/jum.js");

function wrapAssertNoErrors(func, message) {
    return function wrapped(arg) this.assertNoErrors(func, this, arguments, message || arg);
}

function assertMessage(funcName, want, got, message) {
    if (typeof want === "string")
        return utils.assertEqual(funcName, want, got, message);
    else if (typeof want === "function")
        return utils.test(want(got), {
            function: funcName,
            want: want, got: got,
            comment: message
        });
    else
        return utils.test(want.test(got), {
            function: funcName,
            want: want, got: got,
            comment: message
        });
}

/**
 * A controller for simulating Dactyl related user actions and for making
 * assertions about the expected outcomes of such actions.
 *
 * @param {MozMillController} controller The browser's MozMill controller.
 */
function Controller(controller) {
    var self = this;
    this.controller = controller;

    /**
     * @property {object} The dactyl modules namespace, to be used
     * sparingly in tests.
     */
    this.dactyl = controller.window.dactyl.modules;

    this.errorCount = 0;

    this._counBeep = function countBeep() {
        self.beepCount++;
    }
    this._countError = function countError(message, highlight) {
        if (/\bErrorMsg\b/.test(highlight))
            self.errorCount++;
    }
    this.dactyl.dactyl.registerObserver("beep", this._countBeep);
    this.dactyl.dactyl.registerObserver("echoLine", this._countError);
    this.dactyl.dactyl.registerObserver("echoMultiline", this._countError);

    this.resetErrorCount();
}

Controller.prototype = {

    teardown: function () {
        this.dactyl.dactyl.unregisterObserver("beep", this._countBeep);
        this.dactyl.dactyl.unregisterObserver("echoLine", this._countError);
        this.dactyl.dactyl.unregisterObserver("echoMultiline", this._countError);
    },

    beepCount: 0,
    errorCount: 0,

    /**
     * Asserts that an error message is displayed during the execution
     * of *func*.
     *
     * @param {function} func A function to call during before the
     *      assertion takes place.
     * @param {object} self The 'this' object to be used during the call
     *      of *func*. @optional
     * @param {Array} args Arguments to be passed to *func*. @optional
     * @param {string} message The message to display upon assertion failure. @optional
     */
    assertMessageError: function (func, self, args, message) {
        let errorCount = this.errorCount;
        this.assertNoErrors(func, self, args, message);
        // dump("assertMessageError " + errorCount + " " + this.errorCount + "\n");
        return utils.assert('dactyl.assertMessageError', this.errorCount > errorCount,
                            "Expected error but got none" + (message ? ": " + message : ""));
    },

    /**
     * Asserts that any output message text content matches *text*.
     *
     * @param {string|RegExp|function} want The expected text of the expected message line.
     * @param {string} message The message to display upon assertion failure.
     */
    assertMessage: function (want, message) {
        return assertMessage('dactyl.assertMessage', want,
                             this.readMessageWindow() || this.readMessageLine(),
                             message);
    },

    /**
     * Asserts that the output message line text content matches *text*.
     *
     * @param {string|RegExp|function} want The expected text of the expected message line.
     * @param {string} message The message to display upon assertion failure.
     */
    assertMessageLine: function (want, message) {
        return assertMessage('dactyl.assertMessageLine', want,
                             this.readMessageLine(),
                             message);
    },

    /**
     * Asserts that the output message window text content matches *text*.
     *
     * @param {string|RegExp|function} want The expected text of the message window.
     * @param {string} message The message to display upon assertion failure.
     */
    assertMessageWindow: function (want, message) {
        return assertMessage('dactyl.assertMessageWindow', want,
                             this.readMessageWindow(),
                             message);
    },

    /**
     * Asserts that the output message line text is an error and content matches *text*.
     *
     * @param {string|RegExp|function} want The expected text of the expected message line.
     * @param {string} message The message to display upon assertion failure.
     */
    assertErrorMessage: function (want, message) {
        return assertMessage('dactyl.assertMessageError', want,
                             this.readMessageLine(),
                             message) &&
               assertMessage('dactyl.assertMessageError', /\bErrorMsg\b/,
                             this.elements.message.getAttributeNS(NS, "highlight"),
                             message);
    },

    /**
     * Asserts that the multi-line output window is in the given state.
     *
     * @param {boolean} open True if the window is expected to be open.
     * @param {string} message The message to display upon assertion failure. @optional
     */
    assertMessageWindowOpen: function (open, message) {
        return utils.assertEqual('dactyl.assertMessageWindowOpen', open,
                                 !this.elements.multilineContainer.collapsed,
                                 message || "Multi-line output not in the expected state");
    },

    /**
     * Asserts that the no errors have been reported since the last call
     * to resetErrorCount.
     *
     * @param {function} func A function to call during before the
     *      assertion takes place. When present, the current error count
     *      is reset before execution.
     *      @optional
     * @param {object} self The 'this' object to be used during the call
     *      of *func*. @optional
     * @param {Array} args Arguments to be passed to *func*. @optional
     * @param {string} message The message to display upon assertion failure. @optional
     * @param {string} message The message to display upon assertion failure. @optional
     */
    assertNoErrors: function (func, self, args, message) {
        let msg = message ? ": " + message : "";
        let beepCount = this.beepCount;
        let errorCount = this.errorCount;

        if (func) {
            errorCount = this.dactyl.util.errorCount;

            try {
                func.apply(self || this, args || []);
            }
            catch (e) {
                this.dactyl.util.reportError(e);
            }
        }

        if (this.beepCount > beepCount)
            this.frame.log({
                function: "dactyl.beepMonitor",
                want: beepCount, got: this.beepCount,
                comment: "Got " + (this.beepCount - beepCount) + " beeps during execution" + msg
            });

        if (errorCount != this.dactyl.util.errorCount)
            var errors = this.dactyl.util.errors.slice(errorCount - this.dactyl.util.errorCount)
                             .join("\n");

        return utils.assertEqual('dactyl.assertNoErrors',
                                 errorCount, this.dactyl.util.errorCount,
                                 "Errors were reported during the execution of this test" + msg + "\n" + errors);
    },

    /**
     * Resets the error count used to determine whether new errors were
     * reported during the execution of a test.
     */
    resetErrorCount: function () {
        this.errorCount = this.dactyl.util.errorCount;
    },

    /**
     * Wraps the given function such that any errors triggered during
     * its execution will trigger a failed assertion.
     *
     * @param {function} func The function to wrap.
     * @param {string} message The message to display upon assertion failure. @optional
     */
    wrapAssertNoErrors: function (func, message) {
        let self = this;
        return function wrapped() self.assertNoErrors(func, this, arguments, message);
    },

    /**
     * Asserts that the current window selection matches *text*.
     *
     * @param {string|RegExp|function} text The expected text of the current selection.
     * @param {string} message The message to display upon assertion failure.
     */
    assertSelection: function (want, message) {
        return assertMessage('dactyl.assertSelection', want,
                             String(this.controller.window.content.getSelection()),
                             message);
    },

    /**
     * @property {string} The name of dactyl's current key handling
     * mode.
     */
    get currentMode() this.dactyl.modes.main.name,

    /**
     * @property {object} A map of dactyl widgets to be used sparingly
     * for focus assertions.
     */
    get elements() let (self = this) ({
        /**
         * @property {HTMLInputElement} The command line's command input box
         */
        get commandInput() self.dactyl.commandline.widgets.active.command.inputField,
        /**
         * @property {Node|null} The currently focused node.
         */
        get focused() self.controller.window.document.commandDispatcher.focusedElement,
        /**
         * @property {HTMLInputElement} The message bar's command input box
         */
        get message() self.dactyl.commandline.widgets.active.message,
        /**
         * @property {Node} The multi-line output window.
         */
        get multiline() self.dactyl.commandline.widgets.multilineOutput,
        /**
         * @property {Node} The multi-line output container.
         */
        get multilineContainer() self.dactyl.commandline.widgets.mowContainer,
    }),

    /**
     * Returns dactyl to normal mode.
     */
    setNormalMode: wrapAssertNoErrors(function () {
        // XXX: Normal mode test
        for (let i = 0; i < 15 && this.dactyl.modes.stack.length > 1; i++)
            this.controller.keypress(null, "VK_ESCAPE", {});

        this.controller.keypress(null, "l", { ctrlKey: true });

        utils.assert("dactyl.setNormalMode", this.dactyl.modes.stack.length == 1,
                     "Failed to return to Normal mode");

        this.assertMessageWindowOpen(false, "Returning to normal mode: Multi-line output not closed");
        this.assertMessageLine(function (msg) !msg, "Returning to normal mode: Message not cleared");
    }, "Returning to normal mode"),

    /**
     * Returns dactyl to Ex mode.
     */
    setExMode: wrapAssertNoErrors(function () {
        if (this.currentMode !== "EX") {
            this.setNormalMode();
            this.controller.keypress(null, ":", {});
        }
        else {
            this.elements.commandInput.value = "";
        }
    }),

    /**
     * Runs a Vi command.
     *
     * @param {string|Array} keys Either a string of simple keys suitable for
     *     {@link MozMillController#type} or an array of keysym - modifier
     *     pairs suitable for {@link MozMillController#keypress}.
     */
    runViCommand: wrapAssertNoErrors(function (keys) {
        if (typeof keys == "string")
            keys = [[k] for each (k in keys)];
        keys.forEach(function ([key, modifiers]) { this.controller.keypress(null, key, modifiers || {}); }, this);
    }),

    /**
     * Runs an Ex command.
     *
     * @param {string} cmd The Ex command string as entered on the command
     *     line.
     * @param {object} args An args object by means of which to execute
     *     the command. If absent *cmd* is parsed as a complete
     *     arguments string. @optional
     */
    // TODO: Use execution code from commandline.js to catch more
    // possible errors without being insanely inefficient after the
    // merge.
    runExCommand: wrapAssertNoErrors(function (cmd, args) {
        this.setNormalMode();
        try {
            // Force async commands to wait for their output to be ready
            // before returning.
            this.dactyl.commandline.savingOutput = true;
            if (args)
                this.dactyl.ex[cmd](args);
            else if (true)
                this.dactyl.commands.execute(cmd, null, false, null,
                                             { file: "[Command Line]", line: 1 });
            else {
                var doc = this.controller.window.document;
                var event = doc.createEvent("Events");
                event.initEvent("dactyl.execute", false, false);
                doc.documentElement.setAttribute("dactyl-execute", cmd);
                doc.documentElement.dispatchEvent(event);
            }
        }
        finally {
            this.dactyl.commandline.savingOutput = false;
        }
    }),

    /**
     * Triggers Ex completion for the given command string and ensures
     * that no errors have occurred during the process.
     *
     * @param {string} cmd The Ex command string as entered on the command
     *     line.
     */
    runExCompletion: wrapAssertNoErrors(function (cmd) {
        this.setExMode();

        utils.assertEqual("dactyl.runExCompletion",
                          this.elements.commandInput,
                          this.elements.focused,
                          "Running Ex Completion: The command line is not focused");

        // dump("runExCompletion " + cmd + "\n");
        if (true) {
            let input = this.elements.commandInput;
            input.value = cmd;

            var event = input.ownerDocument.createEvent("Events");
            event.initEvent("change", true, false);
            input.dispatchEvent(event);
        }
        else {
            this.controller.type(null, cmd);

            utils.assertEqual("dactyl.runExCompletion", cmd,
                              this.elements.commandInput.editor.rootElement.firstChild.textContent,
                              "Command line does not have the expected value: " + cmd);
        }

        this.controller.keypress(null, "VK_TAB", {});

        // XXX
        if (this.dactyl.commandline._tabTimer)
            this.dactyl.commandline._tabTimer.flush();
        else if (this.dactyl.commandline.commandSession && this.dactyl.commandline.commandSession.completions)
            this.dactyl.commandline.commandSession.completions.tabTimer.flush();
    }),

    /**
     * Returns the text content of the output message line.
     *
     * @returns {string} The message line text content.
     */
    readMessageLine: function () {
        return this.elements.message.value;
    },

    /**
     * Returns the text content of the output message window.
     *
     * @returns {string} The message window text content.
     */
    readMessageWindow: function () {
        if (!this.elements.multilineContainer.collapsed)
            return this.elements.multiline.contentDocument.body.textContent;
        return "";
    },

    /**
     * Opens the output message window by echoing a single newline character.
     */
    openMessageWindow: wrapAssertNoErrors(function() {
        this.dactyl.dactyl.echo("\n");
    }, "Opening message window"),

    /**
     * Clears the current message.
     */
    clearMessage: function() {
        this.elements.message.value = ""; // XXX
    },

    /**
     * Closes the output message window if open.
     */
    closeMessageWindow: wrapAssertNoErrors(function() {
        for (let i = 0; i < 15 && !this.elements.multilineContainer.collapsed; i++)
            this.controller.keypress(null, "VK_ESCAPE", {});
        this.assertMessageWindowOpen(false, "Clearing message window failed");
    }, "Clearing message window"),

    /**
     * @property {string} The specific Dactyl application. Eg. Pentadactyl
     */
    get applicationName() this.dactyl.config.appName // XXX
};

exports.Controller = Controller;

// vim: sw=4 ts=8 et:
