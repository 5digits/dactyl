var dactyllib = require("dactyl");

var setupModule = function (module) {
    controller = mozmill.getBrowserController();
    dactyl = new dactyllib.Controller(controller);
};

var teardownTest = function (test) {
    dactyl.closeMessageWindow();
};

var testEchoCommand_SingleLineMessageAndClosedMOW_MessageDisplayedInMessageLine = function () {
    const output = "foobar";

    assertEchoGeneratesLineOutput({
        ECHO_COMMAND: "echo " + output.quote(),
        EXPECTED_OUTPUT: output
    });
};

var testEchoCommand_SingleLineMessageAndOpenMOW_MessageAppendedToMOW = function () {
    const output = "foobar";

    dactyl.openMessageWindow();

    assertEchoGeneratesWindowOutput({
        ECHO_COMMAND: "echo " + output.quote(),
        EXPECTED_OUTPUT: RegExp(output)
    });
};

var testEchoCommand_MultilineMessageAndClosedMOW_MessageDisplayedInMOW = function () {
    const output = "foo\nbar";

    assertEchoGeneratesWindowOutput({
        ECHO_COMMAND: "echo " + output.quote(),
        EXPECTED_OUTPUT: output
    });
};

var testEchoCommand_MultilineMessageAndOpenMOW_MessageAppendedToMOW = function () {
    const output = "foo\nbar";

    dactyl.openMessageWindow();

    assertEchoGeneratesWindowOutput({
        ECHO_COMMAND: "echo " + output.quote(),
        EXPECTED_OUTPUT: RegExp(output)
    });
};

var testEchoCommand_ObjectArgumentAndClosedMOW_MessageDisplayedInMOW = function () {
    assertEchoGeneratesWindowOutput({
        ECHO_COMMAND: "echo var obj = { x: 1, y: 2 }; obj;",
        EXPECTED_OUTPUT: "[object\u00A0Object]::\nx: 1\ny: 2\n"
    });
};

function assertEchoGeneratesWindowOutput({ ECHO_COMMAND, EXPECTED_OUTPUT }) {
    dactyl.runExCommand(ECHO_COMMAND);
    dactyl.assertMessageWindow(EXPECTED_OUTPUT);
}

function assertEchoGeneratesLineOutput({ ECHO_COMMAND, EXPECTED_OUTPUT }) {
    dactyl.runExCommand(ECHO_COMMAND);
    dactyl.assertMessageLine(EXPECTED_OUTPUT);
}

// vim: sw=4 ts=8 et:
