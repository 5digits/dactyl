// Runs a slew of generic option tests

var utils = require("utils");
const { module } = utils;

var dactyllib = module("dactyl");
var jumlib = module("resource://mozmill/modules/jum.js");

var setupModule = function (module) {
    controller = mozmill.getBrowserController();
    dactyl = new dactyllib.Controller(controller);
};
var teardownModule = function (module) {
    dactyl.teardown();
}

function $(selector) controller.window.document.querySelector(selector);

function testDefaultValidators() {
    for (var option in dactyl.modules.options)
        dactyl.assertNoErrors(function () {
            dactyl.assertNoErrorMessages(function () {
                dump("OPT VAL " + option.name + "\n");
                utils.assert("testOptions.testValidators", option.validator(option.value),
                             "Option '" + option.name + "' validator failed");
            });
        });
}

var options = {};

function testCompleters() {
    for (var option in dactyl.modules.options)
        for (var [, value] in Iterator([""].concat(options[option.name] || []))) {
            dump("OPT COMP " + option.name + " " + value + "\n");
            dactyl.testCompleter(dactyl.modules.completion, "optionValue", value,
                                 "Option '" + option.name + "' completer failed",
                                 option.name);
        }
}

// vim: sw=4 ts=8 et:
