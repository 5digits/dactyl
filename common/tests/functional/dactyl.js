var elementslib = {}; Components.utils.import("resource://mozmill/modules/elementslib.js", elementslib);
var jumlib = {};      Components.utils.import("resource://mozmill/modules/jum.js", jumlib);

/**
 * A controller for simulating Dactyl related user actions and for making
 * assertions about the expected outcomes of such actions.
 *
 * @param {MozMillController} controller The browser's MozMill controller.
 */
function Controller(controller) {
    this.controller = controller;
    this._dactyl = controller.window.dactyl.modules;
}

Controller.prototype = {

    /**
     * Asserts that the output message line text content matches *text*.
     *
     * @param {string|RegExp} text The expected text of the expected message line.
     * @param {string} message The message to display upon assertion failure.
     */
    assertMessageLine: function (text, message) {
        let value = this.readMessageLine();
        jumlib.assertTrue(typeof text == "string" ? text == value : text.test(value), message);
    },

    /**
     * Asserts that the output message window text content matches *text*.
     *
     * @param {string|RegExp} text The expected text of the message window.
     * @param {string} message The message to display upon assertion failure.
     */
    assertMessageWindow: function (text, message) {
        let value = this.readMessageWindow();
        jumlib.assertTrue(typeof text == "string" ? text == value : text.test(value), message);
    },

    /**
     * Asserts that an error message has been echoed to the message line or
     * appended to the message window with the given *text*.
     *
     * @param {string|RegExp} text The expected text of the error message.
     * @param {string} message The message to display upon assertion failure.
     */
    // TODO: test against the tail of the MOW too.
    assertErrorMessage: function (text, message) {
        this.controller.sleep(0); // XXX
        let messageBox = new elementslib.ID(this.controller.window.document, "dactyl-message").getNode();
        jumlib.assertTrue(messageBox.value == text && /\bErrorMsg\b/.test(messageBox.getAttribute("highlight")), message);
    },

    /**
     * Asserts that the current window selection matches *text*.
     *
     * @param {string|RegExp} text The expected text of the current selection.
     * @param {string} message The message to display upon assertion failure.
     */
    assertSelection: function (text, message) {
        let selection = String(this.controller.window.content.getSelection());
        jumlib.assertTrue(typeof text == "string" ? text == selection : text.test(selection), message);
    },

    /**
     * Runs a Vi command.
     *
     * @param {string|Array} keys Either a string of simple keys suitable for
     *     {@link MozMillController#type} or an array of keysym - modifier
     *     pairs suitable for {@link MozMillController#keypress}.
     */
    runViCommand: function (keys) {
        if (typeof keys == "string")
            keys = [[k] for each (k in keys)];
        let self = this;
        keys.forEach(function ([key, modifiers]) { self.controller.keypress(null, key, modifiers || {}); });
    },

    /**
     * Runs an Ex command.
     *
     * @param {string} cmd The Ex command string as entered on the command
     *     line.
     */
    runExCommand: function (cmd) {
        this.controller.keypress(null, ":", {});
        this.controller.type(null, cmd);
        this.controller.keypress(null, "VK_RETURN", {});
    },

    /**
     * Returns the text content of the output message line.
     *
     * @returns {string} The message line text content.
     */
    readMessageLine: function () {
        this.controller.sleep(0); // XXX
        return new elementslib.ID(this.controller.window.document, "dactyl-message").getNode().value;
    },

    /**
     * Returns the text content of the output message window.
     *
     * @returns {string} The message window text content.
     */
    readMessageWindow: function () {
        let messageWindow = new elementslib.ID(this.controller.window.document, "dactyl-multiline-output").getNode();
        try {
            this.controller.waitForEval("subject.collapsed == false", 1000, 100, messageWindow.parentNode);
            return messageWindow.contentDocument.body.textContent;
        }
        catch (e) {
            return "";
        }
    },

    /**
     * Opens the output message window by echoing a single newline character.
     */
    openMessageWindow: function() {
        //this.runExCommand("echo '\\n'");
        this.runExCommand("echo " + "\n".quote());
    },

    /**
     * Closes the output message window if open.
     */
    closeMessageWindow: function() {
        if (!this._dactyl.commandline.widgets.mowContainer.collapsed) // XXX
            this.runViCommand([["VK_RETURN"]]);
    },

    /**
     * @property {string} The specific Dactyl application. Eg. Pentadactyl
     */
    get applicationName() this._dactyl.config.appName // XXX
};

exports.Controller = Controller;

// vim: sw=4 ts=8 et:
