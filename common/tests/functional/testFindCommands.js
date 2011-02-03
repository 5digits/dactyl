var dactyllib = require("utils").module("dactyl");

const FIND_TEST_PAGE = collector.addHttpResource("./data/") + "find.html";

var setupModule = function (module) {
    controller = mozmill.getBrowserController();
    dactyl = new dactyllib.Controller(controller);
};

var teardownModule = function (module) {
    dactyl.teardown();
}

var setupTest = function (test) {
    controller.open(FIND_TEST_PAGE);
    controller.waitForPageLoad(controller.tabs.activeTab);
    controller.sleep(1000);
};

var testFindCommand_PresentAlphabeticText_TextSelected = function () {
    assertTextFoundInPage("letter")
};

var testFindCommand_PresentNumericText_TextSelected = function () {
    assertTextFoundInPage("3.141")
};

var testFindCommand_MissingText_ErrorMessageDisplayed = function () {
    const MISSING_TEXT = "8c307545a017f60add90ef08955e148e";
    const PATTERN_NOT_FOUND_ERROR = "E486: Pattern not found: " + MISSING_TEXT;

    runTextSearchCommand(MISSING_TEXT);

    dactyl.assertErrorMessage(PATTERN_NOT_FOUND_ERROR);
};

function runTextSearchCommand(str) {
    dactyl.runViCommand("/" + str);
    dactyl.runViCommand([["VK_RETURN"]]);

    controller.sleep(0);
}

function assertTextFoundInPage(text) {
    runTextSearchCommand(text);
    dactyl.assertSelection(text);
}

// vim: sw=4 ts=8 et:
