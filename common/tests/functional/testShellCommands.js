var dactyllib = require("utils").module("dactyl");

var setupModule = function (module) {
    controller = mozmill.getBrowserController();
    dactyl = new dactyllib.Controller(controller);
};

var teardownModule = function (module) {
    dactyl.teardown();
}

var teardownTest = function (test) {
    dactyl.closeMessageWindow();
};

var testRunCommand_ExecutingOutputCommand_OutputDisplayed = function () {
    const EXPECTED_OUTPUT = "foobar";
    const COMMAND = "run echo " + EXPECTED_OUTPUT;

    dactyl.runExCommand(COMMAND);

    dactyl.assertMessageWindow(RegExp(EXPECTED_OUTPUT));
};

var testRunCommand_RepeatArg_LastCommandRepeated = function () {
    const EXPECTED_OUTPUT = /foobar$/; // XXX
    const COMMAND = "run echo 'foobar'";
    const REPEAT_COMMAND = "run!";

    dactyl.runExCommand(COMMAND);
    dactyl.closeMessageWindow();
    dactyl.runExCommand(REPEAT_COMMAND);

    dactyl.assertMessageWindow(EXPECTED_OUTPUT);
};

// vim: sw=4 ts=8 et:
