// Copyright (c) 2009 by Doug Kearns
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

function reportError(e) {
    dump("dactyl: command-line-handler: " + e + "\n" + (e.stack || Error().stack));
    Cu.reportError(e);
}

try {

var global = this;
var NAME = "command-line-handler";
var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function CommandLineHandler() {
    this.wrappedJSObject = this;

    Cu.import("resource://dactyl/base.jsm");
    require(global, "util");
    require(global, "config");
}
CommandLineHandler.prototype = {

    classDescription: "Dactyl Command-line Handler",

    classID: Components.ID("{16dc34f7-6d22-4aa4-a67f-2921fb5dcb69}"),

    contractID: "@mozilla.org/commandlinehandler/general-startup;1?type=dactyl",

    _xpcom_categories: [{
        category: "command-line-handler",
        entry: "m-dactyl"
    }],

    QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsICommandLineHandler]),

    handle: function (commandLine) {

        // TODO: handle remote launches differently?
        try {
            this.optionValue = commandLine.handleFlagWithParam(config.name, false);
        }
        catch (e) {
            util.dump("option '-" + config.name + "' requires an argument\n");
        }
    },

    get helpInfo() "  -" + config.name + " <opts>" + "             Additional options for " + config.appName + " startup\n".substr(config.name.length)
};

if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([CommandLineHandler]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([CommandLineHandler]);
var EXPORTED_SYMBOLS = ["NSGetFactory", "global"];

} catch (e) { reportError(e) }

// vim: set fdm=marker sw=4 ts=4 et:
