var dactyllib = require("utils").module("dactyl");

var setupModule = function (module) {
    controller = mozmill.getBrowserController();
    dactyl = new dactyllib.Controller(controller);
};

var teardownModule = function (module) {
    dactyl.teardown();
}

var setupTest = function (test) {
    dactyl.closeMessageWindow();
};

var testVersionCommand_NoArg_VersionStringDisplayed = function () {
    const EXPECTED_OUTPUT = RegExp(dactyl.applicationName + ".+ (.+) running on:.+"); // XXX

    dactyl.runExCommand("version");

    dactyl.assertMessageWindow(EXPECTED_OUTPUT);
};

var testVersionCommand_BangArg_HostAppVersionPageDisplayed = function () {
    const EXPECTED_URL = "about:";
    const EXPECTED_TITLE = "About:";
    const BLANK_PAGE_URL = "about:blank";

    controller.open(BLANK_PAGE_URL);
    controller.waitForPageLoad(controller.tabs.activeTab);
    dactyl.runExCommand("version!");
    controller.waitForPageLoad(controller.tabs.activeTab);

    controller.assert(function () controller.tabs.activeTab.location.href === EXPECTED_URL);
    controller.assert(function () controller.tabs.activeTab.title === EXPECTED_TITLE);
};

// vim: sw=4 ts=8 et:
