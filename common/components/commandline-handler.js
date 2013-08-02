// Copyright (c) 2009 by Doug Kearns
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

function reportError(e) {
    dump("dactyl: command-line-handler: " + e + "\n" + (e.stack || Error().stack));
    Cu.reportError(e);
}

var global = this;
var NAME = "command-line-handler";
var { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function init() {
    Cu.import("resource://dactyl/bootstrap.jsm");
    require("config", global);
    require("util", global);
}

function CommandLineHandler() {
    this.wrappedJSObject = this;
}
CommandLineHandler.prototype = {

    classDescription: "Dactyl command line Handler",

    classID: Components.ID("{16dc34f7-6d22-4aa4-a67f-2921fb5dcb69}"),

    contractID: "@mozilla.org/commandlinehandler/general-startup;1?type=dactyl",

    _xpcom_categories: [
        {
            category: "command-line-handler",
            entry: "m-dactyl"
        },

        // FIXME: Belongs elsewhere
         {
            category: "profile-after-change",
            entry: "m-dactyl"
        }
    ],

    observe: function observe(subject, topic, data) {
        if (topic === "profile-after-change") {
            init();
            require(global, "main");
        }
    },

    QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsICommandLineHandler]),

    handle: function (commandLine) {
        init();
        try {
            var remote = commandLine.handleFlagWithParam(config.name + "-remote", false);
        }
        catch (e) {
            util.dump("option '-" + config.name + "-remote' requires an argument\n");
        }

        try {
            if (remote) {
                commandLine.preventDefault = true;
                require(global, "services");
                util.dactyl.execute(remote);
            }
        }
        catch (e) {
            util.reportError(e);
        }

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

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
