const utils = require("utils");
const { module } = utils;

var jumlib = module("resource://mozmill/modules/jum.js");
var dactyllib = module("dactyl");

const { Services } = module("resource://gre/modules/Services.jsm");

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

function urlTarget(url) Services.io.newChannel(url, null, null).name;

function urlExists(url) {
    try {
        let chan = Services.io.newChannel(url);
        chan.open();
        try { chan.cancel(Cr.NS_BINDING_ABORTED) } catch (e) {}
        return true;
    }
    catch (e) {
        return false;
    }
}

const HELP_FILES = ["all", "tutorial", "intro", "starting", "browsing",
    "buffer", "cmdline", "editing", "options", "pattern", "tabs", "hints",
    "map", "eval", "marks", "repeat", "autocommands", "print", "gui",
    "styling", "message", "privacy", "developer", "various", "plugins", "faq",
    "versions", "index"];

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

        let links = controller.tabs.activeTab.querySelectorAll("a[href^='dactyl:']");

        let missing = Array.filter(links, function (link) urlExists(link.href))
                           .map(function (link) link.textContent + " -> " + link.href);

        utils.assertEqual("testHelpCommands.assertNoDeadLinks", 0, missing.length,
                          "Found dead links in " + tag + ": " + missing.join(", "));
    }
};

function assertHelpOpensPageWithTag({ HELP_COMMAND, EXPECTED_HELP_TAG }) {
    HELP_COMMAND();
    controller.waitForPageLoad(controller.tabs.activeTab);
    controller.assertNode(new elementslib.ID(controller.tabs.activeTab, EXPECTED_HELP_TAG));
}

// vim: sw=4 ts=8 et:
