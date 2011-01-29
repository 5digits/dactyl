var jumlib = {}; Components.utils.import("resource://mozmill/modules/jum.js", jumlib);
var dactyllib = require("dactyl");

var setupModule = function (module) {
    controller = mozmill.getBrowserController();
    dactyl = new dactyllib.Controller(controller);
};

var teardownModule = function (module) {
    dactyl.teardown();
}

var setupTest = function (test) {
    dactyl.runViCommand([["VK_ESCAPE"]]);
};

const HELP_FILES = ["all", "tutorial", "intro", "starting", "browsing",
    "buffer", "cmdline", "insert", "options", "pattern", "tabs", "hints",
    "map", "eval", "marks", "repeat", "autocommands", "print", "gui",
    "styling", "message", "developer", "various", "faq", "index", "plugins"];

var testViHelpCommand_OpensIntroHelpPage = function () {
    assertHelpOpensPageWithTag({
        HELP_COMMAND: function () { dactyl.runViCommand([["VK_F1"]]); },
        EXPECTED_HELP_TAG: "intro.xml"
    });
};

var testViHelpAllCommand_OpensAllHelpPage = function () {
    assertHelpOpensPageWithTag({
        HELP_COMMAND: function () { dactyl.runViCommand([["VK_F1", { altKey: true }]]); },
        EXPECTED_HELP_TAG: "all.xml"
    });
};

var testExHelpCommand_NoArgs_OpensIntroHelpPage = function () {
    assertHelpOpensPageWithTag({
        HELP_COMMAND: function () { dactyl.runExCommand("help"); },
        EXPECTED_HELP_TAG: "intro.xml"
    });
};

var testExHelpAllCommand_NoArgs_OpensAllHelpPage = function () {
    assertHelpOpensPageWithTag({
        HELP_COMMAND: function () { dactyl.runExCommand("helpall"); },
        EXPECTED_HELP_TAG: "all.xml"
    });
};

var testExHelpCommand_PageTagArg_OpensHelpPageContainingTag = function () {
    for (let [, file] in Iterator(HELP_FILES)) {
        let tag = file + ".xml";
        assertHelpOpensPageWithTag({
            HELP_COMMAND: function () { dactyl.runExCommand("help " + tag); },
            EXPECTED_HELP_TAG: tag
        });
    }
};

function assertHelpOpensPageWithTag({ HELP_COMMAND, EXPECTED_HELP_TAG }) {
    HELP_COMMAND();
    controller.waitForPageLoad(controller.tabs.activeTab);
    controller.assertNode(new elementslib.ID(controller.tabs.activeTab, EXPECTED_HELP_TAG));
}

// vim: sw=4 ts=8 et:
